import {createHash} from 'node:crypto';
import {recordAudit} from './financial-audit.js';

// All decisions are APPEND-ONLY. They never rewrite the frozen checkout case.
export function ensureCheckoutCaseReviewSchema(db){
  db.exec("CREATE TABLE IF NOT EXISTS checkout_case_review_events ("+
    "id INTEGER PRIMARY KEY,"+
    "case_id INTEGER NOT NULL REFERENCES checkout_document_cases(id),"+
    "request_id TEXT NOT NULL UNIQUE,"+
    "fingerprint TEXT NOT NULL CHECK(length(fingerprint)=64),"+
    "status TEXT NOT NULL CHECK(status IN ('needs_source_review','reviewed_for_accountant')),"+
    "note TEXT NOT NULL CHECK(length(note) BETWEEN 10 AND 300),"+
    "source_evidence_checked INTEGER NOT NULL CHECK(source_evidence_checked IN (0,1)),"+
    "actor_id INTEGER NOT NULL,actor_username TEXT NOT NULL,"+
    "created_at TEXT NOT NULL DEFAULT (datetime('now'))"+
    ");"+
    "CREATE INDEX IF NOT EXISTS idx_checkout_case_reviews ON checkout_case_review_events(case_id,id DESC);"+
    "CREATE TRIGGER IF NOT EXISTS guard_checkout_case_review_update "+
    "BEFORE UPDATE ON checkout_case_review_events "+
    "BEGIN SELECT RAISE(ABORT,'Checkout review events cannot be updated'); END;"+
    "CREATE TRIGGER IF NOT EXISTS guard_checkout_case_review_delete "+
    "BEFORE DELETE ON checkout_case_review_events "+
    "BEGIN SELECT RAISE(ABORT,'Checkout review events cannot be deleted'); END;");
}
const safeId=(v,name)=>{
  if(!Number.isSafeInteger(v)||v<1)throw new Error('Invalid '+name);
  return v;
};
const latest=db=>db.prepare("SELECT id,case_id,request_id,status,note,source_evidence_checked,"+
  "actor_username,created_at FROM checkout_case_review_events WHERE case_id=? ORDER BY id DESC LIMIT 1");
export function checkoutCaseReviewSummary(db,caseId){
  safeId(caseId,'checkout case ID');
  const row=latest(db).get(caseId);
  return {review_status:row?.status||'held_for_review',
    latest_review:row?{id:row.id,status:row.status,note:row.note,
      source_evidence_checked:Boolean(row.source_evidence_checked),
      actor_username:row.actor_username,created_at:row.created_at}:null,
    legally_approved:false,statutory_invoice_issued:false};
}
export function listCheckoutCaseReviewEvents(db,caseId){
  safeId(caseId,'checkout case ID');
  if(!db.prepare('SELECT id FROM checkout_document_cases WHERE id=?').get(caseId))
    throw new Error('Checkout case not found');
  return {case_id:caseId,...checkoutCaseReviewSummary(db,caseId),
    history:db.prepare("SELECT id,status,note,source_evidence_checked,actor_username,created_at "+
      "FROM checkout_case_review_events WHERE case_id=? ORDER BY id DESC LIMIT 100").all(caseId)
      .map(x=>({...x,source_evidence_checked:Boolean(x.source_evidence_checked)}))};
}
export function recordCheckoutCaseReview(db,caseId,input,actor){
  safeId(caseId,'checkout case ID');
  if(!actor||!['owner','manager'].includes(actor.role)||
     !Number.isSafeInteger(actor.id)||actor.id<0||
     typeof actor.username!=='string'||!actor.username)
    throw new Error('Owner or manager review authorization required');
  if(!input||typeof input!=='object'||Array.isArray(input))
    throw new Error('Invalid review request');
  const {request_id,status,note,source_evidence_checked}=input;
  if(typeof request_id!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(request_id))
    throw new Error('Unique review request ID required');
  if(!['needs_source_review','reviewed_for_accountant'].includes(status))
    throw new Error('Choose a nonstatutory review decision');
  if(typeof note!=='string'||note.trim().length<10||note.trim().length>300)
    throw new Error('Review note must be 10-300 characters');
  if(typeof source_evidence_checked!=='boolean')
    throw new Error('Explicit source evidence confirmation is required');
  if(status==='reviewed_for_accountant'&&!source_evidence_checked)
    throw new Error('Inspect original source evidence before forwarding to accountant');
  const details={case_id:caseId,status,note:note.trim(),source_evidence_checked,
    actor_id:actor.id,actor_username:actor.username};
  const fingerprint=createHash('sha256').update(JSON.stringify(details)).digest('hex');
  return db.transaction(()=>{
    const previous=db.prepare('SELECT case_id,fingerprint FROM checkout_case_review_events WHERE request_id=?')
      .get(request_id);
    if(previous){
      if(previous.case_id!==caseId||previous.fingerprint!==fingerprint)
        throw new Error('Review request ID already used with different details');
      return {...listCheckoutCaseReviewEvents(db,caseId),already_recorded:true};
    }
    const original=db.prepare('SELECT id FROM checkout_document_cases WHERE id=?').get(caseId);
    if(!original)throw new Error('Checkout case not found');
    const current=checkoutCaseReviewSummary(db,caseId).review_status;
    if(current===status)throw new Error('This case already has that review status; no duplicate review was recorded');
    db.prepare("INSERT INTO checkout_case_review_events(case_id,request_id,fingerprint,"+
      "status,note,source_evidence_checked,actor_id,actor_username) VALUES(?,?,?,?,?,?,?,?)")
      .run(caseId,request_id,fingerprint,status,details.note,Number(source_evidence_checked),
        actor.id,actor.username);
    recordAudit(db,actor,'checkout_case.review_recorded','checkout_case',caseId,{
      review_status:status,source_evidence_checked,financial_effect:'none',
      legally_approved:false,statutory_invoice_issued:false});
    return {...listCheckoutCaseReviewEvents(db,caseId),already_recorded:false};
  })();
}
