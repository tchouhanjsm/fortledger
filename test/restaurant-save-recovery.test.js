import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileRestaurantSaveFailure} from '../public/restaurant-save-recovery.js';

test('lost or unreadable response reconciles already recorded bill by the original request',async()=>{
 for(const error of [new TypeError('network'),new SyntaxError('invalid JSON'),{httpStatus:503}]){
  assert.deepEqual(await reconcileRestaurantSaveFailure(error,async()=>({recorded:true,id:12})),{state:'recorded',id:12});
  assert.equal((await reconcileRestaurantSaveFailure(error,async()=>({recorded:false}))).state,'uncertain');
 }
});
test('only definitive rejection and confirmed absence releases the original request',async()=>{
 for(const httpStatus of [400,403,409,422]){
  assert.equal((await reconcileRestaurantSaveFailure({httpStatus},async()=>({recorded:false}))).state,'rejected');
  assert.equal((await reconcileRestaurantSaveFailure({httpStatus},async()=>({recorded:true,id:9}))).state,'uncertain');
  assert.equal((await reconcileRestaurantSaveFailure({httpStatus},async()=>{throw Error('offline')})).state,'uncertain');
 }
 for(const response of [{recorded:true,id:null},{recorded:true,id:'9'},null]){
  assert.equal((await reconcileRestaurantSaveFailure(new SyntaxError(),async()=>response)).state,'uncertain');
 }
});
