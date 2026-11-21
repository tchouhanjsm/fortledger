import {recordAudit} from './financial-audit.js';

export function ensureGuestSchema(db){
  db.exec(`
    CREATE TABLE IF NOT EXISTS guest_profiles(
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      company_name TEXT NOT NULL DEFAULT '',
      preferences TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_guest_profiles_name ON guest_profiles(name COLLATE NOCASE);
  `);
  const columns=new Set(db.pragma('table_info(bookings)').map(x=>x.name));
  if(!columns.has('guest_id'))
    db.exec('ALTER TABLE bookings ADD COLUMN guest_id INTEGER REFERENCES guest_profiles(id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_bookings_guest_profile ON bookings(guest_id)');
}
function clean(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Invalid guest details');
  const name=typeof input.name==='string'?input.name.trim():'',
    phone=typeof input.phone==='string'?input.phone.trim():'',
    email=typeof input.email==='string'?input.email.trim().toLowerCase():'',
    company_name=typeof input.company_name==='string'?input.company_name.trim():'',
    preferences=typeof input.preferences==='string'?input.preferences.trim():'';
  if(!name||name.length>150)throw new Error('Guest name required (max 150)');
  if(phone.length>30||phone&&!/^[+\d\s()\-]{6,30}$/.test(phone))
    throw new Error('Invalid contact number');
  if(email.length>180||email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error('Invalid email address');
  if(company_name.length>150||preferences.length>500)
    throw new Error('Company or preference note exceeds limit');
  return {name,phone,email,company_name,preferences};
}
export function saveGuest(db,input,actor,id=null){
  if(!actor)throw new Error('Authenticated staff required');
  const guest=clean(input);
  return db.transaction(()=>{
    let target=id;
    if(id!==null){
      if(!Number.isSafeInteger(id)||id<1||!db.prepare('SELECT 1 FROM guest_profiles WHERE id=?').get(id))
        throw new Error('Guest profile not found');
      db.prepare(`UPDATE guest_profiles SET name=@name,phone=@phone,email=@email,
        company_name=@company_name,preferences=@preferences,updated_at=datetime('now')
        WHERE id=@id`).run({...guest,id});
      recordAudit(db,actor,'guest.updated','guest',id,{fields:Object.keys(guest)});
    }else{
      const saved=db.prepare(`INSERT INTO guest_profiles
        (name,phone,email,company_name,preferences)
        VALUES(@name,@phone,@email,@company_name,@preferences)`).run(guest);
      target=Number(saved.lastInsertRowid);
      recordAudit(db,actor,'guest.created','guest',target,{});
    }
    return db.prepare('SELECT * FROM guest_profiles WHERE id=?').get(target);
  })();
}
export function listGuests(db,q=''){
  if(typeof q!=='string'||q.length>100)throw new Error('Invalid guest search');
  const term=q.trim().toLowerCase();
  const guests=db.prepare(`SELECT g.id,g.name,g.phone,g.email,g.company_name,g.preferences,
    COUNT(b.id) AS stay_count,MAX(b.checkout) AS last_checkout
    FROM guest_profiles g LEFT JOIN bookings b ON b.guest_id=g.id
    WHERE (?='' OR instr(lower(g.name),?)>0 OR instr(lower(g.phone),?)>0
       OR instr(lower(g.email),?)>0 OR instr(lower(g.company_name),?)>0)
    GROUP BY g.id ORDER BY g.name COLLATE NOCASE,g.id LIMIT 50`)
    .all(term,term,term,term,term);
  return guests;
}
export function guestStays(db,id){
  if(!Number.isSafeInteger(id)||id<1)throw new Error('Invalid guest ID');
  const guest=db.prepare('SELECT * FROM guest_profiles WHERE id=?').get(id);
  if(!guest)throw new Error('Guest profile not found');
  const stays=db.prepare(`SELECT id,guest_name,company_name,checkin,checkout,rooms_count,
    category,meal_plan,nightly_rate_paise,status FROM bookings
    WHERE guest_id=? ORDER BY checkin DESC,id DESC LIMIT 100`).all(id);
  return {guest,stays};
}
export function validateGuestLink(db,guestId){
  if(guestId===null)return null;
  if(!Number.isSafeInteger(guestId)||guestId<1||
    !db.prepare('SELECT 1 FROM guest_profiles WHERE id=?').get(guestId))
    throw new Error('Selected guest profile not found');
  return guestId;
}
