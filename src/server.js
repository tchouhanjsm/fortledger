import {updateRoomDefinition} from './room-definition.js';
import express from 'express';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import https from 'node:https';
import {backupFreshness} from './backup-freshness.js';
import {releaseReadiness} from './release-readiness.js';
import {summarizeReleaseReadiness} from './release-status-summary.js';
import {verifyLocalBackupHealth} from './backup-health.js';
import {prepareVerifiedUpgradeBackup,UpgradeBackupRefusal} from './upgrade-backup.js';
import {updateStatus} from './update-status.js';
import {inspectUpdateReadiness,createSupervisedUpdateIpc} from './update-readiness.js';
import {inspectDesktopCodeUpdate} from './desktop-code-update.js';
import { fileURLToPath } from 'node:url';
import {authGate,loadPasswordRecord,DEFAULT_AUTH_FILE} from './auth.js';
import {renderRestaurantReceipt} from './restaurant-receipt.js';
import {previewRestaurantCorrection} from './restaurant-correction-preview.js';
import {listRestaurantCorrectionCases,restaurantCorrectionRequest,submitRestaurantCorrectionCase,reviewRestaurantCorrectionCase} from './restaurant-correction-cases.js';
import {prepareTaxDraft,getTaxDraft} from './tax-draft.js';
import {gstReadiness} from './gst-readiness.js';
import {streamTaxDraftPdf} from './tax-draft-pdf.js';
import {setHotelLogo,getCurrentLogo,getActiveLogoId,getLogoAsset} from './hotel-logo.js';
import {scheduleEncryptedBackups} from './encrypted-backups.js';
import {printSavedBill,getPrintStatus} from './printer.js';
import { openDatabase, assertAvailability } from './database.js';
import { bookingTotals, nightsBetween, toPaise } from './finance.js';
import { createProforma,getInvoice,listInvoices } from './invoices.js';
import { streamProformaPdf } from './invoice-pdf.js';
import { getBusinessSettings,updateBusinessSettings } from './business-settings.js';
import {importMenuCsv,planMenuImport,listMenu,listMenuForManagement,setMenuItemAvailability,updateMenuItemPrice,createRestaurantBill,restaurantBillRequest,listRestaurantBills,linkManualRoomCharge} from './restaurant.js';
import {listRestaurantTables,createRestaurantTable,changeRestaurantTable} from './restaurant-tables.js';
import {planBundledMenuSync,applyBundledMenuSync} from './bundled-garh-jaisal-menu.js';
import {getGuestFolio,settleRoomBill,settleCombined} from './folio.js';
import {adjustedAccommodation,recordAccommodationAdjustment} from './accommodation-adjustments.js';
import { NET_PAYMENTS_SQL, paymentHistory,recordRefund } from './payment-ledger.js';
import {createStaff,listStaff,updateStaff,updateOwnProfile} from './staff.js';
import {ROLE_PERMISSIONS} from './access.js';
import {transitionBooking,assertBookingEditAllowed} from './booking-transitions.js';
import {dailyCollections} from './daily-collections.js';
import {restaurantReconciliation} from './restaurant-reconciliation.js';
import {recordExpense,listExpenses} from './expenses.js';
import {listHousekeeping,markRoomState} from './housekeeping.js';
import {createDailyClose,getDailyClose,reviewDailyClose,unreviewedDailyCloses} from './daily-close.js';
import {roomPerformance} from './room-performance.js';
import {createMaintenanceIssue,resolveMaintenanceIssue,listMaintenance,blockedRoomIds} from './maintenance.js';
import {saveGuest,listGuests,guestStays,validateGuestLink} from './guests.js';
import {paymentMethod,recordAudit,auditEvents,recordHotelPayment} from './financial-audit.js';
import {createBookingSafely} from './booking-create.js';
import {normalizeOperationalNotes,updateOperationalNotes} from './booking-notes.js';
import {deleteUnusedBooking,deleteUnusedGuest} from './entry-deletion.js';
import {requireConfiguredHost,localListenerSettings,readLanTlsCredentials} from './network-policy.js';

/** Avoid full SQLite/backup decrypt diagnostics in the live HTTP process.
 * The complete doctor and isolated restore are separate maintenance operations. */
function lightweightReleaseReadiness(){
  return releaseReadiness({diagnostics:{
    checks:[{name:'Full device diagnostics require a separate maintenance window',
      status:'warn',detail:'Use Diagnose FortLedger.cmd and a verified off-device restore'}],
    summary:{passed:0,failed:0,warnings:1}
  }});
}

/** Financial POSTs require a caller-supplied stable request identity.
 * Generating a new key in the server would make lost-response retries unsafe. */
