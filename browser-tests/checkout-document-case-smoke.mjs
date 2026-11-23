/* Real browser presentation of a server-triggered, immutable nonstatutory
 * document review case. The simulated guest checkout stays fully local. */
import assert from 'node:assert/strict';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {createStaff} from '../src/staff.js';

export async function runCheckoutDocumentCaseSmoke(browser){
 for(const width of [390,1440]){
  const db=openDatabase(':memory:');
  const bookingId=Number(db.prepare(`INSERT INTO bookings
    (guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise,status)
    VALUES('Synthetic Checkout Case Guest','2027-04-02','2027-04-03',1,'Unassigned',470000,'checked_in')`)
    .run().lastInsertRowid);
  db.prepare('INSERT INTO booking_room_allocations(booking_id,room_id) VALUES(?,1)').run(bookingId);
  const password='synthetic-checkout-case-frontdesk-pass';
  createStaff(db,{username:'case-frontdesk',display_name:'Front desk',role:'frontdesk',password});
  const server=createApp(db,{authRecord:createPasswordRecord('synthetic-owner-checkout-pass'),
    businessDate:()=> '2027-04-03'}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const context=await browser.newContext({viewport:{width,height:900}});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  try{
   await page.goto(base+'/login.html');
   await page.locator('input[name=username]').fill('case-frontdesk');
   await page.locator('input[name=password]').fill(password);
   await page.getByRole('button',{name:'Sign in'}).click();
   await page.waitForURL(base+'/');
   const transition=await context.request.patch(base+'/api/bookings/'+bookingId+'/status',{
     data:{status:'checked_out',acknowledge_balance:true},
     headers:{'Content-Type':'application/json'}
   });
   assert.equal(transition.status(),200);
   const result=await transition.json();
   assert.equal(result.invoice_issued,false);
   assert.equal(result.checkout_document_case_id,1);
   await page.goto(base+'/#invoices');
   await page.locator('#invoices').waitFor({state:'visible'});
   const panel=page.locator('#checkout-document-cases');
   await panel.locator('summary').click();
   await panel.getByText('Synthetic Checkout Case Guest').waitFor({state:'visible'});
   assert.match(await panel.locator('#checkout-case-list').textContent(),/held for review/);
   assert.match(await panel.locator('#checkout-case-list').textContent(),/4,700/);
   await panel.getByRole('button',{name:'View live guest folio'}).click();
   await page.locator('#folio-dialog').waitFor({state:'visible'});
   assert.equal(db.prepare('SELECT COUNT(*) n FROM checkout_document_cases').get().n,1);
   assert.equal(db.prepare('SELECT COUNT(*) n FROM invoices').get().n,0);
   assert.deepEqual(errors,[]);
   console.log('PASS: checkout created held document case; front desk sees list and folio at '+width+'px');
  }finally{await context.close();await new Promise(resolve=>server.close(resolve));db.close();}
 }
}
