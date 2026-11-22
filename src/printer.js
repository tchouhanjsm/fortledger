import {getBusinessSettings} from './business-settings.js';
import {HOTEL_TIME_ZONE} from './hotel-clock.js';
import net from 'node:net';

export function validatePrinterAddress(host,port=9100){
  if(typeof host!=='string'||net.isIP(host)!==4)throw new Error('Printer requires private IPv4 address');
  const a=host.split('.').map(Number);
  if(!(a[0]===10||(a[0]===172&&a[1]>=16&&a[1]<=31)||(a[0]===192&&a[1]===168)||a[0]===127))
    throw new Error('Printer IP must be on a private local network');
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid printer port');
  return {host,port};
}
const clean=s=>String(s??'').normalize('NFKD').replace(/[^\x20-\x7e]/g,'?');
const money=amount=>'INR '+(amount/100).toFixed(2);
/** SQLite event instants are stored as UTC without a trailing Z. */
export function receiptLocalTime(createdAt){
  const raw=String(createdAt||'');
  if(!/^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$/.test(raw))
    throw new Error('Invalid saved restaurant receipt timestamp');
  const utc=new Date(raw.replace(' ','T')+'Z');
  if(!Number.isFinite(utc.getTime()))throw new Error('Invalid saved restaurant receipt timestamp');
  const parts=new Intl.DateTimeFormat('en-GB',{
    timeZone:HOTEL_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',hourCycle:'h23'
  }).formatToParts(utc);
  const d=Object.fromEntries(parts.filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  return d.year+'-'+d.month+'-'+d.day+' '+d.hour+':'+d.minute+' IST';
}

function aligned(a,b,width){
  const right=clean(b).slice(0,width);
  return clean(a).slice(0,Math.max(1,width-right.length-1)).padEnd(Math.max(1,width-right.length-1),' ')+' '+right+'\n';
}
export function buildReceipt(bill,width=42,{hotel_name='Garh Jaisal'}={}){
  if(![32,42,48].includes(width))throw new Error('Unsupported paper width');
  const entries=JSON.parse(bill.items_snapshot);
  const lines=['GARH JAISAL\n','RESTAURANT RECEIPT - NOT A TAX INVOICE\n',
    '-'.repeat(width)+'\n','Receipt #'+bill.id+'\n','Saved '+bill.created_at+' UTC\n',
    'Payment: '+clean(bill.payment_method).toUpperCase()+'\n','-'.repeat(width)+'\n'];
  for(const item of entries){
    lines.push(clean(item.name).slice(0,width)+'\n');
    lines.push(aligned(item.quantity+' x '+money(item.unit_price_paise),money(item.total_paise),width));
  }
  lines.push('-'.repeat(width)+'\n',aligned('Recorded tax included',money(bill.tax_paise),width),
    aligned('TOTAL',money(bill.total_paise),width),'Thank you!\n\n\n');
  return Buffer.concat([Buffer.from([0x1b,0x40]),Buffer.from(lines.join(''),'ascii')]);
}
export function sendToPrinter(payload,{host,port=9100,timeoutMs=4000}={}){
  validatePrinterAddress(host,port);
  return new Promise((resolve,reject)=>{
    const socket=net.createConnection({host,port});let completed=false;
    const done=error=>{if(completed)return;completed=true;socket.destroy();error?reject(error):resolve();};
    socket.setTimeout(timeoutMs,()=>done(new Error('Printer timed out; printing status unknown')));
    socket.on('error',done);
    socket.on('connect',()=>socket.end(payload));
    // Wait for the TCP peer to close after our FIN before completing; destroying at
    // writable 'finish' can discard outbound bytes still being transmitted.
    socket.on('close',hadError=>{if(!completed)done(hadError?new Error('Printer connection closed with error'):undefined);});
  });
}
export function ensurePrintSchema(db){
  db.exec(`CREATE TABLE IF NOT EXISTS restaurant_print_jobs(
    id INTEGER PRIMARY KEY,
    restaurant_bill_id INTEGER NOT NULL UNIQUE REFERENCES restaurant_bills(id),
    state TEXT NOT NULL CHECK(state IN('sending','sent_unverified','uncertain')),
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
}
export function getPrintStatus(db,id){
  return db.prepare('SELECT * FROM restaurant_print_jobs WHERE restaurant_bill_id=?').get(id)||null;
}
export async function printSavedBill(db,id,options,{send=sendToPrinter,reprint=false}={}){
  if(!Number.isSafeInteger(id)||id<1)throw new Error('Invalid restaurant bill ID');
  validatePrinterAddress(options?.host,options?.port??9100);
  const bill=db.prepare('SELECT * FROM restaurant_bills WHERE id=?').get(id);
  if(!bill)throw new Error('Restaurant bill not found');
  db.transaction(()=>{
    const existing=getPrintStatus(db,id);
    if(existing?.state==='sending'){
      // Transport usually ends within 4 seconds. An interrupted process can
      // leave 'sending' forever. Never silently send a duplicate: require a
      // separate staff-confirmed reprint after a conservative 10-minute age.
      const age=db.prepare("SELECT (unixepoch('now')-unixepoch(updated_at)) AS seconds FROM restaurant_print_jobs WHERE restaurant_bill_id=?")
        .get(id)?.seconds;
      if(!Number.isFinite(age)||age<600)
        throw new Error('Print is already running or its outcome is still uncertain; inspect printer before retrying');
      if(!reprint)
        throw new Error('Previously attempted; interrupted print is unverified. Inspect physical paper before explicit reprint');
    }
    if(existing&&!reprint)throw new Error('Previously attempted; explicit reprint required');
    db.prepare(`INSERT INTO restaurant_print_jobs(restaurant_bill_id,state,attempts,last_error)
      VALUES(?,'sending',1,'') ON CONFLICT(restaurant_bill_id) DO UPDATE
      SET state='sending', attempts=attempts+1,last_error='',updated_at=datetime('now')`).run(id);
  })();
  try{
    await send(buildReceipt(bill,42,getBusinessSettings(db)),options);
    db.prepare(`UPDATE restaurant_print_jobs SET state='sent_unverified', updated_at=datetime('now')
      WHERE restaurant_bill_id=?`).run(id);
    return {...getPrintStatus(db,id),notice:'Bytes sent; physical paper output is unverified'};
  }catch(error){
    db.prepare(`UPDATE restaurant_print_jobs SET state='uncertain',last_error=?,
      updated_at=datetime('now') WHERE restaurant_bill_id=?`).run(String(error.message).slice(0,250),id);
    throw new Error('Print uncertain; inspect printer before retry: '+error.message);
  }
}
