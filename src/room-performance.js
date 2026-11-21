import {nightsBetween} from './finance.js';

const DAY=86400000;
function date(value){
  if(typeof value!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)||
    !Number.isFinite(Date.parse(value+'T00:00:00Z'))||
    new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)
    throw new Error('Use valid YYYY-MM-DD reporting dates');
  return value;
}
/** Reservation performance, NOT checked-in guest headcount or recognized accounting revenue. */
export function roomPerformance(db,start,end){
  start=date(start);end=date(end);
  const days=nightsBetween(start,end);
  if(days>366)throw new Error('Reporting period may not exceed 366 nights');
  const rooms=db.prepare('SELECT id,category,active FROM rooms ORDER BY id').all();
  const activeRooms=rooms.filter(r=>r.active===1);
  const stays=db.prepare(`SELECT id,checkin,checkout,rooms_count,nightly_rate_paise,status
    FROM bookings WHERE status!='cancelled' AND checkin<? AND checkout>?`).all(end,start);
  const outages=db.prepare(`SELECT room_id,start_date,end_date FROM maintenance_issues
    WHERE status='open' AND blocks_room=1 AND start_date<? AND end_date>?`).all(end,start);
  const daily=[];
  let sold=0,available=0,blocked=0,gross=0;
  for(let stamp=Date.parse(start+'T00:00:00Z');stamp<Date.parse(end+'T00:00:00Z');stamp+=DAY){
    const day=new Date(stamp).toISOString().slice(0,10);
    const physicalBlocks=new Set(outages.filter(m=>m.start_date<=day&&day<m.end_date).map(m=>m.room_id));
    const out=activeRooms.filter(room=>physicalBlocks.has(room.id)).length;
    const inventory=activeRooms.length-out;
    const booked=stays.filter(b=>b.checkin<=day&&day<b.checkout);
    const roomNights=booked.reduce((n,b)=>n+b.rooms_count,0);
    const roomGross=booked.reduce((sum,b)=>sum+b.rooms_count*b.nightly_rate_paise,0);
    if(!Number.isSafeInteger(roomGross)||!Number.isSafeInteger(gross+roomGross))
      throw new Error('Accommodation amount exceeds safe reporting range');
    if(roomNights>inventory)
      throw new Error('Overcommitted inventory for '+day+'; review reservations and maintenance');
    daily.push({date:day,available_room_nights:inventory,booked_room_nights:roomNights,
      blocked_room_nights:out,gross_booked_paise:roomGross});
    sold+=roomNights;available+=inventory;blocked+=out;gross+=roomGross;
  }
  return {
    start_date:start,end_date_exclusive:end,physical_rooms:rooms.length,active_rooms:activeRooms.length,
    booked_room_nights:sold,available_room_nights:available,blocked_room_nights:blocked,
    booking_occupancy_percent:available?Math.round(sold/available*10000)/100:null,
    gross_booked_accommodation_paise:gross,
    gross_adr_paise:sold?Math.round(gross/sold):null,
    gross_revpar_paise:available?Math.round(gross/available):null,
    daily,
    definitions:{
      occupancy:'Booked room-nights / active available room-nights; includes future reservations and checked-out past stays',
      adr:'GST-inclusive booked accommodation amount / booked room-nights (gross ADR, not industry-standard net-of-tax ADR)',
      revpar:'GST-inclusive booked accommodation amount / active available room-nights (gross RevPAR)',
      revenue:'Quoted GST-inclusive accommodation value allocated equally to booked nights. NOT cash received, taxable turnover or earned accounting revenue',
      availability:'Active physical rooms minus unique date-overlapping open maintenance outages; checkout date is exclusive'
    }
  };
}
