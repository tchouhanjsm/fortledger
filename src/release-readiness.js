import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {diagnose} from './doctor.js';

/** Machine-verifiable evidence must not be conflated with operator certifications. */
export const PHYSICAL_RELEASE_GATES=Object.freeze([
  {id:'replacement_device_restore',label:'Replacement-device restoration (macOS or supported OS)',
   owner:'Hotel owner / local technician',
   evidence:'Fresh replacement computer restored from independent encrypted backup; staff credentials and seven room records confirmed'},
  {id:'epson_paper_output',label:'Epson TM-T82 physical receipt output',
   owner:'Restaurant cashier / local technician',
   evidence:'Real paper receipt inspected, network loss reproduced and uncertain reprint verified'},
  {id:'gst_accountant_signoff',label:'Final GST invoice compliance',
   owner:'Hotel accountant / authorised tax professional',
   evidence:'Written review of actual supplier GSTIN, rate matrix, numbering, SAC, place-of-supply, PDF and credit-note handling'},
  {id:'staff_lan_security',label:'Private staff-LAN HTTPS and guest-network isolation',
   owner:'Hotel owner / network technician',
   evidence:'Actual Mac and phone TLS trust, staff firewall rules, guest-Wi-Fi access denied, no public port forwarding and revoke-device test'},
  {id:'frontdesk_device_qa',label:'Hotel staff device and accessibility walkthrough',
   owner:'Reception manager',
   evidence:'Seven-room reception, cash and restaurant journey tested on actual Mac or supported hotel computer, phone and keyboard at zoom'},
  {id:'offsite_backup_isolation',label:'Independent encrypted backup storage and secrets',
   owner:'Hotel owner',
   evidence:'Off-device copy and separately managed passphrase verified with documented access and retention'}
]);
export function releaseReadiness({diagnostics=diagnose()}={}){
  const issues=diagnostics.checks.filter(x=>x.status!=='pass');
  return {
    verdict:'NOT RELEASED',
    production_ready:false,
    automated:{passed:diagnostics.summary.passed,failed:diagnostics.summary.failed,
      warnings:diagnostics.summary.warnings,
      note:'Local diagnostics verify only checks observable by this process'},
    physical_gates:PHYSICAL_RELEASE_GATES.map(g=>({...g,status:'PENDING HUMAN VERIFICATION'})),
    blocking_items:issues.map(({name,status,detail})=>({name,status,detail})),
    disclaimer:'No CI run, evidence checklist or this command can certify physical Epson output, a physical replacement-device restore, or statutory tax compliance'
  };
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const report=releaseReadiness();
  if(process.argv.includes('--json'))console.log(JSON.stringify(report,null,2));
  else{
    console.log('FORTLEDGER RELEASE STATUS:',report.verdict);
    console.log('Machine checks:',report.automated.passed,'passed,',
      report.automated.failed,'failed,',report.automated.warnings,'warnings');
    for(const gate of report.physical_gates)
      console.log('[PENDING] '+gate.label+' — '+gate.owner);
    for(const item of report.blocking_items)
      console.log('['+item.status.toUpperCase()+'] '+item.name+': '+item.detail);
    console.log(report.disclaimer);
  }
  // Exit nonzero until independent physical and accountant release gates are
  // actually completed; intentionally no self-certifying CLI flag.
  process.exitCode=1;
}
