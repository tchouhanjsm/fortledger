// Read-only GST issuance preparedness. This deliberately NEVER authorizes legal issuance.
// Flags indicate local input presence/format only, not confirmation by the GST portal.
const GSTIN_FORMAT=/^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]{3}$/;
export function gstReadiness(settings={}){
  const legalName=String(settings.legal_name||'').trim();
  const gstin=String(settings.gstin||'').trim().toUpperCase();
  const address=String(settings.address||'').trim();
  const checks=[
    {key:'legal_name',label:'Registered supplier legal name',complete:legalName.length>0},
    {key:'gstin_format',label:'GSTIN format (not registration verification)',complete:GSTIN_FORMAT.test(gstin)},
    {key:'rajasthan_gstin',label:'GSTIN Rajasthan state prefix (08)',complete:GSTIN_FORMAT.test(gstin)&&gstin.startsWith('08')},
    {key:'registered_address',label:'Supplier registered address',complete:address.length>0}
  ];
  const accountant_reviews=[
    'Verify GSTIN, legal entity and registration on the official GST portal',
    'Approve accommodation GST by actual supply date and per-room daily taxable value, with meal-plan treatment and SAC',
    'Determine restaurant specified-premises status, applicable GST/ITC, and menu tax policy',
    'Confirm supplier historical FY statutory invoice and credit-note numbering, serial uniqueness and service time of supply',
    'Determine e-invoice applicability from historical aggregate turnover and IRP/QR requirements',
    'Approve recipient details, CGST/SGST/IGST, legally authenticated documents and GSTR reporting',
    'Approve credit/debit note treatment, original issued invoice references and actual refund/guest-folio reconciliation'
  ];
  return {
    status:'review_only',statutory_issuance_enabled:false,
    note:'Configuration checks are NOT statutory approval. Only proforma and visibly marked review drafts are currently available.',
    checks,completed_local_fields:checks.filter(item=>item.complete).length,
    required_local_fields:checks.length,accountant_reviews
  };
}
