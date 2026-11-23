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
  let ownerContext=null;
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
   // Real owner browser interaction: verify the review button encodes JSON,
   // persists the event once and never changes the immutable checkout case.
   const frozen=db.prepare('SELECT snapshot_json FROM checkout_document_cases WHERE id=1').get().snapshot_json;
   ownerContext=await browser.newContext({viewport:{width,height:900}});
   const ownerPage=await ownerContext.newPage();
   ownerPage.on('pageerror',error=>errors.push(error.message));
   await ownerPage.goto(base+'/login.html');
   await ownerPage.locator('input[name=username]').fill('owner');
   await ownerPage.locator('input[name=password]').fill('synthetic-owner-checkout-pass');
   await ownerPage.getByRole('button',{name:'Sign in'}).click();
   await ownerPage.waitForURL(base+'/');
   await ownerPage.goto(base+'/#invoices');
   await ownerPage.locator('#invoices').waitFor({state:'visible'});
   const ownerPanel=ownerPage.locator('#checkout-document-cases');
   await ownerPanel.locator('summary').click();
   const review=ownerPanel.locator('.checkout-case-review-actions').first();
   await review.waitFor({state:'visible'});
   await review.locator('select').selectOption('reviewed_for_accountant');
   await review.locator('textarea').fill('Synthetic owner checked stay charges and source records');
   await review.locator('input[type=checkbox]').check();
   if(width===390){
     const panelBounds=await ownerPanel.boundingBox();
     const actionBounds=await review.boundingBox();
     assert.ok(panelBounds&&actionBounds&&actionBounds.width<=panelBounds.width+1,
       'Owner review controls must fit the mobile panel without horizontal overflow');
   }
   await review.getByRole('button',{name:'Save nonstatutory review'}).click();
   await ownerPage.waitForFunction(()=>
     document.querySelector('#checkout-case-list')?.textContent?.includes('reviewed for accountant'));
   assert.equal(db.prepare('SELECT COUNT(*) n FROM checkout_case_review_events').get().n,1);
   assert.equal(db.prepare('SELECT status FROM checkout_case_review_events').get().status,'reviewed_for_accountant');
   assert.equal(db.prepare('SELECT snapshot_json FROM checkout_document_cases WHERE id=1').get().snapshot_json,frozen);
   assert.equal(db.prepare('SELECT COUNT(*) n FROM invoices').get().n,0);
   assert.deepEqual(errors,[]);
   console.log('PASS: front desk held case and owner UI review without issuance at '+width+'px');
  }finally{
    if(ownerContext)await ownerContext.close();
    await context.close();
    await new Promise(resolve=>server.close(resolve));
    db.close();
  }
 }
}
