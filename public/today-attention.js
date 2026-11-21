/* Read-only hotel work attention counts. Never equate reservation with checked-in. */
export function todayAttention({bookings=[],rooms=[],maintenanceIssues=[],restaurantBills=[],today}){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(today)))throw new Error('Valid hotel business date required');
  const arrivals=bookings.filter(b=>b.status==='reserved'&&b.checkin===today);
  const departures=bookings.filter(b=>b.status==='checked_in'&&b.checkout<=today);
  const unassigned=bookings.filter(b=>b.status==='reserved'&&
    (Array.isArray(b.room_ids)?b.room_ids.length:0)<Number(b.rooms_count));
  const unmatched=restaurantBills.filter(b=>b.payment_method==='room'&&b.booking_id==null);
  const attentionRooms=rooms.filter(r=>r.active&&
    (r.housekeeping_status==='dirty'||r.housekeeping_status==='cleaning'||Boolean(r.out_of_service_today)));
  const urgentMaintenance=maintenanceIssues.filter(m=>m.priority==='urgent'&&m.status!=='resolved');
  return {
    arrivals:arrivals.length,departures:departures.length,unassigned:unassigned.length,
    unmatched:unmatched.length,rooms:attentionRooms.length,urgentMaintenance:urgentMaintenance.length
  };
}
