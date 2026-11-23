import {createHash} from 'node:crypto';
import {recordAudit} from './financial-audit.js';

export const MAX_EXTERNAL_PDF_BYTES=8*1024*1024;

// Uploaded copies of historic online-generator PDFs; NOT FortLedger-issued invoices.
// Originals are byte-for-byte immutable BLOBs inside the one backed-up SQLite file.
export function ensureExternalInvoiceOriginalsSchema(db){
  db.exec(`CREATE TABLE IF NOT EXISTS external_invoice_originals(
    id INTEGER PRIMARY KEY,
    sha256 TEXT NOT NULL UNIQUE CHECK(length(sha256)=64),
    original_filename TEXT NOT NULL CHECK(length(original_filename) BETWEEN 1 AND 180),
    size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 64 AND 8388608),
    pdf_bytes BLOB NOT NULL,
    actor_username TEXT NOT NULL,
    imported_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK(length(pdf_bytes)=size_bytes)
  );
  CREATE INDEX IF NOT EXISTS idx_external_invoice_originals_date
    ON external_invoice_originals(id DESC);
  CREATE TRIGGER IF NOT EXISTS guard_external_pdf_original_update
    BEFORE UPDATE ON external_invoice_originals
    BEGIN SELECT RAISE(ABORT,'Historical PDF originals cannot be updated'); END;
  CREATE TRIGGER IF NOT EXISTS guard_external_pdf_original_delete
    BEFORE DELETE ON external_invoice_originals
    BEGIN SELECT RAISE(ABORT,'Historical PDF originals cannot be deleted'); END;`);
}
function nameFromHeader(name){
  if(typeof name!=='string'||name.length>700)throw new Error('A PDF filename is required');
  let decoded;
  try{decoded=decodeURIComponent(name);}catch{throw new Error('Invalid PDF filename encoding');}
  const clean=decoded.normalize('NFC').trim();
  if(!clean||clean.length>180||/[\/\\\x00-\x1f\x7f]/.test(clean)||
    clean==='.'||clean==='..'||!clean.toLowerCase().endsWith('.pdf'))
    throw new Error('Choose a PDF with a safe original filename');
  return clean;
}
function assertPdf(bytes){
  if(!Buffer.isBuffer(bytes)||bytes.length<64||bytes.length>MAX_EXTERNAL_PDF_BYTES)
    throw new Error('Original must be a PDF between 64 bytes and 8 MiB');
  if(!bytes.subarray(0,8).toString('ascii').startsWith('%PDF-')||
    !bytes.subarray(-2048).includes(Buffer.from('%%EOF')))
    throw new Error('File does not have a recognizable PDF header and trailer');
}
function recordDetails(row,already_recorded=false){
  if(!row)return null;
  return {id:row.id,original_filename:row.original_filename,sha256:row.sha256,
    size_bytes:row.size_bytes,imported_at:row.imported_at,
    status:'historical_unverified_original',invoice_number_verified:false,
    linked_to_booking:false,legal_issuance_performed:false,already_recorded};
}
export function importExternalInvoiceOriginal(db,bytes,encodedFilename,actor){
  if(!actor||actor.role!=='owner'||typeof actor.username!=='string')
    throw new Error('Only the owner can import historical invoice originals');
  const filename=nameFromHeader(encodedFilename);
  assertPdf(bytes);
  const sha256=createHash('sha256').update(bytes).digest('hex');
  return db.transaction(()=>{
    const prior=db.prepare(`SELECT id,sha256,original_filename,size_bytes,imported_at
      FROM external_invoice_originals WHERE sha256=?`).get(sha256);
    if(prior)return recordDetails(prior,true);
    const created=db.prepare(`INSERT INTO external_invoice_originals
      (sha256,original_filename,size_bytes,pdf_bytes,actor_username) VALUES(?,?,?,?,?)`)
      .run(sha256,filename,bytes.length,bytes,actor.username);
    const id=Number(created.lastInsertRowid);
    // Audit only digest and size, never guest/recipient data or PDF content.
    recordAudit(db,actor,'external_invoice_pdf.imported','external_invoice_pdf',id,{
      sha256,size_bytes:bytes.length,legal_issuance_performed:false
    });
    return recordDetails(db.prepare(`SELECT id,sha256,original_filename,size_bytes,imported_at
      FROM external_invoice_originals WHERE id=?`).get(id));
  })();
}
export function listExternalInvoiceOriginals(db,{q='',offset=0,limit=30}={}){
  if(typeof q!=='string'||q.length>100||
     !Number.isSafeInteger(offset)||offset<0||offset>20000||
     !Number.isSafeInteger(limit)||limit<1||limit>50)
    throw new Error('Invalid original-document search');
  const search=q.trim();
  const count=db.prepare(`SELECT COUNT(*) AS n FROM external_invoice_originals
    WHERE instr(lower(original_filename),lower(?))>0`).get(search).n;
  const rows=db.prepare(`SELECT id,sha256,original_filename,size_bytes,imported_at
    FROM external_invoice_originals WHERE instr(lower(original_filename),lower(?))>0
    ORDER BY id DESC LIMIT ? OFFSET ?`).all(search,limit,offset);
  return {total:count,offset,limit,items:rows.map(row=>recordDetails(row))};
}
export function lookupExternalInvoiceOriginal(db,sha){
  if(typeof sha!=='string'||!/^[a-f0-9]{64}$/.test(sha))throw new Error('Invalid SHA-256 digest');
  const row=db.prepare(`SELECT id,sha256,original_filename,size_bytes,imported_at
    FROM external_invoice_originals WHERE sha256=?`).get(sha);
  return row?{recorded:true,item:recordDetails(row)}:{recorded:false};
}
export function getExternalInvoiceOriginal(db,id){
  if(!Number.isSafeInteger(id)||id<1)throw new Error('Invalid original-document ID');
  const row=db.prepare('SELECT * FROM external_invoice_originals WHERE id=?').get(id);
  if(!row)return null;
  if(createHash('sha256').update(row.pdf_bytes).digest('hex')!==row.sha256||
     row.pdf_bytes.length!==row.size_bytes)throw new Error('Saved PDF original failed integrity verification');
  return {metadata:recordDetails(row),bytes:row.pdf_bytes};
}
