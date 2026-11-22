import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {normalizeInvoiceInput} from '../src/invoice-lines.js';

const booking={guest_name:'Synthetic group',company_name:'Example Agency',checkin:'2026-12-01',checkout:'2026-12-02',
  rooms_count:2,category:'Unassigned',meal_plan:'CP',nightly_rate:4500,amount_paid:4500};

test('multi-line proforma preserves contractual totals, payment and original snapshot',async()=>{
  const db=openDatabase(':memory:'),server=createApp(db).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const req=async(path,method='GET',body)=>{
    const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    return {status:response.status,data:await response.json()};
  };
  try {
    const b=await req('/api/bookings','POST',booking);
    assert.equal(b.status,201);
    const custom={guest_name:'Synthetic group',bill_to:'Example Agency',bill_to_address:'Fictional street, India',
      lines:[
        {description:'Heritage room with city view - CPAI',rooms:1,nights:1,rate:4500},
        {description:'Swiss Deluxe Tent - MAPI',rooms:1,nights:1,rate:4500}
      ]};
    const issue=await req('/api/bookings/'+b.data.id+'/proforma','POST',custom);
    assert.equal(issue.status,201);
    assert.equal(issue.data.snapshot.total_paise,900000);
    assert.equal(issue.data.snapshot.taxable_paise,857143);
    assert.equal(issue.data.snapshot.gst_paise,42857);
    assert.equal(issue.data.snapshot.due_paise,450000);
    assert.equal(issue.data.snapshot.lines.length,2);
    assert.equal(issue.data.snapshot.lines[1].total_paise,450000);
    assert.equal(issue.data.snapshot.bill_to,'Example Agency');
    const again=await req('/api/bookings/'+b.data.id+'/proforma','POST',{
      ...custom,lines:[{description:'Changed',rooms:1,nights:1,rate:1}]});
    assert.equal(again.status,200);
    assert.equal(again.data.id,issue.data.id);
    assert.equal(again.data.snapshot.total_paise,900000);
    assert.equal(db.prepare('SELECT last_number FROM invoice_sequence WHERE id=1').get().last_number,1);
    const pdf=await fetch(base+'/api/invoices/'+issue.data.id+'/pdf');
    assert.equal(pdf.status,200);
    assert.equal(new TextDecoder().decode((await pdf.arrayBuffer()).slice(0,5)),'%PDF-');
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
test('line validation rejects missing details, invalid money and oversized item list',()=>{
  const seed={guest_name:'Example',company_name:'',category:'Unassigned',meal_plan:'CP',
    checkin:'2026-12-01',checkout:'2026-12-02',rooms_count:1,nightly_rate_paise:450000};
  const input=lines=>({lines,bill_to:'Customer',guest_name:'Example'});
  assert.throws(()=>normalizeInvoiceInput(input([]),seed),/1 to 20/);
  assert.throws(()=>normalizeInvoiceInput(input([{description:'Test',rooms:1,nights:1,rate:-1}]),seed),/non-negative/);
  assert.throws(()=>normalizeInvoiceInput(input([{description:'',rooms:1,nights:1,rate:4500}]),seed),/required/);
  assert.throws(()=>normalizeInvoiceInput(input([{description:'Test',rooms:8,nights:1,rate:4500}]),seed),/room quantity/);
  assert.throws(()=>normalizeInvoiceInput(input([{description:'Test',rooms:1,nights:0,rate:4500}]),seed),/night quantity/);
});
