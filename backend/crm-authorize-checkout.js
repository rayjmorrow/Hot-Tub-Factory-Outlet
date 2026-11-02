import express from 'express';
import {randomBytes,createHash} from 'node:crypto';
export const paymentSchema=q=>q(`CREATE TABLE IF NOT EXISTS crm_authorize_payment_requests(
 id BIGSERIAL PRIMARY KEY,draft_id BIGINT NOT NULL REFERENCES crm_sales_drafts(id),
 secret_hash TEXT UNIQUE NOT NULL,invoice TEXT UNIQUE NOT NULL,amount_cents INTEGER NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL,status TEXT NOT NULL DEFAULT 'pending',
 processor_transaction_id TEXT UNIQUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 confirmed_at TIMESTAMPTZ)`);
export function anetCredentials(){
 const login=process.env.AUTHNET_API_LOGIN_ID,key=process.env.AUTHNET_TRANSACTION_KEY,signature=process.env.AUTHNET_SIGNATURE_KEY;
 if(!login||!key||!signature)throw Error('Authorize.net merchant credentials and webhook signature key are not configured');
 return {login,key,signature,test:process.env.AUTHNET_SANDBOX==='true'};
}
export async function anetApi(merchant,body){
 const url=merchant.test?'https://apitest.authorize.net/xml/v1/request.api':'https://api.authorize.net/xml/v1/request.api';
 const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error('Authorize.net service unavailable');
 return JSON.parse((await r.text()).replace(/^\uFEFF/,''));
}
export function authorizePaymentLinks({q,guard,salesIdentity,ensureSalesDrafts,validateSalesDraft,email,sms,opted}){
 const router=express.Router(),hash=x=>createHash('sha256').update(String(x)).digest('hex');
 router.post('/sales-drafts/:id/payment-link',...guard,salesIdentity,async(req,res)=>{
  try{
   anetCredentials();await ensureSalesDrafts();await paymentSchema(q);
   const draft=(await q('SELECT * FROM crm_sales_drafts WHERE id=$1',[req.params.id])).rows[0];
   if(!draft)return res.status(404).json({error:'Agreement not found'});
   if(!['admin','owner'].includes(req.user.role)&&String(draft.owner_user_id)!==String(req.user.sub))return res.status(403).json({error:'Not authorized'});
   const d=validateSalesDraft(draft.document),amount=Number(req.body.amount_cents),channel=req.body.channel;
   if(!Number.isSafeInteger(amount)||amount<100||amount>d.totals.balance)throw Error('Amount must be between $1 and the outstanding balance');
   if(!['email','sms'].includes(channel))throw Error('Choose email or text');
   const to=channel==='email'?d.customer.email:d.customer.phone;if(!to)throw Error('Customer contact information missing');
   if(channel==='sms'&&await opted(to))throw Error('Customer opted out of texts');
   const secret=randomBytes(32).toString('hex'),invoice='H'+draft.id+'-'+randomBytes(5).toString('hex');
   await q("INSERT INTO crm_authorize_payment_requests(draft_id,secret_hash,invoice,amount_cents,expires_at) VALUES($1,$2,$3,$4,NOW()+INTERVAL '7 days')",[draft.id,hash(secret),invoice,amount]);
   const link='https://htfo-service-operations.onrender.com/api/service/crm/v1/pay/checkout/'+secret;
   const body='Secure payment request from Hot Tub Factory Outlet for agreement #'+draft.id+'. Amount: $'+(amount/100).toFixed(2)+'. Pay directly through Authorize.net: '+link+' (valid 7 days).';
   try{if(channel==='sms')await sms(to,body);else await email(to,'Secure HTFO payment request #'+draft.id,body,d.customer.first_name,req.user,d.submission_id||null)}
   catch(e){await q("UPDATE crm_authorize_payment_requests SET status='delivery_failed' WHERE invoice=$1",[invoice]);throw e}
   res.json({sent:true,channel,to,invoice,amount_cents:amount});
  }catch(e){res.status(400).json({error:e.message})}
 });
 router.get('/pay/checkout/:secret',async(req,res)=>{
  res.set('Cache-Control','no-store').set('Referrer-Policy','no-referrer');
  try{
   const token=req.params.secret;if(!/^[a-f0-9]{64}$/.test(token))return res.status(410).send('Payment link unavailable');
   await paymentSchema(q);const payment=(await q("SELECT p.*,d.document FROM crm_authorize_payment_requests p JOIN crm_sales_drafts d ON d.id=p.draft_id WHERE p.secret_hash=$1 AND p.status='pending' AND p.expires_at>NOW()",[hash(token)])).rows[0];
   if(!payment)return res.status(410).send('Payment link expired, paid, or unavailable');
   const d=validateSalesDraft(payment.document);if(payment.amount_cents>d.totals.balance)return res.status(409).send('Balance changed. Request a new payment link from HTFO.');
   const m=anetCredentials();
   const settings=[{settingName:'hostedPaymentReturnOptions',settingValue:JSON.stringify({showReceipt:true,url:'https://hottubfactoryoutlet.com',urlText:'Return to HTFO'})},{settingName:'hostedPaymentPaymentOptions',settingValue:JSON.stringify({showCreditCard:true,showBankAccount:false})}];
   const result=await anetApi(m,{getHostedPaymentPageRequest:{merchantAuthentication:{name:m.login,transactionKey:m.key},transactionRequest:{transactionType:'authCaptureTransaction',amount:(payment.amount_cents/100).toFixed(2),order:{invoiceNumber:payment.invoice,description:'HTFO Agreement #'+payment.draft_id},customer:{email:d.customer.email}},hostedPaymentSettings:{setting:settings}}});
   if(result.messages?.resultCode!=='Ok'||!result.token)throw Error('Payment checkout unavailable');
   const action=m.test?'https://test.authorize.net/payment/payment':'https://accept.authorize.net/payment/payment';
   res.type('html').send('<!doctype html><html><head><meta name="referrer" content="no-referrer"></head><body><p>Redirecting to secure Authorize.net checkout…</p><form id="pay" method="post" action="'+action+'"><input type="hidden" name="token" value="'+String(result.token).replace(/&/g,'&amp;').replace(/"/g,'&quot;')+'"></form><script>document.getElementById("pay").submit()</script></body></html>');
  }catch(e){res.status(503).send('Secure checkout is temporarily unavailable. Please contact HTFO.')}
 });
 return router;
}
