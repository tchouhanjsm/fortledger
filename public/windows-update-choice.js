// Presentation only: the update supervisor and encrypted-backup/readiness
// checks are the sole authorities for update eligibility. Never infer
// safe in-place patchability merely from an installer download URL.
const SHA=/^[a-f0-9]{40}$/i;
const OFFICIAL_ARTIFACT=/^https:\/\/github\.com\/tchouhanjsm\/fortledger\/actions\/runs\/[0-9]+\/artifacts\/[0-9]+$/;
export function chooseWindowsUpdateAction(state,readiness){
  const source=state?.platform==='windows'&&
    state.state==='source_update_available'&&state.available===true&&
    SHA.test(state.target_sha||'');
  const candidate=state?.platform==='windows'&&
    state.state==='installer_update_available'&&state.available===true&&
    OFFICIAL_ARTIFACT.test(state.download_url||'');
  const readyTarget=readiness?.ready===true&&readiness.update_mode==='code_only'&&
    SHA.test(readiness.target_sha||'');
  const sameTarget=SHA.test(state?.target_sha||'')&&readyTarget&&
    state.target_sha.toLowerCase()===readiness.target_sha.toLowerCase();
  const changed=Boolean((source||candidate)&&readyTarget&&!sameTarget);
  const inPlace=Boolean((source||candidate)&&sameTarget);
  return {
    in_place_ready:inPlace,
    show_verified_installer:Boolean(candidate&&!inPlace&&!changed),
    show_in_place:inPlace,
    guidance:changed?
      'The available update changed during verification. Check for updates again before applying or downloading it.':
      inPlace?
      'Apply the CI-approved source-only update and restart. No installer download or startup verification gate is needed; a clean transaction drain and recoverable backup remain mandatory.':
      source?
      'Local source update is not ready. Review the safety blockers. A compatible code patch requires no installer.':
      candidate?
      'Code-only update is not ready for this installed Windows build. Review the listed reasons below. Do not repeatedly download or run the installer while the application is open. A one-time V7 bootstrap or a native-component upgrade may require a verified installer.':
      'No newer verified Windows installer candidate is available. Existing hotel records are unchanged.'
  };
}
