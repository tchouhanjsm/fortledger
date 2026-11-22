/** Route + focus as a single operator action.
 * Hashchange re-renders views and normally resets scroll to top. Defer the
 * target focus/scroll until AFTER the requested workspace becomes visible. */
export function createWorkspaceNavigator({win,doc,render,views,canVisit=()=>true}){
  if(!win||!doc||typeof render!=='function'||!views)throw new Error('Workspace navigator dependencies required');
  let pending=null;
  const valid=view=>Object.hasOwn(views,view);
  function navigate(view,targetId=null){
    if(!valid(view))throw new Error('Unknown workspace destination');
    if(!canVisit(view))return false;
    if(targetId!==null&&(typeof targetId!=='string'||!/^[a-z][a-z0-9-]{0,79}$/.test(targetId)))
      throw new Error('Invalid workspace target');
    pending={view,targetId};
    if(win.location.hash!=='#'+view)win.location.hash='#'+view;
    else render(); // Same-route clicks do not emit a hashchange event.
    return true;
  }
  function afterRender(shownView){
    if(!pending)return false;
    const task=pending;pending=null;
    if(task.view!==shownView||!task.targetId)return false;
    const el=doc.getElementById(task.targetId);
    if(!el||el.hidden||el.closest('[hidden]'))return false;
    // Focus is essential to bring a keyboard user's position along with scroll.
    if(!el.hasAttribute('tabindex'))el.setAttribute('tabindex','-1');
    el.focus({preventScroll:true});
    el.scrollIntoView({block:'start'});
    return true;
  }
  return {navigate,afterRender};
}