function requireFinancialRequestId(body){
  if(!body||typeof body.request_id!=='string'||
    !/^[A-Za-z0-9_-]{16,80}$/.test(body.request_id))
    throw new Error('Unique request_id (16–80 safe characters) required for financial POST; reuse unchanged ID on retry');
}
export function createApp(db,{authRecord=null,authFile=null,network=null,businessDate=null,checkUpdates=updateStatus,updateService=null,checkBackupHealth=verifyLocalBackupHealth,
  prepareUpgradeBackup=prepareVerifiedUpgradeBackup,getReleaseReadiness=lightweightReleaseReadiness}={}) {
  if(network?.mode==='lan'&&!authRecord)throw new Error('LAN access requires configured authentication');
  const app = express();
  const menuPreviewKey=randomBytes(32); // invalidated safely on every server restart
  let updateDraining=false,installPending=false,upgradeBackupPending=null;
  app.use((req,res,next)=>{
    if(updateDraining&&['POST','PUT','PATCH','DELETE'].includes(req.method)){
      res.setHeader('Cache-Control','no-store');
      return res.status(503).json({error:'FortLedger is draining active work for a supervised update. Do not retry money writes until the new server is ready; review the ledger first.'});
    }
    next();
  });
  app.disable('x-powered-by');
  // Fail closed against hostile Host headers and DNS rebinding on the
  // single-machine alpha. Private staff-LAN mode requires a separate review.
  app.use(requireConfiguredHost(network));
  // Sensitive API data and authenticated entry pages must never be stored by
  // browsers, intermediaries, or a future installable-app cache.
  app.use((req,res,next)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    if(req.path==='/api'||req.path.startsWith('/api/')||
       req.path==='/'||req.path==='/index.html'||req.path==='/login.html'){
      res.setHeader('Cache-Control','no-store');
      res.setHeader('Pragma','no-cache');
    }
    next();
  });
  app.use('/api/settings/logo',express.json({limit:'1.2mb'}));
  app.use(express.json({ limit: '64kb' }));
  const gate=authGate(authRecord,db,{authFile,network});
  app.use('/api',gate.checkRequest);
  app.post('/api/auth/login',gate.login);
  app.post('/api/auth/pin',gate.pinLogin);
  app.get('/api/auth/pin/status',gate.pinLoginStatus);
  app.get('/api/auth/status',(req,res)=>res.json(gate.status(req)));
  app.use('/api',gate.protect);
  app.post('/api/auth/logout',gate.logout);
  app.use('/api',gate.authorize);
  app.get('/api/me',(req,res)=>res.json({...req.actor,login_method:req.auth_method||'password',permissions:ROLE_PERMISSIONS[req.actor.role]||[],unsecured_fixture:!authRecord}));
  app.get('/api/me/quick-pin',gate.pinProfile);
  app.post('/api/me/quick-pin',gate.pinEnroll);
  app.delete('/api/me/quick-pin',gate.pinRevoke);
  app.get('/api/system/staff-pin',gate.pinPolicyGet);
  app.post('/api/system/staff-pin',gate.pinPolicyUpdate);
  app.get('/api/system/backup-status',(_req,res)=>res.json(backupFreshness()));
  // Explicit owner command: decrypt the latest off-device snapshot into a
  // private scratch folder. Never expose paths, passphrases or guest details.
  app.get('/api/system/backup-verify',(req,res,next)=>{
    if(req.actor?.role!=='owner')
      return res.status(403).json({error:'Owner verification required'});
    try{res.json(checkBackupHealth());}catch(error){next(error);}
  });
  // Read-only inspection only. Never let a browser request execute a Git merge,
  // npm installation, data migration, process restart, or a remote network command.
  const updateOwnerLocal=req=>Boolean(authRecord&&network?.mode!=='lan'&&
    ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress));
  app.get('/api/system/release-readiness',(req,res,next)=>{
    if(req.actor?.role!=='owner'||!updateOwnerLocal(req))
      return res.status(403).json({error:'Read-only release review requires owner sign-in on this computer'});
    try{res.json(summarizeReleaseReadiness(getReleaseReadiness()));}
    catch(error){next(error);}
  });
  // Backup preparation deliberately does not use the Git updater. It creates
  // only a new independently protected encrypted snapshot, never a booking or
  // database migration. Keep it alive during a graceful tray shutdown.
  app.locals.waitForUpgradeBackup=()=>upgradeBackupPending?.catch(()=>{})??Promise.resolve();
  app.post('/api/system/backup-prepare',async(req,res)=>{
    if(req.actor?.role!=='owner'||!updateOwnerLocal(req))
      return res.status(403).json({error:'Only the owner on this Windows PC can prepare an upgrade backup.'});
    if(upgradeBackupPending)
      return res.status(409).json({error:'An external backup preparation is already in progress.'});
    const job=Promise.resolve().then(()=>prepareUpgradeBackup(db));
    upgradeBackupPending=job;
    try{
      return res.json(await job);
    }catch(error){
      return res.status(error instanceof UpgradeBackupRefusal?409:500).json({
        error:error instanceof UpgradeBackupRefusal?error.message:
          'External backup verification failed. Hotel records were not modified; inspect the protected backup drive before upgrading.'
      });
    }finally{
      if(upgradeBackupPending===job)upgradeBackupPending=null;
    }
  });
  app.get('/api/system/updates',async(req,res,next)=>{
    try{
      if(!updateOwnerLocal(req))
        return res.status(403).json({error:'Update checks require local owner sign-in on this device'});
      res.json(await checkUpdates());
    }catch(error){next(error);}
  });
  app.get('/api/system/updates/readiness',async(req,res,next)=>{
    try{
      if(!updateOwnerLocal(req))
        return res.status(403).json({error:'Update readiness requires local owner sign-in'});
      res.json(await (updateService?.inspect?.()??inspectUpdateReadiness({supervised:false})));
    }catch(error){next(error);}
  });
  app.post('/api/system/updates/install',async(req,res,next)=>{
    try{
      if(!updateOwnerLocal(req)||!updateService?.request||
        typeof app.locals.stopForUpdate!=='function')
        return res.status(403).json({error:'A dedicated local Windows supervisor is required to install updates'});
      if(installPending)return res.status(409).json({error:'An update request is already underway'});
      if(req.body?.confirmation!=='stop_after_current_requests'||
         !/^[a-f0-9]{40}$/i.test(req.body?.target_sha||''))
        return res.status(400).json({error:'Explicit owner confirmation and a pinned 40-character Git commit are required'});
      // The original authenticated app never runs Git merge, npm or PowerShell.
      installPending=true;
      const readiness=await updateService.inspect();
      if(!readiness.ready||readiness.target_sha!==req.body.target_sha.toLowerCase()){
        installPending=false;
        return res.status(409).json({error:'The verified candidate or backup readiness changed. Check for updates again.'});
      }
      await updateService.request(readiness.target_sha);
      updateDraining=true;
      res.once('finish',()=>setImmediate(()=>app.locals.stopForUpdate(readiness.target_sha)));
      return res.status(202).json({accepted:true,
        message:'The local update supervisor is finishing active requests before applying verified code changes. Reopen FortLedger after it restarts. Hotel data is not replaced.'});
    }catch(error){
      installPending=false;
      next(error);
    }
  });
  app.post('/api/me/password',gate.changePassword);
  app.patch('/api/me',(req,res,next)=>{
    try{res.json(updateOwnProfile(db,req.actor,req.body?.display_name));}
    catch(error){next(error);}
  });
  app.get('/api/staff',(_req,res)=>res.json(listStaff(db)));
  app.post('/api/staff',(req,res,next)=>{
    try{res.status(201).json(createStaff(db,req.body));}catch(error){next(error);}
  });
  app.patch('/api/staff/:id',(req,res,next)=>{
    try{
      const updated=updateStaff(db,Number(req.params.id),req.body);
      if(req.body?.password!==undefined||updated.active===false||req.body?.role!==undefined){
        gate.revokeUserSessions(updated.id);
        gate.revokeStaffPin(updated.id);
      }
      res.json(updated);
    }catch(error){next(error);}
  });
  const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
  app.use(express.static(publicDir));

  const listRooms = db.prepare(`SELECT r.*,h.status AS housekeeping_status
    FROM rooms r LEFT JOIN room_housekeeping h ON h.room_id=r.id ORDER BY r.id`);
  app.get('/api/guests',(req,res,next)=>{
    try{res.json(listGuests(db,req.query.q||''));}catch(error){next(error);}
  });
  app.get('/api/guests/:id/stays',(req,res,next)=>{
    try{res.json(guestStays(db,Number(req.params.id)));}catch(error){next(error);}
  });
  app.post('/api/guests',(req,res,next)=>{
    try{res.status(201).json(saveGuest(db,req.body,req.actor));}catch(error){next(error);}
  });
  app.patch('/api/guests/:id',(req,res,next)=>{
    try{res.json(saveGuest(db,req.body,req.actor,Number(req.params.id)));}catch(error){next(error);}
  });
  app.delete('/api/guests/:id',(req,res,next)=>{
    try{res.json(deleteUnusedGuest(db,Number(req.params.id),req.actor));}
    catch(error){next(error);}
  });
  app.get('/api/maintenance',(req,res,next)=>{
    try{res.json(listMaintenance(db,{status:req.query.status||'open'}));}
    catch(error){next(error);}
  });
  app.post('/api/maintenance',(req,res,next)=>{
    try{res.status(201).json(createMaintenanceIssue(db,req.body,req.actor));}
    catch(error){next(error);}
  });
  app.patch('/api/maintenance/:id/resolve',(req,res,next)=>{
    try{res.json(resolveMaintenanceIssue(db,Number(req.params.id),req.actor,req.body?.resolution_note??''));}
    catch(error){next(error);}
  });
  app.get('/api/housekeeping',(_req,res)=>res.json(listHousekeeping(db)));
  app.patch('/api/housekeeping/:id',(req,res,next)=>{
    try{
      res.json(markRoomState(db,Number(req.params.id),req.body?.status,req.actor,req.body?.note??''));
    }catch(error){next(error);}
  });
  app.get('/api/analytics/rooms',(req,res,next)=>{
    try{res.json(roomPerformance(db,req.query.start,req.query.end));}
    catch(error){next(error);}
  });
  app.get('/api/finance/closing/attention',(_req,res,next)=>{
    try{res.json(unreviewedDailyCloses(db));}catch(error){next(error);}
  });
  app.post('/api/finance/closing/review',(req,res,next)=>{
    try{res.json(reviewDailyClose(db,req.body?.business_date,req.body,req.actor));}
    catch(error){next(error);}
  });
  app.get('/api/finance/closing',(req,res,next)=>{
    try{
      const entry=getDailyClose(db,req.query.date);
      if(!entry)return res.status(404).json({error:'No closing recorded for date'});
      res.json(entry);
    }catch(error){next(error);}
  });
  app.post('/api/finance/closing',(req,res,next)=>{
    try{
      const entry=createDailyClose(db,req.body,req.actor);
      res.status(entry.already_recorded?200:201).json(entry);
    }catch(error){next(error);}
  });
  app.get('/api/finance/expenses',(req,res,next)=>{
    try{res.json(listExpenses(db,req.query.date));}catch(error){next(error);}
  });
  app.post('/api/finance/expenses',(req,res,next)=>{
    try{
      const saved=recordExpense(db,req.body,req.actor);
      res.status(saved.already_recorded?200:201).json(saved);
    }catch(error){next(error);}
  });
  app.get('/api/finance/daily',(req,res,next)=>{
    try{res.json(dailyCollections(db,req.query.date));}
    catch(error){next(error);}
  });
  app.get('/api/finance/restaurant/reconciliation.csv',(req,res,next)=>{
    try{
      const report=restaurantReconciliation(db,req.query.date);
      res.setHeader('Content-Type','text/csv; charset=utf-8');
      res.setHeader('Content-Disposition','attachment; filename="'+report.filename+'"');
      res.send(report.csv);
    }catch(error){next(error);}
  });
  app.get('/api/audit/:entity/:id',(req,res,next)=>{
    try{res.json(auditEvents(db,{entityType:req.params.entity,entityId:Number(req.params.id)}));}
    catch(error){next(error);}
  });
  app.get('/api/bookings/:id/folio',(req,res,next)=>{
    try{res.json(getGuestFolio(db,Number(req.params.id)));}catch(error){next(error);}
  });
  app.post('/api/bookings/:id/folio/adjustments',(req,res,next)=>{
    try{
      const result=recordAccommodationAdjustment(db,Number(req.params.id),req.body,req.actor);
      res.status(result.already_recorded?200:201).json(result);
    }catch(error){next(error);}
  });
  app.post('/api/bookings/:id/folio/settle-combined',(req,res,next)=>{
    try{
      if(authRecord)requireFinancialRequestId(req.body);
      const result=settleCombined(db,Number(req.params.id),req.body.method,req.actor,{
        accommodation_method:req.body.accommodation_method??req.body.method,
        bank_reference:req.body.bank_reference??'',request_id:req.body.request_id
      });
      res.status(result.already_recorded?200:201).json(result);
    }catch(error){next(error);}
  });
  app.post('/api/bookings/:id/folio/room-bills/:billId/settle',(req,res,next)=>{
    try{
      if(authRecord)requireFinancialRequestId(req.body);
      const result=settleRoomBill(db,Number(req.params.id),Number(req.params.billId),
        req.body.method,req.actor,{request_id:req.body.request_id});
      res.status(result.already_recorded?200:201).json(result);
    }catch(error){next(error);}
  });
  app.get('/api/restaurant/checked-in',(_req,res)=>{
    res.json(db.prepare("SELECT id,guest_name,category,status FROM bookings WHERE status='checked_in' ORDER BY guest_name").all());
  });
  app.get('/api/restaurant/tables',(_req,res)=>res.json(listRestaurantTables(db)));
  app.get('/api/restaurant/tables/all',(_req,res)=>res.json(listRestaurantTables(db,{includeInactive:true})));
  app.post('/api/restaurant/tables',(req,res,next)=>{
    try{res.status(201).json(createRestaurantTable(db,req.body,req.actor));}
    catch(error){next(error);}
  });
  app.patch('/api/restaurant/tables/:id/visibility',(req,res,next)=>{
    try{res.json(changeRestaurantTable(db,Number(req.params.id),req.body,req.actor));}
    catch(error){next(error);}
  });
  app.get('/api/restaurant/menu',(_req,res)=>res.json(listMenu(db)));
  app.get('/api/restaurant/menu/all',(_req,res)=>res.json(listMenuForManagement(db)));
  app.patch('/api/restaurant/menu/:id/price',(req,res,next)=>{
    try{res.json(updateMenuItemPrice(db,Number(req.params.id),req.body,req.actor));}
    catch(error){next(error);}
  });
  app.patch('/api/restaurant/menu/:id/availability',(req,res,next)=>{
    try{
      res.json(setMenuItemAvailability(db,Number(req.params.id),req.body,req.actor));
    }catch(error){next(error);}
  });
  app.get('/api/restaurant/menu/bundled/preview',(req,res,next)=>{
    try{res.json(planBundledMenuSync(db,{signingKey:menuPreviewKey}));}
    catch(error){next(error);}
  });
  app.post('/api/restaurant/menu/bundled/sync',(req,res,next)=>{
    try{res.json(applyBundledMenuSync(db,req.body,req.actor,{signingKey:menuPreviewKey}));}
    catch(error){next(error);}
  });
  app.post('/api/restaurant/menu/preview',(req,res,next)=>{
    try{res.json(planMenuImport(db,req.body?.csv,{signingKey:menuPreviewKey}));}
    catch(error){next(error);}
  });
  app.post('/api/restaurant/menu/import',(req,res,next)=>{
    try{
      res.json(importMenuCsv(db,req.body?.csv,{
        require_preview:true,signingKey:menuPreviewKey,
        preview_token:req.body?.preview_token,
        confirm_import:req.body?.confirm_import,
        approve_suspicious:req.body?.approve_suspicious
      }));
    }catch(error){next(error);}
  });
  app.get('/api/restaurant/bills/:id/print-status',(req,res)=>{
    res.json({status:getPrintStatus(db,Number(req.params.id))});
  });
  app.post('/api/restaurant/bills/:id/print',async(req,res,next)=>{
    if(authRecord&&req.actor?.role!=='cashier')
      return res.status(403).json({error:'Only restaurant staff can send POS print jobs'});
    try{
      const host=process.env.FORTLEDGER_PRINTER_HOST;
      if(!host)throw new Error('Set FORTLEDGER_PRINTER_HOST before LAN printing');
      const port=Number(process.env.FORTLEDGER_PRINTER_PORT||9100);
      res.json(await printSavedBill(db,Number(req.params.id),{host,port},{reprint:req.body?.reprint===true}));
    }catch(error){next(error);}
  });
  app.get('/api/restaurant/bills/:id/receipt',(req,res,next)=>{
    try{
      const html=renderRestaurantReceipt(db,Number(req.params.id));
      if(!html)return res.status(404).send('Receipt not found');
      res.setHeader('Content-Type','text/html; charset=utf-8');
      res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'");
      res.setHeader('X-Content-Type-Options','nosniff');
      res.send(html);
    }catch(error){next(error);}
  });
  app.post('/api/restaurant/bills/:id/correction-preview',(req,res,next)=>{
    try{res.json(previewRestaurantCorrection(db,Number(req.params.id),req.body));}
    catch(error){next(error);}
  });
  app.get('/api/restaurant/bills/:id/correction-cases',(req,res,next)=>{
    try{res.json(listRestaurantCorrectionCases(db,Number(req.params.id)));}
    catch(error){next(error);}
  });
  app.post('/api/restaurant/bills/:id/correction-cases',(req,res,next)=>{
    try{
      const result=submitRestaurantCorrectionCase(db,Number(req.params.id),req.body,req.actor);
      res.status(result.already_recorded?200:201).json(result);
    }catch(error){next(error);}
  });
  app.get('/api/restaurant/correction-cases/request/:requestId',(req,res,next)=>{
    try{res.json(restaurantCorrectionRequest(db,req.params.requestId));}
    catch(error){next(error);}
  });
  app.post('/api/restaurant/correction-cases/:caseId/review',(req,res,next)=>{
    try{
      const result=reviewRestaurantCorrectionCase(db,Number(req.params.caseId),req.body,req.actor);
      res.status(result.already_recorded?200:201).json(result);
    }catch(error){next(error);}
  });
  app.post('/api/restaurant/bills/:id/link-booking',(req,res,next)=>{
    try{res.json(linkManualRoomCharge(db,Number(req.params.id),Number(req.body?.booking_id),
      {actor:req.actor,override:req.body?.override===true,reason:req.body?.reason??''}));}
    catch(error){next(error);}
  });
  app.get('/api/restaurant/bills/request/:requestId',(req,res,next)=>{
    try{res.json(restaurantBillRequest(db,req.params.requestId));}
    catch(error){next(error);}
  });
  app.get('/api/restaurant/bills',(_req,res)=>res.json(listRestaurantBills(db)));
  app.post('/api/restaurant/bills',(req,res,next)=>{
    // Owner/manager oversight is not an implicit emergency cashier login.
    // Legacy unauthenticated test fixtures retain their existing behaviour.
    if(authRecord&&req.actor?.role!=='cashier')
      return res.status(403).json({error:'Only restaurant staff can create POS bills'});
    try{
      // Legacy unauthenticated in-memory fixtures are not a supported hotel deployment.
      if(authRecord)requireFinancialRequestId(req.body);
      const bill=createRestaurantBill(db,req.body,req.actor,
        {requireReviewedPrices:Boolean(authRecord)});
      res.status(bill.already_recorded?200:201).json(bill);
    }catch(error){next(error);}
  });
  app.get('/api/settings/logo',(_req,res)=>res.json({active:getCurrentLogo(db)}));
  app.get('/api/settings/logo/image',(_req,res)=>{
    const logo=getLogoAsset(db,getActiveLogoId(db));
    if(!logo)return res.status(404).send('Hotel logo not configured');
    res.setHeader('Content-Type',logo.mime);
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.send(logo.data);
  });
  app.post('/api/settings/logo',(req,res,next)=>{
    try{res.status(201).json(setHotelLogo(db,req.body));}catch(error){next(error);}
  });
  app.get('/api/settings/business',(_req,res)=>res.json(getBusinessSettings(db)));
  app.put('/api/settings/business',(req,res,next)=>{
    try{res.json(updateBusinessSettings(db,req.body));}
    catch(error){next(error);}
  });
  app.get('/api/tax/readiness',(_req,res)=>res.json(gstReadiness(getBusinessSettings(db))));
  app.post('/api/invoices/:id/tax-draft',(req,res,next)=>{
    try{res.status(201).json(prepareTaxDraft(db,Number(req.params.id),req.body));}
    catch(error){next(error);}
  });
  app.get('/api/tax-drafts/:id',(req,res,next)=>{
    const draft=getTaxDraft(db,Number(req.params.id));
    if(!draft)return res.status(404).json({error:'Tax draft not found'});
    res.json(draft);
  });
  app.get('/api/tax-drafts/:id/pdf',(req,res,next)=>{
    try{
      const draft=getTaxDraft(db,Number(req.params.id));
      if(!draft)return res.status(404).json({error:'Tax draft not found'});
      streamTaxDraftPdf(draft.snapshot,res,getLogoAsset(db,draft.snapshot.logo_asset_id));
    }catch(error){next(error);}
  });
  app.get('/api/invoices',(_req,res)=>res.json(listInvoices(db)));
  app.post('/api/bookings/:id/proforma',(req,res,next)=>{
    try{
      const invoice=createProforma(db,Number(req.params.id),req.body);
      res.status(invoice.already_existed?200:201).json(invoice);
    }catch(e){next(e);}
  });
  app.get('/api/invoices/:id',(req,res,next)=>{
    const invoice=getInvoice(db,Number(req.params.id));
    if(!invoice)return res.status(404).json({error:'Invoice not found'});
    res.json(invoice);
  });
  app.get('/api/invoices/:id/pdf',(req,res,next)=>{
    try{
      const invoice=getInvoice(db,Number(req.params.id));
      if(!invoice)return res.status(404).json({error:'Invoice not found'});
      streamProformaPdf(invoice.snapshot,res,getLogoAsset(db,invoice.snapshot.logo_asset_id));
    }catch(e){next(e);}
  });
  app.get('/api/health', (_req,res)=>res.json({ ok:true }));
  app.get('/api/rooms',(_req,res)=>{
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
      timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'
    }).formatToParts(new Date()).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
    const day=parts.year+'-'+parts.month+'-'+parts.day;
    const blocked=blockedRoomIds(db,day);
    res.json(listRooms.all().map(room=>({...room,out_of_service_today:blocked.has(room.id)})));
  });
  app.patch('/api/rooms/:id', (req,res,next)=>{
    try {
      const id=Number(req.params.id);
      if (!Number.isInteger(id)) throw new Error('Invalid room');
      const name=String(req.body.name||'').trim();
      const category=String(req.body.category||'').trim();
      if (!name || !category || name.length>80 || category.length>80) throw new Error('Name and category required (max 80 characters)');
      res.json(updateRoomDefinition(db,id,{name,category},req.actor));
    } catch(e) {next(e);}
  });

  const allocationsQuery=db.prepare(`
    SELECT a.booking_id,a.room_id,r.name FROM booking_room_allocations a
    JOIN rooms r ON r.id=a.room_id ORDER BY a.room_id`);
  const getBookings = db.prepare(`
    SELECT b.*, ${NET_PAYMENTS_SQL} AS paid_paise,
      r.name AS assigned_room FROM bookings b LEFT JOIN rooms r ON r.id=b.room_id ORDER BY b.checkin DESC,b.id DESC
  `);
  app.get('/api/bookings', (req,res)=>{
    const q=String(req.query.q||'').toLowerCase().slice(0,100);
    const items=getBookings.all();
    const allocated=new Map();
    for(const a of allocationsQuery.all()){
      if(!allocated.has(a.booking_id))allocated.set(a.booking_id,[]);
      allocated.get(a.booking_id).push(a);
    }
    res.json(items.map(b=>{
      const assigned=allocated.get(b.id)||[];
      return {...b,room_ids:assigned.map(x=>x.room_id),
        assigned_room:assigned.length?assigned.map(x=>x.name).join(', '):null,
        ...adjustedAccommodation(db,b,bookingTotals(b))};
    }).filter(b=>!q||[b.guest_name,b.company_name,b.category,b.assigned_room||''].some(x=>x.toLowerCase().includes(q))));
  });

  // Read-only recovery for a lost POST response. Never replays a payment,
  // allocates another room, or modifies a booking.
  app.get('/api/bookings/request/:requestId',(req,res,next)=>{
    try{
      const requestId=req.params.requestId;
      if(!/^[A-Za-z0-9_-]{16,80}$/.test(requestId))
        return res.status(400).json({error:'Invalid booking request ID'});
      const saved=db.prepare('SELECT booking_id FROM booking_create_requests WHERE request_id=?').get(requestId);
      if(saved)return res.json({recorded:true,id:saved.booking_id});
      const deleted=db.prepare('SELECT 1 FROM deleted_booking_requests WHERE request_id=?').get(requestId);
      return res.json({recorded:false,deleted:Boolean(deleted)});
    }catch(error){next(error);}
  });

  app.post('/api/bookings', (req,res,next)=>{
    try{
      // Legacy unauthenticated in-memory fixtures are not a supported hotel deployment.
      if(authRecord)requireFinancialRequestId(req.body);
      const booking=normalizeBooking(req.body);
      const initialPaise=toPaise(req.body.amount_paid??0);
      const method=initialPaise>0?paymentMethod(req.body.advance_method,{allowLegacy:true}):null;
      const result=createBookingSafely(db,{
        booking,initialPaise,method,requestId:req.body.request_id,
        actor:req.actor,validateGuestLink
      });
      res.status(result.already_recorded?200:201).json(result);
    }catch(error){next(error);}
  });

  // Unlike contract edits, pickup/arrival notes remain editable after a proforma
  // is issued. This endpoint cannot alter room holds, prices or money.
  app.patch('/api/bookings/:id/operational-notes',(req,res,next)=>{
    try{res.json(updateOperationalNotes(db,Number(req.params.id),req.body,req.actor));}
    catch(error){next(error);}
  });
  app.delete('/api/bookings/:id',(req,res,next)=>{
    try{res.json(deleteUnusedBooking(db,Number(req.params.id),req.actor));}
    catch(error){next(error);}
  });

  // Booking updates remain atomic with availability checks; original payment records persist.
  app.patch('/api/bookings/:id', (req,res,next)=>{
    try {
      const id=Number(req.params.id);
      if (!Number.isSafeInteger(id)||id<1) throw new Error('Invalid booking ID');
      const previous=db.prepare('SELECT * FROM bookings WHERE id=?').get(id);
      if (!previous) return res.status(404).json({error:'Booking not found'});
      assertBookingEditAllowed(db,id,previous);
      const b=normalizeBooking(req.body);
      // Older clients must not accidentally erase stored links or notes.
      if(req.body.guest_id===undefined)b.guest_id=previous.guest_id;
      if(req.body.pickup_notes===undefined)b.pickup_notes=previous.pickup_notes;
      if(req.body.stay_notes===undefined)b.stay_notes=previous.stay_notes;
      validateGuestLink(db,b.guest_id);
      const {room_ids,...sqlBooking}=b;
      db.transaction(()=>{
        assertAvailability(db,b,id);
        db.prepare('DELETE FROM booking_room_allocations WHERE booking_id=?').run(id);
        const allocate=db.prepare('INSERT INTO booking_room_allocations(booking_id,room_id) VALUES(?,?)');
        for(const roomId of b.room_ids)allocate.run(id,roomId);
        db.prepare(`UPDATE bookings SET guest_name=@guest_name,company_name=@company_name,checkin=@checkin,
          checkout=@checkout,rooms_count=@rooms_count,room_id=@room_id,category=@category,
          meal_plan=@meal_plan,nightly_rate_paise=@nightly_rate_paise,guest_id=@guest_id,
          pickup_notes=@pickup_notes,stay_notes=@stay_notes WHERE id=@id`).run({...sqlBooking,id});
        recordAudit(db,req.actor,'booking.updated','booking',id,
          {previous:{checkin:previous.checkin,checkout:previous.checkout,rooms_count:previous.rooms_count,
            nightly_rate_paise:previous.nightly_rate_paise},
           next:{checkin:b.checkin,checkout:b.checkout,rooms_count:b.rooms_count,
            nightly_rate_paise:b.nightly_rate_paise}});
      })();
      res.json({ok:true,id});
    }catch(e){next(e);}
  });
  app.get('/api/bookings/:id/payments',(req,res,next)=>{
    try{
      const id=Number(req.params.id);
      if(!Number.isSafeInteger(id)||id<1) throw new Error('Invalid booking ID');
      if(!db.prepare('SELECT 1 FROM bookings WHERE id=?').get(id)) return res.status(404).json({error:'Booking not found'});
      res.json(paymentHistory(db,id).payments);
    }catch(e){next(e);}
  });
  app.get('/api/bookings/:id/refunds',(req,res,next)=>{
    try{res.json(paymentHistory(db,Number(req.params.id)).refunds);}
    catch(error){next(error);}
  });
  app.post('/api/bookings/:id/payments/:paymentId/refunds',(req,res,next)=>{
    try{
      const refund=recordRefund(db,Number(req.params.id),Number(req.params.paymentId),req.body,req.actor);
      res.status(refund.already_recorded?200:201).json(refund);
    }catch(error){next(error);}
  });
  app.get('/api/backup', async (_req,res,next)=>{
    const fs=await import('node:fs');
    const os=await import('node:os');
    const pathModule=await import('node:path');
    let dir;
    try{
      dir=fs.mkdtempSync(pathModule.join(os.tmpdir(),'fortledger-backup-'));
      const file=pathModule.join(dir,'fortledger.sqlite');
      await db.backup(file);
      res.download(file,'fortledger-backup.sqlite',error=>{
        fs.rm(dir,{recursive:true,force:true},()=>{});
        if(error&&!res.headersSent)next(error);
      });
    }catch(error){
      if(dir)fs.rm(dir,{recursive:true,force:true},()=>{});
      next(error);
    }
  });

  app.post('/api/bookings/:id/payments',(req,res,next)=>{
    try{
      // Legacy unauthenticated in-memory fixtures are not a supported hotel deployment.
      if(authRecord)requireFinancialRequestId(req.body);
      const receipt=recordHotelPayment(db,Number(req.params.id),req.body,req.actor);
      res.status(receipt.already_recorded?200:201).json({ok:true,...receipt});
    }catch(error){next(error);}
  });
  app.patch('/api/bookings/:id/status',(req,res,next)=>{
    try{
      const response=transitionBooking(db,Number(req.params.id),req.body?.status,{
        actor:req.actor,acknowledge_balance:req.body?.acknowledge_balance===true,
        reason:req.body?.reason??'',override:req.body?.date_override===true,
        ...(businessDate?{businessDate:businessDate()}:{})
      });
      res.json(response);
    }catch(error){next(error);}
  });
  app.use((err,req,res,_next)=>{
    const isConflict=/availability|capacity|already assigned|Not enough|^Room out of service|^Assigned room is out of service|Existing room assignment conflicts|reservations exceed|Menu price or GST rate changed since review|Menu availability changed since review|Menu changed after the built-in preview|Restaurant table visibility changed since review|Dining table is no longer available|Menu item not found or unavailable/i.test(err.message);
    const isDuplicate=/UNIQUE constraint/.test(err.message);
    res.status(isConflict||isDuplicate?409:400).json({error:isDuplicate?'Room name already exists':err.message});
  });
  return app;
}

