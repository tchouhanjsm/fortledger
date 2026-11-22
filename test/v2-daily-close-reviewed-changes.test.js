import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {createDailyClose,getDailyClose,reviewDailyClose,unreviewedDailyCloses} from '../src/daily-close.js';
import {recordExpense} from '../src/expenses.js';
import {auditEvents} from '../src/financial-audit.js';
const actor={id:0,username:'owner',role:'owner'};
const manager={id:2,username:'manager2',role:'manager'};
const cashier={id:3,username:'cashier3',role:'cashier'};

test('backdated correction creates unresolved close; review is immutable and invalidated by another edit',()=>{
  const db=openDatabase(':memory:'),day='2027-02-02';
  try{
    const close=createDailyClose(db,{business_date:day,opening_cash:100,counted_cash:100,
      request_id:randomUUID()},actor);
    assert.equal(getDailyClose(db,day).review.status,'current');
    recordExpense(db,{business_date:day,category:'supplies',amount:10,method:'cash',
      request_id:randomUUID()},actor);
    const stale=getDailyClose(db,day);
    assert.equal(stale.stale,true);
    assert.equal(stale.review.status,'needs_review');
    assert.equal(unreviewedDailyCloses(db).length,1);
    assert.throws(()=>reviewDailyClose(db,day,{disposition:'acknowledged',
      reason:'Verified receipt and cash count'},cashier),/Only owner or manager/);
    assert.throws(()=>reviewDailyClose(db,day,{disposition:'acknowledged',
      reason:'short'},manager),/10/);
    const reviewed=reviewDailyClose(db,day,{disposition:'acknowledged',
      reason:'Verified against supporting cash receipt and supervisor signoff'},manager);
    assert.equal(reviewed.stale,true,'original close snapshot stays immutable');
    assert.equal(reviewed.review.status,'reviewed');
    assert.equal(unreviewedDailyCloses(db).length,0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM daily_closes').get().n,1);
    const a=auditEvents(db,{entityType:'daily_close',entityId:close.id});
    assert.equal(a[0].action,'daily_close.reviewed');
    assert.equal(a[0].actor_username,'manager2');
    recordExpense(db,{business_date:day,category:'supplies',amount:5,method:'cash',
      request_id:randomUUID()},actor);
    assert.equal(getDailyClose(db,day).review.status,'needs_review');
    assert.equal(unreviewedDailyCloses(db).length,1);
    const investigation=reviewDailyClose(db,day,{disposition:'investigate',
      reason:'Reviewing late expense supporting documentation'},actor);
    assert.equal(investigation.review.status,'investigating');
    assert.equal(unreviewedDailyCloses(db).length,1,'investigations remain actionable');
  }finally{db.close();}
});

test('review and unresolved attention are available through existing finance-authorized routes',async()=>{
  const db=openDatabase(':memory:'),day='2027-02-02';
  const close=createDailyClose(db,{business_date:day,opening_cash:100,counted_cash:100,
    request_id:randomUUID()},actor);
  recordExpense(db,{business_date:day,category:'supplies',amount:10,method:'cash',
    request_id:randomUUID()},actor);
  const server=createApp(db).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  try{
    const base='http://127.0.0.1:'+server.address().port;
    const alert=await fetch(base+'/api/finance/closing/attention');
    assert.equal(alert.status,200);
    assert.equal((await alert.json())[0].business_date,day);
    const response=await fetch(base+'/api/finance/closing/review',{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({
        business_date:day,disposition:'acknowledged',
        reason:'Reviewed all late expense documentation'
      })});
    assert.equal(response.status,200);
    assert.equal((await response.json()).review.status,'reviewed');
    assert.deepEqual(await (await fetch(base+'/api/finance/closing/attention')).json(),[]);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
