/** Public shape for a local owner, never raw release evidence or backup paths.
 * A CI pass, attached proof, or this view can NEVER authorize a release. */
export function summarizeReleaseReadiness(report){
  if(!report||report.verdict!=='NOT RELEASED'||report.production_ready!==false||
     !Array.isArray(report.physical_gates)||!report.automated||!report.evidence)
    throw new Error('Release status unavailable; do not assume the hotel is ready');
  const allowed=new Set(['PENDING HUMAN VERIFICATION','FAILED ON-SITE CHECK',
    'OPERATOR ATTESTED — NOT INDEPENDENTLY VERIFIED']);
  const gates=report.physical_gates.map(gate=>{
    if(typeof gate.id!=='string'||typeof gate.label!=='string')throw new Error('Invalid release gate');
    return {id:gate.id,label:gate.label,
      status:allowed.has(gate.status)?gate.status:'PENDING HUMAN VERIFICATION'};
  });
  const cleanCount=(value)=>Number.isSafeInteger(value)&&value>=0?value:0;
  return {
    verdict:'NOT RELEASED',production_ready:false,
    full_machine_diagnostics_performed:report.automated.full_diagnostics===true,
    machine_checks:{
      passed:cleanCount(report.automated.passed),
      failed:cleanCount(report.automated.failed),
      warnings:cleanCount(report.automated.warnings)
    },
    evidence:{attested:cleanCount(report.evidence.attested),total:gates.length,
      valid:report.evidence.valid===true},
    gates,blocking_checks:Array.isArray(report.blocking_items)?
      report.blocking_items.slice(0,30).map(check=>({
        name:typeof check.name==='string'?check.name.slice(0,90):'Diagnostic issue',
        status:['warn','fail'].includes(check.status)?check.status:'warn'
      })):[],
    notice:'Engineering alpha — never issue statutory tax invoices or enable live release on the strength of this view. Actual replacement-device restore, printer paper, authenticated hotel LAN and accountant approval need independent on-site proof.'
  };
}
