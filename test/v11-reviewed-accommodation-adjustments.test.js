import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {createStaff} from '../src/staff.js';
import {createProforma} from '../src/invoices.js';
import {getGuestFolio,settleCombined} from '../src/folio.js';
import {recordAccommodationAdjustment,listAccommodationAdjustments} from '../src/accommodation-adjustments.js';
import {auditEvents} from '../src/financial-audit.js';

const owner={id:0,username:'owner',role:'owner'};
const manager={id:18,username:'managerqa',role:'manager'};
const desk={id:19,username:'deskqa',role:'frontdesk'};
function fixture(db){
  const id=Number(db.prepare(`INSERT INTO bookings
    (guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise,status)
    VALUES('Synthetic Adjustment Guest','2027-07-01','2027-07-02',1,'Unassigned',450000,'checked_in')`)
    .run().lastInsertRowid);
  const invoice=createProforma(db,id);
  return {id,invoice};
}
const input=(kind,amount,request_id=randomUUID())=>({kind,amount,request_id,
  reason:'Guest agreed to revised accommodation arrangement',reference:'SIGNED-MEMO-07'});

test('audited charges and credits reconcile booking list, folio and settled payment without rewriting original PDF snapshot',async()=>{
  const db=openDatabase(':memory:');
  const {id,invoice}=fixture(db);
  const original=db.prepare('SELECT snapshot FROM invoices WHERE id=?').get(invoice.id).snapshot;
  try{
    const charge=input('charge','750');
    const saved=recordAccommodationAdjustment(db,id,charge,manager);
    assert.equal(saved.amount_paise,75000);
    assert.equal(saved.already_recorded,false);
    assert.equal(recordAccommodationAdjustment(db,id,charge,owner).already_recorded,true);
    const credit=recordAccommodationAdjustment(db,id,input('credit','250'),owner);
    assert.equal(credit.amount_paise,-25000);
    const folio=getGuestFolio(db,id);
    assert.equal(folio.invoice_discrepancy,null);
    assert.equal(folio.accommodation.contract_total_paise,450000);
    assert.equal(folio.accommodation.adjustments_paise,50000);
    assert.equal(folio.accommodation.total_paise,500000);
    assert.equal(folio.accommodation.due_paise,500000);
    assert.equal(folio.adjustments.length,2);
    assert.equal(db.prepare('SELECT snapshot FROM invoices WHERE id=?').get(invoice.id).snapshot,original);
    assert.equal(db.prepare('SELECT nightly_rate_paise FROM bookings WHERE id=?').get(id).nightly_rate_paise,450000);
    const settled=settleCombined(db,id,'upi',owner,{request_id:randomUUID()});
    assert.equal(settled.accommodation_paid_paise,500000);
    assert.equal(getGuestFolio(db,id).combined_due_paise,0);
    assert.equal(db.prepare('SELECT SUM(amount_paise) n FROM payments WHERE booking_id=?').get(id).n,500000);
    const audits=auditEvents(db,{entityType:'booking',entityId:id}).filter(e=>e.action==='accommodation.adjusted');
    assert.equal(audits.length,2);
    assert.equal(audits[1].actor_username,'managerqa');
    assert.equal(audits[0].details.kind,'credit');
  }finally{db.close();}
});

