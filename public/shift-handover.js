/** Read-only, role-scoped shift handover from the already loaded hotel records.
 * No alert is a second source of booking, room or financial truth. */
export function shiftHandover({today,bookings=[],rooms=[],maintenanceIssues=[],
  restaurantBills=[],backupStatus=null,closeAttention=[],access={}}={}){
  if(typeof today!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(today)||
    !Number.isFinite(Date.parse(today+'T00:00:00Z'))||
    new Date(today+'T00:00:00Z').toISOString().slice(0,10)!==today)
    throw new Error('Valid hotel business date required');
  const tomorrow=new Date(Date.parse(today+'T00:00:00Z')+86400000).toISOString().slice(0,10);
  const alerts=[],seen=new Set();
  const add=(kind,id,title,reason,severity='normal')=>{
    const key=kind+':'+id;
    if(seen.has(key))return;
    seen.add(key);
    alerts.push({key,kind,record_id:id,title,reason,severity});
  };
  if(access.bookings){
    for(const b of bookings){
      if(!Number.isSafeInteger(b.id)||b.id<1)continue;
      const identity='Booking #'+b.id+' · '+b.guest_name;
      if(b.status==='reserved'&&b.checkin<=today)
        add('arrival',b.id,identity,
          b.checkin<today?'Arrival overdue since '+b.checkin+'; verify reservation status':
            'Arrival due today; check in only after room readiness and guest confirmation',
          b.checkin<today?'urgent':'normal');
      if(b.status==='checked_in'&&b.checkout<=today)
        add('departure',b.id,identity,
          b.checkout<today?'Departure overdue since '+b.checkout+'; review checkout and folio':
            'Departure due today; verify the guest folio before checkout',
          b.checkout<today?'urgent':'normal');
      if(b.status==='reserved'&&b.checkin<=tomorrow&&
        (Array.isArray(b.room_ids)?b.room_ids.length:0)<Number(b.rooms_count))
        add('allocation',b.id,identity,
          'Physical room allocation incomplete for '+b.checkin);
      if((b.status==='reserved'&&b.checkin<=tomorrow&&b.checkout>today||
          b.status==='checked_in'&&b.checkout>=today)&&
          (b.pickup_notes||b.stay_notes))
        add('notes',b.id,identity,
          (b.pickup_notes?'Pickup details':'Stay instructions')+
          (b.pickup_notes&&b.stay_notes?' and stay instructions':'')+
          ' recorded; review before the next guest interaction');
    }
  }
  if(access.rooms){
    for(const room of rooms){
      if(!room.active)continue;
      const state=room.housekeeping_status;
      if(state==='dirty'||state==='cleaning'||room.out_of_service_today)
        add('room',room.id,room.name,
          (state==='dirty'?'Needs cleaning':state==='cleaning'?'Cleaning in progress':
            'Housekeeping ready')+
          (room.out_of_service_today?' · Out of service today':'')+
          '; inspect and confirm readiness manually',
          room.out_of_service_today?'urgent':'normal');
    }
  }
  if(access.maintenance){
    for(const m of maintenanceIssues){
      if(m.status==='resolved'||m.priority!=='urgent')continue;
      add('maintenance',m.id,'Urgent maintenance #'+m.id,
        'Open issue for room #'+m.room_id+'; resolve through maintenance controls','urgent');
    }
  }
  if(access.restaurant){
    for(const b of restaurantBills){
      if(b.payment_method==='room'&&b.booking_id==null)
        add('restaurant',b.id,'Unmatched food bill #'+b.id,
          'Verify the guest room before linking this receivable; no payment is assumed');
    }
  }
  if(access.finance){
    for(const close of closeAttention){
      if(typeof close.business_date==='string')
        add('closing',close.business_date,'Closing review · '+close.business_date,
          'Recorded day-end snapshot changed or remains under investigation');
    }
  }
  if(access.health&&backupStatus?.needs_attention)
    add('backup','latest','Backup recovery needs review',
      'Backup health requires operator inspection; same-PC snapshots are not off-device recovery');
  const rank={urgent:0,normal:1};
  alerts.sort((a,b)=>rank[a.severity]-rank[b.severity]||
    a.kind.localeCompare(b.kind)||String(a.record_id).localeCompare(String(b.record_id),'en',{numeric:true}));
  return alerts;
}
