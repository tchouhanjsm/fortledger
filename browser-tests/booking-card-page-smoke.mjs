/* Real Chromium bounded booking ledger smoke with synthetic historical data. */
import assert from 'node:assert/strict';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';

export async function runBookingCardPageSmoke(browser){
  const db=openDatabase(':memory:');
  const add=db.prepare("INSERT INTO bookings(guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise,status) VALUES(?,?,?,?,?,?,?)");
  db.transaction(()=>{
    for(let i=0;i<95;i++){
      const day=new Date(Date.UTC(2020,0,i+1)).toISOString().slice(0,10);
      const next=new Date(Date.UTC(2020,0,i+2)).toISOString().slice(0,10);
      add.run('Synthetic Guest '+i,day,next,1,'Unassigned',200000,'checked_out');
    }
  })();
  const app=createApp(db,{authRecord:createPasswordRecord('synthetic-owner-password-long'),
    checkUpdates:async()=>({platform:'windows',available:false,state:'up_to_date'})});
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const context=await browser.newContext({viewport:{width:390,height:850}});
  try{
    const page=await context.newPage(),errors=[];
    page.on('pageerror',err=>errors.push(err.message));
    await page.goto(base+'/login.html');
    await page.locator('input[name="username"]').fill('owner');
    await page.locator('input[name="password"]').fill('synthetic-owner-password-long');
    await page.getByRole('button',{name:'Sign in'}).click();
    await page.waitForURL(base+'/');
    await page.goto(base+'/#bookings');
    await page.locator('#booking-list-more').waitFor({state:'visible'});
    assert.equal(await page.locator('.booking-row').count(),40);
    assert.match(await page.locator('#booking-results-count').textContent(),/40 of 95 matching bookings shown/);
    await page.locator('#booking-list-more').click();
    assert.equal(await page.locator('.booking-row').count(),80);
    await page.locator('#booking-list-more').click();
    assert.equal(await page.locator('.booking-row').count(),95);
    assert.equal(await page.locator('#booking-list-more').isVisible(),false);
    await page.locator('#search').fill('Synthetic Guest 94');
    assert.equal(await page.locator('.booking-row').count(),1,
      'Search must find a record that was beyond the initial 40 cards');
    assert.match(await page.locator('#booking-list').textContent(),/Synthetic Guest 94/);
    await page.locator('#search').fill('');
    assert.equal(await page.locator('.booking-row').count(),40,
      'Clearing search must reset visible history to first batch');
    const saved=db.prepare('SELECT COUNT(*) n FROM bookings').get().n;
    assert.equal(saved,95,'Rendering/filters must never delete or change historical bookings');
    assert.deepEqual(errors,[]);
  }finally{
    await context.close();
    await new Promise(resolve=>server.close(resolve));
    db.close();
  }
  console.log('PASS: 390px Chromium 95 booking history bounded to 40/80/95, full search intact.');
}
