import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createConfirmAction} from '../public/ui-dialog.js';

const read=path=>readFileSync(new URL('../public/'+path,import.meta.url),'utf8');

class Control extends EventTarget{
  constructor(doc){super();this.ownerDocument=doc;this.isConnected=true;this.dataset={};this.textContent='';}
  focus(){this.ownerDocument.activeElement=this;}
}
class ConfirmDialog extends Control{
  constructor(){
    const doc={activeElement:null};
    super(doc);this.open=false;this.nodes=new Map();
    for(const id of ['shizuka-confirm-title','shizuka-confirm-detail',
      'shizuka-confirm-cancel','shizuka-confirm-approve'])
      this.nodes.set('#'+id,new Control(doc));
  }
  querySelector(selector){return this.nodes.get(selector);}
  showModal(){if(this.open)throw Error('already open');this.open=true;}
  close(){this.open=false;this.dispatchEvent(new Event('close'));}
  el(id){return this.nodes.get('#shizuka-confirm-'+id);}
}

test('shared native dialog prevents concurrent confirmations, cancel/Escape and restores focus',async()=>{
  const dialog=new ConfirmDialog(),caller=new Control(dialog.ownerDocument);
  caller.focus();
  const confirm=createConfirmAction(dialog);
  let pending=confirm({title:'Pause dish?',detail:'Existing bills stay unchanged',confirmLabel:'Pause'});
  assert.equal(dialog.open,true);
  assert.equal(dialog.el('title').textContent,'Pause dish?');
  assert.equal(dialog.el('approve').dataset.danger,'false');
  assert.equal(dialog.ownerDocument.activeElement,dialog.el('cancel'));
  assert.equal(await confirm({title:'Overlapping action',detail:''}),false);
  const escape=new Event('cancel',{cancelable:true});
  dialog.dispatchEvent(escape);
  assert.equal(escape.defaultPrevented,true);
  assert.equal(await pending,false);
  assert.equal(dialog.open,false);
  assert.equal(dialog.ownerDocument.activeElement,caller);
  pending=confirm({title:'Clear draft?',detail:'Only unsaved lines',confirmLabel:'Clear draft',danger:true});
  assert.equal(dialog.el('approve').dataset.danger,'true');
  dialog.el('cancel').dispatchEvent(new Event('click'));
  assert.equal(await pending,false);
  pending=confirm({title:'Pause dish?',detail:'Will not change old receipts'});
  dialog.el('approve').dispatchEvent(new Event('click'));
  assert.equal(await pending,true);
  assert.equal(dialog.open,false);
  pending=confirm({title:'Close test',detail:'Closed by browser'});
  dialog.close();
  assert.equal(await pending,false);
  assert.equal(dialog.ownerDocument.activeElement,caller);
});

test('SHIZUKA forms and dialog semantics are centralized without changing ledger actions',()=>{
  const legacy=read('styles.css'),shared=read('heritage-sky.css'),
    index=read('index.html'),login=read('login.html'),app=read('app.js');
  for(const selector of ['.primary{background:#234d3d','.secondary{background:#fff',
    '.form-grid label{display:flex','.dialog-actions{display:flex',
    '.profile-form label,.staff-create label{','.icon-btn{border:0']){
    assert.ok(!legacy.includes(selector),'Retired shared rule must be absent: '+selector);
  }
  assert.match(shared,/\.primary,\.secondary\{/);
  assert.match(shared,/\.dialog-actions\{/);
  assert.match(shared,/\.form-preview\{/);
  assert.match(shared,/--sh-control-height:44px/);
  assert.match(shared,/input:is\(\[type=checkbox\],\[type=radio\]\)/);
  assert.match(shared,/#daily-close-form label:has\(> input\[type=checkbox\]\)/);
  assert.match(login,/href="\/heritage-sky\.css"/);
  for(const pair of [['booking-dialog','dialog-title'],['invoice-dialog','invoice-dialog-title'],
    ['folio-dialog','folio-name'],['tax-draft-dialog','tax-draft-title'],
    ['shizuka-confirm-dialog','shizuka-confirm-title']]){
    assert.ok(index.includes('id="'+pair[0]+'" aria-labelledby="'+pair[1]+'"'));
  }
  assert.match(index,/id="shizuka-confirm-detail"/);
  assert.match(app,/createConfirmAction\(\$\('#shizuka-confirm-dialog'\)\)/);
  assert.match(app,/Clear this draft bill\?/);
  assert.match(app,/original prices remain unchanged/);
  assert.match(app,/if\(pendingRestaurantBill\)return;/);
  assert.doesNotMatch(shared,/@import|url\(https?:/i);
});
