/* Real Chromium smoke: disposable in-memory hotel, no external API or actual guests. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';

const db=openDatabase(':memory:');
const server=createApp(db).listen(0,'127.0.0.1');
await new Promise((resolve,reject)=>{
  server.once('listening',resolve);
  server.once('error',reject);
});
const base='http://127.0.0.1:'+server.address().port;
let browser;
try{
  browser=await chromium.launch({headless:true});
  for(const width of [390,768,1440]){
    const page=await browser.newPage({viewport:{width,height:850}});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'/#bookings');
    await page.waitForFunction(()=>document.querySelector('#booking-results-count')?.textContent?.includes('bookings shown'),
      {timeout:10000});
    const heading=await page.locator('#workspace-title').textContent();
    assert.ok(heading?.length>2,'Workspace header should be populated');
    assert.equal(await page.locator('#bookings').isVisible(),true);
    assert.equal(await page.locator('#dashboard').isVisible(),false,
      'Hidden dashboard should not be exposed by responsive CSS');
    assert.equal(await page.getByRole('navigation',{name:'Primary'}).isVisible(),true);
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-
      document.documentElement.clientWidth);
    if(overflow>2){
      const offenders=await page.evaluate(()=>[...document.querySelectorAll('body *')]
        .filter(el=>!el.hidden&&getComputedStyle(el).display!=='none'&&
          el.getBoundingClientRect().right>document.documentElement.clientWidth+2)
        .slice(0,12).map(el=>({tag:el.tagName,id:el.id,klass:el.className,
          right:Math.round(el.getBoundingClientRect().right)})));
      console.error('Horizontal overflow candidates at '+width+'px:',JSON.stringify(offenders));
    }
    assert.ok(overflow<=2,'Unexpected page horizontal overflow at '+width+'px: '+overflow);

    if(width===390){
      await page.locator('#new-booking').click();
      await page.locator('#booking-dialog').waitFor({state:'visible'});
      await page.locator('#booking-form [name="guest_name"]').fill('Synthetic Browser Guest');
      await page.locator('#booking-form [name="checkin"]').fill('2027-01-10');
      await page.locator('#booking-form [name="checkout"]').fill('2027-01-12');
      await page.locator('#booking-form [name="nightly_rate"]').fill('4500');
      await page.locator('#booking-form [name="amount_paid"]').fill('0');
      const preview=await page.locator('#form-total').textContent();
      assert.match(preview,/2 night\(s\)/);
      await page.locator('#booking-submit').click();
      await page.locator('#booking-dialog').waitFor({state:'hidden'});
      await page.getByText('Synthetic Browser Guest',{exact:true}).first().waitFor();
      const count=await page.locator('#booking-results-count').textContent();
      assert.match(count,/1 of 1/);

      const bookingRow=page.locator('.booking-row').filter({hasText:'Synthetic Browser Guest'});
      assert.equal(await bookingRow.count(),1);
      await bookingRow.getByText('More actions',{exact:true}).click();
      assert.equal(await bookingRow.getByRole('button',{name:'Payments'}).isVisible(),true);
      await bookingRow.getByRole('button',{name:'+ Payment'}).click();
      await page.locator('#booking-payment-dialog').waitFor({state:'visible'});
      await page.locator('#booking-payment-form [name="amount"]').fill('500');
      await page.locator('#booking-payment-form [name="method"]').selectOption('upi');
      page.once('dialog',dialog=>dialog.accept());
      await page.locator('#payment-submit').click();
      await page.locator('#booking-payment-dialog').waitFor({state:'hidden'});
      assert.equal(db.prepare('SELECT count(*) AS n FROM payments').get().n,1);
      assert.equal(db.prepare('SELECT sum(amount_paise) AS n FROM payments').get().n,50000);
    }
    assert.deepEqual(errors,[],'Uncaught browser errors at '+width+'px: '+errors.join('; '));
    await page.close();
  }
  assert.equal(db.prepare('SELECT count(*) AS n FROM bookings').get().n,1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM booking_create_requests').get().n,1);
  console.log('PASS: Chromium reception flow at 390, 768, and 1440 px, booking and payment recorded once.');
}finally{
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
  db.close();
}
