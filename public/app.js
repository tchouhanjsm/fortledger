import {occupiedRoomCount,monthGrid} from './calendar-utils.js';
import {VIEWS,viewForHash} from './navigation.js';
import {createWorkspaceNavigator} from './workspace-navigation.js';
import {createConfirmAction} from './ui-dialog.js';
import {matchesWorkQueue,bookingNextActionCue} from './booking-work-queue.js';
import {bookingDraftError} from './booking-editor-guards.js';
import {todayAttention} from './today-attention.js';
import {stayMetrics} from './stay-metrics.js';
const $ = selector => document.querySelector(selector);
const confirmAction=createConfirmAction($('#shizuka-confirm-dialog'));
$('#skip-to-main').onclick=()=>{
  const main=$('#workspace-main');
  main.focus({preventScroll:true});
  main.scrollIntoView({block:'start'});
};
let currentUser=null;
const can=permission=>Boolean(currentUser&&(currentUser.permissions.includes('*')||currentUser.permissions.includes(permission)));
const VIEW_ACCESS={dashboard:'profile.read',bookings:'bookings.read',rooms:'rooms.read',guests:'guests.read',invoices:'invoices.read',restaurant:'restaurant.read','business-settings':'settings.read',profile:'profile.read'};
const workspaceNavigator=createWorkspaceNavigator({win:window,doc:document,
  render:applyWorkspaceView,views:VIEWS,
  canVisit:view=>!currentUser||can(VIEW_ACCESS[view])});
function applyWorkspaceView(){
  let view=viewForHash(window.location.hash);
  if(currentUser&&!can(VIEW_ACCESS[view]))view=can('bookings.read')?'bookings':can('restaurant.read')?'restaurant':'profile';
  const config=VIEWS[view],shown=new Set(config.sections);
  for(const id of ['dashboard','stats','calendar','bookings','guests','rooms','invoices','restaurant','business-settings','roadmap','profile']){
    const panel=document.getElementById(id);
    if(panel)panel.hidden=!shown.has(id);
  }
  $('#workspace-title').textContent=config.title;
  $('#workspace-subtitle').textContent=config.subtitle;
  $('#new-booking').hidden=view!=='bookings'||!can('bookings.write');
  for(const nav of document.querySelectorAll('.sidebar nav a')){
    nav.hidden=Boolean(currentUser&&!can(VIEW_ACCESS[viewForHash(nav.getAttribute('href'))]));
    const active=viewForHash(nav.getAttribute('href'))===view;
    nav.classList.toggle('active',active);
    if(active)nav.setAttribute('aria-current','page');
    else nav.removeAttribute('aria-current');
  }
  updateMobileNavigation(view);
  window.scrollTo(0,0);
  workspaceNavigator.afterRender(view);
}
function updateMobileNavigation(view){
  const quick=$('#mobile-shortcuts'),more=$('#mobile-more-panel'),toggle=$('#mobile-more-toggle');
  if(!quick||!more||!toggle)return;
  for(const anchor of document.querySelectorAll('#mobile-shortcuts a, #mobile-more-panel a')){
    const target=anchor.dataset.view;
    anchor.hidden=Boolean(!currentUser||!can(VIEW_ACCESS[target]));
    const selected=view===target;
    anchor.classList.toggle('active',selected);
    if(selected)anchor.setAttribute('aria-current','page');
    else anchor.removeAttribute('aria-current');
  }
  const extras=[...more.querySelectorAll('a')];
  toggle.hidden=!extras.some(a=>!a.hidden);
  more.hidden=true;toggle.setAttribute('aria-expanded','false');
  quick.hidden=!currentUser;
}
$('#mobile-more-toggle').onclick=()=>{
  const panel=$('#mobile-more-panel'),toggle=$('#mobile-more-toggle');
  panel.hidden=!panel.hidden;
  toggle.setAttribute('aria-expanded',String(!panel.hidden));
};
window.addEventListener('hashchange',applyWorkspaceView);

