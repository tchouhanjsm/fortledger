import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/database.js';
import {importMenuCsv,listMenu,createRestaurantBill,listRestaurantBills} from '../src/restaurant.js';
import {createProforma} from '../src/invoices.js';
import {prepareTaxDraft} from '../src/tax-draft.js';

test('menu item capitalization updates original ID and preserves historical sale snapshot',()=>{
  const db=openDatabase(':memory:');
  try{
    importMenuCsv(db,'name,category,price,tax_rate\nTea,Drinks,100,5');
    const item=listMenu(db)[0],bill=createRestaurantBill(db,{payment_method:'cash',
      items:[{menu_item_id:item.id,quantity:2}]});
    importMenuCsv(db,'name,category,price,tax_rate\ntea,drinks,150,5');
    assert.equal(listMenu(db).length,1);
    assert.equal(listMenu(db)[0].id,item.id);
    assert.equal(listMenu(db)[0].price_paise,15000);
    assert.equal(listRestaurantBills(db)[0].items[0].unit_price_paise,10000);
    assert.equal(listRestaurantBills(db)[0].total_paise,bill.total_paise);
  }finally{db.close();}
});

test('existing ambiguous case variants reject importing without silently merging old IDs',()=>{
  const db=openDatabase(':memory:');
  try{
    db.prepare('INSERT INTO menu_items(name,category,price_paise,tax_rate) VALUES(?,?,?,?)').run('Tea','Drinks',10000,5);
    db.prepare('INSERT INTO menu_items(name,category,price_paise,tax_rate) VALUES(?,?,?,?)').run('tea','drinks',12000,5);
    assert.throws(()=>importMenuCsv(db,'name,category,price,tax_rate\nTEA,DRINKS,300,5'),/resolve duplicate menu items/);
    assert.deepEqual(db.prepare('SELECT price_paise FROM menu_items ORDER BY id').all().map(x=>x.price_paise),[10000,12000]);
  }finally{db.close();}
});

test('tax draft reconciles its inclusive gross, taxable and GST lines to the paise for varied splits',()=>{
  const db=openDatabase(':memory:');
  try{
    for(let n=1;n<=20;n++){
      const rate=n+1;
      const booking=Number(db.prepare(`INSERT INTO bookings
        (guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise)
        VALUES('Rounding synthetic','2027-01-01','2027-01-02',1,'Unassigned',?)`)
        .run(rate*n).lastInsertRowid);
      const source=createProforma(db,booking,{lines:Array.from({length:n},(_,i)=>({
        description:'Room detail '+i,rooms:1,nights:1,rate:String(rate/100)
      }))});
      const draft=prepareTaxDraft(db,source.id,{sac_codes:Array(n).fill('996311')}).snapshot;
      assert.equal(draft.lines.reduce((sum,x)=>sum+x.total_paise,0),draft.total_paise);
      assert.equal(draft.lines.reduce((sum,x)=>sum+x.taxable_paise,0),draft.taxable_paise);
      assert.equal(draft.lines.reduce((sum,x)=>sum+x.gst_paise,0),draft.gst_paise);
      assert.equal(draft.gst_paise+draft.taxable_paise,draft.total_paise);
      assert.equal(draft.cgst_paise+draft.sgst_paise,draft.gst_paise);
    }
  }finally{db.close();}
});
