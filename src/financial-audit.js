const METHODS=['cash','upi','card','bank','unrecorded'];
export function ensureFinancialAuditSchema(db){
  const columns=new Set(db.pragma('table_info(payments)').map(x=>x.name));
  if(!columns.has('method'))
    db.exec("ALTER TABLE payments ADD COLUMN method TEXT NOT NULL DEFAULT 'unrecorded'");
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
  if(!/^[a-z][a-z_.]{2,60}$/.test(action)||!['booking','payment','refund','restaurant_bill','restaurant_settlement'].includes(entityType))
    throw new Error('Invalid audit category');
  const safe=JSON.stringify(details);
  if(safe.length>4000)throw new Error('Audit detail exceeds allowed size');
  db.prepare(`INSERT INTO operation_audit
    (action,entity_type,entity_id,actor_id,actor_username,actor_role,details)
    VALUES(?,?,?,?,?,?,?)`).run(action,entityType,entityId,
      actor.id,actor.username,actor.role,safe);
}
export function auditEvents(db,{entityType,entityId,limit=100}={}){
  if(!['booking','payment','refund','restaurant_bill','restaurant_settlement'].includes(entityType)||
     !Number.isSafeInteger(entityId)||entityId<1)
    throw new Error('Invalid audit request');
  if(!Number.isSafeInteger(limit)||limit<1||limit>200)throw new Error('Invalid audit limit');
  return db.prepare(`SELECT id,action,entity_type,entity_id,actor_id,actor_username,actor_role,details,created_at
    FROM operation_audit WHERE entity_type=? AND entity_id=? ORDER BY id DESC LIMIT ?`)
    .all(entityType,entityId,limit).map(x=>({...x,details:JSON.parse(x.details)}));
}
