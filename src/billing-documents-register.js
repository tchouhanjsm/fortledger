// Permission-filtered, strictly read-only document index. Every source is
// a different representation, not additive revenue or a legal tax invoice.
const TYPES=['all','proforma','checkout_case','historical_original','restaurant_receipt'];
const STATUSES=['all','saved_proforma','held_for_review','needs_source_review',
  'reviewed_for_accountant','saved_restaurant_receipt','unverified_historical_original'];
function validDate(date){
 if(date==='')return '';
 if(typeof date!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date))
   throw new Error('Use YYYY-MM-DD for the register date');
 const stamp=Date.parse(date+'T00:00:00Z');
 if(!Number.isFinite(stamp)||new Date(stamp).toISOString().slice(0,10)!==date)
   throw new Error('Invalid register calendar date');
 return date;
}
function stringField(value,name){
 if(typeof value!=='string'||value.length>100)
   throw new Error('Invalid '+name+' document filter');
 return value.trim();
}
export function searchBillingDocuments(db,actor,{
 q='',kind='all',from='',to='',booking_id=null,guest='',company='',number='',status='all',
 offset=0,limit=30
}={}){
 if(!actor||!['owner','manager','frontdesk'].includes(actor.role))
   throw new Error('Billing document access is restricted');
 q=stringField(q,'search');
 guest=stringField(guest,'guest');
 company=stringField(company,'company');
 number=stringField(number,'number');
 if(!TYPES.includes(kind)||!STATUSES.includes(status)||
   (booking_id!==null&&(!Number.isSafeInteger(booking_id)||booking_id<1))||
   !Number.isSafeInteger(offset)||offset<0||offset>20000||
   !Number.isSafeInteger(limit)||limit<1||limit>50)
   throw new Error('Invalid billing document search');
 from=validDate(from);to=validDate(to);
 if(from&&to&&from>to)throw new Error('Register start date must precede end date');
 const selects=[
  "SELECT 'proforma' AS kind,i.id AS source_id,i.number AS title,"+
    "i.booking_id,b.guest_name,b.company_name,i.created_at,'' AS reported_ref,"+
    "'saved_proforma' AS document_status "+
    "FROM invoices i JOIN bookings b ON b.id=i.booking_id WHERE i.kind='proforma'",
  "SELECT 'checkout_case' AS kind,c.id AS source_id,"+
    "'Checkout review #'||c.id AS title,c.booking_id,"+
    "b.guest_name,b.company_name,c.created_at,'' AS reported_ref,"+
    "COALESCE((SELECT CASE r.status "+
    "WHEN 'needs_source_review' THEN 'needs_source_review' "+
    "WHEN 'reviewed_for_accountant' THEN 'reviewed_for_accountant' "+
    "ELSE 'held_for_review' END "+
    "FROM checkout_case_review_events r WHERE r.case_id=c.id ORDER BY r.id DESC LIMIT 1),"+
    "'held_for_review') AS document_status "+
    "FROM checkout_document_cases c JOIN bookings b ON b.id=c.booking_id"
 ];
 if(['owner','manager'].includes(actor.role))
   selects.push("SELECT 'restaurant_receipt' AS kind,r.id AS source_id,"+
     "'Restaurant bill #'||r.id AS title,r.booking_id,"+
     "COALESCE(b.guest_name,r.manual_guest,'') AS guest_name,"+
     "COALESCE(b.company_name,'') AS company_name,r.created_at,'' AS reported_ref,"+
     "'saved_restaurant_receipt' AS document_status "+
     "FROM restaurant_bills r LEFT JOIN bookings b ON b.id=r.booking_id");
 if(actor.role==='owner')
   selects.push("SELECT 'historical_original' AS kind,e.id AS source_id,"+
     "e.original_filename AS title,NULL AS booking_id,"+
     "'' AS guest_name,'' AS company_name,e.imported_at AS created_at,"+
     "COALESCE(h.reported_number,'') AS reported_ref,"+
     "'unverified_historical_original' AS document_status "+
     "FROM external_invoice_originals e "+
     "LEFT JOIN historical_pdf_identifications h ON h.id=("+
       "SELECT MAX(p.id) FROM historical_pdf_identifications p WHERE p.original_id=e.id)");
 const sources='WITH docs AS ('+selects.join(' UNION ALL ')+')';
 const criteria="WHERE (?='all' OR kind=?) "+
   "AND (?='all' OR document_status=?) "+
   "AND (instr(lower(title),lower(?))>0 OR "+
        "instr(lower(coalesce(guest_name,'')),lower(?))>0 OR "+
        "instr(lower(coalesce(company_name,'')),lower(?))>0 OR "+
        "instr(lower(coalesce(reported_ref,'')),lower(?))>0 OR "+
        "(booking_id IS NOT NULL AND CAST(booking_id AS TEXT)=?)) "+
   "AND (? IS NULL OR booking_id=?) "+
   "AND instr(lower(coalesce(guest_name,'')),lower(?))>0 "+
   "AND instr(lower(coalesce(company_name,'')),lower(?))>0 "+
   "AND (instr(lower(title),lower(?))>0 OR instr(lower(coalesce(reported_ref,'')),lower(?))>0) "+
   "AND (?='' OR date(datetime(created_at,'+5 hours','+30 minutes'))>=?) "+
   "AND (?='' OR date(datetime(created_at,'+5 hours','+30 minutes'))<=?)";
 const args=[kind,kind,status,status,q,q,q,q,q,booking_id,booking_id,
   guest,company,number,number,from,from,to,to];
 const total=db.prepare(sources+' SELECT COUNT(*) AS n FROM docs '+criteria).get(...args).n;
 const entries=db.prepare(sources+
   ' SELECT kind,source_id,title,booking_id,guest_name,company_name,created_at,reported_ref,document_status FROM docs '+
   criteria+' ORDER BY created_at DESC,source_id DESC,kind ASC LIMIT ? OFFSET ?')
   .all(...args,limit,offset);
 return {kind,q,from,to,booking_id,guest,company,number,status,offset,limit,total,
   date_semantics:'recorded_or_imported_timestamp_IST_not_legal_invoice_issue_date',
   items:entries.map(entry=>({
     ...entry,
     status:entry.kind==='proforma'?'saved_proforma_not_tax_invoice':
       entry.kind==='checkout_case'?entry.document_status+'_not_issued':
       entry.kind==='historical_original'?'unverified_external_pdf_original':
       'saved_restaurant_receipt_not_tax_invoice',
     bank_verified:false,delivery_confirmed:false,legally_issued_by_fortledger:false
   }))};
}
