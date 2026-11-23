/* Owner-only printer and phone setup UI. Synthetic network transport; no
 * real printer, hotel Wi-Fi or external guest data. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {createStaff} from '../src/staff.js';

export async function runLanPrinterOwnerSetupSmoke(browser){
  for(const width of [390,1440]){
    const db=openDatabase(':memory:');
    let sends=0;
    const password='synthetic-wired-printer-owner-password';
    createStaff(db,{username:'wired-cashier',display_name:'Cashier',role:'cashier',
      password:'synthetic-wired-printer-cashier-password'});
    const server=createApp(db,{authRecord:createPasswordRecord(password),
      runPrinterDiagnostic:async options=>{
        assert.equal(options.host,'192.168.11.51');
        assert.equal(options.port,9100);
        assert.equal(options.confirm,true);
        sends++;
        return {sent_unverified:true};
      }}).listen(0,'127.0.0.1');
    await new Promise(resolve=>server.once('listening',resolve));
    const base='http://127.0.0.1:'+server.address().port;
    const context=await browser.newContext({viewport:{width,height:900}});
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    try{
      await page.goto(base+'/login.html');
      await page.locator('input[name=username]').fill('owner');
      await page.locator('input[name=password]').fill(password);
      await page.getByRole('button',{name:'Sign in'}).click();
      await page.waitForURL(base+'/');
      await page.goto(base+'/#profile');
      const panel=page.locator('#owner-printer-setup');
      await panel.waitFor({state:'visible'});
      await page.locator('#owner-staff-network').waitFor({state:'visible'});
      await page.getByText('FortLedger currently runs on this PC only.',{exact:false}).waitFor({state:'visible'});
      await panel.locator('input[name=enabled]').check();
      await panel.locator('input[name=host]').fill('192.168.11.51');
      await panel.locator('select[name=port]').selectOption('9100');
      page.once('dialog',dialog=>dialog.accept());
      await panel.locator('#owner-printer-save').click();
      await page.waitForFunction(()=>document.querySelector('#owner-printer-message')?.textContent?.includes('Saved Ethernet ESC/POS printer'));
      assert.equal(db.prepare('SELECT host FROM lan_printer_settings').get().host,'192.168.11.51');
      page.once('dialog',dialog=>dialog.accept());
      await panel.locator('#owner-printer-test').click();
      await page.waitForFunction(()=>document.querySelector('#owner-printer-message')?.textContent?.includes('Printer connection accepted test bytes'));
      assert.equal(sends,1);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM invoices').get().n,0);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM restaurant_bills').get().n,0);
      assert.equal(db.prepare('SELECT state FROM lan_printer_diagnostics').get().state,'sent_unverified');
      const api=await context.request.get(base+'/api/printer/status');
      assert.equal(api.status(),200);
      assert.equal((await api.json()).configured,true);
      assert.deepEqual(errors,[]);
      console.log('PASS: phone status and Ethernet printer owner configuration/test, '+width+'px');
    }finally{
      await context.close();await new Promise(resolve=>server.close(resolve));db.close();
    }
  }
}
