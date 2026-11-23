import {occupiedRoomCount,monthGrid} from './calendar-utils.js';
import {VIEWS,viewForHash} from './navigation.js';
import {createWorkspaceNavigator} from './workspace-navigation.js';
import {createConfirmAction} from './ui-dialog.js';
import {matchesWorkQueue,bookingNextActionCue} from './booking-work-queue.js';
import {BOOKING_CARD_BATCH,bookingCardPage} from './booking-card-page.js';
import {bookingDraftError} from './booking-editor-guards.js';
import {todayAttention} from './today-attention.js';
import {prepareDailyClosing} from './daily-close-preparation.js';
import {shiftHandover} from './shift-handover.js';
import {stayMetrics} from './stay-metrics.js';
import {createOwnerUpdateNotice} from './update-notice.js';
const $ = selector => document.querySelector(selector);
const confirmAction=createConfirmAction($('#shizuka-confirm-dialog'));
$('#skip-to-main').onclick=()=>{
  const main=$('#workspace-main');
  main.focus({preventScroll:true});
  main.scrollIntoView({block:'start'});
};

function setupSidebarToggle(){
  const sidebar=document.querySelector('.sidebar'),button=$('#sidebar-toggle');
  if(!sidebar||!button)return;
  let collapsed=false;
  try{collapsed=localStorage.getItem('fortledger.sidebar.compact')==='1';}catch{}
  function update(){
    sidebar.classList.toggle('is-collapsed',collapsed);
    button.setAttribute('aria-expanded',String(!collapsed));
    const action=collapsed?'Expand sidebar':'Minimise sidebar';
    button.setAttribute('aria-label',action);
    button.title=action;
    button.querySelector('span').textContent=collapsed?'›':'‹';
    for(const anchor of sidebar.querySelectorAll('nav a')){
      const name=anchor.querySelector('.nav-label')?.textContent?.trim();
      if(name)anchor.title=collapsed?name:'';
    }
  }
  button.onclick=()=>{
    collapsed=!collapsed;update();
    try{localStorage.setItem('fortledger.sidebar.compact',collapsed?'1':'0');}catch{}
  };
  update();
}
setupSidebarToggle();
let currentUser=null;
const updateNotice=createOwnerUpdateNotice({
  check:()=>api('/api/system/updates'),
  show:()=>{
    $('#owner-update-notice').hidden=false;
    $('#owner-update-notice').title='A newer FortLedger build is available; review before installing';
  },
  hide:()=>{$('#owner-update-notice').hidden=true;}
});
function refreshOwnerUpdateNotice(){
  // Never let network checks slow or interrupt a booking, invoice or payment.
  // Read-only owner notice; code update requires explicit readiness and approval.
  void updateNotice.refresh({
    owner:currentUser?.role==='owner'&&can('system.update'),
    local:['127.0.0.1','localhost'].includes(window.location.hostname)
  });
}
$('#owner-update-notice').onclick=()=>{
  if(currentUser?.role!=='owner'||!can('system.update'))return;
  window.location.hash='profile';
  $('#update-center-check').click();
};
const can=permission=>Boolean(currentUser&&(currentUser.permissions.includes('*')||currentUser.permissions.includes(permission)));
const VIEW_ACCESS={dashboard:'profile.read',bookings:'bookings.read',rooms:'rooms.read',guests:'guests.read',invoices:'invoices.read',restaurant:'restaurant.pos','restaurant-admin':'menu.manage','business-settings':'settings.read',profile:'profile.read'};
const isRestaurantCashier=()=>currentUser?.role==='cashier'||currentUser?.unsecured_fixture===true;
function canVisitView(view){
  if(!currentUser)return true;
  if(view==='restaurant')return isRestaurantCashier();
  if(view==='restaurant-admin')return currentUser.role==='owner'||
    currentUser.role==='manager'||currentUser.unsecured_fixture===true;
  if(view==='dashboard'&&currentUser.role==='cashier')return false;
  return can(VIEW_ACCESS[view]);
}
const workspaceNavigator=createWorkspaceNavigator({win:window,doc:document,
  render:applyWorkspaceView,views:VIEWS,canVisit:canVisitView});
