import {randomBytes,createHash,createHmac,scryptSync,timingSafeEqual} from 'node:crypto';
import {recordAudit} from './financial-audit.js';

// PINs are low entropy. A PIN is NEVER a replacement for the staff password:
// this local-only authenticator requires the registered device cookie and an
// owner-password-derived secret outside the SQLite file.
const DEVICE_COOKIE='fortledger_pin_device';
const BLOCK_MS=60*60*1000;
const PIN_SESSION_MS=2*60*60*1000;
export {PIN_SESSION_MS};
export function ensureStaffPinSchema(db){
  db.exec(`
    CREATE TABLE IF NOT EXISTS staff_pin_policy(
      id INTEGER PRIMARY KEY CHECK(id=1),
      enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1))
    );
    INSERT OR IGNORE INTO staff_pin_policy(id,enabled) VALUES(1,0);
    CREATE TABLE IF NOT EXISTS staff_pin_credentials(
      staff_id INTEGER NOT NULL REFERENCES staff_users(id),
      device_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      verifier TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY(staff_id,device_hash)
    );
    CREATE TABLE IF NOT EXISTS staff_pin_failures(
      staff_id INTEGER PRIMARY KEY REFERENCES staff_users(id),
      failures INTEGER NOT NULL DEFAULT 0,
      blocked_until INTEGER NOT NULL DEFAULT 0
    );
  `);
}
function cookieDevice(cookie){
  const raw=String(cookie||'').split(';').map(x=>x.trim())
    .find(x=>x.startsWith(DEVICE_COOKIE+'='))?.slice(DEVICE_COOKIE.length+1);
  return raw&&/^[a-f0-9]{64}$/.test(raw)?raw:null;
}
function deviceDigest(device){
  return createHash('sha256').update(device).digest('hex');
}
function validPin(pin){
  return typeof pin==='string'&&/^[0-9]{6}$/.test(pin);
}
function derive(staffId,device,pin,ownerHash){
  return createHmac('sha256',Buffer.from(ownerHash,'hex'))
    .update(String(staffId)+':'+device+':'+pin).digest();
}
function pinHash(staffId,device,pin,ownerHash,salt){
  return scryptSync(derive(staffId,device,pin,ownerHash),Buffer.from(salt,'hex'),64).toString('hex');
}
export function createStaffPinService(db,{getOwnerHash,localOnly}){
  const ownerHash=()=>getOwnerHash?.();
  const usable=()=>Boolean(localOnly()&&/^[a-f0-9]{128}$/.test(ownerHash()||''));
  const enabled=()=>Boolean(usable()&&db.prepare('SELECT enabled FROM staff_pin_policy WHERE id=1').get()?.enabled);
  function setEnabled(owner,enable){
    if(!usable()||owner?.role!=='owner'||typeof enable!=='boolean')
      throw new Error('Owner on this computer is required');
    return db.transaction(()=>{
      db.prepare('UPDATE staff_pin_policy SET enabled=? WHERE id=1').run(Number(enable));
      if(!enable){
        db.prepare('DELETE FROM staff_pin_credentials').run();
        db.prepare('DELETE FROM staff_pin_failures').run();
      }
      recordAudit(db,owner,enable?'staff_pin.enabled':'staff_pin.disabled','staff_pin_policy',1,{
        enabled:enable,cleared_credentials:!enable
      });
      return {enabled:enable};
    })();
  }
  function enroll(actor,pin,confirmation,existingDevice){
    if(!enabled())throw new Error('Staff quick PIN sign-in is not enabled on this computer');
    if(!actor||!['frontdesk','cashier'].includes(actor.role)||!Number.isSafeInteger(actor.id)||actor.id<1)
      throw new Error('Only front desk and cashier accounts may enroll a quick PIN');
    if(!validPin(pin)||pin!==confirmation)
      throw new Error('Enter and confirm the same six numeric digits');
    const device=cookieDevice(existingDevice)||randomBytes(32).toString('hex');
    const digest=deviceDigest(device);
    const salt=randomBytes(16).toString('hex');
    const verifier=pinHash(actor.id,device,pin,ownerHash(),salt);
    return db.transaction(()=>{
      db.prepare(`INSERT INTO staff_pin_credentials(staff_id,device_hash,salt,verifier)
        VALUES(?,?,?,?)
        ON CONFLICT(staff_id,device_hash) DO UPDATE SET
          salt=excluded.salt,verifier=excluded.verifier,created_at=datetime('now')`)
        .run(actor.id,digest,salt,verifier);
      db.prepare('DELETE FROM staff_pin_failures WHERE staff_id=?').run(actor.id);
      recordAudit(db,actor,'staff_pin.enrolled','staff_user',actor.id,{method:'trusted_local_device'});
      return {enrolled:true,device};
    })();
  }
  function check(username,pin,deviceCookie){
    if(!enabled()||!validPin(pin))return null;
    const device=cookieDevice(deviceCookie);
    if(!device)return null;
    const actor=db.prepare(`SELECT id,username,display_name,role,active FROM staff_users
      WHERE username=? COLLATE NOCASE AND active=1 AND role IN ('frontdesk','cashier')`)
      .get(String(username||'').trim());
    if(!actor)return null;
    const hashed=deviceDigest(device);
    const credential=db.prepare(`SELECT salt,verifier FROM staff_pin_credentials
      WHERE staff_id=? AND device_hash=?`).get(actor.id,hashed);
    if(!credential)return null;
    const attempts=db.prepare('SELECT failures,blocked_until FROM staff_pin_failures WHERE staff_id=?').get(actor.id);
    const now=Date.now();
    if(attempts?.blocked_until>now)return null;
    if(!/^[a-f0-9]{32}$/.test(credential.salt)||!/^[a-f0-9]{128}$/.test(credential.verifier))
      throw new Error('Stored PIN credential is malformed; use full password');
    const actual=pinHash(actor.id,device,pin,ownerHash(),credential.salt);
    const success=timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(credential.verifier,'hex'));
    if(success){
      db.prepare('DELETE FROM staff_pin_failures WHERE staff_id=?').run(actor.id);
      return actor;
    }
    const previous=attempts?.blocked_until&&attempts.blocked_until<=now?0:(attempts?.failures||0);
    const failures=previous+1,blocked_until=failures>=5?now+BLOCK_MS:0;
    db.prepare(`INSERT INTO staff_pin_failures(staff_id,failures,blocked_until)
      VALUES(?,?,?) ON CONFLICT(staff_id) DO UPDATE SET failures=excluded.failures,blocked_until=excluded.blocked_until`)
      .run(actor.id,failures,blocked_until);
    if(blocked_until)recordAudit(db,actor,'staff_pin.locked','staff_user',actor.id,{
      after_failed_attempts:5,blocked_minutes:60
    });
    return null;
  }
  function revoke(actor){
    if(!actor||!Number.isSafeInteger(actor.id)||actor.id<1)
      throw new Error('Staff account required');
    return db.transaction(()=>{
      const count=db.prepare('DELETE FROM staff_pin_credentials WHERE staff_id=?').run(actor.id).changes;
      db.prepare('DELETE FROM staff_pin_failures WHERE staff_id=?').run(actor.id);
      recordAudit(db,actor,'staff_pin.revoked','staff_user',actor.id,{device_count:count});
      return {revoked:true};
    })();
  }
  function enrolled(actor,cookie){
    const device=cookieDevice(cookie);
    if(!actor||!device||!enabled())return false;
    return Boolean(db.prepare('SELECT 1 FROM staff_pin_credentials WHERE staff_id=? AND device_hash=?')
      .get(actor.id,deviceDigest(device)));
  }
  function revokeStaffId(id){
    db.prepare('DELETE FROM staff_pin_credentials WHERE staff_id=?').run(id);
    db.prepare('DELETE FROM staff_pin_failures WHERE staff_id=?').run(id);
  }
  return {enabled,setEnabled,enroll,check,revoke,revokeStaffId,enrolled,deviceCookieName:DEVICE_COOKIE};
}
