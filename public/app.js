import {occupiedRoomCount,monthGrid} from './calendar-utils.js';
import {VIEWS,viewForHash} from './navigation.js';
import {matchesWorkQueue} from './booking-work-queue.js';
import {bookingDraftError} from './booking-editor-guards.js';
const $ = selector => document.querySelector(selector);
let currentUser=null;
const can=permission=>Boolean(currentUser&&(currentUser.permissions.includes('*')||currentUser.permissions.includes(permission)));
const VIEW_ACCESS={dashboard:'profile.read',bookings:'bookings.read',rooms:'rooms.read',guests:'guests.read',invoices:'invoices.read',restaurant:'restaurant.read','business-settings':'settings.read',profile:'profile.read'};
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
  window.scrollTo(0,0);
}
window.addEventListener('hashchange',applyWorkspaceView);

const money = paise => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(paise/100);
const label = (tag,text,klass) => {const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(klass)e.className=klass;return e;};
const dateISO = d => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const addDays = (d,days) => { const x=new Date(d.getFullYear(),d.getMonth(),d.getDate()+days);return x; };
const fmtDay = iso => new Date(iso+'T12:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short'});
const statusOptions=['reserved','checked_in','checked_out','cancelled'];
let rooms=[],bookings=[],invoices=[],businessSettings=null,menu=[],restaurantBills=[],maintenanceIssues=[],guests=[],cart=[],editingId=null,weekStart=new Date(),calendarMode='week';
weekStart=addDays(weekStart,-((weekStart.getDay()+6)%7));
async function api(url,options={}){
  const response=await fetch(url,{headers:{'Content-Type':'application/json'},...options});
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
      if(next==='checked_out'){
        if(!confirm('Confirm the guest has physically departed? Checkout will mark assigned rooms as needing cleaning.')){
          status.value=b.status;return;
        }
        try{
          const folio=await api('/api/bookings/'+b.id+'/folio');
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
    stage.append(status);
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
    moreItems.append(history,refundButton,proforma);
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
function renderRooms(){
  const list=$('#room-list');list.replaceChildren();
  for(const room of rooms){
    const row=label('form',undefined,'room-row');
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
function hotelToday(){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
    timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(new Date()).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  return parts.year+'-'+parts.month+'-'+parts.day;
}
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
    return Number.isFinite(Date.parse(stamp))&&dateISO(new Date(stamp))===today;
  });
  const active=bookings.filter(b=>b.status!=='cancelled');
  const kpis=can('bookings.read')?[
    ['Arrivals today',active.filter(b=>b.checkin===today).length,'Scheduled check-ins'],
    ['Occupied tonight',active.filter(b=>b.checkin<=today&&today<b.checkout).reduce((n,b)=>n+b.rooms_count,0)+' / 7','Physical rooms'],
    ['Outstanding',money(active.reduce((n,b)=>n+(b.due_paise||0),0)),'Guest booking balances'],
    ['Departures today',active.filter(b=>b.checkout===today).length,'Scheduled check-outs']
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
async function load(){
  currentUser=await api('/api/me');
  [rooms,bookings,invoices,businessSettings,menu,restaurantBills,maintenanceIssues,guests]=await Promise.all([
    can('rooms.read')?api('/api/rooms'):Promise.resolve([]),
    can('bookings.read')?api('/api/bookings'):can('restaurant.read')?api('/api/restaurant/checked-in'):Promise.resolve([]),
    can('invoices.read')?api('/api/invoices'):Promise.resolve([]),
    can('settings.read')?api('/api/settings/business'):Promise.resolve(null),
    can('restaurant.read')?api('/api/restaurant/menu'):Promise.resolve([]),
    can('restaurant.read')?api('/api/restaurant/bills'):Promise.resolve([]),
    can('maintenance.read')?api('/api/maintenance'):Promise.resolve([]),
    can('guests.read')?api('/api/guests'):Promise.resolve([])
  ]);
  renderMenu();renderCart();renderRestaurantHistory();
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
  $('#import-menu').hidden=!can('restaurant.write');
  $('#preview-menu').hidden=!can('restaurant.write');
  $('#staff-admin').hidden=currentUser.role!=='owner';
  $('#guest-create').hidden=!can('guests.write');
  const settingsSave=$('#business-form').querySelector('[type=submit]');
  if(settingsSave)settingsSave.disabled=!can('settings.admin');
  await renderProfile();
  renderDashboard();
  await renderCollections();
  if(can('finance.read')){await renderExpenseList();await renderDailyClose();}
  $('#invoice-empty-action').hidden=Boolean(invoices.length)||!can('bookings.read');
  if(!menu.length&&can('restaurant.write'))$('#menu-import-section').open=true;
  applyWorkspaceView();
}
function renderInvoices(){
  const list=$('#invoice-list');list.replaceChildren();
  if(!invoices.length)list.append(label('p','No proforma invoices yet. Create one from a booking.','muted'));
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
  const paid=bookings.find(b=>b.id===invoiceBookingId)?.paid_paise||0;
  invoice.textContent=lines.length+' line(s) · Total '+money(Math.round(total*100))+
    ' · Advance '+money(paid)+' · Due '+money(Math.max(0,Math.round(total*100)-paid));
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
  $('#initial-advance').disabled=false;$('#initial-advance').closest('label').hidden=false;
  $('#advance-method').disabled=false;$('#advance-method').closest('label').hidden=false;
  setMessage('');updateRoomOptions();updatePreview();captureBookingBaseline();$('#booking-dialog').showModal();
}
function openEdit(b){
  editingId=b.id;
  const form=$('#booking-form');form.reset();
  delete form.dataset.pendingRequestId;
  refreshGuestPicker(b.guest_id||'');
  ['guest_name','company_name','checkin','checkout','rooms_count','meal_plan','nightly_rate'].forEach(k=>{
    const field=form.elements.namedItem(k);
    field.value=k==='nightly_rate'?(b.nightly_rate_paise/100):b[k];
  });
  $('#category-select').value=b.category;updateRoomOptions(b.room_ids||[]);
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

function renderMenu(){
  const list=$('#menu-items');list.replaceChildren();
  const query=$('#menu-search').value.trim().toLowerCase();
  for(const item of menu.filter(x=>(x.name+' '+x.category).toLowerCase().includes(query))){
    const row=label('div',undefined,'menu-item');
    const details=label('div');details.append(label('strong',item.name),label('small',item.category+' · '+money(item.price_paise)));
    const add=label('button','+ Add','secondary');add.onclick=()=>{const existing=cart.find(x=>x.menu_item_id===item.id);if(existing)existing.quantity++;else cart.push({menu_item_id:item.id,quantity:1});renderCart();};
    if(can('restaurant.write'))row.append(details,add);else row.append(details);
    list.append(row);
  }
  if(!list.children.length)list.append(label('p','No menu items found. Import a CSV to start.','muted'));
  const guest=$('#restaurant-guest'),old=guest.value;guest.replaceChildren();
  const manual=label('option','Manual room / guest entry');manual.value='manual';guest.append(manual);
  for(const b of bookings.filter(x=>x.status==='checked_in')){
    const option=label('option',b.guest_name+' · '+(b.assigned_room||b.category));option.value=b.id;guest.append(option);
  }
  if([...guest.options].some(x=>x.value===old))guest.value=old;
  updateManualRoomFields();
}
function renderCart(){
  const list=$('#cart-items');list.replaceChildren();
  for(const entry of cart){
    const item=menu.find(x=>x.id===entry.menu_item_id);if(!item)continue;
    const row=label('div',undefined,'cart-row');
    const text=label('span',item.name+' · '+money(item.price_paise));
    const controls=label('div',undefined,'cart-actions');
    const minus=label('button','−','secondary');minus.onclick=()=>{entry.quantity--;if(entry.quantity<1)cart=cart.filter(x=>x!==entry);renderCart();};
    const count=label('strong',String(entry.quantity));
    const plus=label('button','+','secondary');plus.onclick=()=>{if(entry.quantity<100)entry.quantity++;renderCart();};
    controls.append(minus,count,plus);row.append(text,controls);list.append(row);
  }
  if(!cart.length)list.append(label('p','Select a menu item to begin.','muted'));
  const total=cart.reduce((s,x)=>s+(menu.find(y=>y.id===x.menu_item_id)?.price_paise||0)*x.quantity,0);
  $('#cart-total').textContent='Total (inclusive) '+money(total);
}
function renderRestaurantHistory(){
  const list=$('#restaurant-history');list.replaceChildren();
  for(const bill of restaurantBills.slice(0,15)){
    const row=label('div',undefined,'menu-item');
    const details=label('div');details.append(label('strong','#'+bill.id+' · '+bill.payment_method.toUpperCase()),label('small',money(bill.total_paise)));
    const print=label('button','Print receipt','secondary');
    print.onclick=()=>window.open('/api/restaurant/bills/'+bill.id+'/receipt','_blank','noopener');
    const lan=label('button','LAN Print','secondary');
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
    if(bill.payment_method==='room'&&bill.booking_id===null){
      details.append(label('small','Needs review · '+(bill.manual_room||'Unknown room')+' · '+(bill.manual_guest||'Unknown guest')));
      const link=label('button','Link to guest','secondary');
      link.onclick=()=>linkPendingCharge(bill);
      row.append(link);
    }
    row.append(details,print,lan);
    list.append(row);
  }
  if(!restaurantBills.length)list.append(label('p','No restaurant bills yet.','muted'));
}
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
  if(!confirm('Link food bill #'+bill.id+' to '+booking.guest_name+
    '? This will add the unpaid charge to their folio.'))return;
  try{
    await api('/api/restaurant/bills/'+bill.id+'/link-booking',{
      method:'POST',body:JSON.stringify({booking_id:booking.id})
    });
    await load();
    alert('Restaurant bill linked to the selected guest for settlement.');
  }catch(error){alert(error.message);}
}
$('#menu-search').oninput=renderMenu;
$('#restaurant-method').onchange=()=>{
  $('#room-charge-choice').hidden=$('#restaurant-method').value!=='room';
  updateManualRoomFields();
};
$('#restaurant-guest').onchange=updateManualRoomFields;
$('#save-restaurant-bill').onclick=async()=>{
  const method=$('#restaurant-method').value,message=$('#restaurant-message');
  if(!cart.length){message.textContent='Add at least one item.';return;}
  const manual=method==='room'&&$('#restaurant-guest').value==='manual';
  const body={payment_method:method,items:cart,
    booking_id:method==='room'&&!manual?Number($('#restaurant-guest').value):undefined};
  if(manual){
    body.manual_room=$('#manual-room-number').value.trim();
    body.manual_guest=$('#manual-room-guest').value.trim();
    if(!body.manual_room||!body.manual_guest){message.textContent='Enter room identifier and guest name for manual review.';return;}
  }
  if(method==='room'&&!manual&&!body.booking_id){message.textContent='Choose a checked-in guest or manual entry.';return;}
  if(!confirm('Save this restaurant bill?'))return;
  const button=$('#save-restaurant-bill');button.disabled=true;
  try{await api('/api/restaurant/bills',{method:'POST',body:JSON.stringify(body)});cart=[];message.textContent='Bill saved locally.';await load();}
  catch(e){message.textContent=e.message;}
  finally{button.disabled=false;}
};
let validatedMenuCsv=null;
async function readMenuCsv(){
  const file=$('#menu-csv').files[0];
  if(!file)throw new Error('Choose a CSV file first.');
  if(file.size>65000)throw new Error('CSV must be smaller than 65 KB.');
  return file.text();
}
$('#menu-csv').onchange=()=>{
  validatedMenuCsv=null;
  $('#import-menu').disabled=true;
  $('#menu-import-message').textContent='';
  $('#menu-import-preview').replaceChildren();
};
$('#preview-menu').onclick=async()=>{
  const message=$('#menu-import-message'),list=$('#menu-import-preview');
  message.textContent='';list.replaceChildren();validatedMenuCsv=null;$('#import-menu').disabled=true;
  try{
    const csv=await readMenuCsv();
    const result=await api('/api/restaurant/menu/preview',{method:'POST',body:JSON.stringify({csv})});
    validatedMenuCsv=csv;
    message.textContent=result.count+' item(s) validated. Check the rates and import when ready.';
    const table=label('table',undefined,'import-preview-table');
    for(const item of result.preview){
      const row=label('tr');
      row.append(label('td',item.name),label('td',item.category),
        label('td',money(item.price_paise)),label('td',item.tax_rate+'%'));
      table.append(row);
    }
    list.append(table);
    $('#import-menu').disabled=false;
  }catch(error){message.textContent='Import check failed: '+error.message;}
};
$('#import-menu').onclick=async()=>{
  const message=$('#menu-import-message');
  if(!validatedMenuCsv){message.textContent='Check the CSV file before importing.';return;}
  const button=$('#import-menu');button.disabled=true;
  try{
    const result=await api('/api/restaurant/menu/import',{
      method:'POST',body:JSON.stringify({csv:validatedMenuCsv})
    });
    validatedMenuCsv=null;
    message.textContent='Imported '+result.imported+' menu items successfully. You can now search and add them to a bill.';
    await load();
  }catch(error){message.textContent='Import failed: '+error.message;button.disabled=false;}
};

let activeFolioBooking=null;
async function showFolio(booking){
  activeFolioBooking=booking.id;
  $('#folio-dialog').showModal();
  await refreshFolio();
}
async function refreshFolio(){
  const data=await api('/api/bookings/'+activeFolioBooking+'/folio');
  $('#folio-name').textContent=data.guest_name;
  $('#folio-summary').textContent='Accommodation due '+money(data.accommodation.due_paise)+
    ' · Restaurant room charges due '+money(data.restaurant_due_paise)+
    ' · Combined due '+money(data.combined_due_paise);
  const list=$('#folio-room-bills');list.replaceChildren();
  for(const bill of data.bills){
    const row=label('div',undefined,'menu-item');
    const details=label('div');details.append(label('strong','Food bill #'+bill.id),label('small',money(bill.total_paise)+(bill.settlement_id?' · Settled':' · Unsettled')));
    const button=label('button',bill.settlement_id?'Paid':'Settle separately','secondary');
    button.disabled=Boolean(bill.settlement_id);
    button.onclick=async()=>{
      if(!confirm('Record separate payment of '+money(bill.total_paise)+' for food bill #'+bill.id+'?'))return;
      try{
        await api('/api/bookings/'+activeFolioBooking+'/folio/room-bills/'+bill.id+'/settle',{method:'POST',body:JSON.stringify({method:$('#folio-method').value})});
        $('#folio-message').textContent='Separate food payment saved.';await refreshFolio();
      }catch(e){$('#folio-message').textContent=e.message;}
    };
    row.append(details,button);list.append(row);
  }
  if(!data.bills.length)list.append(label('p','No restaurant room charges linked to this guest.','muted'));
  $('#folio-combined').disabled=data.combined_due_paise===0||data.status==='cancelled';
  $('#folio-combined').textContent='Settle all outstanding · '+money(data.combined_due_paise);
}
$('#close-folio').onclick=()=>$('#folio-dialog').close();
$('#folio-combined').onclick=async()=>{
  const message=$('#folio-message');
  if(!confirm('Record full accommodation and unpaid restaurant balance as paid?'))return;
  const button=$('#folio-combined');button.disabled=true;
  try{
    await api('/api/bookings/'+activeFolioBooking+'/folio/settle-combined',{method:'POST',body:JSON.stringify({method:$('#folio-method').value})});
    message.textContent='Combined payment saved. No duplicate charges recorded.';
    await load();await refreshFolio();
  }catch(e){message.textContent=e.message;button.disabled=false;}
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
  try{
    if(editing)await api('/api/bookings/'+editingId,{method:'PATCH',body:JSON.stringify(data)});
    else await api('/api/bookings',{method:'POST',body:JSON.stringify(data)});
    delete form.dataset.pendingRequestId;
    captureBookingBaseline();
    $('#booking-dialog').close();
  }catch(error){
    setMessage(error.message);
    if(!editing)setMessage('Booking creation not confirmed: '+error.message+
      '. Retry unchanged details safely with the same request ID, or review the ledger first.');
    return;
  }finally{
    bookingSavePending=false;submit.disabled=false;
  }
  try{await load();}
  catch(error){alert('Booking saved, but refreshing failed: '+error.message+
    '. Reload to view the saved reservation.');}
};
applyWorkspaceView();
load().catch(e=>{$('#booking-list').textContent='Unable to load: '+e.message;});
