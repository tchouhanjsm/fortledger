/** Owner-only, read-only update indication. A Git push is not a release;
 * packaged installs only advertise candidates with official successful CI and
 * an unexpired installer artifact; Git installs advertise a newer revision
 * that still needs a separate safe readiness/backup check. */
export function shouldShowOwnerUpdateNotice(update){
  if(!update||update.available!==true)return false;
  if(update.platform!=='windows')return false;
  return update.state==='installer_update_available'||update.state==='new_revision';
}

export function createOwnerUpdateNotice({check,show,hide,now=()=>Date.now(),
  minimumIntervalMs=6*60*60*1000}){
  if(typeof check!=='function'||typeof show!=='function'||typeof hide!=='function')
    throw new Error('Update notice needs a read-only checker and UI callbacks');
  let lastAttempt=-Infinity,inFlight=null;
  return {
    async refresh({owner=false,local=false,force=false}={}){
      if(!owner||!local){hide();return false;}
      const time=now();
      if(!force&&time-lastAttempt<minimumIntervalMs)return false;
      if(inFlight)return inFlight;
      lastAttempt=time;
      inFlight=(async()=>{
        try{
          const update=await check();
          if(shouldShowOwnerUpdateNotice(update)){
            show(update);
            return true;
          }
          hide();
          return false;
        }catch{hide();return false;}
        finally{inFlight=null;}
      })();
      return inFlight;
    },
    reset(){lastAttempt=-Infinity;hide();}
  };
}
