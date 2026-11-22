import fs from 'node:fs';
import path from 'node:path';

/** Evidence references are human assertions only. No uploaded guest records,
 * backups, passwords or certificate keys may be embedded in this manifest. */
export function evidenceTemplate(gates){
  return {schema_version:1,site:'Garh Jaisal',recorded_at:'',
    note:'Record proof references only; never embed passwords, guest names, receipts, bank details or backup contents.',
    gates:Object.fromEntries(gates.map(g=>[g.id,{
      result:'pending',performed_on:'',performed_by:'',reviewed_by:'',
      reference:'',notes:''
    }]))};
}
const ISO_DATE=/^\d{4}-\d{2}-\d{2}$/;
function validDay(value,now){
  if(typeof value!=='string'||!ISO_DATE.test(value))return false;
  const dt=new Date(value+'T00:00:00Z');
  return Number.isFinite(dt.getTime())&&dt.toISOString().slice(0,10)===value&&
    value<=now.toISOString().slice(0,10);
}
function nonempty(value,min,max){return typeof value==='string'&&value.trim().length>=min&&value.trim().length<=max;}
export function inspectEvidenceManifest(manifest,gates,{now=new Date()}={}){
  if(!manifest||typeof manifest!=='object'||Array.isArray(manifest)||manifest.schema_version!==1||
     manifest.site!=='Garh Jaisal'||!manifest.gates||typeof manifest.gates!=='object'||
     Array.isArray(manifest.gates))
    return {valid:false,issues:['Invalid or unsupported release evidence manifest'],entries:{}};
  const expected=new Set(gates.map(g=>g.id)),issues=[],entries={};
  for(const key of Object.keys(manifest.gates)){
    if(!expected.has(key))issues.push('Unknown gate ID: '+key);
  }
  for(const gate of gates){
    const item=manifest.gates[gate.id];
    if(!item||typeof item!=='object'||Array.isArray(item)){
      entries[gate.id]={status:'PENDING HUMAN VERIFICATION'};
      continue;
    }
    if(item.result!=='passed'){
      if(item.result!=='pending'&&item.result!=='failed')issues.push('Invalid result for '+gate.id);
      entries[gate.id]={status:item.result==='failed'?'FAILED ON-SITE CHECK':'PENDING HUMAN VERIFICATION'};
      continue;
    }
    const acceptable=validDay(item.performed_on,now)&&nonempty(item.performed_by,3,100)&&
      nonempty(item.reviewed_by,3,100)&&nonempty(item.reference,8,200)&&
      (!item.notes||nonempty(item.notes,0,500))&&
      item.performed_by.trim()!==item.reviewed_by.trim();
    if(!acceptable){
      issues.push('Incomplete, future-dated or unreviewed evidence for '+gate.id);
      entries[gate.id]={status:'PENDING HUMAN VERIFICATION'};
    }else{
      entries[gate.id]={status:'OPERATOR ATTESTED — NOT INDEPENDENTLY VERIFIED',
        performed_on:item.performed_on,reference:item.reference,
        performed_by:item.performed_by.trim(),reviewed_by:item.reviewed_by.trim()};
    }
  }
  return {valid:issues.length===0,issues,entries};
}
export function loadReleaseEvidence(file,gates,{now=new Date(),cwd=process.cwd()}={}){
  if(!file)return {configured:false,valid:true,issues:[],entries:{}};
  if(typeof file!=='string'||!path.isAbsolute(file))
    return {configured:true,valid:false,issues:['Evidence file path must be absolute'],entries:{}};
  const source=path.resolve(file),root=path.resolve(cwd);
  // Evidence stays off GitHub and outside the app source checkout.
  if(source===root||source.startsWith(root+path.sep))
    return {configured:true,valid:false,issues:['Keep release evidence outside the application source checkout'],entries:{}};
  try{
    const stat=fs.statSync(source);
    if(!stat.isFile()||stat.size>32768)throw new Error('Invalid evidence file');
    const result=inspectEvidenceManifest(JSON.parse(fs.readFileSync(source,'utf8')),gates,{now});
    return {...result,configured:true};
  }catch{
    return {configured:true,valid:false,issues:['Cannot read or validate release evidence file'],entries:{}};
  }
}
