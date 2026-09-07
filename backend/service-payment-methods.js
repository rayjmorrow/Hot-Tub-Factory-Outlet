import express from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { q } from './service-db.js';

const router=express.Router();
const clean=v=>v==null?null:String(v).trim();
const num=v=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;
function secret(){if(!process.env.SERVICE_JWT_SECRET)throw new Error('SERVICE_JWT_SECRET is required');return process.env.SERVICE_JWT_SECRET}
function auth(req,res,next){try{const raw=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');if(!raw)return res.status(401).json({error:'Login required'});req.user=jwt.verify(raw,secret());next()}catch{res.status(401).json({error:'Session expired or invalid'})}}
function manager(req,res,next){if(!['admin','owner','manager','service_manager'].includes(req.user?.role))return res.status(403).json({error:'Service manager permission required'});next()}
const authLoginId=()=>process.env.AUTHORIZE_API_LOGIN_ID||process.env.AUTHORIZENET_API_LOGIN_ID;
const authTransactionKey=()=>process.env.AUTHORIZE_TRANSACTION_KEY||process.env.AUTHORIZENET_TRANSACTION_KEY;
const authApi=()=>process.env.AUTHORIZE_SANDBOX==='true'?'https://apitest.authorize.net/xml/v1/request.api':'https://api.authorize.net/xml/v1/request.api';
const customerForm=()=>process.env.AUTHORIZE_SANDBOX==='true'?'https://test.authorize.net/customer/manage':'https://accept.authorize.net/customer/manage';
function merchantAuth(){if(!authLoginId()||!authTransactionKey())throw new Error('Authorize.Net is not configured');return{name:authLoginId(),transactionKey:authTransactionKey()}}
async function anet(body){const r=await fetch(authApi(),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),j=await r.json().catch(()=>({}));if(!r.ok||j?.messages?.resultCode!=='Ok')throw new Error(j?.messages?.message?.[0]?.text||`Authorize.Net returned ${r.status}`);return j}
async function anetRaw(body){const r=await fetch(authApi(),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j?.messages?.message?.[0]?.text||`Authorize.Net returned ${r.status}`);return j}
const authorizationText='I authorize Hot Tub Factory Outlet to securely keep my payment method on file with its payment processor and to charge that payment method for authorized service work and resulting service invoices. I understand I will receive a receipt for charges made.';

export async function initServicePaymentMethods(){
  await q(`
    CREATE TABLE IF NOT EXISTS service_customer_payment_settings (
      customer_id BIGINT PRIMARY KEY REFERENCES service_customers(id) ON DELETE CASCADE,
      payment_status TEXT NOT NULL DEFAULT 'needed',
      authorize_customer_profile_id TEXT,
      authorize_payment_profile_id TEXT,
      card_brand TEXT,
      card_last_four TEXT,
      authorization_text TEXT,
      authorization_name TEXT,
      authorization_ip TEXT,
      authorization_user_agent TEXT,
      authorized_at TIMESTAMPTZ,
      cash_check_approved_by_user_id BIGINT REFERENCES service_users(id),
      cash_check_approved_by_name TEXT,
      cash_check_approved_at TIMESTAMPTZ,
      cash_check_note TEXT,
      last_charged_at TIMESTAMPTZ,
      last_charge_amount NUMERIC(12,2),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS service_payment_authorization_links (
      id BIGSERIAL PRIMARY KEY,
      customer_id BIGINT NOT NULL REFERENCES service_customers(id) ON DELETE CASCADE,
      token_hash TEXT UNIQUE NOT NULL,
      created_by_user_id BIGINT REFERENCES service_users(id),
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS service_card_charge_attempts (
      id BIGSERIAL PRIMARY KEY,
      invoice_id BIGINT NOT NULL REFERENCES service_invoices(id) ON DELETE CASCADE,
      work_order_id BIGINT REFERENCES service_work_orders(id),
      customer_id BIGINT NOT NULL REFERENCES service_customers(id),
      amount NUMERIC(12,2) NOT NULL,
      status TEXT NOT NULL,
      processor_response_code TEXT,
      processor_message TEXT,
      authorize_transaction_id TEXT,
      attempted_by_user_id BIGINT REFERENCES service_users(id),
      attempted_by_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_service_payment_auth_links_customer ON service_payment_authorization_links(customer_id);
    CREATE INDEX IF NOT EXISTS idx_service_payment_auth_links_expiry ON service_payment_authorization_links(expires_at);
    CREATE INDEX IF NOT EXISTS idx_service_card_attempts_invoice ON service_card_charge_attempts(invoice_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_service_card_attempts_customer ON service_card_charge_attempts(customer_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_service_card_attempts_status ON service_card_charge_attempts(status,created_at DESC);
  `);
}

async function ensureSetting(customerId){await q(`INSERT INTO service_customer_payment_settings(customer_id) VALUES($1) ON CONFLICT(customer_id) DO NOTHING`,[customerId]);return (await q('SELECT * FROM service_customer_payment_settings WHERE customer_id=$1',[customerId])).rows[0]}
function hashToken(t){return crypto.createHash('sha256').update(t).digest('hex')}
async function tokenRecord(token){const h=hashToken(token);return (await q(`SELECT l.*,c.first_name,c.last_name,c.email,c.phone FROM service_payment_authorization_links l JOIN service_customers c ON c.id=l.customer_id WHERE l.token_hash=$1 AND l.expires_at>NOW()`,[h])).rows[0]}
async function logChargeAttempt({inv,amount,status,code,message,transactionId,user}){
  await q(`INSERT INTO service_card_charge_attempts(invoice_id,work_order_id,customer_id,amount,status,processor_response_code,processor_message,authorize_transaction_id,attempted_by_user_id,attempted_by_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[inv.id,inv.work_order_id,inv.customer_id,amount,status,clean(code),clean(message)?.slice(0,500)||null,clean(transactionId),user?.sub||null,user?.name||user?.username||'HTFO manager']);
}

router.get('/customers/:id/payment-method',auth,async(req,res)=>{
  const c=(await q('SELECT id,first_name,last_name,email,phone FROM service_customers WHERE id=$1',[req.params.id])).rows[0];
  if(!c)return res.status(404).json({error:'Customer not found'});
  const s=await ensureSetting(c.id);
  res.json({customer:c,payment:{status:s.payment_status,card_brand:s.card_brand,card_last_four:s.card_last_four,authorized_at:s.authorized_at,cash_check_approved_by_name:s.cash_check_approved_by_name,cash_check_approved_at:s.cash_check_approved_at,cash_check_note:s.cash_check_note,last_charged_at:s.last_charged_at,last_charge_amount:s.last_charge_amount}});
});

router.post('/customers/:id/payment-authorization-link',auth,manager,async(req,res)=>{
  const c=(await q('SELECT id FROM service_customers WHERE id=$1',[req.params.id])).rows[0];
  if(!c)return res.status(404).json({error:'Customer not found'});
  await ensureSetting(c.id);
  const raw=crypto.randomBytes(32).toString('base64url'),days=Math.min(30,Math.max(1,Number(req.body?.expires_days)||7));
  await q(`INSERT INTO service_payment_authorization_links(customer_id,token_hash,created_by_user_id,expires_at) VALUES($1,$2,$3,NOW()+($4||' days')::interval)`,[c.id,hashToken(raw),req.user?.sub||null,String(days)]);
  const base=(process.env.SERVICE_CARD_AUTH_URL||'https://hottubfactoryoutlet.com/service-card-authorization.html').replace(/\?+$/,'');
  res.status(201).json({url:`${base}?token=${encodeURIComponent(raw)}`,expires_days:days});
});

router.patch('/customers/:id/payment-cash-check',auth,manager,async(req,res)=>{
  const approved=Boolean(req.body?.approved),note=clean(req.body?.note);
  await ensureSetting(req.params.id);
  const r=await q(`UPDATE service_customer_payment_settings SET payment_status=$2,cash_check_approved_by_user_id=$3,cash_check_approved_by_name=$4,cash_check_approved_at=CASE WHEN $2='cash_check_approved' THEN NOW() ELSE NULL END,cash_check_note=$5,updated_at=NOW() WHERE customer_id=$1 RETURNING *`,[req.params.id,approved?'cash_check_approved':'needed',approved?(req.user?.sub||null):null,approved?(req.user?.name||req.user?.username||'HTFO manager'):null,note]);
  res.json(r.rows[0]);
});

router.get('/payment-authorization/:token',async(req,res)=>{
  const rec=await tokenRecord(req.params.token);
  if(!rec)return res.status(404).json({error:'This authorization link is invalid or has expired'});
  const s=await ensureSetting(rec.customer_id);
  res.json({customer:{name:[rec.first_name,rec.last_name].filter(Boolean).join(' '),email:rec.email,phone:rec.phone},status:s.payment_status,authorization_text:authorizationText});
});

router.post('/payment-authorization/:token/start',async(req,res)=>{
  try{
    const rec=await tokenRecord(req.params.token);
    if(!rec)return res.status(404).json({error:'This authorization link is invalid or has expired'});
    if(req.body?.accepted!==true)return res.status(400).json({error:'Authorization must be accepted before adding a card'});
    const name=clean(req.body?.authorization_name);
    if(!name)return res.status(400).json({error:'Please type the cardholder/authorized customer name'});
    let s=await ensureSetting(rec.customer_id),profileId=s.authorize_customer_profile_id;
    if(!profileId){
      const merchantCustomerId=`HTFO-${rec.customer_id}`.slice(0,20);
      try{const j=await anet({createCustomerProfileRequest:{merchantAuthentication:merchantAuth(),profile:{merchantCustomerId,email:rec.email||undefined,description:'HTFO service customer'},validationMode:'liveMode'}});profileId=j.customerProfileId}catch(e){
        const msg=String(e.message||'');
        const ids=msg.match(/ID\s+(\d+)/i);if(ids)profileId=ids[1];else throw e;
      }
      if(profileId)await q('UPDATE service_customer_payment_settings SET authorize_customer_profile_id=$2,updated_at=NOW() WHERE customer_id=$1',[rec.customer_id,profileId]);
    }
    if(!profileId)throw new Error('Unable to create payment profile');
    await q(`UPDATE service_customer_payment_settings SET authorization_text=$2,authorization_name=$3,authorization_ip=$4,authorization_user_agent=$5,authorized_at=NOW(),updated_at=NOW() WHERE customer_id=$1`,[rec.customer_id,authorizationText,name,clean(req.ip),clean(req.get('user-agent'))]);
    const returnBase=(process.env.SERVICE_CARD_AUTH_URL||'https://hottubfactoryoutlet.com/service-card-authorization.html');
    const returnUrl=`${returnBase}?token=${encodeURIComponent(req.params.token)}&returned=1`;
    const j=await anet({getHostedProfilePageRequest:{merchantAuthentication:merchantAuth(),customerProfileId:String(profileId),hostedProfileSettings:{setting:[{settingName:'hostedProfileReturnUrl',settingValue:returnUrl},{settingName:'hostedProfileReturnUrlText',settingValue:'Return to Hot Tub Factory Outlet'},{settingName:'hostedProfileManageOptions',settingValue:'showPayment'},{settingName:'hostedProfilePaymentOptions',settingValue:'showCreditCard'}]}}});
    res.json({token:j.token,form_url:customerForm()});
  }catch(e){res.status(400).json({error:e.message})}
});

router.post('/payment-authorization/:token/complete',async(req,res)=>{
  try{
    const rec=await tokenRecord(req.params.token);
    if(!rec)return res.status(404).json({error:'This authorization link is invalid or has expired'});
    const s=await ensureSetting(rec.customer_id);
    if(!s.authorize_customer_profile_id)return res.status(400).json({error:'Payment profile has not been started'});
    const j=await anet({getCustomerProfileRequest:{merchantAuthentication:merchantAuth(),customerProfileId:String(s.authorize_customer_profile_id),includeIssuerInfo:true}});
    const profiles=j?.profile?.paymentProfiles||[];
    const list=Array.isArray(profiles)?profiles:[profiles];
    const p=list.filter(Boolean).at(-1);
    if(!p?.customerPaymentProfileId)return res.status(400).json({error:'No card was found. Please add a card and try again.'});
    const card=p.payment?.creditCard||{};
    const masked=String(card.cardNumber||''),last4=masked.replace(/\D/g,'').slice(-4)||masked.slice(-4);
    const brand=clean(card.cardType)||'Card';
    await q(`UPDATE service_customer_payment_settings SET payment_status='card_on_file',authorize_payment_profile_id=$2,card_brand=$3,card_last_four=$4,updated_at=NOW() WHERE customer_id=$1`,[rec.customer_id,String(p.customerPaymentProfileId),brand,last4]);
    await q('UPDATE service_payment_authorization_links SET used_at=NOW() WHERE id=$1',[rec.id]);
    res.json({ok:true,status:'card_on_file',card_brand:brand,card_last_four:last4});
  }catch(e){res.status(400).json({error:e.message})}
});

router.get('/invoices/:id/card-charge-attempts',auth,manager,async(req,res)=>{
  const rows=(await q(`SELECT id,amount,status,processor_response_code,processor_message,authorize_transaction_id,attempted_by_name,created_at FROM service_card_charge_attempts WHERE invoice_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100`,[req.params.id])).rows;
  res.json(rows);
});

router.post('/invoices/:id/charge-card-on-file',auth,manager,async(req,res)=>{
  const inv=(await q(`SELECT i.*,c.email,concat_ws(' ',c.first_name,c.last_name) customer_name,s.authorize_customer_profile_id,s.authorize_payment_profile_id,s.card_brand,s.card_last_four,s.authorization_name,s.authorized_at FROM service_invoices i JOIN service_customers c ON c.id=i.customer_id LEFT JOIN service_customer_payment_settings s ON s.customer_id=i.customer_id WHERE i.id=$1`,[req.params.id])).rows[0];
  if(!inv)return res.status(404).json({error:'Invoice not found'});
  if(!inv.authorize_customer_profile_id||!inv.authorize_payment_profile_id)return res.status(400).json({error:'Customer does not have a card on file'});
  if(!inv.authorized_at)return res.status(400).json({error:'Customer card authorization is not recorded'});
  const balance=num(Number(inv.total_amount)-Number(inv.amount_paid)),amount=req.body?.amount==null?balance:num(req.body.amount);
  if(amount<=0||amount>balance+0.001)return res.status(400).json({error:'Charge must be greater than zero and no more than the invoice balance'});
  try{
    const j=await anetRaw({createTransactionRequest:{merchantAuthentication:merchantAuth(),refId:String(inv.invoice_number).slice(0,20),transactionRequest:{transactionType:'authCaptureTransaction',amount,profile:{customerProfileId:String(inv.authorize_customer_profile_id),paymentProfile:{paymentProfileId:String(inv.authorize_payment_profile_id)}},order:{invoiceNumber:String(inv.invoice_number).slice(0,20),description:`HTFO Service ${inv.invoice_number}`},customer:{email:inv.email||undefined}}}});
    const tr=j?.transactionResponse||{};
    const approved=String(tr.responseCode||'')==='1'&&Boolean(tr.transId)&&String(tr.transId)!=='0';
    const processorCode=clean(tr.errors?.[0]?.errorCode)||clean(tr.responseCode)||clean(j?.messages?.message?.[0]?.code);
    const processorMessage=clean(tr.errors?.[0]?.errorText)||clean(tr.messages?.[0]?.description)||clean(j?.messages?.message?.[0]?.text)||(approved?'Approved':'Card charge was not approved');
    if(!approved){
      await logChargeAttempt({inv,amount,status:'declined',code:processorCode,message:processorMessage,transactionId:tr.transId,user:req.user});
      return res.status(402).json({ok:false,declined:true,error:'Card declined — payment not collected',reason:processorMessage,processor_code:processorCode,invoice_id:inv.id,invoice_number:inv.invoice_number,amount,card_brand:inv.card_brand,card_last_four:inv.card_last_four});
    }
    const duplicate=await q('SELECT id FROM service_payments WHERE authorize_transaction_id=$1',[String(tr.transId)]);
    if(duplicate.rowCount)return res.status(409).json({error:'This transaction is already recorded'});
    const p=await q(`INSERT INTO service_payments(invoice_id,work_order_id,customer_id,amount,payment_method,authorize_transaction_id,collected_by_user_id,collected_by_name,collected_in_field,notes) VALUES($1,$2,$3,$4,'card_on_file',$5,$6,$7,false,$8) RETURNING *`,[inv.id,inv.work_order_id,inv.customer_id,amount,String(tr.transId),req.user?.sub||null,req.user?.name||req.user?.username||'HTFO manager',`Card on file ${inv.card_brand||'Card'} •••• ${inv.card_last_four||''}`]);
    const updated=await q(`UPDATE service_invoices SET amount_paid=amount_paid+$2,payment_method='card_on_file',status=CASE WHEN amount_paid+$2>=total_amount THEN 'paid' ELSE 'partial' END,paid_at=CASE WHEN amount_paid+$2>=total_amount THEN NOW() ELSE paid_at END,updated_at=NOW() WHERE id=$1 RETURNING *,total_amount-amount_paid balance`,[inv.id,amount]);
    await q(`UPDATE service_customer_payment_settings SET last_charged_at=NOW(),last_charge_amount=$2,updated_at=NOW() WHERE customer_id=$1`,[inv.customer_id,amount]);
    await logChargeAttempt({inv,amount,status:'approved',code:tr.responseCode,message:processorMessage,transactionId:String(tr.transId),user:req.user});
    return res.status(201).json({ok:true,approved:true,transaction_id:String(tr.transId),processor_message:processorMessage,payment:p.rows[0],invoice:updated.rows[0],card_brand:inv.card_brand,card_last_four:inv.card_last_four});
  }catch(e){
    try{await logChargeAttempt({inv,amount,status:'error',code:null,message:e.message,transactionId:null,user:req.user})}catch{}
    return res.status(502).json({ok:false,declined:false,error:'Payment processor error — no payment was recorded',reason:e.message});
  }
});

router.get('/payment-readiness/:customerId',auth,async(req,res)=>{
  const s=await ensureSetting(req.params.customerId);
  res.json({ready:['card_on_file','cash_check_approved'].includes(s.payment_status),status:s.payment_status,card_brand:s.card_brand,card_last_four:s.card_last_four,cash_check_approved_by_name:s.cash_check_approved_by_name});
});

export default router;
