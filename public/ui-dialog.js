/**
 * SHIZUKA shared confirmation surface for reversible draft/admin choices.
 * This is UI only: financial transactions continue to require server rules.
 */
export function createConfirmAction(dialog){
  if(!dialog||typeof dialog.showModal!=='function')
    throw new Error('Confirmation dialog unavailable');
  let pending=false;
  return ({title,detail,confirmLabel='Confirm',danger=false}={})=>{
    if(pending)return Promise.resolve(false);
    if(typeof title!=='string'||!title.trim()||typeof detail!=='string')
      return Promise.reject(new Error('Confirmation requires a title and explanation'));
    pending=true;
    const heading=dialog.querySelector('#shizuka-confirm-title');
    const description=dialog.querySelector('#shizuka-confirm-detail');
    const cancel=dialog.querySelector('#shizuka-confirm-cancel');
    const approve=dialog.querySelector('#shizuka-confirm-approve');
    const previous=dialog.ownerDocument.activeElement;
    heading.textContent=title;
    description.textContent=detail;
    approve.textContent=confirmLabel;
    approve.dataset.danger=String(Boolean(danger));
    return new Promise((resolve,reject)=>{
      let settled=false;
      function finish(accepted){
        if(settled)return;
        settled=true;pending=false;
        dialog.removeEventListener('cancel',onCancel);
        dialog.removeEventListener('close',onClose);
        approve.removeEventListener('click',onApprove);
        cancel.removeEventListener('click',onReject);
        if(dialog.open)dialog.close();
        if(previous?.isConnected&&typeof previous.focus==='function')
          previous.focus({preventScroll:true});
        resolve(accepted);
      }
      const onCancel=event=>{event.preventDefault();finish(false);};
      const onClose=()=>finish(false);
      const onApprove=()=>finish(true);
      const onReject=()=>finish(false);
      dialog.addEventListener('cancel',onCancel);
      dialog.addEventListener('close',onClose);
      approve.addEventListener('click',onApprove);
      cancel.addEventListener('click',onReject);
      try{dialog.showModal();cancel.focus({preventScroll:true});}
      catch(error){
        dialog.removeEventListener('cancel',onCancel);
        dialog.removeEventListener('close',onClose);
        approve.removeEventListener('click',onApprove);
        cancel.removeEventListener('click',onReject);
        pending=false;settled=true;reject(error);
      }
    });
  };
}
