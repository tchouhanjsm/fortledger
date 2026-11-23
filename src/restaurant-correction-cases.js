import {createHash} from 'node:crypto';
import {previewRestaurantCorrection} from './restaurant-correction-preview.js';
import {recordAudit} from './financial-audit.js';

// An append-only *review queue*, NOT a financial credit, refund, GST credit note,
// corrected receipt or change to an existing hotel folio.
export function ensureRestaurantCorrectionCaseSchema(db){
  db.exec(`CREATE TABLE IF NOT EXISTS restaurant_correction_cases(
    id INTEGER PRIMARY KEY,
    bill_id INTEGER NOT NULL REFERENCES restaurant_bills(id),
    request_id TEXT NOT NULL UNIQUE,
    fingerprint TEXT NOT NULL,
    proposal_json TEXT NOT NULL,
    actor_id INTEGER NOT NULL,
    actor_username TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_restaurant_correction_case_bill
    ON restaurant_correction_cases(bill_id,id);
  CREATE TABLE IF NOT EXISTS restaurant_correction_case_reviews(
    id INTEGER PRIMARY KEY,
    case_id INTEGER NOT NULL UNIQUE REFERENCES restaurant_correction_cases(id),
    request_id TEXT NOT NULL UNIQUE,
    fingerprint TEXT NOT NULL,
    disposition TEXT NOT NULL CHECK(disposition IN ('needs_accountant','dismissed')),
    note TEXT NOT NULL CHECK(length(note) BETWEEN 10 AND 300),
    actor_id INTEGER NOT NULL,
    actor_username TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
}
function actorCheck(actor,roles){
  if(!actor||!Number.isSafeInteger(actor.id)||actor.id<0||
    typeof actor.username!=='string'||!actor.username||
    !roles.includes(actor.role))throw new Error('Authenticated authorized staff required');
}
function requestKey(value){
  if(typeof value!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(value))
    throw new Error('Unique correction request_id (16–80 safe characters) required');
  return value;
}
function digest(payload){return createHash('sha256').update(JSON.stringify(payload)).digest('hex');}
function normalizeLines(lines){
  if(!Array.isArray(lines)||lines.length<1||lines.length>50)
    throw new Error('Choose original saved bill quantities for correction review');
  const seen=new Set();
  return lines.map(line=>{
    if(!line||typeof line!=='object'||Array.isArray(line)||
       !Number.isSafeInteger(line.line_index)||line.line_index<0||
       !Number.isSafeInteger(line.quantity)||line.quantity<1||
       seen.has(line.line_index))
      throw new Error('Each selected original bill line needs one valid quantity');
    seen.add(line.line_index);
    return {line_index:line.line_index,quantity:line.quantity};
  }).sort((a,b)=>a.line_index-b.line_index);
}
function trimNote(value,name){
  if(typeof value!=='string'||value.trim().length<10||value.trim().length>300)
    throw new Error(name+' must be 10–300 characters');
  return value.trim();
}
function decorate(row){
  const {proposal_json,review_id,disposition,review_note,review_actor,reviewed_at,...fields}=row;
  return {...fields,proposal:JSON.parse(proposal_json),
    status:review_id?disposition:'awaiting_owner',
    review:review_id?{id:review_id,disposition,note:review_note,
      actor_username:review_actor,created_at:reviewed_at}:null,
    gst_credit_note_issued:false,refund_sent:false,financial_adjustment_posted:false};
}
const CASE_SELECT=`SELECT c.*,r.id AS review_id,r.disposition,r.note AS review_note,
   r.actor_username AS review_actor,r.created_at AS reviewed_at
   FROM restaurant_correction_cases c LEFT JOIN restaurant_correction_case_reviews r ON r.case_id=c.id`;
function caseById(db,id){
  const row=db.prepare(CASE_SELECT+' WHERE c.id=?').get(id);
  return row?decorate(row):null;
}
export function listRestaurantCorrectionCases(db,billId){
  if(!Number.isSafeInteger(billId)||billId<1)throw new Error('Invalid saved bill ID');
  if(!db.prepare('SELECT id FROM restaurant_bills WHERE id=?').get(billId))
    throw new Error('Saved restaurant bill not found');
  return db.prepare(CASE_SELECT+' WHERE c.bill_id=? ORDER BY c.id DESC LIMIT 100')
    .all(billId).map(decorate);
}
export function restaurantCorrectionRequest(db,requestId){
  requestKey(requestId);
  const row=db.prepare('SELECT id FROM restaurant_correction_cases WHERE request_id=?').get(requestId);
  return row?{recorded:true,case:caseById(db,row.id)}:{recorded:false};
}
export function submitRestaurantCorrectionCase(db,billId,input,actor){
  actorCheck(actor,['owner','manager']);
  if(!input||typeof input!=='object'||Array.isArray(input))
    throw new Error('Invalid restaurant correction case');
  const key=requestKey(input.request_id);
  const reason=trimNote(input.reason,'Correction reason');
  const lines=normalizeLines(input.lines);
  const fingerprint=digest({bill_id:billId,reason,lines,actor_id:actor.id,actor_username:actor.username});
  return db.transaction(()=>{
    const existing=db.prepare('SELECT id,fingerprint FROM restaurant_correction_cases WHERE request_id=?').get(key);
    if(existing){
      if(existing.fingerprint!==fingerprint)
        throw new Error('Correction request ID already used with different details');
      return {...caseById(db,existing.id),already_recorded:true};
    }
    const review=previewRestaurantCorrection(db,billId,{reason,lines});
    const inserted=db.prepare(`INSERT INTO restaurant_correction_cases
      (bill_id,request_id,fingerprint,proposal_json,actor_id,actor_username)
      VALUES(?,?,?,?,?,?)`).run(billId,key,fingerprint,JSON.stringify(review),actor.id,actor.username);
    const id=Number(inserted.lastInsertRowid);
    recordAudit(db,actor,'restaurant_bill.correction_requested','restaurant_bill',billId,{
      case_id:id,request_id:key,proposed_gross_paise:review.proposed_gross_paise,
      proposed_tax_paise:review.proposed_tax_paise,financial_effect:'none'
    });
    return {...caseById(db,id),already_recorded:false};
  })();
}
export function reviewRestaurantCorrectionCase(db,caseId,input,actor){
  actorCheck(actor,['owner']);
  if(!Number.isSafeInteger(caseId)||caseId<1)throw new Error('Invalid correction case ID');
  if(!input||typeof input!=='object'||Array.isArray(input))
    throw new Error('Invalid case review');
  const key=requestKey(input.request_id);
  const disposition=input.disposition;
  if(!['needs_accountant','dismissed'].includes(disposition))
    throw new Error('Choose needs_accountant or dismissed; credits are not enabled');
  const note=trimNote(input.note,'Owner review note');
  const fingerprint=digest({case_id:caseId,disposition,note,
    actor_id:actor.id,actor_username:actor.username});
  return db.transaction(()=>{
    const previous=db.prepare('SELECT case_id,fingerprint FROM restaurant_correction_case_reviews WHERE request_id=?').get(key);
    if(previous){
      if(previous.case_id!==caseId||previous.fingerprint!==fingerprint)
        throw new Error('Review request ID already used with different details');
      return {...caseById(db,caseId),already_recorded:true};
    }
    const existing=caseById(db,caseId);
    if(!existing)throw new Error('Correction case not found');
    if(existing.review)throw new Error('Case already reviewed; original decision is immutable');
    db.prepare(`INSERT INTO restaurant_correction_case_reviews
      (case_id,request_id,fingerprint,disposition,note,actor_id,actor_username)
      VALUES(?,?,?,?,?,?,?)`).run(caseId,key,fingerprint,disposition,note,actor.id,actor.username);
    recordAudit(db,actor,'restaurant_bill.correction_reviewed','restaurant_bill',existing.bill_id,{
      case_id:caseId,request_id:key,disposition,financial_effect:'none'
    });
    return {...caseById(db,caseId),already_recorded:false};
  })();
}
