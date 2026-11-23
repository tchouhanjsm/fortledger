import {recordAudit} from './financial-audit.js';
import {createHash} from 'node:crypto';

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

// Bulk setup is explicit operator-reviewed configuration, not inferred physical seating.
// Never rename, reactivate or delete a table, and never alter a historical receipt.
function normalizeSetupNames(labels){
  if(!Array.isArray(labels)||labels.length<1||labels.length>30)
    throw new Error('Provide 1–30 physical dining table names');
  const seen=new Set();
  return labels.map(raw=>{
    const name=validLabel(raw);
    const key=name.toLocaleLowerCase();
    if(seen.has(key))throw new Error('Repeated dining table name in setup: '+name);
    seen.add(key);
    return name;
  });
}
function tableSetupPlan(db,labels){
  const rows=db.prepare('SELECT id,label,active FROM restaurant_tables ORDER BY id').all();
  const byName=new Map(rows.map(row=>[row.label.toLocaleLowerCase(),row]));
  const to_create=[],already_active=[],already_hidden=[];
  for(const label of labels){
    const prior=byName.get(label.toLocaleLowerCase());
    if(!prior)to_create.push(label);
    else (prior.active?already_active:already_hidden).push({id:prior.id,label:prior.label});
  }
  const review_token=createHash('sha256').update(JSON.stringify({labels,rows})).digest('hex');
  return {requested:labels.length,to_create,already_active,already_hidden,review_token,
    existing_labels_preserved:true,saved_bills_changed:false};
}
export function previewRestaurantTableSetup(db,{labels}={},actor){
  manager(actor);
  return tableSetupPlan(db,normalizeSetupNames(labels));
}
export function applyRestaurantTableSetup(db,{labels,review_token}={},actor){
  manager(actor);
  const names=normalizeSetupNames(labels);
  if(typeof review_token!=='string'||!/^[a-f0-9]{64}$/.test(review_token))
    throw new Error('Review table setup before creating names');
  return db.transaction(()=>{
    const plan=tableSetupPlan(db,names);
    if(plan.review_token!==review_token)
      throw new Error('Restaurant table setup changed since preview; refresh and review again');
    const insert=db.prepare('INSERT INTO restaurant_tables(label) VALUES(?)');
    const created=[];
    for(const label of plan.to_create){
      const result=insert.run(label);
      const table={id:Number(result.lastInsertRowid),label,active:1};
      recordAudit(db,actor,'restaurant_table.created','restaurant_table',table.id,{
        label,source:'reviewed_bulk_setup'
      });
      created.push(table);
    }
    return {created,already_active:plan.already_active,already_hidden:plan.already_hidden,
      existing_labels_preserved:true,saved_bills_changed:false};
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
