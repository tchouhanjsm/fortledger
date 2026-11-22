import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {AUDIT_ENTITY_TYPES,recordAudit,auditEvents} from '../src/financial-audit.js';

const owner={id:0,username:'owner',role:'owner'};
test('all recordable audit entity types are readable, including daily close',()=>{
  const db=openDatabase(':memory:');
  try{
    for(const entity of AUDIT_ENTITY_TYPES){
      recordAudit(db,owner,'test.recorded',entity,1,{test_fixture:true});
      const rows=auditEvents(db,{entityType:entity,entityId:1});
      assert.equal(rows.length,1,entity);
      assert.equal(rows[0].action,'test.recorded',entity);
      assert.equal(rows[0].actor_role,'owner',entity);
    }
    assert.ok(AUDIT_ENTITY_TYPES.includes('daily_close'));
    assert.throws(()=>auditEvents(db,{entityType:'unknown_entity',entityId:1}),/Invalid audit request/);
  }finally{db.close();}
});

test('daily close audit round-trips through existing authenticated API route',async()=>{
  const db=openDatabase(':memory:');
  const server=createApp(db).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  try{
    recordAudit(db,owner,'daily_close.recorded','daily_close',1,{business_date:'2027-01-02'});
    const res=await fetch('http://127.0.0.1:'+server.address().port+'/api/audit/daily_close/1');
    assert.equal(res.status,200);
    const events=await res.json();
    assert.equal(events.length,1);
    assert.equal(events[0].details.business_date,'2027-01-02');
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
