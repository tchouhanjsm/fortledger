export const ROLE_PERMISSIONS={
  owner:['*'],
  manager:['bookings.read','bookings.write','payments.write','refunds.write','rooms.read','rooms.write',
    'invoices.read','invoices.write','restaurant.read','restaurant.write','folio.read','folio.write',
    'settings.read','audit.read','finance.read','profile.read','profile.write'],
  frontdesk:['bookings.read','bookings.write','payments.write','rooms.read',
    'invoices.read','invoices.write','restaurant.read','folio.read','folio.write',
    'profile.read','profile.write'],
  cashier:['restaurant.read','restaurant.write','profile.read','profile.write']
};
export function may(role,permission){
  const allowed=ROLE_PERMISSIONS[role]||[];
  return allowed.includes('*')||allowed.includes(permission);
}
export function requiredPermission(method,path){
  if(path==='/health')return 'profile.read';
  if(path==='/me')return method==='GET'?'profile.read':'profile.write';
  if(path.startsWith('/staff'))return 'staff.admin';
  if(path.startsWith('/audit/'))return method==='GET'?'audit.read':null;
  if(path.startsWith('/finance/'))return method==='GET'?'finance.read':null;
  if(path==='/backup')return 'settings.admin';
  if(path.startsWith('/settings/')){
    if(method==='GET')return 'settings.read';
    return 'settings.admin';
  }
  if(path.startsWith('/restaurant/')){
    if(path==='/restaurant/checked-in')return 'restaurant.read';
    if(method==='GET')return 'restaurant.read';
    return 'restaurant.write';
  }
  if(path.startsWith('/rooms'))return method==='GET'?'rooms.read':'rooms.write';
  if(path.startsWith('/invoices')||path.startsWith('/tax-drafts'))
    return method==='GET'?'invoices.read':'invoices.write';
  if(path.startsWith('/bookings/')){
    if(/\/payments\/\d+\/refunds$/.test(path)||/\/refunds$/.test(path))
      return method==='GET'?'bookings.read':'refunds.write';
    if(/\/payments$/.test(path))return method==='GET'?'bookings.read':'payments.write';
    if(/\/folio/.test(path))return method==='GET'?'folio.read':'folio.write';
    if(/\/proforma$/.test(path))return 'invoices.write';
  }
  if(path.startsWith('/bookings'))return method==='GET'?'bookings.read':'bookings.write';
  return null; // fail closed for staff on new endpoints
}
