import { toPaise } from './finance.js';
import {ensurePrintSchema} from './printer.js';
export function ensureRestaurantSchema(db){
  db.exec(`
    CREATE TABLE IF NOT EXISTS menu_items (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL,
      price_paise INTEGER NOT NULL CHECK(price_paise>=0),
      tax_rate INTEGER NOT NULL DEFAULT 0 CHECK(tax_rate BETWEEN 0 AND 28),
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
      UNIQUE(name,category)
    );
    CREATE TABLE IF NOT EXISTS restaurant_bills (
      id INTEGER PRIMARY KEY,
      payment_method TEXT NOT NULL CHECK(payment_method IN('cash','upi','card','room')),
      booking_id INTEGER REFERENCES bookings(id),
      items_snapshot TEXT NOT NULL,
      total_paise INTEGER NOT NULL CHECK(total_paise>=0),
      tax_paise INTEGER NOT NULL CHECK(tax_paise>=0),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_restaurant_bills_booking ON restaurant_bills(booking_id);
    CREATE TABLE IF NOT EXISTS restaurant_settlements (
      id INTEGER PRIMARY KEY,
      restaurant_bill_id INTEGER NOT NULL UNIQUE REFERENCES restaurant_bills(id),
      method TEXT NOT NULL CHECK(method IN ('cash','upi','card')),
      settlement_group TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_settlements_group ON restaurant_settlements(settlement_group);
  `);
  const columns=new Set(db.pragma('table_info(restaurant_bills)').map(c=>c.name));
  if(!columns.has('manual_room'))db.exec("ALTER TABLE restaurant_bills ADD COLUMN manual_room TEXT NOT NULL DEFAULT ''");
  if(!columns.has('manual_guest'))db.exec("ALTER TABLE restaurant_bills ADD COLUMN manual_guest TEXT NOT NULL DEFAULT ''");
  if(!columns.has('linked_at'))db.exec('ALTER TABLE restaurant_bills ADD COLUMN linked_at TEXT');
  ensurePrintSchema(db);
}
function parseCsv(csv){
  if(typeof csv!=='string'||csv.length>65000)throw new Error('CSV must be plain text under 65 KB');
  const rows=[],row=[];let field='',quoted=false;
  for(let i=0;i<csv.length;i++){
    const c=csv[i];
    if(quoted){
      if(c==='"'&&csv[i+1]==='"'){field+='"';i++;}
      else if(c==='"')quoted=false;
      else field+=c;
    }else if(c==='"'){if(field!=='')throw new Error('Invalid CSV quotation');quoted=true;}
    else if(c===','){row.push(field);field='';}
    else if(c==='\n'||c==='\r'){if(c==='\r'&&csv[i+1]==='\n')i++;row.push(field);field='';if(row.some(v=>v.trim()))rows.push([...row]);row.length=0;}
    else field+=c;
  }
  if(quoted)throw new Error('Unclosed CSV quote');
  row.push(field);if(row.some(v=>v.trim()))rows.push([...row]);
  return rows;
}
export function importMenuCsv(db,csv){
  const rows=parseCsv(csv);
  if(rows.length<2)throw new Error('CSV requires header and at least one item');
  const header=rows.shift().map(x=>x.trim().toLowerCase());
  const fields=['name','category','price','tax_rate'];
  if(header.length!==4||fields.some((v,i)=>v!==header[i]))throw new Error('CSV header must be name,category,price,tax_rate');
  if(rows.length>500)throw new Error('Maximum 500 menu items per import');
  const normalized=rows.map((cols,i)=>{
    if(cols.length!==4)throw new Error('Wrong number of columns at line '+(i+2));
    const [name,category,price,tax]=cols.map(x=>x.trim());
    if(!name||name.length>120||!category||category.length>80)throw new Error('Invalid menu description at line '+(i+2));
    const tax_rate=Number(tax);
    if(!Number.isInteger(tax_rate)||tax_rate<0||tax_rate>28)throw new Error('Invalid tax rate at line '+(i+2));
    return {name,category,price_paise:toPaise(price),tax_rate};
  });
  const keys=new Set();
  for(const item of normalized){
    const key=item.category+'\u0000'+item.name;
    if(keys.has(key))throw new Error('Duplicate menu item in CSV: '+item.name);
    keys.add(key);
  }
  db.transaction(()=>{
    const upsert=db.prepare(`INSERT INTO menu_items(name,category,price_paise,tax_rate,active) VALUES(@name,@category,@price_paise,@tax_rate,1)
       ON CONFLICT(name,category) DO UPDATE SET price_paise=excluded.price_paise,tax_rate=excluded.tax_rate,active=1`);
    for(const item of normalized)upsert.run(item);
  })();
  return {imported:normalized.length};
}
export function listMenu(db){return db.prepare('SELECT * FROM menu_items WHERE active=1 ORDER BY category,name').all();}
export function listRestaurantBills(db){return db.prepare('SELECT * FROM restaurant_bills ORDER BY id DESC').all().map(x=>({...x,items:JSON.parse(x.items_snapshot)}));}
export function createRestaurantBill(db,input){
  if(!input||!Array.isArray(input.items)||input.items.length===0||input.items.length>50)throw new Error('Add 1–50 menu lines');
  const payment_method=String(input.payment_method||'');
  if(!['cash','upi','card','room'].includes(payment_method))throw new Error('Select a valid payment method');
  const hasManual=payment_method==='room'&&
    (input.booking_id===null||input.booking_id===undefined||input.booking_id==='');
  const booking_id=payment_method==='room'&&!hasManual?Number(input.booking_id):null;
  const manual_room=hasManual?String(input.manual_room||'').trim():'';
  const manual_guest=hasManual?String(input.manual_guest||'').trim():'';
  if(payment_method==='room'){
    if(hasManual){
      if(!manual_room||manual_room.length>80||!manual_guest||manual_guest.length>150)
        throw new Error('Manual room charges require room identifier and guest name');
    }else{
      if(!Number.isSafeInteger(booking_id)||booking_id<1)throw new Error('Choose a checked-in guest');
      const booking=db.prepare('SELECT status FROM bookings WHERE id=?').get(booking_id);
      if(!booking||booking.status!=='checked_in')throw new Error('Room charge requires a checked-in guest');
    }
  }
  return db.transaction(()=>{
    const get=db.prepare('SELECT * FROM menu_items WHERE id=? AND active=1');
    const items=input.items.map(line=>{
      const id=Number(line.menu_item_id),quantity=Number(line.quantity);
      if(!Number.isSafeInteger(id)||id<1||!Number.isInteger(quantity)||quantity<1||quantity>100)
        throw new Error('Invalid item ID or quantity');
      const item=get.get(id);if(!item)throw new Error('Menu item not found');
      const total_paise=item.price_paise*quantity;
      const taxable_paise=Math.round(total_paise*100/(100+item.tax_rate));
      return {menu_item_id:id,name:item.name,category:item.category,quantity,unit_price_paise:item.price_paise,
        tax_rate:item.tax_rate,total_paise,tax_paise:total_paise-taxable_paise};
    });
    const total_paise=items.reduce((n,x)=>n+x.total_paise,0);
    const tax_paise=items.reduce((n,x)=>n+x.tax_paise,0);
    if(!Number.isSafeInteger(total_paise)||total_paise>1e11)throw new Error('Restaurant bill exceeds allowed amount');
    const result=db.prepare(`INSERT INTO restaurant_bills(payment_method,booking_id,items_snapshot,total_paise,tax_paise,manual_room,manual_guest)
      VALUES(?,?,?,?,?,?,?)`).run(payment_method,booking_id,JSON.stringify(items),total_paise,tax_paise,manual_room,manual_guest);
    return {id:Number(result.lastInsertRowid),payment_method,booking_id,manual_room,manual_guest,items,total_paise,tax_paise};
  })();
}

/** Explicit linking is the only route from a manual pending charge to a guest folio. */
export function linkManualRoomCharge(db,billId,bookingId){
  if(!Number.isSafeInteger(billId)||billId<1||!Number.isSafeInteger(bookingId)||bookingId<1)
    throw new Error('Invalid charge or booking ID');
  return db.transaction(()=>{
    const bill=db.prepare('SELECT id,payment_method,booking_id,manual_room,manual_guest FROM restaurant_bills WHERE id=?').get(billId);
    if(!bill||bill.payment_method!=='room')throw new Error('Pending room charge not found');
    if(bill.booking_id!==null)throw new Error('Room charge is already linked');
    const guest=db.prepare("SELECT id,guest_name,status FROM bookings WHERE id=?").get(bookingId);
    if(!guest||guest.status!=='checked_in')throw new Error('Choose an active checked-in booking');
    // Operator confirms match; automatic name/room matching is intentionally prohibited.
    db.prepare("UPDATE restaurant_bills SET booking_id=?,linked_at=datetime('now') WHERE id=? AND booking_id IS NULL")
      .run(bookingId,billId);
    return {id:billId,booking_id:bookingId,guest_name:guest.guest_name,linked:true};
  })();
}
