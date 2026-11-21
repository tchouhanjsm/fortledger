import {recordAudit} from './financial-audit.js';
import {may} from './access.js';

const PRIORITIES=['low','normal','urgent'];
function validDate(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||
     !Number.isFinite(Date.parse(value+'T00:00:00Z'))||
     new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)
    throw new Error('Use a valid YYYY-MM-DD maintenance date');
  return value;
}
export function ensureMaintenanceSchema(db){
  db.exec(`
    CREATE TABLE IF NOT EXISTS maintenance_issues(
      id INTEGER PRIMARY KEY,
      room_id INTEGER NOT NULL REFERENCES rooms(id),
      title TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      priority TEXT NOT NULL CHECK(priority IN ('low','normal','urgent')),
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
      blocks_room INTEGER NOT NULL DEFAULT 0 CHECK(blocks_room IN (0,1)),
      start_date TEXT,
      end_date TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_by TEXT,
      resolved_at TEXT,
      resolution_note TEXT NOT NULL DEFAULT '',
      CHECK(blocks_room=0 OR (start_date IS NOT NULL AND end_date IS NOT NULL AND start_date<end_date))
    );
    CREATE INDEX IF NOT EXISTS idx_maintenance_room_dates
      ON maintenance_issues(room_id,status,blocks_room,start_date,end_date);
  `);
}
export function blockedRoomIds(db,day){
  validDate(day);
  return new Set(db.prepare(`SELECT DISTINCT room_id FROM maintenance_issues
    WHERE status='open' AND blocks_room=1 AND start_date<=? AND end_date>?`)
    .all(day,day).map(row=>row.room_id));
}
export function assertNoMaintenanceDuringStay(db,bookingId){
  const booking=db.prepare('SELECT checkin,checkout FROM bookings WHERE id=?').get(bookingId);
  if(!booking)throw new Error('Booking not found');
  const conflicts=db.prepare(`SELECT r.name FROM booking_room_allocations a
    JOIN rooms r ON r.id=a.room_id
    JOIN maintenance_issues m ON m.room_id=a.room_id AND m.status='open' AND m.blocks_room=1
    WHERE a.booking_id=? AND m.start_date<? AND m.end_date>? LIMIT 1`)
    .get(bookingId,booking.checkout,booking.checkin);
  if(conflicts)throw new Error('Assigned room is out of service: '+conflicts.name);
}
function validateBlockAgainstBookings(db,room,start,end){
  // Validate every night before creating the block: never silently invalidate
  // named allocations or category-only reservations.
  const inventory=db.prepare('SELECT id FROM rooms WHERE active=1 AND category=?').all(room.category)
    .map(row=>row.id);
  const reservations=db.prepare(`SELECT id,rooms_count,checkin,checkout,room_id FROM bookings
    WHERE category=? AND status!='cancelled' AND checkin<? AND checkout>?`)
    .all(room.category,end,start);
  const assignments=db.prepare(`SELECT a.booking_id,a.room_id FROM booking_room_allocations a
    JOIN bookings b ON b.id=a.booking_id
    WHERE b.category=? AND b.status!='cancelled' AND b.checkin<? AND b.checkout>?`)
    .all(room.category,end,start);
  const allocated=new Map();
  for(const a of assignments){
    if(!allocated.has(a.booking_id))allocated.set(a.booking_id,new Set());
    allocated.get(a.booking_id).add(a.room_id);
  }
  for(const stay of reservations){
    if(!allocated.has(stay.id)&&stay.room_id!==null)
      allocated.set(stay.id,new Set([stay.room_id]));
  }
  for(let date=Date.parse(start+'T00:00:00Z'),last=Date.parse(end+'T00:00:00Z');
      date<last;date+=86400000){
    const day=new Date(date).toISOString().slice(0,10);
    const blocked=blockedRoomIds(db,day);
    blocked.add(room.id);
    const relevant=reservations.filter(b=>b.checkin<=day&&day<b.checkout);
    if(relevant.some(b=>[...(allocated.get(b.id)||[])].some(id=>blocked.has(id))))
      throw new Error('Existing room assignment conflicts with proposed maintenance on '+day+
        '; move the booking before blocking this room');
    const available=inventory.filter(id=>!blocked.has(id)).length;
    const committed=relevant.reduce((sum,b)=>sum+b.rooms_count,0);
    if(committed>available)throw new Error('Existing category reservations exceed capacity if room is blocked on '+day+
      '; reassign or adjust bookings first');
  }
}
export function createMaintenanceIssue(db,input,actor){
  if(!input||typeof input!=='object'||Array.isArray(input)||!actor)
    throw new Error('Invalid maintenance issue');
  const room_id=Number(input.room_id),title=typeof input.title==='string'?input.title.trim():'',
    note=typeof input.note==='string'?input.note.trim():'';
  if(!Number.isSafeInteger(room_id)||room_id<1)throw new Error('Choose a room');
  if(!title||title.length>120||note.length>500)
    throw new Error('Issue title required (max 120 characters); note max 500');
  const priority=input.priority||'normal';
  if(!PRIORITIES.includes(priority))throw new Error('Invalid priority');
  if(typeof input.blocks_room!=='boolean'&&input.blocks_room!==undefined)
    throw new Error('Out-of-service flag must be true or false');
  const blocks_room=input.blocks_room===true;
  if(blocks_room&&!may(actor.role,'maintenance.manage'))
    throw new Error('Only owner or manager can take a room out of service');
  let start_date=null,end_date=null;
  if(blocks_room){
    start_date=validDate(input.start_date);end_date=validDate(input.end_date);
    const span=(Date.parse(end_date+'T00:00:00Z')-Date.parse(start_date+'T00:00:00Z'))/86400000;
    if(span<1||span>366)throw new Error('Out-of-service period must be 1–366 nights');
  }
  return db.transaction(()=>{
    const room=db.prepare('SELECT id,category,active FROM rooms WHERE id=?').get(room_id);
    if(!room||!room.active)throw new Error('Room not found or inactive');
    if(blocks_room)validateBlockAgainstBookings(db,room,start_date,end_date);
    const saved=db.prepare(`INSERT INTO maintenance_issues
      (room_id,title,note,priority,blocks_room,start_date,end_date,created_by)
      VALUES(?,?,?,?,?,?,?,?)`).run(room_id,title,note,priority,blocks_room?1:0,start_date,end_date,actor.username);
    const id=Number(saved.lastInsertRowid);
    recordAudit(db,actor,'maintenance.created','maintenance',id,
      {room_id,priority,blocks_room,start_date,end_date});
    return db.prepare('SELECT * FROM maintenance_issues WHERE id=?').get(id);
  })();
}
export function resolveMaintenanceIssue(db,id,actor,resolution_note=''){
  if(!actor||!may(actor.role,'maintenance.manage'))
    throw new Error('Only owner or manager can release maintenance issues');
  if(!Number.isSafeInteger(id)||id<1)throw new Error('Invalid issue ID');
  if(typeof resolution_note!=='string'||resolution_note.trim().length>300)
    throw new Error('Resolution note must be no more than 300 characters');
  return db.transaction(()=>{
    const issue=db.prepare('SELECT * FROM maintenance_issues WHERE id=?').get(id);
    if(!issue)throw new Error('Maintenance issue not found');
    if(issue.status==='resolved')return {...issue,already_resolved:true};
    db.prepare(`UPDATE maintenance_issues SET status='resolved',resolved_by=?,
      resolved_at=datetime('now'),resolution_note=? WHERE id=?`)
      .run(actor.username,resolution_note.trim(),id);
    recordAudit(db,actor,'maintenance.resolved','maintenance',id,
      {room_id:issue.room_id,blocks_room:Boolean(issue.blocks_room)});
    return db.prepare('SELECT * FROM maintenance_issues WHERE id=?').get(id);
  })();
}
export function listMaintenance(db,{status='open'}={}){
  if(!['open','resolved','all'].includes(status))throw new Error('Invalid maintenance filter');
  return db.prepare(`SELECT m.*,r.name AS room_name,r.category AS room_category
    FROM maintenance_issues m JOIN rooms r ON r.id=m.room_id
    WHERE (?='all' OR m.status=?) ORDER BY
      CASE WHEN m.status='open' THEN 0 ELSE 1 END,
      CASE m.priority WHEN 'urgent' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
      m.id DESC`).all(status,status).map(row=>({...row,blocks_room:Boolean(row.blocks_room)}));
}
