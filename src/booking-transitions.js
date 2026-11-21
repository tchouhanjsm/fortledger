import {NET_PAYMENTS_SQL} from './payment-ledger.js';
import {getGuestFolio} from './folio.js';
import {recordAudit} from './financial-audit.js';
import {assertRoomsReady,dirtyRoomsAfterCheckout} from './housekeeping.js';
import {assertNoMaintenanceDuringStay} from './maintenance.js';

const NEXT={
  reserved:['checked_in','cancelled'],
  checked_in:['checked_out'],
  checked_out:[],
  cancelled:[]
};
/** Never create a physical check-in from a category-only hold. */
export function transitionBooking(db,id,status,{actor,acknowledge_balance=false,reason=''}={}){
  if(!Number.isSafeInteger(id)||id<1)throw new Error('Invalid booking ID');
  if(!Object.hasOwn(NEXT,status))throw new Error('Invalid booking status');
  if(!actor)throw new Error('Authenticated actor required');
  if(typeof reason!=='string'||reason.length>300)throw new Error('Invalid transition reason');
  return db.transaction(()=>{
    const current=db.prepare(`SELECT b.id,b.status,b.rooms_count,${NET_PAYMENTS_SQL} AS paid_paise
      FROM bookings b WHERE b.id=?`).get(id);
    if(!current)throw new Error('Booking not found');
    if(status===current.status)return {ok:true,unchanged:true,warnings:[]};
    if(!NEXT[current.status].includes(status))
      throw new Error('Invalid booking transition: '+current.status+' → '+status);
    if(status==='checked_in'){
      const assigned=db.prepare('SELECT COUNT(*) AS n FROM booking_room_allocations WHERE booking_id=?').get(id).n;
      if(assigned!==current.rooms_count)
        throw new Error('Assign all '+current.rooms_count+' physical rooms before check-in (currently '+assigned+')');
      assertRoomsReady(db,id);
      assertNoMaintenanceDuringStay(db,id);
    }
    let warnings=[];
    if(status==='checked_out'){
      const folio=getGuestFolio(db,id);
      if(folio.combined_due_paise>0){
        if(acknowledge_balance!==true)
          throw new Error('Outstanding guest folio balance must be acknowledged before checkout');
        warnings.push('Guest checked out with outstanding balance that needs follow-up');
      }
    }
    if(status==='cancelled'&&current.paid_paise>0)
      warnings.push('Booking cancelled with a recorded advance; verify refund or credit separately');
    db.prepare('UPDATE bookings SET status=? WHERE id=?').run(status,id);
    if(status==='checked_out')dirtyRoomsAfterCheckout(db,id,actor);
    recordAudit(db,actor,'booking.status_changed','booking',id,
      {from:current.status,to:status,reason:reason.trim(),acknowledged_balance:status==='checked_out'&&acknowledge_balance===true});
    return {ok:true,from:current.status,to:status,warnings};
  })();
}
export function assertBookingEditAllowed(db,id,current){
  if(current.status==='cancelled'||current.status==='checked_out')
    throw new Error('Completed or cancelled bookings cannot be edited');
  if(db.prepare("SELECT 1 FROM invoices WHERE booking_id=? AND kind='proforma' LIMIT 1").get(id))
    throw new Error('Proforma already issued; booking terms are locked until an audited amendment workflow is available');
}
