const ROOT='https://api.github.com/repos/tchouhanjsm/fortledger';
const REQUIRED_JOBS=['browser','test (ubuntu-latest)','test (windows-latest)'];
const VALID_SHA=/^[a-f0-9]{40}$/i;

async function githubJson(url){
  const response=await fetch(url,{
    headers:{'Accept':'application/vnd.github+json','User-Agent':'FortLedger-local-update-check'},
    signal:AbortSignal.timeout(12000),cache:'no-store'
  });
  if(!response.ok)throw new Error('Unable to verify GitHub CI');
  return response.json();
}

/** Public, authenticated-by-GitHub-HTTPS CI evidence; never accept merely
 * a green PR head or success status belonging to another branch/commit. */
export async function approvedMainCommit(sha,{read=githubJson}={}){
  if(!VALID_SHA.test(sha))throw new Error('Invalid candidate update SHA');
  const list=await read(ROOT+'/actions/runs?head_sha='+sha+'&branch=main&event=push&per_page=20');
  const candidates=Array.isArray(list?.workflow_runs)?list.workflow_runs:[];
  const good=candidates.filter(run=>
    run?.head_sha?.toLowerCase()===sha.toLowerCase()&&
    run?.head_branch==='main'&&run?.event==='push'&&
    run?.status==='completed'&&run?.conclusion==='success'&&
    Number.isSafeInteger(run.id)&&run.id>0);
  for(const run of good){
    const detail=await read(ROOT+'/actions/runs/'+run.id+'/jobs?per_page=100');
    const jobs=Array.isArray(detail?.jobs)?detail.jobs:[];
    if(REQUIRED_JOBS.every(name=>jobs.some(job=>
      job.name===name&&job.status==='completed'&&job.conclusion==='success')))
      return {approved:true,sha:sha.toLowerCase(),run_id:run.id,
        run_url:'https://github.com/tchouhanjsm/fortledger/actions/runs/'+run.id};
  }
  return {approved:false,sha:sha.toLowerCase(),reason:
    'This exact GitHub main commit does not yet have successful Linux, Windows and Chromium CI.'};
}
