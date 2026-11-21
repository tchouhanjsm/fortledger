import {toPaise} from './finance.js';
const METHODS=['cash','upi','card','bank','unrecorded'];
export function ensureFinancialAuditSchema(db){
  const columns=new Set(db.pragma('table_info(payments)').map(x=>x.name));
  if(!columns.has('method'))
    db.exec("ALTER TABLE payments ADD COLUMN method TEXT NOT NULL DEFAULT 'unrecorded'");
  if(!columns.has('request_id'))
    db.exec('ALTER TABLE payments ADD COLUMN request_id TEXT');
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_request_id ON payments(request_id) WHERE request_id IS NOT NULL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS operation_audit (
      id INTEGER PRIMARY KEY,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      actor_id INTEGER,
      actor_username TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      details TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_operation_audit_entity
      ON operation_audit(entity_type,entity_id,id);
  `);
}
export function paymentMethod(value,{allowLegacy=false}={}){
  if(value===undefined||value===null||value===''){
    if(allowLegacy)return 'unrecorded';
    throw new Error('Choose payment method: cash, UPI, card or bank');
  }
  if(!METHODS.includes(value)||value==='unrecorded')
    throw new Error('Choose payment method: cash, UPI, card or bank');
  return value;
}
export function recordAudit(db,actor,action,entityType,entityId,details={}){
  if(!actor||!Number.isSafeInteger(entityId)||entityId<1)
    throw new Error('Invalid audit event');
  if(!/^[a-z][a-z_.]{2,60}$/.test(action)||!['booking','payment','refund','restaurant_bill','restaurant_settlement','expense','housekeeping'].includes(entityType))
    throw new Error('Invalid audit category');
  const safe=JSON.stringify(details);
  if(safe.length>4000)throw new Error('Audit detail exceeds allowed size');
  db.prepare(`INSERT INTO operation_audit
    (action,entity_type,entity_id,actor_id,actor_username,actor_role,details)
    VALUES(?,?,?,?,?,?,?)`).run(action,entityType,entityId,
      actor.id,actor.username,actor.role,safe);
}
export function auditEvents(db,{entityType,entityId,limit=100}={}){
  if(!['booking','payment','refund','restaurant_bill','restaurant_settlement','expense','housekeeping'].includes(entityType)||
     !Number.isSafeInteger(entityId)||entityId<1)
    throw new Error('Invalid audit request');
  if(!Number.isSafeInteger(limit)||limit<1||limit>200)throw new Error('Invalid audit limit');
  return db.prepare(`SELECT id,action,entity_type,entity_id,actor_id,actor_username,actor_role,details,created_at
    FROM operation_audit WHERE entity_type=? AND entity_id=? ORDER BY id DESC LIMIT ?`)
    .all(entityType,entityId,limit).map(x=>({...x,details:JSON.parse(x.details)}));
}

/** Atomic receipt creation with replay detection. Existing old-client calls remain supported. */
export function recordHotelPayment(db,bookingId,input,actor){
  if(!Number.isSafeInteger(bookingId)||bookingId<1)throw new Error('Invalid booking ID');
  if(!actor||!input||typeof input!=='object'||Array.isArray(input))
    throw new Error('Invalid payment details');
  const amount=toPaise(input.amount);
  if(amount<=0)throw new Error('Payment must be greater than zero');
  const method=paymentMethod(input.method,{allowLegacy:true});
  const note=String(input.note||'').trim().slice(0,200);
  const request_id=input.request_id;
  if(request_id!==undefined&&
     (typeof request_id!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(request_id)))
    throw new Error('Invalid payment request ID');
  return db.transaction(()=>{
    if(request_id){
      const previous=db.prepare('SELECT id,booking_id,amount_paise,method,note FROM payments WHERE request_id=?')
        .get(request_id);
      if(previous){
        if(previous.booking_id!==bookingId||previous.amount_paise!==amount||
          previous.method!==method||previous.note!==note)
          throw new Error('Payment request ID is already used with different details');
        return {id:previous.id,already_recorded:true};
      }
    }
    const booking=db.prepare('SELECT id,status FROM bookings WHERE id=?').get(bookingId);
    if(!booking)throw new Error('Booking not found');
    if(booking.status==='cancelled')throw new Error('Cannot record payments against a cancelled booking');
    const result=db.prepare('INSERT INTO payments(booking_id,amount_paise,note,method,request_id) VALUES(?,?,?,?,?)')
      .run(bookingId,amount,note,method,request_id||null);
    const id=Number(result.lastInsertRowid);
    recordAudit(db,actor,'payment.recorded','payment',id,{booking_id:bookingId,amount_paise:amount,method});
    return {id,already_recorded:false};
  })();
}
