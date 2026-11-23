import {getBusinessSettings} from './business-settings.js';
import {receiptLocalTime} from './printer.js';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=p=>(p/100).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});

export function renderRestaurantReceipt(db,billId){
  if(!Number.isSafeInteger(billId)||billId<1)throw new Error('Invalid restaurant bill ID');
  const bill=db.prepare(`
    SELECT b.*,s.method AS settlement_method,s.created_at AS settled_at,bt.table_label
    FROM restaurant_bills b
    LEFT JOIN restaurant_settlements s ON s.restaurant_bill_id=b.id
    LEFT JOIN restaurant_bill_tables bt ON bt.bill_id=b.id WHERE b.id=?`).get(billId);
  if(!bill)return null;
  const items=JSON.parse(bill.items_snapshot);
  const business=getBusinessSettings(db);
  const lines=items.map(item=>`<tr><td>${esc(item.name)}<small>${esc(item.quantity)} × ₹${money(item.unit_price_paise)}</small></td><td class="amount">₹${money(item.total_paise)}</td></tr>`).join('');
  const status=bill.payment_method==='room'?
    (bill.booking_id===null?'Manual room charge · pending review':
      bill.settlement_method?'Room charge · settled via '+bill.settlement_method:'Room charge · awaiting settlement'):
    'Paid via '+bill.payment_method;
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1"><title>Food receipt #${bill.id}</title>
    <style>
      @page{size:80mm auto;margin:3mm}
      *{box-sizing:border-box}
      body{font:12px/1.4 Arial,sans-serif;max-width:74mm;margin:0 auto;color:#111}
      h1{font-size:18px;letter-spacing:1px;margin:0;text-align:center}
      .center{text-align:center}.muted{color:#555}.rule{border-top:1px dashed #555;margin:12px 0}
      table{width:100%;border-collapse:collapse}td{padding:7px 0;vertical-align:top;overflow-wrap:anywhere}
      td small{display:block;color:#555;font-size:10px}.amount{text-align:right;white-space:nowrap}
      .total{font-size:16px;font-weight:bold}.print{display:block;width:100%;padding:12px;margin:15px 0;background:#202c2a;color:white;border:0}
      @media print{.print{display:none}body{max-width:none}}
    </style></head><body>
      <h1>${esc(business.hotel_name)}</h1>
      <div class="center muted">Restaurant receipt · Not a tax invoice</div>
      <div class="rule"></div>
      <div>Receipt #${bill.id}</div><div>${esc(receiptLocalTime(bill.created_at))}</div>
      ${bill.table_label?'<div>Table: '+esc(bill.table_label)+'</div>':''}
      <div class="muted">${esc(status)}</div>
      <div class="rule"></div>
      <table><tbody>${lines}</tbody></table>
      <div class="rule"></div>
      <table><tr><td>Included tax (as recorded)</td><td class="amount">₹${money(bill.tax_paise)}</td></tr>
      <tr class="total"><td>Total</td><td class="amount">₹${money(bill.total_paise)}</td></tr></table>
      <div class="rule"></div>
      <p class="center muted">Thank you for dining with us.</p>
      <button class="print" onclick="window.print()">Print receipt</button>
    </body></html>`;
}
