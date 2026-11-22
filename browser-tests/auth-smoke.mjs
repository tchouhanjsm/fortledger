/* Browser checks on an authenticated disposable seven-room hotel, not real data. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {createStaff} from '../src/staff.js';
import {importMenuCsv,listMenu} from '../src/restaurant.js';

export async function runAuthenticatedBrowserSmoke(browser){
  const db=openDatabase(':memory:');
  const ownerPassword='synthetic-test-owner-password-strong';
  const users=[
    {username:'owner',password:ownerPassword,role:'owner'},
    {username:'managerqa',password:'synthetic-test-manager-password-strong',role:'manager'},
    {username:'deskqa',password:'synthetic-test-desk-password-strong',role:'frontdesk'},
    {username:'cashierqa',password:'synthetic-test-cashier-password-strong',role:'cashier'}
  ];
  const server=createApp(db,{authRecord:createPasswordRecord(ownerPassword)}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  try{
    importMenuCsv(db,'name,category,price,tax_rate\nSynthetic Chai,Drinks,80,5');
    for(const user of users.slice(1))
      createStaff(db,{username:user.username,display_name:user.role+' QA',
        role:user.role,password:user.password});
    for(const user of users){
      const context=await browser.newContext({viewport:{width:390,height:850}});
      try{
        const page=await context.newPage(),errors=[];
        page.on('pageerror',err=>errors.push(err.message));
        const anonymous=await context.request.get(base+'/api/me');
        assert.equal(anonymous.status(),401,'No unauthenticated access to hotel records');
        await page.goto(base+'/login.html');
        // Login must share the same local SHIZUKA design as staff workspaces.
        assert.equal(await page.evaluate(()=>[...document.styleSheets].some(sheet=>
          sheet.href?.endsWith('/heritage-sky.css'))),true);
        assert.equal(await page.locator('body').evaluate(el=>
          getComputedStyle(el).backgroundColor),'rgb(248, 246, 241)');
        assert.ok(await page.locator('#login-form input[name="username"]').evaluate(el=>
          parseFloat(getComputedStyle(el).minHeight)>=44));
        await page.locator('input[name="username"]').fill(user.username);
        await page.locator('input[name="password"]').fill(user.password);
        await page.getByRole('button',{name:'Sign in'}).click();
        await page.waitForURL(base+'/',{timeout:15000});
        await page.waitForFunction(()=>document.querySelector('#workspace-title')?.textContent?.length>2);
        const me=await context.request.get(base+'/api/me');
        assert.equal(me.status(),200);
        assert.equal((await me.json()).role,user.role);
        const forbidden=await context.request.post(base+'/api/finance/closing',{
          data:{business_date:user.role==='manager'?'2027-04-02':'2027-04-01',
            opening_cash:0,counted_cash:0,request_id:randomUUID()}
        });
        assert.equal(forbidden.status(),['cashier','frontdesk'].includes(user.role)?403:201,
          'Financial closing role boundary at '+user.role);
        if(user.role==='cashier'){
          const bookings=await context.request.get(base+'/api/bookings');
          assert.equal(bookings.status(),403);
          const res=await context.request.post(base+'/api/restaurant/bills',{
            data:{request_id:randomUUID(),payment_method:'cash',
              items:[{menu_item_id:listMenu(db)[0].id,quantity:1,
                unit_price_paise:listMenu(db)[0].price_paise,tax_rate:listMenu(db)[0].tax_rate}]}
          });
          assert.equal(res.status(),201);
          await page.goto(base+'/#restaurant');
          await page.locator('#restaurant').waitFor({state:'visible'});
          assert.equal(await page.locator('#bookings').isVisible(),false);
          assert.equal(await page.locator('#menu-import-section').isVisible(),false,
            'Cashiers may bill but must not access menu price administration');
        }else if(user.role==='frontdesk'){
          assert.equal((await context.request.get(base+'/api/bookings')).status(),200);
          assert.equal((await context.request.get(base+'/api/guests')).status(),200);
          assert.equal((await context.request.get(base+'/api/finance/closing/attention')).status(),403);
        }else{
          assert.equal((await context.request.get(base+'/api/finance/closing/attention')).status(),200);
          assert.equal((await context.request.get(base+'/api/audit/daily_close/1')).status(),200);
          if(user.role==='manager'){
            // Real 390px keyboard/touch journey, not just a direct HTTP toggle.
            await page.goto(base+'/#restaurant');
            await page.locator('#restaurant').waitFor({state:'visible'});
            // A draft prepared before the manager pauses an item remains visible,
            // removable and cannot silently become an incorrect zero-value bill.
            const menuItemId=listMenu(db)[0].id;
            await page.getByRole('button',{name:'Add Synthetic Chai to bill'}).click();
            await page.locator('#menu-import-section > summary').click();
            await page.locator('#menu-availability-section > summary').click();
            await page.waitForFunction(()=>document.querySelector('#menu-availability-items .menu-availability-row button'));
            assert.equal(await page.locator('#menu-availability-items .menu-availability-row').count(),1);
            const disable=page.getByRole('button',{name:'Mark unavailable: Synthetic Chai'});
            await disable.click();
            const confirm=page.getByRole('dialog',{name:'Mark unavailable Synthetic Chai?'});
            await confirm.waitFor({state:'visible'});
            assert.equal(await page.evaluate(()=>document.activeElement?.id),
              'shizuka-confirm-cancel');
            await page.keyboard.press('Escape');
            await confirm.waitFor({state:'hidden'});
            assert.equal((await context.request.get(base+'/api/restaurant/menu').then(r=>r.json())).length,1,
              'Escape must preserve menu state');
            await disable.click();
            await confirm.waitFor({state:'visible'});
            await page.locator('#shizuka-confirm-approve').click();
            await page.getByRole('button',{name:'Make available: Synthetic Chai'}).waitFor();
            assert.equal((await context.request.get(base+'/api/restaurant/menu').then(r=>r.json())).length,0);
            assert.equal(await page.locator('#menu-items .menu-item').count(),0);
            assert.equal(await page.locator('#cart-count').textContent(),'1 item');
            assert.match(await page.locator('#cart-total').textContent(),/Bill needs review/);
            const removeUnavailable=page.getByRole('button',{name:'Remove unavailable menu item #'+menuItemId});
            assert.equal(await removeUnavailable.isVisible(),true);
            await removeUnavailable.click();
            assert.equal(await page.locator('#cart-count').textContent(),'0 items');
            assert.equal(await page.getByRole('button',{name:'Make available: Synthetic Chai'}).isEnabled(),true);
            await page.getByRole('button',{name:'Make available: Synthetic Chai'}).click();
            await page.locator('#shizuka-confirm-dialog').waitFor({state:'visible'});
            await page.locator('#shizuka-confirm-approve').click();
            await page.getByRole('button',{name:'Mark unavailable: Synthetic Chai'}).waitFor();
            assert.equal((await context.request.get(base+'/api/restaurant/menu').then(r=>r.json())).length,1);
            assert.equal(db.prepare('SELECT COUNT(*) n FROM operation_audit WHERE entity_type=?').get('menu_item').n,2);
          }
        }
        assert.deepEqual(errors,[],'Authenticated browser errors for '+user.role);
      }finally{await context.close();}
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM restaurant_bills').get().n,1);
    console.log('PASS: Chromium authenticated owner/manager/front-desk/cashier, role boundaries and cashier bill.');
  }finally{
    await new Promise(resolve=>server.close(resolve));
    db.close();
  }
}