const money = paise => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(paise/100);
const label = (tag,text,klass) => {const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(klass)e.className=klass;return e;};
const dateISO = d => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const addDays = (d,days) => { const x=new Date(d.getFullYear(),d.getMonth(),d.getDate()+days);return x; };
const fmtDay = iso => new Date(iso+'T12:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short'});
const statusOptions=['reserved','checked_in','checked_out','cancelled'];
let rooms=[],bookings=[],invoices=[],businessSettings=null,menu=[],restaurantBills=[],maintenanceIssues=[],guests=[],backupStatus=null,closeAttention=[],cart=[],editingId=null,weekStart=new Date(),calendarMode='week';
weekStart=addDays(weekStart,-((weekStart.getDay()+6)%7));
let connectionState='checking';
function setConnectionStatus(state){
  connectionState=state;
  const el=$('#connection-status');
  if(!el)return;
  el.dataset.state=state;
  el.textContent=state==='connected'?'FortLedger server reachable':
    state==='login'?'FortLedger server reachable — sign-in required':
    state==='lost'?'Connection lost — check the ledger before retrying a booking or bill':
    'Checking local server…';
}
let serverProbePending=false;
async function probeServerConnection(){
  if(serverProbePending)return;
  if(navigator.onLine===false){setConnectionStatus('lost');return;}
  serverProbePending=true;
  try{
    const response=await fetch('/api/auth/status',{method:'GET',cache:'no-store',credentials:'same-origin'});
    if(!response.ok)throw new Error('Local status endpoint unavailable');
    const state=await response.json();
    setConnectionStatus(state.authenticated===false?'login':'connected');
  }catch{setConnectionStatus('lost');}
  finally{serverProbePending=false;}
}
async function api(url,options={}){
  let response;
  try{response=await fetch(url,{headers:{'Content-Type':'application/json'},...options});}
  catch(error){setConnectionStatus('lost');throw error;}
  setConnectionStatus('connected');
  const data=await response.json();
  if(response.status===401&&url!=='/api/auth/status'){window.location.href='/login.html';throw new Error('Login required');}
  if(!response.ok)throw new Error(data.error||'Request failed');
  return data;
}
function setMessage(message){const node=$('#form-error');node.textContent=message;}
function renderBookings(){
  const q=$('#search').value.trim().toLowerCase(),list=$('#booking-list');list.replaceChildren();
  const statusFilter=$('#booking-status-filter')?.value||'all';
  const workFilter=$('#booking-work-filter')?.value||'all';
  for(const button of document.querySelectorAll('[data-booking-queue]')){
    button.setAttribute('aria-pressed',String(button.dataset.bookingQueue===workFilter));
  }
  const today=hotelToday();
  const filtered=bookings.filter(b=>
    (statusFilter==='all'||b.status===statusFilter)&&
    matchesWorkQueue(b,workFilter,today)&&
    [String(b.id),b.guest_name,b.company_name,b.category,b.assigned_room||'']
      .some(v=>String(v||'').toLowerCase().includes(q)));
  const count=$('#booking-results-count');
  count.textContent=filtered.length+' of '+bookings.length+' bookings shown'+
    (workFilter!=='all'?' · hotel date '+today:'');
  if(!filtered.length)list.append(label('p',
    bookings.length?'No bookings match these filters. Clear filters to view the ledger.':
      'No bookings yet. Create your first reservation.','muted'));
  for(const b of filtered){
    const row=label('div',undefined,'booking-row');
    const guest=label('div');guest.append(label('strong',b.guest_name),label('small',[b.company_name,b.category,b.assigned_room].filter(Boolean).join(' · ')));
    if(b.pickup_notes||b.stay_notes){
      const noteHint=label('small',(b.pickup_notes?'Pickup noted':'')+
        (b.pickup_notes&&b.stay_notes?' · ':'')+(b.stay_notes?'Stay notes':''),
        'booking-note-indicator');
      guest.append(noteHint);
    }
    const dates=label('div');dates.append(label('strong',fmtDay(b.checkin)+' → '+fmtDay(b.checkout)),label('small',b.rooms_count+' room(s) · '+b.nights+' night(s) · '+b.meal_plan));
    const stage=label('div');const status=label('select');status.setAttribute('aria-label','Booking status for '+b.guest_name);
    const possible={reserved:['reserved','checked_in','cancelled'],checked_in:['checked_in','checked_out'],
      checked_out:['checked_out'],cancelled:['cancelled']};
    for(const state of possible[b.status]||[b.status]){
      const opt=label('option',state.replaceAll('_',' '));opt.value=state;status.append(opt);
    }
    status.value=b.status;status.disabled=!can('bookings.write')||['cancelled','checked_out'].includes(b.status);
    status.onchange=async()=>{
      const next=status.value;
      const body={status:next};
      if(next==='checked_in'&&(b.room_ids||[]).length!==b.rooms_count){
        alert('Assign every booked physical room before checking in.');status.value=b.status;return;
      }
      if(next==='checked_in'&&!confirm(
        'Confirm the guest has physically arrived and the assigned room is ready for check-in?')){
        status.value=b.status;return;
      }
      const day=hotelToday();
      const offDateCheckin=next==='checked_in'&&(day<b.checkin||day>=b.checkout);
      const earlyCheckout=next==='checked_out'&&day<b.checkout;
      if(offDateCheckin||earlyCheckout){
        if(!['owner','manager'].includes(currentUser?.role)){
          alert('Only an owner or manager can approve a check-in outside stay dates or an early checkout.');
          status.value=b.status;return;
        }
        const reason=prompt((offDateCheckin?'Check-in is outside the booked stay dates.':'Guest is checking out before the booked departure date.')+
          '\\nHotel business date: '+day+' · Booked '+b.checkin+' to '+b.checkout+
          '\\nProvide a review reason of at least 10 characters:');
        if(reason===null){status.value=b.status;return;}
        if(reason.trim().length<10){alert('A date exception requires a meaningful reason.');status.value=b.status;return;}
        body.date_override=true;body.reason=reason.trim();
      }
      if(next==='checked_out'){
        if(!confirm('Confirm the guest has physically departed? Checkout will mark assigned rooms as needing cleaning.')){
          status.value=b.status;return;
        }
        try{
          const folio=await api('/api/bookings/'+b.id+'/folio');
          if(folio.invoice_discrepancy){
            alert('The saved proforma does not match this booking amount. Owner/manager review is required before checkout; the issued document was not changed.');
            status.value=b.status;return;
          }
          if(folio.combined_due_paise>0){
            if(!confirm('Guest has an outstanding folio of '+money(folio.combined_due_paise)+
              '. Confirm checkout with outstanding balance for later follow-up?')){
              status.value=b.status;return;
            }
            body.acknowledge_balance=true;
          }
        }catch(error){alert(error.message);status.value=b.status;return;}
      }
      if(next==='cancelled'){
        const reason=prompt('Reason for cancelling '+b.guest_name+'?');
        if(reason===null){status.value=b.status;return;}
        if(reason.trim().length<3){alert('Provide a short reason for the cancellation.');status.value=b.status;return;}
        if(!confirm('Cancel this reservation? This releases room inventory but does not automatically refund any advance.')){
          status.value=b.status;return;
        }
        body.reason=reason.trim();
      }
      // Persist first, refresh second. A refresh failure does not mean the
      // status transition failed or that a checkout should be attempted again.
      status.disabled=true;row.setAttribute('aria-busy','true');
      let outcome;
      try{
        outcome=await api('/api/bookings/'+b.id+'/status',{method:'PATCH',body:JSON.stringify(body)});
      }catch(error){
        status.disabled=false;row.removeAttribute('aria-busy');
        status.value=b.status;
        alert('Status change not confirmed: '+error.message+'. Refresh the booking ledger before retrying.');
        return;
      }
      try{await load();}
      catch(error){
        row.removeAttribute('aria-busy');
        alert('Booking status saved, but refresh failed: '+error.message+'. Reload to review the status.');
        return;
      }
      if(outcome.warnings?.length)alert(outcome.warnings.join('\\n'));
    };
    stage.append(status,label('small',bookingNextActionCue(b,today),'booking-next-action'));
    const due=label('div',undefined,'money');due.append(label('strong',money(b.total_paise)),label('small','Due '+money(b.due_paise)));
    const actions=label('div',undefined,'row-actions');
    const edit=label('button','Edit','secondary');edit.disabled=!can('bookings.write')||['cancelled','checked_out'].includes(b.status)||invoices.some(i=>i.booking_id===b.id);edit.onclick=()=>openEdit(b);
    const payment=label('button','+ Payment','secondary');
    payment.disabled=!can('payments.write')||b.status==='cancelled';
    payment.onclick=()=>addPayment(b);
    const history=label('button','Payments','secondary');history.onclick=()=>showPayments(b);
    const proforma=label('button','Proforma PDF','secondary');proforma.disabled=b.status==='cancelled';
    proforma.onclick=()=>createInvoice(b);
    const folioButton=label('button','Guest folio','secondary');folioButton.onclick=()=>showFolio(b);
    const refundButton=label('button','Record refund','secondary');
    refundButton.disabled=!can('refunds.write');
    refundButton.onclick=()=>recordPaymentRefund(b);
    // Three routine actions stay visible. Infrequent actions are one disclosure
    // away instead of six equally weighted controls on every reservation.
    const more=label('details',undefined,'booking-more');
    const moreTitle=label('summary','More actions');
    moreTitle.setAttribute('aria-label','More actions for booking #'+b.id);
    const moreItems=label('div',undefined,'booking-more-actions');
    const notesButton=label('button',(b.pickup_notes||b.stay_notes)?'View / edit notes':'Add pickup / stay notes','secondary');
    notesButton.type='button';
    notesButton.onclick=()=>openBookingNotes(b);
    moreItems.append(notesButton,history,refundButton,proforma);
    if(can('entries.delete')){
      const remove=label('button','Delete entry','secondary');remove.type='button';
      remove.setAttribute('aria-label','Delete unused booking #'+b.id);
      remove.onclick=async()=>{
        if(!confirm('Permanently delete unused booking #'+b.id+' for '+b.guest_name+
          '? Only untouched reservations without payments, invoices, stays or restaurant charges can be removed. This cannot be undone.'))return;
        remove.disabled=true;row.setAttribute('aria-busy','true');
        try{
          await api('/api/bookings/'+b.id,{method:'DELETE',body:JSON.stringify({})});
        }catch(error){
          alert('Booking was not deleted: '+error.message);
          remove.disabled=false;row.removeAttribute('aria-busy');return;
        }
        try{await load();}
        catch(error){alert('Booking deleted, but refresh failed: '+error.message+'. Reload to confirm.');}
      };
      moreItems.append(remove);
    }
    more.append(moreTitle,moreItems);
    actions.append(edit,payment,folioButton,more);
    row.append(guest,dates,stage,due,actions);list.append(row);
  }
  $('#stat-bookings').textContent=bookings.filter(b=>b.status!=='cancelled').length;
  $('#stat-due').textContent=money(bookings.filter(b=>b.status!=='cancelled').reduce((total,b)=>total+b.due_paise,0));
}
function renderCalendar(){
  if(calendarMode==='month'){renderMonth();return;}
  $('#calendar-week').hidden=false;$('#calendar-month').hidden=true;
  const grid=$('#calendar-grid');grid.replaceChildren();
  const days=Array.from({length:7},(_,i)=>dateISO(addDays(weekStart,i)));
  $('#week-label').textContent=fmtDay(days[0])+' – '+fmtDay(days[6]);
  const corner=label('div','ROOM / DATE','cal-heading');grid.append(corner);
  days.forEach(d=>grid.append(label('div',new Date(d+'T12:00:00').toLocaleDateString('en-IN',{weekday:'short',day:'numeric'}),'cal-heading')));
  for(const room of rooms.filter(r=>r.active)){
    grid.append(label('div',room.name,'cal-room'));
    for(const day of days){
      const matches=bookings.filter(b=>b.status!=='cancelled'&&(b.room_ids||[]).includes(room.id)&&b.checkin<=day&&day<b.checkout);
      const cell=label('div',undefined,'cal-cell');
      if(matches.length){const b=matches[0];const chip=label('button',b.guest_name,'cal-booking');chip.title=b.guest_name+' · '+b.checkin+' to '+b.checkout;chip.onclick=()=>openEdit(b);cell.append(chip);}
      else cell.append(label('span','·','cal-free'));
      grid.append(cell);
    }
  }
  const area=$('#unassigned-calendar');area.replaceChildren();
  const unassigned=bookings.filter(b=>b.status!=='cancelled'&&(b.room_ids||[]).length<b.rooms_count&&b.checkin<dateISO(addDays(weekStart,7))&&b.checkout>days[0]);
  const heading=label('h3','Category reservations awaiting room assignment');area.append(heading);
  if(!unassigned.length)area.append(label('p','None during this week.','muted'));
  for(const b of unassigned){const button=label('button',b.guest_name+' · '+(b.rooms_count-(b.room_ids||[]).length)+' unassigned × '+b.category+' · '+fmtDay(b.checkin)+' – '+fmtDay(b.checkout),'unassigned-chip');button.onclick=()=>openEdit(b);area.append(button);}
}
function renderMonth(){
  $('#calendar-week').hidden=true;
  $('#unassigned-calendar').replaceChildren();
  const grid=$('#calendar-month');grid.hidden=false;grid.replaceChildren();
  const year=weekStart.getFullYear(),month=weekStart.getMonth();
  $('#week-label').textContent=new Date(year,month,1).toLocaleDateString('en-IN',{month:'long',year:'numeric'});
  const labels=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  for(const weekday of labels)grid.append(label('div',weekday,'month-heading'));
  const inventory=rooms.filter(r=>r.active).length;
  for(const item of monthGrid(year,month)){
    const occupied=occupiedRoomCount(bookings,item.date);
    const node=label('button',undefined,'month-day'+(item.inMonth?'':' outside-month'));
    node.type='button';
    node.append(label('strong',String(item.day)),label('span',occupied+' / '+inventory+' rooms'));
    node.setAttribute('aria-label',item.date+': '+occupied+' of '+inventory+' rooms booked');
    node.onclick=()=>{weekStart=new Date(item.date+'T12:00:00');weekStart=addDays(weekStart,-((weekStart.getDay()+6)%7));setCalendarMode('week');};
    grid.append(node);
  }
}
function setCalendarMode(mode){
  calendarMode=mode;
  const button=$('#calendar-mode');
  button.textContent=mode==='week'?'Month view':'Week view';
  button.setAttribute('aria-pressed',String(mode==='month'));
  renderCalendar();
}
function renderMaintenance(){
  const workspace=$('#maintenance-workspace');
  workspace.hidden=!can('maintenance.read');
  if(!can('maintenance.read'))return;
  const form=$('#maintenance-form'),select=$('#maintenance-room'),previous=select.value;
  select.replaceChildren();
  for(const room of rooms.filter(r=>r.active)){
    const option=label('option',room.name);option.value=room.id;select.append(option);
  }
  if([...select.options].some(x=>x.value===previous))select.value=previous;
  $('#maintenance-create').hidden=!can('maintenance.write');
  $('#maintenance-block-choice').hidden=!can('maintenance.manage');
  const list=$('#maintenance-list');list.replaceChildren();
  if(!maintenanceIssues.length)list.append(label('p','No unresolved maintenance issues.','muted'));
  for(const issue of maintenanceIssues){
    const row=label('div',undefined,'maintenance-row');
    const info=label('div');
    info.append(label('strong',issue.room_name+' · '+issue.title));
    const detail=issue.priority.toUpperCase()+' · '+issue.created_by+
      (issue.blocks_room?' · OUT OF SERVICE '+issue.start_date+' to '+issue.end_date:' · Monitoring only');
    info.append(label('small',detail));
    if(issue.note)info.append(label('small',issue.note));
    row.append(info);
    if(can('maintenance.manage')){
      const resolve=label('button','Resolve / release','secondary');
      resolve.type='button';
      resolve.onclick=async()=>{
        if(!confirm('Confirm this maintenance issue is resolved and release any associated room outage?'))return;
        const resolution_note=prompt('Resolution note (optional, max 300 characters):');
        if(resolution_note===null)return;
        try{
          await api('/api/maintenance/'+issue.id+'/resolve',{method:'PATCH',
            body:JSON.stringify({resolution_note})});
          await load();
        }catch(error){$('#maintenance-message').textContent=error.message;}
      };
      row.append(resolve);
    }
    list.append(row);
  }
}
$('#maintenance-block').onchange=()=>{
  $('#maintenance-dates').hidden=!$('#maintenance-block').checked;
  const form=$('#maintenance-form');
  for(const name of ['start_date','end_date'])
    form.elements.namedItem(name).required=$('#maintenance-block').checked;
};
$('#maintenance-form').onsubmit=async event=>{
  event.preventDefault();
  const form=event.currentTarget,message=$('#maintenance-message');
  const data=Object.fromEntries(new FormData(form));
  data.room_id=Number(data.room_id);
  data.blocks_room=can('maintenance.manage')&&$('#maintenance-block').checked;
  if(!data.blocks_room){delete data.start_date;delete data.end_date;}
  const submit=form.querySelector('[type=submit]');submit.disabled=true;message.textContent='';
  try{
    await api('/api/maintenance',{method:'POST',body:JSON.stringify(data)});
    form.reset();$('#maintenance-dates').hidden=true;
    message.textContent='Maintenance issue recorded.';
    await load();
  }catch(error){message.textContent=error.message;}
  finally{submit.disabled=false;}
};
function refreshGuestPicker(selectedId=null){
  const dropdown=$('#booking-guest-profile'),selected=selectedId===null?dropdown.value:String(selectedId);
  dropdown.replaceChildren();
  const none=label('option','No linked guest profile');none.value='';dropdown.append(none);
  for(const guest of guests){
    const option=label('option',guest.name+(guest.phone?' · '+guest.phone:''));option.value=guest.id;
    dropdown.append(option);
  }
  if([...dropdown.options].some(option=>option.value===selected))dropdown.value=selected;
}
function renderGuests(){
  const list=$('#guest-list'),q=$('#guest-search').value.toLowerCase().trim();
  list.replaceChildren();
  const entries=guests.filter(g=>[g.name,g.phone,g.email,g.company_name]
    .some(value=>String(value||'').toLowerCase().includes(q)));
  if(!entries.length){list.append(label('p','No matching guest profiles. Add one above; old bookings are never auto-merged.','muted'));return;}
  for(const guest of entries){
    const row=label('div',undefined,'guest-row'),info=label('div');
    info.append(label('strong',guest.name),label('small',
      [guest.phone,guest.email,guest.company_name,guest.stay_count+' linked stay(s)'].filter(Boolean).join(' · ')));
    const actions=label('div',undefined,'guest-actions');
    const history=label('button','Stay history','secondary');history.type='button';
    history.onclick=()=>showGuestStays(guest.id);
    actions.append(history);
    if(can('guests.write')){
      const edit=label('button','Edit','secondary');edit.type='button';
      edit.onclick=()=>{
        const form=$('#guest-form');
        for(const key of ['id','name','phone','email','company_name','preferences'])
          form.elements.namedItem(key).value=guest[key]??'';
        $('#guest-create').open=true;form.elements.namedItem('name').focus();
      };
      actions.append(edit);
      const use=label('button','New booking','secondary');use.type='button';
      use.onclick=()=>{
        window.location.hash='bookings';openNew();
        refreshGuestPicker(guest.id);applyGuestSelection();
      };
      actions.append(use);
    }
    if(can('entries.delete')){
      const remove=label('button','Delete profile','secondary');remove.type='button';
      remove.disabled=guest.stay_count>0;
      remove.title=guest.stay_count>0?'Guest has linked stays and cannot be deleted':'Delete unused profile';
      remove.onclick=async()=>{
        if(!confirm('Permanently delete unused guest profile '+guest.name+'? This cannot be undone.'))return;
        remove.disabled=true;row.setAttribute('aria-busy','true');
        try{await api('/api/guests/'+guest.id,{method:'DELETE',body:JSON.stringify({})});}
        catch(error){alert('Guest profile was not deleted: '+error.message);
          remove.disabled=false;row.removeAttribute('aria-busy');return;}
        try{await load();}
        catch(error){alert('Guest deleted, but refresh failed: '+error.message+'. Reload to confirm.');}
      };
      actions.append(remove);
    }
    row.append(info,actions);list.append(row);
  }
}
async function showGuestStays(id){
  const container=$('#guest-stays');container.hidden=false;container.replaceChildren();
  try{
    const {guest,stays}=await api('/api/guests/'+id+'/stays');
    container.append(label('h3',guest.name+' · linked stays'));
    if(!stays.length)container.append(label('p','No bookings linked yet. Existing historical reservations are unchanged.','muted'));
    for(const stay of stays){
      const row=label('div',undefined,'home-activity');
      row.append(label('strong',stay.checkin+' → '+stay.checkout),
        label('span',stay.rooms_count+' room(s) · '+stay.status+' · '+stay.category));
      container.append(row);
    }
  }catch(error){container.append(label('p',error.message,'muted'));}
}
function applyGuestSelection(){
  const selected=guests.find(g=>String(g.id)===$('#booking-guest-profile').value);
  if(!selected)return;
  $('#booking-form').elements.namedItem('guest_name').value=selected.name;
  $('#booking-form').elements.namedItem('company_name').value=selected.company_name||'';
}
$('#booking-guest-profile').onchange=applyGuestSelection;
$('#guest-search').oninput=renderGuests;
$('#guest-reset').onclick=()=>{$('#guest-form').reset();$('#guest-create').open=false;$('#guest-message').textContent='';};
$('#guest-form').onsubmit=async event=>{
  event.preventDefault();
  const form=event.currentTarget,message=$('#guest-message');
  const data=Object.fromEntries(new FormData(form)),id=data.id;
  delete data.id;
  const button=form.querySelector('[type=submit]');button.disabled=true;message.textContent='';
  try{
    await api(id?'/api/guests/'+id:'/api/guests',{method:id?'PATCH':'POST',body:JSON.stringify(data)});
    form.reset();$('#guest-create').open=false;await load();
  }catch(error){message.textContent=error.message;}
  finally{button.disabled=false;}
};
let roomReadinessFilter='all';
function needsRoomAttention(room){
  return room.housekeeping_status==='dirty'||room.housekeeping_status==='cleaning'||Boolean(room.out_of_service_today);
}
function setRoomReadinessFilter(value){
  if(!['all','attention','ready'].includes(value))return;
  roomReadinessFilter=value;
  renderRooms();
}
for(const button of document.querySelectorAll('[data-room-filter]')){
  button.onclick=()=>setRoomReadinessFilter(button.dataset.roomFilter);
}
function renderRooms(){
  const list=$('#room-list');list.replaceChildren();
  for(const button of document.querySelectorAll('[data-room-filter]')){
    button.setAttribute('aria-pressed',String(button.dataset.roomFilter===roomReadinessFilter));
  }
  const visible=rooms.filter(room=>roomReadinessFilter==='all'||
    (roomReadinessFilter==='attention'?needsRoomAttention(room):
      room.housekeeping_status==='ready'&&!room.out_of_service_today));
  $('#room-readiness-count').textContent=visible.length+' of '+rooms.length+' physical rooms shown';
  if(!visible.length)list.append(label('p','No rooms match this readiness filter.','muted'));
  for(const room of visible){
    const row=label('form',undefined,'room-row');
    row.id='room-record-'+room.id;
    const name=label('input');name.value=room.name;name.maxLength=80;name.setAttribute('aria-label','Room name');
    const category=label('input');category.value=room.category;category.maxLength=80;category.setAttribute('aria-label','Room category');
    const save=label('button','Save room','secondary');save.type='submit';
    save.disabled=!can('rooms.write');
    name.disabled=!can('rooms.write');category.disabled=!can('rooms.write');
    const state=label('select');
    state.setAttribute('aria-label','Housekeeping state for '+room.name);
    for(const [value,title] of [['ready','Ready'],['dirty','Needs cleaning'],['cleaning','Cleaning']]){
      const option=label('option',title);option.value=value;state.append(option);
    }
    const originalState=room.housekeeping_status||'ready';
    state.value=originalState;
    state.disabled=!can('housekeeping.write');
    const saveState=label('button','Update housekeeping','secondary');
    saveState.type='button';saveState.disabled=true;
    const stateSummary=label('small','Current housekeeping: '+
      (originalState==='dirty'?'Needs cleaning':originalState==='cleaning'?'Cleaning':'Ready'),
      'room-state-summary');
    const updateStateButton=()=>{saveState.disabled=!can('housekeeping.write')||state.value===originalState;};
    state.onchange=updateStateButton;
    saveState.onclick=async()=>{
      if(state.value==='ready'&&room.housekeeping_status!=='ready'&&!confirm(
        'Confirm '+room.name+' is physically inspected and ready for guests?'))return;
      saveState.disabled=true;
      try{
        await api('/api/housekeeping/'+room.id,{method:'PATCH',
          body:JSON.stringify({status:state.value})});
        await load();
      }catch(error){
        alert(error.message);state.value=originalState;updateStateButton();
      }
    };
    const today=hotelToday();
    const isCheckedIn=bookings.some(b=>b.status==='checked_in' &&
      (b.room_ids||[]).includes(room.id) && b.checkin<=today);
    const operational=label('div',undefined,'room-operational-context');
    operational.append(label('strong',isCheckedIn?'Guest checked in':'No confirmed in-house guest'));
    operational.append(stateSummary);
    if(room.out_of_service_today)
      operational.append(label('small','Out of service today','room-outage-label'));
    row.append(operational,name,category,save,state,saveState);
    row.onsubmit=async e=>{e.preventDefault();try{await api('/api/rooms/'+room.id,{method:'PATCH',body:JSON.stringify({name:name.value,category:category.value})});await load();}catch(error){alert(error.message);}};
    list.append(row);
  }
  const categorySelect=$('#category-select');
  const existing=categorySelect.value;
  categorySelect.replaceChildren(...[...new Set(rooms.filter(x=>x.active).map(x=>x.category))].map(c=>{const option=label('option',c);option.value=c;return option;}));
  if([...categorySelect.options].some(o=>o.value===existing))categorySelect.value=existing;
  updateRoomOptions();
}
function updateRoomOptions(selected=[]){
  const list=$('#room-assignment-list'),category=$('#category-select').value;
  const chosen=new Set(selected.map(Number));
  list.replaceChildren();
  for(const room of rooms.filter(r=>r.active&&r.category===category)){
    const item=label('label',undefined,'room-choice');
    const checkbox=label('input');checkbox.type='checkbox';checkbox.value=room.id;checkbox.checked=chosen.has(room.id);
    item.append(checkbox,label('span',room.name+(room.out_of_service_today?' · Out of service today':'')));
    if(room.out_of_service_today&&!checkbox.checked)checkbox.disabled=true;
    list.append(item);
  }
  if(!list.children.length)list.append(label('p','Set up physical rooms for this category first.','muted'));
}
/* Asia/Kolkata is the business date even when the browser machine uses another zone. */
function hotelDateAt(instant){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
    timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(instant).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  return parts.year+'-'+parts.month+'-'+parts.day;
}
function hotelToday(){return hotelDateAt(new Date());}
/* Read-only seven-room situational awareness; statuses are intentionally independent.
   Reserved does not mean physically occupied and vacant does not mean guest-ready. */
