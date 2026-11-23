export const ROLE_PERMISSIONS={
  owner:['*'],
  manager:['bookings.read','bookings.write','payments.write','refunds.write','rooms.read','rooms.write',
    'invoices.read','invoices.write','tax.review','restaurant.read','restaurant.link','restaurant.correction.preview','restaurant.correction.request','menu.manage','folio.read','folio.write','folio.adjust',
    'settings.read','audit.read','finance.read','finance.write','analytics.read','housekeeping.read','housekeeping.write','maintenance.read','maintenance.write','maintenance.manage','guests.read','guests.write','profile.read','profile.write','system.health.read'],
  frontdesk:['bookings.read','bookings.write','payments.write','rooms.read',
    'invoices.read','invoices.write','folio.read','folio.write','housekeeping.read','housekeeping.write','maintenance.read','maintenance.write','guests.read','guests.write',
    'profile.read','profile.write'],
  cashier:['restaurant.read','restaurant.write','restaurant.pos','restaurant.link','profile.read','profile.write']
};
export function may(role,permission){
  const allowed=ROLE_PERMISSIONS[role]||[];
  return allowed.includes('*')||allowed.includes(permission);
}
export function requiredPermission(method,path){
  if(path==='/health')return 'profile.read';
  if(path==='/system/backup-status')return method==='GET'?'system.health.read':null;
  if(path==='/system/release-readiness')return method==='GET'?'system.update':null;
  if(path==='/system/backup-verify')return method==='GET'?'system.update':null;
  if(path==='/system/backup-prepare')return method==='POST'?'system.update':null;
  if(path==='/system/updates')return method==='GET'?'system.update':null;
  if(path==='/system/updates/readiness')return method==='GET'?'system.update':null;
  if(path==='/system/updates/install')return method==='POST'?'system.update':null;
  if(path==='/me')return method==='GET'?'profile.read':'profile.write';
  if(path==='/me/password')return method==='POST'?'profile.write':null;
  if(path==='/me/quick-pin')return method==='GET'?'profile.read':
    method==='POST'||method==='DELETE'?'profile.write':null;
  if(path==='/system/staff-pin')return ['GET','POST'].includes(method)?'system.update':null;
  if(path.startsWith('/staff'))return 'staff.admin';
  if(path.startsWith('/audit/'))return method==='GET'?'audit.read':null;
  if(path==='/analytics/rooms')return method==='GET'?'analytics.read':null;
  if(path==='/finance/closing')return method==='GET'?'finance.read':
    method==='POST'?'finance.write':null;
  if(path==='/finance/closing/attention')return method==='GET'?'finance.read':null;
  if(path==='/finance/closing/review')return method==='POST'?'finance.write':null;
  if(path==='/finance/expenses')return method==='GET'?'finance.read':
    method==='POST'?'finance.write':null;
  if(path.startsWith('/finance/'))return method==='GET'?'finance.read':null;
  if(path==='/backup')return 'settings.admin';
  if(path.startsWith('/settings/')){
    if(method==='GET')return 'settings.read';
    return 'settings.admin';
  }
  if(path==='/restaurant/tables')
    return method==='GET'?'restaurant.read':method==='POST'?'menu.manage':null;
  if(path==='/restaurant/tables/all')
    return method==='GET'?'menu.manage':null;
  if(/^\/restaurant\/tables\/\d+\/visibility$/.test(path))
    return method==='PATCH'?'menu.manage':null;
  if(/^\/restaurant\/menu\/\d+\/price$/.test(path))
    return method==='PATCH'?'menu.manage':null;
  if(path==='/restaurant/menu/bundled/preview')return method==='GET'?'menu.manage':null;
  if(path==='/restaurant/menu/bundled/sync')return method==='POST'?'menu.manage':null;
  if(path.startsWith('/restaurant/')){
    if(path==='/restaurant/menu/all')return method==='GET'?'menu.manage':null;
    if(/^\/restaurant\/menu\/\d+\/availability$/.test(path))
      return method==='PATCH'?'menu.manage':null;
    if(path==='/restaurant/menu/preview'||path==='/restaurant/menu/import')
      return method==='POST'?'menu.manage':null;
    // Credit/correction previews do not alter money; managers inspect them, not cashiers.
    if(/^\/restaurant\/bills\/\d+\/correction-preview$/.test(path))
      return method==='POST'?'restaurant.correction.preview':null;
    if(/^\/restaurant\/bills\/\d+\/correction-cases$/.test(path))
      return method==='GET'?'restaurant.correction.preview':
        method==='POST'?'restaurant.correction.request':null;
    if(/^\/restaurant\/correction-cases\/request\/[A-Za-z0-9_-]+$/.test(path))
      return method==='GET'?'restaurant.correction.request':null;
    if(/^\/restaurant\/correction-cases\/\d+\/review$/.test(path))
      return method==='POST'?'restaurant.correction.review':null;
    // POS financial operations require a narrow role, not generic restaurant visibility.
    if(path==='/restaurant/bills')return method==='POST'?'restaurant.pos':
      method==='GET'?'restaurant.read':null;
    if(/^\/restaurant\/bills\/request\/[A-Za-z0-9_-]+$/.test(path))
      return method==='GET'?'restaurant.pos':null;
    if(/^\/restaurant\/bills\/\d+\/print$/.test(path))
      return method==='POST'?'restaurant.pos':null;
    if(/^\/restaurant\/bills\/\d+\/link-booking$/.test(path))
      return method==='POST'?'restaurant.link':null;
    if(path==='/restaurant/checked-in')return method==='GET'?'restaurant.read':null;
    // New routes fail closed rather than implicitly becoming writable.
    return method==='GET'?'restaurant.read':null;
  }
  if(method==='DELETE'&&(/^\/bookings\/\d+$/.test(path)||/^\/guests\/\d+$/.test(path)))
    return 'entries.delete';
  if(path==='/guests')return method==='GET'?'guests.read':
    method==='POST'?'guests.write':null;
  if(/^\/guests\/\d+\/stays$/.test(path))return method==='GET'?'guests.read':null;
  if(/^\/guests\/\d+$/.test(path))return method==='PATCH'?'guests.write':null;
  if(path==='/maintenance')return method==='GET'?'maintenance.read':
    method==='POST'?'maintenance.write':null;
  if(/^\/maintenance\/\d+\/resolve$/.test(path))return method==='PATCH'?'maintenance.manage':null;
  if(path==='/housekeeping')return method==='GET'?'housekeeping.read':null;
  if(path.startsWith('/housekeeping/'))return method==='PATCH'?'housekeeping.write':null;
  if(path.startsWith('/rooms'))return method==='GET'?'rooms.read':'rooms.write';
  // Historic originals may contain third-party GSTIN/address data:
  // keep listing, importing and downloading owner-only.
  if(path==='/external-invoice-originals')
    return method==='GET'?'external.documents.read':null;
  if(path==='/external-invoice-originals/import')
    return method==='POST'?'external.documents.import':null;
  if(/^\/external-invoice-originals\/by-digest\/[a-f0-9]{64}$/.test(path))
    return method==='GET'?'external.documents.read':null;
  if(/^\/external-invoice-originals\/\d+\/original$/.test(path))
    return method==='GET'?'external.documents.read':null;
  if(path==='/tax/readiness')return method==='GET'?'tax.review':null;
  if(/^\/bookings\/\d+\/checkout-invoice-preflight$/.test(path))
    return method==='GET'?'invoices.read':null;
  if(path.startsWith('/invoices')||path.startsWith('/tax-drafts'))
    return method==='GET'?'invoices.read':'invoices.write';
  if(/^\/bookings\/\d+\/operational-notes$/.test(path))
    return method==='PATCH'?'bookings.write':null;
  if(path.startsWith('/bookings/')){
    if(/\/payments\/\d+\/refunds$/.test(path)||/\/refunds$/.test(path))
      return method==='GET'?'bookings.read':'refunds.write';
    if(/\/payments$/.test(path))return method==='GET'?'bookings.read':'payments.write';
    if(/^\/bookings\/\d+\/folio\/adjustments$/.test(path))
      return method==='POST'?'folio.adjust':null;
    if(/\/folio/.test(path))return method==='GET'?'folio.read':'folio.write';
    if(/\/proforma$/.test(path))return 'invoices.write';
  }
  if(path.startsWith('/bookings'))return method==='GET'?'bookings.read':'bookings.write';
  return null; // fail closed for staff on new endpoints
}
