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
  const server=createApp(db,{authRecord:createPasswordRecord(ownerPassword),
    prepareUpgradeBackup:async()=>({state:'prepared',
      isolated_restore_verified:true,owner_credential_recoverable:true,
      detail:'Synthetic protected backup prepared and independently rehearsed.'}),
    checkUpdates:async()=>({platform:'windows',state:'new_revision',available:true,
      current:'aaaaaaaaaaaa',remote:'bbbbbbbbbbbb',message:'Synthetic GitHub update detected.'}),
    updateService:{inspect:async()=>({platform:'windows',ready:true,state:'new_revision',
      target_sha:'b'.repeat(40),blockers:[],
      ci_run_url:'https://github.com/tchouhanjsm/fortledger/actions/runs/123'}),
      request:async()=>{throw Error('Browser cancel should never start an update');}}
  }).listen(0,'127.0.0.1');
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
        if(user.role==='owner'){
          await page.locator('#owner-update-notice').waitFor({state:'visible'});
          await page.locator('#owner-update-notice').click();
          await page.waitForURL(base+'/#profile');
        }else{
          assert.equal(await page.locator('#owner-update-notice').isVisible(),false,
            'Only a local owner may receive an update notification');
        }
        // Update Center must be owner-only and only inspect revisions; even the
        // synthetic 390px browser never executes an updater or changes the DB.
        await page.goto(base+'/#profile');
        await page.locator('#profile').waitFor({state:'visible'});
        await page.waitForFunction(()=>document.querySelector('#profile-name')?.textContent!=='Loading profile');
        assert.equal(await page.locator('#update-center').isVisible(),user.role==='owner');
        if(user.role==='owner'){
          assert.equal(await page.locator('#backup-center-prepare').isVisible(),true);
          await page.locator('#backup-center-prepare').click();
          await page.waitForFunction(()=>
            document.querySelector('#backup-center-prepare-state')?.dataset.state==='prepared');
          assert.match(await page.locator('#backup-center-prepare-state').textContent(),
            /Synthetic protected backup prepared/);
          assert.equal(db.prepare('SELECT COUNT(*) n FROM bookings').get().n,0,
            'Preparing a backup does not create a booking, bill or payment');
          await page.locator('#update-center-check').click();
          await page.waitForFunction(()=>
            document.querySelector('#update-center-state')?.dataset.state==='new_revision');
          assert.match(await page.locator('#update-center-state').textContent(),
            /Synthetic GitHub update detected/);
          assert.match(await page.locator('#update-center-versions').textContent(),
            /Installed: aaaaaaaaaaaa.*GitHub main: bbbbbbbbbbbb/);
          assert.equal(await page.locator('#update-center-windows').isVisible(),true);
          await page.locator('#update-center-install').waitFor({state:'visible'});
          assert.equal(await page.locator('#update-center-install').isEnabled(),true);
          await page.locator('#update-center-install').click();
          await page.locator('#shizuka-confirm-dialog').waitFor({state:'visible'});
          assert.match(await page.locator('#shizuka-confirm-detail').textContent(),
            /have finished their booking or bill forms/);
          await page.keyboard.press('Escape');
          await page.locator('#shizuka-confirm-dialog').waitFor({state:'hidden'});
          assert.equal(db.prepare('SELECT COUNT(*) n FROM bookings').get().n,0);
          assert.equal(await page.locator('#update-center-install').isEnabled(),true,
            'Cancelling update keeps owner controls usable');
        }else{
          assert.equal(await page.locator('#backup-center-prepare').isVisible(),false,
            'Staff never see protected backup preparation');
          assert.equal((await context.request.get(base+'/api/system/updates')).status(),403);
        }
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
          assert.equal(await page.locator('#restaurant-reconciliation-section').isVisible(),false,
            'Restaurant exports must stay finance-reader only');
          assert.equal((await context.request.get(base+
            '/api/finance/restaurant/reconciliation.csv?date=2026-11-22')).status(),403);
        }else if(user.role==='frontdesk'){
          await page.goto(base+'/#restaurant');
          assert.equal(await page.locator('#restaurant').isVisible(),false);
          assert.equal((await context.request.get(base+'/api/restaurant/bills')).status(),403);
          assert.equal((await context.request.get(base+'/api/bookings')).status(),200);
          assert.equal((await context.request.get(base+'/api/guests')).status(),200);
          assert.equal((await context.request.get(base+'/api/finance/closing/attention')).status(),403);
        }else{
          assert.equal((await context.request.get(base+'/api/finance/closing/attention')).status(),200);
          assert.equal((await context.request.get(base+'/api/audit/daily_close/1')).status(),200);
          if(user.role==='manager'){
            // Real 390px keyboard/touch journey, not just a direct HTTP toggle.
            await page.goto(base+'/#restaurant-admin');
            await page.locator('#restaurant-admin').waitFor({state:'visible'});
            assert.equal(await page.locator('#restaurant').isVisible(),false);
            // A real manager download never mutates the restaurant bill ledger.
            await page.locator('#restaurant-reconciliation-section > summary').click();
            await page.locator('#restaurant-reconciliation-date').fill('2026-11-22');
            const billsBefore=db.prepare('SELECT COUNT(*) n FROM restaurant_bills').get().n;
            const csvDownload=page.waitForEvent('download');
            await page.locator('#restaurant-reconciliation-download').click();
            const download=await csvDownload;
            assert.equal(download.suggestedFilename(),'fortledger-restaurant-2026-11-22.csv');
            assert.match(await page.locator('#restaurant-reconciliation-message').textContent(),
              /Verify operator-recorded receipts/);
            assert.equal(db.prepare('SELECT COUNT(*) n FROM restaurant_bills').get().n,billsBefore);
            // A manager's menu action must never open or mutate a cashier draft.
            await page.goto(base+'/#restaurant');
            assert.equal(await page.locator('#restaurant').isVisible(),false);
            await page.goto(base+'/#restaurant-admin');
            await page.locator('#restaurant-admin').waitFor({state:'visible'});
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
            assert.equal(await page.locator('#restaurant').isVisible(),false);
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
