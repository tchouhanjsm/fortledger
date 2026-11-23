// Presentation only: the update supervisor and encrypted-backup/readiness
// checks are the sole authorities for update eligibility. Never infer
// safe in-place patchability merely from an installer download URL.
const SHA=/^[a-f0-9]{40}$/i;
const OFFICIAL_ARTIFACT=/^https:\/\/github\.com\/tchouhanjsm\/fortledger\/actions\/runs\/[0-9]+\/artifacts\/[0-9]+$/;
export function chooseWindowsUpdateAction(state,readiness){
  const candidate=state?.platform==='windows'&&
    state.state==='installer_update_available'&&state.available===true&&
    OFFICIAL_ARTIFACT.test(state.download_url||'');
  const inPlace=Boolean(candidate&&readiness?.ready===true&&
    readiness.update_mode==='code_only'&&SHA.test(readiness.target_sha||''));
  return {
    in_place_ready:inPlace,
    show_verified_installer:Boolean(candidate&&!inPlace),
    show_in_place:inPlace,
    guidance:inPlace?
      'Preferred: apply the verified code-only update and restart. No installer download or reinstall is needed. The separate backup and local supervisor have passed readiness checks.':
      candidate?
      'Code-only update is not ready for this installed Windows build. Review the listed reasons below. Do not repeatedly download or run the installer while the application is open. A one-time V7 bootstrap or a native-component upgrade may require a verified installer.':
      'No newer verified Windows installer candidate is available. Existing hotel records are unchanged.'
  };
}
