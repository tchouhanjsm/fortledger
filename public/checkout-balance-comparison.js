// Compare the captured checkout figures to the current read-only folio preflight.
// This is an operational review aid, not a statutory or payment authorization.
const fields=[
 ['charges_paise','Total charges'],
 ['operator_recorded_paise','Operator-recorded payments'],
 ['due_paise','Outstanding balance'],
 ['accommodation_charge_paise','Accommodation charges'],
 ['restaurant_room_charges_paise','Room restaurant charges'],
 ['restaurant_recorded_paise','Settled room restaurant charges']
];
function billsSignature(bills){
 if(!Array.isArray(bills))return null;
 const rows=[];
 for(const b of bills){
  if(!Number.isSafeInteger(b?.bill_id)||b.bill_id<1||
    !Number.isSafeInteger(b.total_paise)||!Number.isSafeInteger(b.tax_included_paise)||
    !['operator_recorded_settled','room_receivable'].includes(b.payment_state))return null;
  rows.push([b.bill_id,b.total_paise,b.tax_included_paise,b.payment_state,b.settled_at||null]);
 }
 rows.sort((a,b)=>a[0]-b[0]);
 return JSON.stringify(rows);
}
export function compareCheckoutBalances(snapshot,current){
 if(!snapshot||!current||!Number.isSafeInteger(snapshot.booking_id)||
   snapshot.booking_id<1||snapshot.booking_id!==current.booking_id)
  return {state:'unavailable',changes:[],room_bills_changed:false};
 const changes=[];
 for(const [key,label] of fields){
  const before=snapshot.totals?.[key],after=current.totals?.[key];
  if(!Number.isSafeInteger(before)||!Number.isSafeInteger(after))
   return {state:'unavailable',changes:[],room_bills_changed:false};
  if(before!==after)changes.push({key,label,before,after});
 }
 const before=billsSignature(snapshot.restaurant_room_charges);
 const after=billsSignature(current.restaurant_room_charges);
 if(before===null||after===null)return {state:'unavailable',changes:[],room_bills_changed:false};
 const room_bills_changed=before!==after;
 return {state:changes.length||room_bills_changed?'changed':'unchanged',changes,room_bills_changed};
}
