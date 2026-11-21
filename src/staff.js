import {createPasswordRecord,verifyPassword} from './auth.js';
export const ROLES=['manager','frontdesk','cashier'];
export function ensureStaffSchema(db){
  db.exec(`
    CREATE TABLE IF NOT EXISTS staff_users(
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL COLLATE NOCASE UNIQUE,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN('manager','frontdesk','cashier')),
      password_json TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS owner_profile(
      id INTEGER PRIMARY KEY CHECK(id=1),
      display_name TEXT NOT NULL DEFAULT 'Owner'
    );
    INSERT OR IGNORE INTO owner_profile(id,display_name) VALUES(1,'Owner');
  `);
}
const safe=x=>({id:x.id,username:x.username,display_name:x.display_name,role:x.role,active:Boolean(x.active),created_at:x.created_at});
export function listStaff(db){
  return db.prepare('SELECT id,username,display_name,role,active,created_at FROM staff_users ORDER BY id').all().map(safe);
}
function validName(value,max){
  if(typeof value!=='string'||!value.trim()||value.trim().length>max)
    throw new Error('Name is required (maximum '+max+' characters)');
  return value.trim();
}
export function createStaff(db,input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Invalid staff details');
  const username=validName(input.username,32).toLowerCase();
  if(!/^[a-z][a-z0-9._-]{2,31}$/.test(username)||username==='owner')
    throw new Error('Username must be 3–32 characters and cannot be owner');
  const display_name=validName(input.display_name,90);
  if(!ROLES.includes(input.role))throw new Error('Invalid staff role');
  const record=createPasswordRecord(input.password);
  const created=db.prepare('INSERT INTO staff_users(username,display_name,role,password_json) VALUES(?,?,?,?)')
    .run(username,display_name,input.role,JSON.stringify(record));
  return safe(db.prepare('SELECT id,username,display_name,role,active,created_at FROM staff_users WHERE id=?').get(created.lastInsertRowid));
}
export function getStaffLogin(db,username,password){
  if(typeof username!=='string'||typeof password!=='string')return null;
  const row=db.prepare('SELECT * FROM staff_users WHERE username=? AND active=1').get(username.trim());
  if(!row)return null;
  let record;
  try{record=JSON.parse(row.password_json);}catch{return null;}
  return verifyPassword(password,record)?safe(row):null;
}
export function getStaffById(db,id){
  const row=db.prepare('SELECT id,username,display_name,role,active,created_at FROM staff_users WHERE id=?').get(id);
  return row?safe(row):null;
}
export function updateStaff(db,id,input){
  if(!Number.isSafeInteger(id)||id<1||!input||typeof input!=='object')throw new Error('Invalid staff update');
  const current=getStaffById(db,id);
  if(!current)throw new Error('Staff user not found');
  const role=input.role===undefined?current.role:input.role;
  if(!ROLES.includes(role))throw new Error('Invalid role');
  const active=input.active===undefined?current.active:input.active;
  if(typeof active!=='boolean')throw new Error('Active must be boolean');
  const name=input.display_name===undefined?current.display_name:validName(input.display_name,90);
  db.prepare('UPDATE staff_users SET display_name=?,role=?,active=? WHERE id=?').run(name,role,active?1:0,id);
  if(input.password!==undefined)
    db.prepare('UPDATE staff_users SET password_json=? WHERE id=?')
      .run(JSON.stringify(createPasswordRecord(input.password)),id);
  return getStaffById(db,id);
}
export function getOwnerProfile(db){
  return {id:0,username:'owner',role:'owner',active:true,
    display_name:db.prepare('SELECT display_name FROM owner_profile WHERE id=1').get().display_name};
}
export function updateOwnProfile(db,actor,name){
  name=validName(name,90);
  if(actor.id===0){
    db.prepare('UPDATE owner_profile SET display_name=? WHERE id=1').run(name);
    return getOwnerProfile(db);
  }
  db.prepare('UPDATE staff_users SET display_name=? WHERE id=? AND active=1').run(name,actor.id);
  return getStaffById(db,actor.id);
}
