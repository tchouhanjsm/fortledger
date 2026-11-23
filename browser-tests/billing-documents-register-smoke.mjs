/* SHIZUKA documents search on 390px and 1440px with synthetic sources. */
import assert from 'node:assert/strict';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {createProforma} from '../src/invoices.js';
import {importMenuCsv,createRestaurantBill} from '../src/restaurant.js';
import {transitionBooking} from '../src/booking-transitions.js';
import {importExternalInvoiceOriginal} from '../src/external-invoice-originals.js';

const PDF=Buffer.from('%PDF-1.4\n1 0 obj\n<</Type /Catalog /Pages 2 0 R>>\nendobj\n2 0 obj\n<</Type /Pages /Count 0 /Kids []>>\nendobj\ntrailer\n<</Root 1 0 R>>\n%%EOF\n');
export async function runBillingDocumentsRegisterSmoke(browser){
 for(const width of [390,1440]){
  const db=openDatabase(':memory:');
  const bookingId=Number(db.prepare(`INSERT INTO bookings
    (guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise,status)
    VALUES('Synthetic Document Guest','2027-04-02','2027-04-03',1,'Unassigned',450000,'checked_in')`)
    .run().lastInsertRowid);
  db.prepare('INSERT INTO booking_room_allocations(booking_id,room_id) VALUES(?,1)').run(bookingId);
  createProforma(db,bookingId,{});
  importMenuCsv(db,'name,category,price,tax_rate\nSynthetic Tea,Drinks,80,5');
  createRestaurantBill(db,{payment_method:'room',booking_id:bookingId,items:[{menu_item_id:1,quantity:1}]});
  transitionBooking(db,bookingId,'checked_out',{actor:{id:0,username:'owner',role:'owner'},
    acknowledge_balance:true,businessDate:'2027-04-03'});
  importExternalInvoiceOriginal(db,PDF,'Previous-Online-Receipt.pdf',{id:0,username:'owner',role:'owner'});
  const server=createApp(db,{authRecord:createPasswordRecord('synthetic-document-owner-password')}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const context=await browser.newContext({viewport:{width,height:900}});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.goto(base+'/login.html');
   await page.locator('input[name=username]').fill('owner');
   await page.locator('input[name=password]').fill('synthetic-document-owner-password');
   await page.getByRole('button',{name:'Sign in'}).click();
   await page.waitForURL(base+'/');
   await page.goto(base+'/#invoices');
   const register=page.locator('#billing-documents-register');
   await page.waitForFunction(()=>document.querySelectorAll('#billing-register-list .billing-register-row').length===4);
   assert.equal(await register.locator('.billing-register-row').count(),4);
   assert.equal(await register.getByText('Previous-Online-Receipt.pdf').count(),1);
   assert.equal(await register.getByText('Checkout review #1').count(),1);
   await page.locator('#billing-register-kind').selectOption('historical_original');
   await page.locator('#billing-register-search').click();
   await page.waitForFunction(()=>document.querySelectorAll('#billing-register-list .billing-register-row').length===1);
   assert.match(await register.locator('.billing-register-row').textContent(),/External original PDF/);
   const saved=register.getByRole('link',{name:'Download stored original'});
   assert.equal(await saved.count(),1);
   const downloaded=await context.request.get(base+await saved.getAttribute('href'));
   assert.equal(downloaded.status(),200);
   assert.deepEqual(Buffer.from(await downloaded.body()),PDF);
   await page.locator('#billing-register-kind').selectOption('checkout_case');
   await page.locator('#billing-register-search').click();
   await page.waitForFunction(()=>document.querySelectorAll('#billing-register-list .billing-register-row').length===1);
   await register.getByRole('button',{name:'View live folio'}).click();
   await page.locator('#folio-dialog').waitFor({state:'visible'});
   assert.equal(db.prepare('SELECT COUNT(*) n FROM invoices').get().n,1);
   assert.deepEqual(errors,[]);
   console.log('PASS: role-safe unified billing documents register, original retrieved at '+width+'px');
  }finally{await context.close();await new Promise(resolve=>server.close(resolve));db.close();}
 }
}
