export const ROLE_PERMISSIONS={
  owner:['*'],
  manager:['bookings.read','bookings.write','payments.write','refunds.write','rooms.read','rooms.write',
    'invoices.read','invoices.write','restaurant.read','restaurant.write','menu.manage','folio.read','folio.write','folio.adjust',
    'settings.read','audit.read','finance.read','finance.write','analytics.read','housekeeping.read','housekeeping.write','maintenance.read','maintenance.write','maintenance.manage','guests.read','guests.write','profile.read','profile.write','system.health.read'],
  frontdesk:['bookings.read','bookings.write','payments.write','rooms.read',
    'invoices.read','invoices.write','restaurant.read','folio.read','folio.write','housekeeping.read','housekeeping.write','maintenance.read','maintenance.write','guests.read','guests.write',
    'profile.read','profile.write'],
  cashier:['restaurant.read','restaurant.write','profile.read','profile.write']
};
export function may(role,permission){
  const allowed=ROLE_PERMISSIONS[role]||[];
  return allowed.includes('*')||allowed.includes(permission);
}
export function requiredPermission(method,path){
  if(path==='/health')return 'profile.read';
  if(path==='/system/backup-status')return method==='GET'?'system.health.read':null;
  if(path==='/me')return method==='GET'?'profile.read':'profile.write';
  if(path==='/me/password')return method==='POST'?'profile.write':null;
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
  if(path.startsWith('/restaurant/')){
    if(path==='/restaurant/menu/preview'||path==='/restaurant/menu/import')
      return method==='POST'?'menu.manage':null;
    if(path==='/restaurant/checked-in')return 'restaurant.read';
    if(method==='GET')return 'restaurant.read';
    return 'restaurant.write';
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
  if(path.startsWith('/invoices')||path.startsWith('/tax-drafts'))
    return method==='GET'?'invoices.read':'invoices.write';
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