function routeRestaurantNavigation(){
  const admin=currentUser&&['owner','manager'].includes(currentUser.role)&&!currentUser.unsecured_fixture;
  const dest=admin?'restaurant-admin':'restaurant';
  const links=[...document.querySelectorAll('.sidebar nav a[href^="#restaurant"], #mobile-shortcuts a[data-view^="restaurant"]')];
  for(const link of links){
    link.setAttribute('href','#'+dest);
    if(link.dataset.view)link.dataset.view=dest;
    const name=link.querySelector('.nav-label');
    if(name)name.textContent=admin?'Restaurant management':'Restaurant';
    else link.textContent=admin?'Restaurant admin':'Restaurant';
  }
}
function applyWorkspaceView(){
  routeRestaurantNavigation();
  let view=viewForHash(window.location.hash);
  if(currentUser&&!canVisitView(view))
    view=can('bookings.read')?'bookings':canVisitView('restaurant')?'restaurant':
      canVisitView('restaurant-admin')?'restaurant-admin':'profile';
  const history=$('#restaurant-history-section');
  const admin=['owner','manager'].includes(currentUser?.role)&&!currentUser?.unsecured_fixture;
  const host=admin?$('#restaurant-admin-history-slot'):$('#restaurant');
  if(history.parentElement!==host)host.append(history);
  const config=VIEWS[view],shown=new Set(config.sections);
  // Only the no-auth disposable test fixture shows both areas together.
  if(currentUser?.unsecured_fixture&&view==='restaurant')shown.add('restaurant-admin');
  for(const id of ['dashboard','stats','calendar','bookings','guests','rooms','invoices','restaurant','restaurant-admin','business-settings','roadmap','profile']){
    const panel=document.getElementById(id);
    if(panel)panel.hidden=!shown.has(id);
  }
  renderRestaurantWorkspaceTab();
  $('#workspace-title').textContent=config.title;
  $('#workspace-subtitle').textContent=config.subtitle;
  $('#new-booking').hidden=view!=='bookings'||!can('bookings.write');
  for(const nav of document.querySelectorAll('.sidebar nav a')){
    nav.hidden=Boolean(currentUser&&!canVisitView(viewForHash(nav.getAttribute('href'))));
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
    anchor.hidden=Boolean(!currentUser||!canVisitView(target));
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
document.addEventListener('keydown',event=>{
  if(event.key!=='Escape')return;
  const panel=$('#mobile-more-panel'),toggle=$('#mobile-more-toggle');
  if(panel.hidden)return;
  event.preventDefault();
  panel.hidden=true;
  toggle.setAttribute('aria-expanded','false');
  toggle.focus({preventScroll:true});
});
window.addEventListener('hashchange',applyWorkspaceView);

const money = paise => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(paise/100);
const label = (tag,text,klass) => {const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(klass)e.className=klass;return e;};
const dateISO = d => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const addDays = (d,days) => { const x=new Date(d.getFullYear(),d.getMonth(),d.getDate()+days);return x; };
const fmtDay = iso => new Date(iso+'T12:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short'});
const statusOptions=['reserved','checked_in','checked_out','cancelled'];
let rooms=[],bookings=[],invoices=[],businessSettings=null,menu=[],restaurantTables=[],restaurantBills=[],maintenanceIssues=[],guests=[],backupStatus=null,closeAttention=[],cart=[],editingId=null,weekStart=new Date(),calendarMode='week';
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
let bookingCardVisibleCount=BOOKING_CARD_BATCH,lastBookingFilterKey='';
function renderBookings(){
  const q=$('#search').value.trim().toLowerCase(),list=$('#booking-list');list.replaceChildren();
  const statusFilter=$('#booking-status-filter')?.value||'all';
  const workFilter=$('#booking-work-filter')?.value||'all';
  for(const button of document.querySelectorAll('[data-booking-queue]')){
    button.setAttribute('aria-pressed',String(button.dataset.bookingQueue===workFilter));
  }
  const today=hotelToday();
  const filterKey=JSON.stringify([q,statusFilter,workFilter]);
  if(filterKey!==lastBookingFilterKey){
    bookingCardVisibleCount=BOOKING_CARD_BATCH;
    lastBookingFilterKey=filterKey;
  }
  const filtered=bookings.filter(b=>
    (statusFilter==='all'||b.status===statusFilter)&&
    matchesWorkQueue(b,workFilter,today)&&
    [String(b.id),b.guest_name,b.company_name,b.category,b.assigned_room||'']
      .some(v=>String(v||'').toLowerCase().includes(q)));
  const page=bookingCardPage(filtered,bookingCardVisibleCount);
  const count=$('#booking-results-count');
  count.textContent=page.shown+' of '+filtered.length+' matching bookings shown'+
    (filtered.length!==bookings.length?' · '+bookings.length+' saved total':'')+
    (workFilter!=='all'?' · hotel date '+today:'');
  const loadMore=$('#booking-list-more');
  loadMore.hidden=!page.hasMore;
  loadMore.textContent='Show '+Math.min(BOOKING_CARD_BATCH,page.remaining)+
    ' more bookings ('+page.remaining+' remaining)';
  if(!filtered.length)list.append(label('p',
    bookings.length?'No bookings match these filters. Clear filters to view the ledger.':
      'No bookings yet. Create your first reservation.','muted'));
  for(const b of page.items){
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
// Incrementally expand only visible DOM cards; every record remains in memory
// for full search, availability, calendar, payments and invoice views.
$('#booking-list-more').onclick=()=>{
  bookingCardVisibleCount+=BOOKING_CARD_BATCH;
  renderBookings();
};
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
      workspaceNavigator.navigate(isRestaurantCashier()?'restaurant':'restaurant-admin','restaurant-history-section');
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
  renderShiftHandover(today);
  const actions=$('#home-actions');actions.replaceChildren();
  const options=[
    ['#bookings','Booking calendar','Manage stays and room allocations','bookings.read'],
    [isRestaurantCashier()?'#restaurant':'#restaurant-admin',isRestaurantCashier()?'Restaurant POS':'Restaurant management',isRestaurantCashier()?'New bill and saved receipts':'Manage menu, receipts and tables',isRestaurantCashier()?'restaurant.pos':'menu.manage'],
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
function renderShiftHandover(today){
  const panel=$('#shift-handover'),list=$('#shift-handover-items');
  const access={bookings:can('bookings.read'),rooms:can('rooms.read'),
    restaurant:can('restaurant.read'),maintenance:can('maintenance.read'),
    finance:can('finance.read'),health:can('system.health.read')};
  panel.hidden=!Object.values(access).some(Boolean);
  if(panel.hidden)return;
  const alerts=shiftHandover({
    today,
    bookings:access.bookings?bookings:[],
    rooms:access.rooms?rooms:[],
    restaurantBills:access.restaurant?restaurantBills:[],
    maintenanceIssues:access.maintenance?maintenanceIssues:[],
    backupStatus:access.health?backupStatus:null,
    closeAttention:access.finance?closeAttention:[],
    access
  });
  $('#shift-handover-summary').textContent='Shift handover · '+alerts.length+
    (alerts.length===1?' item to review':' items to review');
  list.replaceChildren();
  if(!alerts.length){
    list.append(label('p','No pending work found in the current loaded records.','muted'));
    return;
  }
  for(const entry of alerts.slice(0,18)){
    const button=label('button',undefined,'shift-handover-row secondary'+
      (entry.severity==='urgent'?' shift-handover-urgent':''));
    button.type='button';
    button.append(label('strong',entry.title),label('span',entry.reason));
    button.setAttribute('aria-label',entry.title+'. '+entry.reason+'. Open source records.');
    button.onclick=()=>{
      const booking=bookings.find(b=>b.id===entry.record_id);
      if(entry.kind==='notes'&&booking)return openBookingNotes(booking);
      if(entry.kind==='arrival'&&booking){
        if(booking.checkin<today)return openEdit(booking);
        return openFilteredBookingQueue('arrivals');
      }
      if(entry.kind==='departure')return openFilteredBookingQueue('departures');
      if(entry.kind==='allocation')return openFilteredBookingQueue('unassigned');
      if(entry.kind==='readiness'){
        // Navigate to the exact existing physical room. A tomorrow maintenance
        // block need not be marked "out of service today" in the room list.
        roomReadinessFilter='all';
        renderRooms();
        const room=rooms.find(r=>r.id===entry.first_room_id);
        return workspaceNavigator.navigate('rooms',room?
          'room-record-'+room.id:'room-list');
      }
      if(entry.kind==='room')return openRoomAttention();
      if(entry.kind==='maintenance')
        return workspaceNavigator.navigate('rooms','maintenance-workspace');
      if(entry.kind==='restaurant'){
        restaurantBillFilter='unmatched';
        $('#restaurant-history-search').value='';
        restaurantHistoryLimit=Math.max(15,restaurantBills.length);
        renderRestaurantHistory();
        return workspaceNavigator.navigate('restaurant','restaurant-bill-'+entry.record_id);
      }
      if(entry.kind==='closing'){
        $('#home-closing').open=true;
        $('#daily-close-form').elements.namedItem('business_date').value=entry.record_id;
        void renderDailyClose();
        return workspaceNavigator.navigate('dashboard','home-closing');
      }
      if(entry.kind==='backup')return can('system.update')?
        workspaceNavigator.navigate('profile','backup-center'):
        workspaceNavigator.navigate('business-settings');
    };
    list.append(button);
  }
  if(alerts.length>18)
    list.append(label('p',(alerts.length-18)+' more items. Use the existing work queues to review all records.','muted'));
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
let closingPreparationRevision=0;
async function renderDailyClosePreparation(){
  if(!can('finance.read')||!$('#home-closing').open)return;
  const form=$('#daily-close-form');
  const day=form.elements.namedItem('business_date').value;
  if(!day)return;
  const version=++closingPreparationRevision;
  const status=$('#daily-close-preparation-status');
  const area=$('#daily-close-preparation-items');
  area.replaceChildren();
  status.textContent='Checking current recorded collections for '+day+'…';
  try{
    // Read existing daily ledger, not a parallel financial event stream.
    const report=await api('/api/finance/daily?date='+encodeURIComponent(day));
    if(version!==closingPreparationRevision||!$('#home-closing').open||
       form.elements.namedItem('business_date').value!==day)return;
    const preview=prepareDailyClosing(report);
    const table=label('table',undefined,'daily-close-preview-table');
    const head=label('thead'),headers=label('tr');
    for(const heading of ['Method','Accommodation','Restaurant','Refunds','Expenses','Net received'])
      headers.append(label('th',heading));
    head.append(headers);table.append(head);
    const body=label('tbody');
    for(const item of preview.methods){
      const row=label('tr');
      row.append(label('th',item.method.toUpperCase()),
        label('td',money(item.hotel_paise)),
        label('td',money(item.restaurant_paise)),
        label('td',money(item.refund_paise)),
        label('td',money(item.expense_paise)),
        label('td',money(item.net_collected_paise)));
      body.append(row);
    }
    table.append(body);area.append(table);
    area.append(label('p','Total recorded receipts: '+money(report.net_collections_paise)+
      ' · Recorded expenses: '+money(report.expenses_paid_paise)+
      ' · Net cash movement: '+money(report.net_cash_movement_paise),'muted'));
    area.append(label('p','Cash method movement after recorded expenses: '+
      money(preview.cash_net_movement_paise)+
      ' (opening float and physical counted cash are not included).','muted'));
    if(preview.warnings.length){
      const problems=label('ul',undefined,'daily-close-preparation-warnings');
      for(const issue of preview.warnings)problems.append(label('li',issue));
      area.append(problems);
    }
    status.textContent=preview.disclaimer+' Updated from current ledger on opening this panel.';
  }catch(error){
    if(version!==closingPreparationRevision)return;
    status.textContent='Closing preparation unavailable: '+error.message+
      '. Review the original ledger before closing; no values were changed.';
  }
}
$('#home-closing').addEventListener('toggle',()=>{
  if($('#home-closing').open)void renderDailyClosePreparation();
  else closingPreparationRevision++;
});
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
$('#daily-close-form').elements.namedItem('business_date').onchange=()=>{
  void renderDailyClose();
  if($('#home-closing').open)void renderDailyClosePreparation();
};
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
    allowed('restaurant.read')?api('/api/restaurant/tables'):Promise.resolve([]),
    allowed('maintenance.read')?api('/api/maintenance'):Promise.resolve([]),
    allowed('guests.read')?api('/api/guests'):Promise.resolve([]),
    allowed('system.health.read')?api('/api/system/backup-status'):Promise.resolve(null),
    allowed('finance.read')?api('/api/finance/closing/attention'):Promise.resolve([])
  ]);
  if(revision!==workspaceLoadRevision)return false;
  currentUser=operator;
  $('#gst-readiness').hidden=!['owner','manager'].includes(currentUser?.role)||!can('tax.review');
  $('#historical-invoice-originals').hidden=currentUser?.role!=='owner';
  [rooms,bookings,invoices,businessSettings,menu,restaurantBills,restaurantTables,maintenanceIssues,guests,backupStatus,closeAttention]=snapshot;
  renderMenu();refreshRestaurantGuestPicker();renderRestaurantTablePicker();renderCart();renderRestaurantHistory();
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
  $('#save-restaurant-bill').hidden=!can('restaurant.pos')||!isRestaurantCashier();
  $('#restaurant-reconciliation-section').hidden=!can('finance.read');
  if(!$('#restaurant-reconciliation-date').value)
    $('#restaurant-reconciliation-date').value=hotelToday();
  $('#menu-import-section').hidden=!can('menu.manage');
  $('#restaurant-table-management').hidden=!can('menu.manage');
  $('#restaurant-jump-menu').hidden=false;
  $('#import-menu').hidden=!can('menu.manage');
  $('#preview-menu').hidden=!can('menu.manage');
  $('#staff-admin').hidden=currentUser.role!=='owner';
  $('#update-center').hidden=!can('system.update');
  $('#backup-center').hidden=!can('system.update');
  $('#release-status-panel').hidden=currentUser.role!=='owner'||!can('system.update')||
    !['127.0.0.1','localhost'].includes(window.location.hostname);
  // Off-device encrypted backup preparation is deliberately a local owner
  // operation; never offer it to staff phones or private-LAN sessions.
  $('#backup-upgrade-preparation').hidden=!can('system.update')||
    currentUser.role!=='owner'||!['127.0.0.1','localhost'].includes(window.location.hostname);
  refreshOwnerUpdateNotice();
  $('#guest-create').hidden=!can('guests.write');
  const settingsSave=$('#business-form').querySelector('[type=submit]');
  if(settingsSave)settingsSave.disabled=!can('settings.admin');
  await renderProfile();
  renderDashboard();
  await renderCollections();
  if(can('finance.read')){await renderExpenseList();await renderDailyClose();}
  $('#invoice-empty-action').hidden=Boolean(invoices.length)||!can('bookings.read');
  if(!menu.length&&can('menu.manage')){
    $('#menu-import-section').open=true;
    $('#bundled-menu-section').open=true;
  }
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
// Historical online-generator originals. The browser sees local PDFs only
// after the owner selects them. The server never browses arbitrary directories.
const MAX_ORIGINAL_PDF=8*1024*1024;
let externalOriginalOffset=0,externalOriginalQuery='',externalOriginalBusy=false;
function selectedOriginals(){
  return Array.from($('#external-doc-files').files||[]);
}
$('#external-doc-files').addEventListener('change',()=>{
  const files=selectedOriginals();
  const bytes=files.reduce((sum,file)=>sum+file.size,0);
  const invalid=files.filter(file=>file.size<64||file.size>MAX_ORIGINAL_PDF||
    !file.name.toLowerCase().endsWith('.pdf'));
  $('#external-doc-selection').textContent=files.length?
    files.length+' PDF file(s) selected · '+(bytes/1048576).toFixed(1)+
      ' MiB · '+(invalid.length?invalid.length+' invalid or oversized file(s) — choose PDF files under 8 MiB':
      'nothing copied yet; original folder remains unchanged'):
    'No files selected. Nothing has been copied.';
  $('#external-doc-import').disabled=!files.length||Boolean(invalid.length)||externalOriginalBusy;
});
async function refreshExternalOriginals(reset=true){
  if(currentUser?.role!=='owner')return;
  const query=$('#external-doc-search').value.trim();
  if(reset||query!==externalOriginalQuery){
    externalOriginalOffset=0;externalOriginalQuery=query;
    $('#external-doc-list').replaceChildren();
  }
  const more=$('#external-doc-more');more.disabled=true;
  try{
    const data=await api('/api/external-invoice-originals?q='+
      encodeURIComponent(externalOriginalQuery)+'&offset='+externalOriginalOffset);
    const list=$('#external-doc-list');
    if(!externalOriginalOffset&&!data.items.length)
      list.append(label('p','No archived originals match this search. Choose PDFs above to make a verified local copy.','muted'));
    for(const documentEntry of data.items){
      const row=label('div',undefined,'external-original-row');
      const text=label('div');
      text.append(label('strong',documentEntry.original_filename),
        label('small','Archive #'+documentEntry.id+' · '+(documentEntry.size_bytes/1024).toFixed(0)+
          ' KiB · imported '+documentEntry.imported_at+' UTC · checksum '+documentEntry.sha256.slice(0,12)));
      const link=label('a','Download saved original','secondary');
      link.href='/api/external-invoice-originals/'+documentEntry.id+'/original';
      link.setAttribute('download',documentEntry.original_filename);
      row.append(text,link);list.append(row);
    }
    externalOriginalOffset+=data.items.length;
    more.hidden=externalOriginalOffset>=data.total;
    more.textContent='Show more originals ('+(data.total-externalOriginalOffset)+' left)';
  }catch(error){
    $('#external-doc-list').append(label('p','Archive search unavailable: '+error.message,'error'));
    more.hidden=true;
  }finally{more.disabled=false;}
}
$('#historical-invoice-originals').addEventListener('toggle',event=>{
  if(event.target.open&&currentUser?.role==='owner')void refreshExternalOriginals();
});
$('#external-doc-refresh').onclick=()=>refreshExternalOriginals();
$('#external-doc-search').addEventListener('keydown',event=>{
  if(event.key==='Enter'){event.preventDefault();void refreshExternalOriginals();}
});
$('#external-doc-more').onclick=()=>refreshExternalOriginals(false);
$('#external-doc-import').onclick=async()=>{
  if(currentUser?.role!=='owner'||externalOriginalBusy)return;
  const files=selectedOriginals();
  if(!files.length)return;
  if(!confirm('Copy '+files.length+' selected PDF original(s) into the protected local FortLedger SQLite archive?'+
      '\\nThe folder files will not change. No invoice number, GST document or email is issued.'))return;
  const button=$('#external-doc-import'),status=$('#external-doc-import-status');
  externalOriginalBusy=true;button.disabled=true;$('#external-doc-files').disabled=true;
  let imported=0,already=0,failed=0;
  try{
    for(const file of files){
      status.textContent='Importing '+(imported+already+failed+1)+' of '+files.length+
        ' — local original copy only…';
      try{
        const data=await file.arrayBuffer();
        if(data.byteLength<64||data.byteLength>MAX_ORIGINAL_PDF)
          throw new Error('PDF size must be 64 bytes to 8 MiB');
        let result;
        try{
          const response=await fetch('/api/external-invoice-originals/import',{
            method:'POST',credentials:'same-origin',
            headers:{'Content-Type':'application/pdf','X-FL-Original-Filename':encodeURIComponent(file.name)},
            body:data});
          let body;try{body=await response.json();}catch{}
          if(!response.ok)throw new Error(body?.error||'Original PDF was not imported');
          result=body;
        }catch(error){
          if(!(error instanceof TypeError))throw error;
          // If a response is lost after commit, ask the durable hash ledger
          // rather than treating an ambiguous network failure as a new upload.
          const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)))
            .map(value=>value.toString(16).padStart(2,'0')).join('');
          const lookup=await api('/api/external-invoice-originals/by-digest/'+digest);
          if(!lookup.recorded)throw error;
          result={...lookup.item,already_recorded:true};
        }
        if(result.already_recorded)already++;else imported++;
      }catch(error){
        failed++;
        // Do not include guest names, original PDF filenames or content in logs.
        status.textContent='Import paused after '+imported+' new, '+already+
          ' previously saved; '+failed+' file(s) need review. '+error.message+
          ' You may repeat the same selection safely; identical PDF bytes cannot duplicate.';
        break;
      }
    }
    if(!failed){
      status.textContent=imported+' new original(s) stored; '+already+
        ' duplicate(s) already preserved. No statutory invoice or email created.';
      $('#external-doc-files').value='';
    }
    await refreshExternalOriginals();
  }finally{
    externalOriginalBusy=false;$('#external-doc-files').disabled=false;
    $('#external-doc-files').dispatchEvent(new Event('change'));
  }
};
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
    const row=label('div',undefined,'tax-sac-row');
    row.append(label('span',line.description));
    const select=label('select');select.name='sac_codes';
    for(const [value,title] of [['996311','Hotel room accommodation (996311)'],['996312','Campsite accommodation (996312)']]){
      const option=label('option',title);option.value=value;select.append(option);
    }
    select.setAttribute('aria-label','Service accounting code for '+line.description);
    const tax=label('select');tax.name='tax_rates';
    tax.setAttribute('aria-label','Review GST rate for '+line.description);
    for(const [rate,title] of [['5','5% without ITC (review only)'],
      ['18','18% (review only)']]){
      const option=label('option',title);option.value=rate;tax.append(option);
    }
    row.append(select,tax);list.append(row);
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
      sac_codes:[...document.querySelectorAll('#tax-draft-sac-list select[name="sac_codes"]')].map(x=>x.value),
      tax_rates:[...document.querySelectorAll('#tax-draft-sac-list select[name="tax_rates"]')].map(x=>Number(x.value))
    };
    const draft=await api('/api/invoices/'+activeTaxProforma.id+'/tax-draft',
      {method:'POST',body:JSON.stringify(input)});
    $('#tax-draft-dialog').close();
    window.location.href='/api/tax-drafts/'+draft.id+'/pdf';
    alert('DRAFT ONLY. The document is not legally issued. Remaining blockers: '+draft.snapshot.readiness.blockers.join('; '));
  }catch(error){message.textContent=error.message;}
  finally{button.disabled=false;}
};

