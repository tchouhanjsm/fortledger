/* Browser acceptance for the existing folio's read-only checkout preflight.
 * Synthetic data only; never attempts a statutory document, a real refund or email. */
import assert from 'node:assert/strict';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {createStaff} from '../src/staff.js';
import {importMenuCsv,createRestaurantBill} from '../src/restaurant.js';

export async function runCheckoutInvoicePreflightSmoke(browser){
  for(const width of [390,1440]){
    const db=openDatabase(':memory:');
    const id=Number(db.prepare(`INSERT INTO bookings
      (guest_name,company_name,checkin,checkout,rooms_count,category,nightly_rate_paise,status)
      VALUES('Synthetic Checkout Guest','Synthetic Company','2027-03-11','2027-03-12',1,'Unassigned',450000,'checked_in')`).run().lastInsertRowid);
    importMenuCsv(db,'name,category,price,tax_rate\nTea,Drinks,80,5');
    const bill=createRestaurantBill(db,{payment_method:'room',booking_id:id,
      items:[{menu_item_id:1,quantity:2}]});
    const originalBill=db.prepare('SELECT * FROM restaurant_bills WHERE id=?').get(bill.id);
    const password='synthetic-frontdesk-checkout-password-2027';
    createStaff(db,{username:'folio-frontdesk',display_name:'Folio Front Desk',
      role:'frontdesk',password});
    const server=createApp(db,{authRecord:createPasswordRecord('synthetic-owner-pass-2027')})
      .listen(0,'127.0.0.1');
    await new Promise(resolve=>server.once('listening',resolve));
    const base='http://127.0.0.1:'+server.address().port;
    const page=await browser.newPage({viewport:{width,height:900}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    try{
      await page.goto(base+'/login.html');
      await page.locator('input[name=username]').fill('folio-frontdesk');
      await page.locator('input[name=password]').fill(password);
      await page.getByRole('button',{name:'Sign in'}).click();
      await page.waitForURL(base+'/');
      await page.goto(base+'/#bookings');
      await page.waitForFunction(()=>document.querySelector('#booking-results-count')?.textContent?.includes('bookings shown'));
      await page.locator('.booking-row').filter({hasText:'Synthetic Checkout Guest'})
        .getByRole('button',{name:'Guest folio'}).click();
      const review=page.locator('#folio-invoice-preflight');
      await review.locator('summary').click();
      await review.getByText('Tax invoice: held for accountant review').waitFor({state:'visible'});
      const text=await page.locator('#folio-invoice-preflight-results').textContent();
      assert.match(text,/Accommodation.*4,500/);
      assert.match(text,/linked food room charges/);
      assert.match(text,/Blocked: Existing online-generator PDFs/);
      assert.match(text,/Recorded receipts|Operator-recorded receipts/);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM invoices').get().n,0);
      assert.deepEqual(db.prepare('SELECT * FROM restaurant_bills WHERE id=?').get(bill.id),
        originalBill,'No printed or source bill is changed by preview');
      assert.deepEqual(errors,[],'Browser must not crash at '+width+'px');
      console.log('PASS: read-only checkout preflight in guest folio, frontdesk '+width+'px');
    }finally{
      await page.close();
      await new Promise(resolve=>server.close(resolve));
      db.close();
    }
  }
}
