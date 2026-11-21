import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/database.js';
import {runRecoveryDrill} from '../src/recovery-drill.js';
import {createProforma} from '../src/invoices.js';
import {createStaff} from '../src/staff.js';
import {importMenuCsv,listMenu,createRestaurantBill} from '../src/restaurant.js';
import {setHotelLogo} from '../src/hotel-logo.js';
const PNG='iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAIAAABvFaqvAAAAIklEQVR4nGM0SvFmoAZgooopowaNGjRq0KhBowaNGkQRAACtbwERSVj5XwAAAABJRU5ErkJggg==';
test('isolated recovery rehearsal verifies hotel data, invoice snapshots, staff, logo and credential copy',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fortledger-drill-test-'));
  const source=path.join(dir,'hotel.sqlite'),auth=path.join(dir,'admin-auth.json');
  try{
    const db=openDatabase(source);
    const booking=Number(db.prepare(`INSERT INTO bookings(guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise)
      VALUES('DO NOT PRINT PRIVATE TEST GUEST','2026-12-01','2026-12-02',2,'Unassigned',450000)`).run().lastInsertRowid);
    db.prepare("INSERT INTO payments(booking_id,amount_paise,method) VALUES(?,450000,'upi')").run(booking);
    createProforma(db,booking);
    createStaff(db,{username:'cashier123',display_name:'Synthetic',role:'cashier',password:'synthetic-password-123'});
    setHotelLogo(db,{mime:'image/png',base64:PNG});
    importMenuCsv(db,'name,category,price,tax_rate\nTea,Beverages,105,5');
    createRestaurantBill(db,{items:[{menu_item_id:listMenu(db)[0].id,quantity:1}],payment_method:'cash'});
    db.close();
    fs.writeFileSync(auth,'{"synthetic":"credential placeholder"}',{mode:0o600});
    const sourceHash=fs.statSync(source).size;
    const result=await runRecoveryDrill({source,auth});
    assert.equal(result.ok,true);
    assert.equal(result.rooms,7);
    assert.equal(result.bookings,1);
    assert.equal(result.admin_auth_copied,true);
    assert.ok(result.schema_tables>=12);
    assert.doesNotMatch(JSON.stringify(result),/DO NOT PRINT PRIVATE TEST GUEST|synthetic-password-123/);
    assert.equal(fs.statSync(source).size,sourceHash);
    const unchanged=openDatabase(source);
    assert.equal(unchanged.prepare('SELECT COUNT(*) AS n FROM invoices').get().n,1);
    assert.equal(unchanged.prepare('SELECT COUNT(*) AS n FROM restaurant_bills').get().n,1);
    unchanged.close();
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('recovery rehearsal fails closed when administrator file is missing or database is invalid',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fortledger-drill-invalid-'));
  try{
    const source=path.join(dir,'hotel.sqlite'),auth=path.join(dir,'admin-auth.json');
    const db=openDatabase(source);db.close();
    await assert.rejects(()=>runRecoveryDrill({source,auth}),/authentication file missing/);
    const result=await runRecoveryDrill({source,auth,requireAuth:false});
    assert.equal(result.admin_auth_copied,false);
    fs.writeFileSync(auth,'synthetic');
    fs.writeFileSync(source,'not a SQLite database');
    await assert.rejects(()=>runRecoveryDrill({source,auth}));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
