const $ = (s) => document.querySelector(s);
const fmt = paise => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(paise/100);
const el = (tag,text,cls) => {const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
let rooms = [], bookings = [];
async function request(url,options={}) {
  const response=await fetch(url,{headers:{'Content-Type':'application/json'},...options});
  const value=await response.json();
  if(!response.ok)throw new Error(value.error||'Request failed');
  return value;
}
function renderBookings(){
  const q=$('#search').value.toLowerCase();
  const list=$('#booking-list');list.replaceChildren();
  const filtered=bookings.filter(b=>[b.guest_name,b.company_name,b.category,b.assigned_room||''].some(v=>v.toLowerCase().includes(q)));
  if(!filtered.length)list.append(el('p','No matching reservations. Add a booking to begin.','muted'));
  for(const b of filtered){
    const row=el('div',undefined,'booking-row');
    const guest=el('div');guest.append(el('strong',b.guest_name),el('small',[b.company_name,b.category,b.assigned_room].filter(Boolean).join(' · ')));
    const date=el('div');date.append(el('strong',b.checkin+' → '+b.checkout),el('small',b.rooms_count+' room(s) · '+b.nights+' night(s) · '+b.meal_plan));
    const status=el('div');const badge=el('span',b.status.replace('_',' '),'tag');status.append(badge);
    const sum=el('div',undefined,'money');sum.append(el('strong',fmt(b.total_paise)),el('small','Due '+fmt(b.due_paise)));
    row.append(guest,date,status,sum);list.append(row);
  }
  $('#stat-bookings').textContent=bookings.filter(b=>b.status!=='cancelled').length;
  $('#stat-due').textContent=fmt(bookings.filter(b=>b.status!=='cancelled').reduce((s,b)=>s+b.due_paise,0));
}
function renderRooms(){
  const list=$('#room-list');list.replaceChildren();
  for(const room of rooms){
    const row=el('form',undefined,'room-row');
    const name=el('input');name.value=room.name;name.maxLength=80;name.setAttribute('aria-label','Room name');
    const category=el('input');category.value=room.category;category.maxLength=80;category.setAttribute('aria-label','Room category');
    const save=el('button','Save','secondary');save.type='submit';
    row.append(name,category,save);
    row.addEventListener('submit',async e=>{e.preventDefault();try{await request('/api/rooms/'+room.id,{method:'PATCH',body:JSON.stringify({name:name.value,category:category.value})});await load();}catch(error){alert(error.message);}});
    list.append(row);
  }
  $('#category-select').replaceChildren(...[...new Set(rooms.filter(x=>x.active).map(x=>x.category))].map(c=>{const x=el('option',c);x.value=c;return x;}));
  updateRoomOptions();
}
function updateRoomOptions(){
  const category=$('#category-select').value;
  const select=$('#room-select');select.replaceChildren();
  const unassigned=el('option','Assign later');unassigned.value='';select.append(unassigned);
  rooms.filter(r=>r.active&&r.category===category).forEach(r=>{const o=el('option',r.name);o.value=r.id;select.append(o);});
}
async function load(){[rooms,bookings]=await Promise.all([request('/api/rooms'),request('/api/bookings')]);renderBookings();renderRooms();}
function updatePreview(){
  const data=Object.fromEntries(new FormData($('#booking-form')));
  const start=Date.parse(data.checkin+'T00:00:00Z'), end=Date.parse(data.checkout+'T00:00:00Z');
  const nights=Number.isFinite(start)&&Number.isFinite(end)?(end-start)/86400000:0;
  const total=nights*Number(data.rooms_count)*Number(data.nightly_rate);
  $('#form-total').textContent=nights>0&&Number.isFinite(total)&&total>=0?
    nights+' night(s) · Total '+new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(total)+
    ' · Due '+new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(Math.max(0,total-Number(data.amount_paid||0))):
    'Enter valid dates, room count and GST-inclusive rate.';
}
$('#new-booking').addEventListener('click',()=>{$('#form-error').textContent='';$('#booking-dialog').showModal();});
$('#close-dialog').addEventListener('click',()=>$('#booking-dialog').close());
$('#cancel-dialog').addEventListener('click',()=>$('#booking-dialog').close());
$('#category-select').addEventListener('change',updateRoomOptions);
$('#booking-form').addEventListener('input',updatePreview);
$('#search').addEventListener('input',renderBookings);
$('#booking-form').addEventListener('submit',async e=>{
  e.preventDefault();const form=e.currentTarget;const data=Object.fromEntries(new FormData(form));
  const submit=form.querySelector('[type=submit]');submit.disabled=true;
  try{await request('/api/bookings',{method:'POST',body:JSON.stringify(data)});form.reset();$('#booking-dialog').close();await load();}
  catch(error){$('#form-error').textContent=error.message;}
  finally{submit.disabled=false;}
});
load().catch(e=>{$('#booking-list').textContent='Unable to load: '+e.message;});
