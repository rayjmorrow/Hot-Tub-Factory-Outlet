import PDFDocument from 'pdfkit';

const USD=cents=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(cents||0)/100);
const ink='#14283d',muted='#556578',line='#d7e0e8',blue='#11648b';
export async function renderProfessionalSignedAgreement(d,id,sign){
 return new Promise((resolve,reject)=>{
  const pdf=new PDFDocument({size:'LETTER',margin:40,autoFirstPage:false,bufferPages:true,info:{Title:'HTFO Executed Sales Agreement '+id,Author:'Hot Tub Factory Outlet'}});
  const parts=[];pdf.on('data',x=>parts.push(x));pdf.on('error',reject);pdf.on('end',()=>resolve(Buffer.concat(parts)));
  const left=40,right=572,width=532;
  const txt=(t,x,y,w,opts={})=>pdf.font(opts.bold?'Helvetica-Bold':'Helvetica').fontSize(opts.size||9).fillColor(opts.color||ink).text(String(t??''),x,y,{width:w,lineBreak:false,...opts});
  const rule=y=>pdf.moveTo(left,y).lineTo(right,y).strokeColor(line).lineWidth(.7).stroke();
  const section=(label,y)=>{pdf.rect(left,y,width,20).fill('#eef3f7');txt(label.toUpperCase(),left+10,y+5,width-20,{size:9,bold:true,color:blue});return y+27};
  const two=(a,av,b,bv,y)=>{txt(a,left+3,y,115,{size:8,color:muted});txt(av,left+120,y,140,{size:9,bold:true});txt(b,left+277,y,88,{size:8,color:muted});txt(bv,left+367,y,160,{size:9,bold:true});return y+20};
  const pageHeader=(sub)=>{pdf.addPage();pdf.rect(0,0,612,10).fill(blue);txt('HOT TUB FACTORY OUTLET',left,25,355,{size:18,bold:true});txt('MONROEVILLE  •  WEXFORD',left,48,270,{size:8,color:muted});txt(sub,right-220,33,220,{size:10,bold:true,align:'right'});rule(66)};
  pageHeader('SIGNED AGREEMENT #'+id);
  let y=79;
  y=section('Customer & sale information',y);
  y=two('Customer',sign.customer_name,'Salesperson',sign.salesperson_name,y);
  y=two('Email',d.customer.email||'—','Phone',d.customer.phone||'—',y);
  const address=[d.customer.street,d.customer.city,d.customer.state,d.customer.zip].filter(Boolean).join(', ');
  txt('Address',left+3,y,115,{size:8,color:muted});txt(address||'—',left+120,y,410,{size:9});y+=20;
  y=two('Store / event',d.location||'Not specified','Agreement date',d.contract_date||'—',y);
  y+=5;y=section('Spa configuration',y);
  y=two('Manufacturer',d.spa.brand,'Model',d.spa.model,y);
  y=two('Acrylic / shell',d.spa.shell||'—','Cabinet',d.spa.cabinet||'—',y);
  y=two('Serial number',d.spa.serial||'Not yet assigned','Financing',d.finance?.bank||'None',y);
  if(d.spa.manufacturer_add_ons){txt('Factory add-ons: '+d.spa.manufacturer_add_ons,left+3,y,520,{size:8.5});y+=20}
  y+=4;y=section('Purchase details',y);
  const priceLine=(label,amount,accent=false)=>{
   if(accent)pdf.rect(left,y-3,width,23).fill('#e7f1f6');
   txt(label,left+9,y,380,{size:9,bold:accent});
   txt(USD(amount),right-148,y,137,{size:9,bold:accent,align:'right'});
   y+=20;
  };
  priceLine('Spa MSRP / list price',d.msrp);
  if(d.discount)priceLine('Negotiated sale discount',-d.discount);
  priceLine('Spa selling price',d.msrp-d.discount);
  const items=d.items||[];
  if(items.length){y+=3;txt('ACCESSORIES & OPTIONS',left+9,y,320,{size:8,bold:true,color:muted});y+=17;
    for(const item of items){if(y>505){pdf.addPage();y=54}const desc=(item.quantity||1)+' × '+item.description;
      txt(desc,left+12,y,382,{size:8.3});txt(USD((item.quantity||1)*item.unit_price),right-148,y,137,{size:8.3,align:'right'});y+=16;}
  }
  y+=6;rule(y);y+=9;
  priceLine('Subtotal',d.totals.subtotal);priceLine('Sales tax',d.totals.tax);priceLine('TOTAL PURCHASE PRICE',d.totals.total,true);
  priceLine('Payments recorded',d.totals.paid);priceLine('BALANCE DUE',d.totals.balance,true);
  if(d.notes){y+=7;txt('SALE NOTES',left+3,y,160,{size:8,bold:true,color:muted});y+=14;pdf.font('Helvetica').fontSize(8).fillColor(ink).text(d.notes,left+3,y,{width:525});y=pdf.y+7}
  if(y>595){pdf.addPage();y=70}
  y+=10;rule(y);y+=12;
  txt('ALL SALES FINAL — NO REFUNDS, RETURNS OR EXCHANGES',left,y,width,{size:10,bold:true,color:'#a92b30',align:'center'});y+=23;
  txt('The attached Terms & Conditions are incorporated into this signed purchase agreement.',left+5,y,width-10,{size:8,align:'center'});y+=25;
  const signY=Math.max(y,620);
  const boxW=252,boxH=66;
  for(const [x,name,signature,title] of [[left,sign.customer_name,sign.customer_png,'CUSTOMER SIGNATURE'],[left+280,sign.salesperson_name,sign.salesperson_png,'SALESPERSON SIGNATURE']]){
   txt(title,x,signY,boxW,{size:8,bold:true,color:muted});
   pdf.roundedRect(x,signY+15,boxW,boxH,5).lineWidth(.8).strokeColor(line).stroke();
   pdf.image(signature,x+10,signY+20,{fit:[boxW-20,boxH-11],align:'left',valign:'center'});
   txt(name,x+3,signY+85,boxW-5,{size:9,bold:true});
  }
  txt('Electronically executed • '+new Date().toISOString()+' • Terms version '+sign.terms_version,left,746,width,{size:7.5,color:muted});
  // Preserve the approved terms verbatim. Layout changes do not rewrite legal provisions.
  const termLines=String(sign.terms_text||'').replace(/\r\n/g,'\n').split(/\n\s*\n/).map(p=>p.trim()).filter(Boolean);
  const termSection=/^(?:[IVX]+\.\s|PURCHASE AGREEMENT TERMS)/i;
  pageHeader('TERMS & CONDITIONS');
  let ty=82;
  txt('INCORPORATED INTO EXECUTED SALES AGREEMENT #'+id,left,ty,width,{size:9,bold:true,color:blue});ty+=21;
  for(const paragraph of termLines){
   const heading=termSection.test(paragraph),font=heading?'Helvetica-Bold':'Helvetica',size=heading?9.1:8.6,leading=heading?11.5:11.8;
   const h=pdf.font(font).fontSize(size).heightOfString(paragraph,{width:width-12,lineGap:1,leading});
   if(ty+h+7>740){pageHeader('TERMS & CONDITIONS');ty=82}
   pdf.font(font).fontSize(size).fillColor(ink).text(paragraph,left+6,ty,{width:width-12,lineGap:1,leading});
   ty=pdf.y+(heading?8:5);
  }
  const pages=pdf.bufferedPageRange();
  for(let i=0;i<pages.count;i++){pdf.switchToPage(i);rule(752);txt('HOT TUB FACTORY OUTLET  •  AGREEMENT #'+id,left,760,380,{size:7.5,color:muted});txt('Page '+(i+1)+' of '+pages.count,481,760,90,{size:7.5,color:muted,align:'right'})}
  pdf.end();
 });
}
