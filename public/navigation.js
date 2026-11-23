export const VIEWS={
  dashboard:{title:'Operations dashboard',subtitle:'Your most important work, in one place.',sections:['dashboard']},
  bookings:{title:'Bookings & guest stays',subtitle:'Calendar, arrivals, advances and balances.',sections:['stats','calendar','bookings']},
  guests:{title:'Guest directory',subtitle:'Returning guests and their explicitly linked stays.',sections:['guests']},
  rooms:{title:'Room inventory',subtitle:'Seven physical rooms and their accommodation categories.',sections:['rooms']},
  invoices:{title:'Hotel invoices',subtitle:'Prepare proformas, PDF downloads and reviewed GST drafts.',sections:['invoices']},
  restaurant:{title:'Restaurant POS',subtitle:'New bill · Saved bills · My Profile.',sections:['restaurant']},
  'restaurant-admin':{title:'Restaurant management',subtitle:'Menu, seating labels, saved receipts and reconciliation.',sections:['restaurant-admin']},
  'business-settings':{title:'Hotel settings',subtitle:'Business identity, payment details and hotel logo.',sections:['business-settings','roadmap']},
  profile:{title:'My profile & staff',subtitle:'Account details, access and team management.',sections:['profile']}
};
export function viewForHash(hash){
  const name=String(hash||'').replace(/^#/,'');
  return Object.hasOwn(VIEWS,name)?name:'dashboard';
}