let staffPinOwnerEnabled=false;
async function refreshStaffPinPanels(){
  const local=['127.0.0.1','localhost'].includes(window.location.hostname);
  const owner=currentUser?.role==='owner'&&local;
  const staff=['frontdesk','cashier'].includes(currentUser?.role)&&local;
  $('#owner-staff-pin').hidden=!owner;
  $('#profile-quick-pin').hidden=!staff;
  if(owner){
    try{
      const data=await api('/api/system/staff-pin');
      staffPinOwnerEnabled=Boolean(data.enabled);
      $('#owner-staff-pin-state').textContent=staffPinOwnerEnabled?
        'Quick PIN enabled on this computer. Staff must enroll individually.':
        'Quick PIN disabled (default). Password sign-in remains available.';
      $('#owner-staff-pin-toggle').textContent=staffPinOwnerEnabled?'Disable and revoke all quick PINs':
        'Enable staff quick PIN';
    }catch(error){$('#owner-staff-pin-state').textContent='Policy unavailable: '+error.message;}
  }
  if(staff){
    try{
      const data=await api('/api/me/quick-pin');
      const button=$('#profile-quick-pin-form').querySelector('[type=submit]');
      button.disabled=!data.available||currentUser.login_method==='pin';
      $('#profile-quick-pin-revoke').disabled=!data.enrolled||currentUser.login_method==='pin';
      $('#profile-quick-pin-state').textContent=currentUser.login_method==='pin'?
        'You signed in using a PIN. Sign out and use your full password to enroll, change or revoke it.':
        !data.available?'Quick PIN is not enabled on this computer. Ask the owner to enable it.':
        data.enrolled?'This browser has a registered quick PIN. You can reset or revoke it.':
          'This browser is not enrolled yet. Enter your current password to register it.';
    }catch(error){$('#profile-quick-pin-state').textContent='PIN status unavailable: '+error.message;}
  }
}
$('#owner-staff-pin-form').onsubmit=async event=>{
  event.preventDefault();
  if(!currentUser||currentUser.role!=='owner')return;
  const form=event.currentTarget,button=$('#owner-staff-pin-toggle'),message=$('#owner-staff-pin-message');
  const enable=!staffPinOwnerEnabled;
  if(!confirm((enable?'Enable':'Disable')+' local staff PIN quick sign-in? '+
    (enable?'Each staff member must enroll with their full password; this does not enable phones.':
      'This immediately revokes all enrolled quick PIN credentials and PIN sessions.')))return;
  button.disabled=true;
  try{
    await api('/api/system/staff-pin',{method:'POST',body:JSON.stringify({
      enabled:enable,current_password:form.elements.namedItem('current_password').value
    })});
    message.textContent=enable?'Quick PIN enabled only on this local computer.':
      'Quick PIN disabled. All saved PIN credentials and PIN sessions revoked.';
    form.reset();await refreshStaffPinPanels();
  }catch(error){message.textContent='PIN policy not changed: '+error.message;}
  finally{button.disabled=false;form.elements.namedItem('current_password').value='';}
};
$('#profile-quick-pin-form').onsubmit=async event=>{
  event.preventDefault();
  const form=event.currentTarget,button=form.querySelector('[type=submit]'),
    message=$('#profile-quick-pin-message');
  if(!['frontdesk','cashier'].includes(currentUser?.role))return;
  const body=Object.fromEntries(new FormData(form));
  if(!/^[0-9]{6}$/.test(body.pin)||body.pin!==body.confirm_pin){
    message.textContent='Enter and confirm the same six numeric digits.';return;
  }
  button.disabled=true;
  try{
    await api('/api/me/quick-pin',{method:'POST',body:JSON.stringify(body)});
    message.textContent='This local browser is registered. Next time choose Use staff PIN on sign-in.';
    await refreshStaffPinPanels();
  }catch(error){message.textContent='PIN enrollment not confirmed: '+error.message;}
  finally{form.reset();button.disabled=false;}
};
$('#profile-quick-pin-revoke').onclick=async()=>{
  const form=$('#profile-quick-pin-form'),message=$('#profile-quick-pin-message');
  const password=form.elements.namedItem('current_password').value;
  if(!password){message.textContent='Enter your current full password above before revoking quick PINs.';return;}
  if(!confirm('Revoke all registered PIN credentials for your account? You can still sign in using your password.'))return;
  const button=$('#profile-quick-pin-revoke');button.disabled=true;
  try{
    await api('/api/me/quick-pin',{method:'DELETE',body:JSON.stringify({current_password:password})});
    message.textContent='All your quick PIN credentials were revoked. Full password sign-in remains available.';
    await refreshStaffPinPanels();
  }catch(error){message.textContent='PINs not revoked: '+error.message;}
  finally{form.reset();button.disabled=false;}
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
  await refreshStaffPinPanels();
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
$('#release-status-check').onclick=async()=>{
  if(currentUser?.role!=='owner'||!can('system.update')||
     !['127.0.0.1','localhost'].includes(window.location.hostname))return;
  const button=$('#release-status-check'),message=$('#release-status-message');
  const items=$('#release-status-items'),machine=$('#release-status-machine');
  button.disabled=true;
  message.textContent='Reviewing redacted on-site evidence (no heavy server diagnostics)…';
  items.replaceChildren();machine.textContent='';
  try{
    const status=await api('/api/system/release-readiness');
    if(status.verdict!=='NOT RELEASED'||status.production_ready!==false)
      throw new Error('Unexpected release status; do not deploy');
    message.textContent='NOT RELEASED · '+status.evidence.attested+' of '+
      status.evidence.total+' on-site checks reported as operator-attested.';
    machine.textContent=status.full_machine_diagnostics_performed?
      'Machine checks: '+status.machine_checks.passed+' pass · '+
        status.machine_checks.warnings+' warning(s) · '+
        status.machine_checks.failed+' failure(s).':
      'Full machine diagnostics were NOT run here. Use Diagnose FortLedger.cmd in a safe maintenance window and separately verify the off-device backup.';
    for(const gate of status.gates){
      const li=label('li');
      li.append(label('strong',gate.label),label('span',gate.status));
      items.append(li);
    }
    if(status.blocking_checks?.length){
      const li=label('li');
      li.append(label('strong','Local diagnostic exceptions'),
        label('span',status.blocking_checks.map(c=>c.name+' ('+c.status+')').join('; ')));
      items.append(li);
    }
    items.append(label('li',status.notice,'muted'));
  }catch(error){
    message.textContent='Release readiness could not be verified: '+error.message+
      '. FortLedger remains NOT RELEASED.';
  }finally{button.disabled=false;}
};
$('#backup-center-prepare').onclick=async()=>{
  if(currentUser?.role!=='owner'||!can('system.update')||
    !['127.0.0.1','localhost'].includes(window.location.hostname))return;
  const button=$('#backup-center-prepare'),message=$('#backup-center-prepare-state');
  button.disabled=true;
  message.dataset.state='checking';
  message.textContent='Creating an external encrypted backup and testing a complete recovery…';
  try{
    const result=await api('/api/system/backup-prepare',{
      method:'POST',body:JSON.stringify({})
    });
    if(result.state!=='prepared'||result.isolated_restore_verified!==true||
       result.owner_credential_recoverable!==true)
      throw new Error('Protected backup verification was not confirmed');
    message.dataset.state='prepared';
    message.textContent=result.detail;
    // Deliberate and read-only: show the newly created backup's health.
    $('#backup-center-check').click();
  }catch(error){
    message.dataset.state='failed';
    message.textContent='Cannot prepare an update: '+error.message+
      ' Your existing hotel data was not reset. Do not run the installer yet.';
  }finally{button.disabled=false;}
};
$('#backup-center-check').onclick=async()=>{
  if(!can('system.update'))return;
  const button=$('#backup-center-check'),state=$('#backup-center-state');
  button.disabled=true;state.textContent='Checking latest encrypted snapshot…';
  try{
    const report=await api('/api/system/backup-verify');
    state.textContent=report.detail;
    state.dataset.state=report.state;
  }catch(error){
    state.dataset.state='failed';
    state.textContent='Backup verification could not be completed: '+error.message;
  }finally{button.disabled=false;}
};
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
  button.disabled=true;message.dataset.state='checking';
  message.textContent='Checking installation status…';
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
    if(state.platform==='windows'&&
      ['installer_update_available','new_revision'].includes(state.state)&&
      state.available===true&&currentUser?.role==='owner')
      $('#owner-update-notice').hidden=false;
    else $('#owner-update-notice').hidden=true;
    const short=sha=>/^[a-f0-9]{12}$/i.test(sha||'')?sha:'Unavailable';
    const installerManaged=['installer_managed','installer_update_available','installer_check_unavailable'].includes(state.state);
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
    if(state.platform==='windows'&&['new_revision','installer_update_available'].includes(state.state)){
      const readiness=await api('/api/system/updates/readiness');
      const panel=$('#update-center-readiness'),list=$('#update-center-blockers');
      panel.hidden=false;list.replaceChildren();
      for(const blocker of readiness.blockers||[])list.append(label('li',blocker));
      const ready=Boolean(readiness.ready)&&
        /^[a-f0-9]{40}$/i.test(readiness.target_sha||'');
      $('#update-center-readiness-status').textContent=ready?
        (readiness.update_mode==='code_only'?
          'Verified code-only update ready. No reinstall: FortLedger will finish work, patch reviewed app files and restart.':
          'Verified GitHub commit, protected backup configuration and external supervisor are ready.'):
        'One-click code update is blocked until the listed safety checks pass. An installer may be required for native or launcher changes.';
      if(ready){
        approvedUpdateSha=readiness.target_sha;
        $('#update-center-install').textContent=readiness.update_mode==='code_only'?
          'Apply code update & restart':'Install verified update & restart';
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
    detail:'Confirm all staff have finished their booking or bill forms. The owner-only Windows updater will reject new financial writes, finish active requests and verify the external encrypted backup. For code-only changes, it updates application files without reinstalling, changing owner credentials or rewriting hotel data. If native components changed, a reviewed installer is still required.',
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
      'Update accepted by the desktop supervisor. Existing requests will finish, then verified code will be applied and FortLedger restarted. When localhost returns, reload and sign in. Do not submit another update request.';
  }catch(error){
    $('#update-center-readiness-status').textContent=
      'Update acceptance could not be confirmed: '+error.message+
      '. Verify FortLedger is still running before retrying or recording another financial transaction.';
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
function renderRestaurantTablePicker(){
  const picker=$('#restaurant-table'),before=picker.value;
  picker.replaceChildren();
  const walkin=label('option','Walk-in / no table');walkin.value='';picker.append(walkin);
  for(const table of restaurantTables){
    const option=label('option',table.label);option.value=String(table.id);picker.append(option);
  }
  if([...picker.options].some(x=>x.value===before))picker.value=before;
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
      $('#restaurant-saved-actions').hidden=true;
      renderCart();
    };
    if(can('restaurant.write'))row.append(details,add);else row.append(details);
    list.append(row);
  }
  if(!list.children.length)list.append(label('p',menu.length?'No matching menu items. Clear the search or select All items.':'No menu items found. Import a CSV to start.','muted'));
}
let restaurantReviewOpen=false,restaurantReviewedRates=null;
function restaurantPriceDrift(){
  if(!restaurantReviewOpen||!restaurantReviewedRates)return false;
  return cart.some(entry=>{
    const item=menu.find(x=>x.id===entry.menu_item_id);
    const reviewed=restaurantReviewedRates.get(entry.menu_item_id);
    return !item||!reviewed||reviewed.price_paise!==item.price_paise||
      reviewed.tax_rate!==item.tax_rate;
  });
}
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
  const table_id=$('#restaurant-table').value;
  const body={payment_method:method,items,
    ...(table_id?{table_id:Number(table_id)}:{}),
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
  const priceDrift=restaurantPriceDrift();
  $('#save-restaurant-bill').disabled=!cart.length||restaurantBillSubmitting||
    priceDrift||(unavailable&&!pendingRestaurantBill);
  if(priceDrift)$('#restaurant-message').textContent=
    'Menu availability, price or GST changed after review. Continue editing, then review the latest prices before saving.';
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
    ' · '+recipient+
    ($('#restaurant-table').value?' · Table '+($('#restaurant-table').selectedOptions[0]?.textContent||''):'');
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
  updateRestaurantMobileCart(total,quantity);
  renderRestaurantReview();
}
// One focused cashier workspace, with an accessible mobile cart overlay.
let restaurantWorkspaceTab='new',restaurantCartOpen=false,lastSavedRestaurantBill=null;
function renderRestaurantWorkspaceTab(){
  const cashier=currentUser?.role==='cashier'&&!currentUser?.unsecured_fixture;
  const showingDraft=!cashier||restaurantWorkspaceTab==='new';
  $('#restaurant-editor-anchor').hidden=!showingDraft;
  $('#restaurant-pos-editor').hidden=!showingDraft;
  $('#restaurant-history-section').hidden=cashier&&restaurantWorkspaceTab!=='history';
  for(const [id,tab] of [['restaurant-jump-new','new'],['restaurant-jump-history','history']])
    $('#'+id).setAttribute('aria-pressed',String(restaurantWorkspaceTab===tab));
  if($('#restaurant').hidden||!cashier||restaurantWorkspaceTab!=='new')restaurantCartOpen=false;
  const modal=restaurantCartOpen&&window.matchMedia('(max-width:700px)').matches;
  const panel=$('#restaurant-bill-panel');
  panel.dataset.open=String(modal);
  if(modal){panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');}
  else{panel.removeAttribute('role');panel.removeAttribute('aria-modal');}
  $('#restaurant-mobile-cart').setAttribute('aria-expanded',String(modal));
  document.body.classList.toggle('restaurant-cart-open',modal);
  updateRestaurantMobileCart();
}
function updateRestaurantMobileCart(total=null,quantity=null){
  const count=quantity??cart.reduce((n,x)=>n+x.quantity,0);
  const amount=total??cart.reduce((sum,x)=>
    sum+(menu.find(y=>y.id===x.menu_item_id)?.price_paise||0)*x.quantity,0);
  const trigger=$('#restaurant-mobile-cart');
  trigger.textContent='View bill · '+count+' item'+(count===1?'':'s')+' · '+money(amount);
  trigger.hidden=!currentUser||currentUser.role!=='cashier'||
    restaurantWorkspaceTab!=='new';
}
function closeRestaurantMobileCart(){
  if(!restaurantCartOpen)return;
  restaurantCartOpen=false;
  renderRestaurantWorkspaceTab();
  $('#restaurant-mobile-cart').focus({preventScroll:true});
}
$('#restaurant-mobile-cart').onclick=()=>{
  restaurantCartOpen=true;renderRestaurantWorkspaceTab();
  $('#restaurant-mobile-cart-close').focus({preventScroll:true});
};
$('#restaurant-mobile-cart-close').onclick=closeRestaurantMobileCart;
document.addEventListener('keydown',event=>{
  if(!restaurantCartOpen||!window.matchMedia('(max-width:700px)').matches)return;
  if(event.key==='Escape'){
    event.preventDefault();closeRestaurantMobileCart();return;
  }
  if(event.key!=='Tab')return;
  const focusable=[...$('#restaurant-bill-panel').querySelectorAll(
    'button:not([disabled]):not([hidden]), input:not([disabled]), select:not([disabled]), a[href]')]
    .filter(node=>node.getClientRects().length>0);
  if(!focusable.length)return;
  if(event.shiftKey&&document.activeElement===focusable[0]){
    event.preventDefault();focusable.at(-1).focus();
  }else if(!event.shiftKey&&document.activeElement===focusable.at(-1)){
    event.preventDefault();focusable[0].focus();
  }
});
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
function restaurantCorrectionReviewPanel(bill){
  const panel=label('details',undefined,'restaurant-correction-review');
  panel.append(label('summary','Correction cases · original receipt protected'),
    label('p','Record an internal review case, not a refund, GST credit note, revised receipt or change to the guest folio.','muted'));
  const choices=[];
  (bill.items||[]).forEach((item,index)=>{
    const row=label('div',undefined,'restaurant-correction-line');
    const name=label('label');
    const box=label('input');box.type='checkbox';box.value=String(index);
    name.append(box,document.createTextNode(' '+item.name+' · '+money(item.unit_price_paise)+
      ' × '+item.quantity));
    const qtyLabel=label('label','Quantity to review ');
    const qty=label('input');qty.type='number';qty.min='1';qty.max=String(item.quantity);
    qty.step='1';qty.value=String(item.quantity);
    qty.setAttribute('aria-label','Quantity to review: '+item.name);
    qtyLabel.append(qty);row.append(name,qtyLabel);panel.append(row);
    choices.push({index,box,qty});
  });
  const reasonLabel=label('label','Reason for correction review');
  const reason=label('textarea');reason.maxLength=300;reason.rows=2;
  reason.placeholder='Describe the incorrect saved quantity, charge or service (10+ characters)';
  reasonLabel.append(reason);panel.append(reasonLabel);
  const controls=label('div',undefined,'restaurant-history-actions');
  const estimate=label('button','Calculate impact','secondary');estimate.type='button';
  const submit=label('button','Record case for owner review','primary');submit.type='button';submit.hidden=true;
  controls.append(estimate,submit);panel.append(controls);
  const outcome=label('div',undefined,'restaurant-correction-result');
  outcome.setAttribute('role','status');outcome.setAttribute('aria-live','polite');panel.append(outcome);
  const history=label('div',undefined,'restaurant-correction-case-history');
  const reload=label('button','View correction case history','secondary');reload.type='button';
  panel.append(reload,history);
  let pendingCase=null;
  const invalidate=()=>{pendingCase=null;submit.hidden=true;outcome.replaceChildren();};
  reason.addEventListener('input',invalidate);
  for(const {box,qty} of choices){box.addEventListener('change',invalidate);qty.addEventListener('input',invalidate);}
  const loadCases=async()=>{
    reload.disabled=true;history.replaceChildren();
    try{
      const cases=await api('/api/restaurant/bills/'+bill.id+'/correction-cases');
      if(!cases.length)history.append(label('p','No correction cases recorded for this receipt.','muted'));
      for(const entry of cases){
        const card=label('div',undefined,'restaurant-correction-case-card');
        card.append(label('strong','Case #'+entry.id+' · '+entry.status.replaceAll('_',' ')),
          label('p','Proposed '+money(entry.proposal.proposed_gross_paise)+
            ' including historic tax '+money(entry.proposal.proposed_tax_paise)+' · '+entry.proposal.reason));
        card.append(label('small','Submitted by '+entry.actor_username+' · '+entry.created_at+' UTC'));
        if(entry.review){
          card.append(label('p','Owner decision: '+entry.review.disposition.replaceAll('_',' ')+
            ' · '+entry.review.note));
        }else if(currentUser?.role==='owner'){
          const decisionLabel=label('label','Owner decision ');
          const decision=label('select');
          for(const [value,name] of [['needs_accountant','Escalate for accountant review'],
            ['dismissed','Dismiss request (no adjustment)']]){
            const option=label('option',name);option.value=value;decision.append(option);
          }
          decisionLabel.append(decision);
          const noteLabel=label('label','Decision reason ');
          const note=label('textarea');note.rows=2;note.maxLength=300;
          note.placeholder='Explain the disposition (10–300 characters)';
          noteLabel.append(note);
          const record=label('button','Record owner decision','secondary');record.type='button';
          let intent=null;
          const clear=()=>{intent=null;};
          note.addEventListener('input',clear);decision.addEventListener('change',clear);
          const feedback=label('p',undefined,'muted');feedback.setAttribute('role','status');
          record.onclick=async()=>{
            if(!intent)intent={request_id:crypto.randomUUID(),disposition:decision.value,note:note.value};
            record.disabled=true;feedback.textContent='';
            try{
              await api('/api/restaurant/correction-cases/'+entry.id+'/review',
                {method:'POST',body:JSON.stringify(intent)});
              feedback.textContent='Owner decision recorded. No ledger or GST adjustment made.';
              await loadCases();
            }catch(error){
              feedback.textContent='Review not confirmed: '+error.message+
                '. Retry unchanged details with the same request ID; do not create a second decision.';
            }finally{record.disabled=false;}
          };
          card.append(decisionLabel,noteLabel,record,feedback);
        }
        history.append(card);
      }
    }catch(error){history.append(label('p','Case history unavailable: '+error.message,'muted'));}
    finally{reload.disabled=false;}
  };
  reload.onclick=loadCases;
  estimate.onclick=async()=>{
    const lines=choices.filter(entry=>entry.box.checked)
      .map(entry=>({line_index:entry.index,quantity:Number(entry.qty.value)}));
    outcome.replaceChildren();submit.hidden=true;pendingCase=null;
    estimate.disabled=true;
    try{
      const intent={reason:reason.value,lines};
      const result=await api('/api/restaurant/bills/'+bill.id+'/correction-preview',
        {method:'POST',body:JSON.stringify(intent)});
      pendingCase={...intent,request_id:crypto.randomUUID()};
      outcome.append(label('strong','Estimated correction: '+money(result.proposed_gross_paise)),
        label('p','Historic tax component: '+money(result.proposed_tax_paise)+
          ' · unchanged original receipt: '+money(result.source_total_paise)));
      outcome.append(label('p','Recording a case only creates an internal review request; it cannot issue a tax credit or transfer money.','muted'));
      for(const blocker of result.blockers)outcome.append(label('p','• '+blocker,'muted'));
      submit.hidden=false;
    }catch(error){outcome.append(label('p',error.message,'error'));}
    finally{estimate.disabled=false;}
  };
  submit.onclick=async()=>{
    if(!pendingCase)return;
    submit.disabled=true;
    try{
      let recorded;
      try{
        recorded=await api('/api/restaurant/bills/'+bill.id+'/correction-cases',
          {method:'POST',body:JSON.stringify(pendingCase)});
      }catch(error){
        if(!(error instanceof TypeError))throw error;
        // Lost POST response: inspect durable request identity before another POST.
        const lookup=await api('/api/restaurant/correction-cases/request/'+pendingCase.request_id);
        if(!lookup.recorded)throw error;
        recorded=lookup.case;
      }
      submit.hidden=true;pendingCase=null;
      outcome.append(label('p','Case #'+recorded.id+' recorded for owner review. No saved bill, payment or GST amount was changed.'));
      await loadCases();
    }catch(error){
      outcome.append(label('p','Case save not confirmed: '+error.message+
        '. Retry without changing this form to reuse the original request ID.','error'));
    }finally{submit.disabled=false;}
  };
  return panel;
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
    return [String(bill.id),bill.payment_method,bill.table_label||'',bill.manual_room||'',bill.manual_guest||'',
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
    article.id='restaurant-bill-'+bill.id;
    const top=label('div',undefined,'restaurant-history-main');
    const identity=label('div',undefined,'restaurant-history-identity');
    identity.append(label('strong','Bill #'+bill.id),
      label('small',restaurantBillTime(bill.created_at)));
    const badge=label('span',status.text,'restaurant-history-status');
    badge.dataset.status=status.key;
    const amount=label('strong',money(bill.total_paise),'restaurant-history-amount');
    top.append(identity,badge,amount);
    article.append(top);
    if(bill.table_label)article.append(label('p','Dining table: '+bill.table_label,'restaurant-history-target'));
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
    actions.append(print);
    // Only the cashier role is authorized to send an Epson LAN print job.
    // Managers retain receipt inspection but must never see an action that 403s.
    if(can('restaurant.pos')&&isRestaurantCashier()){
      const printState=label('p','Printer attempt not checked.','restaurant-print-state');
      printState.setAttribute('role','status');
      printState.setAttribute('aria-live','polite');
      const check=label('button','Check printer status','secondary');
      check.type='button';
      const refreshPrintStatus=async()=>{
        check.disabled=true;
        try{
          const result=await api('/api/restaurant/bills/'+bill.id+'/print-status');
          const job=result.status;
          const attempts=job?.attempts||0;
          const message=!job?'No recorded Epson LAN attempt. Browser receipts are not tracked here.':
            job.state==='sent_unverified'?'Sent to printer connection '+attempts+' time(s); physical paper NOT verified. Inspect paper before any reprint.':
            job.state==='sending'?'Printer send in progress or interrupted. Inspect paper; do not retry blindly.':
            job.state==='uncertain'?'Print delivery uncertain after '+attempts+' attempt(s). Inspect physical paper before reprint.':
            'Printer status unknown; inspect physical paper.';
          printState.textContent=message;
        }catch(error){printState.textContent='Printer status unavailable: '+error.message;}
        finally{check.disabled=false;}
      };
      check.onclick=refreshPrintStatus;
      const lan=label('button','LAN Print','secondary');lan.type='button';
      lan.onclick=async()=>{
        if(!confirm('Send existing saved receipt #'+bill.id+' to configured Epson LAN printer?'))return;
        try{
          const sent=await api('/api/restaurant/bills/'+bill.id+'/print',
            {method:'POST',body:JSON.stringify({reprint:false})});
          await refreshPrintStatus();
          alert(sent.notice);
        }catch(error){
          await refreshPrintStatus();
          if(!/Previously attempted/.test(error.message)){alert(error.message);return;}
          if(!confirm('Printing was previously attempted. Verify whether paper already printed before reprinting. Proceed?'))return;
          try{
            const retried=await api('/api/restaurant/bills/'+bill.id+'/print',
              {method:'POST',body:JSON.stringify({reprint:true})});
            await refreshPrintStatus();
            alert(retried.notice);
          }catch(next){await refreshPrintStatus();alert(next.message);}
        }
      };
      actions.append(check,lan);
      article.append(printState);
    }
    if(status.key==='unmatched'){
      const link=label('button','Link to guest','secondary');link.type='button';
      link.onclick=()=>linkPendingCharge(bill);
      actions.append(link);
    }
    article.append(actions);
    if(can('restaurant.correction.preview')&&['owner','manager'].includes(currentUser?.role))
      article.append(restaurantCorrectionReviewPanel(bill));
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
$('#restaurant-jump-new').onclick=()=>{
  restaurantWorkspaceTab='new';$('#restaurant-saved-actions').hidden=true;
  renderRestaurantWorkspaceTab();$('#menu-search').focus({preventScroll:true});
};
$('#restaurant-jump-history').onclick=()=>{
  restaurantWorkspaceTab='history';renderRestaurantWorkspaceTab();
  $('#restaurant-history-search').focus({preventScroll:true});
};
$('#restaurant-jump-menu').onclick=()=>workspaceNavigator.navigate('profile');
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
  restaurantReviewedRates=new Map(menu.map(item=>[item.id,{
    price_paise:item.price_paise,tax_rate:item.tax_rate}]));
  $('#restaurant-message').textContent='Review and edit the items above. Confirm & save only when the final bill is correct.';
  renderRestaurantReview();
  $('#restaurant-review-heading').focus({preventScroll:true});
  $('#restaurant-review').scrollIntoView({block:'nearest'});
};
$('#edit-restaurant-bill').onclick=()=>{
  if(pendingRestaurantBill)return;
  restaurantReviewOpen=false;restaurantReviewedRates=null;
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
  cart=[];restaurantReviewOpen=false;restaurantReviewedRates=null;
  $('#restaurant-saved-actions').hidden=true;
  renderCart();$('#restaurant-message').textContent='Unsaved bill cleared.';
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
$('#restaurant-table').onchange=()=>renderRestaurantReview();
$('#manual-room-number').oninput=renderRestaurantReview;
$('#manual-room-guest').oninput=renderRestaurantReview;
// Keep the same immutable intent and UUID after an uncertain response. Never
// create a second financial record while the original attempt is unresolved.
let pendingRestaurantBill=null,restaurantBillSubmitting=false;
function lockPendingRestaurantInputs(locked){
  for(const selector of ['#restaurant-method','#restaurant-table','#restaurant-guest',
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
    if(restaurantPriceDrift()){
      message.textContent='Menu prices or availability changed. Continue editing and review the new bill before saving.';
      renderRestaurantReview();return;
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
    // A lost POST response may be reconciled with an ID-only lookup. The
    // original reviewed item snapshots, not possibly newer menu prices,
    // remain authoritative for the saved-state confirmation amount.
    const savedTotal=saved.total_paise??pendingRestaurantBill.items.reduce((n,item)=>
      n+item.unit_price_paise*item.quantity,0);
    lastSavedRestaurantBill={id:saved.id,total_paise:savedTotal,method:pendingRestaurantBill.payment_method};
    pendingRestaurantBill=null;
    lockPendingRestaurantInputs(false);
    restaurantReviewOpen=false;restaurantReviewedRates=null;
    cart=[];
    $('#restaurant-table').value='';
    renderCart();
    $('#restaurant-saved-summary').textContent='Saved bill #'+saved.id+' · '+money(savedTotal)+
      ' · '+(lastSavedRestaurantBill.method==='room'?'Unpaid room charge':'Payment recorded by staff');
    $('#restaurant-saved-actions').hidden=false;
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
$('#restaurant-print-last').onclick=()=>{
  if(lastSavedRestaurantBill)showRestaurantReceipt(lastSavedRestaurantBill.id);
};
$('#restaurant-new-after-save').onclick=()=>{
  $('#restaurant-saved-actions').hidden=true;
  restaurantWorkspaceTab='new';renderRestaurantWorkspaceTab();
  if(restaurantCartOpen)closeRestaurantMobileCart();
  $('#menu-search').focus({preventScroll:true});
};

let tablesAdmin=[],tablesAdminBusy=false;
function renderRestaurantTableManagement(){
  const list=$('#restaurant-table-admin-list');list.replaceChildren();
  for(const item of tablesAdmin){
    const row=label('div',undefined,'restaurant-table-admin-row');
    const name=label('span',item.label+' · '+(item.active?'Available':'Hidden'));
    const toggle=label('button',item.active?'Hide':'Make available','secondary');
    toggle.type='button';toggle.disabled=tablesAdminBusy;
    toggle.onclick=async()=>{
      if(tablesAdminBusy||!can('menu.manage'))return;
      if(!await confirmAction({title:(item.active?'Hide ':'Show ')+item.label+'?',
        detail:'Existing food receipts retain the original table name. Current unsaved bills must be re-reviewed if a table is hidden.',
        confirmLabel:item.active?'Hide table':'Show table'}))return;
      tablesAdminBusy=true;toggle.disabled=true;
      try{
        await api('/api/restaurant/tables/'+item.id+'/visibility',{
          method:'PATCH',body:JSON.stringify({active:!Boolean(item.active),expected_active:Boolean(item.active)})
        });
        await load();await refreshRestaurantTablesManagement();
        $('#restaurant-table-admin-message').textContent='Table visibility updated; saved receipts unchanged.';
      }catch(error){
        $('#restaurant-table-admin-message').textContent='Change not confirmed: '+error.message;
        try{await refreshRestaurantTablesManagement();}catch{}
      }finally{tablesAdminBusy=false;}
    };
    row.append(name,toggle);list.append(row);
  }
  if(!tablesAdmin.length)list.append(label('p','No dining tables yet. Add only the physical table names you actually use.','muted'));
}
async function refreshRestaurantTablesManagement(){
  if(!can('menu.manage'))return;
  tablesAdmin=await api('/api/restaurant/tables/all');
  renderRestaurantTableManagement();
}
$('#restaurant-table-management').addEventListener('toggle',()=>{
  if($('#restaurant-table-management').open)void refreshRestaurantTablesManagement().catch(error=>{
    $('#restaurant-table-admin-message').textContent='Could not read table names: '+error.message;
  });
});
$('#restaurant-table-create').onsubmit=async event=>{
  event.preventDefault();
  if(tablesAdminBusy||!can('menu.manage'))return;
  const form=event.currentTarget,message=$('#restaurant-table-admin-message');
  const name=form.elements.namedItem('label').value.trim();
  if(!name)return;
  tablesAdminBusy=true;form.querySelector('button').disabled=true;
  try{
    await api('/api/restaurant/tables',{method:'POST',body:JSON.stringify({label:name})});
    form.reset();
    await load();await refreshRestaurantTablesManagement();
    message.textContent='Dining table '+name+' added. Staff may now select it on a new bill.';
  }catch(error){message.textContent='Table not created: '+error.message;}
  finally{tablesAdminBusy=false;form.querySelector('button').disabled=false;}
};

let bundledMenuPreview=null,bundledMenuBusy=false,bundledMenuRevision=0;
function renderBundledMenuPreview(){
  const box=$('#bundled-menu-review');box.replaceChildren();
  const action=$('#bundled-menu-sync');
  action.disabled=bundledMenuBusy||!bundledMenuPreview||!$('#bundled-menu-gst-ack').checked||
    bundledMenuPreview.missing===0;
  if(!bundledMenuPreview)return;
  const plan=bundledMenuPreview;
  const totals=label('p',plan.count+' dishes · '+plan.missing+
    ' missing to add · '+plan.preserved+' existing dishes will be preserved','muted');
  box.append(totals);
  const scroll=label('div',undefined,'import-preview-scroll');
  scroll.setAttribute('role','region');
  scroll.setAttribute('aria-label','Complete prebuilt Garh Jaisal dish review');
  scroll.tabIndex=0;
  const table=label('table',undefined,'import-preview-table');
  const thead=label('thead'),heading=label('tr');
  for(const name of ['Dish','Category','Printed price','Provisional GST','Change']){
    const th=label('th',name);th.scope='col';heading.append(th);
  }
  thead.append(heading);table.append(thead);
  const tbody=label('tbody');
  for(const item of plan.preview){
    const tr=label('tr');
    tr.append(label('td',item.name),label('td',item.category),
      label('td',money(item.price_paise)),label('td',item.tax_rate+'%'),
      label('td',item.change==='missing'?'Will add':'Keep current item unchanged'));
    if(item.change==='preserved')tr.title='Existing price, GST and availability remain unchanged';
    tbody.append(tr);
  }
  table.append(tbody);scroll.append(table);box.append(scroll);
}
async function refreshBundledMenuPreview(){
  if(!can('menu.manage'))return;
  const revision=++bundledMenuRevision;
  bundledMenuPreview=null;
  $('#bundled-menu-gst-ack').checked=false;
  renderBundledMenuPreview();
  const message=$('#bundled-menu-message');
  message.textContent='Comparing the prebuilt dishes to your saved menu…';
  const result=await api('/api/restaurant/menu/bundled/preview');
  if(revision!==bundledMenuRevision)return;
  bundledMenuPreview=result;
  renderBundledMenuPreview();
  message.textContent=result.missing===0?
    'All '+result.count+' prebuilt dishes are already represented. No menu changes required.':
    result.missing+' new dishes can be added. '+result.preserved+
      ' existing dishes will not be changed. Verify GST before syncing.';
}
$('#bundled-menu-preview').onclick=()=>refreshBundledMenuPreview().catch(error=>{
  $('#bundled-menu-message').textContent='Cannot review prebuilt menu: '+error.message;
});
$('#bundled-menu-gst-ack').onchange=renderBundledMenuPreview;
$('#bundled-menu-sync').onclick=async()=>{
  if(!can('menu.manage')||bundledMenuBusy||!bundledMenuPreview||
    !$('#bundled-menu-gst-ack').checked||bundledMenuPreview.missing===0)return;
  const preview=bundledMenuPreview,confirm=await confirmAction({
    title:'Add '+preview.missing+' missing menu dishes?',
    detail:'The printed prices are from Garh Jaisal Kitchen. The CSV GST rate is provisional 5%, not independently verified. You must verify the GST treatment before billing. Existing prices, GST, hidden items and saved receipts remain unchanged.',
    confirmLabel:'Add missing dishes'
  });
  if(!confirm)return;
  bundledMenuBusy=true;renderBundledMenuPreview();
  const status=$('#bundled-menu-message');
  try{
    const result=await api('/api/restaurant/menu/bundled/sync',{method:'POST',
      body:JSON.stringify({preview_token:preview.preview_token,
        confirm_sync:true,confirm_provisional_gst:true})});
    bundledMenuPreview=null;bundledMenuRevision++;renderBundledMenuPreview();
    try{
      await load();
      if($('#menu-availability-section').open)await refreshMenuAvailability();
      await refreshBundledMenuPreview();
      status.textContent=result.added+' dishes added from the built-in menu. '+
        result.preserved+' existing dishes kept unchanged. Check GST before issuing bills.';
    }catch(error){
      status.textContent=result.added+' dishes were saved; refresh the screen to see them. '+
        'Do not sync again until you review the current menu: '+error.message;
    }
  }catch(error){
    status.textContent='Sync not confirmed: '+error.message+
      '. Review the menu again before retrying; no existing prices are overwritten.';
    bundledMenuPreview=null;
    renderBundledMenuPreview();
  }finally{bundledMenuBusy=false;renderBundledMenuPreview();}
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
    const edit=label('button','Edit price','secondary');edit.type='button';
    edit.disabled=menuAvailabilityBusy||!menuAvailabilityVerified;
    edit.setAttribute('aria-label','Edit current price and GST for '+item.name);
    edit.onclick=()=>openMenuPriceEditor(item);
    row.append(details,edit,button);container.append(row);
  }
  if(!visible.length)container.append(label('p',menuAvailabilityItems.length?
    'No dishes match the search.':'No menu items configured. Import a CSV first.','muted'));
  if(focusId!==null)container.querySelector('[data-menu-id="'+focusId+'"] button')?.focus({preventScroll:true});
}

let priceEditorItem=null,priceEditorBusy=false;
function priceToPaise(value){
  const input=String(value).trim();
  if(!/^[0-9]{1,9}(?:\.[0-9]{1,2})?$/.test(input))
    throw new Error('Enter a non-negative rupee amount with at most two decimal places');
  const [whole,cents='']=input.split('.');
  const paise=Number(whole)*100+Number(cents.padEnd(2,'0'));
  if(!Number.isSafeInteger(paise)||paise>10000000000)
    throw new Error('Price exceeds allowed amount');
  return paise;
}
function openMenuPriceEditor(item){
  if(!can('menu.manage')||menuAvailabilityBusy||!menuAvailabilityVerified)return;
  priceEditorItem={...item};
  const form=$('#menu-price-form');
  form.reset();
  form.elements.namedItem('price').value=(item.price_paise/100).toFixed(2);
  form.elements.namedItem('tax_rate').value=String(item.tax_rate);
  $('#menu-price-item').textContent=item.name+' · '+item.category;
  $('#menu-price-previous').textContent='Current '+money(item.price_paise)+
    ' (GST-inclusive), GST '+item.tax_rate+'%. This changes future bills only.';
  $('#menu-price-message').textContent='';
  $('#menu-price-dialog').showModal();
}
$('#menu-price-cancel').onclick=()=>$('#menu-price-dialog').close();
$('#menu-price-form').onsubmit=async event=>{
  event.preventDefault();
  if(priceEditorBusy||!can('menu.manage')||!priceEditorItem)return;
  const form=event.currentTarget,message=$('#menu-price-message'),item=priceEditorItem;
  let price,tax;
  try{
    price=priceToPaise(form.elements.namedItem('price').value);
    tax=Number(form.elements.namedItem('tax_rate').value);
    if(!Number.isInteger(tax)||tax<0||tax>28)throw new Error('GST must be a whole percentage from 0 to 28');
    if(price===item.price_paise&&tax===item.tax_rate)throw new Error('Change price or GST before saving');
  }catch(error){message.textContent=error.message;return;}
  const reason=form.elements.namedItem('reason').value.trim();
  if(reason.length<10||reason.length>300){message.textContent='Provide a reason of 10–300 characters';return;}
  if(!confirm('Change '+item.name+' from '+money(item.price_paise)+' at '+item.tax_rate+
    '% GST to '+money(price)+' at '+tax+'% GST? Only future bills change; verify the applicable GST before proceeding.'))return;
  const button=form.querySelector('[type=submit]');button.disabled=true;priceEditorBusy=true;
  try{
    await api('/api/restaurant/menu/'+item.id+'/price',{method:'PATCH',body:JSON.stringify({
      price_paise:price,tax_rate:tax,expected_price_paise:item.price_paise,
      expected_tax_rate:item.tax_rate,reason
    })});
    $('#menu-price-dialog').close();priceEditorItem=null;
    restaurantReviewOpen=false; // force a fresh review if this manager also has an unsaved draft
    await load();await refreshMenuAvailability();
    $('#menu-availability-message').textContent=item.name+' updated for new bills. Original receipts remain unchanged.';
  }catch(error){
    message.textContent='Price change not confirmed: '+error.message+'. Refresh the dish before retrying.';
    if(/changed since review/.test(error.message)){
      try{await refreshMenuAvailability();}catch{}
    }
  }finally{priceEditorBusy=false;button.disabled=false;}
};

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
  // A read-only invoice readiness preview; never starts a financial write.
  void refreshCheckoutInvoicePreflight();
}
async function refreshCheckoutInvoicePreflight(){
  const id=activeFolioBooking;
  const node=$('#folio-invoice-preflight-results'),button=$('#folio-invoice-preflight-refresh');
  button.disabled=true;
  node.replaceChildren(label('p','Checking the saved source ledger…','muted'));
  try{
    const result=await api('/api/bookings/'+id+'/checkout-invoice-preflight');
    if(activeFolioBooking!==id)return;
    node.replaceChildren(label('strong','Tax invoice: held for accountant review'),
      label('p','Accommodation '+money(result.accommodation.current_charge_paise)+
        ' · linked food room charges '+money(result.totals.restaurant_room_charges_paise)+
        ' · total recorded charges '+money(result.totals.charges_paise)),
      label('p','Operator-recorded receipts '+money(result.totals.operator_recorded_paise)+
        ' · balance requiring follow-up '+money(result.totals.due_paise)),
      label('p','Proforma '+(result.original_proforma?.number||'not yet saved')+
        ' · billing recipient '+result.billing_recipient.name+' (unconfirmed)','muted'));
    for(const bill of result.restaurant_room_charges)
      node.append(label('p','Linked food bill #'+bill.bill_id+' · '+money(bill.total_paise)+
        ' · '+bill.payment_state.replaceAll('_',' '),'muted'));
    const unresolved=label('div');
    unresolved.append(label('strong',result.blockers.length+' issuance blockers · '+result.warnings.length+' review notices'));
    for(const issue of [...result.blockers,...result.warnings]){
      const item=label('p',issue.message,'muted');
      item.prepend(document.createTextNode(result.blockers.includes(issue)?'Blocked: ':'Review: '));
      unresolved.append(item);
    }
    node.append(unresolved,label('p',
      'Existing external invoice PDFs remain on the hotel computer; FortLedger has not verified their numbers or delivered any message.','muted'));
  }catch(error){
    if(activeFolioBooking===id)node.replaceChildren(label('p','Invoice preflight unavailable: '+error.message,'error'));
  }finally{button.disabled=false;}
}
$('#folio-invoice-preflight-refresh').onclick=refreshCheckoutInvoicePreflight;
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
async function refreshGstReadiness(){
  const target=$('#gst-readiness-results'),button=$('#gst-readiness-refresh');
  if(!can('tax.review')||!['owner','manager'].includes(currentUser?.role))return;
  target.replaceChildren();button.disabled=true;
  try{
    const report=await api('/api/tax/readiness');
    target.append(label('p',report.completed_local_fields+' of '+report.required_local_fields+
      ' supplier configuration checks complete. Legal issuance remains DISABLED.'));
    const localList=label('ul');
    for(const check of report.checks)
      localList.append(label('li',(check.complete?'Present: ':'Missing: ')+check.label));
    target.append(localList,label('h4','Accountant approvals still required'));
    const pending=label('ul');
    for(const item of report.accountant_reviews)pending.append(label('li',item));
    target.append(pending);
  }catch(error){target.append(label('p',error.message,'error'));}
  finally{button.disabled=false;}
}
$('#gst-readiness-refresh').onclick=refreshGstReadiness;
$('#business-form').onsubmit=async event=>{
  event.preventDefault();
  const form=event.currentTarget,message=$('#settings-message'),button=form.querySelector('[type=submit]');
  button.disabled=true;message.textContent='';
  try{
    const body=Object.fromEntries(new FormData(form));
    businessSettings=await api('/api/settings/business',{method:'PUT',body:JSON.stringify(body)});
    message.textContent='Saved successfully';
    if($('#gst-readiness').open)void refreshGstReadiness();
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
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden){void probeServerConnection();refreshOwnerUpdateNotice();}
});
// Lightweight read-only connectivity check; never queues or replays financial writes.
setInterval(()=>{if(!document.hidden)void probeServerConnection();},45000);
setInterval(()=>{if(!document.hidden)refreshOwnerUpdateNotice();},6*60*60*1000);
applyWorkspaceView();
void probeServerConnection();
load().catch(e=>{$('#booking-list').textContent='Unable to load: '+e.message;});
