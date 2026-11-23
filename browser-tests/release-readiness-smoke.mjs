/* Synthetic Chromium owner release-check presentation, no genuine evidence. */
import assert from 'node:assert/strict';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {createStaff} from '../src/staff.js';
import {PHYSICAL_RELEASE_GATES} from '../src/release-readiness.js';

export async function runOwnerReleaseReadinessSmoke(browser){
  const db=openDatabase(':memory:');
  createStaff(db,{username:'syntheticmanager',display_name:'Manager',
    role:'manager',password:'synthetic-manager-password-long'});
  let reads=0;
  const app=createApp(db,{authRecord:createPasswordRecord('synthetic-owner-password-long'),
    getReleaseReadiness:()=>{reads++;return {
      verdict:'NOT RELEASED',production_ready:false,
      automated:{passed:8,failed:0,warnings:2},
      evidence:{attested:0,valid:true},blocking_items:[],
      physical_gates:PHYSICAL_RELEASE_GATES.map(g=>({...g,status:'PENDING HUMAN VERIFICATION'}))
    };},
    checkUpdates:async()=>({platform:'windows',available:false,state:'up_to_date'})});
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  try{
    for(const user of [
      {name:'owner',password:'synthetic-owner-password-long',owner:true},
      {name:'syntheticmanager',password:'synthetic-manager-password-long',owner:false}
    ]){
      const context=await browser.newContext({viewport:{width:390,height:850}});
      try{
        const page=await context.newPage(),errors=[];
        page.on('pageerror',error=>errors.push(error.message));
        await page.goto(base+'/login.html');
        await page.locator('input[name="username"]').fill(user.name);
        await page.locator('input[name="password"]').fill(user.password);
        await page.getByRole('button',{name:'Sign in'}).click();
        await page.waitForURL(base+'/');
        await page.goto(base+'/#profile');
        await page.locator('#profile').waitFor({state:'visible'});
        // The hash route may render before the async auth/profile response
        // has completed. Wait for the *expected* permission-dependent panel
        // state instead of asserting against its transient initial hidden state.
        if(user.owner)await page.locator('#release-status-panel').waitFor({state:'visible'});
        else await page.waitForFunction(()=>
          document.querySelector('#profile')?.classList.contains('active')||
          document.querySelector('#profile')?.offsetParent!==null);
        assert.equal(await page.locator('#release-status-panel').isVisible(),user.owner);
        if(user.owner){
          assert.equal(reads,0,'Release checks must never run automatically on sign-in');
          await page.locator('#release-status-check').click();
          await page.waitForFunction(()=>
            document.querySelector('#release-status-message')?.textContent?.includes('0 of 6'));
          assert.match(await page.locator('#release-status-message').textContent(),/NOT RELEASED/);
          assert.equal(await page.locator('#release-status-items li').count(),7);
          assert.equal(reads,1);
        }else{
          const denied=await context.request.get(base+'/api/system/release-readiness');
          assert.equal(denied.status(),403);
          assert.equal(reads,1);
        }
        assert.deepEqual(errors,[]);
      }finally{await context.close();}
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n,0);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
  console.log('PASS Chromium 390px owner explicit release check and manager denial.');
}
