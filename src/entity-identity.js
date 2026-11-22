/** Monotonic entity IDs without rebuilding core SQLite financial tables.
 * Existing integer foreign keys remain unchanged. */
export function ensureEntityIdSchema(db){
  db.exec(`CREATE TABLE IF NOT EXISTS entity_id_counters(
    entity_type TEXT PRIMARY KEY CHECK(entity_type IN ('booking','guest')),
    last_id INTEGER NOT NULL CHECK(last_id>=0)
  );`);
  for(const [type,table] of [['booking','bookings'],['guest','guest_profiles']]){
    db.prepare(`INSERT OR IGNORE INTO entity_id_counters(entity_type,last_id)
      VALUES(?,MAX(
        COALESCE((SELECT MAX(id) FROM ${table}),0),
        COALESCE((SELECT MAX(entity_id) FROM operation_audit WHERE entity_type=?),0)
      ))`).run(type,type);
  }
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_booking_id_audit_guard AFTER INSERT ON bookings
    BEGIN
      SELECT CASE WHEN EXISTS(
        SELECT 1 FROM operation_audit WHERE entity_type='booking' AND entity_id=NEW.id
      ) THEN RAISE(ABORT,'Booking ID has prior audit history and cannot be reused') END;
      UPDATE entity_id_counters SET last_id=MAX(last_id,NEW.id) WHERE entity_type='booking';
    END;
    CREATE TRIGGER IF NOT EXISTS trg_guest_id_audit_guard AFTER INSERT ON guest_profiles
    BEGIN
      SELECT CASE WHEN EXISTS(
        SELECT 1 FROM operation_audit WHERE entity_type='guest' AND entity_id=NEW.id
      ) THEN RAISE(ABORT,'Guest ID has prior audit history and cannot be reused') END;
      UPDATE entity_id_counters SET last_id=MAX(last_id,NEW.id) WHERE entity_type='guest';
    END;
  `);
}
export function allocateEntityId(db,type){
  if(type!=='booking'&&type!=='guest')throw new Error('Unsupported audit entity ID');
  const row=db.prepare(`UPDATE entity_id_counters SET last_id=last_id+1
    WHERE entity_type=? RETURNING last_id`).get(type);
  if(!row||!Number.isSafeInteger(row.last_id)||row.last_id<1)
    throw new Error('Entity ID sequence not initialized or out of range');
  return row.last_id;
}