test('manager approval is required; replay mismatches and excessive credits fail before money mutations',()=>{
  const db=openDatabase(':memory:');
  try{
    const {id}=fixture(db),charge=input('charge','100');
    assert.throws(()=>recordAccommodationAdjustment(db,id,charge,desk),/Only owner or manager/);
    assert.throws(()=>recordAccommodationAdjustment(db,id,{...charge,reason:'tiny'},manager),/reason/);
    assert.throws(()=>recordAccommodationAdjustment(db,id,input('credit','4500.01'),manager),/Credit exceeds/);
    assert.equal(listAccommodationAdjustments(db,id).length,0);
    recordAccommodationAdjustment(db,id,charge,manager);
    assert.throws(()=>recordAccommodationAdjustment(db,id,{...charge,amount:'101'},owner),/already used/);
    assert.throws(()=>recordAccommodationAdjustment(db,id,{...charge,kind:'credit'},manager),/already used/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM accommodation_adjustments').get().n,1);
    db.prepare("UPDATE bookings SET status='checked_out' WHERE id=?").run(id);
    assert.throws(()=>recordAccommodationAdjustment(db,id,input('credit','10'),manager),/completed or cancelled/);
  }finally{db.close();}
});

test('authenticated owner/manager API accepts reviewed adjustments and blocks direct front desk writes',async()=>{
  const db=openDatabase(':memory:');
  const {id}=fixture(db);
  createStaff(db,{username:'deskqa',display_name:'Desk QA',role:'frontdesk',password:'synthetic-desk-strong-password'});
  createStaff(db,{username:'managerqa',display_name:'Manager QA',role:'manager',password:'synthetic-manager-strong-password'});
  const server=createApp(db,{authRecord:createPasswordRecord('synthetic-owner-strong-password')}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  async function cookie(username,password){
    const res=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username,password})});
    assert.equal(res.status,200);return res.headers.get('set-cookie').split(';')[0];
  }
  try{
    const managerCookie=await cookie('managerqa','synthetic-manager-strong-password');
    const deskCookie=await cookie('deskqa','synthetic-desk-strong-password');
    const route='/api/bookings/'+id+'/folio/adjustments';
    const body=input('charge','300');
    const post=async session=>{
      const res=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',Cookie:session},
        body:JSON.stringify(body)});return {status:res.status,data:await res.json()};
    };
    assert.equal((await post(deskCookie)).status,403);
    const first=await post(managerCookie),retry=await post(managerCookie);
    assert.equal(first.status,201);
    assert.equal(retry.status,200);
    assert.equal(retry.data.id,first.data.id);
    assert.equal(retry.data.already_recorded,true);
    const list=await fetch(base+'/api/bookings',{headers:{Cookie:managerCookie}});
    assert.equal(list.status,200);
    const changed=(await list.json()).find(b=>b.id===id);
    assert.equal(changed.total_paise,480000);
    assert.equal(changed.due_paise,480000);
    const folio=await fetch(base+'/api/bookings/'+id+'/folio',{headers:{Cookie:managerCookie}});
    assert.equal((await folio.json()).accommodation.total_paise,480000);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});

test('v10 disk hotel upgrades to v11 without rewriting historical payments, invoices or bills',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fortledger-v11-'));
  const file=path.join(dir,'hotel.sqlite');let db;
  try{
    db=openDatabase(file);
    const {id,invoice}=fixture(db);
    const original=db.prepare('SELECT snapshot FROM invoices WHERE id=?').get(invoice.id).snapshot;
    db.exec('DROP TABLE accommodation_adjustments');
    db.pragma('user_version = 10');
    db.close();db=null;
    db=openDatabase(file);
    assert.equal(db.pragma('user_version',{simple:true}),13);
    assert.equal(db.prepare('SELECT snapshot FROM invoices WHERE id=?').get(invoice.id).snapshot,original);
    assert.equal(getGuestFolio(db,id).accommodation.total_paise,450000);
    assert.equal(db.pragma('foreign_key_check').length,0);
    recordAccommodationAdjustment(db,id,input('charge','30'),owner);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM accommodation_adjustments').get().n,1);
    db.exec('DROP TABLE accommodation_adjustments');db.close();db=null;
    assert.throws(()=>openDatabase(file),/Accommodation adjustment ledger is missing/);
    const read=new Database(file,{readonly:true});
    assert.equal(read.prepare('SELECT snapshot FROM invoices WHERE id=?').get(invoice.id).snapshot,original);
    read.close();
  }finally{db?.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('the folio UI exposes adjustments only to appropriately authorized users',()=>{
  const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  assert.match(html,/id="folio-adjustment-form"/);
  assert.match(app,/can\('folio.adjust'\)/);
  assert.match(app,/folioSettlementIntent\(key,details\)/);
});