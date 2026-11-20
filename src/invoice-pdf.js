import PDFDocument from 'pdfkit';
import { FIXED_TERMS } from './terms.js';

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
  pdf.fillColor(dark).font('Helvetica-Bold').fontSize(13).text(snapshot.company_name||snapshot.guest_name,48,140,{width:470});
  pdf.fillColor(muted).font('Helvetica').fontSize(9).text('Guest / Group: '+snapshot.guest_name,48,170);
  pdf.text('Check-in: '+snapshot.checkin+'     Check-out: '+snapshot.checkout,48,188);
  pdf.roundedRect(48,218,499,32,5).fill('#edf4ef');
  pdf.fillColor(dark).font('Helvetica-Bold').fontSize(10).text('ACCOMMODATION',60,230);
  pdf.text('NIGHTS',310,230).text('RATE',390,230).text('AMOUNT',470,230);
  const description=snapshot.rooms_count+' x '+(snapshot.category||'Room')+
    (snapshot.room_name?' ('+snapshot.room_name+')':'')+' - '+snapshot.meal_plan+' basis';
  pdf.fillColor(dark).font('Helvetica').fontSize(10).text(description,60,267,{width:240});
  pdf.text(String(snapshot.nights),318,267);
  pdf.text(money(snapshot.nightly_rate_paise),372,267,{width:78,align:'right'});
  pdf.text(money(snapshot.total_paise),462,267,{width:84,align:'right'});
  pdf.moveTo(48,317).lineTo(547,317).strokeColor('#e5ebe6').stroke();
  const summary=[['Taxable amount',snapshot.taxable_paise],['GST (illustrative 5%)',snapshot.gst_paise],
    ['Total including GST',snapshot.total_paise],['Advance received',snapshot.paid_paise],['Balance due',snapshot.due_paise]];
  let y=340;
  for(const [name,amount] of summary){
    const highlight=name==='Balance due';
    pdf.fillColor(highlight?dark:muted).font(highlight?'Helvetica-Bold':'Helvetica').fontSize(highlight?12:10)
      .text(name,308,y,{width:150});
    pdf.text(money(amount),450,y,{width:97,align:'right'});
    y+=30;
  }
  pdf.fillColor(dark).font('Helvetica-Bold').fontSize(10).text('TERMS & CONDITIONS',48,530);
  pdf.fillColor(muted).font('Helvetica').fontSize(8).text(FIXED_TERMS,48,552,{width:498,lineGap:3});
  pdf.fillColor(muted).fontSize(8).text('Proforma only. Not a GST tax invoice.',48,775,{align:'center',width:499});
  pdf.end();
}
