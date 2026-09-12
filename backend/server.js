import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import {installVoucherRoutes} from './vouchers.js';
import {ensureCustomerProfile,profileSummary,signToken,verifyToken,addMonthsISO,occurrencesFor} from './autoship-account.js';

const app=express();
const port=Number(process.env.PORT||8787);
const allowed=(process.env.ALLOWED_ORIGIN||'https://rayjmorrow.github.io,https://hottubfactoryoutlet.com,https://www.hottubfactoryoutlet.com').split(',').map(x=>x.trim());
app.use(cors({origin:(o,cb)=>!o||allowed.includes(o)?cb(null,true):cb(new Error('Origin not allowed'))}));
app.use(express.json({limit:'256kb'}));
installVoucherRoutes(app);

const money=n=>Math.round((Number(n)||0)*100)/100;
const taxjarBase=process.env.TAXJAR_SANDBOX==='true'?'https://api.sandbox.taxjar.com/v2':'https://api.taxjar.com/v2';
const authApi=process.env.AUTHORIZE_SANDBOX==='true'?'https://apitest.authorize.net/xml/v1/request.api':'https://api.authorize.net/xml/v1/request.api';
const authForm=process.env.AUTHORIZE_SANDBOX==='true'?'https://test.authorize.net/payment/payment':'https://accept.authorize.net/payment/payment';
const customerForm=process.env.AUTHORIZE_SANDBOX==='true'?'https://test.authorize.net/customer/manage':'https://accept.authorize.net/customer/manage';
const authLoginId=process.env.AUTHORIZE_API_LOGIN_ID||process.env.AUTHORIZENET_API_LOGIN_ID;
const authTransactionKey=process.env.AUTHORIZE_TRANSACTION_KEY||process.env.AUTHORIZENET_TRANSACTION_KEY;

function requireEnv(names){const missing=names.filter(x=>!process.env[x]||process.env[x]==='replace_me');if(missing.length)throw new Error(`Missing server configuration: ${missing.join(', ')}`)}
function auth(){if(!authLoginId||!authTransactionKey)throw new Error('Authorize.Net is not configured');return{name:authLoginId,transactionKey:authTransactionKey}}

function employeeDirectory(){
  const defaults={BILL10:{name:'Bill',id:'bill'},RICK10:{name:'Rick',id:'rick'},RAY10:{name:'Ray',id:'ray'},GINA10:{name:'Gina',id:'gina'}};
  let raw={};try{raw=JSON.parse(process.env.EMPLOYEE_CODES_JSON||'{}')}catch{raw={}}
  raw={...defaults,...raw};const out={};
  for(const [code,value] of Object.entries(raw)){
    const key=String(code||'').trim().toUpperCase();if(!key)continue;
    const name=typeof value==='string'?value:value?.name;
    const id=typeof value==='object'&&value?.id?String(value.id):String(name||key).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
    if(name)out[key]={code:key,employeeName:String(name),employeeId:id};
  }
  return out;
}
function employeeForCode(code){const key=String(code||'').trim().toUpperCase();return key?(employeeDirectory()[key]||null):null}
function orderAttribution(body){const code=body?.employeeAttribution?.code;if(!code)return null;const hit=employeeForCode(code);if(!hit)throw new Error('Employee code is no longer valid. Please remove it or enter a current code.');return hit}

