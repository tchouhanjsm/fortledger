/** Non-mutating near-term arrival readiness cues.
 * Never claim physical check-in readiness; the booking transition server checks
 * allocations, housekeeping and overlapping maintenance again transactionally. */
export function arrivalReadinessExceptions({
  today,bookings=[],rooms=[],maintenanceIssues=[],includeMaintenance=false
}={}){
  if(typeof today!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(today)||
      !Number.isFinite(Date.parse(today+'T00:00:00Z'))||
      new Date(today+'T00:00:00Z').toISOString().slice(0,10)!==today)
    throw new Error('Valid hotel business date required');
  const tomorrow=new Date(Date.parse(today+'T00:00:00Z')+86400000).toISOString().slice(0,10);
  const byRoom=new Map(rooms.map(room=>[room.id,room]));
  const seen=new Set(),results=[];
  for(const stay of bookings){
    if(stay.status!=='reserved'||!Number.isSafeInteger(stay.id)||stay.id<1||
       stay.checkin>tomorrow||stay.checkout<=today||seen.has(stay.id))continue;
    seen.add(stay.id);
    const assigned=Array.isArray(stay.room_ids)?[...new Set(stay.room_ids)]:[];
    const problems=[];
    let firstRoomId=null;
    for(const id of assigned){
      const room=byRoom.get(id);
      if(!room){
        problems.push('Room #'+id+' is missing from active inventory');
        firstRoomId??=id;
        continue;
      }
      const reasons=[];
      if(!room.active)reasons.push('inactive');
      if(room.housekeeping_status==='dirty')reasons.push('needs cleaning');
      else if(room.housekeeping_status==='cleaning')reasons.push('cleaning in progress');
      else if(room.housekeeping_status!=='ready')reasons.push('readiness not confirmed');
      // The rooms API is a TODAY-only view. Do not infer tomorrow's block state.
      if(stay.checkin<=today&&room.out_of_service_today)reasons.push('out of service today');
      if(includeMaintenance&&maintenanceIssues.some(issue=>
        issue.room_id===id&&issue.status==='open'&&Boolean(issue.blocks_room)&&
        issue.start_date<stay.checkout&&issue.end_date>stay.checkin))
        reasons.push('maintenance overlaps booked stay');
      if(reasons.length){
        firstRoomId??=id;
        problems.push(room.name+': '+[...new Set(reasons)].join(', '));
      }
    }
    if(!problems.length)continue;
    results.push({
      booking_id:stay.id,first_room_id:firstRoomId,arrival_date:stay.checkin,
      reason:problems.join('; ')+'. Verify in Room inventory before check-in.',
      severity:stay.checkin<=today?'urgent':'normal'
    });
  }
  return results;
}
