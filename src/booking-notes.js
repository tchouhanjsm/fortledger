import {recordAudit} from './financial-audit.js';

/** Private operational details, deliberately separate from money and invoice snapshots. */
export function normalizeOperationalNotes(input){
  const note=(value,label,max)=>{
    if(value===undefined||value===null)return '';
    if(typeof value!=='string')throw new Error(label+' must be text');
    const text=value.trim().replace(/\r\n?/g,'\n');
    if(text.length>max)throw new Error(label+' must be '+max+' characters or less');
    if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text))
      throw new Error(label+' contains unsupported control characters');
    return text;
  };
  return {pickup_notes:note(input?.pickup_notes,'Pickup notes',500),
    stay_notes:note(input?.stay_notes,'Stay notes',1000)};
}

/** Deliberately usable after proforma issuance: no accommodation contract edits.
 * Log attribution and field-level changes, but do not duplicate guest notes in audit. */
export function updateOperationalNotes(db,id,input,actor){
  if(!Number.isSafeInteger(id)||id<1)throw new Error('Invalid booking ID');
  if(!actor?.username||!actor?.role)throw new Error('Authenticated staff required');
  if(!input||typeof input!=='object'||Array.isArray(input)||
     input.pickup_notes===undefined||input.stay_notes===undefined)
    throw new Error('Both note fields are required (blank is permitted)');
  const notes=normalizeOperationalNotes(input);
  return db.transaction(()=>{
    const existing=db.prepare('SELECT id,pickup_notes,stay_notes FROM bookings WHERE id=?').get(id);
    if(!existing)throw new Error('Booking not found');
    const changed=Object.keys(notes).filter(key=>existing[key]!==notes[key]);
    if(changed.length){
      db.prepare('UPDATE bookings SET pickup_notes=?,stay_notes=? WHERE id=?')
        .run(notes.pickup_notes,notes.stay_notes,id);
      recordAudit(db,actor,'booking.operational_notes.updated','booking',id,{
        fields:changed,
        previous_lengths:Object.fromEntries(changed.map(k=>[k,existing[k].length])),
        new_lengths:Object.fromEntries(changed.map(k=>[k,notes[k].length]))
      });
    }
    return {id,...notes,changed:changed.length>0};
  })();
}
