/** Financial event timestamps are UTC; hotel business dates are always IST,
 * independent of the server's and staff phone's configured locale. */
export const HOTEL_TIME_ZONE='Asia/Kolkata';
export function hotelBusinessDate(instant=new Date()){
  const date=instant instanceof Date?instant:new Date(instant);
  if(!Number.isFinite(date.getTime()))throw new Error('Invalid hotel business instant');
  const parts=new Intl.DateTimeFormat('en-GB',{
    timeZone:HOTEL_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(date);
  const fields=Object.fromEntries(parts.filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  return fields.year+'-'+fields.month+'-'+fields.day;
}
