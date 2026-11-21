export const VIEWS={
  bookings:{title:'Bookings & guest stays',subtitle:'Calendar, arrivals, advances and balances.',sections:['stats','calendar','bookings']},
  rooms:{title:'Room inventory',subtitle:'Seven physical rooms and their accommodation categories.',sections:['rooms']},
  invoices:{title:'Hotel invoices',subtitle:'Prepare proformas, PDF downloads and reviewed GST drafts.',sections:['invoices']},
  restaurant:{title:'Restaurant billing',subtitle:'Menu, food bills, receipts and room charges.',sections:['restaurant']},
  'business-settings':{title:'Hotel settings',subtitle:'Business identity, payment details and hotel logo.',sections:['business-settings','roadmap']},
  profile:{title:'My profile & staff',subtitle:'Account details, access and team management.',sections:['profile']}
};
export function viewForHash(hash){
  const name=String(hash||'').replace(/^#/,'');
  return Object.hasOwn(VIEWS,name)?name:'bookings';
}
