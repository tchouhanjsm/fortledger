import { toPaise, nightsBetween } from './finance.js';

function textField(value,name,max=200) {
  if(typeof value!=='string'||!value.trim()||value.trim().length>max) throw new Error(name+' is required (max '+max+' characters)');
  return value.trim();
}
function optionalText(value,max=400){
  if(value===undefined||value===null)return '';
  if(typeof value!=='string'||value.length>max)throw new Error('Text is too long or invalid');
  return value.trim();
}
function count(value,name,max=1000){
  if(!Number.isSafeInteger(Number(value))||Number(value)<1||Number(value)>max)throw new Error('Invalid '+name);
  return Number(value);
}
export function normalizeInvoiceInput(body,booking){
  if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('Invalid invoice');
  const guest_name=textField(body.guest_name??booking.guest_name,'Guest/group name',150);
  const bill_to=textField(body.bill_to??(booking.company_name||booking.guest_name),'Bill to',150);
  const bill_to_address=optionalText(body.bill_to_address,500);
  const checkin=booking.checkin,checkout=booking.checkout;
  const defaultDescription=(booking.room_name||booking.category)+' - '+booking.meal_plan+' basis';
  const rawLines=body.lines??[{description:defaultDescription,rooms:booking.rooms_count,nights:nightsBetween(checkin,checkout),rate:booking.nightly_rate_paise/100}];
  if(!Array.isArray(rawLines)||rawLines.length<1||rawLines.length>20)throw new Error('Add 1 to 20 accommodation lines');
  const lines=rawLines.map((line,i)=>{
    if(!line||typeof line!=='object'||Array.isArray(line))throw new Error('Invalid line '+(i+1));
    const description=textField(line.description,'Accommodation description',200);
    const rooms=count(line.rooms,'room quantity',7);
    const nights=count(line.nights,'night quantity',366);
    const rate_paise=toPaise(line.rate);
    const total_paise=rooms*nights*rate_paise;
    if(!Number.isSafeInteger(total_paise)||total_paise>1e11)throw new Error('Line amount is too high');
    return {description,rooms,nights,rate_paise,total_paise};
  });
  const total_paise=lines.reduce((sum,line)=>sum+line.total_paise,0);
  if(!Number.isSafeInteger(total_paise)||total_paise>1e11)throw new Error('Invoice amount is too high');
  const taxable_paise=Math.round(total_paise*100/105),gst_paise=total_paise-taxable_paise;
  return {guest_name,bill_to,bill_to_address,checkin,checkout,lines,
    total_paise,taxable_paise,gst_paise,tax_rate:5};
}
