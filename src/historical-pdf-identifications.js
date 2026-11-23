import {createHash} from 'node:crypto';
import {recordAudit} from './financial-audit.js';

// Owner-transcribed observations of an external PDF. Not a finding of legal
// validity, GST compliance or permission to allocate a new statutory serial.
export function ensureHistoricalPdfIdentificationSchema(db){
  db.exec(`CREATE TABLE IF NOT EXISTS historical_pdf_identifications(
    id INTEGER PRIMARY KEY,
    original_id INTEGER NOT NULL REFERENCES external_invoice_originals(id),
    request_id TEXT NOT NULL UNIQUE,
    fingerprint TEXT NOT NULL CHECK(length(fingerprint)=64),
    reported_number TEXT NOT NULL,
    number_key TEXT NOT NULL,
    reported_issue_date TEXT NOT NULL,
    reported_financial_year TEXT NOT NULL,
    booking_candidate_id INTEGER REFERENCES bookings(id),
    note TEXT NOT NULL CHECK(length(note) BETWEEN 10 AND 300),
    actor_id INTEGER,
    actor_username TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_pdf_ident_original ON
    historical_pdf_identifications(original_id,id DESC);
  CREATE INDEX IF NOT EXISTS idx_pdf_ident_number ON
    historical_pdf_identifications(reported_financial_year,number_key,original_id);
  CREATE TRIGGER IF NOT EXISTS guard_historical_pdf_ident_update
    BEFORE UPDATE ON historical_pdf_identifications
    BEGIN SELECT RAISE(ABORT,'Historical PDF identification history cannot be updated'); END;
  CREATE TRIGGER IF NOT EXISTS guard_historical_pdf_ident_delete
    BEFORE DELETE ON historical_pdf_identifications
    BEGIN SELECT RAISE(ABORT,'Historical PDF identification history cannot be deleted'); END;`);
}
function assertOwner(actor){
  if(!actor||actor.role!=='owner'||typeof actor.username!=='string'||!actor.username)
    throw new Error('Owner authorization required for historic PDF identification');
}
function validId(id,name){
  if(!Number.isSafeInteger(id)||id<1)throw new Error('Invalid '+name);
  return id;
}
function validDate(value){
  if(typeof value!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value))
    throw new Error('Use the exact date printed on the PDF (YYYY-MM-DD)');
  const time=Date.parse(value+'T00:00:00Z');
  if(!Number.isFinite(time)||new Date(time).toISOString().slice(0,10)!==value)
    throw new Error('Invalid printed invoice date');
  return value;
}
function financialYear(date){
  const [year,month]=date.split('-').map(Number);
  const start=month>=4?year:year-1;
  return String(start)+'-'+String((start+1)%100).padStart(2,'0');
}
function normalize(input){
  if(!input||typeof input!=='object'||Array.isArray(input))
    throw new Error('Invalid historical PDF identification');
  const {request_id,invoice_number,issue_date,booking_id,note}=input;
  if(typeof request_id!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(request_id))
    throw new Error('Unique request_id of 16–80 safe characters required');
  if(typeof invoice_number!=='string'||invoice_number.trim().length<1||
    invoice_number.trim().length>64||!/^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,63}$/.test(invoice_number.trim()))
    throw new Error('Enter exactly the printed invoice number (up to 64 safe characters)');
  const reported_number=invoice_number.trim();
  const reported_issue_date=validDate(issue_date);
  let booking_candidate_id=null;
  if(booking_id!==undefined&&booking_id!==null&&booking_id!==''){
    if(!Number.isSafeInteger(booking_id)||booking_id<1)
      throw new Error('Booking candidate must be a saved positive booking ID');
    booking_candidate_id=booking_id;
  }
  if(typeof note!=='string'||note.trim().length<10||note.trim().length>300)
    throw new Error('Record why this number/date was transcribed (10–300 characters)');
  return {request_id,reported_number,number_key:reported_number.toUpperCase().replace(/ +/g,''),
    reported_issue_date,reported_financial_year:financialYear(reported_issue_date),
    booking_candidate_id,note:note.trim()};
}
function decorate(row){
  if(!row)return null;
  return {id:row.id,original_id:row.original_id,
    reported_invoice_number:row.reported_number,
    reported_issue_date:row.reported_issue_date,
    reported_financial_year:row.reported_financial_year,
    booking_candidate_id:row.booking_candidate_id,
    note:row.note,actor_username:row.actor_username,
    created_at:row.created_at,
    status:'owner_transcription_unverified',
    legal_invoice_number_validated:false,
    source_pdf_text_verified:false,
    accountant_approved:false,
    statutory_issuance_enabled:false,
    length_over_16:row.reported_number.length>16,
    possible_unpermitted_characters:!/^[A-Za-z0-9/-]+$/.test(row.reported_number)};
}
function rowFor(db,id){
  return db.prepare(`SELECT id,original_id,request_id,fingerprint,reported_number,number_key,
    reported_issue_date,reported_financial_year,booking_candidate_id,note,actor_username,created_at
    FROM historical_pdf_identifications WHERE id=?`).get(id);
}
function latest(db,originalId){
  return db.prepare(`SELECT * FROM historical_pdf_identifications
    WHERE original_id=? ORDER BY id DESC LIMIT 1`).get(originalId);
}
function collisionCount(db,row){
  if(!row)return 0;
  return db.prepare(`SELECT COUNT(*) AS n FROM historical_pdf_identifications i
    WHERE i.original_id != ?
      AND i.reported_financial_year=?
      AND i.number_key=?
      AND i.id=(SELECT MAX(j.id) FROM historical_pdf_identifications j
        WHERE j.original_id=i.original_id)`).get(
          row.original_id,row.reported_financial_year,row.number_key).n;
}
export function latestHistoricalPdfIdentification(db,originalId){
  validId(originalId,'historical original ID');
  const row=latest(db,originalId);
  if(!row)return {latest:null,possible_duplicate_count:0};
  return {latest:decorate(row),possible_duplicate_count:collisionCount(db,row)};
}
export function historicalPdfIdentificationHistory(db,originalId){
  validId(originalId,'historical original ID');
  const pdf=db.prepare('SELECT id,original_filename FROM external_invoice_originals WHERE id=?')
    .get(originalId);
  if(!pdf)throw new Error('Archived historical PDF not found');
  const rows=db.prepare(`SELECT * FROM historical_pdf_identifications
    WHERE original_id=? ORDER BY id DESC LIMIT 50`).all(originalId);
  return {original_id:originalId,original_filename:pdf.original_filename,
    ...latestHistoricalPdfIdentification(db,originalId),
    history:rows.map(decorate),
    legal_invoice_issued:false};
}
export function historicalPdfIdentificationRequest(db,requestId){
  if(typeof requestId!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(requestId))
    throw new Error('Invalid historical identification request ID');
  const row=db.prepare(`SELECT id FROM historical_pdf_identifications WHERE request_id=?`)
    .get(requestId);
  return row?{recorded:true,entry:decorate(rowFor(db,row.id))}:{recorded:false};
}
export function recordHistoricalPdfIdentification(db,originalId,input,actor){
  assertOwner(actor);
  validId(originalId,'historical original ID');
  const normalized=normalize(input);
  const fingerprint=createHash('sha256').update(JSON.stringify({
    original_id:originalId,actor_id:actor.id,actor_username:actor.username,...normalized
  })).digest('hex');
  return db.transaction(()=>{
    const previous=db.prepare(`SELECT id,fingerprint FROM historical_pdf_identifications
      WHERE request_id=?`).get(normalized.request_id);
    if(previous){
      if(previous.fingerprint!==fingerprint)
        throw new Error('Request ID was used with different historical document details');
      const row=rowFor(db,previous.id);
      return {...decorate(row),possible_duplicate_count:collisionCount(db,row),
        already_recorded:true};
    }
    if(!db.prepare('SELECT id FROM external_invoice_originals WHERE id=?').get(originalId))
      throw new Error('Archived historical PDF not found');
    if(normalized.booking_candidate_id!==null&&
      !db.prepare('SELECT id FROM bookings WHERE id=?').get(normalized.booking_candidate_id))
      throw new Error('Booking candidate does not exist in the hotel ledger');
    const id=Number(db.prepare(`INSERT INTO historical_pdf_identifications
      (original_id,request_id,fingerprint,reported_number,number_key,reported_issue_date,
        reported_financial_year,booking_candidate_id,note,actor_id,actor_username)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
        originalId,normalized.request_id,fingerprint,normalized.reported_number,
        normalized.number_key,normalized.reported_issue_date,
        normalized.reported_financial_year,normalized.booking_candidate_id,
        normalized.note,actor.id,actor.username).lastInsertRowid);
    recordAudit(db,actor,'external_invoice_pdf.identified','external_invoice_pdf',originalId,{
      identification_id:id,reported_financial_year:normalized.reported_financial_year,
      has_booking_candidate:normalized.booking_candidate_id!==null,
      legal_invoice_issued:false,financial_effect:'none'
    });
    const row=rowFor(db,id);
    return {...decorate(row),possible_duplicate_count:collisionCount(db,row),
      already_recorded:false};
  })();
}
