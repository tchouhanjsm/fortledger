import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { ensureInvoiceSchema } from './invoice-schema.js';
import { ensureBusinessSettings } from './business-settings.js';

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
  `);
  ensureInvoiceSchema(db);
  ensureBusinessSettings(db);
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
  if (booking.room_id !== null) {
    if (booking.rooms_count !== 1) throw new Error('A specific room assignment requires exactly one room');
    const target = inventory.find(r => r.id === booking.room_id);
    if (!target) throw new Error('Selected room not found or inactive');
    if (target.category !== booking.category) throw new Error('Room and category do not match');
  }
  const capacity = inventory.filter(r => r.category === booking.category).length;
  if (capacity < booking.rooms_count) throw new Error('Not enough rooms in this category');
  const existing = db.prepare(`
    SELECT id, room_id, rooms_count, checkin, checkout FROM bookings
    WHERE category = ? AND status != 'cancelled'
      AND checkin < ? AND checkout > ? AND (? IS NULL OR id != ?)
  `).all(booking.category, booking.checkout, booking.checkin, excludedId, excludedId);
  // Sweep each night in the reservation: capacity must hold on every date.
  for (let date = Date.parse(booking.checkin + 'T00:00:00Z'); date < Date.parse(booking.checkout + 'T00:00:00Z'); date += 86400000) {
    const day = new Date(date).toISOString().slice(0,10);
    const concurrent = existing.filter(b => b.checkin <= day && day < b.checkout);
    const reservedCount = concurrent.reduce((sum,b)=>sum+b.rooms_count,0);
    if (reservedCount + booking.rooms_count > capacity) throw new Error('No availability for ' + day + ' in ' + booking.category);
    if (booking.room_id !== null && concurrent.some(b=>b.room_id===booking.room_id)) throw new Error('Room already assigned for ' + day);
    // Never assign an individual room when all remaining inventory is consumed by category holds.
    const specificallyBooked = new Set(concurrent.filter(b=>b.room_id!==null).map(b=>b.room_id));
    const unassignedCount = concurrent.filter(b=>b.room_id===null).reduce((s,b)=>s+b.rooms_count,0);
    const freeSlots = capacity - specificallyBooked.size - unassignedCount;
    if (booking.room_id!==null && freeSlots<1) throw new Error('Room capacity reserved by unassigned bookings');
  }
}
