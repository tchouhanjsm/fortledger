import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {createProforma} from '../src/invoices.js';
import {getGuestFolio,settleCombined} from '../src/folio.js';
import {transitionBooking} from '../src/booking-transitions.js';

const actor={id:0,username:'owner',role:'owner'};
const createBooking=db=>Number(db.prepare(`INSERT INTO bookings
  (guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise,status)
  VALUES('Audit synthetic guest','2027-03-01','2027-03-03',1,'Unassigned',450000,'checked_in')`).run().lastInsertRowid);

test('a custom ₹8000 proforma for a ₹9000 stay fails without consuming a document number',()=>{
  const db=openDatabase(':memory:');
  try{
    const id=createBooking(db);
    assert.throws(()=>createProforma(db,id,{lines:[
      {description:'Incorrect negotiated accommodation',rooms:1,nights:2,rate:4000}
    ]}),/must equal the booked stay total/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM invoices').get().n,0);
    assert.equal(db.prepare('SELECT last_number FROM invoice_sequence WHERE id=1').get().last_number,0);
    const folio=getGuestFolio(db,id);
    assert.equal(folio.accommodation.total_paise,900000);
    assert.equal(folio.invoice_discrepancy,null);
    const acceptable=createProforma(db,id,{lines:[
      {description:'Heritage night one',rooms:1,nights:1,rate:4500},
      {description:'Heritage night two',rooms:1,nights:1,rate:4500}
    ]});
    assert.equal(acceptable.snapshot.total_paise,folio.accommodation.total_paise);
    assert.equal(acceptable.snapshot.due_paise,folio.accommodation.due_paise);
    assert.equal(db.prepare('SELECT last_number FROM invoice_sequence WHERE id=1').get().last_number,1);
    assert.equal(createProforma(db,id,{lines:[{description:'Bad',rooms:1,nights:1,rate:1}]}).already_existed,true);
  }finally{db.close();}
});

test('historic mismatched immutable proforma remains visible but blocks combined payment and checkout',()=>{
  const db=openDatabase(':memory:');
  try{
    const id=createBooking(db);
    const snapshot={number:'GH-2027-001',total_paise:800000,due_paise:800000};
    const old=db.prepare("INSERT INTO invoices(booking_id,kind,number,snapshot) VALUES(?,'proforma',?,?)")
      .run(id,snapshot.number,JSON.stringify(snapshot));
    const row=db.prepare('SELECT snapshot FROM invoices WHERE id=?').get(old.lastInsertRowid).snapshot;
    const before=getGuestFolio(db,id);
    assert.deepEqual(before.invoice_discrepancy,{
      invoice_id:Number(old.lastInsertRowid),invoice_number:'GH-2027-001',
      proforma_total_paise:800000,booking_total_paise:900000
    });
    assert.equal(before.accommodation.total_paise,900000);
    assert.throws(()=>settleCombined(db,id,'cash',actor),/Proforma and booking totals disagree/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payments').get().n,0);
    assert.throws(()=>transitionBooking(db,id,'checked_out',
      {actor,acknowledge_balance:true}),/Proforma and booking totals disagree/);
    assert.equal(db.prepare('SELECT status FROM bookings WHERE id=?').get(id).status,'checked_in');
    assert.equal(db.prepare('SELECT snapshot FROM invoices WHERE id=?').get(old.lastInsertRowid).snapshot,row);
  }finally{db.close();}
});

test('HTTP proforma mismatch returns error; folio agrees with booked amount and old invoice remains immutable',async()=>{
  const db=openDatabase(':memory:');
  const server=createApp(db).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const request=async(url,method,body)=>{
    const response=await fetch(base+url,{method,headers:{'Content-Type':'application/json'},
      body:body?JSON.stringify(body):undefined});
    return {status:response.status,body:await response.json()};
  };
  try{
    const id=createBooking(db);
    const invalid=await request('/api/bookings/'+id+'/proforma','POST',{
      lines:[{description:'Underbilled accommodation',rooms:1,nights:2,rate:4000}]
    });
    assert.equal(invalid.status,400);
    assert.match(invalid.body.error,/must equal the booked stay total/);
    const valid=await request('/api/bookings/'+id+'/proforma','POST',{});
    assert.equal(valid.status,201);
    assert.equal(valid.body.snapshot.total_paise,900000);
    const folio=await request('/api/bookings/'+id+'/folio');
    assert.equal(folio.status,200);
    assert.equal(folio.body.accommodation.total_paise,valid.body.snapshot.total_paise);
    assert.equal(folio.body.invoice_discrepancy,null);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
