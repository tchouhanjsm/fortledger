import {createHash} from 'node:crypto';
import {validatePrinterAddress} from './printer.js';
import {runPrinterSelfTest} from './epson-diagnostic-slip.js';
import {recordAudit} from './financial-audit.js';

const RAW_PORTS=Object.freeze([9100,9101,9102]);
export function validateSavedLanPrinter(input){
  if(!input||typeof input!=='object'||Array.isArray(input))
    throw new Error('Invalid LAN printer setup');
  if(input.enabled!==true&&input.enabled!==false)
    throw new Error('Choose whether the Ethernet printer is enabled');
  if(input.enabled===false)return {enabled:false,host:null,port:null};
  const host=String(input.host||'').trim();
  const port=input.port===undefined?9100:input.port;
  validatePrinterAddress(host,port);
  if(host.startsWith('127.')||host==='0.0.0.0')
    throw new Error('Choose the printer IPv4 from the staff LAN, not a loopback address');
  if(!RAW_PORTS.includes(port))
    throw new Error('Only ESC/POS raw TCP ports 9100–9102 are supported; this does not support IPP/LPR printers');
  return {enabled:true,host,port};
}
export function ensureLanPrinterSettingsSchema(db){
  db.exec(`CREATE TABLE IF NOT EXISTS lan_printer_settings(
    id INTEGER PRIMARY KEY CHECK(id=1),
    enabled INTEGER NOT NULL CHECK(enabled IN(0,1)),
    host TEXT,
    port INTEGER,
    actor_username TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK((enabled=0 AND host IS NULL AND port IS NULL) OR
          (enabled=1 AND host IS NOT NULL AND port BETWEEN 9100 AND 9102))
  );
  CREATE TABLE IF NOT EXISTS lan_printer_diagnostics(
    id INTEGER PRIMARY KEY,
    request_id TEXT NOT NULL UNIQUE,
    printer_fingerprint TEXT NOT NULL CHECK(length(printer_fingerprint)=64),
    state TEXT NOT NULL CHECK(state IN('sending','sent_unverified','uncertain')),
    actor_username TEXT NOT NULL,
    last_error TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TRIGGER IF NOT EXISTS lan_printer_diagnostics_no_delete
    BEFORE DELETE ON lan_printer_diagnostics
    BEGIN SELECT RAISE(ABORT,'Printer test history cannot be deleted'); END;`);
}
export function configuredLanPrinter(db,env=process.env){
  const saved=db.prepare('SELECT enabled,host,port FROM lan_printer_settings WHERE id=1').get();
  if(saved){
    if(saved.enabled===0)return {enabled:false,host:null,port:null,source:'owner_disabled'};
    const options=validateSavedLanPrinter({enabled:true,host:saved.host,port:saved.port});
    return {...options,source:'owner_settings'};
  }
  // Keep compatibility with previously configured PC environment variables.
  // No owner-wizard migration or silent override of a configured device.
  if(env.FORTLEDGER_PRINTER_HOST){
    const options=validateSavedLanPrinter({enabled:true,host:env.FORTLEDGER_PRINTER_HOST,
      port:Number(env.FORTLEDGER_PRINTER_PORT||9100)});
    return {...options,source:'legacy_environment'};
  }
  return {enabled:false,host:null,port:null,source:'unconfigured'};
}
export function saveLanPrinterSettings(db,input,actor){
  if(actor?.role!=='owner'||!actor.username)throw new Error('Owner authorization required');
  const next=validateSavedLanPrinter(input);
  return db.transaction(()=>{
    const existing=configuredLanPrinter(db);
    if(existing.enabled===next.enabled&&existing.host===next.host&&existing.port===next.port)
      return {...existing,unchanged:true};
    db.prepare(`INSERT INTO lan_printer_settings(id,enabled,host,port,actor_username)
      VALUES(1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
        enabled=excluded.enabled,host=excluded.host,port=excluded.port,
        actor_username=excluded.actor_username,updated_at=datetime('now')`)
      .run(next.enabled?1:0,next.host,next.port,actor.username);
    recordAudit(db,actor,'printer.settings_changed','printer_device',1,{
      from_enabled:existing.enabled,to_enabled:next.enabled,
      // Avoid topology details and printer addresses in generic audit exports.
      source:'owner_configuration',cashier_print_authorized:false
    });
    return {...configuredLanPrinter(db),unchanged:false};
  })();
}
function requireRequestId(value){
  if(typeof value!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(value))
    throw new Error('A stable printer-test request ID is required');
  return value;
}
function status(row){
  if(!row)return null;
  return {id:row.id,request_id:row.request_id,state:row.state,
    created_at:row.created_at,updated_at:row.updated_at,
    notice:row.state==='sent_unverified'?
      'Printer connection accepted test bytes. Physically verify paper; nothing was invoiced or paid.':
      row.state==='sending'?
      'Test transmission in progress or interrupted. Inspect printer before any new test.':
      'Test outcome uncertain. Inspect printer and LAN setup before a fresh test.'};
}
export function printerDiagnosticRequest(db,requestId){
  const request_id=requireRequestId(requestId);
  return {recorded:!!db.prepare('SELECT id FROM lan_printer_diagnostics WHERE request_id=?').get(request_id),
    status:status(db.prepare('SELECT * FROM lan_printer_diagnostics WHERE request_id=?').get(request_id))};
}
export async function runConfiguredLanPrinterTest(db,input,actor,{run=runPrinterSelfTest,env=process.env}={}){
  if(actor?.role!=='owner'||!actor.username)throw new Error('Owner authorization required');
  if(input?.confirm!==true)throw new Error('Confirm that an Epson test-only slip may print');
  const request_id=requireRequestId(input.request_id);
  const printer=configuredLanPrinter(db,env);
  if(!printer.enabled)throw new Error('No enabled Ethernet ESC/POS printer is configured');
  const fingerprint=createHash('sha256').update(printer.host+':'+printer.port).digest('hex');
  const result=db.transaction(()=>{
    const previous=db.prepare('SELECT * FROM lan_printer_diagnostics WHERE request_id=?').get(request_id);
    if(previous){
      if(previous.printer_fingerprint!==fingerprint)
        throw new Error('The same test request ID was used for a different printer');
      return {existing:status(previous)};
    }
    const id=Number(db.prepare(`INSERT INTO lan_printer_diagnostics
      (request_id,printer_fingerprint,state,actor_username)
      VALUES(?,?,'sending',?)`).run(request_id,fingerprint,actor.username).lastInsertRowid);
    recordAudit(db,actor,'printer.diagnostic_started','printer_device',1,{
      diagnostic_id:id,printer_connection_verified:false,physical_paper_verified:false
    });
    return {existing:null};
  })();
  if(result.existing)return {...result.existing,already_recorded:true};
  try{
    await run({host:printer.host,port:printer.port,confirm:true});
    db.prepare(`UPDATE lan_printer_diagnostics
      SET state='sent_unverified',updated_at=datetime('now') WHERE request_id=?`).run(request_id);
  }catch(error){
    db.prepare(`UPDATE lan_printer_diagnostics
      SET state='uncertain',last_error=?,updated_at=datetime('now')
      WHERE request_id=?`).run(String(error.message).slice(0,250),request_id);
    throw new Error('Printer test uncertain; inspect the physical printer and cable: '+error.message);
  }
  return {...printerDiagnosticRequest(db,request_id).status,already_recorded:false};
}
