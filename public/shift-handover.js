import {arrivalReadinessExceptions} from './arrival-readiness.js';
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
  const add=(kind,id,title,reason,severity='normal',source={})=>{
    const key=kind+':'+id;
    if(seen.has(key))return;
    seen.add(key);
    alerts.push({...source,key,kind,record_id:id,title,reason,severity});
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
  if(access.bookings&&access.rooms){
    for(const check of arrivalReadinessExceptions({
      today,bookings,rooms,
      maintenanceIssues:access.maintenance?maintenanceIssues:[],
      includeMaintenance:Boolean(access.maintenance)
    })){
      const booking=bookings.find(b=>b.id===check.booking_id);
      add('readiness',check.booking_id,'Booking #'+check.booking_id+
        ' · '+(booking?.guest_name||'Arrival'),check.reason,check.severity,
        {first_room_id:check.first_room_id});
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
          'Room '+(b.manual_room||'unverified')+
          ': verify the actual guest before linking this receivable; no payment is assumed');
    }
  }
  if(access.finance){
    for(const close of closeAttention){
      if(typeof close.business_date==='string')
        add('closing',close.business_date,'Closing review · '+close.business_date,
          'Recorded day-end snapshot changed or remains under investigation');
    }
  }
  if(access.health&&backupStatus?.needs_attention){
    const reasons={
      unconfigured:'Protected encrypted backups are not configured',
      invalid:'Encrypted backup configuration or timestamps need inspection',
      missing:'No protected encrypted backup file was found',
      stale:'Last encrypted backup is older than 36 hours',
      unavailable:'Configured backup storage could not be inspected',
      recent:'Only a same-PC emergency snapshot is available; off-device recovery is still required'
    };
    add('backup','latest','Backup recovery needs review',
      (reasons[backupStatus.state]||'Backup requires owner inspection')+
      '. A recent file alone does not prove a successful isolated restore');
  }
  const rank={urgent:0,normal:1};
  alerts.sort((a,b)=>rank[a.severity]-rank[b.severity]||
    a.kind.localeCompare(b.kind)||String(a.record_id).localeCompare(String(b.record_id),'en',{numeric:true}));
  return alerts;
}
