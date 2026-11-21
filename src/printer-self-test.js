import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {sendToPrinter,validatePrinterAddress} from './printer.js';

/** Distinct test slip: no saved bill, payment record or legal invoice created. */
export function buildPrinterTestSlip(){
  const lines=[
    'GARH JAISAL',
    'EPSON LAN TEST - NO SALE',
    'NOT AN INVOICE OR RECEIPT',
    '--------------------------',
    'If this paper printed,',
    'verify legibility and width.',
    'TCP success alone is not proof.',
    '--------------------------',
    'TEST ONLY - NO PAYMENT',
    '',
    '',
    ''
  ];
  return Buffer.concat([Buffer.from([0x1b,0x40]),Buffer.from(lines.join('\n'),'ascii')]);
}
export async function runPrinterSelfTest({host,port=9100,confirm=false,send=sendToPrinter}={}){
  if(confirm!==true)throw new Error('Printer test requires explicit --confirm; paper may print');
  const address=validatePrinterAddress(host,port);
  await send(buildPrinterTestSlip(),address);
  return {sent_unverified:true,notice:'Test bytes sent; physically inspect the Epson paper. NO SALE or invoice was recorded.'};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [,,hostArg,portArg,flag]=process.argv;
  const host=hostArg||process.env.FORTLEDGER_PRINTER_HOST;
  const port=portArg==='--confirm'?9100:Number(portArg||process.env.FORTLEDGER_PRINTER_PORT||9100);
  const confirm=flag==='--confirm'||portArg==='--confirm';
  try{
    const outcome=await runPrinterSelfTest({host,port,confirm});
    console.log(outcome.notice);
    console.log('Still pending: physical receipt inspection, outage test and staff sign-off.');
  }catch(error){
    console.error('Printer test FAILED or not requested:',error.message);
    process.exitCode=1;
  }
}
