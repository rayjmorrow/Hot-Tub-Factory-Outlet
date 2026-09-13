import express from 'express';
import jwt from 'jsonwebtoken';
import { q } from './service-db.js';
import { calculateTripCharge } from './service-financials.js';

const router=express.Router();
const clean=v=>v==null?null:String(v).trim();
const num=v=>Number(v||0);
const money=v=>Math.round(num(v)*100)/100;
function secret(){if(!process.env.SERVICE_JWT_SECRET)throw new Error('SERVICE_JWT_SECRET is required');return process.env.SERVICE_JWT_SECRET}
function auth(req,res,next){try{const raw=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');if(!raw)return res.status(401).json({error:'Login required'});req.user=jwt.verify(raw,secret());next()}catch{res.status(401).json({error:'Session expired or invalid'})}}
function manager(req,res,next){if(!['admin','owner','manager','service_manager'].includes(String(req.user?.role||'').toLowerCase()))return res.status(403).json({error:'Ray/Rick manager permission required'});next()}

const authLoginId=()=>process.env.AUTHORIZE_API_LOGIN_ID||process.env.AUTHORIZENET_API_LOGIN_ID;
const authTransactionKey=()=>process.env.AUTHORIZE_TRANSACTION_KEY||process.env.AUTHORIZENET_TRANSACTION_KEY;
const authApi=()=>process.env.AUTHORIZE_SANDBOX==='true'?'https://apitest.authorize.net/xml/v1/request.api':'https://api.authorize.net/xml/v1/request.api';
const authForm=()=>process.env.AUTHORIZE_SANDBOX==='true'?'https://test.authorize.net/payment/payment':'https://accept.authorize.net/payment/payment';
function merchantAuth(){if(!authLoginId()||!authTransactionKey())throw new Error('Authorize.Net is not configured');return{name:authLoginId(),transactionKey:authTransactionKey()}}
async function anet(body){const r=await fetch(authApi(),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),j=await r.json().catch(()=>({}));if(!r.ok||j?.messages?.resultCode!=='Ok')throw new Error(j?.messages?.message?.[0]?.text||`Authorize.Net returned ${r.status}`);return j}

router.get('/trip-charge/preview',auth,(req,res)=>{
  const minutes=Math.max(0,num(req.query.minutes));
  res.json({travel_minutes:minutes,calculated_trip_charge:calculateTripCharge(minutes),rule:'$80 through 30 minutes; then +$15 per additional 15-minute block'});
});

router.patch('/work-orders/:id/trip-charge',auth,manager,async(req,res)=>{
  const minutes=Math.max(0,num(req.body?.travel_minutes));
  const override=req.body?.override_amount===null||req.body?.override_amount===''||req.body?.override_amount===undefined?null:Math.max(0,num(req.body.override_amount));
  const reason=clean(req.body?.override_reason), source=clean(req.body?.travel_time_source)||'manager_entered';
  const calc=calculateTripCharge(minutes);
  const r=await q(`UPDATE service_work_orders SET travel_minutes=$2,calculated_trip_charge=$3,trip_charge_override=$4,trip_charge_override_reason=$5,travel_time_source=$6,trip_amount=$7,updated_at=NOW() WHERE id=$1 RETURNING id,work_order_number,travel_minutes,calculated_trip_charge,trip_charge_override,trip_charge_override_reason,trip_amount,travel_time_source`,[req.params.id,minutes,calc,override,reason,source,override??calc]);
  if(!r.rowCount)return res.status(404).json({error:'Work order not found'});
  res.json(r.rows[0]);
});

router.get('/invoices/:id/field',auth,async(req,res)=>{
  const inv=await q(`SELECT i.*,w.work_order_number,concat_ws(' ',c.first_name,c.last_name) customer_name,c.email,c.phone,(i.total_amount-i.amount_paid) balance FROM service_invoices i LEFT JOIN service_work_orders w ON w.id=i.work_order_id JOIN service_customers c ON c.id=i.customer_id WHERE i.id=$1`,[req.params.id]);
  if(!inv.rowCount)return res.status(404).json({error:'Invoice not found'});
  const pays=await q(`SELECT id,amount,payment_method,reference_number,authorize_transaction_id,collected_by_name,collected_in_field,notes,received_at FROM service_payments WHERE invoice_id=$1 ORDER BY received_at DESC,id DESC`,[req.params.id]);
  res.json({invoice:inv.rows[0],payments:pays.rows});
});

router.post('/invoices/:id/payments',auth,async(req,res)=>{
  const method=String(req.body?.payment_method||'').toLowerCase();
  if(!['cash','check'].includes(method))return res.status(400).json({error:'Field manual payments must be cash or check'});
  const inv=(await q('SELECT * FROM service_invoices WHERE id=$1',[req.params.id])).rows[0];
  if(!inv)return res.status(404).json({error:'Invoice not found'});
  const balance=Math.max(0,money(num(inv.total_amount)-num(inv.amount_paid)));
  const amount=money(req.body?.amount);
  if(amount<=0)return res.status(400).json({error:'Payment amount must be greater than zero'});
  if(amount>balance+0.001)return res.status(400).json({error:`Payment exceeds remaining balance of ${balance.toFixed(2)}`});
  const reference=clean(req.body?.reference_number),notes=clean(req.body?.notes);
  if(method==='check'&&!reference)return res.status(400).json({error:'Check number is required for check payments'});
  const p=await q(`INSERT INTO service_payments(invoice_id,work_order_id,customer_id,amount,payment_method,reference_number,collected_by_user_id,collected_by_name,collected_in_field,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,true,$9) RETURNING *`,[inv.id,inv.work_order_id,inv.customer_id,amount,method,reference,req.user?.sub||null,req.user?.name||req.user?.username||'HTFO staff',notes]);
  const updated=await q(`UPDATE service_invoices SET amount_paid=amount_paid+$2,payment_method=$3,status=CASE WHEN amount_paid+$2>=total_amount THEN 'paid' ELSE 'partial' END,paid_at=CASE WHEN amount_paid+$2>=total_amount THEN NOW() ELSE paid_at END,updated_at=NOW() WHERE id=$1 RETURNING *,total_amount-amount_paid balance`,[inv.id,amount,method]);
  res.status(201).json({payment:p.rows[0],invoice:updated.rows[0]});
});

router.post('/invoices/:id/card-checkout',auth,async(req,res)=>{
  const inv=(await q(`SELECT i.*,concat_ws(' ',c.first_name,c.last_name) customer_name,c.first_name,c.last_name,c.email,c.street,c.city,c.state,c.zip FROM service_invoices i JOIN service_customers c ON c.id=i.customer_id WHERE i.id=$1`,[req.params.id])).rows[0];
  if(!inv)return res.status(404).json({error:'Invoice not found'});
  const balance=money(num(inv.total_amount)-num(inv.amount_paid));
  if(balance<=0)return res.status(400).json({error:'Invoice is already paid'});
  const requested=req.body?.amount==null?balance:money(req.body.amount);
  if(requested<=0||requested>balance+0.001)return res.status(400).json({error:'Card amount must be greater than zero and no more than the invoice balance'});
  try{
    const returnUrl=process.env.SERVICE_PAYMENT_RETURN_URL||'https://hottubfactoryoutlet.com/service-field.html';
    const cancelUrl=process.env.SERVICE_PAYMENT_CANCEL_URL||returnUrl;
    const request={getHostedPaymentPageRequest:{merchantAuthentication:merchantAuth(),transactionRequest:{transactionType:'authCaptureTransaction',amount:requested,order:{invoiceNumber:String(inv.invoice_number).slice(0,20),description:`HTFO Service ${inv.invoice_number}`},customer:{email:inv.email||undefined},billTo:{firstName:inv.first_name||'',lastName:inv.last_name||'',address:inv.street||'',city:inv.city||'',state:inv.state||'',zip:inv.zip||'',country:'US'}},hostedPaymentSettings:{setting:[{settingName:'hostedPaymentReturnOptions',settingValue:JSON.stringify({showReceipt:true,url:returnUrl,urlText:'Return to HTFO Service',cancelUrl,cancelUrlText:'Cancel'})},{settingName:'hostedPaymentCustomerOptions',settingValue:JSON.stringify({showEmail:true,requiredEmail:false})},{settingName:'hostedPaymentPaymentOptions',settingValue:JSON.stringify({cardCodeRequired:true,showCreditCard:true,showBankAccount:false})}]}}};
    const j=await anet(request);
    if(!j.token)throw new Error('Authorize.Net did not return a payment token');
    res.json({token:j.token,form_url:authForm(),invoice_id:inv.id,invoice_number:inv.invoice_number,amount:requested,balance});
  }catch(e){res.status(400).json({error:e.message})}
});

router.post('/invoices/:id/card-payment-record',auth,async(req,res)=>{
  const inv=(await q('SELECT * FROM service_invoices WHERE id=$1',[req.params.id])).rows[0];
  if(!inv)return res.status(404).json({error:'Invoice not found'});
  const amount=money(req.body?.amount),transactionId=clean(req.body?.authorize_transaction_id);
  if(amount<=0||!transactionId)return res.status(400).json({error:'Card amount and Authorize.Net transaction ID are required'});
  const duplicate=await q('SELECT id FROM service_payments WHERE authorize_transaction_id=$1 LIMIT 1',[transactionId]);
  if(duplicate.rowCount)return res.status(409).json({error:'This card transaction is already recorded'});
  const balance=Math.max(0,money(num(inv.total_amount)-num(inv.amount_paid)));
  if(amount>balance+0.001)return res.status(400).json({error:'Card payment exceeds invoice balance'});
  const p=await q(`INSERT INTO service_payments(invoice_id,work_order_id,customer_id,amount,payment_method,authorize_transaction_id,collected_by_user_id,collected_by_name,collected_in_field,notes) VALUES($1,$2,$3,$4,'card',$5,$6,$7,true,$8) RETURNING *`,[inv.id,inv.work_order_id,inv.customer_id,amount,transactionId,req.user?.sub||null,req.user?.name||req.user?.username||'HTFO staff',clean(req.body?.notes)]);
  const updated=await q(`UPDATE service_invoices SET amount_paid=amount_paid+$2,payment_method='card',status=CASE WHEN amount_paid+$2>=total_amount THEN 'paid' ELSE 'partial' END,paid_at=CASE WHEN amount_paid+$2>=total_amount THEN NOW() ELSE paid_at END,updated_at=NOW() WHERE id=$1 RETURNING *,total_amount-amount_paid balance`,[inv.id,amount]);
  res.status(201).json({payment:p.rows[0],invoice:updated.rows[0]});
});

router.get('/warranty-claims',auth,async(req,res)=>{
  const status=clean(req.query.status);
  const params=[];let where='';if(status){params.push(status);where='WHERE wc.status=$1'}
  const r=await q(`SELECT wc.*,w.work_order_number,concat_ws(' ',c.first_name,c.last_name) customer_name,(wc.total_claimed-wc.total_paid) outstanding FROM service_warranty_claims wc JOIN service_work_orders w ON w.id=wc.work_order_id JOIN service_customers c ON c.id=w.customer_id ${where} ORDER BY wc.created_at DESC LIMIT 500`,params);
  res.json(r.rows);
});

router.post('/work-orders/:id/warranty-claim',auth,manager,async(req,res)=>{
  const b=req.body||{};
  const labor=num(b.labor_claimed),parts=num(b.parts_claimed),trip=num(b.trip_claimed),other=num(b.other_claimed),total=labor+parts+trip+other;
  const r=await q(`INSERT INTO service_warranty_claims(work_order_id,supplier,claim_number,status,labor_claimed,parts_claimed,trip_claimed,other_claimed,total_claimed,total_approved,total_paid,submitted_at,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,[req.params.id,clean(b.supplier),clean(b.claim_number),clean(b.status)||'draft',labor,parts,trip,other,total,num(b.total_approved),num(b.total_paid),b.submitted_at||null,clean(b.notes)]);
  res.status(201).json(r.rows[0]);
});

router.patch('/warranty-claims/:id',auth,manager,async(req,res)=>{
  const b=req.body||{};
  const r=await q(`UPDATE service_warranty_claims SET claim_number=coalesce($2,claim_number),status=coalesce($3,status),total_approved=coalesce($4,total_approved),total_paid=coalesce($5,total_paid),submitted_at=coalesce($6,submitted_at),approved_at=coalesce($7,approved_at),paid_at=coalesce($8,paid_at),payment_reference=coalesce($9,payment_reference),denial_reason=coalesce($10,denial_reason),notes=coalesce($11,notes),updated_at=NOW() WHERE id=$1 RETURNING *`,[req.params.id,clean(b.claim_number),clean(b.status),b.total_approved==null?null:num(b.total_approved),b.total_paid==null?null:num(b.total_paid),b.submitted_at||null,b.approved_at||null,b.paid_at||null,clean(b.payment_reference),clean(b.denial_reason),clean(b.notes)]);
  if(!r.rowCount)return res.status(404).json({error:'Warranty claim not found'});
  res.json(r.rows[0]);
});

router.get('/warranty-summary',auth,async(req,res)=>{
  const r=await q(`SELECT coalesce(sum(total_claimed),0)::numeric claimed,coalesce(sum(total_approved),0)::numeric approved,coalesce(sum(total_paid),0)::numeric paid,coalesce(sum(total_claimed-total_paid),0)::numeric outstanding,count(*) FILTER (WHERE status NOT IN ('paid','denied','closed'))::int open_claims FROM service_warranty_claims`);
  res.json(r.rows[0]);
});

router.post('/orders/:id/payment-link',auth,async(req,res)=>{
  const order=(await q(`SELECT o.*,c.first_name,c.last_name,c.email,c.phone
    FROM service_customer_orders o JOIN service_customers c ON c.id=o.customer_id
    WHERE o.id=$1`,[req.params.id])).rows[0];
  if(!order)return res.status(404).json({error:'Order not found'});
  const balance=Math.max(0,money(num(order.total_amount)-num(order.amount_paid)));
  if(balance<=0)return res.status(400).json({error:'This order is already paid in full'});
  const token=jwt.sign({type:'order_balance_payment',order_id:order.id,customer_id:order.customer_id},secret(),{expiresIn:'7d'});
  const base=process.env.SERVICE_ORDER_PAYMENT_URL||'https://service.hottubfactoryoutlet.com/order-payment.html';
  const url=`${base}${base.includes('?')?'&':'?'}t=${encodeURIComponent(token)}`;
  res.json({url,balance,order_number:order.order_number,customer_name:[order.first_name,order.last_name].filter(Boolean).join(' '),email:order.email,phone:order.phone,expires_in_days:7});
});

router.post('/public/order-payment/session',async(req,res)=>{
  try{
    const decoded=jwt.verify(String(req.body?.token||''),secret());
    if(decoded?.type!=='order_balance_payment')return res.status(400).json({error:'Invalid payment link'});
    const order=(await q(`SELECT o.*,c.first_name,c.last_name,c.email,c.street,c.city,c.state,c.zip
      FROM service_customer_orders o JOIN service_customers c ON c.id=o.customer_id
      WHERE o.id=$1 AND o.customer_id=$2`,[decoded.order_id,decoded.customer_id])).rows[0];
    if(!order)return res.status(404).json({error:'Order not found'});
    const balance=Math.max(0,money(num(order.total_amount)-num(order.amount_paid)));
    if(balance<=0)return res.json({paid:true,order_number:order.order_number,balance:0});
    const returnUrl=(process.env.SERVICE_ORDER_PAYMENT_URL||'https://service.hottubfactoryoutlet.com/order-payment.html')+'?complete=1';
    const request={getHostedPaymentPageRequest:{merchantAuthentication:merchantAuth(),transactionRequest:{transactionType:'authCaptureTransaction',amount:balance,order:{invoiceNumber:String(order.order_number||order.id).slice(0,20),description:`HTFO spa balance ${order.order_number||order.id}`},customer:{email:order.email||undefined},billTo:{firstName:order.first_name||'',lastName:order.last_name||'',address:order.street||'',city:order.city||'',state:order.state||'',zip:order.zip||'',country:'US'}},hostedPaymentSettings:{setting:[{settingName:'hostedPaymentReturnOptions',settingValue:JSON.stringify({showReceipt:true,url:returnUrl,urlText:'Return to Hot Tub Factory Outlet',cancelUrl:returnUrl,cancelUrlText:'Cancel'})},{settingName:'hostedPaymentCustomerOptions',settingValue:JSON.stringify({showEmail:true,requiredEmail:false})},{settingName:'hostedPaymentPaymentOptions',settingValue:JSON.stringify({cardCodeRequired:true,showCreditCard:true,showBankAccount:false})}]}}};
    const j=await anet(request);
    if(!j.token)throw new Error('Authorize.Net did not return a payment token');
    res.json({paid:false,token:j.token,form_url:authForm(),balance,order_number:order.order_number});
  }catch(e){res.status(400).json({error:e.message==='jwt expired'?'This payment link has expired':e.message})}
});

router.post('/orders/:id/payment-record',auth,manager,async(req,res)=>{
  const order=(await q('SELECT * FROM service_customer_orders WHERE id=$1',[req.params.id])).rows[0];
  if(!order)return res.status(404).json({error:'Order not found'});
  const amount=money(req.body?.amount);
  if(amount<=0)return res.status(400).json({error:'Payment amount must be greater than zero'});
  const balance=Math.max(0,money(num(order.total_amount)-num(order.amount_paid)));
  if(amount>balance+0.001)return res.status(400).json({error:'Payment exceeds remaining balance'});
  const updated=(await q(`UPDATE service_customer_orders
    SET amount_paid=least(total_amount,amount_paid+$2),
        status=CASE WHEN amount_paid+$2>=total_amount THEN 'paid' ELSE status END,
        updated_at=NOW()
    WHERE id=$1 RETURNING *,total_amount-amount_paid balance`,[order.id,amount])).rows[0];
  await q(`INSERT INTO service_order_change_log(customer_id,order_id,action,description,actor)
    VALUES($1,$2,'payment_recorded',$3,$4)`,[order.customer_id,order.id,`Recorded payment ${amount.toFixed(2)}; balance ${Number(updated.balance||0).toFixed(2)}`,req.user?.name||req.user?.username||'Manager']);
  res.json(updated);
});

export default router;
