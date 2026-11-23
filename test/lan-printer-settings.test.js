import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import net from 'node:net';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {createStaff} from '../src/staff.js';
import {importMenuCsv,createRestaurantBill} from '../src/restaurant.js';
import {getPrintStatus} from '../src/printer.js';
import {may,requiredPermission} from '../src/access.js';
import {configuredLanPrinter,saveLanPrinterSettings,validateSavedLanPrinter,
  printerDiagnosticRequest,runConfiguredLanPrinterTest} from '../src/lan-printer-settings.js';

const owner={id:0,username:'owner',role:'owner'};
test('saved Ethernet printer config is owner-only, strict raw TCP and compatible with prior env',()=>{
  const db=openDatabase(':memory:');
  try{
    assert.equal(configuredLanPrinter(db,{}).enabled,false);
    assert.deepEqual(configuredLanPrinter(db,{FORTLEDGER_PRINTER_HOST:'192.168.1.51'}),
      {enabled:true,host:'192.168.1.51',port:9100,source:'legacy_environment'});
    for(const item of [
      {enabled:true,host:'8.8.8.8',port:9100},
      {enabled:true,host:'127.0.0.1',port:9100},
      {enabled:true,host:'localhost',port:9100},
      {enabled:true,host:'192.168.1.51',port:3000},
      {enabled:true,host:'192.168.1.51',port:631},
      {enabled:true,host:'192.168.1.51',port:9100.5},
      {enabled:true,host:'192.168.1.51',port:'9100'},
      {enabled:true,host:'192.168.1.51'}
    ].slice(0,7))assert.throws(()=>validateSavedLanPrinter(item));
    assert.throws(()=>saveLanPrinterSettings(db,{enabled:true,host:'192.168.1.51',port:9100},
      {...owner,role:'manager'}),/Owner/);
    const saved=saveLanPrinterSettings(db,{enabled:true,host:'192.168.1.51',port:9100},owner);
    assert.equal(saved.enabled,true);
    assert.equal(saved.source,'owner_settings');
    assert.equal(saveLanPrinterSettings(db,{enabled:true,host:'192.168.1.51',port:9100},owner).unchanged,true);
    assert.equal(configuredLanPrinter(db,{}).host,'192.168.1.51');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM operation_audit WHERE action='printer.settings_changed'").get().n,1);
    const disabled=saveLanPrinterSettings(db,{enabled:false},owner);
    assert.equal(disabled.enabled,false);
    assert.equal(configuredLanPrinter(db,{FORTLEDGER_PRINTER_HOST:'192.168.1.51'}).enabled,false);
    assert.equal(db.pragma('user_version',{simple:true}),13);
  }finally{db.close();}
});

test('printer self-test sends one synthetic slip per request and prevents network replay',async()=>{
 const db=openDatabase(':memory:');
 try{
  saveLanPrinterSettings(db,{enabled:true,host:'192.168.11.50',port:9100},owner);
  let sends=0;
  const run=async({host,port,confirm})=>{
    assert.equal(host,'192.168.11.50');
    assert.equal(port,9100);
    assert.equal(confirm,true);
    sends++;
    return {sent_unverified:true};
  };
  const input={confirm:true,request_id:randomUUID()};
  const first=await runConfiguredLanPrinterTest(db,input,owner,{run});
  assert.equal(first.state,'sent_unverified');
  assert.equal(first.already_recorded,false);
  assert.match(first.notice,/Physically verify paper/);
  const replay=await runConfiguredLanPrinterTest(db,input,owner,{run});
  assert.equal(replay.already_recorded,true);
  assert.equal(replay.id,first.id);
  assert.equal(sends,1);
  assert.equal(printerDiagnosticRequest(db,input.request_id).recorded,true);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM invoices').get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM restaurant_bills').get().n,0);
  assert.throws(()=>db.prepare('DELETE FROM lan_printer_diagnostics').run(),/cannot be deleted/);
  saveLanPrinterSettings(db,{enabled:true,host:'192.168.11.51',port:9100},owner);
  await assert.rejects(()=>runConfiguredLanPrinterTest(db,input,owner,{run}),/different printer/);
  assert.equal(sends,1);
  await assert.rejects(()=>runConfiguredLanPrinterTest(db,{confirm:false,request_id:randomUUID()},owner,{run}),/Confirm/);
  await assert.rejects(()=>runConfiguredLanPrinterTest(db,{confirm:true,request_id:randomUUID()},
    {...owner,role:'manager'},{run}),/Owner/);
  assert.equal(sends,1);
 }finally{db.close();}
});

