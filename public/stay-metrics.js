/** Read-only hotel dashboard metrics, based on booking lifecycle and IST
 * business date. Reserved capacity is not physical occupancy. */
export function stayMetrics(bookings,today){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(today)))
    throw new Error('Valid hotel business date required');
  const live=bookings.filter(b=>b.status==='reserved'||b.status==='checked_in');
  return {
    // A booked unit is reserved capacity, regardless of guest arrival.
    booked_rooms_tonight:live.filter(b=>b.checkin<=today&&today<b.checkout)
      .reduce((n,b)=>n+Number(b.rooms_count),0),
    // In-house guests must have explicitly checked in, not simply booked dates.
    in_house_rooms:bookings.filter(b=>b.status==='checked_in')
      .reduce((n,b)=>n+Number(b.rooms_count),0),
    arrivals_pending:live.filter(b=>b.status==='reserved'&&b.checkin===today).length,
    departures_pending:live.filter(b=>b.status==='checked_in'&&b.checkout<=today).length,
    guest_outstanding_paise:live.reduce((n,b)=>n+Number(b.due_paise||0),0)
  };
}
