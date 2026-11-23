import PDFDocument from 'pdfkit';

const INK='#193d32', MUTED='#62756c', PALE='#eef5ef', RED='#a44741';
const money=n=>'INR '+(n/100).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const LEFT=43,RIGHT=552,WIDTH=509;
function line(pdf,y){
  pdf.moveTo(LEFT,y).lineTo(RIGHT,y).lineWidth(.7).strokeColor('#dce6df').stroke();
}
function txt(pdf,value,x,y,width,{size=9,bold=false,color=INK,height=26,align='left'}={}){
  pdf.fillColor(color).font(bold?'Helvetica-Bold':'Helvetica').fontSize(size)
    .text(String(value??''),x,y,{width,height,align,ellipsis:true,lineGap:1});
}
function pageHeader(pdf,number){
  pdf.rect(0,0,595,8).fill(INK);
  txt(pdf,'TAX INVOICE  /  REVIEW DRAFT',LEFT,29,340,{size:18,bold:true,color:RED,height:26});
  txt(pdf,'NOT A LEGAL TAX INVOICE',LEFT,55,370,{size:9,bold:true,color:RED,height:20});
  txt(pdf,'Proforma '+number,365,34,187,{size:9,bold:true,align:'right'});
}
export function streamTaxDraftPdf(s,res,logo=null){
  const pdf=new PDFDocument({size:'A4',margin:0,autoFirstPage:false,
    info:{Title:'Tax draft from '+s.proforma_number}});
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition','attachment; filename="tax-draft-'+s.proforma_number+'.pdf"');
  pdf.pipe(res);
  pdf.addPage();pageHeader(pdf,s.proforma_number);
  if(logo?.data){
    try{pdf.image(logo.data,480,67,{fit:[65,50]});}catch{/* optional logo */ }
  }
  txt(pdf,(s.business.legal_name||s.business.hotel_name||'GARH JAISAL').toUpperCase(),LEFT,87,375,{size:15,bold:true,height:24});
  txt(pdf,'Prepared '+s.prepared_on+'   |   Supplier GSTIN: '+(s.business.gstin||'NOT CONFIGURED'),
    LEFT,114,WIDTH,{size:8,color:MUTED,height:17});
  txt(pdf,s.business.address||'Supplier address missing',LEFT,133,WIDTH,{size:8,color:MUTED,height:24});
  line(pdf,169);
  pdf.roundedRect(LEFT,180,WIDTH,91,5).fill(PALE);
  txt(pdf,'BILL TO',LEFT+12,191,180,{size:8,bold:true});
  txt(pdf,s.recipient_name,LEFT+12,207,225,{size:10,bold:true});
  txt(pdf,s.recipient_address||'Recipient address not supplied',LEFT+12,229,233,{size:8,height:30,color:MUTED});
  txt(pdf,'Recipient GSTIN: '+(s.recipient_gstin||'Not specified'),309,194,231,{size:8,color:MUTED});
  txt(pdf,'Place of supply: '+s.place_of_supply,309,215,231,{size:8,height:30,color:MUTED});
  txt(pdf,s.checkin+'   -   '+s.checkout,309,242,231,{size:9,bold:true});

  txt(pdf,'ACCOMMODATION  /  ILLUSTRATIVE TAX CALCULATION',LEFT,287,WIDTH,{size:9,bold:true});
  line(pdf,307);
  let y=318;
  for(const entry of s.lines){
    const item=entry.rooms+' x '+entry.description+' / '+entry.nights+' night(s)';
    pdf.font('Helvetica').fontSize(8.5);
    const itemHeight=Math.max(20,pdf.heightOfString(item,{width:365,lineGap:1})+3);
    const rowHeight=itemHeight+19;
    if(y+rowHeight>464){
      pdf.addPage();pageHeader(pdf,s.proforma_number);y=105;
    }
    txt(pdf,item,LEFT,y,365,{size:8.5,height:itemHeight});
    txt(pdf,'SAC '+entry.sac+'  |  GST '+(entry.tax_rate??5)+'% (review)  |  '+money(entry.rate_paise)+'/room/night',LEFT,y+itemHeight,355,
      {size:7.3,height:16,color:MUTED});
    txt(pdf,money(entry.total_paise),428,y,124,{size:8.7,bold:true,height:18,align:'right'});
    y+=rowHeight;
  }
  line(pdf,y+1);
  y+=13;
  const singleRate=s.tax_breakdown?.length===1?s.tax_breakdown[0].tax_rate:null;
  const rateLabel=singleRate===null?'mixed rates':singleRate/2+'%';
  const totals=[
    ['Taxable amount',s.taxable_paise],['CGST '+rateLabel+' (review)',s.cgst_paise],
    ['SGST '+rateLabel+' (review)',s.sgst_paise],['Total including GST',s.total_paise],
    ['Advance at proforma issue',s.paid_paise],['Proforma balance',s.due_paise]
  ];
  for(const [label,value] of totals){
    const emphasis=label==='Proforma balance';
    if(emphasis)pdf.roundedRect(294,y-3,258,23,4).fill(PALE);
    txt(pdf,label,306,y,132,{size:emphasis?9.4:8.1,bold:emphasis,color:emphasis?INK:MUTED,height:17});
    txt(pdf,money(value),442,y,110,{size:emphasis?9.4:8.1,bold:emphasis,height:17,align:'right'});
    y+=21;
  }
  y+=10;
  const blockers=s.readiness?.blockers||[];
  const reasons=blockers.map(x=>'• '+x).join('\n')||'Awaiting authorized statutory review';
  pdf.font('Helvetica').fontSize(7.2);
  const reasonsHeight=pdf.heightOfString(reasons,{width:WIDTH-22,lineGap:1});
  if(y+reasonsHeight+42>687){pdf.addPage();pageHeader(pdf,s.proforma_number);y=104;}
  pdf.roundedRect(LEFT,y,WIDTH,Math.min(130,reasonsHeight+39),5).fill('#fff4f1');
  txt(pdf,'NOT READY FOR LEGAL ISSUE',LEFT+11,y+10,WIDTH-22,{size:9,bold:true,color:RED,height:17});
  txt(pdf,reasons,LEFT+11,y+29,WIDTH-22,{size:7.2,color:RED,height:Math.min(100,reasonsHeight+5)});
  y+=Math.min(130,reasonsHeight+39)+16;
  const terms=s.terms||'';
  let termFontSize=7.6;
  pdf.font('Helvetica').fontSize(termFontSize);
  let termsHeight=pdf.heightOfString(terms,{width:WIDTH,lineGap:1});
  if(y+termsHeight+25>782){
    termFontSize=7;
    pdf.fontSize(termFontSize);
    termsHeight=pdf.heightOfString(terms,{width:WIDTH,lineGap:1});
  }
  if(y+termsHeight+25>782){pdf.addPage();pageHeader(pdf,s.proforma_number);y=105;}
  txt(pdf,'TERMS & CONDITIONS',LEFT,y,WIDTH,{size:8.7,bold:true,height:18});
  pdf.fillColor(MUTED).font('Helvetica').fontSize(termFontSize)
    .text(terms,LEFT,y+21,{width:WIDTH,lineGap:1});
  line(pdf,792);
  txt(pdf,'DRAFT ONLY   |   ACCOUNTANT REVIEW AND AUTHORISED SIGNATURE REQUIRED',LEFT,801,WIDTH,
    {size:7.7,bold:true,color:RED,height:15,align:'center'});
  pdf.end();
}
