import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {openDatabase} from '../src/database.js';
import {importMenuCsv,listMenu,createRestaurantBill} from '../src/restaurant.js';
import {buildReceipt,sendToPrinter,printSavedBill,validatePrinterAddress,getPrintStatus} from '../src/printer.js';

function fixture(){
  const db=openDatabase(':memory:');
  importMenuCsv(db,'name,category,price,tax_rate\nTea,Drinks,105,5');
  const bill=createRestaurantBill(db,{payment_method:'cash',items:[{menu_item_id:listMenu(db)[0].id,quantity:2}]});
  return {db,bill};
}
test('printer only accepts local private IPv4 addresses and sanitizes ESC/POS content',()=>{
  assert.throws(()=>validatePrinterAddress('8.8.8.8'),/private/);
  assert.throws(()=>validatePrinterAddress('printer.local'),/IPv4/);
  assert.deepEqual(validatePrinterAddress('192.168.1.12',9100),{host:'192.168.1.12',port:9100});
  const {db,bill}=fixture();
  try{
    const saved=db.prepare('SELECT * FROM restaurant_bills WHERE id=?').get(bill.id);
    const bytes=buildReceipt(saved);
    assert.deepEqual([...bytes.subarray(0,2)],[27,64]);
    assert.match(bytes.toString('ascii'),/NOT A TAX INVOICE/);
    assert.match(bytes.toString('ascii'),/INR 210\.00/);
  }finally{db.close();}
});
test('TCP mock receives bill exactly once and reprint requires explicit confirmation',async()=>{
  const {db,bill}=fixture();
  let transmissions=0,received=Buffer.alloc(0);
  const receiver=net.createServer(socket=>{
    transmissions++;
    socket.on('data',chunk=>{received=Buffer.concat([received,chunk]);});
  });
  await new Promise(resolve=>receiver.listen(0,'127.0.0.1',resolve));
  const port=receiver.address().port;
  try{
    const options={host:'127.0.0.1',port};
    const first=await printSavedBill(db,bill.id,options);
    assert.equal(first.state,'sent_unverified');
    assert.equal(first.attempts,1);
    assert.match(received.toString('ascii'),/Receipt #/);
    await assert.rejects(()=>printSavedBill(db,bill.id,options),/Previously attempted/);
    assert.equal(transmissions,1);
    const second=await printSavedBill(db,bill.id,options,{reprint:true});
    assert.equal(second.attempts,2);
    assert.equal(transmissions,2);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM restaurant_bills').get().n,1);
  }finally{
    await new Promise(resolve=>receiver.close(resolve));
    db.close();
  }
});
test('printing failure records uncertain state without duplicating sale',async()=>{
  const {db,bill}=fixture();
  try{
    await assert.rejects(()=>printSavedBill(db,bill.id,{host:'127.0.0.1',port:1,timeoutMs:100}),/uncertain/i);
    assert.equal(getPrintStatus(db,bill.id).state,'uncertain');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM restaurant_bills').get().n,1);
  }finally{db.close();}
});

test('interrupted printer sends remain blocked until old enough and staff explicitly confirms reprint',async()=>{
  const {db,bill}=fixture();
  let transmissions=0;
  try{
    db.prepare(`INSERT INTO restaurant_print_jobs(restaurant_bill_id,state,attempts,updated_at)
      VALUES(?,'sending',1,datetime('now'))`).run(bill.id);
    const send=async()=>{transmissions++;};
    await assert.rejects(
      ()=>printSavedBill(db,bill.id,{host:'127.0.0.1',port:9100},{send,reprint:true}),
      /already running or its outcome is still uncertain/
    );
    assert.equal(transmissions,0);
    db.prepare("UPDATE restaurant_print_jobs SET updated_at=datetime('now','-11 minutes') WHERE restaurant_bill_id=?")
      .run(bill.id);
    await assert.rejects(
      ()=>printSavedBill(db,bill.id,{host:'127.0.0.1',port:9100},{send}),
      /Previously attempted; interrupted print is unverified/
    );
    assert.equal(transmissions,0);
    assert.equal(getPrintStatus(db,bill.id).attempts,1);
    const retried=await printSavedBill(db,bill.id,{host:'127.0.0.1',port:9100},{send,reprint:true});
    assert.equal(retried.state,'sent_unverified');
    assert.equal(retried.attempts,2);
    assert.equal(transmissions,1);
    assert.equal(db.prepare('SELECT count(*) AS n FROM restaurant_bills').get().n,1);
  }finally{db.close();}
});