function renderTodayRoomBoard(today){
  const panel=$('#today-room-board');
  if(!panel)return;
  panel.hidden=!can('rooms.read');
  if(!can('rooms.read'))return;
  const list=$('#today-room-cards');list.replaceChildren();
  for(const room of rooms.filter(r=>r.active)){
    const current=bookings.find(b=>b.status==='checked_in' &&
      (b.room_ids||[]).includes(room.id) && b.checkin<=today);
    const reserved=bookings.find(b=>b.status==='reserved' &&
      (b.room_ids||[]).includes(room.id) && b.checkin<=today && today<b.checkout);
    const readiness=room.housekeeping_status==='dirty'?'Needs cleaning':
      room.housekeeping_status==='cleaning'?'Cleaning':'Ready';
    const occupancy=current?'Checked in':reserved?'Reserved tonight':'No assigned stay tonight';
    const card=label('article',undefined,'today-room-card');
    if(room.out_of_service_today)card.classList.add('room-blocked');
    const head=label('div',undefined,'today-room-card-head');
    head.append(label('strong',room.name),label('span',room.category,'today-room-category'));
    card.append(head);
    card.append(label('p',occupancy,'today-room-occupancy'));
    card.append(label('p','Housekeeping: '+readiness,'today-room-readiness'));
    if(room.out_of_service_today)card.append(label('p','Out of service today','today-room-alert'));
    if(current)card.append(label('small','Guest checked in · '+current.checkout+' departure'));
    else if(reserved)card.append(label('small','Reservation scheduled; check-in not confirmed'));
    list.append(card);
  }
  if(!list.children.length)list.append(label('p','No active room records. Check inventory setup.','muted'));
}
function openFilteredBookingQueue(filter){
  $('#booking-work-filter').value=filter;
  $('#booking-status-filter').value='all';
  $('#search').value='';
  renderBookings();
  workspaceNavigator.navigate('bookings','bookings');
}
function openRoomAttention(){
  roomReadinessFilter='attention';
  renderRooms();
  workspaceNavigator.navigate('rooms','rooms');
}
function renderTodayAttention(today){
  const panel=$('#today-attention'),items=$('#today-attention-items');
  items.replaceChildren();
  const count=todayAttention({bookings:can('bookings.read')?bookings:[],
    rooms:can('rooms.read')?rooms:[],
    maintenanceIssues:can('maintenance.read')?maintenanceIssues:[],
    restaurantBills:can('restaurant.read')?restaurantBills:[],today});
  const tasks=[
    ['arrivals',count.arrivals,'Arrivals to check in','bookings.read',()=>openFilteredBookingQueue('arrivals')],
    ['departures',count.departures,'Departures due or overdue','bookings.read',()=>openFilteredBookingQueue('departures')],
    ['unassigned',count.unassigned,'Reservations awaiting room assignment','bookings.read',()=>openFilteredBookingQueue('unassigned')],
    ['rooms',count.rooms,'Rooms needing cleaning or out of service','rooms.read',openRoomAttention],
    ['urgentMaintenance',count.urgentMaintenance,'Urgent unresolved maintenance','maintenance.read',()=>{
      workspaceNavigator.navigate('rooms','maintenance-workspace');
    }],
    ['unmatched',count.unmatched,'Restaurant room charges awaiting guest verification','restaurant.read',()=>{
      restaurantBillFilter='unmatched';
      restaurantHistoryLimit=15;
      renderRestaurantHistory();
      workspaceNavigator.navigate('restaurant','restaurant-history-section');
    }]
  ];
  const shown=tasks.filter(([,n,,permission])=>n>0&&can(permission));
  panel.hidden=shown.length===0;
  for(const [,n,title,,action] of shown){
    const button=label('button',undefined,'today-attention-action secondary');
    button.type='button';
    button.append(label('strong',String(n)),label('span',title));
    button.setAttribute('aria-label',n+' '+title+'. Open existing records.');
    button.onclick=action;
    items.append(button);
  }
  if(can('system.health.read')&&backupStatus?.needs_attention){
    panel.hidden=false;
    const warning=label('button',undefined,'today-attention-action secondary');
    warning.type='button';
    warning.append(label('strong','!'),label('span','Encrypted backup needs review'));
    warning.setAttribute('aria-label',backupStatus.detail+'. Open hotel settings.');
    warning.title=backupStatus.detail+'; on the Mac run npm run doctor and recovery:drill';
    warning.onclick=()=>{window.location.hash='business-settings';};
    items.append(warning);
  }
  if(can('finance.read')&&closeAttention.length){
    panel.hidden=false;
    const warning=label('button',undefined,'today-attention-action secondary');
    warning.type='button';
    warning.append(label('strong',String(closeAttention.length)),
      label('span','Daily closings need discrepancy review'));
    warning.setAttribute('aria-label','Open financial closing review for '+closeAttention[0].business_date);
    warning.onclick=()=>{
      $('#home-closing').open=true;
      const date=$('#daily-close-form').elements.namedItem('business_date');
      date.value=closeAttention[0].business_date;
      void renderDailyClose();
      workspaceNavigator.navigate('dashboard','home-closing');
    };
    items.append(warning);
  }
}
function renderDashboard(){
  if(!currentUser)return;
  const firstName=currentUser.display_name.split(/\s+/)[0];
  const hour=new Date().getHours();
  const greeting=hour<12?'Good morning':hour<17?'Good afternoon':'Good evening';
  $('#home-welcome').textContent=greeting+', '+firstName;
  const cashier=currentUser.role==='cashier';
  $('#home-guidance').textContent=cashier?
    'Restaurant sales, guest room charges and your next action.':
    'Keep arrivals, room availability and guest balances under control.';
  const primary=$('#home-primary');
  if(can('bookings.write')){
    primary.textContent='+ New booking';primary.href='#bookings';
    primary.onclick=event=>{event.preventDefault();window.location.hash='bookings';openNew();};
  }else if(can('restaurant.write')){
    primary.textContent='+ New food bill';primary.href='#restaurant';primary.onclick=null;
  }else{primary.textContent='My profile';primary.href='#profile';primary.onclick=null;}
  const today=hotelToday();
  const todaysSales=restaurantBills.filter(b=>{
    const stamp=String(b.created_at||'').replace(' ','T')+'Z';
    return Number.isFinite(Date.parse(stamp))&&hotelDateAt(new Date(stamp))===today;
  });
  const stays=stayMetrics(bookings,today);
  const kpis=can('bookings.read')?[
    ['Booked tonight',stays.booked_rooms_tonight+' / 7','Reserved capacity, not physical occupancy'],
    ['In-house rooms',stays.in_house_rooms+' / 7','Guests actually checked in'],
    ['Arrivals pending',stays.arrivals_pending,'Reservations awaiting check-in today'],
    ['Departures pending',stays.departures_pending,'Checked-in departures due or overdue'],
    ['Outstanding',money(stays.guest_outstanding_paise),'Active guest booking balances']
  ]:[
    ['Food bills today',todaysSales.length,'Saved locally'],
    ['Gross today',money(todaysSales.reduce((n,b)=>n+b.total_paise,0)),'Recorded sales'],
    ['Menu items',menu.length,'Available to sell'],
    ['Unmatched charges',restaurantBills.filter(b=>b.payment_method==='room'&&b.booking_id===null).length,'Need guest verification']
  ];
  const grid=$('#home-kpis');grid.replaceChildren();
  for(const [name,value,note] of kpis){
    const card=label('article',undefined,'home-kpi');
    card.append(label('span',name),label('strong',String(value)),label('small',note));
    grid.append(card);
  }
  renderTodayRoomBoard(today);
  renderTodayAttention(today);
  const actions=$('#home-actions');actions.replaceChildren();
  const options=[
    ['#bookings','Booking calendar','Manage stays and room allocations','bookings.read'],
    ['#restaurant','Restaurant billing','Record food sales and print receipts','restaurant.read'],
    ['#invoices','Proforma invoices','Review and download hotel PDFs','invoices.read'],
    ['#rooms','Room inventory','See your seven accommodation units','rooms.read'],
    ['#guests','Returning guests','Profiles and linked stay history','guests.read'],
    ['#profile','My profile','Account details and staff permissions','profile.read']
  ];
  for(const [href,name,detail,permission] of options){
    if(!can(permission))continue;
    const link=label('a',undefined,'home-action');link.href=href;
    const content=label('div');content.append(label('strong',name),label('small',detail));
    link.append(content,label('span','›'));actions.append(link);
  }
  const activity=$('#home-activity');activity.replaceChildren();
  const events=can('bookings.read')?bookings.slice(0,5).map(b=>({
    title:b.guest_name,detail:b.checkin+' → '+b.checkout+' · '+b.status
  })):restaurantBills.slice(0,5).map(b=>({
    title:'Food bill #'+b.id,detail:money(b.total_paise)+' · '+b.payment_method
  }));
  if(!events.length){
    const empty=label('div',undefined,'home-empty');
    empty.append(label('strong','Nothing recorded yet'),label('p',
      can('bookings.write')?'Create your first test reservation to populate this dashboard.':
      can('restaurant.write')?'Import your menu, then save a test food bill.':'No recent activity available for your role.'));
    activity.append(empty);
  }
  for(const item of events){
    const row=label('div',undefined,'home-activity');
    row.append(label('strong',item.title),label('span',item.detail));
    activity.append(row);
  }
}
function currentHotelMonth(){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
    timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit'
  }).formatToParts(new Date()).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  const year=Number(parts.year),month=Number(parts.month);
  const next=new Date(Date.UTC(year,month,1)).toISOString().slice(0,10);
  return {start:parts.year+'-'+parts.month+'-01',end:next};
}
async function renderRoomPerformance(){
  const panel=$('#home-room-performance');
  if(!can('analytics.read')){panel.hidden=true;return;}
  panel.hidden=false;
  const form=$('#room-performance-form');
  const start=form.elements.namedItem('start'),end=form.elements.namedItem('end');
  if(!start.value||!end.value){
    const defaults=currentHotelMonth();start.value=defaults.start;end.value=defaults.end;
  }
  const grid=$('#room-performance-kpis'),status=$('#room-performance-status');
  grid.replaceChildren();status.textContent='';
  try{
    const report=await api('/api/analytics/rooms?start='+encodeURIComponent(start.value)+
      '&end='+encodeURIComponent(end.value));
    const cards=[
      ['Booked occupancy',report.booking_occupancy_percent===null?'—':
        report.booking_occupancy_percent.toFixed(2)+'%',report.booked_room_nights+' of '+
        report.available_room_nights+' room-nights'],
      ['Gross ADR',report.gross_adr_paise===null?'—':money(report.gross_adr_paise),
        'GST-inclusive value / booked room-night'],
      ['Gross RevPAR',report.gross_revpar_paise===null?'—':money(report.gross_revpar_paise),
        'GST-inclusive value / available room-night'],
      ['Booked accommodation',money(report.gross_booked_accommodation_paise),
        report.blocked_room_nights+' room-night(s) out of service']
    ];
    for(const [name,value,note] of cards){
      const card=label('article',undefined,'home-kpi');
      card.append(label('span',name),label('strong',String(value)),label('small',note));
      grid.append(card);
    }
    status.textContent='Reservation-based performance, not actual guest occupancy, tax-exclusive revenue or cash received.';
  }catch(error){status.textContent='Unable to calculate room performance: '+error.message;}
}
$('#room-performance-form').onsubmit=async event=>{
  event.preventDefault();await renderRoomPerformance();
};
async function renderCollections(){
  const panel=$('#home-collections');
  $('#home-expenses').hidden=!can('finance.write');
  $('#home-closing').hidden=!can('finance.write');
  if(!can('finance.read')){panel.hidden=true;return;}
  panel.hidden=false;
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
    timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(new Date()).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  const today=parts.year+'-'+parts.month+'-'+parts.day;
  const businessDate=$('#expense-form').elements.namedItem('business_date');
  if(!businessDate.value)businessDate.value=today;
  const closingDate=$('#daily-close-form').elements.namedItem('business_date');
  if(!closingDate.value)closingDate.value=today;
  try{
    const report=await api('/api/finance/daily?date='+today);
    $('#home-collections-net').textContent=money(report.net_collections_paise);
    $('#home-collections-note').textContent='Expenses paid '+money(report.expenses_paid_paise)+
      ' · Cash movement '+money(report.net_cash_movement_paise)+
      ' · Hotel '+money(report.hotel_received_paise)+
      ' · Restaurant '+money(report.restaurant_received_paise)+
      ' · Refunds '+money(report.refunds_recorded_paise)+
      (report.unrecorded_method_paise>0?' · METHOD REVIEW '+money(report.unrecorded_method_paise):'');
  }catch(error){
    $('#home-collections-net').textContent='Not available';
    $('#home-collections-note').textContent=error.message;
  }
}
async function renderExpenseList(){
  if(!can('finance.read'))return;
  const date=$('#expense-form').elements.namedItem('business_date').value;
  if(!date)return;
  const list=$('#expense-list');list.replaceChildren();
  try{
    const entries=await api('/api/finance/expenses?date='+encodeURIComponent(date));
    if(!entries.length){list.append(label('p','No expenses for this business date.','muted'));return;}
    for(const entry of entries){
      const row=label('div',undefined,'expense-entry');
      row.append(label('strong',money(entry.amount_paise)));
      const detail=label('div',undefined,'expense-entry-details');
      detail.append(label('span',entry.category+' · '+entry.method),
        label('small',['Payee: '+(entry.payee||'not recorded'),'Recorded by: '+entry.actor_username].join(' · ')));
      row.append(detail);list.append(row);
    }
  }catch(error){list.append(label('p','Expense history unavailable: '+error.message,'muted'));}
}
$('#expense-form').onsubmit=async event=>{
  event.preventDefault();
  const form=event.currentTarget,message=$('#expense-message'),button=form.querySelector('[type=submit]');
  const values=Object.fromEntries(new FormData(form));
  const request_id=form.dataset.pendingRequestId||crypto.randomUUID();
  form.dataset.pendingRequestId=request_id;
  button.disabled=true;message.textContent='';
  try{
    await api('/api/finance/expenses',{method:'POST',body:JSON.stringify({...values,request_id})});
    delete form.dataset.pendingRequestId;
    form.elements.namedItem('amount').value='';
    form.elements.namedItem('payee').value='';
    form.elements.namedItem('note').value='';
    message.textContent='Expense saved. No duplicate entry will be created on request retry.';
    await renderCollections();
  await renderRoomPerformance();
    await renderExpenseList();
  }catch(error){message.textContent=error.message;}
  finally{button.disabled=false;}
};
$('#expense-form').oninput=()=>{delete $('#expense-form').dataset.pendingRequestId;};
$('#expense-form').elements.namedItem('business_date').onchange=renderExpenseList;
async function renderDailyClose(){
  if(!can('finance.read'))return;
  const form=$('#daily-close-form');
  const day=form.elements.namedItem('business_date').value;
  if(!day)return;
  const summary=$('#daily-close-summary');
  const button=form.querySelector('[type=submit]');
  summary.replaceChildren();summary.classList.remove('close-stale');summary.setAttribute('role','status');button.disabled=false;
  try{
    const close=await api('/api/finance/closing?date='+encodeURIComponent(day));
    const text=close.stale?
      'WARNING: Ledger changed after this close; owner must review new transactions.':
      'Closing recorded and source values match the current ledger.';
    summary.classList.toggle('close-stale',Boolean(close.stale));
    summary.setAttribute('role',close.stale?'alert':'status');
    summary.append(label('strong',text),label('p',
      'Expected cash '+money(close.expected_cash_paise)+
      ' · Counted '+money(close.counted_cash_paise)+
      ' · Difference '+money(close.discrepancy_paise)+
      ' · By '+close.actor_username));
    summary.append(label('p','This is a recorded cash snapshot, not verified bank reconciliation.','muted'));
    if(close.stale){
      summary.append(label('p','Review: '+close.review.status+
        (close.review.reviewer?' · Last reviewed by '+close.review.reviewer:'')+
        (close.review.reason?' · '+close.review.reason:''),'muted'));
      if(can('finance.write')){
        for(const [disposition,text] of [['acknowledged','Acknowledge reviewed change'],
          ['investigate','Flag for investigation']]){
          const reviewButton=label('button',text,'secondary');
          reviewButton.type='button';
          reviewButton.onclick=async()=>{
            const reason=prompt('Provide a reason for '+disposition+' (at least 10 characters):');
            if(reason===null)return;
            if(reason.trim().length<10){alert('Provide a meaningful review reason.');return;}
            if(!confirm('Record immutable review of the changed close for '+day+
              '? This does not change the original closing or money ledger.'))return;
            reviewButton.disabled=true;
            try{
              await api('/api/finance/closing/review',{method:'POST',body:JSON.stringify({
                business_date:day,disposition,reason:reason.trim()
              })});
              await load();
              await renderDailyClose();
            }catch(error){
              $('#daily-close-message').textContent=error.message;
              reviewButton.disabled=false;
            }
          };
          summary.append(reviewButton);
        }
      }
    }
    button.disabled=true;
  }catch(error){
    if(/No closing recorded/.test(error.message))summary.append(label('p','No close recorded for this date.','muted'));
    else summary.append(label('p',error.message,'muted'));
  }
}
$('#daily-close-form').onsubmit=async event=>{
  event.preventDefault();
  const form=event.currentTarget,message=$('#daily-close-message'),
    button=form.querySelector('[type=submit]');
  if(!confirm('Record final day closing? Existing closing entries cannot be edited or silently overwritten.'))return;
  const input=Object.fromEntries(new FormData(form));
  const request_id=form.dataset.pendingRequestId||crypto.randomUUID();
  form.dataset.pendingRequestId=request_id;
  input.request_id=request_id;
  input.acknowledge_discrepancy=form.elements.namedItem('acknowledge_discrepancy').checked;
  input.acknowledge_unrecorded=form.elements.namedItem('acknowledge_unrecorded').checked;
  button.disabled=true;message.textContent='';
  try{
    await api('/api/finance/closing',{method:'POST',body:JSON.stringify(input)});
    delete form.dataset.pendingRequestId;
    message.textContent='Day closing recorded. Verify cash and electronic payments against actual records.';
    await renderDailyClose();
  }catch(error){message.textContent=error.message;button.disabled=false;}
};
$('#daily-close-form').oninput=()=>{delete $('#daily-close-form').dataset.pendingRequestId;};
$('#daily-close-form').elements.namedItem('business_date').onchange=renderDailyClose;
// Multiple refreshes can overlap with a saved booking/room update. Only the
// latest complete response is allowed to replace the displayed hotel ledger.
let workspaceLoadRevision=0;
async function load(){
  const revision=++workspaceLoadRevision;
  const operator=await api('/api/me');
  const allowed=permission=>Boolean(operator&&(operator.permissions.includes('*')||operator.permissions.includes(permission)));
  const snapshot=await Promise.all([
    allowed('rooms.read')?api('/api/rooms'):Promise.resolve([]),
    allowed('bookings.read')?api('/api/bookings'):allowed('restaurant.read')?api('/api/restaurant/checked-in'):Promise.resolve([]),
    allowed('invoices.read')?api('/api/invoices'):Promise.resolve([]),
    allowed('settings.read')?api('/api/settings/business'):Promise.resolve(null),
    allowed('restaurant.read')?api('/api/restaurant/menu'):Promise.resolve([]),
    allowed('restaurant.read')?api('/api/restaurant/bills'):Promise.resolve([]),
    allowed('maintenance.read')?api('/api/maintenance'):Promise.resolve([]),
    allowed('guests.read')?api('/api/guests'):Promise.resolve([]),
    allowed('system.health.read')?api('/api/system/backup-status'):Promise.resolve(null),
    allowed('finance.read')?api('/api/finance/closing/attention'):Promise.resolve([])
  ]);
  if(revision!==workspaceLoadRevision)return false;
  currentUser=operator;
  [rooms,bookings,invoices,businessSettings,menu,restaurantBills,maintenanceIssues,guests,backupStatus,closeAttention]=snapshot;
  renderMenu();refreshRestaurantGuestPicker();renderCart();renderRestaurantHistory();
  if(businessSettings){
    for(const [key,value] of Object.entries(businessSettings)){
      const field=$('#business-form').elements.namedItem(key);if(field)field.value=value;
    }
  }
  if(can('bookings.read')){renderBookings();renderCalendar();}
  if(can('rooms.read')){renderRooms();renderMaintenance();}
  if(can('guests.read')){renderGuests();refreshGuestPicker();}
  if(can('invoices.read'))renderInvoices();
  if(can('settings.read'))await refreshHotelLogo();
  $('#backup-button').hidden=!can('settings.admin');
  $('#save-restaurant-bill').hidden=!can('restaurant.write');
  $('#restaurant-reconciliation-section').hidden=!can('finance.read');
  if(!$('#restaurant-reconciliation-date').value)
    $('#restaurant-reconciliation-date').value=hotelToday();
  $('#menu-import-section').hidden=!can('menu.manage');
  $('#restaurant-jump-menu').hidden=!can('menu.manage');
  $('#import-menu').hidden=!can('menu.manage');
  $('#preview-menu').hidden=!can('menu.manage');
  $('#staff-admin').hidden=currentUser.role!=='owner';
  $('#update-center').hidden=!can('system.update');
  $('#guest-create').hidden=!can('guests.write');
  const settingsSave=$('#business-form').querySelector('[type=submit]');
  if(settingsSave)settingsSave.disabled=!can('settings.admin');
  await renderProfile();
  renderDashboard();
  await renderCollections();
  if(can('finance.read')){await renderExpenseList();await renderDailyClose();}
  $('#invoice-empty-action').hidden=Boolean(invoices.length)||!can('bookings.read');
  if(!menu.length&&can('menu.manage'))$('#menu-import-section').open=true;
  applyWorkspaceView();
  return true;
}
function renderInvoices(){
  const picker=$('#invoice-booking-select');picker.replaceChildren();
  const first=label('option','Select a reservation');first.value='';picker.append(first);
  const available=bookings.filter(b=>b.status!=='cancelled'&&!invoices.some(i=>i.booking_id===b.id));
  for(const booking of available){
    const option=label('option','#'+booking.id+' · '+booking.guest_name+' · '+booking.checkin);
    option.value=String(booking.id);picker.append(option);
  }
  $('#invoice-create-proforma').disabled=!can('invoices.write')||!available.length;
  $('#invoice-new-booking').disabled=!can('bookings.write')||!can('invoices.write');
  const list=$('#invoice-list');list.replaceChildren();
  if(!invoices.length)list.append(label('p','No proformas yet. Create one above without leaving Invoices.','muted'));
  for(const inv of invoices){
    const row=label('div',undefined,'invoice-row');
    const name=label('div');name.append(label('strong',inv.number),label('small',inv.snapshot.guest_name+' · '+inv.snapshot.issued_on));
    const sum=label('strong',money(inv.snapshot.total_paise));
    const link=label('a','Download PDF','secondary');link.href='/api/invoices/'+inv.id+'/pdf';link.setAttribute('download','');
    const taxDraft=label('button','Tax draft','secondary');taxDraft.onclick=()=>openTaxDraft(inv);
    row.append(name,sum,link,taxDraft);list.append(row);
  }
}
let activeTaxProforma=null;
function openTaxDraft(invoice){
  activeTaxProforma=invoice;
  const form=$('#tax-draft-form');form.reset();
  form.elements.namedItem('recipient_address').value=invoice.snapshot.bill_to_address||'';
  const list=$('#tax-draft-sac-list');list.replaceChildren();
  const lines=invoice.snapshot.lines?.length?invoice.snapshot.lines:[{
    description:invoice.snapshot.category+' - '+invoice.snapshot.meal_plan+' basis'
  }];
  for(const line of lines){
    const row=label('label',undefined,'tax-sac-row');
    row.append(label('span',line.description));
    const select=label('select');select.name='sac_codes';
    for(const [value,title] of [['996311','Hotel room accommodation (996311)'],['996312','Campsite accommodation (996312)']]){
      const option=label('option',title);option.value=value;select.append(option);
    }
    row.append(select);list.append(row);
  }
  $('#tax-draft-message').textContent='';
  $('#tax-draft-dialog').showModal();
}
$('#close-tax-draft').onclick=()=>$('#tax-draft-dialog').close();
$('#cancel-tax-draft').onclick=()=>$('#tax-draft-dialog').close();
$('#tax-draft-form').onsubmit=async event=>{
  event.preventDefault();
  const form=event.currentTarget,button=form.querySelector('[type=submit]'),message=$('#tax-draft-message');
  button.disabled=true;message.textContent='';
  try{
    const input={
      recipient_address:form.elements.namedItem('recipient_address').value,
      recipient_gstin:form.elements.namedItem('recipient_gstin').value,
      signatory_name:form.elements.namedItem('signatory_name').value,
      sac_codes:[...document.querySelectorAll('#tax-draft-sac-list select')].map(x=>x.value)
    };
    const draft=await api('/api/invoices/'+activeTaxProforma.id+'/tax-draft',
      {method:'POST',body:JSON.stringify(input)});
    $('#tax-draft-dialog').close();
    window.location.href='/api/tax-drafts/'+draft.id+'/pdf';
    alert('DRAFT ONLY. The document is not legally issued. Remaining blockers: '+draft.snapshot.readiness.blockers.join('; '));
  }catch(error){message.textContent=error.message;}
  finally{button.disabled=false;}
};
async function renderProfile(){
  if(!currentUser)return;
  $('#profile-name').textContent=currentUser.display_name;
  $('#profile-role').textContent=currentUser.role==='frontdesk'?'Front desk':currentUser.role==='cashier'?'Restaurant cashier':
    currentUser.role==='owner'?'Owner / administrator':'Hotel manager';
  $('#profile-username').textContent='@'+currentUser.username+' · Local staff account';
  $('#profile-avatar').textContent=currentUser.display_name.trim().split(/\s+/).slice(0,2).map(x=>x[0]?.toUpperCase()||'').join('');
  $('#profile-form').elements.namedItem('display_name').value=currentUser.display_name;
  const perms=$('#profile-permissions');perms.replaceChildren();
  const labels=currentUser.permissions.includes('*')?['Full owner access']:currentUser.permissions.map(p=>p.replaceAll('.',' · '));
  for(const perm of labels)perms.append(label('span',perm,'permission-pill'));
  if(currentUser.role==='owner'){
    const staff=await api('/api/staff');
    const list=$('#staff-list');list.replaceChildren();
    if(!staff.length)list.append(label('p','No staff accounts yet. Add your first staff member below.','muted'));
    for(const user of staff){
      const row=label('div',undefined,'staff-row');
      const detail=label('div');
      detail.append(label('strong',user.display_name),label('small','@'+user.username+' · '+user.role+' · '+(user.active?'Active':'Disabled')));
      const roleSelect=label('select');
      roleSelect.setAttribute('aria-label','Role for '+user.display_name);
      for(const [value,title] of [['manager','Manager'],['frontdesk','Front desk'],['cashier','Cashier']]){
        const opt=label('option',title);opt.value=value;roleSelect.append(opt);
      }
      roleSelect.value=user.role;
      roleSelect.onchange=async()=>{
        if(!confirm('Change role for '+user.display_name+' to '+roleSelect.value+'?')){
          roleSelect.value=user.role;return;
        }
        try{
          await api('/api/staff/'+user.id,{method:'PATCH',body:JSON.stringify({role:roleSelect.value})});
          await renderProfile();
        }catch(error){roleSelect.value=user.role;$('#staff-message').textContent=error.message;}
      };
      const toggle=label('button',user.active?'Disable':'Enable','secondary');
      toggle.onclick=async()=>{
        if(!confirm((user.active?'Disable':'Enable')+' account for '+user.display_name+'?'))return;
        try{
          await api('/api/staff/'+user.id,{method:'PATCH',body:JSON.stringify({active:!user.active})});
          await renderProfile();
        }catch(error){$('#staff-message').textContent=error.message;}
      };
      row.append(detail,roleSelect,toggle);list.append(row);
    }
  }
}
let approvedUpdateSha=null,installerDownloadUrl=null;
$('#update-center-download').onclick=()=>{
  if(!can('system.update')||!installerDownloadUrl)return;
  // User-initiated host action, never an automatic executable download/run.
  window.open(installerDownloadUrl,'_blank','noopener,noreferrer');
};
$('#update-center-check').onclick=async()=>{
  if(!can('system.update'))return;
  const button=$('#update-center-check'),message=$('#update-center-state');
  const versions=$('#update-center-versions');
  button.disabled=true;message.textContent='Checking installation status…';
  versions.textContent='';
  approvedUpdateSha=null;installerDownloadUrl=null;
  $('#update-center-download').hidden=true;
  $('#update-center-readiness').hidden=true;
  $('#update-center-install').hidden=true;
  $('#update-center-install').disabled=true;
  try{
    const state=await api('/api/system/updates');
    message.textContent=state.message;
    message.dataset.state=state.state;
    const short=sha=>/^[a-f0-9]{12}$/i.test(sha||'')?sha:'Unavailable';
    const installerManaged=state.state==='installer_managed';
    versions.textContent=installerManaged?'Windows desktop installer distribution':(
      'Installed: '+short(state.current)+' · GitHub main: '+short(state.remote));
    $('#update-center-desktop').hidden=!['installer_managed','installer_update_available','installer_check_unavailable'].includes(state.state);
    const verifiedUrl=/^https:\/\/github\.com\/tchouhanjsm\/fortledger\/actions\/runs\/[0-9]+\/artifacts\/[0-9]+$/.test(state.download_url||'');
    if(state.platform==='windows'&&state.state==='installer_update_available'&&state.available===true&&verifiedUrl){
      installerDownloadUrl=state.download_url;
      $('#update-center-download').hidden=false;
    }
    $('#update-center-windows').hidden=state.platform!=='windows'||installerManaged;
    $('#update-center-mac').hidden=state.platform!=='mac';
    if(state.platform==='windows'&&state.state==='new_revision'){
      const readiness=await api('/api/system/updates/readiness');
      const panel=$('#update-center-readiness'),list=$('#update-center-blockers');
      panel.hidden=false;list.replaceChildren();
      for(const blocker of readiness.blockers||[])list.append(label('li',blocker));
      const ready=Boolean(readiness.ready)&&
        /^[a-f0-9]{40}$/i.test(readiness.target_sha||'');
      $('#update-center-readiness-status').textContent=ready?
        'Verified GitHub commit, protected backup configuration and external supervisor are ready.':
        'Automatic installation is blocked until the listed safety checks pass.';
      if(ready){
        approvedUpdateSha=readiness.target_sha;
        $('#update-center-install').hidden=false;
        $('#update-center-install').disabled=false;
        const ci=$('#update-center-ci');ci.replaceChildren();
        if(/^https:\/\/github\.com\/tchouhanjsm\/fortledger\/actions\/runs\/[0-9]+$/.test(readiness.ci_run_url||'')){
          const link=label('a','View passed Windows, Linux and browser checks');
          link.href=readiness.ci_run_url;link.target='_blank';link.rel='noopener noreferrer';ci.append(link);
        }
      }else $('#update-center-ci').textContent='';
    }
  }catch(error){
    message.dataset.state='unavailable';
    message.textContent='Update check failed: '+error.message;
  }finally{button.disabled=false;}
};
$('#update-center-install').onclick=async()=>{
  if(!can('system.update')||!/^[a-f0-9]{40}$/i.test(approvedUpdateSha||''))return;
  const accepted=await confirmAction({
    title:'Install verified FortLedger update?',
    detail:'Confirm all staff have finished their booking or bill forms. The local Windows supervisor will reject new financial writes, let active requests finish, verify the encrypted backup and run tests before restarting. No payment is created by this action. If the update becomes uncertain, inspect the ledger before retrying.',
    confirmLabel:'Finish work & update'
  });
  if(!accepted)return;
  const button=$('#update-center-install');
  button.disabled=true;
  $('#update-center-readiness-status').textContent='Contacting the local supervisor…';
  try{
    const response=await api('/api/system/updates/install',{
      method:'POST',body:JSON.stringify({
        confirmation:'stop_after_current_requests',
        target_sha:approvedUpdateSha
      })
    });
    if(!response.accepted)throw new Error('The local supervisor did not accept the request');
    $('#update-center-readiness-status').textContent=
      'Update accepted. Finish of active requests and verified installation are underway outside this browser. When localhost returns, reload and sign in. Do not issue a second update request.';
  }catch(error){
    $('#update-center-readiness-status').textContent=
      'Update acceptance could not be confirmed: '+error.message+
      '. Inspect the supervisor terminal before clicking again or recording another financial transaction.';
  }finally{approvedUpdateSha=null;}
};
$('#profile-password-form').onsubmit=async event=>{
  event.preventDefault();
  const form=event.currentTarget,message=$('#profile-password-message');
  const values=Object.fromEntries(new FormData(form));
  if(values.new_password!==values.confirm_password){
    message.textContent='New passwords do not match.';return;
  }
  const button=form.querySelector('[type=submit]');button.disabled=true;message.textContent='';
  try{
    await api('/api/me/password',{method:'POST',body:JSON.stringify({
      current_password:values.current_password,new_password:values.new_password
    })});
    form.reset();
    window.location.href='/login.html';
  }catch(error){message.textContent=error.message;}
  finally{button.disabled=false;}
};
$('#profile-form').onsubmit=async event=>{
  event.preventDefault();
  const message=$('#profile-message');
  try{
    await api('/api/me',{method:'PATCH',body:JSON.stringify({
      display_name:event.currentTarget.elements.namedItem('display_name').value
    })});
    message.textContent='Profile updated.';
    await load();
  }catch(error){message.textContent=error.message;}
};
$('#staff-create').onsubmit=async event=>{
  event.preventDefault();
  const form=event.currentTarget,message=$('#staff-message');
  const submit=form.querySelector('[type=submit]');submit.disabled=true;message.textContent='';
  try{
    await api('/api/staff',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(form)))});
    form.reset();message.textContent='Staff account created.';
    await renderProfile();
  }catch(error){message.textContent=error.message;}
  finally{submit.disabled=false;}
};
let invoiceBookingId=null;
let invoiceBookingAfterCreate=false;
$('#invoice-create-proforma').onclick=()=>{
  const id=Number($('#invoice-booking-select').value);
  const booking=bookings.find(b=>b.id===id);
  if(!booking){$('#invoice-quick-message').textContent='Select an existing reservation first.';return;}
  createInvoice(booking);
};
$('#invoice-new-booking').onclick=()=>{
  openNew();invoiceBookingAfterCreate=true;
  $('#invoice-quick-message').textContent='Save the reservation; its proforma editor opens automatically here.';
};
function makeInvoiceLine(item={description:'',rooms:1,nights:1,rate:0}){
  const row=label('div',undefined,'invoice-line-edit');
  for(const [key,title,value,type] of [
    ['description','Description',item.description,'text'],
    ['rooms','Rooms',item.rooms,'number'],
    ['nights','Nights',item.nights,'number'],
    ['rate','Rate/night (₹)',item.rate,'number']
  ]){
    const field=label('label',title);
    const input=label('input');input.name=key;input.type=type;input.required=true;input.value=value;
    if(type==='number'){input.min=key==='rate'?'0':'1';input.step=key==='rate'?'0.01':'1';}
    if(key==='description'){input.maxLength=200;input.setAttribute('list','room-descriptions');}
    field.append(input);row.append(field);
  }
  const remove=label('button','Remove','secondary');remove.type='button';remove.onclick=()=>{row.remove();previewInvoice();};
  row.append(remove);$('#invoice-line-list').append(row);
  previewInvoice();
}
function readInvoiceLines(){
  return [...document.querySelectorAll('.invoice-line-edit')].map(row=>Object.fromEntries(
    [...row.querySelectorAll('input')].map(x=>[x.name,x.value])
  ));
}
function previewInvoice(){
  const lines=readInvoiceLines();
  const total=lines.reduce((sum,l)=>sum+(Number(l.rooms)||0)*(Number(l.nights)||0)*(Number(l.rate)||0),0);
  const invoice=$('#invoice-totals');
  const booking=bookings.find(b=>b.id===invoiceBookingId);
  const paid=booking?.paid_paise||0;
  const contracted=booking?.total_paise;
  const proposed=Math.round(total*100);
  const mismatch=Number.isSafeInteger(contracted)&&proposed!==contracted;
  invoice.textContent=lines.length+' line(s) · Total '+money(proposed)+
    ' · Advance '+money(paid)+' · Due '+money(Math.max(0,proposed-paid))+
    (mismatch?' · Must equal booked stay '+money(contracted):' · Matches booking');
  const issue=$('#invoice-form').querySelector('[type=submit]');
  if(issue)issue.disabled=mismatch||!lines.length;
}
function createInvoice(booking){
  const existing=invoices.find(x=>x.booking_id===booking.id);
  if(existing){window.location.href='/api/invoices/'+existing.id+'/pdf';return;}
  invoiceBookingId=booking.id;
  const form=$('#invoice-form');form.reset();
  form.elements.namedItem('guest_name').value=booking.guest_name;
  form.elements.namedItem('bill_to').value=booking.company_name||booking.guest_name;
  $('#invoice-line-list').replaceChildren();
  makeInvoiceLine({description:(booking.assigned_room||booking.category)+' - '+booking.meal_plan+' basis',
    rooms:booking.rooms_count,nights:booking.nights,rate:booking.nightly_rate_paise/100});
  $('#invoice-error').textContent='';
  $('#invoice-dialog').showModal();
}
$('#add-invoice-line').onclick=()=>{if(document.querySelectorAll('.invoice-line-edit').length<20)makeInvoiceLine();};
$('#close-invoice').onclick=()=>$('#invoice-dialog').close();
$('#cancel-invoice').onclick=()=>$('#invoice-dialog').close();
$('#invoice-form').oninput=previewInvoice;
$('#invoice-form').onsubmit=async event=>{
  event.preventDefault();
  const form=event.currentTarget;
  const button=form.querySelector('[type=submit]');
  button.disabled=true;
  try{
    const body={
      guest_name:form.elements.namedItem('guest_name').value,
      bill_to:form.elements.namedItem('bill_to').value,
      bill_to_address:form.elements.namedItem('bill_to_address').value,
      lines:readInvoiceLines()
    };
    const invoice=await api('/api/bookings/'+invoiceBookingId+'/proforma',
      {method:'POST',body:JSON.stringify(body)});
    $('#invoice-dialog').close();
    await load();
    window.location.href='/api/invoices/'+invoice.id+'/pdf';
  }catch(error){$('#invoice-error').textContent=error.message;}
  finally{button.disabled=false;}
};

