import express from 'express';
import jwt from 'jsonwebtoken';
import { q } from './service-db.js';

const router=express.Router();
const clean=v=>v==null?null:String(v).trim();
const num=v=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;
function secret(){if(!process.env.SERVICE_JWT_SECRET)throw new Error('SERVICE_JWT_SECRET is required');return process.env.SERVICE_JWT_SECRET}
function auth(req,res,next){try{const raw=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');if(!raw)return res.status(401).json({error:'Login required'});req.user=jwt.verify(raw,secret());next()}catch{return res.status(401).json({error:'Session expired or invalid'})}}
const sid=()=>String(process.env.TWILIO_ACCOUNT_SID||'').trim();
const token=()=>String(process.env.TWILIO_AUTH_TOKEN||'').trim();
const serviceNumber=()=>String(process.env.TWILIO_SERVICE_PHONE_NUMBER||'').trim();

async function loadBill(id){
  const w=(await q(`SELECT w.*,concat_ws(' ',c.first_name,c.last_name) customer_name,c.phone,c.email,c.street,c.street2,c.city,c.state,c.zip,
    e.equipment_type,e.brand,e.model,e.serial_number
    FROM service_work_orders w
    JOIN service_customers c ON c.id=w.customer_id
    LEFT JOIN service_equipment e ON e.id=w.equipment_id
    WHERE w.id=$1`,[id])).rows[0];
  if(!w)return null;
  let invoice=(await q('SELECT * FROM service_invoices WHERE work_order_id=$1 ORDER BY created_at DESC LIMIT 1',[id])).rows[0]||null;
  const subtotal=num(w.diagnostic_amount)+num(w.labor_amount)+num(w.parts_amount)+num(w.trip_amount),tax=num(w.tax_amount),total=num(subtotal+tax);
  if(!invoice){
    const invoiceNo=`SVC-${new Date().getFullYear()}-${Date.now().toString().slice(-7)}`;
    invoice=(await q(`INSERT INTO service_invoices(invoice_number,work_order_id,customer_id,status,subtotal,tax_amount,total_amount,amount_paid)
      VALUES($1,$2,$3,'open',$4,$5,$6,0) RETURNING *`,[invoiceNo,w.id,w.customer_id,subtotal,tax,total])).rows[0];
  }else{
    invoice=(await q(`UPDATE service_invoices SET subtotal=$2,tax_amount=$3,total_amount=$4,status=CASE WHEN amount_paid >= $4 THEN 'paid' WHEN amount_paid>0 THEN 'partial' ELSE 'open' END,updated_at=NOW() WHERE id=$1 RETURNING *`,[invoice.id,subtotal,tax,total])).rows[0];
  }
  const payments=(await q('SELECT amount,payment_method,received_at FROM service_payments WHERE invoice_id=$1 ORDER BY received_at DESC',[invoice.id])).rows;
  return{workOrder:w,invoice,balance:num(Number(invoice.total_amount)-Number(invoice.amount_paid||0)),payments};
}
function billText(x){
  const w=x.workOrder,i=x.invoice;
  const lines=[
    'Hot Tub Factory Outlet Service',
    `Invoice ${i.invoice_number}`,
    `Customer: ${w.customer_name||''}`,
    `Work Order: ${w.work_order_number||''}`,
    [w.equipment_type,w.brand,w.model].filter(Boolean).join(' '),
    w.complaint?`Service request: ${w.complaint}`:'',
    w.diagnosis?`Diagnosis: ${w.diagnosis}`:'',
    w.work_performed?`Work performed: ${w.work_performed}`:'',
    `Diagnostic: $${num(w.diagnostic_amount).toFixed(2)}`,
    `Labor: $${num(w.labor_amount).toFixed(2)}`,
    `Parts: $${num(w.parts_amount).toFixed(2)}`,
    `Trip: $${num(w.trip_amount).toFixed(2)}`,
    `Tax: $${num(w.tax_amount).toFixed(2)}`,
    `Total: $${num(i.total_amount).toFixed(2)}`,
    `Paid: $${num(i.amount_paid).toFixed(2)}`,
    `Balance due: $${num(x.balance).toFixed(2)}`
  ].filter(Boolean);
  return lines.join('\n');
}
async function sendSms(to,body){
  if(!sid()||!token()||!serviceNumber())throw new Error('Service texting is not configured yet');
  const form=new URLSearchParams({To:to,From:serviceNumber(),Body:body});
  const r=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid())}/Messages.json`,{method:'POST',headers:{Authorization:'Basic '+Buffer.from(sid()+':'+token()).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:form});
  const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.message||('Twilio returned '+r.status));return j;
}
async function sendEmail(to,subject,body,name){
  const key=String(process.env.BREVO_API_KEY||'').trim(),from=String(process.env.SERVICE_FROM_EMAIL||process.env.CRM_FROM_EMAIL||process.env.FULFILLMENT_FROM_EMAIL||'').trim();
  if(!key||!from)throw new Error('Service email sender is not configured');
  const senderName=String(process.env.SERVICE_FROM_NAME||'Hot Tub Factory Outlet Service');
  const r=await fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'api-key':key,'Content-Type':'application/json'},body:JSON.stringify({sender:{email:from,name:senderName},replyTo:{email:from,name:senderName},to:[{email:to,name:name||to}],subject,textContent:body})});
  const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.message||('Brevo returned '+r.status));return j;
}

router.post('/work-orders/:id/bill/prepare',auth,async(req,res)=>{try{const x=await loadBill(req.params.id);if(!x)return res.status(404).json({error:'Work order not found'});res.json(x)}catch(e){res.status(500).json({error:e.message})}});

router.post('/work-orders/:id/bill/send',auth,async(req,res)=>{try{
  const channel=clean(req.body?.channel)||'email',x=await loadBill(req.params.id);if(!x)return res.status(404).json({error:'Work order not found'});
  const text=billText(x),sent=[];
  if((channel==='sms'||channel==='both')&&x.workOrder.phone){const m=await sendSms(x.workOrder.phone,`HTFO Service invoice ${x.invoice.invoice_number}: balance due $${num(x.balance).toFixed(2)}. Reply to this text with any questions.\n\n${text}`);sent.push({channel:'sms',id:m.sid})}
  if((channel==='email'||channel==='both')&&x.workOrder.email){const m=await sendEmail(x.workOrder.email,`HTFO Service Invoice ${x.invoice.invoice_number}`,text,x.workOrder.customer_name);sent.push({channel:'email',id:m.messageId||null})}
  if(!sent.length)return res.status(400).json({error:'Customer does not have a usable destination for that channel'});
  res.json({ok:true,sent,invoice:x.invoice,balance:x.balance});
}catch(e){res.status(502).json({error:e.message})}});

export default router;