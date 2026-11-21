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
      const hierarchy=await page.evaluate(()=>[...document.querySelectorAll('body,body > *,main > *,#bookings > *,#calendar > *,header > *, .sidebar > *')]
        .map(el=>({tag:el.tagName,id:el.id,cls:typeof el.className==='string'?el.className:'',width:Math.round(el.getBoundingClientRect().width),right:Math.round(el.getBoundingClientRect().right),scrollWidth:el.scrollWidth,display:getComputedStyle(el).display}))
        .filter(x=>x.right>document.documentElement.clientWidth+2||x.scrollWidth>x.width+3)
        .slice(0,40));
      console.error('Page hierarchy overflow:',JSON.stringify(hierarchy));
      console.error('Horizontal overflow candidates at '+width+'px:',JSON.stringify(offenders));
    }
    // Programmatic scrollTo can traverse overflow:hidden even when a user cannot.
    // Verify a real wheel interaction instead; calendar/nav keep their own scrollbars.
    await page.mouse.move(1,Math.min(790,850-10));
    await page.mouse.wheel(120,0);
    await page.waitForTimeout(100);
    const horizontalPan=await page.evaluate(()=>window.scrollX);
    assert.ok(horizontalPan<=2,'Page pans sideways by user input at '+width+'px: '+
      horizontalPan+'px (document intrinsic overflow '+overflow+'px)');

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
      await page.locator('#booking-list .booking-row')
        .filter({hasText:'Synthetic Browser Guest'}).waitFor({state:'visible'});
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

      // Reproduce the browser's Failed to fetch AFTER SQLite has committed.
      // Route the real POST through the server, then deliberately drop its
      // response. The client must confirm by UUID without submitting again.
      let attemptedCreates=0;
      await page.route('**/api/bookings',async route=>{
        if(route.request().method()!=='POST')return route.continue();
        attemptedCreates++;
        const serverResponse=await route.fetch();
        assert.equal(serverResponse.status(),201);
        await route.abort('failed');
      });
      await page.locator('#new-booking').click();
      await page.locator('#booking-dialog').waitFor({state:'visible'});
      await page.locator('#booking-form [name="guest_name"]').fill('Synthetic Lost Response Guest');
      await page.locator('#booking-form [name="checkin"]').fill('2027-01-15');
      await page.locator('#booking-form [name="checkout"]').fill('2027-01-16');
      await page.locator('#booking-form [name="nightly_rate"]').fill('4200');
      await page.locator('#booking-form [name="amount_paid"]').fill('0');
      page.once('dialog',dialog=>dialog.accept());
      await page.locator('#booking-submit').click();
      await page.locator('#booking-dialog').waitFor({state:'hidden'});
      await page.locator('#booking-list .booking-row')
        .filter({hasText:'Synthetic Lost Response Guest'}).waitFor({state:'visible'});
      assert.equal(attemptedCreates,1,'Lost response must not create another booking');
      assert.equal(db.prepare('SELECT count(*) AS n FROM bookings').get().n,2);
      assert.equal(db.prepare('SELECT count(*) AS n FROM booking_create_requests').get().n,2);
      assert.equal(db.prepare('SELECT count(*) AS n FROM payments').get().n,1);
      await page.unroute('**/api/bookings');
    }
    if(width===768){
      // Create a proforma directly inside the invoice workspace without
      // switching to a booking card or entering financial data twice.
      await page.evaluate(()=>{window.location.hash='invoices';});
      await page.locator('#invoices').waitFor({state:'visible'});
      const select=page.locator('#invoice-booking-select');
      const originalOption=select.locator('option').filter({hasText:'Synthetic Browser Guest'});
      await select.selectOption(await originalOption.getAttribute('value'));
      await page.locator('#invoice-create-proforma').click();
      await page.locator('#invoice-dialog').waitFor({state:'visible'});
      assert.equal(await page.locator('#invoice-form [name="bill_to"]').inputValue(),'Synthetic Browser Guest');
      await page.locator('#invoice-form button[type=submit]').click();
      await page.locator('#invoice-dialog').waitFor({state:'hidden'});
      await page.locator('#invoice-list .invoice-row').first().waitFor({state:'visible'});
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM invoices').get().n,1);
      await page.locator('#invoice-list .invoice-row').first().getByRole('button',{name:'Tax draft'}).click();
      await page.locator('#tax-draft-dialog').waitFor({state:'visible'});
      assert.match(await page.locator('#tax-draft-dialog').textContent(),/No statutory invoice number is issued/);
      await page.locator('#close-tax-draft').click();
    }
    assert.deepEqual(errors,[],'Uncaught browser errors at '+width+'px: '+errors.join('; '));
    await page.close();
  }
  assert.equal(db.prepare('SELECT count(*) AS n FROM bookings').get().n,2);
  assert.equal(db.prepare('SELECT count(*) AS n FROM booking_create_requests').get().n,2);
  console.log('PASS: Chromium receipt-loss reconciliation, real booking/payment flow, 390/768/1440 px.');
}finally{
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
  db.close();
}
