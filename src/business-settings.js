// Local operator-managed business details. Never store live credentials or secrets here.
export const FIELDS = {
  hotel_name:80, legal_name:160, address:500, gstin:15, phone:40, email:120,
  bank_name:120, account_holder:120, account_number:35, ifsc:11, upi_id:120
};
const defaults=Object.fromEntries(Object.keys(FIELDS).map(k=>[k,k==='hotel_name'?'Garh Jaisal':'']));

export function ensureBusinessSettings(db){
  db.exec(`CREATE TABLE IF NOT EXISTS business_settings (
    id INTEGER PRIMARY KEY CHECK(id=1),
    value TEXT NOT NULL
  )`);
  db.prepare('INSERT OR IGNORE INTO business_settings (id,value) VALUES(1,?)').run(JSON.stringify(defaults));
}
export function getBusinessSettings(db){
  const row=db.prepare('SELECT value FROM business_settings WHERE id=1').get();
  return {...defaults,...(row?JSON.parse(row.value):{})};
}
export function updateBusinessSettings(db,input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Invalid settings');
  const original=getBusinessSettings(db),updated={...original};
  for(const [key,value] of Object.entries(input)){
    if(!(key in FIELDS))throw new Error('Unknown settings field: '+key);
    if(typeof value!=='string'||value.length>FIELDS[key])throw new Error('Invalid or oversized value for '+key);
    updated[key]=value.trim();
  }
  if(!updated.hotel_name)throw new Error('Hotel name is required');
  if(updated.gstin&&!/^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]{3}$/.test(updated.gstin))
    throw new Error('Invalid GSTIN format');
  if(updated.ifsc&&!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(updated.ifsc))
    throw new Error('Invalid IFSC format');
  if(updated.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updated.email))
    throw new Error('Invalid email address');
  db.prepare('UPDATE business_settings SET value=? WHERE id=1').run(JSON.stringify(updated));
  return updated;
}
