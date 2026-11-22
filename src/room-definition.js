import {assertAvailability} from './database.js';
import {hotelBusinessDate} from './hotel-clock.js';
import {recordAudit} from './financial-audit.js';

/** Immediate category change for a currently uncommitted physical room.
 * No historical bookings/invoices are rewritten; all future holds are
 * revalidated against resulting room inventory inside a SQLite transaction. */
export function updateRoomDefinition(db,id,{name,category},actor,{businessDate=hotelBusinessDate()}={}){
  if(!Number.isSafeInteger(id)||id<1)throw new Error('Invalid room ID');
  if(!actor||!['owner','manager'].includes(actor.role))
    throw new Error('Only owner or manager can reclassify rooms');
  if(typeof name!=='string'||typeof category!=='string'||!name.trim()||!category.trim()||
    name.length>80||category.length>80)throw new Error('Name and category required (max 80 characters)');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(businessDate))throw new Error('Invalid business date');
  return db.transaction(()=>{
    const room=db.prepare('SELECT id,name,category,active FROM rooms WHERE id=?').get(id);
    if(!room)throw new Error('Room not found');
    if(room.category!==category.trim()){
      const active=db.prepare(`SELECT 1 FROM bookings b WHERE b.status IN ('reserved','checked_in')
        AND b.checkout>?
        AND (b.room_id=? OR EXISTS(SELECT 1 FROM booking_room_allocations a
          WHERE a.booking_id=b.id AND a.room_id=?)) LIMIT 1`).get(businessDate,id,id);
      if(active)throw new Error('Room has a future or in-house allocation; change its category only after clearing those commitments');
    }
    db.prepare('UPDATE rooms SET name=?,category=? WHERE id=?').run(name.trim(),category.trim(),id);
    if(room.category!==category.trim()){
      const future=db.prepare(`SELECT id,category,rooms_count,checkin,checkout,room_id
        FROM bookings WHERE status IN ('reserved','checked_in') AND checkout>? ORDER BY checkin,id`).all(businessDate);
      const allocations=db.prepare('SELECT room_id FROM booking_room_allocations WHERE booking_id=?');
      for(const b of future){
        assertAvailability(db,{...b,checkin:b.checkin<businessDate?businessDate:b.checkin,
          room_ids:allocations.all(b.id).map(x=>x.room_id)},b.id);
      }
    }
    recordAudit(db,actor,'room.updated','room',id,{before:{name:room.name,category:room.category},
      after:{name:name.trim(),category:category.trim()},business_date:businessDate});
    return {ok:true,id};
  })();
}
