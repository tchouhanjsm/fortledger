/* Chromium synthetic role-safe readiness handover and exact-room focus. */
import assert from 'node:assert/strict';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {createStaff} from '../src/staff.js';
import {hotelBusinessDate} from '../src/hotel-clock.js';

export async function runArrivalReadinessSmoke(browser){
  const db=openDatabase(':memory:');
  const today=hotelBusinessDate();
  const departure=new Date(Date.parse(today+'T00:00:00Z')+2*86400000).toISOString().slice(0,10);
  db.prepare("INSERT INTO bookings(id,guest_name,checkin,checkout,rooms_count,room_id,category,nightly_rate_paise,status) VALUES(1,'Synthetic Arrival',?,?,1,1,'Unassigned',450000,'reserved')")
    .run(today,departure);
  db.prepare('INSERT INTO booking_room_allocations(booking_id,room_id) VALUES(1,1)').run();
  db.prepare("UPDATE room_housekeeping SET status='dirty' WHERE room_id=1").run();
  createStaff(db,{username:'syntheticcashier',display_name:'Cashier',
    role:'cashier',password:'synthetic-cashier-password-long'});
  const app=createApp(db,{authRecord:createPasswordRecord('synthetic-owner-password-long'),
    checkUpdates:async()=>({platform:'windows',available:false,state:'up_to_date'})});
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  try{
    for(const user of [
      {username:'owner',password:'synthetic-owner-password-long',owner:true},
      {username:'syntheticcashier',password:'synthetic-cashier-password-long',owner:false}
    ]){
      const context=await browser.newContext({viewport:{width:390,height:850}});
      try{
        const page=await context.newPage(),errors=[];
        page.on('pageerror',error=>errors.push(error.message));
        await page.goto(base+'/login.html');
        await page.locator('input[name="username"]').fill(user.username);
        await page.locator('input[name="password"]').fill(user.password);
        await page.getByRole('button',{name:'Sign in'}).click();
        await page.waitForURL(base+'/');
        // The original HTML placeholder also says "Shift handover"; wait for
        // the data-derived count, otherwise a fast CI runner races the login load.
        await page.waitForFunction(()=>
          /^Shift handover · \d+ items? to review$/.test(
            document.querySelector('#shift-handover-summary')?.textContent||''));
        if(user.owner){
          const summary=await page.locator('#shift-handover-summary').textContent();
          assert.match(summary,/items? to review/);
          await page.locator('#shift-handover-summary').click();
          const alert=page.locator('.shift-handover-row').filter({hasText:'Room 1: needs cleaning'});
          await alert.waitFor();
          await alert.click();
          await page.waitForURL(base+'/#rooms');
          await page.waitForFunction(()=>document.activeElement?.id==='room-record-1');
          assert.equal(await page.locator('#room-record-1 select[aria-label^="Housekeeping state"]').inputValue(),'dirty');
          assert.equal(db.prepare("SELECT status FROM room_housekeeping WHERE room_id=1").get().status,'dirty',
            'Handover navigation must not change physical room state');
        }else{
          assert.equal(await page.locator('#shift-handover-items').getByText('Synthetic Arrival').count(),0);
          assert.equal((await context.request.get(base+'/api/bookings')).status(),403);
          assert.equal((await context.request.get(base+'/api/rooms')).status(),403);
        }
        assert.deepEqual(errors,[]);
      }finally{await context.close();}
    }
  }finally{
    await new Promise(resolve=>server.close(resolve));
    db.close();
  }
  console.log('PASS: Chromium role-scoped readiness handover and exact room focus at 390px.');
}
