import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {getBusinessSettings,updateBusinessSettings} from '../src/business-settings.js';

test('hotel business settings validate inputs and remain persistent',()=>{
  const db=openDatabase(':memory:');
  try{
    assert.equal(getBusinessSettings(db).hotel_name,'Garh Jaisal');
    const saved=updateBusinessSettings(db,{hotel_name:'Example Hotel',bank_name:'Example Bank',
      ifsc:'ABCD0123456',upi_id:'example@upi',email:'hotel@example.com'});
    assert.equal(saved.ifsc,'ABCD0123456');
    assert.equal(getBusinessSettings(db).upi_id,'example@upi');
    assert.throws(()=>updateBusinessSettings(db,{hotel_name:''}),/Hotel name/);
    assert.throws(()=>updateBusinessSettings(db,{ifsc:'INVALID'}),/IFSC/);
    assert.throws(()=>updateBusinessSettings(db,{unexpected:'field'}),/Unknown/);
    assert.equal(getBusinessSettings(db).hotel_name,'Example Hotel');
  }finally{db.close();}
});

test('new proformas snapshot hotel payment details and retain originals after settings changes',async()=>{
  const db=openDatabase(':memory:');
  const server=createApp(db).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const json=async(path,method='GET',body)=>{
    const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    return {status:response.status,value:await response.json()};
  };
  try{
    const settings=await json('/api/settings/business','PUT',{hotel_name:'Example Fort Hotel',upi_id:'example@upi',ifsc:'ABCD0123456'});
    assert.equal(settings.status,200);
    const booking=await json('/api/bookings','POST',{guest_name:'Synthetic',checkin:'2026-12-01',checkout:'2026-12-02',
      rooms_count:1,category:'Unassigned',meal_plan:'CP',nightly_rate:4500,amount_paid:0});
    assert.equal(booking.status,201);
    const invoice=await json('/api/bookings/'+booking.value.id+'/proforma','POST');
    assert.equal(invoice.status,201);
    assert.equal(invoice.value.snapshot.business.hotel_name,'Example Fort Hotel');
    assert.equal(invoice.value.snapshot.business.upi_id,'example@upi');
    await json('/api/settings/business','PUT',{hotel_name:'Updated Hotel',upi_id:'updated@upi'});
    const saved=await json('/api/invoices/'+invoice.value.id);
    assert.equal(saved.value.snapshot.business.hotel_name,'Example Fort Hotel');
    assert.equal(saved.value.snapshot.business.upi_id,'example@upi');
    const pdf=await fetch(base+'/api/invoices/'+invoice.value.id+'/pdf');
    assert.equal(pdf.status,200);
    assert.equal(new TextDecoder().decode((await pdf.arrayBuffer()).slice(0,5)),'%PDF-');
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
