/* Synthetic full browser journey for owner-only archived external PDF originals.
 * No actual invoice data, real file paths, statutory issuance or external network. */
import assert from 'node:assert/strict';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';

const PDF=Buffer.from('%PDF-1.4\n1 0 obj\n<</Type /Catalog /Pages 2 0 R>>\nendobj\n2 0 obj\n<</Type /Pages /Count 0 /Kids []>>\nendobj\ntrailer\n<</Root 1 0 R>>\n%%EOF\n');
export async function runExternalInvoiceOriginalsSmoke(browser){
 for(const width of [390,1440]){
  const db=openDatabase(':memory:');
  const server=createApp(db,{authRecord:createPasswordRecord('synthetic-external-owner-password')})
    .listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const context=await browser.newContext({viewport:{width,height:900}});
  try{
   const page=await context.newPage(),errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   await page.goto(base+'/login.html');
   await page.locator('input[name=username]').fill('owner');
   await page.locator('input[name=password]').fill('synthetic-external-owner-password');
   await page.getByRole('button',{name:'Sign in'}).click();
   await page.waitForURL(base+'/');
   await page.goto(base+'/#invoices');
   await page.locator('#historical-invoice-originals').waitFor({state:'visible'});
   const section=page.locator('#historical-invoice-originals');
   await section.locator('summary').click();
   await section.locator('#external-doc-files').setInputFiles({
     name:'Synthetic Historical Invoice.pdf',mimeType:'application/pdf',buffer:PDF
   });
   await section.getByText('1 PDF file(s) selected').waitFor({state:'visible'});
   page.once('dialog',dialog=>dialog.accept());
   await section.getByRole('button',{name:'Import selected original copies'}).click();
   await page.waitForFunction(()=>document.querySelector('#external-doc-import-status')?.textContent?.includes('1 new original(s) stored'));
   await section.getByText('Synthetic Historical Invoice.pdf').waitFor({state:'visible'});
   const entry=db.prepare('SELECT id,sha256,original_filename,pdf_bytes FROM external_invoice_originals').get();
   assert.deepEqual(entry.pdf_bytes,PDF);
   const downloaded=await context.request.get(base+'/api/external-invoice-originals/'+entry.id+'/original');
   assert.equal(downloaded.status(),200);
   assert.deepEqual(Buffer.from(await downloaded.body()),PDF);
   assert.equal(db.prepare('SELECT COUNT(*) AS n FROM invoices').get().n,0);
   assert.deepEqual(errors,[]);
   console.log('PASS: archived historical PDF selected, copied and downloaded (owner '+width+'px)');
  }finally{await context.close();await new Promise(resolve=>server.close(resolve));db.close();}
 }
}
