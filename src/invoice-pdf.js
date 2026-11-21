import PDFDocument from 'pdfkit';

const money=paise=>'INR '+(paise/100).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const INK='#193d32', MUTED='#62756c', RULE='#dce6df', PALE='#eef5ef', GOLD='#a98046';
const LEFT=43, RIGHT=552, WIDTH=509, PAGE_BOTTOM=800;

function section(pdf,label,y){
  pdf.fillColor(INK).font('Helvetica-Bold').fontSize(8.7).text(label,LEFT,y,{width:WIDTH,lineBreak:false});
}
function thinRule(pdf,y){
  pdf.moveTo(LEFT,y).lineTo(RIGHT,y).strokeColor(RULE).lineWidth(.7).stroke();
}
function amount(pdf,value,y,{bold=false,size=9}={}){
  pdf.fillColor(INK).font(bold?'Helvetica-Bold':'Helvetica').fontSize(size)
    .text(money(value),441,y,{width:111,align:'right',lineBreak:false});
}
function safeLine(pdf,value,x,y,width,{size=9,maxHeight=27,color=INK,bold=false}={}){
  pdf.fillColor(color).font(bold?'Helvetica-Bold':'Helvetica').fontSize(size)
    .text(String(value||''),x,y,{width,height:maxHeight,ellipsis:true,lineGap:1});
}
function termsHeight(pdf,terms,fontSize){
  pdf.font('Helvetica').fontSize(fontSize);
  return pdf.heightOfString(terms,{width:WIDTH,lineGap:2});
}

/** One-page A4 for ordinary proformas. Explicit overflow page only for genuinely
 * long item lists or long, user-configured terms; never move the fixed terms to
 * page 2 merely because the totals are below an arbitrary threshold. */
