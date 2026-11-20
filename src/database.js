import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { ensureInvoiceSchema } from './invoice-schema.js';
import { ensureBusinessSettings } from './business-settings.js';
import { ensureRestaurantSchema } from './restaurant.js';

export function openDatabase(filename = process.env.FORTLEDGER_DB || path.resolve('data/fortledger.sqlite')) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
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
  ensureBusinessSettings(db);
  ensureRestaurantSchema(db);
  if (db.prepare('SELECT count(*) AS count FROM rooms').get().count === 0) {
    const add = db.prepare('INSERT INTO rooms (name) VALUES (?)');
    db.transaction(() => { for (let i = 1; i <= 7; i++) add.run('Room ' + i); })();
  }
  return db;
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
    const reservedCount=concurrent.reduce((sum,b)=>sum+b.rooms_count,0);
    if(reservedCount+booking.rooms_count>capacity)throw new Error('No availability for '+day+' in '+booking.category);
    const assignedIds=new Set(concurrent.flatMap(b=>allocated.get(b.id)||[]));
    for(const id of roomIds)if(assignedIds.has(id))throw new Error('Room already assigned for '+day);
    const unassigned=concurrent.reduce((sum,b)=>sum+b.rooms_count-(allocated.get(b.id)||[]).length,0);
    if(roomIds.length>capacity-assignedIds.size-unassigned)
      throw new Error('Room capacity reserved by unassigned bookings');
  }
}
