import {recordAudit} from './financial-audit.js';

/** Optional seating labels only; no open orders, table occupancy or kitchen POS. */
export function ensureRestaurantTablesSchema(db){
  db.exec(`
    CREATE TABLE IF NOT EXISTS restaurant_tables (
      id INTEGER PRIMARY KEY,
      label TEXT NOT NULL COLLATE NOCASE UNIQUE,
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS restaurant_bill_tables (
      bill_id INTEGER PRIMARY KEY REFERENCES restaurant_bills(id),
      table_id INTEGER NOT NULL REFERENCES restaurant_tables(id),
      table_label TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}
function manager(actor){
  if(!actor||!['owner','manager'].includes(actor.role))
    throw new Error('Only owner or manager can configure restaurant tables');
}
function validLabel(raw){
  if(typeof raw!=='string')throw new Error('Dining table label is required');
  const value=raw.normalize('NFKC').trim().replace(/\s+/g,' ');
  if(!/^[\p{L}\p{N}][\p{L}\p{N} ._/-]{0,29}$/u.test(value))
    throw new Error('Table name must be 1–30 letters/numbers, spaces, dots, underscores, / or -');
  return value;
}
export function listRestaurantTables(db,{includeInactive=false}={}){
  return db.prepare('SELECT id,label,active FROM restaurant_tables '+
    (includeInactive?'':'WHERE active=1 ')+'ORDER BY id').all();
}
export function createRestaurantTable(db,{label}={},actor){
  manager(actor);
  const name=validLabel(label);
  return db.transaction(()=>{
    const result=db.prepare('INSERT INTO restaurant_tables(label) VALUES(?)').run(name);
    const table={id:Number(result.lastInsertRowid),label:name,active:1};
    recordAudit(db,actor,'restaurant_table.created','restaurant_table',table.id,{label:name});
    return table;
  })();
}
export function changeRestaurantTable(db,id,{active,expected_active}={},actor){
  manager(actor);
  if(!Number.isSafeInteger(id)||id<1)throw new Error('Invalid restaurant table');
  if(typeof active!=='boolean'||typeof expected_active!=='boolean')
    throw new Error('Current and new restaurant table visibility are required');
  return db.transaction(()=>{
    const row=db.prepare('SELECT id,label,active FROM restaurant_tables WHERE id=?').get(id);
    if(!row)throw new Error('Restaurant table not found');
    if(Boolean(row.active)!==expected_active)
      throw new Error('Restaurant table visibility changed since review; refresh before saving');
    if(Boolean(row.active)!==active){
      db.prepare('UPDATE restaurant_tables SET active=? WHERE id=?').run(Number(active),id);
      recordAudit(db,actor,active?'restaurant_table.enabled':'restaurant_table.disabled',
        'restaurant_table',id,{label:row.label,previous_active:expected_active,active});
    }
    return {...row,active:Number(active)};
  })();
}
/** Called inside the restaurant financial transaction. */
export function saveBillTableSnapshot(db,billId,tableId){
  if(tableId===undefined||tableId===null||tableId==='')return null;
  if(!Number.isSafeInteger(tableId)||tableId<1)
    throw new Error('Choose a valid dining table');
  const table=db.prepare('SELECT id,label FROM restaurant_tables WHERE id=? AND active=1').get(tableId);
  if(!table)throw new Error('Dining table is no longer available; refresh and review the bill');
  db.prepare('INSERT INTO restaurant_bill_tables(bill_id,table_id,table_label) VALUES(?,?,?)')
    .run(billId,table.id,table.label);
  return {table_id:table.id,table_label:table.label};
}
