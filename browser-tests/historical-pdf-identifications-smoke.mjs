/* Synthetic owner review of a saved external PDF number/date.
 * Real guest PDFs, real GSTIN and statutory issue features are not used. */
import assert from 'node:assert/strict';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';

const PDF=Buffer.from('%PDF-1.4\n1 0 obj\n<</Type /Catalog /Pages 2 0 R>>\nendobj\n2 0 obj\n<</Type /Pages /Count 0 /Kids []>>\nendobj\ntrailer\n<</Root 1 0 R>>\n%%EOF\n');
export async function runHistoricalPdfIdentificationsSmoke(browser){
 for(const width of [390,1440]){
  const db=openDatabase(':memory:');
  const server=createApp(db,{authRecord:createPasswordRecord('synthetic-owner-history-password')})
    .listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const context=await browser.newContext({viewport:{width,height:900}});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',err=>errors.push(err.message));
  try{
    await page.goto(base+'/login.html');
    await page.locator('input[name=username]').fill('owner');
    await page.locator('input[name=password]').fill('synthetic-owner-history-password');
    await page.getByRole('button',{name:'Sign in'}).click();
    await page.waitForURL(base+'/');
    await page.goto(base+'/#invoices');
    const panel=page.locator('#historical-invoice-originals');
    await panel.waitFor({state:'visible'});
    await panel.locator('summary').first().click();
    await panel.locator('#external-doc-files').setInputFiles({
      name:'Synthetic-2026-Invoice.pdf',mimeType:'application/pdf',buffer:PDF
    });
    page.once('dialog',dialog=>dialog.accept());
    await panel.getByRole('button',{name:'Import selected original copies'}).click();
    await panel.locator('.external-original-row').waitFor({state:'visible'});
    const review=panel.locator('.external-original-identification').first();
    await review.locator('summary').click();
    const form=review.locator('.external-original-identification-form');
    await form.locator('input[type=text]').fill('invoice-123');
    await form.locator('input[type=date]').fill('2026-11-13');
    await form.locator('textarea').fill('Owner visually transcribed the displayed number and printed date');
    await form.getByRole('button',{name:'Save reported details'}).click();
    await page.waitForFunction(()=>document.querySelector('#external-ident-status')?.textContent?.includes('transcription saved'));
    await panel.getByText('Owner-reported (unverified): invoice-123',{exact:false}).waitFor({state:'visible'});
    const row=db.prepare('SELECT reported_number,reported_financial_year FROM historical_pdf_identifications').get();
    assert.equal(row.reported_number,'invoice-123');
    assert.equal(row.reported_financial_year,'2026-27');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM invoices').get().n,0);
    const register=page.locator('#billing-documents-register');
    await register.locator('#billing-register-query').fill('invoice-123');
    await register.locator('#billing-register-kind').selectOption('historical_original');
    await register.getByRole('button',{name:'Find documents'}).click();
    await page.waitForFunction(()=>document.querySelector('#billing-register-list')?.textContent?.includes('Owner-reported printed number (unverified): invoice-123'));
    assert.equal(await register.locator('.billing-register-row').count(),1);
    assert.deepEqual(errors,[],'No runtime error at '+width+'px');
    console.log('PASS: owner annotates original PDF and searches unverified printed number at '+width+'px');
  }finally{await context.close();await new Promise(resolve=>server.close(resolve));db.close();}
 }
}