function normalizeBooking(input) {
  const guest_name=String(input.guest_name||'').trim();
  const company_name=String(input.company_name||'').trim();
  const category=String(input.category||'Unassigned').trim();
  const meal_plan=String(input.meal_plan||'CP').trim();
  const checkin=String(input.checkin||'');
  const checkout=String(input.checkout||'');
  const rooms_count=Number(input.rooms_count);
  const guest_id=input.guest_id===undefined||input.guest_id===null||input.guest_id===''?null:Number(input.guest_id);
  if(guest_id!==null&&(!Number.isSafeInteger(guest_id)||guest_id<1))
    throw new Error('Invalid guest profile selection');
  const room_ids=Array.isArray(input.room_ids)?input.room_ids.map(Number):
    (input.room_id===undefined||input.room_id===null||input.room_id===''?[]:[Number(input.room_id)]);
  const room_id=room_ids.length===1&&rooms_count===1?room_ids[0]:null;
  nightsBetween(checkin,checkout);
  if (!guest_name||guest_name.length>150||company_name.length>150) throw new Error('Enter guest name (max 150 characters)');
  if (!category||category.length>80||!meal_plan||meal_plan.length>40) throw new Error('Invalid category or meal plan');
  if (!Number.isInteger(rooms_count)||rooms_count<1||rooms_count>7) throw new Error('Room count must be between 1 and 7');
  if(room_ids.length>rooms_count||new Set(room_ids).size!==room_ids.length||
     room_ids.some(id=>!Number.isInteger(id)||id<1))throw new Error('Invalid assigned room selection');
  return {guest_name,company_name,checkin,checkout,rooms_count,room_id,room_ids,category,guest_id,meal_plan,
    ...normalizeOperationalNotes(input),nightly_rate_paise:toPaise(input.nightly_rate)};
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  // Refuse unsafe network/TLS settings before opening or migrating hotel data.
  const network=localListenerSettings();
  const {host,port}=network;
  const tls=network.mode==='lan'?readLanTlsCredentials(network):null;
  const db=openDatabase();
  const authRecord=loadPasswordRecord();
  if(!authRecord){
    console.error('FortLedger requires local admin authentication. Run: npm run setup-auth');
    process.exitCode=1;db.close();
  }else{
    const supervised=process.platform==='win32'&&
      process.env.FORTLEDGER_SUPERVISED==='1'&&
      typeof process.send==='function'&&!tls&&
      host==='127.0.0.1'&&port===3000;
    const ipc=supervised?createSupervisedUpdateIpc(process):null;
    const desktopCodeHost=process.platform==='win32'&&
      process.env.FORTLEDGER_DESKTOP_INSTALLER==='1'&&
      process.env.FORTLEDGER_DESKTOP_UPDATE_HOST==='1'&&
      !supervised&&!tls&&host==='127.0.0.1'&&port===3000;
    const app=createApp(db,{authRecord,authFile:DEFAULT_AUTH_FILE,network,
      ...(ipc?{updateService:{
        inspect:()=>inspectUpdateReadiness({supervised:true}),
        request:sha=>ipc.request(sha)
      }}:desktopCodeHost?{updateService:{
        inspect:()=>inspectDesktopCodeUpdate(),
        request:async sha=>{
          if(!/^[a-f0-9]{40}$/i.test(sha))throw new Error('Invalid desktop patch commit');
          return true; // The tray parent performs ALL code file writes after clean exit.
        }
      }}:{})});
    const server=tls?https.createServer({cert:tls.cert,key:tls.key,minVersion:'TLSv1.2'},app):app;
    let backups=null;
    const listener=server.listen(port,host,()=>{
      console.log('FortLedger '+(tls?'private staff HTTPS':'local app')+': '+
        (tls?'https://':'http://')+host+':'+port);
      backups=scheduleEncryptedBackups(db);
    });
    async function closeDataSafely(){
      backups?.stop();
      if(backups?.idle)await backups.idle();
      await app.locals.waitForUpgradeBackup();
      db.close();
    }
    if(process.platform==='win32'&&process.env.FORTLEDGER_DESKTOP_INSTALLER==='1'&&
       port===3000&&(network.mode==='lan'||(!tls&&host==='127.0.0.1'))){
      // Local GUI tray launcher owns stdin. It asks the server to stop without
      // killing an in-progress bill, booking, SQLite write or receipt response.
      let quitting=false,buffer='';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data',part=>{
        buffer=(buffer+part).slice(-256);
        if(!buffer.includes('FORTLEDGER_DESKTOP_QUIT\n'))return;
        if(quitting)return;
        quitting=true;
        listener.close(async()=>{
          try{await closeDataSafely();}
          catch(error){console.error('FortLedger shutdown blocked:',error.message);process.exitCode=1;return;}
          process.exit(0);
        });
      });
      process.stdin.resume();
    }
    if(desktopCodeHost){
      let stopping=false;
      app.locals.stopForUpdate=(sha)=>{
        if(stopping)return;
        stopping=true;
        // Desktop tray is an independent parent. Do not replace any installed
        // source files while a request, WAL connection or backup job is live.
        listener.close(async()=>{
          try{await closeDataSafely();}
          catch(error){
            console.error('Desktop code update shutdown blocked:',error.message);
            process.exitCode=1;return;
          }
          // Exactly one control line on stdout; the tray checks child exit 0
          // before allowing the separate, pinned update helper to run.
          process.stdout.write('FORTLEDGER_DESKTOP_PATCH:'+sha+'\n',()=>process.exit(0));
        });
      };
    }
    if(supervised){
      let stopping=false;
      app.locals.stopForUpdate=()=>{
        if(stopping)return;
        stopping=true;
        // Node's graceful close finishes existing HTTP responses, including
        // persisted transactions. Never call closeAllConnections or kill staff writes.
        listener.close(async()=>{
          try{await closeDataSafely();}
          catch(error){console.error('Supervised shutdown blocked:',error.message);process.exitCode=1;return;}
          if(process.send)process.send({type:'fortledger.update.drained'},()=>process.exit(0));
          else process.exit(0);
        });
      };
    }
  }
}
