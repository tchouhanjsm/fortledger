import {allocateEntityId} from './entity-identity.js';
import {createHash} from 'node:crypto';
import {assertAvailability} from './database.js';
import {bookingTotals} from './finance.js';
import {recordAudit} from './financial-audit.js';

/** Append-only request ledger. Old bookings/payments are never backfilled or deduplicated. */
export function ensureBookingCreateSchema(db){
  db.exec(`CREATE TABLE IF NOT EXISTS booking_create_requests (
    request_id TEXT PRIMARY KEY,
    booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(id),
    fingerprint TEXT NOT NULL,
    response_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS deleted_booking_requests(
    request_id TEXT PRIMARY KEY,
    deleted_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
}
function requestFingerprint(booking,initialPaise,method){
  const normalized={
    guest_name:booking.guest_name,company_name:booking.company_name,
    checkin:booking.checkin,checkout:booking.checkout,rooms_count:booking.rooms_count,
    category:booking.category,meal_plan:booking.meal_plan,
    nightly_rate_paise:booking.nightly_rate_paise,guest_id:booking.guest_id,
    room_ids:[...booking.room_ids].sort((a,b)=>a-b),
    amount_paid_paise:initialPaise,advance_method:initialPaise>0?method:null
  };
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}
/** A replay is resolved before availability checks. An unchanged request never
 * creates another room hold, initial payment, or audit entry. */
export function createBookingSafely(db,{booking,initialPaise,method,requestId,actor,validateGuestLink}){
  if(requestId!==undefined&&
     (typeof requestId!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(requestId)))
    throw new Error('Invalid booking request ID');
  const fingerprint=requestId?requestFingerprint(booking,initialPaise,method):null;
  return db.transaction(()=>{
    if(requestId){
      if(db.prepare('SELECT 1 FROM deleted_booking_requests WHERE request_id=?').get(requestId))
        throw new Error('This booking request was deleted by the owner; use a new booking request to create another reservation');
      const prior=db.prepare('SELECT fingerprint,response_json FROM booking_create_requests WHERE request_id=?')
        .get(requestId);
      if(prior){
        if(prior.fingerprint!==fingerprint)
          throw new Error('Booking request ID is already used with different details');
        return {...JSON.parse(prior.response_json),already_recorded:true};
      }
    }
    validateGuestLink(db,booking.guest_id);
    assertAvailability(db,booking);
    const {room_ids,...sqlBooking}=booking;
    const id=allocateEntityId(db,'booking');
    db.prepare(`INSERT INTO bookings
      (id,guest_name,company_name,checkin,checkout,rooms_count,room_id,category,meal_plan,nightly_rate_paise,guest_id)
      VALUES (@id,@guest_name,@company_name,@checkin,@checkout,@rooms_count,@room_id,@category,@meal_plan,@nightly_rate_paise,@guest_id)`).run({...sqlBooking,id});
    const allocate=db.prepare('INSERT INTO booking_room_allocations(booking_id,room_id) VALUES(?,?)');
    for(const roomId of room_ids)allocate.run(id,roomId);
    if(initialPaise>0){
      const receipt=db.prepare('INSERT INTO payments (booking_id,amount_paise,note,method) VALUES (?,?,?,?)')
        .run(id,initialPaise,'Initial advance',method);
      recordAudit(db,actor,'payment.recorded','payment',Number(receipt.lastInsertRowid),
        {booking_id:id,amount_paise:initialPaise,method});
    }
    recordAudit(db,actor,'booking.created','booking',id,
      {checkin:booking.checkin,checkout:booking.checkout,rooms_count:booking.rooms_count,category:booking.category});
    const response={id,...bookingTotals({...booking,paid_paise:initialPaise})};
    if(requestId)db.prepare('INSERT INTO booking_create_requests(request_id,booking_id,fingerprint,response_json) VALUES(?,?,?,?)')
      .run(requestId,id,fingerprint,JSON.stringify(response));
    return {...response,already_recorded:false};
  })();
}
