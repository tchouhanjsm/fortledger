import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {hotelBusinessDate,HOTEL_TIME_ZONE} from '../src/hotel-clock.js';
import {openDatabase} from '../src/database.js';
import {createProforma} from '../src/invoices.js';

test('IST business day and invoice numbering use same date at midnight and year boundary',()=>{
  assert.equal(HOTEL_TIME_ZONE,'Asia/Kolkata');
  assert.equal(hotelBusinessDate('2026-12-31T18:29:59Z'),'2026-12-31');
  assert.equal(hotelBusinessDate('2026-12-31T18:30:00Z'),'2027-01-01');
  assert.equal(hotelBusinessDate('2027-01-01T00:10:00+05:30'),'2027-01-01');
  assert.equal(hotelBusinessDate('2026-11-22T02:00:00Z'),'2026-11-22');
  assert.throws(()=>hotelBusinessDate('bogus'),/Invalid hotel business instant/);
});

test('issued proforma year agrees with its IST business issue date, regardless of server timezone',()=>{
  const db=openDatabase(':memory:');
  try{
    const id=Number(db.prepare(`INSERT INTO bookings
      (guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise)
      VALUES('Clock Synthetic Guest','2027-02-01','2027-02-02',1,'Unassigned',450000)`)
      .run().lastInsertRowid);
    const invoice=createProforma(db,id);
    assert.equal(invoice.snapshot.issued_on,hotelBusinessDate());
    assert.equal(invoice.number.slice(3,7),invoice.snapshot.issued_on.slice(0,4));
  }finally{db.close();}
});

test('dashboard classifies restaurant bill sales with IST instead of the viewer local timezone',()=>{
  const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(app,/hotelDateAt\(new Date\(stamp\)\)===today/);
  assert.doesNotMatch(app,/dateISO\(new Date\(stamp\)\)===today/);
});
