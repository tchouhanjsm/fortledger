/* Read-only reception filters; never substitutes backend booking lifecycle rules. */
export function matchesWorkQueue(booking,filter,today){
  const assigned=Array.isArray(booking.room_ids)?booking.room_ids.length:0;
  switch(filter){
    case 'arrivals':return booking.status==='reserved'&&booking.checkin===today;
    case 'in_house':return booking.status==='checked_in';
    case 'departures':return booking.status==='checked_in'&&booking.checkout<=today;
    case 'unassigned':return booking.status==='reserved'&&assigned<Number(booking.rooms_count);
    case 'outstanding':return booking.status!=='cancelled'&&
      Number(booking.due_paise)>0;
    default:return true;
  }
}

/** Advice only: the server remains authoritative for physical room readiness,
 * check-in dates, balances and checkout/payment transitions. */
export function bookingNextActionCue(booking,today){
  const assigned=Array.isArray(booking.room_ids)?booking.room_ids.length:0;
  if(booking.status==='checked_in'){
    if(booking.checkout<today)return 'Departure overdue · verify stay and guest folio';
    if(booking.checkout===today)return 'Departure due today · review folio before checkout';
    return 'Guest in-house · check folio and planned departure';
  }
  if(booking.status==='reserved'){
    if(assigned<Number(booking.rooms_count))
      return booking.checkin===today?'Arriving today · assign all booked rooms':
        'Room assignment incomplete · confirm before arrival';
    if(booking.checkin<today)return 'Arrival date passed · review this reservation';
    if(booking.checkin===today)return 'Arriving today · confirm room readiness before check-in';
    return 'Reserved · check room readiness before arrival';
  }
  if(booking.status==='checked_out')return 'Departed · review housekeeping and outstanding balance';
  if(booking.status==='cancelled')return 'Cancelled · refund any advance separately if required';
  return 'Review reservation status';
}
