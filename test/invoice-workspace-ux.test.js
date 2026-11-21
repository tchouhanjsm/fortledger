import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const proforma=readFileSync(new URL('../src/invoice-pdf.js',import.meta.url),'utf8');
const tax=readFileSync(new URL('../src/tax-draft-pdf.js',import.meta.url),'utf8');

test('invoices workspace creates proforma without navigating to booking ledger',()=>{
  for(const id of ['invoice-booking-select','invoice-create-proforma','invoice-new-booking'])
    assert.match(html,new RegExp('id="'+id+'"'));
  assert.doesNotMatch(html,/Invoices begin with a guest reservation\. Create or open a booking first/);
  assert.match(app,/\$\('#invoice-create-proforma'\)\.onclick/);
  assert.match(app,/\$\('#invoice-new-booking'\)\.onclick/);
  assert.match(app,/invoiceBookingAfterCreate=true/);
  assert.match(app,/createInvoice\(booking\)/);
});
test('review-only tax draft remains directly available in invoice list',()=>{
  assert.match(app,/const taxDraft=label\('button','Tax draft'/);
  assert.match(app,/taxDraft\.onclick=\(\)=>openTaxDraft\(inv\)/);
  assert.match(html,/No statutory invoice number is issued/);
});
test('proforma and tax PDFs position terms instead of adding unconditional second page',()=>{
  assert.match(proforma,/termsHeight/);
  assert.match(proforma,/TERMS & CONDITIONS/);
  assert.match(tax,/termsHeight/);
  assert.match(tax,/NOT A LEGAL TAX INVOICE/);
  assert.doesNotMatch(proforma,/pdf\.addPage\(\);\s*pdf\.font\('Helvetica-Bold'\).*TERMS & CONDITIONS/s);
  assert.doesNotMatch(tax,/pdf\.addPage\(\);\s*pdf\.font\('Helvetica-Bold'\).*TERMS & CONDITIONS/s);
});