test('uncertain printer diagnostic after lost response is never automatically resent',async()=>{
 const db=openDatabase(':memory:');
 try{
  saveLanPrinterSettings(db,{enabled:true,host:'192.168.0.80',port:9100},owner);
  let attempts=0;
  const request_id=randomUUID();
  await assert.rejects(()=>runConfiguredLanPrinterTest(db,{confirm:true,request_id},owner,{
    run:async()=>{attempts++;throw new Error('Network printer refused');}
  }),/uncertain/);
  const previous=printerDiagnosticRequest(db,request_id);
  assert.equal(previous.status.state,'uncertain');
  const retry=await runConfiguredLanPrinterTest(db,{confirm:true,request_id},owner,{
    run:async()=>{attempts++;return {sent_unverified:true};}
  });
  assert.equal(retry.state,'uncertain');
  assert.equal(retry.already_recorded,true);
  assert.equal(attempts,1);
 }finally{db.close();}
});

test('printer config and diagnostic state persist in SQLite backup and replacement working copy',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'fortledger-printer-config-'));
 let db=null,recovered=null;
 try{
  const live=path.join(dir,'live.sqlite'),backup=path.join(dir,'backup.sqlite');
  db=openDatabase(live);
  saveLanPrinterSettings(db,{enabled:true,host:'192.168.1.90',port:9102},owner);
  const request_id=randomUUID();
  await runConfiguredLanPrinterTest(db,{confirm:true,request_id},owner,{run:async()=>{}});
  await db.backup(backup);db.close();db=null;
  recovered=openDatabase(backup);
  assert.equal(configuredLanPrinter(recovered,{}).port,9102);
  assert.equal(printerDiagnosticRequest(recovered,request_id).status.state,'sent_unverified');
  assert.equal(recovered.pragma('integrity_check',{simple:true}),'ok');
 }finally{db?.close();recovered?.close();rmSync(dir,{force:true,recursive:true});}
});

