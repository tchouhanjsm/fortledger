import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {drainAfterAcceptedResponse} from '../src/update-readiness.js';

test('accepted update drains once on normal response, dropped response or prior disconnect',()=>{
 for(const events of [['finish','close'],['close','finish'],[],[]]){
  const res=new EventEmitter(),queue=[];let drained=0;
  if(events.length===0)res.destroyed=true;
  drainAfterAcceptedResponse(res,()=>drained++,fn=>queue.push(fn));
  for(const event of events)res.emit(event);
  assert.equal(queue.length,1);assert.equal(drained,0);
  queue[0]();assert.equal(drained,1);
  assert.equal(res.listenerCount('finish'),0);assert.equal(res.listenerCount('close'),0);
 }
});
test('no drain is queued while the accepted response is still in flight',()=>{
 const res=new EventEmitter(),queue=[];
 drainAfterAcceptedResponse(res,()=>{},fn=>queue.push(fn));
 assert.equal(queue.length,0);
 res.emit('finish');assert.equal(queue.length,1);
});
