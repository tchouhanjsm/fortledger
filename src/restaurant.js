import { toPaise } from './finance.js';
import {createHash,createHmac} from 'node:crypto';
import {ensurePrintSchema} from './printer.js';
import {recordAudit} from './financial-audit.js';
import {saveBillTableSnapshot} from './restaurant-tables.js';
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
    CREATE TABLE IF NOT EXISTS restaurant_bill_requests (
      request_id TEXT PRIMARY KEY,
      bill_id INTEGER NOT NULL UNIQUE REFERENCES restaurant_bills(id),
      fingerprint TEXT NOT NULL,
      response_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
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
const MENU_HEADER_ALIASES = {
  name:['name','item','item name','item_name','itemname','menu item','menu_item','dish','dish name','product','product name'],
  category:['category','group','group name','section','item category','item_category','menu category','type'],
  price:['price','rate','selling price','selling_price','sellingprice','unit price','unit_price','amount','price inr','price (inr)','mrp'],
  tax_rate:['tax_rate','tax rate','gst','gst %','gst%','gst rate','gst_rate','tax','tax %','tax%','tax percentage','gst percentage']
};
const canonicalHeader = value=>String(value||'').replace(/^\uFEFF/,'').trim().toLowerCase()
  .replace(/[_-]+/g,' ').replace(/\s+/g,' ');
export function parseMenuCsv(csv){
  const rows=parseCsv(csv);
  if(rows.length<2)throw new Error('CSV requires a header and at least one menu item');
  const header=rows.shift().map(canonicalHeader);
  const columns={};
  for(const field of ['name','category','price','tax_rate']){
    const aliases=MENU_HEADER_ALIASES[field].map(canonicalHeader);
    const positions=header.flatMap((label,i)=>aliases.includes(label)?[i]:[]);
    if(positions.length!==1)throw new Error('Missing or duplicate "'+field+'" column. Required: item/name, category, price, and GST/tax rate. Detected: '+header.join(', '));
    columns[field]=positions[0];
  }
  if(rows.length>500)throw new Error('Maximum 500 menu items per import');
  const items=rows.map((cols,i)=>{
    if(cols.length!==header.length)throw new Error('Line '+(i+2)+': expected '+header.length+' columns; found '+cols.length);
    const value=field=>cols[columns[field]].trim();
    const name=value('name'),category=value('category'),rawPrice=value('price'),
      rawTax=value('tax_rate');
    if(!name||name.length>120||!category||category.length>80)
      throw new Error('Line '+(i+2)+': item name and category are required');
    if(!rawTax)throw new Error('Line '+(i+2)+': GST/tax rate is blank. Enter an explicit rate, including 0 if applicable.');
    const tax_rate=Number(rawTax.replace(/\s*%$/,''));
    if(!Number.isInteger(tax_rate)||tax_rate<0||tax_rate>28)
      throw new Error('Line '+(i+2)+': GST/tax rate must be an integer between 0 and 28');
    const cleanedPrice=rawPrice.replace(/^[₹Rs.\s]+/i,'').replace(/,/g,'').trim();
    let price_paise;
    try{price_paise=toPaise(cleanedPrice);}
    catch{throw new Error('Line '+(i+2)+': invalid inclusive price "'+rawPrice+'". Enter a non-negative amount in rupees with at most 2 decimal places.');}
    return {name,category,price_paise,tax_rate};
  });
  const keys=new Set();
  for(const item of items){
    const key=item.category.toLowerCase()+'\u0000'+item.name.toLowerCase();
    if(keys.has(key))throw new Error('Duplicate menu item in CSV: '+item.name);
    keys.add(key);
  }
  return items;
}
// Preview the EXACT change the import will make against the complete current
// menu, including inactive rows. SQL COLLATE NOCASE mirrors import identity.
export function planMenuImport(db,csv,{signingKey}={}){
  const items=parseMenuCsv(csv);
  const current=db.prepare('SELECT id,name,category,price_paise,tax_rate,active FROM menu_items ORDER BY id').all();
  const match=db.prepare('SELECT id,name,category,price_paise,tax_rate,active FROM menu_items WHERE name=? COLLATE NOCASE AND category=? COLLATE NOCASE');
  const summary={new:0,updated:0,unchanged:0,suspicious:0};
  const preview=items.map((item,i)=>{
    const matches=match.all(item.name,item.category);
    if(matches.length>1)throw new Error('CSV row '+(i+2)+': existing menu has ambiguous case-duplicate item '+item.name+'; resolve the duplicate before importing');
    const prior=matches[0]||null;
    const tax_changed=prior!==null&&prior.tax_rate!==item.tax_rate;
    const price_delta_paise=prior===null?0:item.price_paise-prior.price_paise;
    const unusual_price=prior!==null&&Math.abs(price_delta_paise)>=5000&&
      (prior.price_paise===0||Math.abs(price_delta_paise)*100>=prior.price_paise*30);
    const suspicious=Boolean(prior&&(tax_changed||unusual_price));
    const change=prior===null?'new':suspicious?'suspicious':
      (price_delta_paise!==0||prior.tax_rate!==item.tax_rate||prior.active!==1?'updated':'unchanged');
    summary[change]++;
    const concern=tax_changed?'GST rate changed; accountant review may be required':
      unusual_price?'Large price difference (30% or more, and at least ₹50)':'';
    return {...item,row_number:i+2,change,existing_id:prior?.id??null,
      old_price_paise:prior?.price_paise??null,old_tax_rate:prior?.tax_rate??null,
      price_delta_paise,reactivates:prior?.active===0,concern};
  });
  const category_counts=Object.fromEntries([...new Set(items.map(x=>x.category))]
    .sort((a,b)=>a.localeCompare(b)).map(category=>[
      category,items.filter(x=>x.category===category).length]));
  const tax_rates=[...new Set(items.map(x=>x.tax_rate))].sort((a,b)=>a-b);
  // A per-running-server signing key prevents callers from fabricating approval
  // of unreviewed bytes. Including ALL menu rows prevents stale multi-user writes.
  const preview_token=signingKey?createHmac('sha256',signingKey)
    .update(JSON.stringify({csv,menu:current})).digest('hex'):null;
  return {count:items.length,preview,summary,category_counts,tax_rates,preview_token};
}
export function importMenuCsv(db,csv,options={}){
  const normalized=parseMenuCsv(csv);
  let result={imported:normalized.length};
  db.transaction(()=>{
    if(options.require_preview){
      if(typeof options.preview_token!=='string'||!options.preview_token)
        throw new Error('Preview this exact CSV before importing');
      if(!options.signingKey)throw new Error('Missing menu preview verification key');
      const plan=planMenuImport(db,csv,{signingKey:options.signingKey});
      if(plan.preview_token!==options.preview_token)
        throw new Error('Menu or selected CSV changed after preview; check the file and review again before importing');
      if(options.confirm_import!==true)
        throw new Error('Confirm the reviewed import changes before saving');
      if(plan.summary.suspicious>0&&options.approve_suspicious!==true)
        throw new Error('Suspicious menu price or GST changes require explicit review and confirmation');
      result={imported:normalized.length,summary:plan.summary};
    }
    // Keep existing stable menu IDs (historic bill snapshots refer to them).
    // SQLite NOCASE is the source of truth for matching, also used in preview.
    const matched=db.prepare(`SELECT id,price_paise,tax_rate,active FROM menu_items
      WHERE name=? COLLATE NOCASE AND category=? COLLATE NOCASE`);
    const update=db.prepare(`UPDATE menu_items SET price_paise=?,tax_rate=?,active=1 WHERE id=?`);
    const insert=db.prepare(`INSERT INTO menu_items(name,category,price_paise,tax_rate,active)
      VALUES(@name,@category,@price_paise,@tax_rate,1)`);
    for(const item of normalized){
      const rows=matched.all(item.name,item.category);
      if(rows.length>1)throw new Error('Multiple existing menu items differ only by capitalization; resolve duplicate menu items before importing '+item.name);
      if(rows.length){
        const prior=rows[0];
        if(prior.price_paise!==item.price_paise||prior.tax_rate!==item.tax_rate||prior.active!==1)
          update.run(item.price_paise,item.tax_rate,prior.id);
      }else insert.run(item);
    }
  })();
  return result;
}
export function listMenu(db){return db.prepare('SELECT * FROM menu_items WHERE active=1 ORDER BY category,name').all();}
export function listMenuForManagement(db){
  return db.prepare('SELECT id,name,category,price_paise,tax_rate,active FROM menu_items ORDER BY category,name,id').all();
}
// Manager changes are optimistic, transactional and auditable: a stale control
// cannot overwrite another operator's choice, and old receipt snapshots remain intact.
export function setMenuItemAvailability(db,itemId,{active,expected_active}={},actor){
  if(!Number.isSafeInteger(itemId)||itemId<1)throw new Error('Invalid menu item ID');
  if(typeof active!=='boolean'||typeof expected_active!=='boolean')
    throw new Error('Current and new menu availability must be explicit');
  if(!actor||!['owner','manager'].includes(actor.role))
    throw new Error('Only owner or manager may change menu availability');
  return db.transaction(()=>{
    const previous=db.prepare('SELECT id,name,category,price_paise,tax_rate,active FROM menu_items WHERE id=?').get(itemId);
    if(!previous)throw new Error('Menu item not found');
    if(Boolean(previous.active)!==expected_active)
      throw new Error('Menu availability changed since review; refresh before saving');
    if(Boolean(previous.active)!==active){
      db.prepare('UPDATE menu_items SET active=? WHERE id=?').run(Number(active),itemId);
      recordAudit(db,actor,active?'menu_item.enabled':'menu_item.disabled','menu_item',itemId,{
        item_name:previous.name,category:previous.category,
        previous_active:expected_active,active
      });
    }
    return {...previous,active:Number(active)};
  })();
}


/** Manager price/tax changes are compared against the exact reviewed current
 * state; existing printed receipts are never edited. */
export function updateMenuItemPrice(db,itemId,input={},actor){
  if(!actor||!['owner','manager'].includes(actor.role))
    throw new Error('Only owner or manager may change menu prices');
  if(!Number.isSafeInteger(itemId)||itemId<1)throw new Error('Invalid menu item ID');
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Invalid menu change');
  const {price_paise,tax_rate,expected_price_paise,expected_tax_rate,reason}=input;
  if(!Number.isSafeInteger(price_paise)||price_paise<0||price_paise>10000000000||
     !Number.isSafeInteger(expected_price_paise)||expected_price_paise<0||
     !Number.isInteger(tax_rate)||tax_rate<0||tax_rate>28||
     !Number.isInteger(expected_tax_rate)||expected_tax_rate<0||expected_tax_rate>28)
    throw new Error('Enter exact current and new GST-inclusive price (in paise) and GST rate');
  if(typeof reason!=='string'||reason.trim().length<10||reason.trim().length>300)
    throw new Error('A change reason of 10–300 characters is required');
  return db.transaction(()=>{
    const prior=db.prepare('SELECT id,name,category,price_paise,tax_rate,active FROM menu_items WHERE id=?').get(itemId);
    if(!prior)throw new Error('Menu item not found');
    if(prior.price_paise!==expected_price_paise||prior.tax_rate!==expected_tax_rate)
      throw new Error('Menu price or GST rate changed since review; refresh before saving');
    if(prior.price_paise===price_paise&&prior.tax_rate===tax_rate)
      throw new Error('The new price and GST are unchanged');
    const applied=db.prepare('UPDATE menu_items SET price_paise=?,tax_rate=? WHERE id=? AND price_paise=? AND tax_rate=?')
      .run(price_paise,tax_rate,itemId,expected_price_paise,expected_tax_rate);
    if(applied.changes!==1)throw new Error('Menu price or GST rate changed since review');
    recordAudit(db,actor,'menu_item.price_tax_updated','menu_item',itemId,{
      name:prior.name,category:prior.category,
      previous_price_paise:prior.price_paise,price_paise,
      previous_tax_rate:prior.tax_rate,tax_rate,
      reason:reason.trim()
    });
    return {...prior,price_paise,tax_rate};
  })();
}

export function listRestaurantBills(db){
  // Read-only settlement and original dining-table state; not open orders.
  return db.prepare(`SELECT b.*,s.method AS settlement_method,s.created_at AS settled_at,
      bt.table_id,bt.table_label
    FROM restaurant_bills b LEFT JOIN restaurant_settlements s
      ON s.restaurant_bill_id=b.id
    LEFT JOIN restaurant_bill_tables bt ON bt.bill_id=b.id ORDER BY b.id DESC`)
    .all().map(x=>({...x,items:JSON.parse(x.items_snapshot)}));
}
export function restaurantBillRequest(db,requestId){
  if(typeof requestId!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(requestId))
    throw new Error('Invalid restaurant bill request ID');
  const row=db.prepare('SELECT bill_id FROM restaurant_bill_requests WHERE request_id=?').get(requestId);
  return row?{recorded:true,id:row.bill_id}:{recorded:false};
}
export function createRestaurantBill(db,input,actor=null,{requireReviewedPrices=false}={}){
  if(!input||!Array.isArray(input.items)||input.items.length===0||input.items.length>50)throw new Error('Add 1–50 menu lines');
  const requestId=input.request_id;
  if(requestId!==undefined&&(typeof requestId!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(requestId)))
    throw new Error('Invalid restaurant bill request ID');
  const table_id=input.table_id===undefined||input.table_id===null||input.table_id===''?
    null:input.table_id;
  if(table_id!==null&&(!Number.isSafeInteger(table_id)||table_id<1))
    throw new Error('Choose a valid dining table');
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
    }else if(!Number.isSafeInteger(booking_id)||booking_id<1){
      throw new Error('Choose a checked-in guest');
    }
  }
  // Include the operator-reviewed rates and GST in the request identity.
  // Exact retries resolve BEFORE checking current menu prices: a lost response
  // may be recovered even if the manager updated prices in the meantime.
  const normalizedItems=input.items.map(line=>{
    const id=Number(line?.menu_item_id),quantity=Number(line?.quantity);
    if(!Number.isSafeInteger(id)||id<1||!Number.isInteger(quantity)||quantity<1||quantity>100)
      throw new Error('Invalid item ID or quantity');
    const hasPrice=Object.hasOwn(line,'unit_price_paise'),hasTax=Object.hasOwn(line,'tax_rate');
    if(requireReviewedPrices&&(!hasPrice||!hasTax))
      throw new Error('Review current menu price and GST for every bill item before saving');
    if(hasPrice&&(!Number.isSafeInteger(line.unit_price_paise)||line.unit_price_paise<0||
      line.unit_price_paise>10000000000))
      throw new Error('Invalid reviewed unit price');
    if(hasTax&&(!Number.isInteger(line.tax_rate)||line.tax_rate<0||line.tax_rate>28))
      throw new Error('Invalid reviewed GST rate');
    return {menu_item_id:id,quantity,
      ...(hasPrice?{unit_price_paise:line.unit_price_paise}:{}),
      ...(hasTax?{tax_rate:line.tax_rate}:{})};
  });
  const fingerprint=requestId?createHash('sha256').update(JSON.stringify({
    payment_method,booking_id,manual_room,manual_guest,table_id,items:normalizedItems
  })).digest('hex'):null;
  return db.transaction(()=>{
    if(requestId){
      const existing=db.prepare('SELECT fingerprint,response_json FROM restaurant_bill_requests WHERE request_id=?').get(requestId);
      if(existing){
        if(existing.fingerprint!==fingerprint)throw new Error('Restaurant bill request ID already used with different details');
        return {...JSON.parse(existing.response_json),already_recorded:true};
      }
    }
    if(payment_method==='room'&&!hasManual){
      const booking=db.prepare('SELECT status FROM bookings WHERE id=?').get(booking_id);
      if(!booking||booking.status!=='checked_in')throw new Error('Room charge requires a checked-in guest');
    }
    const get=db.prepare('SELECT * FROM menu_items WHERE id=? AND active=1');
    const items=normalizedItems.map(line=>{
      const id=Number(line.menu_item_id),quantity=Number(line.quantity);
      if(!Number.isSafeInteger(id)||id<1||!Number.isInteger(quantity)||quantity<1||quantity>100)
        throw new Error('Invalid item ID or quantity');
      const item=get.get(id);if(!item)throw new Error('Menu item not found or unavailable; refresh the menu and review the bill before saving');
      if((line.unit_price_paise!==undefined&&line.unit_price_paise!==item.price_paise)||
         (line.tax_rate!==undefined&&line.tax_rate!==item.tax_rate))
        throw new Error('Menu price or GST rate changed since review; refresh and verify the bill before saving');
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
    const seating=saveBillTableSnapshot(db,Number(result.lastInsertRowid),table_id);
    const response={id:Number(result.lastInsertRowid),payment_method,booking_id,manual_room,manual_guest,
      table_id:seating?.table_id??null,table_label:seating?.table_label??null,
      items,total_paise,tax_paise};
    if(requestId)db.prepare('INSERT INTO restaurant_bill_requests(request_id,bill_id,fingerprint,response_json) VALUES(?,?,?,?)')
      .run(requestId,response.id,fingerprint,JSON.stringify(response));
    if(actor&&(!Number.isSafeInteger(actor.id)||actor.id<0||
      typeof actor.username!=='string'||!actor.username||
      typeof actor.role!=='string'||!actor.role))
      throw new Error('Invalid restaurant bill actor');
    if(actor)recordAudit(db,actor,'restaurant_bill.created','restaurant_bill',response.id,{
      payment_method,booking_id,manual_room,table_id:seating?.table_id??null,
      table_label:seating?.table_label??null,amount_paise:total_paise,
      request_id:requestId||null
    });
    return {...response,already_recorded:false};
  })();
}

/** A manual room charge must never attach to a different guest silently.
 * Exact matching is conservative; genuine spelling differences require
 * explicit owner/manager review and an attributable reason. */
export function linkManualRoomCharge(db,billId,bookingId,{actor,override=false,reason=''}={}){
  if(!Number.isSafeInteger(billId)||billId<1||!Number.isSafeInteger(bookingId)||bookingId<1)
    throw new Error('Invalid charge or booking ID');
  if(!actor||!Number.isSafeInteger(actor.id)||actor.id<0||
     typeof actor.username!=='string'||!actor.username||typeof actor.role!=='string')
    throw new Error('Authenticated staff actor required to link a room charge');
  if(typeof reason!=='string'||reason.length>300)
    throw new Error('Invalid room-charge review reason');
  if(typeof override!=='boolean')throw new Error('Invalid manual charge override');
  return db.transaction(()=>{
    const bill=db.prepare('SELECT id,payment_method,booking_id,manual_room,manual_guest FROM restaurant_bills WHERE id=?').get(billId);
    if(!bill||bill.payment_method!=='room')throw new Error('Pending room charge not found');
    if(bill.booking_id!==null)throw new Error('Room charge is already linked');
    const guest=db.prepare("SELECT id,guest_name,status,room_id FROM bookings WHERE id=?").get(bookingId);
    if(!guest||guest.status!=='checked_in')throw new Error('Choose an active checked-in booking');
    const assignedRooms=db.prepare(`SELECT DISTINCT r.name FROM rooms r WHERE r.id IN
      (SELECT room_id FROM booking_room_allocations WHERE booking_id=?
       UNION SELECT room_id FROM bookings WHERE id=? AND room_id IS NOT NULL)
      ORDER BY r.name`).all(bookingId,bookingId).map(r=>r.name);
    const canonical=value=>String(value||'').normalize('NFKC').trim().replace(/\\s+/g,' ').toLowerCase();
    const guestMatches=canonical(bill.manual_guest)===canonical(guest.guest_name);
    const roomMatches=assignedRooms.some(name=>canonical(name)===canonical(bill.manual_room));
    const mismatch=!guestMatches||!roomMatches;
    if(mismatch&&(!override||!['owner','manager'].includes(actor.role)||reason.trim().length<10))
      throw new Error('Manual room or guest does not match this booking; owner/manager override with a review reason (at least 10 characters) required');
    if(!mismatch&&override)throw new Error('Override is unnecessary; match the original room and guest');
    db.prepare("UPDATE restaurant_bills SET booking_id=?,linked_at=datetime('now') WHERE id=? AND booking_id IS NULL")
      .run(bookingId,billId);
    recordAudit(db,actor,'restaurant_bill.linked','restaurant_bill',billId,{
      booking_id:bookingId,original_room:bill.manual_room,original_guest:bill.manual_guest,
      matched_guest:guest.guest_name,assigned_rooms:assignedRooms,
      guest_matches:guestMatches,room_matches:roomMatches,
      override:mismatch,reason:reason.trim()
    });
    return {id:billId,booking_id:bookingId,guest_name:guest.guest_name,
      linked:true,override:mismatch};
  })();
}
