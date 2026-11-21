import {recordAudit} from './financial-audit.js';
export const HOUSEKEEPING_STATES=['ready','dirty','cleaning'];
export function ensureHousekeepingSchema(db){
  db.exec(`
    CREATE TABLE IF NOT EXISTS room_housekeeping(
      room_id INTEGER PRIMARY KEY REFERENCES rooms(id),
      status TEXT NOT NULL DEFAULT 'ready' CHECK(status IN('ready','dirty','cleaning')),
      note TEXT NOT NULL DEFAULT '',
      updated_by TEXT NOT NULL DEFAULT 'system',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT OR IGNORE INTO room_housekeeping(room_id) SELECT id FROM rooms;
  `);
}
export function listHousekeeping(db){
  return db.prepare(`SELECT r.id AS room_id,r.name,r.category,r.active,
    h.status,h.note,h.updated_by,h.updated_at FROM rooms r
    JOIN room_housekeeping h ON h.room_id=r.id ORDER BY r.id`).all();
}
export function markRoomState(db,roomId,newState,actor,note=''){
  if(!actor||!Number.isSafeInteger(roomId)||roomId<1)throw new Error('Invalid room or staff');
  if(!HOUSEKEEPING_STATES.includes(newState))throw new Error('Invalid housekeeping state');
  if(typeof note!=='string'||note.length>250)throw new Error('Housekeeping note too long');
  return db.transaction(()=>{
    const current=db.prepare('SELECT * FROM room_housekeeping WHERE room_id=?').get(roomId);
    if(!current)throw new Error('Room not found');
    if(current.status===newState&&current.note===note.trim())
      return {room_id:roomId,status:newState,unchanged:true};
    db.prepare(`UPDATE room_housekeeping SET status=?,note=?,updated_by=?,
      updated_at=datetime('now') WHERE room_id=?`).run(newState,note.trim(),actor.username,roomId);
    recordAudit(db,actor,'housekeeping.updated','housekeeping',roomId,
      {from:current.status,to:newState,note:note.trim()});
    return {room_id:roomId,status:newState,unchanged:false};
  })();
}
export function assertRoomsReady(db,bookingId){
  const assigned=db.prepare(`SELECT a.room_id,r.name,h.status
    FROM booking_room_allocations a JOIN rooms r ON r.id=a.room_id
    JOIN room_housekeeping h ON h.room_id=a.room_id WHERE a.booking_id=?`).all(bookingId);
  const unready=assigned.filter(r=>r.status!=='ready');
  if(unready.length)throw new Error('Room not ready for check-in: '+unready.map(r=>r.name).join(', '));
  const occupied=db.prepare(`SELECT r.name FROM booking_room_allocations a
    JOIN booking_room_allocations other ON other.room_id=a.room_id AND other.booking_id!=a.booking_id
    JOIN bookings b ON b.id=other.booking_id AND b.status='checked_in'
    JOIN rooms r ON r.id=a.room_id WHERE a.booking_id=? LIMIT 1`).get(bookingId);
  if(occupied)throw new Error('Room is still occupied by another checked-in booking: '+occupied.name);
}
export function dirtyRoomsAfterCheckout(db,bookingId,actor){
  const rows=db.prepare('SELECT room_id FROM booking_room_allocations WHERE booking_id=?').all(bookingId);
  for(const row of rows){
    db.prepare(`UPDATE room_housekeeping SET status='dirty',note='',updated_by=?,
      updated_at=datetime('now') WHERE room_id=?`).run('checkout',row.room_id);
    recordAudit(db,actor,'housekeeping.checkout_dirty','housekeeping',row.room_id,{booking_id:bookingId});
  }
  return rows.length;
}