/* Booking editor safety: an accidental dismissal must not silently discard work.
   The snapshot covers native fields AND physical room assignment checkboxes. */
let bookingFormBaseline='',bookingSavePending=false;
function bookingFormSnapshot(){
  const form=$('#booking-form');
  const fields=[...form.elements].filter(element=>element.name&&!element.disabled)
    .map(element=>[element.name,element.type==='checkbox'?element.checked:element.value]);
  const roomIds=[...document.querySelectorAll('#room-assignment-list input:checked')]
    .map(input=>Number(input.value)).sort((a,b)=>a-b);
  return JSON.stringify({fields,roomIds});
}
function captureBookingBaseline(){bookingFormBaseline=bookingFormSnapshot();}
function closeBookingEditor(){
  if(bookingSavePending)return;
  if(bookingFormSnapshot()!==bookingFormBaseline&&
      !confirm('Discard unsaved booking changes? No reservation will be saved.'))return;
  $('#booking-dialog').close();
  invoiceBookingAfterCreate=false;
}
$('#booking-dialog').addEventListener('cancel',event=>{
  if(bookingSavePending){event.preventDefault();return;}
  if(bookingFormSnapshot()!==bookingFormBaseline&&
     !confirm('Discard unsaved booking changes? No reservation will be saved.'))event.preventDefault();
});
function openNew(){
  editingId=null;
  const f=$('#booking-form');f.reset();
  delete f.dataset.pendingRequestId;
  refreshGuestPicker('');
  $('#dialog-title').textContent='Add a booking';$('#booking-submit').textContent='Save booking';
  $('#booking-extras').open=false;
  $('#initial-advance').disabled=false;$('#initial-advance').closest('label').hidden=false;
  $('#advance-method').disabled=false;$('#advance-method').closest('label').hidden=false;
  setMessage('');updateRoomOptions();updatePreview();captureBookingBaseline();$('#booking-dialog').showModal();
}
function openEdit(b){
  editingId=b.id;
  const form=$('#booking-form');form.reset();
  delete form.dataset.pendingRequestId;
  refreshGuestPicker(b.guest_id||'');
  ['guest_name','company_name','checkin','checkout','rooms_count','meal_plan','nightly_rate','pickup_notes','stay_notes'].forEach(k=>{
    const field=form.elements.namedItem(k);
    field.value=k==='nightly_rate'?(b.nightly_rate_paise/100):(b[k]??'');
  });
  $('#category-select').value=b.category;updateRoomOptions(b.room_ids||[]);
  $('#booking-extras').open=Boolean(b.pickup_notes||b.stay_notes);
  $('#dialog-title').textContent='Edit booking';$('#booking-submit').textContent='Save changes';
  $('#initial-advance').disabled=true;$('#initial-advance').closest('label').hidden=true;
  $('#advance-method').disabled=true;$('#advance-method').closest('label').hidden=true;
  setMessage('');updatePreview();captureBookingBaseline();$('#booking-dialog').showModal();
}
function updatePreview(){
  const form=$('#booking-form');const data=Object.fromEntries(new FormData(form));
  const a=Date.parse(data.checkin+'T00:00:00Z'),b=Date.parse(data.checkout+'T00:00:00Z');
  const nights=Number.isFinite(a)&&Number.isFinite(b)?(b-a)/86400000:0;
  const gross=nights*Number(data.rooms_count)*Number(data.nightly_rate);
  const advance=editingId?bookings.find(b=>b.id===editingId)?.paid_paise/100||0:Number(data.amount_paid||0);
  $('#form-total').textContent=nights>0&&Number.isFinite(gross)&&gross>=0?
    nights+' night(s) · Total '+new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(gross)+' · Due '+new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(Math.max(0,gross-advance)):
    'Enter valid dates, room count and GST-inclusive rate.';
}
/* Operational notes stay editable after invoice issuance; the financial
   contract and saved proforma remain untouched. */
