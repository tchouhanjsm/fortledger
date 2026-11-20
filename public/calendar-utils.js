// Pure date-only calendar helpers. Checkout is not an occupied night.
export function occupiedRoomCount(bookings,day){
  return bookings.filter(b=>b.status!=='cancelled'&&b.checkin<=day&&day<b.checkout)
    .reduce((sum,b)=>sum+Number(b.rooms_count),0);
}
export function monthGrid(year,month){
  const first=new Date(year,month,1);
  const offset=(first.getDay()+6)%7; // Monday-start
  const count=new Date(year,month+1,0).getDate();
  const dates=[];
  for(let i=-offset;i<count||dates.length%7!==0;i++){
    const d=new Date(year,month,i+1);
    dates.push({date:d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'),
      day:d.getDate(),inMonth:d.getMonth()===month});
  }
  return dates;
}
