import {createHash} from 'node:crypto';
import {toPaise} from './finance.js';
import {expenseDate} from './expenses.js';
import {dailyCollections} from './daily-collections.js';
import {recordAudit} from './financial-audit.js';

export function ensureDailyCloseSchema(db){
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_closes(
      id INTEGER PRIMARY KEY,
      business_date TEXT NOT NULL UNIQUE,
      request_id TEXT NOT NULL UNIQUE,
      snapshot TEXT NOT NULL,
      snapshot_hash TEXT NOT NULL,
      opening_cash_paise INTEGER NOT NULL CHECK(opening_cash_paise>=0),
      counted_cash_paise INTEGER NOT NULL CHECK(counted_cash_paise>=0),
      expected_cash_paise INTEGER NOT NULL,
      discrepancy_paise INTEGER NOT NULL,
      note TEXT NOT NULL,
      actor_id INTEGER,
      actor_username TEXT NOT NULL,
      closed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}
function relevant(report){
  return {by_method:report.by_method,hotel_received_paise:report.hotel_received_paise,
    restaurant_received_paise:report.restaurant_received_paise,
    refunds_recorded_paise:report.refunds_recorded_paise,
    expenses_paid_paise:report.expenses_paid_paise,
    net_collections_paise:report.net_collections_paise,
    net_cash_movement_paise:report.net_cash_movement_paise,
    unrecorded_method_paise:report.unrecorded_method_paise};
}
function fingerprint(snapshot){
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}
export function createDailyClose(db,input,actor){
  if(!actor||!input||typeof input!=='object'||Array.isArray(input))throw new Error('Invalid close details');
  const day=expenseDate(input.business_date),request_id=input.request_id;
  if(typeof request_id!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(request_id))
    throw new Error('Unique closing request ID required');
  const opening=toPaise(input.opening_cash),counted=toPaise(input.counted_cash);
  const note=typeof input.note==='string'?input.note.trim():'';
  if(note.length>400)throw new Error('Close note too long');
  return db.transaction(()=>{
    const existing=db.prepare('SELECT * FROM daily_closes WHERE business_date=? OR request_id=?').get(day,request_id);
    if(existing){
      if(existing.request_id!==request_id||existing.business_date!==day||
        existing.opening_cash_paise!==opening||existing.counted_cash_paise!==counted||existing.note!==note)
        throw new Error('Daily closing already exists; amendments require a separate reviewed correction');
      return {...existing,snapshot:JSON.parse(existing.snapshot),already_recorded:true,stale:reportChanged(db,existing)};
    }
    const report=dailyCollections(db,day),snapshot=relevant(report);
    const expected=opening+report.by_method.cash.net_collected_paise-report.by_method.cash.expense_paise;
    if(!Number.isSafeInteger(expected))throw new Error('Cash total exceeds supported range');
    const discrepancy=counted-expected;
    if(discrepancy!==0&&input.acknowledge_discrepancy!==true)
      throw new Error('Cash discrepancy requires explicit operator acknowledgment');
    if(report.unrecorded_method_paise>0&&input.acknowledge_unrecorded!==true)
      throw new Error('Unrecorded legacy payment methods must be acknowledged');
    const saved=db.prepare(`INSERT INTO daily_closes(
      business_date,request_id,snapshot,snapshot_hash,opening_cash_paise,counted_cash_paise,
      expected_cash_paise,discrepancy_paise,note,actor_id,actor_username)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(day,request_id,JSON.stringify(snapshot),
      fingerprint(snapshot),opening,counted,expected,discrepancy,note,actor.id,actor.username);
    const id=Number(saved.lastInsertRowid);
    recordAudit(db,actor,'daily_close.recorded','daily_close',id,
      {business_date:day,expected_cash_paise:expected,discrepancy_paise:discrepancy});
    return {...db.prepare('SELECT * FROM daily_closes WHERE id=?').get(id),
      snapshot,already_recorded:false,stale:false};
  })();
}
function reportChanged(db,close){
  const current=relevant(dailyCollections(db,close.business_date));
  return fingerprint(current)!==close.snapshot_hash;
}
function reviewedState(db,row,currentHash){
  const last=db.prepare(`SELECT details,actor_username,created_at FROM operation_audit
    WHERE entity_type='daily_close' AND entity_id=? AND action='daily_close.reviewed'
    ORDER BY id DESC LIMIT 1`).get(row.id);
  if(!last)return {status:'needs_review'};
  const details=JSON.parse(last.details);
  if(details.live_snapshot_hash!==currentHash)return {status:'needs_review'};
  return {status:details.disposition==='investigate'?'investigating':'reviewed',
    reviewer:last.actor_username,reviewed_at:last.created_at,reason:details.reason};
}
export function getDailyClose(db,date){
  const day=expenseDate(date);
  const row=db.prepare('SELECT * FROM daily_closes WHERE business_date=?').get(day);
  if(!row)return null;
  const currentHash=fingerprint(relevant(dailyCollections(db,day)));
  const stale=currentHash!==row.snapshot_hash;
  return {...row,snapshot:JSON.parse(row.snapshot),stale,
    review:stale?reviewedState(db,row,currentHash):{status:'current'}};
}
export function reviewDailyClose(db,date,input,actor){
  if(!actor||!['owner','manager'].includes(actor.role))
    throw new Error('Only owner or manager can review a changed daily close');
  if(!input||typeof input!=='object'||Array.isArray(input))
    throw new Error('Invalid closing review');
  const day=expenseDate(date);
  const reason=String(input.reason??'').trim();
  if(reason.length<10||reason.length>300)throw new Error('Closing review reason must be 10–300 characters');
  if(!['acknowledged','investigate'].includes(input.disposition))
    throw new Error('Choose acknowledged or investigate for closing review');
  return db.transaction(()=>{
    const existing=getDailyClose(db,day);
    if(!existing)throw new Error('Daily close not found');
    if(!existing.stale)throw new Error('Daily close still agrees with the ledger; no discrepancy to review');
    const currentHash=fingerprint(relevant(dailyCollections(db,day)));
    recordAudit(db,actor,'daily_close.reviewed','daily_close',existing.id,{
      business_date:day,live_snapshot_hash:currentHash,
      original_snapshot_hash:existing.snapshot_hash,
      disposition:input.disposition,reason
    });
    return getDailyClose(db,day);
  })();
}
export function unreviewedDailyCloses(db){
  const days=db.prepare('SELECT business_date FROM daily_closes ORDER BY business_date DESC LIMIT 500').all();
  return days.map(x=>getDailyClose(db,x.business_date))
    .filter(x=>x.stale&&x.review.status!=='reviewed')
    .map(x=>({business_date:x.business_date,id:x.id,review_status:x.review.status}));
}
