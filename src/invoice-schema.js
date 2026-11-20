// Proforma invoices are immutable snapshots linked to one booking.
// The same booking may have only one active proforma in this alpha release.
// Tax invoices deliberately remain disabled pending statutory validation.
export function ensureInvoiceSchema(db){
  db.exec(`
    CREATE TABLE IF NOT EXISTS invoice_sequence (
      id INTEGER PRIMARY KEY CHECK(id=1),
      last_number INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO invoice_sequence(id,last_number) VALUES(1,0);
    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY,
      booking_id INTEGER NOT NULL REFERENCES bookings(id),
      kind TEXT NOT NULL DEFAULT 'proforma' CHECK(kind='proforma'),
      number TEXT NOT NULL UNIQUE,
      snapshot TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(booking_id,kind)
    );
    CREATE INDEX IF NOT EXISTS idx_invoices_booking ON invoices(booking_id);
  `);
}
