import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPrinterTestSlip,runPrinterSelfTest} from '../src/printer-self-test.js';

test('synthetic Epson slip is visually distinct from a real sale',()=>{
  const payload=buildPrinterTestSlip();
  assert.deepEqual([...payload.subarray(0,2)],[27,64]);
  const content=payload.toString('ascii');
  assert.match(content,/EPSON LAN TEST - NO SALE/);
  assert.match(content,/NOT AN INVOICE OR RECEIPT/);
  assert.match(content,/NO PAYMENT/);
  assert.doesNotMatch(content,/Receipt #|INR|GSTIN|TOTAL|Guest/i);
});
test('self-test fails closed without explicit confirmation or on nonprivate address',async()=>{
  let sends=0;
  const send=async()=>{sends++;};
  await assert.rejects(()=>runPrinterSelfTest({host:'127.0.0.1',send}),/explicit --confirm/);
  await assert.rejects(()=>runPrinterSelfTest({host:'8.8.8.8',confirm:true,send}),/private local network/);
  await assert.rejects(()=>runPrinterSelfTest({host:'127.0.0.1',port:0,confirm:true,send}),/Invalid printer port/);
  assert.equal(sends,0);
});
test('confirmed local test sends exactly one slip and never claims paper was printed',async()=>{
  const sent=[];
  const result=await runPrinterSelfTest({
    host:'127.0.0.1',port:9100,confirm:true,
    send:async(payload,address)=>{sent.push({payload,address});}
  });
  assert.equal(sent.length,1);
  assert.equal(sent[0].address.host,'127.0.0.1');
  assert.equal(sent[0].address.port,9100);
  assert.match(sent[0].payload.toString('ascii'),/TEST ONLY/);
  assert.equal(result.sent_unverified,true);
  assert.match(result.notice,/physically inspect/);
});
