import Database from 'better-sqlite3';
import {ensureEntityIdSchema} from './entity-identity.js';
import fs from 'node:fs';
import path from 'node:path';
import {databasePath} from './data-paths.js';
import { ensureInvoiceSchema } from './invoice-schema.js';
import { ensureBusinessSettings } from './business-settings.js';
import { ensureRestaurantSchema } from './restaurant.js';
import { ensureRefundSchema } from './payment-ledger.js';
import {ensureTaxDraftSchema} from './tax-draft.js';
import {ensureLogoSchema} from './hotel-logo.js';
import {ensureStaffSchema} from './staff.js';
import {ensureFinancialAuditSchema} from './financial-audit.js';
import {ensureExpenseSchema} from './expenses.js';
import {ensureHousekeepingSchema} from './housekeeping.js';
import {ensureDailyCloseSchema} from './daily-close.js';
import {ensureMaintenanceSchema,blockedRoomIds} from './maintenance.js';
import {ensureGuestSchema} from './guests.js';
import {ensureBookingCreateSchema} from './booking-create.js';
import {ensureFolioSettlementRequestSchema} from './folio.js';

export function openDatabase(filename = databasePath()) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new Database(filename);
  try {
    db.pragma('foreign_keys = ON');
    const current = db.pragma('user_version', {simple:true});
    if(current > 10)throw new Error('Database schema '+current+' is newer than this FortLedger version (10); update the app before opening it');
    if(current < 0)throw new Error('Invalid database schema version');
    // Version 0 includes all legacy pre-versioned FortLedger installations.
    // A single SQLite transaction makes the baseline upgrade all-or-nothing.
    if(current === 0)db.transaction(()=>{
  db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL DEFAULT 'Unassigned',
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
    );
    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY,
      guest_name TEXT NOT NULL,
      company_name TEXT NOT NULL DEFAULT '',
      checkin TEXT NOT NULL,
      checkout TEXT NOT NULL,
      rooms_count INTEGER NOT NULL CHECK(rooms_count > 0),
      room_id INTEGER REFERENCES rooms(id),
      category TEXT NOT NULL DEFAULT 'Unassigned',
      meal_plan TEXT NOT NULL DEFAULT 'CP',
      nightly_rate_paise INTEGER NOT NULL CHECK(nightly_rate_paise >= 0),
      status TEXT NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','checked_in','checked_out','cancelled')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY,
      booking_id INTEGER NOT NULL REFERENCES bookings(id),
      amount_paise INTEGER NOT NULL CHECK(amount_paise > 0),
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_bookings_dates ON bookings(checkin,checkout,status);
    CREATE INDEX IF NOT EXISTS idx_bookings_guest ON bookings(guest_name);
    CREATE INDEX IF NOT EXISTS idx_payments_booking ON payments(booking_id);
    CREATE TABLE IF NOT EXISTS booking_room_allocations (
      booking_id INTEGER NOT NULL REFERENCES bookings(id),
      room_id INTEGER NOT NULL REFERENCES rooms(id),
      PRIMARY KEY (booking_id,room_id)
    );
    CREATE INDEX IF NOT EXISTS idx_booking_room_allocations_room ON booking_room_allocations(room_id);
  `);
  db.exec('INSERT OR IGNORE INTO booking_room_allocations(booking_id,room_id) SELECT id,room_id FROM bookings WHERE room_id IS NOT NULL');
  ensureInvoiceSchema(db);
  ensureTaxDraftSchema(db);
  ensureLogoSchema(db);
  ensureStaffSchema(db);
  ensureBusinessSettings(db);
  ensureRestaurantSchema(db);
  ensureRefundSchema(db);
  ensureFinancialAuditSchema(db);
  if (db.prepare('SELECT count(*) AS count FROM rooms').get().count === 0) {
    const add = db.prepare('INSERT INTO rooms (name) VALUES (?)');
    for (let i = 1; i <= 7; i++) add.run('Room ' + i);
  }
  const violations=db.pragma('foreign_key_check');
  if(violations.length)throw new Error('Database has foreign key violations; no schema upgrade was applied');
  db.pragma('user_version = 1');
    })();
    // Version 2: expenses are additive; existing bookings/invoices/payments stay untouched.
    if(current<2)db.transaction(()=>{
      ensureExpenseSchema(db);
      db.pragma('user_version = 2');
    })();
    // Version 3: physical-room housekeeping status (additive; no guest data changed).
    if(current<3)db.transaction(()=>{
      ensureHousekeepingSchema(db);
      db.pragma('user_version = 3');
    })();
    // Version 4: immutable human-reviewed daily close snapshots.
    if(current<4)db.transaction(()=>{
      ensureDailyCloseSchema(db);
      db.pragma('user_version = 4');
    })();
    // Version 5: additive maintenance issue log and date-scoped room outages.
    if(current<5)db.transaction(()=>{
      ensureMaintenanceSchema(db);
      db.pragma('user_version = 5');
    })();
    // Version 6: guest CRM and nullable explicit booking links; no historic auto-link.
    if(current<6)db.transaction(()=>{
      ensureGuestSchema(db);
      db.pragma('user_version = 6');
    })();
    // Version 7: immutable request ledger for retry-safe booking creation and initial advance.
    if(current<7)db.transaction(()=>{
      ensureBookingCreateSchema(db);
      db.pragma('user_version = 7');
    })();
    // Version 8: Existing schema-v7 hotel installations did not rerun the
    // restaurant schema initializer after retry-safe bill requests were added.
    // Upgrade transactionally: preserve historical bills and their IDs, create
    // only missing restaurant support objects, and publish v8 last.
    if(current<8)db.transaction(()=>{
      ensureRestaurantSchema(db);
      // IF NOT EXISTS alone cannot detect a malformed pre-existing table.
      // Compile all columns used by the idempotent bill read/write paths before
      // marking this database compatible with the current application.
      try{
        db.prepare('SELECT request_id,bill_id,fingerprint,response_json,created_at FROM restaurant_bill_requests LIMIT 0').all();
      }catch{
        throw new Error('Incompatible restaurant bill request schema; no migration applied. Inspect database with npm run doctor and restore a verified backup if necessary');
      }
      const violations=db.pragma('foreign_key_check');
      if(violations.length)throw new Error('Database has foreign key violations; restaurant schema upgrade was not applied');
      db.pragma('user_version = 8');
    })();
    // Version 9: additive allocation counters and guards prevent rowid reuse
    // from mixing deleted guest/booking audit identities with new entities.
    // Existing booking/guest IDs and all foreign keys remain unchanged.
    if(current<9)db.transaction(()=>{
      ensureEntityIdSchema(db);
      const violations=db.pragma('foreign_key_check');
      if(violations.length)throw new Error('Entity ID upgrade rejected: foreign key violations');
      db.pragma('user_version = 9');
    })();
    // Version 10: retry-safe write-ahead request records for combined and
    // individual folio settlements. No historical settlement is rewritten.
    if(current<10)db.transaction(()=>{
      ensureFolioSettlementRequestSchema(db);
      const violations=db.pragma('foreign_key_check');
      if(violations.length)throw new Error('Folio settlement upgrade rejected: foreign key violations');
      db.pragma('user_version = 10');
    })();
    try{
      db.prepare('SELECT request_id,kind,booking_id,fingerprint,response_json,created_at FROM folio_settlement_requests LIMIT 0').all();
    }catch{
      throw new Error('Folio settlement request ledger is missing or incompatible; stop the app and restore a verified backup');
    }
    // Fail closed if a v9 database's identity allocation table was removed.
    for(const type of ['booking','guest']){
      if(!db.prepare('SELECT 1 FROM entity_id_counters WHERE entity_type=?').get(type))
        throw new Error('Audited entity ID sequence is missing; repair from verified backup before accepting entries');
    }
    // Additive v7 support table: existing v7 installations also need tombstones
    // without modifying historical booking or payment records.
    ensureBookingCreateSchema(db);
    // Fail on startup, not while accepting a guest's bill, if a later manual
    // schema change or damaged file removed the idempotency ledger after v8.
    // Do not silently reconstruct historic request markers that no longer exist.
    try{
      db.prepare('SELECT request_id,bill_id,fingerprint,response_json,created_at FROM restaurant_bill_requests LIMIT 0').all();
    }catch{
      throw new Error('Restaurant billing schema is incomplete. Stop FortLedger, run npm run doctor, and restore a verified backup or apply the reviewed v8 migration before recording bills');
    }
    // Preserve the established repair for legacy direct room_id records on reopen.
    // This is idempotent DML, not a schema migration.
    db.exec('INSERT OR IGNORE INTO booking_room_allocations(booking_id,room_id) SELECT id,room_id FROM bookings WHERE room_id IS NOT NULL');
    db.pragma('journal_mode = WAL');
    return db;
  }catch(error){
    db.close();
    throw error;
  }
}

// All reservations use half-open date ranges [checkin, checkout).
// Count every unassigned reservation against category capacity, not only those with room IDs.
export function assertAvailability(db, booking, excludedId = null) {
  const inventory = db.prepare('SELECT id, category FROM rooms WHERE active = 1').all();
  const roomIds=Array.isArray(booking.room_ids)?booking.room_ids:(booking.room_id===null||booking.room_id===undefined?[]:[booking.room_id]);
  if(roomIds.length>booking.rooms_count||new Set(roomIds).size!==roomIds.length)
    throw new Error('Invalid or duplicate assigned rooms');
  for(const roomId of roomIds){
    const target=inventory.find(r=>r.id===roomId);
    if(!target)throw new Error('Selected room not found or inactive');
    if(target.category!==booking.category)throw new Error('Room and category do not match');
  }
  const capacity = inventory.filter(r => r.category === booking.category).length;
  if (capacity < booking.rooms_count) throw new Error('Not enough rooms in this category');
  const existing = db.prepare(`
    SELECT id, room_id, rooms_count, checkin, checkout FROM bookings
    WHERE category = ? AND status != 'cancelled'
      AND checkin < ? AND checkout > ? AND (? IS NULL OR id != ?)
  `).all(booking.category, booking.checkout, booking.checkin, excludedId, excludedId);
  const allocations=db.prepare(`
    SELECT a.booking_id,a.room_id FROM booking_room_allocations a
    JOIN bookings b ON b.id=a.booking_id
    WHERE b.category=? AND b.status!='cancelled' AND b.checkin<? AND b.checkout>?
      AND (? IS NULL OR b.id!=?)`).all(booking.category,booking.checkout,booking.checkin,excludedId,excludedId);
  const allocated=new Map();
  for(const a of allocations){if(!allocated.has(a.booking_id))allocated.set(a.booking_id,[]);allocated.get(a.booking_id).push(a.room_id);}
  // Fallback for direct legacy inserts that have a room_id but no allocation row.
  for(const row of existing){if(!allocated.has(row.id))allocated.set(row.id,row.room_id===null?[]:[row.room_id]);}
  // Sweep each night to include category-held but not-yet-allocated inventory.
  for(let date=Date.parse(booking.checkin+'T00:00:00Z');date<Date.parse(booking.checkout+'T00:00:00Z');date+=86400000){
    const day=new Date(date).toISOString().slice(0,10);
    const concurrent=existing.filter(b=>b.checkin<=day&&day<b.checkout);
    const blocked=blockedRoomIds(db,day);
    for(const id of roomIds)if(blocked.has(id))
      throw new Error('Room out of service on '+day);
    const dayCapacity=inventory.filter(r=>r.category===booking.category&&!blocked.has(r.id)).length;
    const reservedCount=concurrent.reduce((sum,b)=>sum+b.rooms_count,0);
    if(reservedCount+booking.rooms_count>dayCapacity)
      throw new Error('No availability for '+day+' in '+booking.category+' (maintenance capacity)');
    const assignedIds=new Set(concurrent.flatMap(b=>allocated.get(b.id)||[]));
    for(const id of roomIds)if(assignedIds.has(id))throw new Error('Room already assigned for '+day);
    const unassigned=concurrent.reduce((sum,b)=>sum+b.rooms_count-(allocated.get(b.id)||[]).length,0);
    if(roomIds.length>dayCapacity-assignedIds.size-unassigned)
      throw new Error('Room capacity reserved by unassigned bookings');
  }
}
