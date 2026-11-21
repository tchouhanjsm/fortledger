import {recordAudit} from './financial-audit.js';
import {may} from './access.js';

/** Delete only never-used entries. No payment, invoice or occupancy history is erased. */
export function deleteUnusedBooking(db,id,actor){
  if(!may(actor?.role,'entries.delete'))throw new Error('Only owner can delete entries');
  if(!Number.isSafeInteger(id)||id<1)throw new Error('Invalid booking ID');
  return db.transaction(()=>{
    const booking=db.prepare('SELECT id,status,guest_name,checkin,checkout FROM bookings WHERE id=?').get(id);
    if(!booking)throw new Error('Booking not found');
    if(booking.status!=='reserved')throw new Error('Only untouched reserved bookings can be deleted. Use the audited cancellation workflow otherwise.');
    for(const [table,where] of [
      ['payments','booking_id=?'],['payment_refunds','payment_id IN (SELECT id FROM payments WHERE booking_id=?)'],
      ['invoices','booking_id=?'],['restaurant_bills','booking_id=?']
    ]){
      const exists=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
      if(exists&&db.prepare('SELECT 1 FROM '+table+' WHERE '+where+' LIMIT 1').get(id))
        throw new Error('Booking has recorded financial or restaurant history and cannot be deleted. Cancel it instead.');
    }
    // Reject any other live references rather than cascading unknown future
    // financial records. The ledger is intentionally never cascaded.
    const allowed=new Set(['booking_room_allocations','booking_create_requests']);
    const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    for(const {name} of tables){
      if(allowed.has(name))continue;
      const foreign=db.pragma('foreign_key_list("'+name.replaceAll('"','""')+'")')
        .filter(f=>f.table==='bookings');
      if(foreign.length){
        const columns=foreign.map(f=>f.from);
        for(const col of columns){
          if(db.prepare('SELECT 1 FROM "'+name.replaceAll('"','""')+'" WHERE "'+
            col.replaceAll('"','""')+'"=? LIMIT 1').get(id))
            throw new Error('Booking has linked operational history and cannot be deleted. Cancel it instead.');
        }
      }
    }
    // A used idempotency UUID must not recreate a booking on a delayed retry.
    const requests=db.prepare('SELECT request_id FROM booking_create_requests WHERE booking_id=?').all(id);
    for(const request of requests)
      db.prepare('INSERT OR IGNORE INTO deleted_booking_requests(request_id) VALUES(?)').run(request.request_id);
    db.prepare('DELETE FROM booking_create_requests WHERE booking_id=?').run(id);
    db.prepare('DELETE FROM booking_room_allocations WHERE booking_id=?').run(id);
    db.prepare('DELETE FROM bookings WHERE id=?').run(id);
    recordAudit(db,actor,'booking.deleted','booking',id,{
      previous_status:booking.status,checkin:booking.checkin,checkout:booking.checkout,
      reason:'Owner removed unused reservation'
    });
    return {ok:true,id};
  })();
}
export function deleteUnusedGuest(db,id,actor){
  if(!may(actor?.role,'entries.delete'))throw new Error('Only owner can delete entries');
  if(!Number.isSafeInteger(id)||id<1)throw new Error('Invalid guest ID');
  return db.transaction(()=>{
    const guest=db.prepare('SELECT id FROM guest_profiles WHERE id=?').get(id);
    if(!guest)throw new Error('Guest profile not found');
    if(db.prepare('SELECT 1 FROM bookings WHERE guest_id=? LIMIT 1').get(id))
      throw new Error('Guest has linked stays; unlink or correct the history instead of deleting');
    db.prepare('DELETE FROM guest_profiles WHERE id=?').run(id);
    recordAudit(db,actor,'guest.deleted','guest',id,{reason:'Owner removed unused profile'});
    return {ok:true,id};
  })();
}