function cleanItems(items){
  if(!Array.isArray(items)||!items.length)throw new Error('Cart is empty');
  return items.map((x,i)=>({id:String(x.id||x.sku||`item-${i+1}`).slice(0,31),name:String(x.name||'Item').slice(0,31),description:String(x.name||'Item').slice(0,255),quantity:Math.max(1,Number(x.qty)||1),original_price:money(x.originalPrice??x.price),autoship:Boolean(x.autoship),frequencyMonths:Number(x.frequencyMonths)||null}));
}
function priceItems(items,attribution){return items.map(x=>{const discountRate=attribution?0.10:(x.autoship?0.05:0);const autoshipLockedDiscount=x.autoship&&attribution?0.10:(x.autoship?0.05:0);return{...x,discountRate,autoshipLockedDiscount,unit_price:money(x.original_price*(1-discountRate))}})}
function customer(b){const a=b.shippingAddress||{};return{first:String(b.first||'').trim(),last:String(b.last||'').trim(),email:String(b.email||'').trim(),phone:String(b.phone||'').trim(),street:String(a.street||'').trim(),street2:String(a.street2||'').trim(),city:String(a.city||'').trim(),state:String(a.state||'').trim().toUpperCase(),zip:String(a.zip||'').trim(),country:'US'}}
function validateShip(c){for(const k of ['first','last','email','street','city','state','zip'])if(!c[k])throw new Error(`Missing ${k}`)}
function monroeville(){return{street:process.env.SHIP_FROM_STREET||'4680 Old William Penn Hwy',street2:'',city:process.env.SHIP_FROM_CITY||'Monroeville',state:process.env.SHIP_FROM_STATE||'PA',zip:process.env.SHIP_FROM_ZIP||'15146',country:'US'}}
function wexford(){return{street:process.env.WEXFORD_STORE_STREET||'10269 Perry Hwy',street2:'',city:process.env.WEXFORD_STORE_CITY||'Wexford',state:process.env.WEXFORD_STORE_STATE||'PA',zip:process.env.WEXFORD_STORE_ZIP||'15090',country:'US'}}
function destinationFor(body,c){if(body.fulfillment==='pickup-monroeville')return monroeville();if(body.fulfillment==='pickup-wexford')return wexford();return c}
function shippingFor(body,items){if(String(body.fulfillment||'').startsWith('pickup'))return 0;const merchandise=money(items.reduce((s,x)=>s+x.quantity*x.unit_price,0));return merchandise>=100?0:14.95}

async function anet(body){
  const r=await fetch(authApi,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||j?.messages?.resultCode!=='Ok'){
    const code=j?.messages?.message?.[0]?.code||'';
    const text=j?.messages?.message?.[0]?.text||`Authorize.Net returned ${r.status}`;
    const e=new Error(`${code?code+': ':''}${text}`);e.code=code;throw e;
  }
  return j;
}

