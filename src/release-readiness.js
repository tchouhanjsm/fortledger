import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {diagnose} from './doctor.js';
import {loadReleaseEvidence,evidenceTemplate} from './release-evidence.js';

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
  {id:'staff_lan_security',label:'Hotel LAN HTTPS and restricted authenticated phone access',
   owner:'Hotel owner / network technician',
   evidence:'Actual PC and phone TLS trust, individual staff accounts, restricted local firewall subnet, denied outside-LAN access, no public port forwarding and revoke-device test'},
  {id:'frontdesk_device_qa',label:'Hotel staff device and accessibility walkthrough',
   owner:'Reception manager',
   evidence:'Seven-room reception, cash and restaurant journey tested on actual Mac or supported hotel computer, phone and keyboard at zoom'},
  {id:'offsite_backup_isolation',label:'Independent encrypted backup storage and secrets',
   owner:'Hotel owner',
   evidence:'Off-device copy and separately managed passphrase verified with documented access and retention'}
]);
export function releaseReadiness({diagnostics=diagnose(),
  evidenceFile=process.env.FORTLEDGER_RELEASE_EVIDENCE_FILE,now=new Date()}={}){
  const issues=diagnostics.checks.filter(x=>x.status!=='pass');
  const evidence=loadReleaseEvidence(evidenceFile,PHYSICAL_RELEASE_GATES,{now});
  const attested=Object.values(evidence.entries).filter(e=>e.status?.startsWith('OPERATOR ATTESTED')).length;
  return {
    verdict:'NOT RELEASED',
    production_ready:false,
    automated:{passed:diagnostics.summary.passed,failed:diagnostics.summary.failed,
      warnings:diagnostics.summary.warnings,
      note:'Local diagnostics verify only checks observable by this process'},
    physical_gates:PHYSICAL_RELEASE_GATES.map(g=>({...g,...(evidence.entries[g.id]||{
      status:'PENDING HUMAN VERIFICATION'})})),
    evidence:{configured:evidence.configured,valid:evidence.valid,attested,
      total:PHYSICAL_RELEASE_GATES.length,issues:evidence.issues,
      note:'Evidence is a human assertion, not independently authenticated by this process'},
    next_step:evidence.valid&&attested===PHYSICAL_RELEASE_GATES.length&&issues.length===0?
      'All local evidence references recorded — independent owner release review and GST issuance approval still required':
      'Resolve diagnostics and complete independently reviewed physical and GST evidence',
    blocking_items:issues.map(({name,status,detail})=>({name,status,detail})),
    disclaimer:'No CI run, evidence checklist or this command can certify physical Epson output, a physical replacement-device restore, or statutory tax compliance'
  };
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.includes('--template')){
    console.log(JSON.stringify(evidenceTemplate(PHYSICAL_RELEASE_GATES),null,2));
    process.exit(0);
  }
  const report=releaseReadiness();
  if(process.argv.includes('--json'))console.log(JSON.stringify(report,null,2));
  else{
    console.log('FORTLEDGER RELEASE STATUS:',report.verdict);
    console.log('Machine checks:',report.automated.passed,'passed,',
      report.automated.failed,'failed,',report.automated.warnings,'warnings');
    for(const gate of report.physical_gates)
      console.log('['+gate.status+'] '+gate.label+' — '+gate.owner);
    console.log('Evidence references:',report.evidence.attested+'/'+report.evidence.total);
    for(const issue of report.evidence.issues)console.log('[EVIDENCE ISSUE] '+issue);
    console.log('Next:',report.next_step);
    for(const item of report.blocking_items)
      console.log('['+item.status.toUpperCase()+'] '+item.name+': '+item.detail);
    console.log(report.disclaimer);
  }
  // Exit nonzero until independent physical and accountant release gates are
  // actually completed; intentionally no self-certifying CLI flag.
  process.exitCode=1;
}