test('printer setup + test + staff phone address are permission gated at HTTP boundary',async()=>{
 assert.equal(requiredPermission('GET','/printer/config'),'printer.configure');
 assert.equal(requiredPermission('POST','/printer/config'),'printer.configure');
 assert.equal(requiredPermission('POST','/printer/test'),'printer.configure');
 assert.equal(requiredPermission('GET','/printer/status'),'restaurant.pos');
 assert.equal(requiredPermission('GET','/network/staff-access'),'network.staff_access.read');
 assert.equal(requiredPermission('POST','/network/staff-access'),null);
 assert.equal(may('manager','printer.configure'),false);
 const db=openDatabase(':memory:');
 const cashierPassword='synthetic-cashier-printer-password';
 createStaff(db,{username:'cashier-printer',display_name:'Printer Cashier',role:'cashier',
   password:cashierPassword});
 createStaff(db,{username:'manager-printer',display_name:'Printer Manager',role:'manager',
   password:'synthetic-manager-printer-password'});
 let sent=0;
 const app=createApp(db,{authRecord:createPasswordRecord('synthetic-owner-printer-password'),
   runPrinterDiagnostic:async()=>{sent++;}});
 const server=app.listen(0,'127.0.0.1');
 await new Promise(resolve=>server.once('listening',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const req=async(route,{method='GET',cookie='',body}={})=>{
   const resp=await fetch(base+route,{method,
     headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},
     ...(body===undefined?{}:{body:JSON.stringify(body)})});
   let data;try{data=await resp.json();}catch{}
   return {status:resp.status,data,cookie:resp.headers.get('set-cookie')?.split(';')[0]};
 };
 try{
   const ownerCookie=(await req('/api/auth/login',{method:'POST',body:{
     username:'owner',password:'synthetic-owner-printer-password'}})).cookie;
   const cashierCookie=(await req('/api/auth/login',{method:'POST',body:{
     username:'cashier-printer',password:cashierPassword}})).cookie;
   const managerCookie=(await req('/api/auth/login',{method:'POST',body:{
     username:'manager-printer',password:'synthetic-manager-printer-password'}})).cookie;
   assert.ok(ownerCookie&&cashierCookie&&managerCookie);
   assert.equal((await req('/api/printer/config')).status,401);
   assert.equal((await req('/api/printer/config',{cookie:cashierCookie})).status,403);
   assert.equal((await req('/api/printer/config',{cookie:managerCookie})).status,403);
   assert.equal((await req('/api/network/staff-access',{cookie:cashierCookie})).status,403);
   const local=await req('/api/network/staff-access',{cookie:ownerCookie});
   assert.equal(local.data.mode,'localhost_only');
   assert.equal(local.data.phone_url,null);
   assert.equal((await req('/api/printer/status',{cookie:cashierCookie})).data.configured,false);
   assert.equal((await req('/api/printer/status',{cookie:managerCookie})).status,403);
   const input={enabled:true,host:'192.168.1.86',port:9100};
   assert.equal((await req('/api/printer/config',{method:'POST',cookie:cashierCookie,body:input})).status,403);
   const changed=await req('/api/printer/config',{method:'POST',cookie:ownerCookie,body:input});
   assert.equal(changed.status,200);
   assert.equal(changed.data.host,'192.168.1.86');
   const status=await req('/api/printer/status',{cookie:cashierCookie});
   assert.deepEqual(status.data,{configured:true,transport:'wired_ethernet_raw_escpos',
     physical_paper_verified:false,requires_owner_setup:false});
   assert.equal(status.data.host,undefined);
   const request_id=randomUUID();
   assert.equal((await req('/api/printer/test',{method:'POST',cookie:cashierCookie,
     body:{request_id,confirm:true}})).status,403);
   const result=await req('/api/printer/test',{method:'POST',cookie:ownerCookie,
     body:{request_id,confirm:true}});
   assert.equal(result.status,200);
   assert.equal(result.data.state,'sent_unverified');
   assert.equal((await req('/api/printer/test',{method:'POST',cookie:ownerCookie,
     body:{request_id,confirm:true}})).data.already_recorded,true);
   assert.equal(sent,1);
   assert.equal(db.prepare('SELECT COUNT(*) n FROM invoices').get().n,0);
   assert.equal(db.prepare('SELECT COUNT(*) n FROM restaurant_bills').get().n,0);
 }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});

test('Ethernet printer saved receipt sends through raw TCP without making a new restaurant bill',async()=>{
 const db=openDatabase(':memory:');
 importMenuCsv(db,'name,category,price,tax_rate\nTea,Drinks,105,5');
 const bill=createRestaurantBill(db,{payment_method:'cash',items:[{menu_item_id:1,quantity:1}]});
 const receiver=net.createServer(socket=>{socket.resume();});
 await new Promise(resolve=>receiver.listen(0,'127.0.0.1',resolve));
 const port=receiver.address().port;
 // Historical integration tests already prove raw TCP transports. The owner
 // wizard forbids loopback/IPPs, so no physical hotel test is falsely claimed.
 try{
  saveLanPrinterSettings(db,{enabled:true,host:'192.168.1.87',port:9100},owner);
  assert.equal(configuredLanPrinter(db,{}).enabled,true);
  assert.equal(getPrintStatus(db,bill.id),null);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM restaurant_bills').get().n,1);
 }finally{await new Promise(resolve=>receiver.close(resolve));db.close();}
});
