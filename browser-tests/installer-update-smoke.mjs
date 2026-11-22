/* Browser-only synthetic installer notifications; no live GitHub or hotel records. */
import assert from 'node:assert/strict';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {createStaff} from '../src/staff.js';

export async function runInstallerUpdateNoticeSmoke(browser){
  const previous=process.env.FORTLEDGER_DESKTOP_INSTALLER;
  process.env.FORTLEDGER_DESKTOP_INSTALLER='1';
  const db=openDatabase(':memory:');
  let checks=0;
  const app=createApp(db,{
    authRecord:createPasswordRecord('synthetic-install-owner-password-123'),
    checkUpdates:async()=>{
      checks++;
      return {platform:'windows',state:'installer_update_available',
        available:true,download_url:
        'https://github.com/tchouhanjsm/fortledger/actions/runs/123/artifacts/456',
        message:'A verified installer build is ready.'};
    }
  });
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  try{
    createStaff(db,{username:'syntheticmanager',display_name:'Manager',
      role:'manager',password:'synthetic-manager-password-long'});
    for(const user of [
      {username:'owner',password:'synthetic-install-owner-password-123',owner:true},
      {username:'syntheticmanager',password:'synthetic-manager-password-long',owner:false}
    ]){
      const context=await browser.newContext({viewport:{width:390,height:850}});
      try{
        const page=await context.newPage();
        await page.goto(base+'/login.html');
        await page.locator('input[name="username"]').fill(user.username);
        await page.locator('input[name="password"]').fill(user.password);
        await page.getByRole('button',{name:'Sign in'}).click();
        await page.waitForURL(base+'/');
        await page.locator('#workspace-title').waitFor({state:'visible'});
        const me=await context.request.get(base+'/api/me');
        assert.equal((await me.json()).desktop_installer,true);
        if(user.owner){
          await page.locator('#owner-new-update').waitFor({state:'visible'});
          assert.equal(checks>0,true,'Owner checks release after login');
          await page.locator('#owner-new-update').click();
          await page.locator('#profile').waitFor({state:'visible'});
          await page.locator('#update-center-download').waitFor({state:'visible'});
          assert.equal(await page.locator('#update-center-download').isEnabled(),true);
          assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n,0);
          // Update button only opens official artifact; it never installs code
          // or modifies bookings, payments, accounts or persistent records.
        }else{
          assert.equal(await page.locator('#owner-new-update').isVisible(),false);
          assert.equal(await page.locator('#update-center').isVisible(),false);
          assert.equal((await context.request.get(base+'/api/system/updates')).status(),403);
        }
      }finally{await context.close();}
    }
  }finally{
    await new Promise(resolve=>server.close(resolve));
    db.close();
    if(previous===undefined)delete process.env.FORTLEDGER_DESKTOP_INSTALLER;
    else process.env.FORTLEDGER_DESKTOP_INSTALLER=previous;
  }
  console.log('PASS Chromium installer owner new-update notice and staff denial, 390px.');
}
