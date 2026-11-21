/* Read-only reception filters; never substitutes backend booking lifecycle rules. */
export function matchesWorkQueue(booking,filter,today){
  const assigned=Array.isArray(booking.room_ids)?booking.room_ids.length:0;
  switch(filter){
    case 'arrivals':return booking.status==='reserved'&&booking.checkin===today;
    case 'departures':return booking.status==='checked_in'&&booking.checkout<=today;
    case 'unassigned':return booking.status==='reserved'&&assigned<Number(booking.rooms_count);
    case 'outstanding':return booking.status!=='cancelled'&&
      Number(booking.due_paise)>0;
    default:return true;
  }
}
