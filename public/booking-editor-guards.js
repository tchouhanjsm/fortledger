/* Client-side guidance only. Server-side availability, pricing, transitions and RBAC
   remain authoritative. ISO hotel dates use half-open [checkin, checkout). */
export function bookingDraftError(data,assignedCount){
  const checkin=String(data.checkin||''),checkout=String(data.checkout||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(checkin)||
     !/^\d{4}-\d{2}-\d{2}$/.test(checkout)||checkout<=checkin)
    return 'Check-out must be after check-in. Dates are hotel nights.';
  const count=Number(data.rooms_count);
  if(!Number.isSafeInteger(count)||count<1||count>7)
    return 'Choose between one and seven physical rooms.';
  if(!Number.isSafeInteger(assignedCount)||assignedCount>count||assignedCount<0)
    return 'Assigned physical rooms cannot exceed the booked room count.';
  return '';
}
