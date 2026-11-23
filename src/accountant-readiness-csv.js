import {accountantReadiness} from './accountant-readiness.js';

// Owner-only review worksheet; NEVER a return, statutory tax invoice, or money total.
const HEADER=[
  'Record kind','Source ID','Review exception','Hotel/source date (as recorded)',
  'Date meaning','Required next action','Tax invoice legally issued','Export classification'
];
export function accountantCsvCell(input){
  let value=String(input??'');
  // Handle Excel/LibreOffice formula activation without changing source values.
  if(/^[=+\-@\t\r\n]/.test(value))value="'"+value;
  return '"'+value.replace(/"/g,'""')+'"';
}
export function accountantReadinessCsv(db){
  // Bounded source walk. Stop rather than pretending a partially listed review
  // package is complete; the interactive owner view is separately paged/capped.
  const result=accountantReadiness(db,{limit:15000});
  if(result.truncated)throw new Error(
    'Accountant exception export exceeds reviewed source limit; use saved source registers and approve a batched export');
  const rows=result.issues.map(issue=>[
    issue.source,issue.source_id??'',issue.code,issue.date_value,
    issue.date_semantics,issue.next_action,'NO','OWNER REVIEW ONLY - NOT GST APPROVED'
  ]);
  return '\uFEFF'+[HEADER,...rows].map(row=>row.map(accountantCsvCell).join(',')).join('\r\n')+'\r\n';
}
