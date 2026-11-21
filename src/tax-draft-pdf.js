import PDFDocument from 'pdfkit';
const money=n=>'INR '+(n/100).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
export function streamTaxDraftPdf(s,res,logo=null){
  const pdf=new PDFDocument({size:'A4',margin:44,info:{Title:'Tax invoice draft from '+s.proforma_number}});
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition','attachment; filename="tax-draft-'+s.proforma_number+'.pdf"');
  pdf.pipe(res);
  const line=(label,value,y)=>{pdf.font('Helvetica').fontSize(9).fillColor('#44564c').text(label,44,y,{width:160});
    pdf.fillColor('#172c25').text(String(value),230,y,{width:325});};
  pdf.rect(0,0,595,10).fill('#194532');
  pdf.fillColor('#a13b35').font('Helvetica-Bold').fontSize(17).text('DRAFT - NOT A TAX INVOICE',44,34,{align:'center',width:505});
  if(logo?.data)pdf.image(logo.data,470,72,{fit:[70,70]});
  pdf.fillColor('#194532').fontSize(20).text((s.business.hotel_name||'GARH JAISAL').toUpperCase(),44,75,{width:logo?.data?405:500});
  pdf.fillColor('#52695b').font('Helvetica').fontSize(9)
    .text('Proforma reference: '+s.proforma_number+'    Prepared: '+s.prepared_on,44,109);
  pdf.text('Supplier GSTIN: '+(s.business.gstin||'NOT CONFIGURED'),44,128);
  pdf.text('Supplier: '+(s.business.address||'Address missing'),44,144,{width:500,height:35});
  pdf.moveTo(44,186).lineTo(550,186).strokeColor('#dbe3dd').stroke();
  line('Bill to',s.recipient_name,203);
  line('Recipient GSTIN',s.recipient_gstin||'Unregistered / not specified',222);
  line('Recipient address',s.recipient_address||'Not specified',241);
  line('Place of supply',s.place_of_supply,271);
  line('Reverse charge','No',290);
  line('Guest / Group',s.guest_name,309);
  line('Check-in / Check-out',s.checkin+' - '+s.checkout,328);
  pdf.fillColor('#194532').font('Helvetica-Bold').fontSize(10).text('ACCOMMODATION (illustrative 5% GST)',44,363);
  let y=386;
  for(const entry of s.lines){
    if(y>665){pdf.addPage();y=65;}
    pdf.fillColor('#20382d').font('Helvetica').fontSize(9)
      .text(entry.rooms+' x '+entry.description+' / '+entry.nights+' night(s)',44,y,{width:315});
    pdf.fontSize(8).fillColor('#66786c').text('SAC: '+entry.sac+' · '+money(entry.rate_paise)+' / room/night',44,y+15,{width:315});
    pdf.font('Helvetica-Bold').fontSize(9).fillColor('#20382d')
      .text(money(entry.total_paise),420,y,{width:128,align:'right'});
    y+=47;
  }
  if(y>548){pdf.addPage();y=65;}
  pdf.moveTo(44,y).lineTo(550,y).strokeColor('#dbe3dd').stroke();y+=17;
  for(const [name,amount] of [['Taxable amount',s.taxable_paise],['CGST at 2.5% (illustrative)',s.cgst_paise],
    ['SGST at 2.5% (illustrative)',s.sgst_paise],['Total including GST',s.total_paise],
    ['Advance at proforma issue',s.paid_paise],['Proforma balance',s.due_paise]]){
    pdf.font('Helvetica').fontSize(9).fillColor('#20382d').text(name,300,y,{width:160});
    pdf.text(money(amount),454,y,{width:95,align:'right'});y+=23;
  }
  if(y>565){pdf.addPage();y=55;}
  pdf.font('Helvetica-Bold').fontSize(10).fillColor('#a13b35').text('NOT READY FOR LEGAL ISSUE',44,y+12);
  pdf.font('Helvetica').fontSize(8).fillColor('#52695b')
    .text(s.readiness.blockers.map(x=>'• '+x).join('\n'),44,y+34,{width:498,lineGap:2});
  // Preserve fixed T&C on drafts too.
  pdf.addPage();
  pdf.font('Helvetica-Bold').fontSize(12).fillColor('#194532').text('TERMS & CONDITIONS',44,60);
  pdf.font('Helvetica').fontSize(9).fillColor('#52695b').text(s.terms,44,89,{width:500,lineGap:5});
  pdf.font('Helvetica-Bold').fontSize(10).fillColor('#a13b35')
    .text('DRAFT ONLY. Requires compliance checks and an actual authorized signature before issuance.',44,690,{width:505,align:'center'});
  pdf.end();
}
