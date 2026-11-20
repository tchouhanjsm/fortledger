import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, assertAvailability } from './database.js';
import { bookingTotals, nightsBetween, toPaise } from './finance.js';
import { createProforma,getInvoice,listInvoices } from './invoices.js';
import { streamProformaPdf } from './invoice-pdf.js';
import { getBusinessSettings,updateBusinessSettings } from './business-settings.js';

export function createApp(db) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));
  const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
  app.use(express.static(publicDir));

  const listRooms = db.prepare('SELECT * FROM rooms ORDER BY id');
  app.get('/api/settings/business',(_req,res)=>res.json(getBusinessSettings(db)));
  app.put('/api/settings/business',(req,res,next)=>{
    try{res.json(updateBusinessSettings(db,req.body));}
    catch(error){next(error);}
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
      streamProformaPdf(invoice.snapshot,res);
    }catch(e){next(e);}
  });
  app.get('/api/health', (_req,res)=>res.json({ ok:true }));
  app.get('/api/rooms', (_req,res)=>res.json(listRooms.all()));
  app.patch('/api/rooms/:id', (req,res,next)=>{
    try {
      const id=Number(req.params.id);
      if (!Number.isInteger(id)) throw new Error('Invalid room');
      const name=String(req.body.name||'').trim();
      const category=String(req.body.category||'').trim();
      if (!name || !category || name.length>80 || category.length>80) throw new Error('Name and category required (max 80 characters)');
      const room=db.prepare('SELECT id,category FROM rooms WHERE id=?').get(id);
      if (!room) return res.status(404).json({error:'Room not found'});
      if (room.category !== category && db.prepare('SELECT 1 FROM bookings LIMIT 1').get()) throw new Error('Room categories cannot be changed after bookings exist in this foundation release');
      db.prepare('UPDATE rooms SET name=?,category=? WHERE id=?').run(name,category,id);
      res.json({ok:true});
    } catch(e) {next(e);}
  });

  const getBookings = db.prepare(`
    SELECT b.*, COALESCE((SELECT sum(amount_paise) FROM payments p WHERE p.booking_id=b.id),0) AS paid_paise,
      r.name AS assigned_room FROM bookings b LEFT JOIN rooms r ON r.id=b.room_id ORDER BY b.checkin DESC,b.id DESC
  `);
  app.get('/api/bookings', (req,res)=>{
    const q=String(req.query.q||'').toLowerCase().slice(0,100);
    const items=getBookings.all().filter(b=>!q||[b.guest_name,b.company_name,b.category,b.assigned_room||''].some(x=>x.toLowerCase().includes(q)));
    res.json(items.map(b=>({...b,...bookingTotals(b)})));
  });

  app.post('/api/bookings', (req,res,next)=>{
    try {
      const b=normalizeBooking(req.body);
      let id;
      db.transaction(()=>{
        assertAvailability(db,b);
        const result=db.prepare(`INSERT INTO bookings
          (guest_name,company_name,checkin,checkout,rooms_count,room_id,category,meal_plan,nightly_rate_paise)
          VALUES (@guest_name,@company_name,@checkin,@checkout,@rooms_count,@room_id,@category,@meal_plan,@nightly_rate_paise)`).run(b);
        id=Number(result.lastInsertRowid);
        const initial=toPaise(req.body.amount_paid ?? 0);
        if (initial>0) db.prepare('INSERT INTO payments (booking_id,amount_paise,note) VALUES (?,?,?)').run(id,initial,'Initial advance');
      })();
      res.status(201).json({id, ...bookingTotals({...b,paid_paise:toPaise(req.body.amount_paid ?? 0)})});
    } catch(e) {next(e);}
  });

  // Booking updates remain atomic with availability checks; original payment records persist.
  app.patch('/api/bookings/:id', (req,res,next)=>{
    try {
      const id=Number(req.params.id);
      if (!Number.isSafeInteger(id)||id<1) throw new Error('Invalid booking ID');
      const previous=db.prepare('SELECT * FROM bookings WHERE id=?').get(id);
      if (!previous) return res.status(404).json({error:'Booking not found'});
      if (previous.status==='cancelled') throw new Error('Cancelled bookings cannot be edited');
      const b=normalizeBooking(req.body);
      db.transaction(()=>{
        assertAvailability(db,b,id);
        db.prepare(`UPDATE bookings SET guest_name=@guest_name,company_name=@company_name,checkin=@checkin,
          checkout=@checkout,rooms_count=@rooms_count,room_id=@room_id,category=@category,
          meal_plan=@meal_plan,nightly_rate_paise=@nightly_rate_paise WHERE id=@id`).run({...b,id});
      })();
      res.json({ok:true,id});
    }catch(e){next(e);}
  });
  app.get('/api/bookings/:id/payments',(req,res,next)=>{
    try{
      const id=Number(req.params.id);
      if(!Number.isSafeInteger(id)||id<1) throw new Error('Invalid booking ID');
      if(!db.prepare('SELECT 1 FROM bookings WHERE id=?').get(id)) return res.status(404).json({error:'Booking not found'});
      res.json(db.prepare('SELECT id,amount_paise,note,created_at FROM payments WHERE booking_id=? ORDER BY id').all(id));
    }catch(e){next(e);}
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

  app.post('/api/bookings/:id/payments', (req,res,next)=>{
    try {
      const id=Number(req.params.id);
      const booking=db.prepare('SELECT id,status FROM bookings WHERE id=?').get(id);
      if (!Number.isSafeInteger(id)||!booking) return res.status(404).json({error:'Booking not found'});
      if(booking.status==='cancelled') throw new Error('Cannot record payments against a cancelled booking');
      const amount=toPaise(req.body.amount);
      if (amount<=0) throw new Error('Payment must be greater than zero');
      db.prepare('INSERT INTO payments (booking_id,amount_paise,note) VALUES (?,?,?)').run(id,amount,String(req.body.note||'').slice(0,200));
      res.status(201).json({ok:true});
    } catch(e) {next(e);}
  });
  app.patch('/api/bookings/:id/status', (req,res,next)=>{
    try {
      const id=Number(req.params.id);
      if (!Number.isInteger(id)) throw new Error('Invalid booking');
      const status=String(req.body.status||'');
      const current=db.prepare('SELECT status FROM bookings WHERE id=?').get(id);
      if(!current) return res.status(404).json({error:'Booking not found'});
      if(current.status==='cancelled'&&status!=='cancelled') throw new Error('Cancelled bookings cannot be reactivated in this version');
      if (!['reserved','checked_in','checked_out','cancelled'].includes(status)) throw new Error('Invalid status');
      const update=db.prepare('UPDATE bookings SET status=? WHERE id=?').run(status,id);
      if (!update.changes) return res.status(404).json({error:'Booking not found'});
      res.json({ok:true});
    } catch(e) {next(e);}
  });
  app.use((err,req,res,_next)=>{
    const isConflict=/availability|capacity|already assigned|Not enough/.test(err.message);
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
  const room_id=input.room_id===''||input.room_id===undefined||input.room_id===null?null:Number(input.room_id);
  nightsBetween(checkin,checkout);
  if (!guest_name||guest_name.length>150||company_name.length>150) throw new Error('Enter guest name (max 150 characters)');
  if (!category||category.length>80||!meal_plan||meal_plan.length>40) throw new Error('Invalid category or meal plan');
  if (!Number.isInteger(rooms_count)||rooms_count<1||rooms_count>7) throw new Error('Room count must be between 1 and 7');
  if (room_id!==null&&(!Number.isInteger(room_id)||room_id<1)) throw new Error('Invalid room ID');
  return {guest_name,company_name,checkin,checkout,rooms_count,room_id,category,meal_plan,
    nightly_rate_paise:toPaise(input.nightly_rate)};
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const db=openDatabase();
  const port=Number(process.env.PORT||3000);
  createApp(db).listen(port,'127.0.0.1',()=>console.log('FortLedger local app: http://127.0.0.1:'+port));
}
