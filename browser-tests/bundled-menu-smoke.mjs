/* V6: local synthetic owner preview -> add-only import; no genuine hotel data. */
import assert from 'node:assert/strict';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {createStaff} from '../src/staff.js';

export async function runBundledMenuSmoke(browser){
  const db=openDatabase(':memory:');
  const ownerPassword='synthetic-owner-v6-bundled-menu-strong';
  createStaff(db,{username:'bundledcashier',display_name:'Cashier QA',
    role:'cashier',password:'synthetic-cashier-v6-password-strong'});
  const server=createApp(db,{authRecord:createPasswordRecord(ownerPassword)})
    .listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const context=await browser.newContext({viewport:{width:1280,height:850}});
  try{
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'/login.html');
    await page.locator('input[name=username]').fill('owner');
    await page.locator('input[name=password]').fill(ownerPassword);
    await page.getByRole('button',{name:'Sign in'}).click();
    await page.waitForURL(base+'/');
    await page.goto(base+'/#restaurant');
    await page.locator('#restaurant').waitFor({state:'visible'});
    assert.equal(await page.locator('#menu-import-section').getAttribute('open'),'');
    assert.equal(await page.locator('#bundled-menu-section').getAttribute('open'),'');
    assert.equal(await page.locator('#bundled-menu-sync').isDisabled(),true);
    await page.locator('#bundled-menu-preview').click();
    await page.waitForFunction(()=>document.querySelector('#bundled-menu-message')?.textContent?.includes('142 new dishes'));
    assert.equal(await page.locator('#bundled-menu-review tbody tr').count(),142);
    assert.equal(await page.locator('#bundled-menu-sync').isDisabled(),true);
    await page.locator('#bundled-menu-gst-ack').check();
    assert.equal(await page.locator('#bundled-menu-sync').isEnabled(),true);
    await page.locator('#bundled-menu-sync').click();
    await page.locator('#shizuka-confirm-dialog').waitFor({state:'visible'});
    assert.match(await page.locator('#shizuka-confirm-detail').textContent(),
      /Existing prices, GST, hidden items and saved receipts remain unchanged/);
    await page.locator('#shizuka-confirm-approve').click();
    await page.waitForFunction(()=>document.querySelector('#bundled-menu-message')?.textContent?.includes('142 dishes added'));
    assert.equal(db.prepare('SELECT COUNT(*) n FROM menu_items').get().n,142);
    assert.equal(db.prepare('SELECT price_paise FROM menu_items WHERE name=?').get('Masala Chai').price_paise,8000);
    await page.locator('#bundled-menu-preview').click();
    await page.waitForFunction(()=>document.querySelector('#bundled-menu-message')?.textContent?.includes('already represented'));
    assert.equal(await page.locator('#bundled-menu-sync').isDisabled(),true);
    assert.equal(await page.locator('#bundled-menu-review tbody tr').count(),142);
    await page.locator('#logout').click();
    await page.waitForURL(base+'/login.html');
    await page.locator('input[name=username]').fill('bundledcashier');
    await page.locator('input[name=password]').fill('synthetic-cashier-v6-password-strong');
    await page.getByRole('button',{name:'Sign in'}).click();
    await page.waitForURL(base+'/');
    await page.goto(base+'/#restaurant');
    await page.locator('#restaurant').waitFor({state:'visible'});
    assert.equal(await page.locator('#menu-import-section').isVisible(),false);
    assert.equal(await page.locator('#menu-search').isVisible(),true);
    assert.equal(await page.locator('#restaurant-menu-items').locator('button').count()>0,true);
    assert.deepEqual(errors,[],'No JavaScript errors during prebuilt menu review and sync');
    console.log('PASS: prebuilt Garh Jaisal 142 dish menu preview, GST acknowledgement, safe sync and cashier access');
  }finally{await context.close();await new Promise(r=>server.close(r));db.close();}
}