let notesBookingId=null,notesSaveBusy=false;
function openBookingNotes(booking){
  notesBookingId=booking.id;
  const form=$('#booking-notes-form');
  form.elements.namedItem('pickup_notes').value=booking.pickup_notes||'';
  form.elements.namedItem('stay_notes').value=booking.stay_notes||'';
  $('#booking-notes-title').textContent='Booking #'+booking.id+' · Operational notes';
  $('#booking-notes-guest').textContent=booking.guest_name+' · '+fmtDay(booking.checkin)+' – '+fmtDay(booking.checkout);
  $('#booking-notes-message').textContent='';
  $('#booking-notes-save').hidden=!can('bookings.write');
  for(const field of form.querySelectorAll('textarea'))field.readOnly=!can('bookings.write');
  $('#booking-notes-dialog').showModal();
}
$('#booking-notes-cancel').onclick=()=>{if(!notesSaveBusy)$('#booking-notes-dialog').close();};
$('#booking-notes-close').onclick=()=>{if(!notesSaveBusy)$('#booking-notes-dialog').close();};
$('#booking-notes-dialog').addEventListener('cancel',event=>{
  if(notesSaveBusy)event.preventDefault();
});
$('#booking-notes-form').onsubmit=async event=>{
  event.preventDefault();
  if(notesSaveBusy||!can('bookings.write')||!notesBookingId)return;
  notesSaveBusy=true;
  const form=event.currentTarget;
  const button=$('#booking-notes-save');
  button.disabled=true;
  try{
    await api('/api/bookings/'+notesBookingId+'/operational-notes',{
      method:'PATCH',body:JSON.stringify({
        pickup_notes:form.elements.namedItem('pickup_notes').value,
        stay_notes:form.elements.namedItem('stay_notes').value
      })
    });
    $('#booking-notes-message').textContent='Notes saved. Booking prices and original invoices were not changed.';
    await load();
    $('#booking-notes-dialog').close();
  }catch(error){
    $('#booking-notes-message').textContent='Notes save not confirmed: '+error.message+
      '. Refresh the ledger before retrying if the connection was interrupted.';
  }finally{notesSaveBusy=false;button.disabled=false;}
};
/* The booking payment ledger supports idempotent request IDs.
   Keep the same ID when a network error leaves the outcome uncertain. */
let paymentBookingId=null;
function addPayment(b){
  if(!can('payments.write'))return;
  paymentBookingId=b.id;
  const form=$('#booking-payment-form');
  form.reset();
  delete form.dataset.pendingRequestId;
  $('#payment-guest').textContent=b.guest_name;
  $('#payment-current-due').textContent='Booking outstanding: '+money(b.due_paise);
  $('#payment-message').textContent='';
  $('#payment-submit').disabled=false;
  $('#booking-payment-dialog').showModal();
  form.elements.namedItem('amount').focus();
}
$('#payment-cancel').onclick=()=>$('#booking-payment-dialog').close();
$('#payment-close').onclick=()=>$('#booking-payment-dialog').close();
$('#booking-payment-form').addEventListener('input',event=>{
  if(event.target.name==='amount'||event.target.name==='method')
    delete event.currentTarget.dataset.pendingRequestId;
});
$('#booking-payment-form').onsubmit=async event=>{
  event.preventDefault();
  if(!can('payments.write')||paymentBookingId===null)return;
  const form=event.currentTarget,button=$('#payment-submit'),message=$('#payment-message');
  const amount=Number(form.elements.namedItem('amount').value);
  const method=form.elements.namedItem('method').value;
  if(!Number.isFinite(amount)||amount<=0||Math.round(amount*100)<1){
    message.textContent='Enter an amount of at least ₹0.01.';return;
  }
  if(!['cash','upi','card','bank'].includes(method)){
    message.textContent='Choose a payment method.';return;
  }
  const booking=bookings.find(b=>b.id===paymentBookingId);
  if(!booking){message.textContent='Booking is no longer available. Reload and retry.';return;}
  if(!confirm('Record '+money(Math.round(amount*100))+' via '+method.toUpperCase()+
    ' for '+booking.guest_name+'? This records a received payment.'))return;
  const request_id=form.dataset.pendingRequestId||crypto.randomUUID();
  form.dataset.pendingRequestId=request_id;
  button.disabled=true;message.textContent='Recording payment…';
  try{
    await api('/api/bookings/'+paymentBookingId+'/payments',{
      method:'POST',body:JSON.stringify({amount,method,request_id})
    });
    delete form.dataset.pendingRequestId;
    paymentBookingId=null;
    $('#booking-payment-dialog').close();
  }catch(error){
    message.textContent='Payment could not be confirmed: '+error.message+
      '. Review the ledger before retrying. Retrying the same values uses the same request ID.';
    button.disabled=false;
    return;
  }
  button.disabled=false;
  try{await load();}
  catch(error){alert('Payment recorded, but refresh failed: '+error.message+' Reload to review the ledger.');}
};
async function showPayments(b){
  try{
    const [rows,refunds]=await Promise.all([
      api('/api/bookings/'+b.id+'/payments'),
      api('/api/bookings/'+b.id+'/refunds')
    ]);
    const payments=rows.length?rows.map(x=>'Payment #'+x.id+' · '+x.created_at+' · '+money(x.amount_paise)+' · '+(x.method==='unrecorded'?'METHOD NEEDS REVIEW':x.method||'METHOD NEEDS REVIEW')+
      (x.refunded_paise?' · Refunded '+money(x.refunded_paise):'')+
      (x.note?' · '+x.note:'')).join('\\n'):'No payments recorded.';
    const events=refunds.length?'\\n\\nREFUNDS (operator-recorded)\\n'+refunds.map(r=>
      'Refund #'+r.id+' / Payment #'+r.payment_id+' · '+money(r.amount_paise)+' · '+r.method+' · '+r.reason).join('\\n'):'';
    alert('Payment and refund ledger — '+b.guest_name+'\\n\\n'+payments+events);
  }catch(e){alert(e.message);}
}
async function recordPaymentRefund(b){
  try{
    const payments=await api('/api/bookings/'+b.id+'/payments');
    const eligible=payments.filter(p=>p.amount_paise>p.refunded_paise);
    if(!eligible.length){alert('No refundable payment remains for this booking.');return;}
    const choices=eligible.map(p=>'#'+p.id+' · Available '+money(p.amount_paise-p.refunded_paise)).join('\\n');
    const value=prompt('Select original payment ID to refund for '+b.guest_name+':\\n'+choices,eligible[0].id);
    if(value===null)return;
    const payment=eligible.find(p=>String(p.id)===value.trim());
    if(!payment){alert('Choose a listed payment ID.');return;}
    const requested=prompt('Refund amount in rupees (available '+money(payment.amount_paise-payment.refunded_paise)+')');
    if(requested===null)return;
    const amount=Number(requested);
    if(!Number.isFinite(amount)||amount<=0||Math.round(amount*100)>payment.amount_paise-payment.refunded_paise){
      alert('Refund must be a positive amount within the remaining original payment.');return;
    }
    const reason=prompt('Reason for recording this refund (required):');
    if(reason===null)return;
    if(reason.trim().length<3){alert('Provide a refund reason.');return;}
    const method=prompt('Refund method: cash, upi, card or bank','upi');
    if(method===null)return;
    if(!['cash','upi','card','bank'].includes(method.trim().toLowerCase())){alert('Choose a valid refund method.');return;}
    if(!confirm('Record a '+money(Math.round(amount*100))+' '+method+' refund for '+b.guest_name+'?\\nThis records the refund only; it does NOT transfer money.'))return;
    const request_id=crypto.randomUUID();
    await api('/api/bookings/'+b.id+'/payments/'+payment.id+'/refunds',{
      method:'POST',body:JSON.stringify({amount,reason:reason.trim(),method:method.trim().toLowerCase(),request_id})
    });
    await load();
    alert('Refund event recorded. Complete or verify the actual transfer separately.');
  }catch(error){alert(error.message);}
}

