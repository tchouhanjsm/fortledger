import PDFDocument from 'pdfkit';

const money=paise=>'INR '+(paise/100).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const dark='#1e4437',muted='#66766e';
export function streamProformaPdf(snapshot,response){
  const pdf=new PDFDocument({size:'A4',margin:48,info:{Title:'Proforma '+snapshot.number,Author:'Garh Jaisal'}});
  response.setHeader('Content-Type','application/pdf');
  response.setHeader('Content-Disposition','attachment; filename="'+snapshot.number+'-proforma.pdf"');
  pdf.pipe(response);
  pdf.rect(0,0,595,10).fill(dark);
  pdf.fillColor(dark).font('Helvetica-Bold').fontSize(23).text('GARH JAISAL',48,45);
  pdf.fillColor(muted).font('Helvetica').fontSize(10).text('PROFORMA INVOICE',48,79);
  pdf.fillColor(dark).font('Helvetica-Bold').fontSize(11).text(snapshot.number,350,55,{align:'right',width:195});
  pdf.fillColor(muted).font('Helvetica').fontSize(9).text('Issued: '+snapshot.issued_on,350,75,{align:'right',width:195});
  pdf.moveTo(48,105).lineTo(547,105).strokeColor('#d7e2da').stroke();
  pdf.fillColor(muted).fontSize(9).text('BILL TO',48,125);
  pdf.fillColor(dark).font('Helvetica-Bold').fontSize(13).text(snapshot.bill_to||snapshot.company_name||snapshot.guest_name,48,140,{width:470});
  pdf.fillColor(muted).font('Helvetica').fontSize(9).text('Guest / Group: '+snapshot.guest_name,48,170);
  pdf.text('Check-in: '+snapshot.checkin+'     Check-out: '+snapshot.checkout,310,188,{width:235,align:'right'});
  if(snapshot.bill_to_address)pdf.fillColor(muted).font('Helvetica').fontSize(9).text(snapshot.bill_to_address,48,185,{width:245,height:40,ellipsis:true});
  pdf.roundedRect(48,238,499,32,5).fill('#edf4ef');
  pdf.fillColor(dark).font('Helvetica-Bold').fontSize(9).text('ACCOMMODATION',60,250);
  pdf.text('NIGHTS',325,250).text('RATE',385,250).text('AMOUNT',468,250);
  const lines=snapshot.lines??[{
    description:snapshot.rooms_count+' x '+snapshot.category+' - '+snapshot.meal_plan+' basis',
    rooms:snapshot.rooms_count,nights:snapshot.nights,rate_paise:snapshot.nightly_rate_paise,
    total_paise:snapshot.total_paise
  }];
  let lineY=283;
  for(const line of lines){
    if(lineY>650){pdf.addPage();lineY=55;}
    const description=line.rooms+' × '+line.description;
    pdf.fillColor(dark).font('Helvetica').fontSize(9).text(description,60,lineY,{width:235});
    const lineHeight=Math.max(34,pdf.heightOfString(description,{width:235})+9);
    pdf.text(String(line.nights),329,lineY,{width:40});
    pdf.text(money(line.rate_paise),368,lineY,{width:83,align:'right'});
    pdf.text(money(line.total_paise),459,lineY,{width:88,align:'right'});
    lineY+=lineHeight;
  }
  if(lineY>580){pdf.addPage();lineY=55;}
  pdf.moveTo(48,lineY+5).lineTo(547,lineY+5).strokeColor('#e5ebe6').stroke();
  const summary=[['Taxable amount',snapshot.taxable_paise],['GST (illustrative 5%)',snapshot.gst_paise],
    ['Total including GST',snapshot.total_paise],['Advance received',snapshot.paid_paise],['Balance due',snapshot.due_paise]];
  let y=lineY+20;
  for(const [name,amount] of summary){
    const highlight=name==='Balance due';
    pdf.fillColor(highlight?dark:muted).font(highlight?'Helvetica-Bold':'Helvetica').fontSize(highlight?12:10)
      .text(name,308,y,{width:150});
    pdf.text(money(amount),450,y,{width:97,align:'right'});
    y+=30;
  }
  if(y>520){pdf.addPage();y=60;}
  pdf.fillColor(dark).font('Helvetica-Bold').fontSize(10).text('TERMS & CONDITIONS',48,y+12);
  pdf.fillColor(muted).font('Helvetica').fontSize(8).text(snapshot.terms,48,y+34,{width:498,lineGap:3});
  pdf.fillColor(muted).fontSize(8).text('Proforma only. Not a GST tax invoice.',48,755,{align:'center',width:499});
  pdf.end();
}
