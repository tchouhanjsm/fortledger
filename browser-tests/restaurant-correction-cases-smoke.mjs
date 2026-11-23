/* Synthetic manager/owner workflow for immutable restaurant correction cases.
 * This test never prints, refunds, issues tax documents or changes guest money. */
import assert from 'node:assert/strict';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {createStaff} from '../src/staff.js';
import {importMenuCsv,createRestaurantBill} from '../src/restaurant.js';

export async function runRestaurantCorrectionCasesSmoke(browser){
  for(const width of [390,1440]){
    const db=openDatabase(':memory:');
    importMenuCsv(db,'name,category,price,tax_rate\nSynthetic Tea,Drinks,80,5');
    const bill=createRestaurantBill(db,{payment_method:'cash',
      items:[{menu_item_id:1,quantity:2}]});
    const saved=db.prepare('SELECT * FROM restaurant_bills WHERE id=?').get(bill.id);
    const managerPass='synthetic-manager-correction-password';
    const ownerPass='synthetic-owner-correction-password';
    createStaff(db,{username:'case-manager',display_name:'Correction Manager',role:'manager',
      password:managerPass});
    const server=createApp(db,{authRecord:createPasswordRecord(ownerPass)}).listen(0,'127.0.0.1');
    await new Promise(resolve=>server.once('listening',resolve));
    const base='http://127.0.0.1:'+server.address().port;
    const context=await browser.newContext({viewport:{width,height:900}});
    try{
      async function signIn(page,username,password){
        await page.goto(base+'/login.html');
        await page.locator('input[name=username]').fill(username);
        await page.locator('input[name=password]').fill(password);
        await page.getByRole('button',{name:'Sign in'}).click();
        await page.waitForURL(base+'/');
        await page.goto(base+'/#restaurant-admin');
        await page.locator('#restaurant-admin').waitFor({state:'visible'});
      }
      const page=await context.newPage();
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await signIn(page,'case-manager',managerPass);
      const card=page.locator('#restaurant-bill-'+bill.id);
      await card.waitFor({state:'visible'});
      const panel=card.locator('.restaurant-correction-review');
      await panel.locator('summary').click();
      await panel.locator('input[type=checkbox]').check();
      await panel.locator('input[type=number]').fill('1');
      await panel.locator('textarea').first().fill('Guest received only one tea');
      await panel.getByRole('button',{name:'Calculate impact'}).click();
      await panel.getByText('Estimated correction:').waitFor({state:'visible'});
      assert.match(await panel.locator('.restaurant-correction-result').textContent(),/80\.00/);
      await panel.getByRole('button',{name:'Record case for owner review'}).click();
      await page.waitForFunction(()=>document.querySelector('.restaurant-correction-case-card')?.textContent?.includes('awaiting owner'));
      assert.equal(db.prepare('SELECT COUNT(*) n FROM restaurant_correction_cases').get().n,1);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM restaurant_correction_case_reviews').get().n,0);
      assert.deepEqual(db.prepare('SELECT * FROM restaurant_bills WHERE id=?').get(bill.id),saved);
      assert.equal(await panel.getByRole('button',{name:'Record owner decision'}).count(),0);
      const ownerPage=await context.newPage();
      ownerPage.on('pageerror',e=>errors.push(e.message));
      await signIn(ownerPage,'owner',ownerPass);
      const ownerCard=ownerPage.locator('#restaurant-bill-'+bill.id);
      await ownerCard.waitFor({state:'visible'});
      const ownerPanel=ownerCard.locator('.restaurant-correction-review');
      await ownerPanel.locator('summary').click();
      await ownerPanel.getByRole('button',{name:'View correction case history'}).click();
      await ownerPanel.locator('.restaurant-correction-case-card').waitFor({state:'visible'});
      await ownerPanel.locator('select').selectOption('needs_accountant');
      await ownerPanel.locator('.restaurant-correction-case-card textarea').fill(
        'Accountant must review tax and payment treatment');
      await ownerPanel.getByRole('button',{name:'Record owner decision'}).click();
      await ownerPage.waitForFunction(()=>document.querySelector('.restaurant-correction-case-card')?.textContent?.includes('needs accountant'));
      assert.equal(db.prepare('SELECT COUNT(*) n FROM restaurant_correction_case_reviews').get().n,1);
      assert.deepEqual(db.prepare('SELECT * FROM restaurant_bills WHERE id=?').get(bill.id),saved);
      assert.deepEqual(errors,[],'No UI runtime failures at '+width+'px');
      console.log('PASS: manager saves nonfinancial correction case, owner records immutable disposition at '+width+'px');
    }finally{
      await context.close();
      await new Promise(resolve=>server.close(resolve));
      db.close();
    }
  }
}
