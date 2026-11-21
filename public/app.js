import {occupiedRoomCount,monthGrid} from './calendar-utils.js';
import {VIEWS,viewForHash} from './navigation.js';
const $ = selector => document.querySelector(selector);
let currentUser=null;
const can=permission=>Boolean(currentUser&&(currentUser.permissions.includes('*')||currentUser.permissions.includes(permission)));
const VIEW_ACCESS={bookings:'bookings.read',rooms:'rooms.read',invoices:'invoices.read',restaurant:'restaurant.read','business-settings':'settings.read',profile:'profile.read'};
function applyWorkspaceView(){
  let view=viewForHash(window.location.hash);
  if(currentUser&&!can(VIEW_ACCESS[view]))view=can('bookings.read')?'bookings':can('restaurant.read')?'restaurant':'profile';
  const config=VIEWS[view],shown=new Set(config.sections);
  for(const id of ['stats','calendar','bookings','rooms','invoices','restaurant','business-settings','roadmap','profile']){
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
let rooms=[],bookings=[],invoices=[],businessSettings=null,menu=[],restaurantBills=[],cart=[],editingId=null,weekStart=new Date(),calendarMode='week';
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
  const filtered=bookings.filter(b=>[b.guest_name,b.company_name,b.category,b.assigned_room||''].some(v=>v.toLowerCase().includes(q)));
  if(!filtered.length)list.append(label('p','No matching bookings. Create your first reservation.','muted'));
  for(const b of filtered){
    const row=label('div',undefined,'booking-row');
    const guest=label('div');guest.append(label('strong',b.guest_name),label('small',[b.company_name,b.category,b.assigned_room].filter(Boolean).join(' · ')));
    const dates=label('div');dates.append(label('strong',fmtDay(b.checkin)+' → '+fmtDay(b.checkout)),label('small',b.rooms_count+' room(s) · '+b.nights+' night(s) · '+b.meal_plan));
    const stage=label('div');const status=label('select');status.setAttribute('aria-label','Booking status for '+b.guest_name);
    statusOptions.forEach(s=>{const opt=label('option',s.replaceAll('_',' '));opt.value=s;status.append(opt);});
    status.value=b.status;status.disabled=b.status==='cancelled';
    status.onchange=async()=>{try{await api('/api/bookings/'+b.id+'/status',{method:'PATCH',body:JSON.stringify({status:status.value})});await load();}catch(e){alert(e.message);status.value=b.status;}};
    stage.append(status);
    const due=label('div',undefined,'money');due.append(label('strong',money(b.total_paise)),label('small','Due '+money(b.due_paise)));
    const actions=label('div',undefined,'row-actions');
    const edit=label('button','Edit','secondary');edit.disabled=b.status==='cancelled';edit.onclick=()=>openEdit(b);
    const payment=label('button','+ Payment','secondary');payment.disabled=b.status==='cancelled';payment.onclick=()=>addPayment(b);
    const history=label('button','Payments','secondary');history.onclick=()=>showPayments(b);
    const proforma=label('button','Proforma PDF','secondary');proforma.disabled=b.status==='cancelled';
    proforma.onclick=()=>createInvoice(b);
    const folioButton=label('button','Guest folio','secondary');folioButton.onclick=()=>showFolio(b);
    const refundButton=label('button','Record refund','secondary');refundButton.onclick=()=>recordPaymentRefund(b);
    actions.append(edit,payment,history,refundButton,proforma,folioButton);
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
function renderRooms(){
  const list=$('#room-list');list.replaceChildren();
  for(const room of rooms){
    const row=label('form',undefined,'room-row');
    const name=label('input');name.value=room.name;name.maxLength=80;name.setAttribute('aria-label','Room name');
    const category=label('input');category.value=room.category;category.maxLength=80;category.setAttribute('aria-label','Room category');
    const save=label('button','Save','secondary');save.type='submit';
    row.append(name,category,save);
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
    item.append(checkbox,label('span',room.name));list.append(item);
  }
  if(!list.children.length)list.append(label('p','Set up physical rooms for this category first.','muted'));
}
async function load(){
  currentUser=await api('/api/me');
  [rooms,bookings,invoices,businessSettings,menu,restaurantBills]=await Promise.all([
    can('rooms.read')?api('/api/rooms'):Promise.resolve([]),
    can('bookings.read')?api('/api/bookings'):can('restaurant.read')?api('/api/restaurant/checked-in'):Promise.resolve([]),
    can('invoices.read')?api('/api/invoices'):Promise.resolve([]),
    can('settings.read')?api('/api/settings/business'):Promise.resolve(null),
    can('restaurant.read')?api('/api/restaurant/menu'):Promise.resolve([]),
    can('restaurant.read')?api('/api/restaurant/bills'):Promise.resolve([])
  ]);
  renderMenu();renderCart();renderRestaurantHistory();
  if(businessSettings){
    for(const [key,value] of Object.entries(businessSettings)){
      const field=$('#business-form').elements.namedItem(key);if(field)field.value=value;
    }
  }
  if(can('bookings.read')){renderBookings();renderCalendar();}
  if(can('rooms.read'))renderRooms();
  if(can('invoices.read'))renderInvoices();
  if(can('settings.read'))await refreshHotelLogo();
  $('#backup-button').hidden=!can('settings.admin');
  $('#save-restaurant-bill').hidden=!can('restaurant.write');
  $('#import-menu').hidden=!can('restaurant.write');
  $('#preview-menu').hidden=!can('restaurant.write');
  $('#staff-admin').hidden=currentUser.role!=='owner';
  const settingsSave=$('#business-form').querySelector('[type=submit]');
  if(settingsSave)settingsSave.disabled=!can('settings.admin');
  await renderProfile();
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

function openNew(){
  editingId=null;
  const f=$('#booking-form');f.reset();
  $('#dialog-title').textContent='Add a booking';$('#booking-submit').textContent='Save booking';
  $('#initial-advance').disabled=false;$('#initial-advance').closest('label').hidden=false;
  setMessage('');updateRoomOptions();updatePreview();$('#booking-dialog').showModal();
}
function openEdit(b){
  editingId=b.id;
  const form=$('#booking-form');form.reset();
  ['guest_name','company_name','checkin','checkout','rooms_count','meal_plan','nightly_rate'].forEach(k=>{
    const field=form.elements.namedItem(k);
    field.value=k==='nightly_rate'?(b.nightly_rate_paise/100):b[k];
  });
  $('#category-select').value=b.category;updateRoomOptions(b.room_ids||[]);
  $('#dialog-title').textContent='Edit booking';$('#booking-submit').textContent='Save changes';
  $('#initial-advance').disabled=true;$('#initial-advance').closest('label').hidden=true;
  setMessage('');updatePreview();$('#booking-dialog').showModal();
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
async function addPayment(b){
  const response=prompt('Additional payment received from '+b.guest_name+' (₹):');
  if(response===null)return;
  const amount=Number(response);
  if(!Number.isFinite(amount)||amount<=0){alert('Enter a valid positive payment amount.');return;}
  if(!confirm('Record an additional payment of ₹'+amount.toFixed(2)+' for '+b.guest_name+'?'))return;
  try{await api('/api/bookings/'+b.id+'/payments',{method:'POST',body:JSON.stringify({amount})});await load();}
  catch(e){alert(e.message);}
}
async function showPayments(b){
  try{
    const [rows,refunds]=await Promise.all([
      api('/api/bookings/'+b.id+'/payments'),
      api('/api/bookings/'+b.id+'/refunds')
    ]);
    const payments=rows.length?rows.map(x=>'Payment #'+x.id+' · '+x.created_at+' · '+money(x.amount_paise)+
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
$('#close-dialog').onclick=()=>$('#booking-dialog').close();
$('#cancel-dialog').onclick=()=>$('#booking-dialog').close();
$('#category-select').onchange=()=>{updateRoomOptions();updatePreview();};
$('#room-assignment-list').onchange=()=>{updatePreview();};
$('#booking-form').oninput=updatePreview;
$('#search').oninput=renderBookings;
$('#calendar-mode').onclick=()=>setCalendarMode(calendarMode==='week'?'month':'week');
$('#week-prev').onclick=()=>{weekStart=calendarMode==='month'?new Date(weekStart.getFullYear(),weekStart.getMonth()-1,1):addDays(weekStart,-7);renderCalendar();};
$('#week-next').onclick=()=>{weekStart=calendarMode==='month'?new Date(weekStart.getFullYear(),weekStart.getMonth()+1,1):addDays(weekStart,7);renderCalendar();};
$('#week-today').onclick=()=>{weekStart=new Date();weekStart=addDays(weekStart,-((weekStart.getDay()+6)%7));renderCalendar();};
$('#backup-button').onclick=()=>{window.location.href='/api/backup';};
$('#booking-form').onsubmit=async e=>{
  e.preventDefault();
  const form=e.currentTarget, data=Object.fromEntries(new FormData(form));
  data.room_ids=[...document.querySelectorAll('#room-assignment-list input:checked')].map(x=>Number(x.value));
  const submit=$('#booking-submit');submit.disabled=true;
  try{
    if(editingId)await api('/api/bookings/'+editingId,{method:'PATCH',body:JSON.stringify(data)});
    else await api('/api/bookings',{method:'POST',body:JSON.stringify(data)});
    $('#booking-dialog').close();await load();
  }catch(error){setMessage(error.message);}
  finally{submit.disabled=false;}
};
applyWorkspaceView();
load().catch(e=>{$('#booking-list').textContent='Unable to load: '+e.message;});