export function streamProformaPdf(snapshot,response,logo=null){
  const pdf=new PDFDocument({size:'A4',margin:0,autoFirstPage:false,
    info:{Title:'Proforma '+snapshot.number,Author:'Garh Jaisal'}});
  response.setHeader('Content-Type','application/pdf');
  response.setHeader('Content-Disposition','attachment; filename="'+snapshot.number+'-proforma.pdf"');
  pdf.pipe(response);
  pdf.addPage();
  const business=snapshot.business||{hotel_name:'Garh Jaisal'};
  pdf.rect(0,0,595,8).fill(INK);
  pdf.rect(LEFT,34,3,59).fill(GOLD);
  if(logo?.data){
    try{pdf.image(logo.data,LEFT+12,37,{fit:[52,52]});}
    catch{ /* A malformed optional brand image must not destroy the invoice. */ }
  }
  const titleX=logo?.data?118:LEFT+13;
  safeLine(pdf,(business.hotel_name||'Garh Jaisal').toUpperCase(),titleX,37,285,{size:20,maxHeight:32,bold:true});
  safeLine(pdf,'PROFORMA  /  RESERVATION SUMMARY',titleX,67,280,{size:8.4,maxHeight:15,color:MUTED});
  safeLine(pdf,snapshot.number,362,41,190,{size:11.5,maxHeight:18,bold:true});
  pdf.fillColor(MUTED).font('Helvetica').fontSize(8.5)
    .text('Issued '+snapshot.issued_on,362,62,{width:190,align:'right',lineBreak:false});
  const supplier=[business.address,business.gstin?'GSTIN: '+business.gstin:null].filter(Boolean).join('   |   ');
  if(supplier)safeLine(pdf,supplier,LEFT,102,WIDTH,{size:8,maxHeight:26,color:MUTED});
  thinRule(pdf,133);

  section(pdf,'BILL TO',151);
  safeLine(pdf,snapshot.bill_to||snapshot.company_name||snapshot.guest_name,LEFT,167,245,{size:12,bold:true,maxHeight:31});
  if(snapshot.bill_to_address)safeLine(pdf,snapshot.bill_to_address,LEFT,192,245,{size:8,maxHeight:30,color:MUTED});
  section(pdf,'STAY DETAILS',151);
  // Explicit position on the right, avoiding the left bill-to block.
  pdf.rect(322,147,230,78).fill(PALE);
  pdf.fillColor(INK).font('Helvetica-Bold').fontSize(8).text('STAY DETAILS',335,159);
  safeLine(pdf,'Guest: '+snapshot.guest_name,335,174,203,{size:8,maxHeight:18});
  safeLine(pdf,snapshot.checkin+'  -  '+snapshot.checkout,335,192,203,{size:8.6,maxHeight:17,bold:true});

  const lines=snapshot.lines??[{
    description:snapshot.category+' - '+snapshot.meal_plan+' basis',
    rooms:snapshot.rooms_count,nights:snapshot.nights,
    rate_paise:snapshot.nightly_rate_paise,total_paise:snapshot.total_paise
  }];
  pdf.roundedRect(LEFT,239,WIDTH,28,5).fill(PALE);
  pdf.fillColor(INK).font('Helvetica-Bold').fontSize(8.5)
    .text('ACCOMMODATION',LEFT+11,249,{width:237,lineBreak:false})
    .text('NIGHTS',322,249,{width:45,lineBreak:false})
    .text('RATE',384,249,{width:67,align:'right',lineBreak:false})
    .text('AMOUNT',461,249,{width:91,align:'right',lineBreak:false});
  let y=279;
  for(const line of lines){
    const label=line.rooms+' x '+line.description;
    pdf.font('Helvetica').fontSize(8.6);
    const height=Math.max(20,Math.min(47,pdf.heightOfString(label,{width:252,lineGap:1})+4));
    // A long custom item list may require a continuation page. Never clip
    // financial rows or silently omit the fixed terms.
    if(y+height>490){
      pdf.addPage();
      y=53;
      section(pdf,'PROFORMA '+snapshot.number+'  /  ACCOMMODATION CONTINUED',y);
      thinRule(pdf,y+22);
      y+=37;
    }
    safeLine(pdf,label,LEFT+10,y,253,{size:8.6,maxHeight:height});
    safeLine(pdf,String(line.nights),325,y,36,{size:8.6,maxHeight:15});
    pdf.fillColor(INK).font('Helvetica').fontSize(8.6).text(money(line.rate_paise),370,y,{width:83,align:'right',lineBreak:false});
    amount(pdf,line.total_paise,y,{size:8.6});
    y+=height+4;
  }
  thinRule(pdf,y+2);
  y+=13;
  const rows=[
    ['Taxable amount',snapshot.taxable_paise],
    ['GST (illustrative 5%)',snapshot.gst_paise],
    ['Total including GST',snapshot.total_paise],
    ['Advance received',snapshot.paid_paise],
    ['Balance due',snapshot.due_paise]
  ];
  for(const [label,value] of rows){
    const highlight=label==='Balance due';
    if(highlight)pdf.roundedRect(285,y-5,267,25,4).fill(PALE);
    safeLine(pdf,label,300,y,135,{size:highlight?10:8.8,maxHeight:17,color:highlight?INK:MUTED,bold:highlight});
    amount(pdf,value,y,{size:highlight?10:8.8,bold:highlight});
    y+=24;
  }
  const bankInfo=[
    business.bank_name&&'Bank: '+business.bank_name,
    business.account_holder&&'A/c name: '+business.account_holder,
    business.account_number&&'A/c: '+business.account_number,
    business.ifsc&&'IFSC: '+business.ifsc,
    business.upi_id&&'UPI: '+business.upi_id
  ].filter(Boolean).join('   |   ');
  if(bankInfo){
    y+=6;section(pdf,'PAYMENT DETAILS',y);y+=16;
    const bankHeight=Math.max(16,Math.min(52,pdf.heightOfString(bankInfo,{width:WIDTH,lineGap:2})));
    safeLine(pdf,bankInfo,LEFT,y,WIDTH,{size:7.8,maxHeight:bankHeight,color:MUTED});
    y+=bankHeight+10;
  }
  y+=11;
  const terms=snapshot.terms||'';
  let fontSize=8,termHeight=termsHeight(pdf,terms,fontSize);
  // Retain readable 7.4pt as the compact limit; normal 1-3-line invoices
  // comfortably fit the entire unchanged terms text on page one.
  if(y+24+termHeight>PAGE_BOTTOM){
    fontSize=7.4;termHeight=termsHeight(pdf,terms,fontSize);
  }
  if(y+24+termHeight>PAGE_BOTTOM){
    pdf.addPage();y=55;
  }
  section(pdf,'TERMS & CONDITIONS',y);
  pdf.fillColor(MUTED).font('Helvetica').fontSize(fontSize)
    .text(terms,LEFT,y+19,{width:WIDTH,lineGap:2});
  // Fixed footer uses the page on which the terms finish, not a new page.
  thinRule(pdf,792);
  pdf.fillColor(MUTED).font('Helvetica').fontSize(8)
    .text('PROFORMA ONLY   |   NOT A GST TAX INVOICE',LEFT,802,{width:WIDTH,align:'center',lineBreak:false});
  pdf.end();
}
