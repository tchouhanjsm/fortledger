/* Real Chromium smoke: disposable in-memory hotel, no external API or actual guests. */
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {chromium} from 'playwright';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {importMenuCsv} from '../src/restaurant.js';
import {runAuthenticatedBrowserSmoke} from './auth-smoke.mjs';

const screenshots=process.env.FORTLEDGER_CAPTURE_SCREENSHOTS==='1';
if(screenshots)mkdirSync('browser-artifacts',{recursive:true});
async function captureViewportWidth(page,width,name){
  // Retain the entire working page vertically but never expand PNG width
  // to include an intentionally scrollable calendar's offscreen columns.
  await page.evaluate(()=>window.scrollTo(0,0));
  const height=await page.evaluate(()=>{
    // overflow-x:clip can report viewport height as document scrollHeight;
    // use the last visible workspace section instead so full vertical content
    // is retained without including offscreen calendar columns.
    const last=[...document.querySelectorAll('main > section')]
      .filter(el=>getComputedStyle(el).display!=='none')
      .reduce((bottom,el)=>Math.max(bottom,el.getBoundingClientRect().bottom+scrollY),0);
    return Math.ceil(Math.max(document.documentElement.clientHeight,last+32));
  });
  await page.screenshot({path:'browser-artifacts/'+name+'.png',
    clip:{x:0,y:0,width,height}});
}
const db=openDatabase(':memory:');
importMenuCsv(db,'name,category,price,tax_rate\nMasala Chai,Hot Drinks,80,5');
const server=createApp(db).listen(0,'127.0.0.1');
await new Promise((resolve,reject)=>{
  server.once('listening',resolve);
  server.once('error',reject);
});
const base='http://127.0.0.1:'+server.address().port;
let browser;
try{
  browser=await chromium.launch({headless:true});
  // 320 CSS pixels is a 640px-at-200%-zoom reflow proxy, not an actual native zoom certification.
  for(const width of [320,360,390,768,1024,1280,1440,1920]){
    const page=await browser.newPage({viewport:{width,height:850}});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'/#bookings');
    await page.waitForFunction(()=>document.querySelector('#booking-results-count')?.textContent?.includes('bookings shown'),
      {timeout:10000});
    const heading=await page.locator('#workspace-title').textContent();
    assert.ok(heading?.length>2,'Workspace header should be populated');
    assert.equal(await page.locator('#bookings').isVisible(),true);
    if(screenshots&&(width===390||width===1440)){
      await captureViewportWidth(page,width,'shizuka-bookings-'+width);
    }
    // Icons and skip action must be real keyboard-accessible controls without
    // changing the route or creating any financial activity.
    assert.equal(await page.locator('#skip-to-main').count(),1);
    if(width===1440){
      const icons=page.getByRole('navigation',{name:'Primary'}).locator('a .nav-icon');
      assert.equal(await icons.count(),8);
      assert.deepEqual(await icons.evaluateAll(els=>els.map(el=>Math.round(el.getBoundingClientRect().width))),
        Array(8).fill(20));
      await page.locator('#skip-to-main').focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(()=>document.activeElement?.id),'workspace-main');
      assert.equal(await page.locator('#bookings').isVisible(),true);
    }
    if(width===1440){
      const layout=await page.evaluate(()=>{
        const box=selector=>document.querySelector(selector)?.getBoundingClientRect();
        const heading=box('#bookings > .panel-head h2'),
          filters=box('#bookings .booking-filters'),
          queue=box('#booking-quick-queues');
        return {headingWidth:heading?.width,headingHeight:heading?.height,
          filtersWidth:filters?.width,filtersScroll:document.querySelector('#bookings .booking-filters')?.scrollWidth,
          queueWidth:queue?.width};
      });
      assert.ok(layout.headingWidth>=200,'The reservation heading must not be squeezed by filters');
      assert.ok(layout.headingHeight<=32,'Reservation heading should fit on one line at 1440px');
      assert.ok(layout.filtersScroll<=layout.filtersWidth+2,'Booking filters must not clip controls');
    }
    assert.equal(await page.locator('#dashboard').isVisible(),false,
      'Hidden dashboard should not be exposed by responsive CSS');
    const manifest=await page.locator('link[rel="manifest"]').getAttribute('href');
    assert.equal(manifest,'/manifest.webmanifest','Both mobile and desktop should offer local install metadata');
    if(width<=700){
      // Booking rows render before async profile/collections initialization;
      // wait for role-aware mobile navigation instead of racing its setup.
      await page.getByRole('navigation',{name:'Mobile shortcuts'}).waitFor({state:'visible'});
      assert.equal(await page.getByRole('navigation',{name:'Mobile shortcuts'}).isVisible(),true);
      assert.equal(await page.getByRole('navigation',{name:'Primary'}).isVisible(),false);
      const bookingsShortcut=page.locator('#mobile-shortcuts a[data-view="bookings"]');
      assert.equal(await bookingsShortcut.getAttribute('aria-current'),'page');
      await page.locator('#mobile-more-toggle').click();
      assert.equal(await page.locator('#mobile-more-panel').isVisible(),true);
      await page.locator('#mobile-more-panel a[data-view="guests"]').click();
      await page.locator('#guests').waitFor({state:'visible'});
      assert.equal(await page.locator('#mobile-more-panel').isVisible(),false);
      await bookingsShortcut.click();
      await page.locator('#bookings').waitFor({state:'visible'});
    }else{
      assert.equal(await page.getByRole('navigation',{name:'Primary'}).isVisible(),true);
      assert.equal(await page.getByRole('navigation',{name:'Mobile shortcuts'}).isVisible(),false);
    }
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
      // A physically dirty room should appear once as a read-only Today
      // exception, then open the existing authorized readiness controls.
      const makeDirty=await page.request.patch(base+'/api/housekeeping/1',{
        data:{status:'dirty'},headers:{'Content-Type':'application/json'}});
      assert.equal(makeDirty.status(),200);
      await page.reload();
      await page.waitForFunction(()=>document.querySelector('#booking-results-count')?.textContent?.includes('bookings shown'));
      await page.locator('#mobile-shortcuts a[data-view="dashboard"]').click();
      await page.locator('#today-attention').waitFor({state:'visible'});
      await page.locator('#today-attention-items').getByRole('button',{
        name:/Rooms needing cleaning or out of service/}).click();
      await page.locator('#rooms').waitFor({state:'visible'});
      assert.equal(await page.locator('[data-room-filter="attention"]').getAttribute('aria-pressed'),'true');
      assert.equal(await page.locator('#room-readiness-count').textContent(),'1 of 7 physical rooms shown');
      const markReady=await page.request.patch(base+'/api/housekeeping/1',{
        data:{status:'ready'},headers:{'Content-Type':'application/json'}});
      assert.equal(markReady.status(),200);
      await page.reload();
      await page.waitForFunction(()=>document.querySelector('#room-readiness-count')?.textContent?.includes('physical rooms shown'));
      await page.locator('[data-room-filter="attention"]').click();
      assert.equal(await page.locator('#room-readiness-count').textContent(),'0 of 7 physical rooms shown');
      await page.locator('#mobile-shortcuts a[data-view="bookings"]').click();
      await page.locator('[data-booking-queue="unassigned"]').click();
      assert.equal(await page.locator('[data-booking-queue="unassigned"]').getAttribute('aria-pressed'),'true');
      assert.equal(await page.locator('#booking-work-filter').inputValue(),'unassigned');
      await page.locator('[data-booking-queue="all"]').click();
      // A read-only status check must report a lost local server without
      // submitting or replaying any financial mutation.
      await page.waitForFunction(()=>document.querySelector('#connection-status')?.dataset.state==='connected');
      await page.route('**/api/auth/status',route=>route.abort('failed'));
      await page.evaluate(()=>window.dispatchEvent(new Event('online')));
      await page.waitForFunction(()=>document.querySelector('#connection-status')?.dataset.state==='lost');
      assert.match(await page.locator('#connection-status').textContent(),/check the ledger before retrying/);
      await page.unroute('**/api/auth/status');
      await page.evaluate(()=>window.dispatchEvent(new Event('online')));
      await page.waitForFunction(()=>document.querySelector('#connection-status')?.dataset.state==='connected');
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
    if(width===1440){
      // The real server commits a restaurant bill, but Chromium loses the
      // POST response. The UI must lookup the UUID, not create a second bill.
      await page.evaluate(()=>{window.location.hash='restaurant';});
      await page.locator('#restaurant').waitFor({state:'visible'});
      if(screenshots){
        await captureViewportWidth(page,width,'shizuka-restaurant-1440');
      }
      const chip=page.locator('#menu-categories').getByRole('button',{name:'Hot Drinks'});
      await chip.click();
      assert.equal(await chip.getAttribute('aria-pressed'),'true');
      assert.equal(await page.locator('#menu-result-count').textContent(),'1 of 1 items');
      await page.locator('#menu-search').fill('no-such-dish');
      assert.equal(await page.locator('#menu-result-count').textContent(),'0 of 1 items');
      await page.locator('#menu-search').fill('');
      await page.locator('#menu-items').getByRole('button',{name:'Add Masala Chai to bill'}).first().click();
      const sum=await page.locator('#cart-total').textContent();
      assert.match(sum,/80\.00/);
      assert.equal(await page.locator('#cart-count').textContent(),'1 item');
      await page.locator('#cart-items').getByRole('button',{name:'Add one Masala Chai'}).click();
      assert.equal(await page.locator('#cart-count').textContent(),'2 items');
      await page.locator('#cart-items').getByRole('button',{name:'Remove one Masala Chai'}).click();
      assert.equal(await page.locator('#cart-count').textContent(),'1 item');
      assert.equal(await page.locator('#save-restaurant-bill').isVisible(),false);
      await page.locator('#review-restaurant-bill').click();
      await page.locator('#restaurant-review').waitFor({state:'visible'});
      assert.equal(await page.evaluate(()=>document.activeElement?.id),'restaurant-review-heading',
        'Review must move keyboard focus into the visible unsaved bill');
      assert.match(await page.locator('#restaurant-review-total').textContent(),/80\.00/);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM restaurant_bills').get().n,0,
        'Review is an unsaved draft');
      // A real cashier can remove or add menu items and change quantity
      // while reviewing, and no payment is posted until final confirmation.
      await page.locator('#cart-items').getByRole('button',{name:'Remove Masala Chai from bill'}).click();
      assert.equal(await page.locator('#save-restaurant-bill').isDisabled(),true);
      await page.locator('#menu-items').getByRole('button',{name:'Add Masala Chai to bill'}).first().click();
      await page.locator('#cart-items').getByRole('button',{name:'Add one Masala Chai'}).click();
      assert.match(await page.locator('#restaurant-review-total').textContent(),/160\.00/);
      await page.locator('#cart-items').getByRole('button',{name:'Remove one Masala Chai'}).click();
      assert.match(await page.locator('#restaurant-review-total').textContent(),/80\.00/);
      await page.locator('#edit-restaurant-bill').click();
      assert.equal(await page.evaluate(()=>document.activeElement?.id),'menu-search',
        'Continue editing must restore focus to the menu search');
      assert.equal(await page.locator('#restaurant-review').isVisible(),false);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM restaurant_bills').get().n,0);
      await page.locator('#review-restaurant-bill').click();
      let submissions=0;
      await page.route('**/api/restaurant/bills',async route=>{
        if(route.request().method()!=='POST')return route.continue();
        submissions++;
        const committed=await route.fetch();
        assert.equal(committed.status(),201);
        await route.abort('failed');
      });
      page.once('dialog',dialog=>dialog.accept());
      await page.locator('#save-restaurant-bill').click();
      await page.locator('#restaurant-history').getByText('#1', {exact:false}).first().waitFor({state:'visible'});
      assert.equal(submissions,1,'Lost response must not duplicate restaurant bill');
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM restaurant_bills').get().n,1);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM restaurant_bill_requests').get().n,1);
      const receiptLink=page.locator('#restaurant-message a').filter({hasText:'Open saved receipt #1'});
      await receiptLink.waitFor({state:'visible'});
      assert.equal(await page.evaluate(()=>document.activeElement?.id),'restaurant-message',
        'Saved receipt status should receive keyboard focus even after lost POST response');
      assert.match(await receiptLink.getAttribute('href'),/\/api\/restaurant\/bills\/1\/receipt/);
      // New restaurant workspace remains readable in a real 1440px browser:
      // collected means an actually recorded payment, never an unpaid room bill.
      assert.equal(await page.locator('#restaurant-today-bills').textContent(),
        '1',"A current synthetic cash bill should appear in today's IST overview");
      assert.match(await page.locator('#restaurant-today-collected').textContent(),/80\.00/);
      assert.equal(await page.locator('#restaurant-room-unpaid').textContent(),'0');
      assert.equal(await page.locator('#restaurant-room-unmatched').textContent(),'0');
      await page.locator('[data-bill-filter="unpaid"]').click();
      assert.match(await page.locator('#restaurant-history-count').textContent(),/0 of 1 saved bills/);
      await page.locator('[data-bill-filter="paid"]').click();
      assert.match(await page.locator('#restaurant-history-count').textContent(),/1 of 1 saved bills/);
      assert.match(await page.locator('.restaurant-history-status').textContent(),/Paid/);
      await page.locator('.restaurant-history-details summary').click();
      assert.match(await page.locator('.restaurant-history-item').textContent(),/Masala Chai/);
      await page.locator('[data-bill-filter="all"]').click();
      await page.locator('#restaurant-history-search').fill('Masala Chai');
      assert.match(await page.locator('#restaurant-history-count').textContent(),/1 of 1 saved bills/);
      await page.locator('#restaurant-history-search').fill('');
      await page.locator('#restaurant-history-search').fill('999999');
      assert.equal(await page.locator('#restaurant-history-count').textContent(),'0 of 1 saved bills matching search');
      await page.locator('#restaurant-history-search').fill('1');
      assert.equal(await page.locator('#restaurant-history-count').textContent(),'1 of 1 saved bills matching search');
      await page.locator('#restaurant-history-search').fill('');
      await page.locator('#refresh-workspace').click();
      await page.waitForFunction(()=>document.querySelector('#refresh-message')?.textContent?.includes('Hotel records refreshed'));
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM restaurant_bills').get().n,1,
        'Read-only refresh and receipt search must not recreate bills');
      await page.unroute('**/api/restaurant/bills');
      // Simulate a delayed PREVIEW for one CSV, then choose another file.
      // The stale response must not authorize importing the first menu.
      await page.locator('#menu-import-section').evaluate(node=>{node.open=true;});
      const fileControl=page.locator('#menu-csv');
      await page.route('**/api/restaurant/menu/preview',async route=>{
        const csv=route.request().postDataJSON()?.csv||'';
        if(csv.includes('Old Stale Menu'))
          await new Promise(resolve=>setTimeout(resolve,450));
        await route.continue();
      });
      await fileControl.setInputFiles({name:'first.csv',mimeType:'text/csv',
        buffer:Buffer.from('name,category,price,tax_rate\nOld Stale Menu,Hot Drinks,75,5')});
      await page.locator('#preview-menu').click();
      await fileControl.setInputFiles({name:'second.csv',mimeType:'text/csv',
        buffer:Buffer.from('name,category,price,tax_rate\nMasala Chai,Hot Drinks,90,5\nNew Juice,Drinks,60,5')});
      await page.waitForTimeout(650);
      assert.equal(await page.locator('#import-menu').isDisabled(),true);
      assert.equal(await page.locator('#menu-import-review-controls').isVisible(),false);
      await page.locator('#preview-menu').click();
      try{
        await page.waitForFunction(()=>
          document.querySelector('#menu-import-message')?.textContent?.includes('rows inspected'),
          undefined,{timeout:5000});
      }catch(error){
        const message=await page.locator('#menu-import-message').textContent();
        throw new Error('Second menu preview did not complete: '+message+' / '+error.message);
      }
      assert.equal(await page.locator('#menu-import-review-controls').isVisible(),true);
      assert.equal(await page.locator('#menu-import-preview tbody tr').count(),2);
      assert.equal(await page.locator('#menu-import-preview').getByText('Old Stale Menu').count(),0);
      await page.locator('#menu-import-change').selectOption('updated');
      assert.match(await page.locator('#menu-import-row-count').textContent(),/1 of 2/);
      await page.locator('#menu-import-change').selectOption('new');
      assert.match(await page.locator('#menu-import-row-count').textContent(),/1 of 2/);
      await page.locator('#menu-import-change').selectOption('all');
      page.once('dialog',dialog=>dialog.accept());
      await page.locator('#import-menu').click();
      await page.waitForFunction(()=>
        document.querySelector('#menu-import-message')?.textContent?.includes('Menu import recorded'));
      assert.equal(db.prepare("SELECT price_paise FROM menu_items WHERE name='Masala Chai'").get().price_paise,9000);
      assert.equal(db.prepare("SELECT COUNT(*) n FROM menu_items WHERE name='New Juice'").get().n,1);
      assert.equal(db.prepare("SELECT COUNT(*) n FROM menu_items WHERE name='Old Stale Menu'").get().n,0);
      assert.equal(db.prepare('SELECT items_snapshot FROM restaurant_bills WHERE id=1').get().items_snapshot.includes('8000'),true,
        'Historical restaurant receipt price remains immutable');
      await page.unroute('**/api/restaurant/menu/preview');
    }
    assert.deepEqual(errors,[],'Uncaught browser errors at '+width+'px: '+errors.join('; '));
    await page.close();
  }
  assert.equal(db.prepare('SELECT count(*) AS n FROM bookings').get().n,2);
  assert.equal(db.prepare('SELECT count(*) AS n FROM booking_create_requests').get().n,2);
  await runAuthenticatedBrowserSmoke(browser);
  console.log('PASS: Chromium receipt-loss reconciliation, booking/payment flow, responsive 320(reflow proxy)/360/390/768/1024/1280/1440/1920 px.');
}finally{
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
  db.close();
}
