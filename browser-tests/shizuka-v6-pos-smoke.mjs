/* Authenticated SHIZUKA V6 cashier experience on a disposable in-memory hotel.
   No actual payments, printing, database files or guest personal data. */
import assert from 'node:assert/strict';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {createStaff} from '../src/staff.js';
import {importMenuCsv,updateMenuItemPrice,listMenu} from '../src/restaurant.js';

export async function runShizukaV6PosSmoke(browser){
  for(const width of [390,1440]){
    const db=openDatabase(':memory:');
    const ownerPassword='v6-owner-synthetic-check-password';
    const cashierPassword='v6-cashier-synthetic-check-password';
    importMenuCsv(db,'name,category,price,tax_rate\nSynthetic Tea,Drinks,80,5');
    createStaff(db,{username:'cashier-v6-ui',display_name:'Cashier QA',
      role:'cashier',password:cashierPassword});
    const server=createApp(db,{authRecord:createPasswordRecord(ownerPassword)}).listen(0,'127.0.0.1');
    await new Promise(resolve=>server.once('listening',resolve));
    const base='http://127.0.0.1:'+server.address().port;
    const context=await browser.newContext({viewport:{width,height:860}});
    try{
      const page=await context.newPage(),errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      await page.goto(base+'/login.html');
      await page.locator('input[name=username]').fill('cashier-v6-ui');
      await page.locator('input[name=password]').fill(cashierPassword);
      await page.getByRole('button',{name:'Sign in'}).click();
      await page.waitForURL(base+'/');
      await page.goto(base+'/#restaurant');
      await page.locator('#restaurant').waitFor({state:'visible'});
      assert.equal(await page.locator('#restaurant-admin').isVisible(),false);
      assert.equal(await page.locator('#restaurant-history-section').isVisible(),false);
      await page.getByRole('button',{name:'Add Synthetic Tea to bill'}).click();
      assert.match(await page.locator('#cart-count').textContent(),/1 item/);
      if(width===390){
        const cart=page.locator('#restaurant-mobile-cart');
        await cart.waitFor({state:'visible'});
        assert.match(await cart.textContent(),/80\.00/);
        await cart.click();
        assert.equal(await page.locator('#restaurant-bill-panel').getAttribute('aria-modal'),'true');
        assert.equal(await page.evaluate(()=>document.activeElement?.id),'restaurant-mobile-cart-close');
        await page.keyboard.press('Escape');
        assert.equal(await page.evaluate(()=>document.activeElement?.id),'restaurant-mobile-cart');
        assert.equal(await page.locator('#restaurant-bill-panel').isVisible(),false);
        await cart.click();
      }else{
        assert.equal(await page.locator('#restaurant-mobile-cart').isVisible(),false);
        assert.equal(await page.locator('#restaurant-bill-panel').isVisible(),true);
      }
      await page.locator('#review-restaurant-bill').click();
      assert.match(await page.locator('#restaurant-review-total').textContent(),/80\.00/);
      const original=listMenu(db)[0];
      updateMenuItemPrice(db,original.id,{
        price_paise:10000,tax_rate:5,expected_price_paise:8000,
        expected_tax_rate:5,reason:'Reviewed synthetic restaurant price update'
      },{id:0,username:'owner',role:'owner'});
      if(width===390)await page.locator('#restaurant-mobile-cart-close').click();
      await page.locator('#refresh-workspace').click();
      await page.waitForFunction(()=>document.querySelector('#refresh-message')?.textContent?.includes('Hotel records refreshed'));
      if(width===390)await page.locator('#restaurant-mobile-cart').click();
      assert.equal(await page.locator('#save-restaurant-bill').isDisabled(),true,
        'Draft reviewed at old prices must not save when menu changes');
      await page.locator('#edit-restaurant-bill').click();
      await page.locator('#review-restaurant-bill').click();
      assert.match(await page.locator('#restaurant-review-total').textContent(),/100\.00/);
      page.once('dialog',dialog=>dialog.accept());
      await page.locator('#save-restaurant-bill').click();
      await page.locator('#restaurant-saved-actions').waitFor({state:'visible'});
      assert.match(await page.locator('#restaurant-saved-summary').textContent(),/100\.00/);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM restaurant_bills').get().n,1);
      assert.equal(db.prepare('SELECT total_paise FROM restaurant_bills').get().total_paise,10000);
      if(width===390)await page.locator('#restaurant-mobile-cart-close').click();
      await page.locator('#restaurant-jump-history').click();
      await page.locator('#restaurant-history-section').waitFor({state:'visible'});
      assert.equal(await page.locator('#restaurant-pos-editor').isVisible(),false);
      assert.match(await page.locator('#restaurant-history').textContent(),/100\.00/);
      await page.getByRole('button',{name:'Check printer status'}).click();
      assert.match(await page.locator('.restaurant-print-state').first().textContent(),
        /No recorded Epson LAN attempt/);
      await page.goto(base+'/#profile');
      assert.equal(await page.evaluate(()=>document.body.classList.contains('restaurant-cart-open')),false,
        'Leaving restaurant workspace must never trap scrolling');
      assert.deepEqual(errors,[],'No browser runtime errors at '+width+'px');
      console.log('PASS: V6 authenticated cashier mobile/desktop bill, price re-review and saved receipt at '+width+'px');
    }finally{
      await context.close();
      await new Promise(resolve=>server.close(resolve));
      db.close();
    }
  }
}
