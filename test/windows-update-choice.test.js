import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chooseWindowsUpdateAction} from '../public/windows-update-choice.js';

const candidate={platform:'windows',state:'installer_update_available',available:true,
 target_sha:'a'.repeat(40),download_url:'https://github.com/tchouhanjsm/fortledger/actions/runs/123/artifacts/456'};
const ready={ready:true,update_mode:'code_only',target_sha:'a'.repeat(40)};
test('eligible V7 owner sees in-place update first; installer download is hidden',()=>{
 const result=chooseWindowsUpdateAction(candidate,ready);
 assert.equal(result.in_place_ready,true);
 assert.equal(result.show_in_place,true);
 assert.equal(result.show_verified_installer,false);
 assert.match(result.guidance,/No installer download or startup verification/);
});
test('older supervisor or native-only update still offers verified installer fallback',()=>{
 for(const blocked of [
  {ready:false,update_mode:'code_only',blockers:['No V7 supervisor']},
  {ready:false,update_mode:'code_only',blockers:['Independent backup not verified']},
  {ready:false,update_mode:'code_only',blockers:['Native launcher changed']},
  {ready:true,update_mode:'installer',target_sha:'b'.repeat(40)},
  {ready:true,update_mode:'code_only',target_sha:'bad'}
 ]){
  const result=chooseWindowsUpdateAction(candidate,blocked);
  assert.equal(result.in_place_ready,false);
  assert.equal(result.show_in_place,false);
  assert.equal(result.show_verified_installer,true);
  assert.match(result.guidance,/one-time V7 bootstrap or a native-component upgrade/);
 }
});
test('invalid or absent GitHub installer artifacts never create a download option',()=>{
 for(const state of [
  {...candidate,download_url:'https://example.com/fake.exe'},
  {...candidate,download_url:'http://github.com/tchouhanjsm/fortledger/actions/runs/1/artifacts/2'},
  {...candidate,available:false},
  {...candidate,platform:'mac'},
  {...candidate,state:'installer_managed'}
 ]){
  const result=chooseWindowsUpdateAction(state,ready);
  assert.equal(result.show_in_place,false);
  assert.equal(result.show_verified_installer,false);
 }
});
test('UI checks updater readiness before exposing installer fallback, without killing server',()=>{
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const guard=readFileSync(new URL('../scripts/windows-installer-guard.ps1',import.meta.url),'utf8');
 const installer=readFileSync(new URL('../installers/FortLedger.iss',import.meta.url),'utf8');
 assert.match(app,/chooseWindowsUpdateAction\(state,readiness\)/);
 assert.match(app,/update-center-download'\)\.hidden=true/);
 assert.match(app,/update-center-download'\)\.hidden=!choice.show_verified_installer/);
 assert.match(app,/Apply code update & restart/);
 assert.match(guard,/Get-NetTCPConnection -LocalPort 3000 -State Listen/);
 assert.match(guard,/OwningProcess -Unique/);
 assert.match(guard,/Get-Process -Id \$ownerPid/);
 assert.match(guard,/Port 3000 is still listening:/);
 assert.match(installer,/restart Windows normally and run this installer/);
 assert.doesNotMatch(guard+installer,/Stop-Process|taskkill|Process\.Kill\(/i);
});

test('approved main source update is independent of a Windows installer artifact',()=>{
 const source={platform:'windows',state:'source_update_available',available:true,
   target_sha:'b'.repeat(40),download_url:null};
 const ready=chooseWindowsUpdateAction(source,{ready:true,update_mode:'code_only',
   target_sha:'b'.repeat(40)});
 assert.equal(ready.show_in_place,true);
 assert.equal(ready.show_verified_installer,false);
 const blocked=chooseWindowsUpdateAction(source,{ready:false,update_mode:'code_only'});
 assert.equal(blocked.show_in_place,false);
 assert.equal(blocked.show_verified_installer,false);
});

test('status and readiness must agree on the full approved target before showing Apply',()=>{
  const source={platform:'windows',state:'source_update_available',available:true,
    target_sha:'b'.repeat(40),download_url:null};
  for(const state of [source,candidate]){
    const changed=chooseWindowsUpdateAction(state,{ready:true,update_mode:'code_only',
      target_sha:'c'.repeat(40)});
    assert.equal(changed.in_place_ready,false);
    assert.equal(changed.show_in_place,false);
    assert.equal(changed.show_verified_installer,false);
    assert.match(changed.guidance,/Check for updates again/);
  }
  assert.equal(chooseWindowsUpdateAction({...source,target_sha:'B'.repeat(40)},
    {ready:true,update_mode:'code_only',target_sha:'b'.repeat(40)}).show_in_place,true);
  assert.equal(chooseWindowsUpdateAction({...candidate,target_sha:undefined},ready).show_in_place,false);
});

test('desktop Apply button uses the reconciled decision, not independent readiness',()=>{
  const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(app,/const ready=installerManaged\s*\?choice\.show_in_place\s*:/);
});

test('source fallback is exact-target and verified URL only, never a backup workaround',()=>{
 const source={platform:'windows',state:'source_update_available',available:true,target_sha:'b'.repeat(40)};
 const native={ready:false,update_mode:'code_only',target_sha:source.target_sha,installer_required:true,
  installer_download_url:candidate.download_url};
 const choice=chooseWindowsUpdateAction(source,native);
 assert.equal(choice.show_verified_installer,true);
 assert.equal(choice.installer_download_url,candidate.download_url);
 assert.equal(choice.show_in_place,false);
 for(const readiness of [{...native,target_sha:'c'.repeat(40)},{...native,installer_required:false},
  {...native,installer_download_url:'https://example.com/setup.exe'},{...native,installer_download_url:null}]){
  const blocked=chooseWindowsUpdateAction(source,readiness);
  assert.equal(blocked.show_verified_installer,false);assert.equal(blocked.installer_download_url,null);
 }
 assert.equal(chooseWindowsUpdateAction(source,{...native,ready:true}).show_in_place,true);
});