let selectedMenuCategory='all';
function renderMenuCategories(){
  const categories=$('#menu-categories'),available=[...new Set(menu.map(x=>x.category))].sort((a,b)=>a.localeCompare(b));
  if(selectedMenuCategory!=='all'&&!available.includes(selectedMenuCategory))selectedMenuCategory='all';
  categories.replaceChildren();
  for(const category of ['all',...available]){
    const chip=label('button',category==='all'?'All items':category,'secondary');
    chip.type='button';chip.classList.add('pos-category');
    chip.setAttribute('aria-pressed',String(selectedMenuCategory===category));
    chip.onclick=()=>{selectedMenuCategory=category;renderMenu();};
    categories.append(chip);
  }
}
function refreshRestaurantGuestPicker(){
  const guest=$('#restaurant-guest'),old=guest.value;guest.replaceChildren();
  const manual=label('option','Manual room / guest entry');manual.value='manual';guest.append(manual);
  for(const b of bookings.filter(x=>x.status==='checked_in')){
    const option=label('option',b.guest_name+' · '+(b.assigned_room||b.category));option.value=b.id;guest.append(option);
  }
  if([...guest.options].some(x=>x.value===old))guest.value=old;
  updateManualRoomFields();
}
function renderMenu(){
  renderMenuCategories();
  const list=$('#menu-items');list.replaceChildren();
  const query=$('#menu-search').value.trim().toLocaleLowerCase();
  const matching=menu.filter(x=>(selectedMenuCategory==='all'||x.category===selectedMenuCategory)&&
    (x.name+' '+x.category).toLocaleLowerCase().includes(query));
  $('#menu-result-count').textContent=matching.length+' of '+menu.length+' items';
  for(const item of matching){
    const row=label('div',undefined,'menu-item');
    const details=label('div');details.append(label('strong',item.name),label('small',item.category+' · '+money(item.price_paise)));
    const add=label('button','+ Add','secondary');add.type='button';
    add.setAttribute('aria-label','Add '+item.name+' to bill');
    add.onclick=()=>{
      if(pendingRestaurantBill){
        $('#restaurant-message').textContent='The previous bill save has an uncertain outcome. Retry the original request before editing or starting another bill.';
        return;
      }
      const existing=cart.find(x=>x.menu_item_id===item.id);
      if(existing){if(existing.quantity>=100)return;existing.quantity++;}
      else cart.push({menu_item_id:item.id,quantity:1});
      renderCart();
    };
    if(can('restaurant.write'))row.append(details,add);else row.append(details);
    list.append(row);
  }
  if(!list.children.length)list.append(label('p',menu.length?'No matching menu items. Clear the search or select All items.':'No menu items found. Import a CSV to start.','muted'));
}
let restaurantReviewOpen=false;
function restaurantBillDraft(){
  const method=$('#restaurant-method').value;
  if(!cart.length||cart.length>50)throw new Error('Add 1–50 menu lines before saving');
  const items=cart.map(x=>{
    const item=menu.find(y=>y.id===x.menu_item_id);
    if(!item)throw new Error('Menu item no longer available; refresh and review the bill');
    return {menu_item_id:x.menu_item_id,quantity:x.quantity,
      unit_price_paise:item.price_paise,tax_rate:item.tax_rate};
  });
  const manual=method==='room'&&$('#restaurant-guest').value==='manual';
  const body={payment_method:method,items,
    booking_id:method==='room'&&!manual?Number($('#restaurant-guest').value):undefined};
  if(manual){
    body.manual_room=$('#manual-room-number').value.trim();
    body.manual_guest=$('#manual-room-guest').value.trim();
    if(!body.manual_room||!body.manual_guest)throw new Error('Enter room identifier and guest name for manual review.');
  }
  if(method==='room'&&!manual&&!body.booking_id)
    throw new Error('Choose a checked-in guest or manual entry.');
  return body;
}
function renderRestaurantReview(){
  const review=$('#restaurant-review');
  review.hidden=!restaurantReviewOpen;
  $('#review-restaurant-bill').hidden=restaurantReviewOpen;
  $('#edit-restaurant-bill').hidden=!restaurantReviewOpen;
  $('#save-restaurant-bill').hidden=!restaurantReviewOpen;
  const unavailable=cart.some(entry=>!menu.some(item=>item.id===entry.menu_item_id));
  $('#save-restaurant-bill').disabled=!cart.length||restaurantBillSubmitting||
    (unavailable&&!pendingRestaurantBill);
  if(!restaurantReviewOpen)return;
  const list=$('#restaurant-review-items');list.replaceChildren();
  let total=0,tax=0;
  for(const entry of cart){
    const item=menu.find(x=>x.id===entry.menu_item_id);
    if(!item){
      list.append(label('p','Menu item #'+entry.menu_item_id+
        ' is no longer available. Continue editing and remove it before saving.','muted'));
      continue;
    }
    const line=item.price_paise*entry.quantity;
    const taxable=Math.round(line*100/(100+item.tax_rate));
    total+=line;tax+=line-taxable;
    const row=label('div',undefined,'menu-item');
    const detail=label('div');
    detail.append(label('strong',item.name+' × '+entry.quantity),
      label('small',money(item.price_paise)+' per item · '+item.tax_rate+'% included tax'));
    row.append(detail,label('strong',money(line)));
    list.append(row);
  }
  const method=$('#restaurant-method').value;
  const choice=$('#restaurant-guest');
  const recipient=method==='room'?(choice.value==='manual'?
    $('#manual-room-guest').value.trim()+' / '+$('#manual-room-number').value.trim():
    choice.selectedOptions[0]?.textContent||'No checked-in guest'):'Walk-in bill';
  $('#restaurant-review-payment').textContent=
    'Payment: '+(method==='room'?'Charge to room':'Record '+method.toUpperCase()+' received')+
    ' · '+recipient;
  $('#restaurant-review-total').textContent=
    'Bill total '+money(total)+' · Inclusive tax '+money(tax)+
    ' · '+cart.reduce((n,x)=>n+x.quantity,0)+' items';
}
function renderCart(){
  const list=$('#cart-items');list.replaceChildren();
  for(const entry of cart){
    const item=menu.find(x=>x.id===entry.menu_item_id);
    if(!item){
      const unavailable=label('div',undefined,'cart-row');
      unavailable.append(label('span','Item #'+entry.menu_item_id+
        ' is unavailable · '+entry.quantity+' portion(s). Remove to continue.'));
      const remove=label('button','Remove unavailable item','secondary');
      remove.type='button';remove.disabled=Boolean(pendingRestaurantBill);
      remove.setAttribute('aria-label','Remove unavailable menu item #'+entry.menu_item_id);
      remove.onclick=()=>{
        if(pendingRestaurantBill)return;
        cart=cart.filter(x=>x!==entry);renderCart();
      };
      unavailable.append(remove);list.append(unavailable);continue;
    }
    const row=label('div',undefined,'cart-row');
    const text=label('span',item.name+' · '+money(item.price_paise));
    const controls=label('div',undefined,'cart-actions');
    const minus=label('button','−','secondary');minus.type='button';
    minus.disabled=Boolean(pendingRestaurantBill);
    minus.setAttribute('aria-label','Remove one '+item.name);
    minus.onclick=()=>{if(pendingRestaurantBill)return;entry.quantity--;if(entry.quantity<1)cart=cart.filter(x=>x!==entry);renderCart();};
    const count=label('strong',String(entry.quantity));count.setAttribute('aria-label',entry.quantity+' portions');
    const plus=label('button','+','secondary');plus.type='button';
    plus.setAttribute('aria-label','Add one '+item.name);
    plus.disabled=entry.quantity>=100||Boolean(pendingRestaurantBill);
    plus.onclick=()=>{if(pendingRestaurantBill)return;if(entry.quantity<100)entry.quantity++;renderCart();};
    const remove=label('button','Remove','secondary');remove.type='button';
    remove.disabled=Boolean(pendingRestaurantBill);
    remove.setAttribute('aria-label','Remove '+item.name+' from bill');
    remove.onclick=()=>{
      if(pendingRestaurantBill)return;
      cart=cart.filter(x=>x!==entry);renderCart();
    };
    controls.append(minus,count,plus,remove);row.append(text,controls);list.append(row);
  }
  if(!cart.length)list.append(label('p','Select a menu item to begin.','muted'));
  const total=cart.reduce((sum,x)=>sum+(menu.find(y=>y.id===x.menu_item_id)?.price_paise||0)*x.quantity,0);
  const quantity=cart.reduce((sum,x)=>sum+x.quantity,0);
  $('#cart-count').textContent=quantity+' item'+(quantity===1?'':'s');
  $('#clear-restaurant-cart').disabled=!cart.length||Boolean(pendingRestaurantBill);
  const unavailable=cart.some(entry=>!menu.some(item=>item.id===entry.menu_item_id));
  $('#cart-total').textContent=unavailable?
    'Bill needs review · available items subtotal '+money(total):
    'Total (inclusive) '+money(total);
  renderRestaurantReview();
}
let restaurantHistoryLimit=15,restaurantBillFilter='all';
function restaurantBillStatus(bill){
  if(bill.payment_method!=='room')return {key:'paid',text:'Paid · '+bill.payment_method.toUpperCase()};
  if(bill.booking_id===null)return {key:'unmatched',text:'Needs guest linking'};
  if(bill.settlement_method)return {key:'paid',text:'Settled · '+bill.settlement_method.toUpperCase()};
  return {key:'unpaid',text:'Room balance due'};
}
function restaurantBillTime(stamp){
  const instant=new Date(String(stamp||'').replace(' ','T')+'Z');
  if(!Number.isFinite(instant.getTime()))return 'Saved time unavailable';
  return new Intl.DateTimeFormat('en-IN',{
    timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric',
    hour:'2-digit',minute:'2-digit',hour12:true
  }).format(instant)+' IST';
}
function renderRestaurantOverview(){
  const today=hotelToday();
  const todays=restaurantBills.filter(b=>hotelDateAt(new Date(b.created_at.replace(' ','T')+'Z'))===today);
  // Collected is a cash/UPI/card recording, not a verified bank statement;
  // room charges only count when a separate settlement is actually recorded.
  const immediate=todays.filter(b=>b.payment_method!=='room')
    .reduce((n,b)=>n+b.total_paise,0);
  const settled=restaurantBills.filter(b=>b.payment_method==='room'&&b.settled_at&&
    hotelDateAt(new Date(b.settled_at.replace(' ','T')+'Z'))===today)
    .reduce((n,b)=>n+b.total_paise,0);
  $('#restaurant-today-bills').textContent=String(todays.length);
  $('#restaurant-today-collected').textContent=money(immediate+settled);
  $('#restaurant-room-unpaid').textContent=String(restaurantBills.filter(b=>
    b.payment_method==='room'&&!b.settlement_method).length);
  $('#restaurant-room-unmatched').textContent=String(restaurantBills.filter(b=>
    b.payment_method==='room'&&b.booking_id===null).length);
}
function showRestaurantReceipt(id){
  const href='/api/restaurant/bills/'+encodeURIComponent(id)+'/receipt';
  window.open(href,'_blank','noopener');
}
function renderRestaurantHistory(){
  renderRestaurantOverview();
  const list=$('#restaurant-history');list.replaceChildren();
  for(const button of $('#restaurant-history-filters').querySelectorAll('[data-bill-filter]')){
    button.setAttribute('aria-pressed',String(button.dataset.billFilter===restaurantBillFilter));
  }
  const query=$('#restaurant-history-search').value.trim().toLocaleLowerCase().replace(/^#/,'');
  const matched=restaurantBills.filter(bill=>{
    const status=restaurantBillStatus(bill).key;
    if(restaurantBillFilter==='unpaid'&&status!=='unpaid')return false;
    if(restaurantBillFilter==='paid'&&status!=='paid')return false;
    if(restaurantBillFilter==='unmatched'&&status!=='unmatched')return false;
    return [String(bill.id),bill.payment_method,bill.manual_room||'',bill.manual_guest||'',
      bill.booking_id==null?'':String(bill.booking_id),
      ...(bill.items||[]).map(x=>x.name)]
      .some(value=>String(value).toLocaleLowerCase().includes(query));
  });
  $('#restaurant-history-count').textContent=matched.length+' of '+restaurantBills.length+' saved bills'+
    (query?' matching search':'');
  const more=$('#restaurant-history-more');
  more.hidden=matched.length<=restaurantHistoryLimit;
  for(const bill of matched.slice(0,restaurantHistoryLimit)){
    const status=restaurantBillStatus(bill);
    const article=label('article',undefined,'restaurant-history-card');
    const top=label('div',undefined,'restaurant-history-main');
    const identity=label('div',undefined,'restaurant-history-identity');
    identity.append(label('strong','Bill #'+bill.id),
      label('small',restaurantBillTime(bill.created_at)));
    const badge=label('span',status.text,'restaurant-history-status');
    badge.dataset.status=status.key;
    const amount=label('strong',money(bill.total_paise),'restaurant-history-amount');
    top.append(identity,badge,amount);
    article.append(top);
    if(bill.payment_method==='room'){
      const target=label('p',bill.booking_id==null?
        'Guest / room: '+(bill.manual_guest||'Unverified')+' · '+(bill.manual_room||'Unknown'):
        'Booking #'+bill.booking_id,'restaurant-history-target');
      article.append(target);
    }
    const expand=label('details',undefined,'restaurant-history-details');
    const summary=label('summary','View '+(bill.items||[]).length+' bill line'+
      ((bill.items||[]).length===1?'':'s')+' · tax included '+money(bill.tax_paise));
    expand.append(summary);
    const itemList=label('div',undefined,'restaurant-history-items');
    for(const line of bill.items||[]){
      const item=label('div',undefined,'restaurant-history-item');
      item.append(label('span',line.name+' × '+line.quantity+
        ' · '+money(line.unit_price_paise)+' each'),
        label('strong',money(line.total_paise)));
      itemList.append(item);
    }
    expand.append(itemList);
    article.append(expand);
    const actions=label('div',undefined,'restaurant-history-actions');
    const print=label('button','View receipt','secondary');print.type='button';
    print.onclick=()=>showRestaurantReceipt(bill.id);
    const lan=label('button','LAN Print','secondary');lan.type='button';
    lan.onclick=async()=>{
      if(!confirm('Send existing saved receipt #'+bill.id+' to configured Epson LAN printer?'))return;
      try{
        const sent=await api('/api/restaurant/bills/'+bill.id+'/print',
          {method:'POST',body:JSON.stringify({reprint:false})});
        alert(sent.notice);
      }catch(error){
        if(!/Previously attempted/.test(error.message)){alert(error.message);return;}
        if(!confirm('Printing was previously attempted. Verify whether paper already printed before reprinting. Proceed?'))return;
        try{
          const retried=await api('/api/restaurant/bills/'+bill.id+'/print',
            {method:'POST',body:JSON.stringify({reprint:true})});
          alert(retried.notice);
        }catch(next){alert(next.message);}
      }
    };
    actions.append(print,lan);
    if(status.key==='unmatched'){
      const link=label('button','Link to guest','secondary');link.type='button';
      link.onclick=()=>linkPendingCharge(bill);
      actions.append(link);
    }
    article.append(actions);
    list.append(article);
  }
  if(!matched.length)list.append(label('p',restaurantBills.length?
    'No bills match these filters. Try All bills or clear the search.':
    'No restaurant bills yet. Prepare a new bill above.','muted'));
}
$('#restaurant-history-search').oninput=()=>{restaurantHistoryLimit=15;renderRestaurantHistory();};
for(const button of $('#restaurant-history-filters').querySelectorAll('[data-bill-filter]')){
  button.onclick=()=>{
    restaurantBillFilter=button.dataset.billFilter;
    restaurantHistoryLimit=15;
    renderRestaurantHistory();
  };
}
$('#restaurant-jump-new').onclick=()=>$('#restaurant-editor-anchor').scrollIntoView({behavior:'smooth',block:'start'});
$('#restaurant-jump-history').onclick=()=>$('#restaurant-history-section').scrollIntoView({behavior:'smooth',block:'start'});
$('#restaurant-jump-menu').onclick=()=>{
  $('#menu-import-section').open=true;
  $('#menu-import-section').scrollIntoView({behavior:'smooth',block:'start'});
};
$('#restaurant-history-more').onclick=()=>{restaurantHistoryLimit+=20;renderRestaurantHistory();};
$('#restaurant-reconciliation-download').onclick=async()=>{
  if(!can('finance.read'))return;
  const day=$('#restaurant-reconciliation-date').value;
  const status=$('#restaurant-reconciliation-message');
  const button=$('#restaurant-reconciliation-download');
  if(!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(day)){
    status.textContent='Choose a valid hotel business date first.';return;
  }
  status.textContent='Preparing read-only restaurant event export…';
  button.disabled=true;
  try{
    const response=await fetch('/api/finance/restaurant/reconciliation.csv?date='+
      encodeURIComponent(day),{cache:'no-store',headers:{Accept:'text/csv'}});
    if(!response.ok){
      let message='Export unavailable';
      try{message=(await response.json()).error||message;}catch{}
      throw new Error(message);
    }
    if(!response.headers.get('Content-Type')?.includes('text/csv'))
      throw new Error('Server did not return a restaurant CSV');
    const blob=await response.blob();
    const url=URL.createObjectURL(blob);
    try{
      const link=document.createElement('a');
      link.href=url;link.download='fortledger-restaurant-'+day+'.csv';
      document.body.append(link);link.click();link.remove();
    }finally{setTimeout(()=>URL.revokeObjectURL(url),2000);}
    status.textContent='Restaurant CSV downloaded for '+day+
      '. Verify operator-recorded receipts against actual cash and bank activity separately.';
  }catch(error){
    status.textContent='Restaurant export could not be confirmed: '+error.message;
  }finally{button.disabled=false;}
};
function updateManualRoomFields(){
  $('#manual-room-fields').hidden=$('#restaurant-guest').value!=='manual';
}
async function linkPendingCharge(bill){
  const active=bookings.filter(b=>b.status==='checked_in');
  if(!active.length){alert('No checked-in guest bookings available to link this charge.');return;}
  const candidates=active.map(b=>'#'+b.id+' · '+b.guest_name+' · '+(b.assigned_room||b.category)).join('\\n');
  const entered=prompt('Verify the charge belongs to the correct checked-in booking.\\n'+
    'Original: '+bill.manual_guest+' / '+bill.manual_room+'\\n\\n'+candidates+
    '\\n\\nEnter matching booking ID:');
  if(entered===null)return;
  const booking=active.find(b=>String(b.id)===entered.trim());
  if(!booking){alert('Select a valid checked-in booking ID.');return;}
  const canonical=value=>String(value||'').normalize('NFKC').trim().replace(/\\s+/g,' ').toLowerCase();
  const roomNames=String(booking.assigned_room||'').split(',').map(canonical);
  const mismatch=canonical(bill.manual_guest)!==canonical(booking.guest_name)||
    !roomNames.includes(canonical(bill.manual_room));
  let reason='';
  if(mismatch){
    if(!['owner','manager'].includes(currentUser?.role)){
      alert('The original room or guest differs from this booking. Ask the owner or manager to review and link this charge.');
      return;
    }
    reason=prompt('Room/guest mismatch. Original: '+bill.manual_guest+' / '+bill.manual_room+
      '\\nChosen: '+booking.guest_name+' / '+(booking.assigned_room||'Unassigned')+
      '\\nEnter the reason for the owner/manager override (at least 10 characters):');
    if(reason===null)return;
    if(reason.trim().length<10){alert('Provide a review reason of at least 10 characters.');return;}
  }
  if(!confirm('Link food bill #'+bill.id+' to '+booking.guest_name+
    (mismatch?' with a recorded mismatch override':' after matching guest and room')+
    '? This adds the unpaid charge to their folio.'))return;
  try{
    await api('/api/restaurant/bills/'+bill.id+'/link-booking',{
      method:'POST',body:JSON.stringify({booking_id:booking.id,override:mismatch,reason:reason.trim()})
    });
    await load();
    alert('Restaurant bill linked to the selected guest for settlement.');
  }catch(error){alert(error.message);}
}
$('#menu-search').oninput=renderMenu;
$('#review-restaurant-bill').onclick=()=>{
  if(pendingRestaurantBill){
    $('#restaurant-message').textContent='Previous save not confirmed; retry the unchanged bill instead of reviewing a new one.';
    return;
  }
  try{restaurantBillDraft();}
  catch(error){$('#restaurant-message').textContent=error.message;return;}
  restaurantReviewOpen=true;
  $('#restaurant-message').textContent='Review and edit the items above. Confirm & save only when the final bill is correct.';
  renderRestaurantReview();
  $('#restaurant-review-heading').focus({preventScroll:true});
  $('#restaurant-review').scrollIntoView({block:'nearest'});
};
$('#edit-restaurant-bill').onclick=()=>{
  if(pendingRestaurantBill)return;
  restaurantReviewOpen=false;
  renderRestaurantReview();
  $('#restaurant-message').textContent='Draft remains unsaved. Add or remove items, then review it again.';
  $('#menu-search').focus({preventScroll:true});
};
$('#clear-restaurant-cart').onclick=async()=>{
  if(pendingRestaurantBill){
    $('#restaurant-message').textContent='An earlier bill submission is not confirmed. Review saved bills and retry the original request before starting another bill.';
    return;
  }
  if(!cart.length||!await confirmAction({
    title:'Clear this draft bill?',
    detail:'Only unsaved items will be removed. Existing saved bills and payments will not change.',
    confirmLabel:'Clear draft',danger:true
  }))return;
  if(pendingRestaurantBill)return;
  cart=[];restaurantReviewOpen=false;renderCart();$('#restaurant-message').textContent='Unsaved bill cleared.';
};
$('#restaurant-method').onchange=()=>{
  $('#restaurant-payment-hint').textContent=$('#restaurant-method').value==='room'?
    'Room charge: unpaid until separately settled or included in the guest folio.':
    'Cash / UPI / card: only select after the payment has actually been received and verified by staff.';
  $('#room-charge-choice').hidden=$('#restaurant-method').value!=='room';
  updateManualRoomFields();
  renderRestaurantReview();
};
$('#restaurant-guest').onchange=()=>{updateManualRoomFields();renderRestaurantReview();};
$('#manual-room-number').oninput=renderRestaurantReview;
$('#manual-room-guest').oninput=renderRestaurantReview;
// Keep the same immutable intent and UUID after an uncertain response. Never
// create a second financial record while the original attempt is unresolved.
let pendingRestaurantBill=null,restaurantBillSubmitting=false;
function lockPendingRestaurantInputs(locked){
  for(const selector of ['#restaurant-method','#restaurant-guest',
    '#manual-room-number','#manual-room-guest']){
    $(selector).disabled=locked;
  }
}
$('#save-restaurant-bill').onclick=async()=>{
  const button=$('#save-restaurant-bill'),message=$('#restaurant-message');
  if(restaurantBillSubmitting)return;
  if(!pendingRestaurantBill){
    if(!restaurantReviewOpen){
      message.textContent='Review the draft before committing a financial bill.';
      return;
    }
    let body;
    try{body=restaurantBillDraft();}
    catch(error){message.textContent=error.message;return;}
    if(!confirm('Confirm and permanently save this reviewed bill for '+money(cart.reduce((sum,x)=>
      sum+(menu.find(y=>y.id===x.menu_item_id)?.price_paise||0)*x.quantity,0))+
      '? Cash/UPI/card means payment has been manually confirmed. Saved bills cannot be edited or deleted.'))return;
    body.request_id=crypto.randomUUID();
    pendingRestaurantBill=body;
    lockPendingRestaurantInputs(true);
    renderCart();
  }else if(!confirm('A previous bill submission was not confirmed. Check the saved bills first. Retry the EXACT original bill with the same request ID? Changes to the current cart will not be submitted.')){
    return;
  }
  restaurantBillSubmitting=true;button.disabled=true;
  try{
    let saved;
    try{
      saved=await api('/api/restaurant/bills',{
        method:'POST',body:JSON.stringify(pendingRestaurantBill)
      });
    }catch(error){
      if(!(error instanceof TypeError)){
        pendingRestaurantBill=null;
        lockPendingRestaurantInputs(false);
        renderCart();
        throw error;
      }
      try{
        const receipt=await api('/api/restaurant/bills/request/'+encodeURIComponent(pendingRestaurantBill.request_id));
        if(receipt.recorded){
          saved={id:receipt.id};
        }else{
          message.textContent='Bill not confirmed under this request ID. Check saved bills before retrying the unchanged bill; this screen preserves the original request ID.';
          return;
        }
      }catch(lookupError){
        message.textContent='Connection lost. Bill may already be saved. Reconnect, check saved bills and retry only the unchanged bill with the same request ID. '+lookupError.message;
        return;
      }
    }
    pendingRestaurantBill=null;
    lockPendingRestaurantInputs(false);
    restaurantReviewOpen=false;
    cart=[];
    renderCart();
    message.replaceChildren();
    message.append(document.createTextNode('Bill #'+saved.id+' saved once. Payment was recorded manually; FortLedger did not verify a bank transfer. '));
    const link=label('a','Open saved receipt #'+saved.id);
    link.href='/api/restaurant/bills/'+encodeURIComponent(saved.id)+'/receipt';
    link.target='_blank';link.rel='noopener';
    message.append(link);
    message.focus({preventScroll:true});
    try{
      const updated=await load();
      if(updated===false)message.append(document.createTextNode(' A newer workspace refresh is in progress.'));
    }catch(error){
      message.append(document.createTextNode(' Refresh failed: '+error.message+'. The bill is already saved; use Refresh to reload, not Save again.'));
    }
  }catch(error){message.textContent='Bill was not saved: '+error.message;
    message.focus({preventScroll:true});}
  finally{restaurantBillSubmitting=false;button.disabled=false;}
};
let validatedMenuCsv=null,menuImportGeneration=0,menuImportRows=[],menuImportInFlight=false;
// Menu availability is separate from CSV price changes. It never edits a bill
// or menu identity; the server checks the expected state and audits the actor.
let menuAvailabilityItems=[],menuAvailabilityBusy=false,menuAvailabilityRevision=0,menuAvailabilityVerified=false;
function renderMenuAvailability(focusId=null){
  const container=$('#menu-availability-items');container.replaceChildren();
  const query=$('#menu-availability-search').value.trim().toLocaleLowerCase();
  const visible=menuAvailabilityItems.filter(item=>
    (item.name+' '+item.category).toLocaleLowerCase().includes(query));
  $('#menu-availability-count').textContent=visible.length+' of '+menuAvailabilityItems.length+' dishes';
  for(const item of visible){
    const row=label('div',undefined,'menu-availability-row');
    row.dataset.menuId=String(item.id);
    const details=label('div',undefined,'menu-availability-detail');
    details.append(label('strong',item.name));
    details.append(label('small',item.category+' · '+money(item.price_paise)+
      ' · GST '+item.tax_rate+'% · '+(item.active?'Available':'Unavailable')));
    const button=label('button',item.active?'Mark unavailable':'Make available','secondary');
    button.type='button';button.disabled=menuAvailabilityBusy||!menuAvailabilityVerified;
    button.setAttribute('aria-label',(item.active?'Mark unavailable: ':'Make available: ')+item.name);
    button.onclick=()=>changeMenuAvailability(item);
    row.append(details,button);container.append(row);
  }
  if(!visible.length)container.append(label('p',menuAvailabilityItems.length?
    'No dishes match the search.':'No menu items configured. Import a CSV first.','muted'));
  if(focusId!==null)container.querySelector('[data-menu-id="'+focusId+'"] button')?.focus({preventScroll:true});
}
async function refreshMenuAvailability(){
  if(!can('menu.manage'))return;
  const revision=++menuAvailabilityRevision;
  menuAvailabilityVerified=false;
  renderMenuAvailability();
  $('#menu-availability-message').textContent='Reading current menu availability…';
  const latest=await api('/api/restaurant/menu/all');
  if(revision!==menuAvailabilityRevision)return;
  menuAvailabilityItems=latest;
  menuAvailabilityVerified=true;
  renderMenuAvailability();
  $('#menu-availability-message').textContent='Current menu availability loaded. Review each dish before changing it.';
}
async function changeMenuAvailability(item){
  if(!can('menu.manage')||menuAvailabilityBusy||!menuAvailabilityVerified)return;
  const wasActive=Boolean(item.active),makeActive=!wasActive;
  const verb=makeActive?'Make available':'Mark unavailable';
  if(!await confirmAction({
    title:verb+' '+item.name+'?',
    detail:makeActive?
      'It will become selectable for new bills. Saved receipts remain unchanged.':
      'It will disappear from new bills. Saved receipts and original prices remain unchanged.',
    confirmLabel:verb
  }))return;
  menuAvailabilityBusy=true;
  menuAvailabilityVerified=false;
  menuAvailabilityRevision++; // invalidate a read already in flight
  renderMenuAvailability();
  const message=$('#menu-availability-message');
  try{
    await api('/api/restaurant/menu/'+item.id+'/availability',{
      method:'PATCH',body:JSON.stringify({active:makeActive,expected_active:wasActive})
    });
    message.textContent=item.name+(makeActive?' is now available.':' is now unavailable.')+
      ' Existing saved receipts are unchanged.';
    try{
      await load();
      await refreshMenuAvailability();
      message.textContent=item.name+(makeActive?' is now available.':' is now unavailable.')+
        ' Both the menu and staff bill view were refreshed.';
    }catch(error){
      message.textContent='Availability was saved, but the screen could not refresh: '+
        error.message+'. Refresh to verify the current menu.';
    }
  }catch(error){
    message.textContent='Change not confirmed: '+error.message+
      '. Refresh current availability before trying another change.';
    try{await refreshMenuAvailability();}
    catch(refreshError){message.textContent+=' Refresh failed: '+refreshError.message;}
  }finally{
    menuAvailabilityBusy=false;
    renderMenuAvailability(item.id);
  }
}
$('#menu-availability-search').oninput=()=>renderMenuAvailability();
$('#menu-availability-refresh').onclick=()=>refreshMenuAvailability().catch(error=>{
  $('#menu-availability-message').textContent='Could not load current menu: '+error.message;
});
$('#menu-availability-section').addEventListener('toggle',()=>{
  if($('#menu-availability-section').open&&can('menu.manage'))
    refreshMenuAvailability().catch(error=>{
      $('#menu-availability-message').textContent='Could not load current menu: '+error.message;
    });
});

function clearMenuImportReview(){
  validatedMenuCsv=null;menuImportRows=[];
  $('#import-menu').disabled=true;
  $('#menu-import-review-controls').hidden=true;
  $('#menu-import-preview').replaceChildren();
}
function renderMenuImportReview(){
  const list=$('#menu-import-preview');list.replaceChildren();
  if(!validatedMenuCsv)return;
  const query=$('#menu-import-search').value.trim().toLocaleLowerCase();
  const category=$('#menu-import-category').value;
  const change=$('#menu-import-change').value;
  const selected=menuImportRows.filter(item=>
    (category==='all'||item.category===category)&&
    (change==='all'||(change==='changes'?item.change!=='unchanged':item.change===change))&&
    (item.name+' '+item.category+' '+item.row_number).toLocaleLowerCase().includes(query));
  $('#menu-import-row-count').textContent=selected.length+' of '+menuImportRows.length+' preview rows';
  const container=label('div',undefined,'import-preview-scroll');
  container.setAttribute('role','region');
  container.setAttribute('aria-label','Complete reviewed menu changes');
  container.tabIndex=0;
  const table=label('table',undefined,'import-preview-table');
  const head=label('thead'),headerRow=label('tr');
  for(const title of ['CSV row','Menu item','Category','Change','Current price','Imported price','GST rate','Review notes']){
    const th=label('th',title);th.scope='col';headerRow.append(th);
  }
  head.append(headerRow);table.append(head);
  const body=label('tbody');
  for(const item of selected){
    const row=label('tr');row.dataset.change=item.change;
    const status=label('strong',item.change==='suspicious'?'Needs review':item.change);
    status.className='menu-import-status';status.dataset.change=item.change;
    const col=label('td');col.append(status);
    const old=item.old_price_paise===null?'New item':money(item.old_price_paise);
    const tax=item.old_tax_rate===null?item.tax_rate+'%':
      item.old_tax_rate===item.tax_rate?item.tax_rate+'%':
      item.old_tax_rate+'% → '+item.tax_rate+'%';
    const priceChange=item.old_price_paise!==null&&item.price_delta_paise!==0?
      ' ('+(item.price_delta_paise>0?'+':'')+money(item.price_delta_paise)+')':'';
    row.append(label('td',String(item.row_number)),label('td',item.name),
      label('td',item.category),col,label('td',old),
      label('td',money(item.price_paise)+priceChange),label('td',tax),
      label('td',item.concern||(item.reactivates?'Reactivates previously inactive item':'—')));
    body.append(row);
  }
  table.append(body);container.append(table);list.append(container);
  if(!selected.length)list.append(label('p','No preview rows match these filters.','muted'));
}
$('#menu-import-search').oninput=renderMenuImportReview;
$('#menu-import-category').onchange=renderMenuImportReview;
$('#menu-import-change').onchange=renderMenuImportReview;
$('#menu-csv').onchange=()=>{
  menuImportGeneration++;
  clearMenuImportReview();
  $('#menu-import-message').textContent='New file selected. Check this file before importing.';
};
$('#preview-menu').onclick=async()=>{
  const message=$('#menu-import-message'),file=$('#menu-csv').files[0];
  const generation=++menuImportGeneration;
  clearMenuImportReview();
  if(!file){message.textContent='Choose a CSV file first.';return;}
  if(file.size>65000){message.textContent='CSV must be smaller than 65 KB.';return;}
  message.textContent='Checking the selected menu file and comparing existing prices…';
  $('#preview-menu').disabled=true;
  try{
    const csv=await file.text();
    if(generation!==menuImportGeneration||$('#menu-csv').files[0]!==file)return;
    const result=await api('/api/restaurant/menu/preview',{
      method:'POST',body:JSON.stringify({csv})
    });
    // A stale response must NEVER reenable Import for a newly selected file.
    if(generation!==menuImportGeneration||$('#menu-csv').files[0]!==file)return;
    if(!result.preview_token||!Array.isArray(result.preview))
      throw new Error('Server did not verify the menu preview; update FortLedger');
    validatedMenuCsv={csv,file,preview_token:result.preview_token,summary:result.summary};
    menuImportRows=result.preview;
    const categories=$('#menu-import-category');categories.replaceChildren();
    const all=label('option','All categories');all.value='all';categories.append(all);
    for(const category of Object.keys(result.category_counts||{})){
      const option=label('option',category);option.value=category;categories.append(option);
    }
    $('#menu-import-search').value='';
    $('#menu-import-change').value='all';
    $('#menu-import-review-controls').hidden=false;
    renderMenuImportReview();
    const count=result.summary;
    message.textContent=result.count+' rows inspected: '+count.new+' new, '+
      count.updated+' updated, '+count.unchanged+' unchanged, '+
      count.suspicious+' require special review. '+
      (count.suspicious?'Review flagged prices or GST rates before confirming. ':
      'No unusual price or GST changes found. ')+
      'Older menu items not in this file will not be deleted.';
    $('#import-menu').disabled=false;
  }catch(error){
    if(generation===menuImportGeneration){
      clearMenuImportReview();message.textContent='Menu review failed: '+error.message;
    }
  }finally{$('#preview-menu').disabled=false;}
};
$('#import-menu').onclick=async()=>{
  const message=$('#menu-import-message'),approved=validatedMenuCsv;
  if(!approved||$('#menu-csv').files[0]!==approved.file){
    message.textContent='Check the exact currently selected CSV before importing.';return;
  }
  if(menuImportInFlight)return;
  const {new:added,updated,unchanged,suspicious}=approved.summary;
  if(!confirm('Apply this EXACT menu preview? '+added+' new, '+updated+
    ' standard updates, '+suspicious+' flagged changes, '+unchanged+
    ' unchanged. Historical restaurant receipts will not change.'))return;
  let approve_suspicious=false;
  if(suspicious){
    approve_suspicious=confirm(suspicious+' rows have unusually large price or GST changes. '+
      'Inspect those rows carefully and confirm with the person responsible for pricing. Approve these changes?');
    if(!approve_suspicious)return;
  }
  menuImportInFlight=true;
  const button=$('#import-menu');button.disabled=true;
  $('#preview-menu').disabled=true;$('#menu-csv').disabled=true;
  message.textContent='Applying the reviewed menu changes…';
  try{
    const result=await api('/api/restaurant/menu/import',{
      method:'POST',body:JSON.stringify({
        csv:approved.csv,preview_token:approved.preview_token,
        confirm_import:true,approve_suspicious
      })
    });
    menuImportGeneration++;
    clearMenuImportReview();
    $('#menu-csv').value='';
    message.textContent='Menu import recorded: '+result.imported+' rows processed. '+
      'New prices apply to future bills only; existing receipts are unchanged.';
    try{await load();}catch(error){
      message.textContent+=' Workspace refresh failed: '+error.message+'. Use Refresh to view the current menu.';
    }
  }catch(error){
    menuImportGeneration++;
    clearMenuImportReview();
    message.textContent=(error instanceof TypeError?
      'Menu import outcome not confirmed. Reconnect and review the current menu; do not assume changes failed. ':
      'Menu import stopped without confirmation. Review the latest menu and preview again. ')+error.message;
  }finally{
    menuImportInFlight=false;$('#preview-menu').disabled=false;$('#menu-csv').disabled=false;
  }
};

let activeFolioBooking=null;
async function showFolio(booking){
  activeFolioBooking=booking.id;
  $('#folio-dialog').showModal();
  await refreshFolio();
}
// Preserve retry identities across folio dialog refreshes until a successful
// API acknowledgment. An ambiguous fetch outcome is NOT proof of failure.
const pendingFolioSettlements=new Map();
function folioSettlementIntent(key,details){
  const serialized=JSON.stringify(details),previous=pendingFolioSettlements.get(key);
  if(previous&&previous.serialized!==serialized)
    throw new Error('A settlement response is uncertain. Retry with the same payment choices, or inspect the ledger before changing them.');
  if(previous)return previous.body;
  const body={...details,request_id:crypto.randomUUID()};
  pendingFolioSettlements.set(key,{serialized,body});
  return body;
}
async function refreshFolio(){
  const data=await api('/api/bookings/'+activeFolioBooking+'/folio');
  $('#folio-name').textContent=data.guest_name;
  $('#folio-summary').textContent='Accommodation due '+money(data.accommodation.due_paise)+
    ' · Restaurant room charges due '+money(data.restaurant_due_paise)+
    ' · Combined due '+money(data.combined_due_paise);
  const changes=$('#folio-adjustments');changes.replaceChildren();
  for(const adjustment of data.adjustments||[]){
    const item=label('div',undefined,'menu-item');
    item.append(label('strong',(adjustment.kind==='credit'?'Credit':'Charge')+
      ' '+money(Math.abs(adjustment.amount_paise))),
      label('small',adjustment.reason+' · '+adjustment.actor_username+
        (adjustment.reference?' · Ref '+adjustment.reference:'')));
    changes.append(item);
  }
  if(!(data.adjustments||[]).length)
    changes.append(label('p','No accommodation adjustments recorded.','muted'));
  $('#folio-adjustment-form').hidden=!can('folio.adjust')||
    !['reserved','checked_in'].includes(data.status);
  const list=$('#folio-room-bills');list.replaceChildren();
  for(const bill of data.bills){
    const row=label('div',undefined,'menu-item');
    const details=label('div');details.append(label('strong','Food bill #'+bill.id),label('small',money(bill.total_paise)+(bill.settlement_id?' · Settled':' · Unsettled')));
    const button=label('button',bill.settlement_id?'Paid':'Settle separately','secondary');
    button.disabled=Boolean(bill.settlement_id);
    button.onclick=async()=>{
      if(!confirm('Record separate payment of '+money(bill.total_paise)+' for food bill #'+bill.id+'?'))return;
      try{
        const bookingId=activeFolioBooking,key='room:'+bookingId+':'+bill.id;
        const body=folioSettlementIntent(key,{method:$('#folio-method').value});
        const result=await api('/api/bookings/'+bookingId+'/folio/room-bills/'+bill.id+'/settle',{
          method:'POST',body:JSON.stringify(body)});
        pendingFolioSettlements.delete(key);
        $('#folio-message').textContent=result.already_recorded?
          'Food payment already saved; original settlement recovered.':'Separate food payment saved.';
        await refreshFolio();
      }catch(e){$('#folio-message').textContent='Payment outcome not confirmed: '+e.message+
        '. Check the ledger or retry with unchanged payment details; do not create a second payment.';}
    };
    row.append(details,button);list.append(row);
  }
  if(!data.bills.length)list.append(label('p','No restaurant room charges linked to this guest.','muted'));
  $('#folio-combined').disabled=data.combined_due_paise===0||data.status==='cancelled';
  $('#folio-combined').textContent='Settle all outstanding · '+money(data.combined_due_paise);
}
$('#folio-adjustment-form').onsubmit=async event=>{
  event.preventDefault();
  const form=event.currentTarget,fields=new FormData(form),bookingId=activeFolioBooking;
  const details={
    kind:String(fields.get('kind')),amount:String(fields.get('amount')),
    reason:String(fields.get('reason')).trim(),reference:String(fields.get('reference')).trim()
  };
  if(!confirm('Record '+details.kind+' of INR '+details.amount+
    ' as an immutable commercial adjustment? The original proforma will remain unchanged.'))return;
  const button=form.querySelector('[type=submit]');button.disabled=true;
  try{
    const key='adjustment:'+bookingId,body=folioSettlementIntent(key,details);
    const result=await api('/api/bookings/'+bookingId+'/folio/adjustments',{
      method:'POST',body:JSON.stringify(body)
    });
    pendingFolioSettlements.delete(key);
    $('#folio-message').textContent=result.already_recorded?
      'Original accommodation adjustment recovered; no duplicate charge recorded.':
      'Reviewed accommodation adjustment recorded.';
    form.reset();
    await load();await refreshFolio();
  }catch(error){
    $('#folio-message').textContent='Adjustment outcome not confirmed: '+error.message+
      '. Retry unchanged details or review the folio before another adjustment.';
  }finally{button.disabled=false;}
};
$('#folio-accommodation-method').onchange=()=>{
  $('#folio-bank-reference-field').hidden=$('#folio-accommodation-method').value!=='bank';
};
$('#close-folio').onclick=()=>$('#folio-dialog').close();
$('#folio-combined').onclick=async()=>{
  const message=$('#folio-message');
  if(!confirm('Record full accommodation and unpaid restaurant balance as paid?'))return;
  const button=$('#folio-combined');button.disabled=true;
  try{
    const bookingId=activeFolioBooking,key='combined:'+bookingId;
    const body=folioSettlementIntent(key,{
      method:$('#folio-method').value,
      accommodation_method:$('#folio-accommodation-method').value,
      bank_reference:$('#folio-bank-reference').value.trim()
    });
    const result=await api('/api/bookings/'+bookingId+'/folio/settle-combined',{
      method:'POST',body:JSON.stringify(body)});
    pendingFolioSettlements.delete(key);
    message.textContent=result.already_recorded?
      'Original combined settlement recovered; no second payment recorded.':
      'Combined payment saved. No duplicate charges recorded.';
    await load();await refreshFolio();
  }catch(e){message.textContent='Payment outcome not confirmed: '+e.message+
    '. Inspect the folio or retry unchanged details before recording another payment.';
    button.disabled=false;}
};

async function refreshHotelLogo(){
  const current=await api('/api/settings/logo');
  const image=$('#hotel-logo-preview');
  image.hidden=!current.active;
  if(current.active)image.src='/api/settings/logo/image?changed='+encodeURIComponent(current.active.sha256);
}
$('#hotel-logo-upload').onclick=async()=>{
  const file=$('#hotel-logo-file').files[0],message=$('#hotel-logo-message');
  if(!file){message.textContent='Choose a hotel logo first.';return;}
  if(!['image/png','image/jpeg'].includes(file.type)||file.size>800*1024){
    message.textContent='Choose a PNG or JPEG smaller than 800 KB.';return;
  }
  const button=$('#hotel-logo-upload');button.disabled=true;
  try{
    const base64=await new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(String(reader.result).split(',')[1]);
      reader.onerror=()=>reject(new Error('Unable to read the logo'));
      reader.readAsDataURL(file);
    });
    await api('/api/settings/logo',{method:'POST',body:JSON.stringify({mime:file.type,base64})});
    await refreshHotelLogo();
    message.textContent='Logo saved. New invoices will preserve this branding.';
  }catch(error){message.textContent=error.message;}
  finally{button.disabled=false;}
};
$('#business-form').onsubmit=async event=>{
  event.preventDefault();
  const form=event.currentTarget,message=$('#settings-message'),button=form.querySelector('[type=submit]');
  button.disabled=true;message.textContent='';
  try{
    const body=Object.fromEntries(new FormData(form));
    businessSettings=await api('/api/settings/business',{method:'PUT',body:JSON.stringify(body)});
    message.textContent='Saved successfully';
  }catch(e){message.textContent=e.message;}
  finally{button.disabled=false;}
};
$('#logout').onclick=async()=>{
  try{await api('/api/auth/logout',{method:'POST',body:'{}'});window.location.href='/login.html';}
  catch(e){alert(e.message);}
};
$('#new-booking').onclick=openNew;
$('#close-dialog').onclick=closeBookingEditor;
$('#cancel-dialog').onclick=closeBookingEditor;
$('#category-select').onchange=()=>{updateRoomOptions();updatePreview();};
$('#room-assignment-list').onchange=()=>{
  delete $('#booking-form').dataset.pendingRequestId;
  updatePreview();
};
$('#booking-form').oninput=event=>{
  if(!editingId&&event.target.name)delete event.currentTarget.dataset.pendingRequestId;
  updatePreview();
};
$('#booking-form').onchange=event=>{
  if(!editingId&&event.target.name)delete event.currentTarget.dataset.pendingRequestId;
};
$('#search').oninput=renderBookings;
$('#booking-status-filter').onchange=renderBookings;
$('#booking-work-filter').onchange=renderBookings;
for(const button of document.querySelectorAll('[data-booking-queue]')){
  button.onclick=()=>{
    $('#booking-work-filter').value=button.dataset.bookingQueue;
    $('#booking-status-filter').value='all';
    $('#search').value='';
    renderBookings();
  };
}
$('#booking-clear-filters').onclick=()=>{
  $('#booking-status-filter').value='all';$('#booking-work-filter').value='all';
  $('#search').value='';renderBookings();
};
$('#calendar-mode').onclick=()=>setCalendarMode(calendarMode==='week'?'month':'week');
$('#week-prev').onclick=()=>{weekStart=calendarMode==='month'?new Date(weekStart.getFullYear(),weekStart.getMonth()-1,1):addDays(weekStart,-7);renderCalendar();};
$('#week-next').onclick=()=>{weekStart=calendarMode==='month'?new Date(weekStart.getFullYear(),weekStart.getMonth()+1,1):addDays(weekStart,7);renderCalendar();};
$('#week-today').onclick=()=>{weekStart=new Date();weekStart=addDays(weekStart,-((weekStart.getDay()+6)%7));renderCalendar();};
$('#backup-button').onclick=()=>{window.location.href='/api/backup';};
$('#booking-form').onsubmit=async e=>{
  e.preventDefault();
  if(bookingSavePending)return;
  const form=e.currentTarget, data=Object.fromEntries(new FormData(form));
  data.room_ids=[...document.querySelectorAll('#room-assignment-list input:checked')].map(x=>Number(x.value));
  const draftError=bookingDraftError(data,data.room_ids.length);
  if(draftError){setMessage(draftError);return;}
  if(!editingId&&Number(data.amount_paid)>0&&!['cash','upi','card','bank'].includes(data.advance_method)){
    setMessage('Choose the advance payment method before saving.');return;
  }
  const submit=$('#booking-submit');
  bookingSavePending=true;submit.disabled=true;
  const editing=editingId!==null;
  if(!editing){
    const request_id=form.dataset.pendingRequestId||crypto.randomUUID();
    form.dataset.pendingRequestId=request_id;
    data.request_id=request_id;
  }
  let savedBookingId=null;
  try{
    if(editing)await api('/api/bookings/'+editingId,{method:'PATCH',body:JSON.stringify(data)});
    else{
      const saved=await api('/api/bookings',{method:'POST',body:JSON.stringify(data)});
      savedBookingId=saved.id;
    }
    delete form.dataset.pendingRequestId;
    captureBookingBaseline();
    $('#booking-dialog').close();
  }catch(error){
    if(!editing&&error instanceof TypeError&&data.request_id){
      // The server may have committed the booking before the network dropped
      // its response. A read-only UUID lookup is definitive and avoids a
      // second room hold or a second payment attempt.
      try{
        const receipt=await api('/api/bookings/request/'+encodeURIComponent(data.request_id));
        if(receipt.recorded){
          delete form.dataset.pendingRequestId;
          captureBookingBaseline();
          $('#booking-dialog').close();
          try{await load();}
          catch(refreshError){
            alert('Booking #'+receipt.id+' was saved, but refreshing failed: '+refreshError.message+
              '. Reload the ledger; do not create another booking.');
            return;
          }
          if(invoiceBookingAfterCreate){
            invoiceBookingAfterCreate=false;
            const saved=bookings.find(b=>b.id===receipt.id);
            if(saved)createInvoice(saved);
          }
          alert('Booking #'+receipt.id+' was saved successfully. The network response was lost, but the original booking was confirmed.');
          return;
        }
        if(receipt.deleted){
          setMessage('This booking request was deleted by the owner. Review the ledger before starting a new booking.');
          return;
        }
        setMessage('The server is reachable, but has no booking under this request ID yet. '+
          'Review the ledger before retrying; unchanged details reuse the same request ID.');
        return;
      }catch(lookupError){
        setMessage('Cannot confirm booking because the local server is unreachable ('+
          error.message+'). Check that FortLedger is still running, reconnect or reopen '+
          window.location.origin+', then check the ledger. Retry only unchanged details '+
          'with this same request ID. Verification: '+lookupError.message);
        return;
      }
    }
    setMessage(editing?'Booking update was not confirmed: '+error.message:
      'Booking creation not confirmed: '+error.message+
      '. Retry unchanged details with the same request ID or review the ledger first.');
    return;
  }finally{
    bookingSavePending=false;submit.disabled=false;
  }
  try{
    await load();
    if(savedBookingId&&invoiceBookingAfterCreate){
      invoiceBookingAfterCreate=false;
      const booking=bookings.find(b=>b.id===savedBookingId);
      if(booking)createInvoice(booking);
    }
  }catch(error){alert('Booking saved, but refreshing failed: '+error.message+
    '. Reload to view the saved reservation.');}
};
$('#refresh-workspace').onclick=async()=>{
  const button=$('#refresh-workspace'),status=$('#refresh-message');
  button.disabled=true;status.textContent='Refreshing current hotel records…';
  try{
    const complete=await load();
    status.textContent=complete?'Hotel records refreshed.':'A newer refresh is replacing this one.';
  }catch(error){
    status.textContent='Could not refresh: '+error.message+
      '. Existing data may be outdated. Check connection before taking further action.';
  }finally{button.disabled=false;}
};
window.addEventListener('online',()=>{void probeServerConnection();});
window.addEventListener('offline',()=>setConnectionStatus('lost'));
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void probeServerConnection();});
// Lightweight read-only connectivity check; never queues or replays financial writes.
setInterval(()=>{if(!document.hidden)void probeServerConnection();},45000);
applyWorkspaceView();
void probeServerConnection();
load().catch(e=>{$('#booking-list').textContent='Unable to load: '+e.message;});
