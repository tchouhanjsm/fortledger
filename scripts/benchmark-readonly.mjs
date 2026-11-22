/* Deterministic synthetic local HTTP read baseline. Never opens a hotel DB. */
import {performance} from 'node:perf_hooks';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {summarizeSamples} from '../src/benchmark-metrics.js';

const BUSINESS_DAY='2026-11-22';
const PATHS=[
  '/api/health',
  '/api/rooms',
  '/api/bookings',
  '/api/finance/daily?date='+BUSINESS_DAY,
  '/api/finance/closing/attention'
];
function seedHistory(db,count){
  const add=db.prepare('INSERT INTO bookings(guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise,status) VALUES(?,?,?,?,?,?,?)');
  const start=Date.UTC(2020,0,1);
  db.transaction(()=>{
    for(let i=0;i<count;i++){
      const arrival=new Date(start+i*86400000).toISOString().slice(0,10);
      const departure=new Date(start+(i+1)*86400000).toISOString().slice(0,10);
      add.run('Synthetic Guest '+i,arrival,departure,1,'Unassigned',400000,'checked_out');
    }
  })();
}
async function request(base,path){
  const then=performance.now();
  const response=await fetch(base+path,{cache:'no-store'});
  if(!response.ok)throw new Error('Synthetic GET '+path+' returned HTTP '+response.status);
  await response.json(); // Include actual network transfer + JSON decoding.
  return performance.now()-then;
}
async function measure(label,count){
  const db=openDatabase(':memory:'); // Only a disposable memory database.
  let server;
  try{
    seedHistory(db,count);
    server=createApp(db).listen(0,'127.0.0.1');
    await new Promise((resolve,reject)=>{
      server.once('listening',resolve);server.once('error',reject);
    });
    const base='http://127.0.0.1:'+server.address().port;
    const results={};
    for(const path of PATHS){
      for(let i=0;i<2;i++)await request(base,path);
      const timings=[];
      for(let i=0;i<10;i++)timings.push(await request(base,path));
      results[path]=summarizeSamples(timings);
    }
    const queryPlan=db.prepare('EXPLAIN QUERY PLAN SELECT id FROM bookings WHERE checkin<=? AND checkout>? AND status!=?')
      .all(BUSINESS_DAY,BUSINESS_DAY,'cancelled').map(row=>row.detail);
    return {dataset:label,synthetic_bookings:count,requests:results,booking_query_plan:queryPlan};
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve));
    db.close();
  }
}
const started=performance.now(),cpuBefore=process.cpuUsage();
const normal=await measure('seven-room small history',28);
const history=await measure('seven-room long history',700);
const cpu=process.cpuUsage(cpuBefore);
console.log(JSON.stringify({
  note:'Synthetic read-only local HTTP observations, not a hotel-machine SLA or production benchmark',
  node:process.version,timezone:'Asia/Kolkata',runs:[normal,history],
  process_cpu_ms:+((cpu.user+cpu.system)/1000).toFixed(1),
  elapsed_ms:+(performance.now()-started).toFixed(1),
  rss_mib:+(process.memoryUsage().rss/1048576).toFixed(1),
  limitations:['No real guest data, printer, PDF rendering, Chromium navigation, idle CPU or physical backup restore measured',
    'Never compare results across different CI runner machines as production performance claims',
    'Read-only measurement only; no payment, booking or restaurant API mutations']
},null,2));