async function taxForOrder(body){
  requireEnv(['TAXJAR_API_KEY','SHIP_FROM_STATE','SHIP_FROM_ZIP','SHIP_FROM_CITY','SHIP_FROM_STREET']);
  const attribution=orderAttribution(body),items=priceItems(cleanItems(body.items),attribution),c=customer(body);validateShip(c);
  const dest=destinationFor(body,c),shipping=shippingFor(body,items);
  const payload={from_country:'US',from_zip:process.env.SHIP_FROM_ZIP,from_state:process.env.SHIP_FROM_STATE,from_city:process.env.SHIP_FROM_CITY,from_street:process.env.SHIP_FROM_STREET,to_country:'US',to_zip:dest.zip,to_state:dest.state,to_city:dest.city,to_street:[dest.street,dest.street2].filter(Boolean).join(' '),shipping,line_items:items.map(x=>({id:x.id,name:x.name,quantity:x.quantity,unit_price:x.unit_price}))};
  const r=await fetch(`${taxjarBase}/taxes`,{method:'POST',headers:{Authorization:`Bearer ${process.env.TAXJAR_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(payload)}),j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j?.detail||j?.error||`TaxJar returned ${r.status}`);
  return{items,customer:c,destination:dest,shipping,tax:money(j.tax?.amount_to_collect||0),rate:Number(j.tax?.rate||0),hasNexus:j.tax?.has_nexus!==false,taxableAmount:money(j.tax?.taxable_amount||0),attribution};
}

async function findUnsettledByInvoice(invoice){
  const j=await anet({getUnsettledTransactionListRequest:{merchantAuthentication:auth()}});
  const raw=j.transactions?.transaction??j.transactions??[];
  const list=Array.isArray(raw)?raw:[raw];
  return list.find(x=>String(x?.invoiceNumber||x?.order?.invoiceNumber||'')===String(invoice))||null;
}

async function transactionDetails(transId){return (await anet({getTransactionDetailsRequest:{merchantAuthentication:auth(),transId:String(transId)}})).transaction||{}}

function normalizeProfileIds(tx,fallbackProfileId){
  const p=tx.profile||{};
  return{customerProfileId:String(p.customerProfileId||fallbackProfileId||''),customerPaymentProfileId:String(p.customerPaymentProfileId||'')};
}

async function createRecurringGroup({profileId,paymentProfileId,frequencyMonths,groupBody,invoice,employeeCode}){
  const priced=await taxForOrder(groupBody);
  const merchandise=money(priced.items.reduce((s,x)=>s+x.quantity*x.unit_price,0));
  const amount=money(merchandise+priced.shipping+priced.tax);
  const startDate=addMonthsISO(frequencyMonths);
  const totalOccurrences=occurrencesFor(frequencyMonths);
  const names=priced.items.map(x=>x.name).join(', ').slice(0,42);
  const name=`HTFO AutoShip ${names}`.slice(0,50);
  try{
    const j=await anet({ARBCreateSubscriptionRequest:{merchantAuthentication:auth(),refId:String(invoice).slice(0,20),subscription:{name,paymentSchedule:{interval:{length:Number(frequencyMonths),unit:'months'},startDate,totalOccurrences,trialOccurrences:0},amount,profile:{customerProfileId:String(profileId),customerPaymentProfileId:String(paymentProfileId)},order:{invoiceNumber:String(invoice).slice(0,20),description:`HTFO AutoShip ${employeeCode?`employee ${employeeCode}`:'standard'} · ${frequencyMonths} month cadence`.slice(0,255)}}}});
    return{subscriptionId:String(j.subscriptionId||''),frequencyMonths:Number(frequencyMonths),amount,startDate,totalOccurrences,items:priced.items.map(x=>({id:x.id,name:x.name,quantity:x.quantity,discountPercent:Math.round(x.autoshipLockedDiscount*100)}))};
  }catch(e){
    if(String(e.code||'').toUpperCase()==='E00012'||/duplicate/i.test(e.message||''))return{duplicate:true,frequencyMonths:Number(frequencyMonths),amount,startDate,items:priced.items.map(x=>({id:x.id,name:x.name,quantity:x.quantity,discountPercent:Math.round(x.autoshipLockedDiscount*100)}))};
    throw e;
  }
}

app.get('/health',(q,s)=>s.json({ok:true,taxjar:process.env.TAXJAR_SANDBOX==='true'?'sandbox':'production',authorize:process.env.AUTHORIZE_SANDBOX==='true'?'sandbox':'production',authorizeConfigured:Boolean(authLoginId&&authTransactionKey),customerProfiles:true,accountTokens:Boolean(process.env.ACCOUNT_TOKEN_SECRET),webhookEndpoint:true,employeeCodes:Object.keys(employeeDirectory()).length,shippingPolicy:'$14.95 under $100; free at $100+'}));

app.post('/employee-code/validate',(req,res)=>{try{const hit=employeeForCode(req.body?.code);if(!hit)return res.json({valid:false});res.json({valid:true,...hit,discountPercent:10,autoshipDiscountPercent:10,autoshipDiscountPersistsUntilCancel:true})}catch(e){res.status(400).json({valid:false,error:e.message})}});

app.post('/customer/profile',async(req,res)=>{try{const id=await ensureCustomerProfile(anet,auth,req.body?.email);res.json({ok:true,customerProfileId:id})}catch(e){res.status(400).json({ok:false,error:e.message})}});

app.post('/account/summary',async(req,res)=>{
  try{const token=verifyToken(req.body?.token);if(token.kind!=='account')throw new Error('Invalid account token');const profile=await profileSummary(anet,auth,token.profileId);res.json({ok:true,profile,autoship:token.autoship||[],employeeAttribution:token.employeeAttribution||null})}catch(e){res.status(401).json({ok:false,error:e.message})}
});

app.post('/account/manage-token',async(req,res)=>{
  try{const token=verifyToken(req.body?.token);if(token.kind!=='account')throw new Error('Invalid account token');const j=await anet({getHostedProfilePageRequest:{merchantAuthentication:auth(),customerProfileId:String(token.profileId),hostedProfileSettings:{setting:[{settingName:'hostedProfileReturnUrl',settingValue:process.env.STORE_ACCOUNT_RETURN_URL||'https://hottubfactoryoutlet.com/account.html'},{settingName:'hostedProfileReturnUrlText',settingValue:'Return to My HTFO Account'},{settingName:'hostedProfileManageOptions',settingValue:'showAll'},{settingName:'hostedProfilePaymentOptions',settingValue:'showCreditCard'}]}}});res.json({ok:true,token:j.token,formUrl:customerForm})}catch(e){res.status(401).json({ok:false,error:e.message})}
});

app.post('/account/cancel-autoship',async(req,res)=>{
  try{
    const token=verifyToken(req.body?.token);if(token.kind!=='account')throw new Error('Invalid account token');
    const id=String(req.body?.subscriptionId||'');
    const allowedIds=(token.autoship||[]).map(x=>String(x.subscriptionId||'')).filter(Boolean);
    if(!allowedIds.includes(id))throw new Error('Subscription not found in this account');
    await anet({ARBCancelSubscriptionRequest:{merchantAuthentication:auth(),subscriptionId:id}});
    const autoship=(token.autoship||[]).filter(x=>String(x.subscriptionId)!==id);
    const next=signToken({kind:'account',profileId:token.profileId,email:token.email,autoship,employeeAttribution:token.employeeAttribution||null});
    res.json({ok:true,token:next,autoship});
  }catch(e){res.status(400).json({ok:false,error:e.message})}
});

app.post('/account/activate',async(req,res)=>{
  try{
    const t=verifyToken(req.body?.token);if(t.kind!=='autoship-checkout')throw new Error('Invalid AutoShip activation token');
    const hit=await findUnsettledByInvoice(t.invoice);if(!hit)throw new Error('Payment is still being confirmed. Please try again in a few seconds.');
    const transId=hit.transId||hit.id;const tx=await transactionDetails(transId);
    if(String(tx.transactionStatus||'').toLowerCase().includes('declin'))throw new Error('The payment was not approved.');
    const ids=normalizeProfileIds(tx,t.profileId);
    if(!ids.customerProfileId)throw new Error('Authorize.Net customer profile was not attached to this payment');
    let paymentProfileId=ids.customerPaymentProfileId;
    if(!paymentProfileId){const p=await profileSummary(anet,auth,ids.customerProfileId);paymentProfileId=p.paymentProfiles?.[0]?.id||'';}
    if(!paymentProfileId)throw new Error('Your card was charged, but the saved payment profile is still being created. Try again in a few seconds.');
    const groups=new Map();
    for(const x of (t.items||[]).filter(x=>x.autoship)){
      const f=Number(x.frequencyMonths)||1;if(!groups.has(f))groups.set(f,[]);groups.get(f).push(x);
    }
    const autoship=[];
    for(const [frequencyMonths,items] of groups){
      const groupBody={items,first:t.customer.first,last:t.customer.last,email:t.customer.email,phone:t.customer.phone,fulfillment:t.fulfillment,shippingAddress:t.shippingAddress,employeeAttribution:t.employeeAttribution||null};
      autoship.push(await createRecurringGroup({profileId:ids.customerProfileId,paymentProfileId,frequencyMonths,groupBody,invoice:t.invoice,employeeCode:t.employeeAttribution?.code||''}));
    }
    const accountToken=signToken({kind:'account',profileId:ids.customerProfileId,email:t.customer.email,autoship,employeeAttribution:t.employeeAttribution||null});
    const profile=await profileSummary(anet,auth,ids.customerProfileId);
    res.json({ok:true,accountToken,profile,autoship,transactionId:String(transId)});
  }catch(e){res.status(400).json({ok:false,error:e.message})}
});

app.post('/customer/manage-token',async(req,res)=>{res.status(410).json({ok:false,error:'Use the signed My HTFO Account payment-management flow.'})});

app.post('/authorize/webhook',async(req,res)=>{res.sendStatus(200);try{console.log('AUTHORIZE_WEBHOOK',JSON.stringify(req.body||{}))}catch(e){console.error('Webhook processing error',e)}});

app.post('/tax',async(req,res)=>{try{const t=await taxForOrder(req.body);res.json({tax:t.tax,shipping:t.shipping,rate:t.rate,hasNexus:t.hasNexus,taxableAmount:t.taxableAmount,employeeAttribution:t.attribution})}catch(e){res.status(400).json({error:e.message})}});

app.post('/checkout/session',async(req,res)=>{
  try{
    const t=await taxForOrder(req.body),merchandise=money(t.items.reduce((s,x)=>s+x.quantity*x.unit_price,0)),total=money(merchandise+t.shipping+t.tax);if(total<=0)throw new Error('Order total must be greater than zero');
    const invoice=`HTFO-${Date.now()}`.slice(0,20),hasAutoship=t.items.some(x=>x.autoship),purchaseDiscount=t.attribution?10:0,autoshipDiscount=hasAutoship?(t.attribution?10:5):0,attributionText=t.attribution?` | Employee: ${t.attribution.employeeName} (${t.attribution.code})`:'';
    let customerProfileId='',activationToken='',returnUrl=process.env.STORE_RETURN_URL||'https://hottubfactoryoutlet.com/account.html';
    if(hasAutoship){
      customerProfileId=await ensureCustomerProfile(anet,auth,t.customer.email);
      activationToken=signToken({kind:'autoship-checkout',invoice,profileId:customerProfileId,items:req.body.items,customer:t.customer,fulfillment:req.body.fulfillment,shippingAddress:req.body.shippingAddress,employeeAttribution:req.body.employeeAttribution||null},60*60*24);
      returnUrl=`https://hottubfactoryoutlet.com/account.html?activate=${encodeURIComponent(activationToken)}`;
    }
    const userField=[{name:'Purchase Discount',value:purchaseDiscount?`${purchaseDiscount}% employee code`:'None'},{name:'AutoShip Savings',value:hasAutoship?`${autoshipDiscount}%`:'None'},{name:'AutoShip Discount Policy',value:hasAutoship&&t.attribution?'10% of current price until canceled':hasAutoship?'5% standard AutoShip':'None'}];
    if(t.attribution)userField.push({name:'Employee Code',value:t.attribution.code},{name:'Employee Name',value:t.attribution.employeeName},{name:'Employee ID',value:t.attribution.employeeId});
    const d=t.destination;
    const transactionRequest={transactionType:'authCaptureTransaction',amount:total,order:{invoiceNumber:invoice,description:(hasAutoship?'HTFO order with AutoShip enrollment':'HTFO online order')+attributionText},lineItems:{lineItem:t.items.map(x=>({itemId:x.id,name:x.name,description:x.autoship?`${x.description} | AutoShip ${Math.round(x.autoshipLockedDiscount*100)}% of current price until canceled | every ${x.frequencyMonths} months`:x.description,quantity:x.quantity,unitPrice:x.unit_price,taxable:true}))},tax:{amount:t.tax,name:'Sales Tax'},shipping:{amount:t.shipping,name:'Shipping'},billTo:{firstName:t.customer.first,lastName:t.customer.last,address:t.customer.street,city:t.customer.city,state:t.customer.state,zip:t.customer.zip,country:'US',email:t.customer.email},shipTo:{firstName:t.customer.first,lastName:t.customer.last,address:d.street,city:d.city,state:d.state,zip:d.zip,country:'US'},userFields:{userField}};
    if(hasAutoship)transactionRequest.profile={customerProfileId};else transactionRequest.customer={email:t.customer.email};
    const request={getHostedPaymentPageRequest:{merchantAuthentication:auth(),transactionRequest,hostedPaymentSettings:{setting:[{settingName:'hostedPaymentReturnOptions',settingValue:JSON.stringify({showReceipt:true,url:returnUrl,urlText:hasAutoship?'Finish AutoShip & Open My Account':'Return to Hot Tub Factory Outlet',cancelUrl:process.env.STORE_CANCEL_URL||'https://hottubfactoryoutlet.com/cart.html',cancelUrlText:'Cancel'})},{settingName:'hostedPaymentCustomerOptions',settingValue:JSON.stringify({showEmail:true,requiredEmail:true,addPaymentProfile:hasAutoship})},{settingName:'hostedPaymentPaymentOptions',settingValue:JSON.stringify({cardCodeRequired:true,showCreditCard:true,showBankAccount:false})}]}}};
    const j=await anet(request);if(!j.token)throw new Error('Authorize.Net did not return a payment token');
    res.json({token:j.token,formUrl:authForm,invoice,merchandise,shipping:t.shipping,tax:t.tax,total,autoship:hasAutoship,purchaseDiscount,autoshipDiscount,autoshipDiscountPersistsUntilCancel:Boolean(hasAutoship&&t.attribution),employeeAttribution:t.attribution,customerProfileId:hasAutoship?customerProfileId:null});
  }catch(e){res.status(400).json({error:e.message})}
});

app.listen(port,()=>console.log(`HTFO store backend listening on ${port}`));
