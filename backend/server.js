import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createHmac,randomBytes,randomUUID,timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {posAutoShipPage,posAutoShipScript} from './pos-autoship-page.js';
import {installVoucherRoutes} from './vouchers.js';
import {ensureCustomerProfile,profileSummary,signToken,verifyToken,addMonthsISO,occurrencesFor} from './autoship-account.js';

const app=express();
const port=Number(process.env.PORT||8787);
const allowed=(process.env.ALLOWED_ORIGIN||'https://rayjmorrow.github.io,https://hottubfactoryoutlet.com,https://www.hottubfactoryoutlet.com').split(',').map(x=>x.trim());
app.use(cors({origin:(o,cb)=>!o||allowed.includes(o)?cb(null,true):cb(new Error('Origin not allowed'))}));
app.use(express.json({limit:'256kb',verify:(req,_res,buffer)=>{if(req.path==='/authorize/webhook')req.rawBody=buffer}}));
installVoucherRoutes(app);

const money=n=>Math.round((Number(n)||0)*100)/100;
const {products: retailProducts}=JSON.parse(readFileSync(new URL('../retail-catalog.json',import.meta.url),'utf8'));
const retailCatalog=new Map();
for(const product of retailProducts){
  const key=String(product.sku||'').trim().toLowerCase();
  if(!key||retailCatalog.has(key)||!Number.isSafeInteger(product.price_cents)||product.price_cents<=0){
    throw new Error('Invalid or duplicate SKU in the published retail catalog');
  }
  retailCatalog.set(key,product);
}

const coverCatalog={
  Economy:{sku:'CVTH100',price:565},
  Bronze:{sku:'CVTH200',price:636},
  Silver:{sku:'CVTH300',price:699},
  Gold:{sku:'CVTH400',price:765},
  Platinum:{sku:'CVTH500',price:899}
};
const taxjarBase=process.env.TAXJAR_SANDBOX==='true'?'https://api.sandbox.taxjar.com/v2':'https://api.taxjar.com/v2';
const authApi=process.env.AUTHORIZE_SANDBOX==='true'?'https://apitest.authorize.net/xml/v1/request.api':'https://api.authorize.net/xml/v1/request.api';
const authForm=process.env.AUTHORIZE_SANDBOX==='true'?'https://test.authorize.net/payment/payment':'https://accept.authorize.net/payment/payment';
const customerForm=process.env.AUTHORIZE_SANDBOX==='true'?'https://test.authorize.net/customer/manage':'https://accept.authorize.net/customer/manage';
const authLoginId=process.env.AUTHORIZE_API_LOGIN_ID||process.env.AUTHORIZENET_API_LOGIN_ID;
const authTransactionKey=process.env.AUTHORIZE_TRANSACTION_KEY||process.env.AUTHORIZENET_TRANSACTION_KEY;
const ghlBase='https://services.leadconnectorhq.com';

function requireEnv(names){const missing=names.filter(x=>!process.env[x]||process.env[x]==='replace_me');if(missing.length)throw new Error(`Missing server configuration: ${missing.join(', ')}`)}
function auth(){if(!authLoginId||!authTransactionKey)throw new Error('Authorize.Net is not configured');return{name:authLoginId,transactionKey:authTransactionKey}}
function cleanText(v,max=500){return String(v??'').trim().slice(0,max)}
function validEmail(v){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)}
function ghlHeaders(){return{Authorization:`Bearer ${process.env.GHL_API_TOKEN}`,Version:'v3','Content-Type':'application/json',Accept:'application/json'}}
async function noteAuthorId(){
  if(process.env.GHL_NOTE_USER_ID)return process.env.GHL_NOTE_USER_ID;
  const locationId=process.env.GHL_LOCATION_ID;
  const lr=await fetch(`${ghlBase}/locations/${encodeURIComponent(locationId)}`,{headers:ghlHeaders()});
  const lj=await lr.json().catch(()=>({}));
  if(!lr.ok||!lj?.location?.companyId)return null;
  const qs=new URLSearchParams({companyId:lj.location.companyId,locationId,limit:'25'});
  const ur=await fetch(`${ghlBase}/users/search?${qs}`,{headers:ghlHeaders()});
  const uj=await ur.json().catch(()=>({}));
  if(!ur.ok||!Array.isArray(uj?.users))return null;
  const user=uj.users.find(x=>!x.deleted)||uj.users[0];
  return user?.id||null;
}
async function addContactNote(contactId,note){
  const body=cleanText(note,5000);if(!body)return false;
  try{const userId=await noteAuthorId();if(!userId){console.warn('Lead note skipped: no HighLevel note author found');return false;}const nr=await fetch(`${ghlBase}/contacts/${encodeURIComponent(contactId)}/notes`,{method:'POST',headers:ghlHeaders(),body:JSON.stringify({userId,body,title:'Website Lead Details',pinned:false})});if(!nr.ok){const nj=await nr.json().catch(()=>({}));console.warn('Lead note failed:',nj?.message||nj?.error||nr.status);return false;}return true;}catch(e){console.warn('Lead note failed:',e.message);return false;}
}

function employeeDirectory(){
  const defaults={STEVE10:{name:'Steve',id:'steve'},BILL10:{name:'Bill',id:'bill'},RICK10:{name:'Rick',id:'rick'},RAY10:{name:'Ray',id:'ray'},GINA10:{name:'Gina',id:'gina'}};
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
  if(!Array.isArray(items)||items.length<1||items.length>30)throw new Error('Add 1–30 products to the cart.');
  return items.map(item=>{
    const sku=String(item.sku||item.id||'').split('|')[0].trim();
    const quantity=Number(item.qty);
    if(!Number.isSafeInteger(quantity)||quantity<1||quantity>99)throw new Error('Each item must have a quantity from 1 to 99.');
    const autoship=item.autoship===true,frequencyMonths=Number(item.frequencyMonths)||null;
    if(autoship&&(!Number.isSafeInteger(frequencyMonths)||frequencyMonths<1||frequencyMonths>12)){
      throw new Error('Choose an AutoShip interval from 1 to 12 months.');
    }
    return {id:sku,quantity,autoship,frequencyMonths,cover_form_id:String(item.coverFormId||item.cover_form_id||'').trim()};
  });
}
function priceItems(items,attribution){
  return items.map(x=>{
    const discountRate=attribution?0.10:(x.autoship?0.05:0);
    return {...x,discountRate,autoshipLockedDiscount:x.autoship?discountRate:0,unit_price:money(x.original_price*(1-discountRate))};
  });
}
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

async function verifiedStoreItems(rawItems){
  const items=cleanItems(rawItems);
  const coverForms=items.map(x=>x.cover_form_id).filter(Boolean);
  if(new Set(coverForms).size!==coverForms.length)throw new Error('Each custom cover requires a separate order form.');
  return Promise.all(items.map(async x=>{
    if(!x.cover_form_id){
      const product=retailCatalog.get(x.id.toLowerCase());
      if(!product)throw new Error('An item in your cart is unavailable. Remove it before continuing.');
      return {...x,id:product.sku,name:product.name.slice(0,31),description:product.name,original_price:product.price_cents/100};
    }
    if(x.autoship||x.quantity!==1||!/^COV-[A-Z0-9]{16}$/.test(x.cover_form_id)){
      throw new Error('Each custom cover requires its own order form and a one-time purchase.');
    }
    const saved=await fulfillmentGet('/fulfillment/cover-form/'+encodeURIComponent(x.cover_form_id));
    const cover=coverCatalog[saved?.cover_model];
    if(!cover||saved.form_id!==x.cover_form_id||saved.status!=='pending_payment'||cover.sku!==saved.cover_sku){
      throw new Error('Configured cover form could not be verified.');
    }
    const name=saved.cover_model+' Custom Replacement Cover';
    return {...x,id:cover.sku,name:name.slice(0,31),description:name,original_price:money(saved.cover_price)};
  }));
}
async function taxForOrder(body){
  requireEnv(['TAXJAR_API_KEY','SHIP_FROM_STATE','SHIP_FROM_ZIP','SHIP_FROM_CITY','SHIP_FROM_STREET']);
  const attribution=orderAttribution(body),items=priceItems(await verifiedStoreItems(body.items),attribution),c=customer(body);validateShip(c);
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

async function fulfillmentPost(path,body){
  const base=String(process.env.FULFILLMENT_SERVICE_URL||'').replace(/\/$/,'');
  const secret=process.env.FULFILLMENT_WEBHOOK_SECRET||'';
  if(!base||!secret)throw Error('Fulfillment handoff is not configured');
  const r=await fetch(base+'/api/service'+path,{method:'POST',headers:{'Content-Type':'application/json','x-htfo-fulfillment-secret':secret},body:JSON.stringify(body)});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j.error||('Fulfillment handoff returned '+r.status));
  return j;
}
async function fulfillmentGet(path){
  const base=String(process.env.FULFILLMENT_SERVICE_URL||'').replace(/\/$/,'');
  const secret=process.env.FULFILLMENT_WEBHOOK_SECRET||'';
  if(!base||!secret)throw new Error('Cover form service is not configured');
  const r=await fetch(base+'/api/service'+path,{headers:{'x-htfo-fulfillment-secret':secret}});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j.error||('Cover form lookup returned '+r.status));
  return j;
}

async function persistWebsiteLead(body){
  const saved=await fulfillmentPost('/fulfillment/website-lead',body);
  if(!saved?.ok||!saved?.submission_id)throw new Error('HTFO CRM did not confirm the lead was saved');
  return saved;
}
async function updateWebsiteLeadDelivery(submissionId,delivery){
  try{return await fulfillmentPost('/fulfillment/website-lead-status',{submission_id:submissionId,...delivery})}
  catch(e){console.error('Website lead delivery status update failed',submissionId,e.message);return null}
}
async function highLevelPipeline(){
  const locationId=process.env.GHL_LOCATION_ID;
  const r=await fetch(`${ghlBase}/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`,{headers:ghlHeaders()});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j?.message||j?.error||`HighLevel pipeline lookup returned ${r.status}`);
  const pipelines=Array.isArray(j?.pipelines)?j.pipelines:[];
  const wantedId=cleanText(process.env.GHL_PIPELINE_ID,100),wantedName=cleanText(process.env.GHL_PIPELINE_NAME||'Sales',100).toLowerCase();
  const pipeline=pipelines.find(x=>wantedId&&String(x.id)===wantedId)||pipelines.find(x=>String(x.name||'').toLowerCase().includes(wantedName))||pipelines[0];
  if(!pipeline)throw new Error('No HighLevel opportunity pipeline is available');
  const stages=Array.isArray(pipeline.stages)?pipeline.stages:[];
  const wantedStageId=cleanText(process.env.GHL_PIPELINE_STAGE_ID,100),wantedStageName=cleanText(process.env.GHL_PIPELINE_STAGE_NAME||'New Lead',100).toLowerCase();
  const stage=stages.find(x=>wantedStageId&&String(x.id)===wantedStageId)||stages.find(x=>String(x.name||'').toLowerCase().includes(wantedStageName))||stages[0];
  if(!stage)throw new Error(`HighLevel pipeline ${pipeline.name||pipeline.id} has no stages`);
  return{pipelineId:String(pipeline.id),pipelineStageId:String(stage.id),pipelineName:pipeline.name||'',stageName:stage.name||''};
}
async function createHighLevelOpportunity({contactId,firstName,lastName,source}){
  const p=await highLevelPipeline();
  const payload={pipelineId:p.pipelineId,locationId:process.env.GHL_LOCATION_ID,name:`${firstName} ${lastName}`.trim()+` — ${source}`,pipelineStageId:p.pipelineStageId,status:'open',contactId};
  const r=await fetch(`${ghlBase}/opportunities/upsert`,{method:'POST',headers:ghlHeaders(),body:JSON.stringify(payload)});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j?.message||j?.error||`HighLevel opportunity creation returned ${r.status}`);
  const opportunityId=j?.opportunity?.id||j?.id;
  if(!opportunityId)throw new Error('HighLevel did not return an opportunity ID');
  return{id:String(opportunityId),...p};
}
function transactionUserField(tx,name){
  const raw=tx?.userFields?.userField??tx?.userFields??[];
  const list=Array.isArray(raw)?raw:[raw];
  return String(list.find(x=>String(x?.name||'').toLowerCase()===String(name).toLowerCase())?.value||'');
}
const captured=tx=>Number(tx.responseCode)===1&&['capturedPendingSettlement','settledSuccessfully'].includes(tx.transactionStatus);
async function handoffPaidTransaction(transId){
  const tx=await transactionDetails(transId);
  if(!captured(tx))return {skipped:'payment not captured'};
  if(tx.subscription?.id){
    return fulfillmentPost('/fulfillment/autoship-payment',{
      subscription_id:String(tx.subscription.id),transaction_id:String(transId),payment_number:Number(tx.subscription.payNum),
      paid_date:String(tx.submitTimeLocal||tx.submitTimeUTC||'').slice(0,10),amount:Number(tx.settleAmount||tx.authAmount)
    });
  }
  if(!/^HTFO-|^COV-/.test(String(tx.order?.invoiceNumber||'')))return {skipped:'not a store transaction'};
  const rawItems=tx?.lineItems?.lineItem??tx?.lineItems??[];
  const itemList=(Array.isArray(rawItems)?rawItems:[rawItems]).filter(Boolean);
  const items=itemList.map(x=>{const desc=String(x.description||'');const m=desc.match(/Cover Form\s+(COV-[A-Z0-9]+)/i);return{product_id:x.itemId||'',sku:x.itemId||'',description:x.name||x.description||'Online item',quantity:Number(x.quantity)||1,unit_price:Number(x.unitPrice)||0,cover_form_id:m?m[1].toUpperCase():null}});
  const hasAutoship=itemList.some(x=>/autoship/i.test(String(x.description||'')));
  const employeeCode=transactionUserField(tx,'Employee Code').trim().toUpperCase();
  if(hasAutoship&&employeeCode){
    const hit=employeeForCode(employeeCode);
    if(hit){
      const merchandiseSubtotal=money(itemList.reduce((sum,x)=>sum+(Number(x.quantity)||1)*(Number(x.unitPrice)||0),0));
      const ship=tx.shipTo||{},bill=tx.billTo||{},customer=tx.customer||{};
      try{
        await fulfillmentPost('/fulfillment/autoship-attribution',{
          transaction_id:String(transId),
          order_number:tx?.order?.invoiceNumber||'',
          employee_code:hit.code,
          employee_id:hit.employeeId,
          employee_name:hit.employeeName,
          merchandise_subtotal:merchandiseSubtotal,
          commission_rate:0.10,
          customer_name:[ship.firstName||bill.firstName||'',ship.lastName||bill.lastName||''].filter(Boolean).join(' '),
          customer_email:customer.email||bill.email||'',
          paid_at:tx?.submitTimeUTC||tx?.submitTimeLocal||new Date().toISOString()
        });
        console.log('AUTOSHIP_ATTRIBUTION_OK',transId,hit.code,merchandiseSubtotal);
      }catch(e){console.error('AutoShip attribution handoff failed',e)}
    }
  }
  const fulfillment=transactionUserField(tx,'Fulfillment');
  const pickup=['pickup-monroeville','pickup-wexford'].includes(fulfillment);
  const bill=tx.billTo||{},ship=pickup?bill:tx.shipTo||{},customer=tx.customer||{};
  return fulfillmentPost('/fulfillment/store-order',{
    transaction_id:String(transId),
    external_order_id:String(transId),
    order_number:tx?.order?.invoiceNumber||'',
    shipping_amount:Number(tx?.shipping?.amount||0),
    total_amount:Number(tx?.authAmount||tx?.settleAmount||0),
    package_weight_lbs:10,package_length_in:12,package_width_in:12,package_height_in:12,
    customer:{first_name:ship.firstName||bill.firstName||'',last_name:ship.lastName||bill.lastName||'',email:customer.email||bill.email||'',phone:customer.phoneNumber||bill.phoneNumber||'',street:ship.address||bill.address||'',street2:'',city:ship.city||bill.city||'',state:ship.state||bill.state||'',zip:ship.zip||bill.zip||''},
    items,
    fulfillment,
    pos_customer_id:transactionUserField(tx,'POS Customer'),
    department:transactionUserField(tx,'POS Department'),
    notes:pickup?'Paid online store pickup · '+(fulfillment==='pickup-wexford'?'Wexford':'Monroeville'):'Paid online store order'
  });
}

function normalizeProfileIds(tx,fallbackProfileId){
  const p=tx.profile||{};
  return{customerProfileId:String(p.customerProfileId||fallbackProfileId||''),customerPaymentProfileId:String(p.customerPaymentProfileId||'')};
}

async function createRecurringGroup({profileId,paymentProfileId,frequencyMonths,groupBody,invoice,employeeCode,frozenQuote}){
  const priced=frozenQuote||await taxForOrder(groupBody);
  const merchandise=money(priced.items.reduce((s,x)=>s+x.quantity*x.unit_price,0));
  const amount=money(merchandise+priced.shipping+priced.tax);
  const startDate=frozenQuote?.start_date||addMonthsISO(frequencyMonths);
  const totalOccurrences=occurrencesFor(frequencyMonths);
  const names=priced.items.map(x=>x.name).join(', ').slice(0,42);
  const name=`HTFO AutoShip ${names}`.slice(0,50);
  try{
    const j=await anet({ARBCreateSubscriptionRequest:{merchantAuthentication:auth(),refId:String(invoice).slice(0,20),subscription:{name,paymentSchedule:{interval:{length:Number(frequencyMonths),unit:'months'},startDate,totalOccurrences,trialOccurrences:0},amount,profile:{customerProfileId:String(profileId),customerPaymentProfileId:String(paymentProfileId)},order:{invoiceNumber:String(invoice).slice(0,20),description:`HTFO AutoShip ${employeeCode?`employee ${employeeCode}`:'standard'} · ${frequencyMonths} month cadence`.slice(0,255)}}}});
    return{subscriptionId:String(j.subscriptionId||''),frequencyMonths:Number(frequencyMonths),amount,startDate,totalOccurrences,items:priced.items.map(x=>({id:x.id,sku:x.id,name:x.name,quantity:x.quantity,unit_price:x.unit_price,discountPercent:Math.round(x.autoshipLockedDiscount*100)}))};
  }catch(e){
    if(e.code==='E00012')throw new Error('An AutoShip subscription already exists for this payment. Contact HTFO to reconcile it before retrying.');
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

async function cancelAutoShip(id){
  const current=await anet({ARBGetSubscriptionStatusRequest:{merchantAuthentication:auth(),subscriptionId:id}});
  if(!['canceled','cancelled','expired','terminated'].includes(String(current.status).toLowerCase())){
    await anet({ARBCancelSubscriptionRequest:{merchantAuthentication:auth(),subscriptionId:id}});
  }
  await fulfillmentPost('/fulfillment/autoship-cancelled',{subscription_id:id});
}

app.post('/internal/pos-autoship/cancel',async(req,res)=>{
  const expected=Buffer.from(process.env.FULFILLMENT_WEBHOOK_SECRET||''),supplied=Buffer.from(req.get('x-htfo-fulfillment-secret')||'');
  if(!expected.length||expected.length!==supplied.length||!timingSafeEqual(expected,supplied))return res.sendStatus(404);
  const id=String(req.body?.subscription_id||'');
  if(!/^\d+$/.test(id))return res.status(400).json({error:'Invalid subscription ID'});
  try{await cancelAutoShip(id);res.json({ok:true})}
  catch(error){res.status(503).json({error:'Cancellation could not be reconciled. Retry before telling the customer it is complete.'})}
});

app.post('/account/cancel-autoship',async(req,res)=>{
  try{
    const token=verifyToken(req.body?.token);if(token.kind!=='account')throw new Error('Invalid account token');
    const id=String(req.body?.subscriptionId||'');
    const allowedIds=(token.autoship||[]).map(x=>String(x.subscriptionId||'')).filter(Boolean);
    if(!allowedIds.includes(id))throw new Error('Subscription not found in this account');
    await cancelAutoShip(id);
    const autoship=(token.autoship||[]).filter(x=>String(x.subscriptionId)!==id);
    const next=signToken({kind:'account',profileId:token.profileId,email:token.email,autoship,employeeAttribution:token.employeeAttribution||null});
    res.json({ok:true,token:next,autoship});
  }catch(e){res.status(400).json({ok:false,error:e.message})}
});

app.post('/account/activate',async(req,res)=>{
  res.set('Cache-Control','no-store');
  const posToken=req.body?.posToken;
  let claimed=false;
  try{
    let token=req.body?.token;
    if(posToken){
      const saved=await posIntent(posToken,'activate');
      if(saved.result)return res.json(saved.result);
      token=saved.payload;
      claimed=true;
    }
    const t=verifyToken(token);if(t.kind!=='autoship-checkout')throw new Error('Invalid AutoShip activation token');
    const hit=await findUnsettledByInvoice(t.invoice);if(!hit)throw new Error('Payment is still being confirmed. Please try again in a few seconds.');
    const transId=hit.transId||hit.id;const tx=await transactionDetails(transId);
    if(!captured(tx))throw new Error('Payment has not been captured.');
    if(t.pos&&money(tx.settleAmount||tx.authAmount)!==t.pos.total)throw Error('Captured payment amount does not match the AutoShip authorization.');
    if(tx.profile?.customerProfileId&&String(tx.profile.customerProfileId)!==String(t.profileId))throw new Error('The payment profile does not match this enrollment.');
    const ids=normalizeProfileIds(tx,t.profileId);
    if(!ids.customerProfileId)throw new Error('Authorize.Net customer profile was not attached to this payment');
    const paymentProfileId=ids.customerPaymentProfileId;
    if(!paymentProfileId)throw new Error('Your card was charged, but the saved payment profile is still being created. Try again in a few seconds.');
    await handoffPaidTransaction(transId);
    const groups=new Map();
    for(const x of (t.items||[]).filter(x=>x.autoship)){
      const f=Number(x.frequencyMonths)||1;if(!groups.has(f))groups.set(f,[]);groups.get(f).push(x);
    }
    const autoship=[];
    for(const [frequencyMonths,items] of groups){
      const groupBody={items,first:t.customer.first,last:t.customer.last,email:t.customer.email,phone:t.customer.phone,fulfillment:t.fulfillment,shippingAddress:t.shippingAddress,employeeAttribution:t.employeeAttribution||null};
      autoship.push(await createRecurringGroup({profileId:ids.customerProfileId,paymentProfileId,frequencyMonths,groupBody,invoice:t.invoice,employeeCode:t.employeeAttribution?.code||'',frozenQuote:t.pos?.quote}));
    }
    await fulfillmentPost('/fulfillment/store-autoship',{customer:{first_name:t.customer.first,last_name:t.customer.last,email:t.customer.email,phone:t.customer.phone,street:t.customer.street,street2:t.customer.street2,city:t.customer.city,state:t.customer.state,zip:t.customer.zip},subscriptions:autoship,fulfillment:t.fulfillment,payment_reference:paymentProfileId,pos:t.pos?{customer_id:t.pos.customer_id,department:t.pos.department}:undefined});
    const accountToken=signToken({kind:'account',profileId:ids.customerProfileId,email:t.customer.email,autoship,employeeAttribution:t.employeeAttribution||null});
    const profile=await profileSummary(anet,auth,ids.customerProfileId);
    const result={ok:true,accountToken,profile,autoship,transactionId:String(transId)};
    if(posToken)await fulfillmentPost('/htfo-pos/retail/autoship-intent',{token:posToken,action:'finish_activation',result});
    res.json(result);
  }catch(e){
    if(claimed)await posIntent(posToken,'release_activation').catch(()=>{});
    res.status(400).json({ok:false,error:e.message});
  }
});

app.post('/customer/manage-token',async(req,res)=>{res.status(410).json({ok:false,error:'Use the signed My HTFO Account payment-management flow.'})});

app.post('/authorize/webhook',async(req,res)=>{
  const signatureKey=process.env.STORE_AUTHORIZE_SIGNATURE_KEY;
  if(signatureKey){
    const supplied=String(req.get('X-ANET-Signature')||'').replace(/^sha512=/i,'');
    if(!/^[a-f0-9]{128}$/i.test(signatureKey)||!/^[a-f0-9]{128}$/i.test(supplied)||!req.rawBody)return res.sendStatus(401);
    const expected=createHmac('sha512',Buffer.from(signatureKey,'hex')).update(req.rawBody).digest();
    if(!timingSafeEqual(expected,Buffer.from(supplied,'hex')))return res.sendStatus(401);
  }
  const type=String(req.body?.eventType||'').toLowerCase();
  const transId=String(req.body?.payload?.id||req.body?.payload?.transId||'');
  if(!['net.authorize.payment.authcapture.created','net.authorize.payment.capture.created','net.authorize.payment.priorauthcapture.created','net.authorize.payment.fraud.approved'].includes(type)||!/^\d+$/.test(transId))return res.sendStatus(200);
  try{
    await handoffPaidTransaction(transId);
    res.sendStatus(200);
  }catch(e){
    console.error('Authorize.Net fulfillment handoff failed',transId,e.code||e.name);
    res.sendStatus(503);
  }
});


app.post('/cover-order-form',async(req,res)=>{
  try{
    const b=req.body||{},data=b.formData&&typeof b.formData==='object'?b.formData:{};
    const model=cleanText(b.coverModel,60),catalog=coverCatalog[model];
    if(!catalog)throw new Error('Choose a valid cover model before continuing.');
    const sku=catalog.sku,price=catalog.price;
    const id='COV-'+randomUUID().replace(/-/g,'').slice(0,16).toUpperCase();
    await fulfillmentPost('/fulfillment/cover-form',{
      form_id:id,customer_name:cleanText(data.name,150),customer_email:cleanText(data.email,254),customer_phone:cleanText(data.phone,60),
      cover_model:model,cover_sku:sku,cover_price:price,form_data:data
    });
    res.status(201).json({ok:true,formId:id,coverModel:model,coverSku:sku,coverPrice:price,sheetUrl:'https://hottubfactoryoutlet.com/cover-order-sheet.html?id='+encodeURIComponent(id)});
  }catch(e){res.status(400).json({ok:false,error:e.message})}
});
app.get('/cover-order-form/:id',async(req,res)=>{
  try{
    const id=String(req.params.id||'').trim().toUpperCase();
    if(!/^COV-[A-Z0-9]{16}$/.test(id))throw new Error('Invalid cover form');
    const row=await fulfillmentGet('/fulfillment/cover-form/'+encodeURIComponent(id));
    res.json({ok:true,...row});
  }catch(e){res.status(404).json({ok:false,error:e.message})}
});

app.get('/internal/crm/highlevel-contacts',async(req,res)=>{
  try{
    const expected=String(process.env.CRM_IMPORT_SECRET||'').trim(),supplied=String(req.get('x-htfo-import-secret')||'').trim();
    if(!expected||supplied!==expected)return res.status(403).json({error:'Forbidden'});
    requireEnv(['GHL_API_TOKEN','GHL_LOCATION_ID']);
    const u=new URL(ghlBase+'/contacts/');
    u.searchParams.set('locationId',process.env.GHL_LOCATION_ID);
    u.searchParams.set('limit','100');
    if(req.query.startAfterId)u.searchParams.set('startAfterId',String(req.query.startAfterId));
    if(req.query.startAfter)u.searchParams.set('startAfter',String(req.query.startAfter));
    if(req.query.contactId)u.searchParams.set('contactId',String(req.query.contactId));
    const r=await fetch(u,{headers:ghlHeaders()}),j=await r.json().catch(()=>({}));
    if(!r.ok)return res.status(r.status).json({error:j?.message||j?.error||'HighLevel export failed'});
    res.json({contacts:j.contacts||[],meta:j.meta||{}});
  }catch(e){res.status(500).json({error:e.message})}
});

app.get('/internal/crm/highlevel-opportunities',async(req,res)=>{
  try{
    const expected=String(process.env.CRM_IMPORT_SECRET||'').trim();
    if(!expected||String(req.get('x-htfo-import-secret')||'').trim()!==expected)return res.status(403).json({error:'Forbidden'});
    requireEnv(['GHL_API_TOKEN','GHL_LOCATION_ID']);
    const u=new URL(ghlBase+'/opportunities/search');
    u.searchParams.set('locationId',process.env.GHL_LOCATION_ID);
    u.searchParams.set('limit','100');
    if(req.query.startAfterId)u.searchParams.set('startAfterId',String(req.query.startAfterId));
    if(req.query.startAfter)u.searchParams.set('startAfter',String(req.query.startAfter));
    const r=await fetch(u,{headers:ghlHeaders()});
    const j=await r.json().catch(()=>({}));
    if(!r.ok)return res.status(r.status).json({error:j?.message||j?.error||'HighLevel opportunity export failed'});
    res.json({opportunities:j.opportunities||[],meta:j.meta||{}});
  }catch(e){res.status(500).json({error:e.message})}
});

app.get('/internal/crm/highlevel-users',async(req,res)=>{
  try{
    const expected=String(process.env.CRM_IMPORT_SECRET||'').trim();
    if(!expected||String(req.get('x-htfo-import-secret')||'').trim()!==expected)return res.status(403).json({error:'Forbidden'});
    requireEnv(['GHL_API_TOKEN','GHL_LOCATION_ID']);
    const locationId=process.env.GHL_LOCATION_ID;
    const lr=await fetch(ghlBase+'/locations/'+encodeURIComponent(locationId),{headers:ghlHeaders()});
    const lj=await lr.json().catch(()=>({}));
    if(!lr.ok||!lj?.location?.companyId)return res.status(502).json({error:'Could not resolve HighLevel company'});
    const qs=new URLSearchParams({companyId:lj.location.companyId,locationId,limit:'100'});
    const ur=await fetch(ghlBase+'/users/search?'+qs,{headers:ghlHeaders()});
    const uj=await ur.json().catch(()=>({}));
    if(!ur.ok)return res.status(ur.status).json({error:uj?.message||uj?.error||'HighLevel user export failed'});
    res.json({users:(uj.users||[]).map(x=>({id:x.id,name:x.name||[x.firstName,x.lastName].filter(Boolean).join(' '),email:x.email||null,role:x.roles?.type||x.role||null}))});
  }catch(e){res.status(500).json({error:e.message})}
});

app.get('/internal/crm/highlevel-pipelines',async(req,res)=>{
  try{
    const expected=String(process.env.CRM_IMPORT_SECRET||'').trim();
    if(!expected||String(req.get('x-htfo-import-secret')||'').trim()!==expected)return res.status(403).json({error:'Forbidden'});
    requireEnv(['GHL_API_TOKEN','GHL_LOCATION_ID']);
    const u=new URL(ghlBase+'/opportunities/pipelines');
    u.searchParams.set('locationId',process.env.GHL_LOCATION_ID);
    const r=await fetch(u,{headers:ghlHeaders()});
    const j=await r.json().catch(()=>({}));
    if(!r.ok)return res.status(r.status).json({error:j?.message||j?.error||'HighLevel pipeline export failed'});
    res.json(j);
  }catch(e){res.status(500).json({error:e.message})}
});

app.get('/internal/crm/highlevel-conversations',async(req,res)=>{
  try{
    const expected=String(process.env.CRM_IMPORT_SECRET||'').trim();
    if(!expected||String(req.get('x-htfo-import-secret')||'').trim()!==expected)return res.status(403).json({error:'Forbidden'});
    requireEnv(['GHL_API_TOKEN','GHL_LOCATION_ID']);
    const u=new URL(ghlBase+'/conversations/search');
    u.searchParams.set('locationId',process.env.GHL_LOCATION_ID);
    u.searchParams.set('limit','100');
    if(req.query.startAfterId)u.searchParams.set('startAfterId',String(req.query.startAfterId));
    if(req.query.startAfter)u.searchParams.set('startAfter',String(req.query.startAfter));
    const r=await fetch(u,{headers:ghlHeaders()});
    const j=await r.json().catch(()=>({}));
    if(!r.ok)return res.status(r.status).json({error:j?.message||j?.error||'HighLevel conversation export failed'});
    res.json({conversations:j.conversations||[],meta:j.meta||{}});
  }catch(e){res.status(500).json({error:e.message})}
});

app.get('/internal/crm/highlevel-conversation-messages',async(req,res)=>{
  try{
    const expected=String(process.env.CRM_IMPORT_SECRET||'').trim();
    if(!expected||String(req.get('x-htfo-import-secret')||'').trim()!==expected)return res.status(403).json({error:'Forbidden'});
    requireEnv(['GHL_API_TOKEN']);
    const conversationId=cleanText(req.query.conversationId,100);
    if(!conversationId)return res.status(400).json({error:'conversationId is required'});
    const u=new URL(ghlBase+'/conversations/'+encodeURIComponent(conversationId)+'/messages');
    u.searchParams.set('limit','100');
    if(req.query.lastMessageId)u.searchParams.set('lastMessageId',String(req.query.lastMessageId));
    const r=await fetch(u,{headers:ghlHeaders()});
    const j=await r.json().catch(()=>({}));
    if(!r.ok)return res.status(r.status).json({error:j?.message||j?.error||'HighLevel message export failed'});
    const raw=j.messages?.messages||j.messages||j.data||[];
    res.json({messages:Array.isArray(raw)?raw:[],meta:j.meta||j.messages?.meta||{}});
  }catch(e){res.status(500).json({error:e.message})}
});

app.get('/internal/crm/highlevel-contact-notes',async(req,res)=>{
  try{
    const expected=String(process.env.CRM_IMPORT_SECRET||'').trim();
    if(!expected||String(req.get('x-htfo-import-secret')||'').trim()!==expected)return res.status(403).json({error:'Forbidden'});
    requireEnv(['GHL_API_TOKEN']);
    const contactId=cleanText(req.query.contactId,100);
    if(!contactId)return res.status(400).json({error:'contactId is required'});
    const u=new URL(ghlBase+'/contacts/'+encodeURIComponent(contactId)+'/notes');
    u.searchParams.set('limit','100');
    if(req.query.offset)u.searchParams.set('offset',String(req.query.offset));
    const r=await fetch(u,{headers:ghlHeaders()});
    const j=await r.json().catch(()=>({}));
    if(!r.ok)return res.status(r.status).json({error:j?.message||j?.error||'HighLevel notes export failed'});
    res.json({notes:Array.isArray(j.notes)?j.notes:(Array.isArray(j.data)?j.data:[]),meta:j.meta||{}});
  }catch(e){res.status(500).json({error:e.message})}
});

app.post('/lead',async(req,res)=>{
  const submissionId=cleanText(req.body?.submissionId,100)||randomUUID();
  try{
    const firstName=cleanText(req.body.firstName||req.body.first,100);
    const lastName=cleanText(req.body.lastName||req.body.last,100);
    const email=cleanText(req.body.email,254).toLowerCase();
    const phone=cleanText(req.body.phone,50);
    if(!firstName)throw new Error('First name is required');
    if(!email&&!phone)throw new Error('Email or phone is required');
    if(email&&!validEmail(email))throw new Error('Please enter a valid email address');
    const source=cleanText(req.body.source||'HTFO Website',100);
    const customFields=Array.isArray(req.body.customFields)?req.body.customFields.slice(0,25):undefined;
    const incoming=Array.isArray(req.body.tags)?req.body.tags:[];
    const tags=['website-lead','duck-bucks-lead',...incoming.map(x=>cleanText(x,100)).filter(Boolean)];
    const uniqueTags=[...new Set(tags)].slice(0,20);
    const details=[req.body.note,req.body.offer&&`Offer: ${cleanText(req.body.offer,300)}`,req.body.campaign&&`Campaign: ${cleanText(req.body.campaign,300)}`,req.body.location&&`Preferred showroom: ${cleanText(req.body.location,100)}`,req.body.utm_source&&`UTM source: ${cleanText(req.body.utm_source,200)}`,req.body.utm_campaign&&`UTM campaign: ${cleanText(req.body.utm_campaign,200)}`,req.body.utm_content&&`UTM content: ${cleanText(req.body.utm_content,200)}`].filter(Boolean).join('\n');
    await persistWebsiteLead({submission_id:submissionId,first_name:firstName,last_name:lastName,email:email||null,phone:phone||null,source,tags:uniqueTags,note:details||null,payload:req.body,received_at:new Date().toISOString()});
    if(!process.env.GHL_API_TOKEN||!process.env.GHL_LOCATION_ID){
      const error='HighLevel is not configured';
      await updateWebsiteLeadDelivery(submissionId,{ghl_contact_status:'failed',ghl_contact_error:error,ghl_opportunity_status:'failed',ghl_opportunity_error:error});
      console.error('Lead saved to HTFO CRM but HighLevel is not configured',submissionId);
      return res.status(201).json({ok:true,submissionId,saved:true,highLevel:false,warning:error});
    }
    const payload={firstName,lastName,email:email||undefined,phone:phone||undefined,locationId:process.env.GHL_LOCATION_ID,source,country:'US',createNewIfDuplicateAllowed:false,customFields};
    Object.keys(payload).forEach(k=>payload[k]===undefined&&delete payload[k]);
    const r=await fetch(`${ghlBase}/contacts/upsert`,{method:'POST',headers:ghlHeaders(),body:JSON.stringify(payload)});
    const json=await r.json().catch(()=>({}));
    if(!r.ok){
      const error=json?.message||json?.error||`HighLevel contact upsert returned ${r.status}`;
      await updateWebsiteLeadDelivery(submissionId,{ghl_contact_status:'failed',ghl_contact_error:error,ghl_opportunity_status:'pending'});
      console.error('Lead saved to HTFO CRM; HighLevel contact failed',submissionId,error);
      return res.status(201).json({ok:true,submissionId,saved:true,highLevel:false,warning:error});
    }
    const contactId=json?.contact?.id;if(!contactId)throw new Error('HighLevel did not return a contact ID');
    const tr=await fetch(`${ghlBase}/contacts/${encodeURIComponent(contactId)}/tags`,{method:'POST',headers:ghlHeaders(),body:JSON.stringify({tags:uniqueTags})});
    const tagJson=await tr.json().catch(()=>({}));
    if(!tr.ok)console.warn('HighLevel tag update failed',submissionId,tagJson?.message||tagJson?.error||tr.status);
    const noteSaved=await addContactNote(contactId,details);
    let opportunity=null,opportunityError='';
    try{opportunity=await createHighLevelOpportunity({contactId,firstName,lastName,source})}catch(e){opportunityError=e.message;console.error('HighLevel opportunity creation failed',submissionId,e.message)}
    await updateWebsiteLeadDelivery(submissionId,{ghl_contact_status:'sent',ghl_contact_id:contactId,ghl_contact_error:null,ghl_opportunity_status:opportunity?'sent':'failed',ghl_opportunity_id:opportunity?.id||null,ghl_opportunity_error:opportunityError||null});
    console.log('LEAD_CAPTURE_OK',JSON.stringify({submissionId,contactId,opportunityId:opportunity?.id||null,source,new:Boolean(json?.new),tags:uniqueTags}));
    res.status(201).json({ok:true,submissionId,saved:true,new:Boolean(json?.new),contactId,opportunityId:opportunity?.id||null,source,tags:tagJson?.tags||uniqueTags,noteSaved,warning:opportunityError||undefined});
  }catch(e){console.error('Lead capture error:',submissionId,e);res.status(400).json({ok:false,submissionId,error:e.message});}
});

app.post('/tax',async(req,res)=>{try{const t=await taxForOrder(req.body);res.json({tax:t.tax,shipping:t.shipping,rate:t.rate,hasNexus:t.hasNexus,taxableAmount:t.taxableAmount,employeeAttribution:t.attribution})}catch(e){res.status(400).json({error:e.message})}});

async function checkoutSession(body,pos=null,posEnrollmentToken=null){
    const t=pos?.quote||await taxForOrder(body),merchandise=money(t.items.reduce((s,x)=>s+x.quantity*x.unit_price,0)),total=money(merchandise+t.shipping+t.tax);if(total<=0)throw new Error('Order total must be greater than zero');
    const invoice='HTFO-'+randomUUID().replace(/-/g,'').slice(0,15),hasAutoship=t.items.some(x=>x.autoship),purchaseDiscount=t.attribution?10:0,autoshipDiscount=hasAutoship?(t.attribution?10:5):0,attributionText=t.attribution?` | Employee: ${t.attribution.employeeName} (${t.attribution.code})`:'';
    let customerProfileId='',activationToken='',returnUrl=process.env.STORE_RETURN_URL||'https://hottubfactoryoutlet.com/account.html';
    if(hasAutoship&&body.fulfillment!=='ship')throw new Error('AutoShip requires shipping. Choose Ship or remove AutoShip from the cart.');
    if(hasAutoship){
      customerProfileId=await ensureCustomerProfile(anet,auth,t.customer.email);
      activationToken=signToken({kind:'autoship-checkout',invoice,profileId:customerProfileId,items:body.items,customer:t.customer,fulfillment:body.fulfillment,shippingAddress:body.shippingAddress,employeeAttribution:body.employeeAttribution||null,pos},60*60*24);
      returnUrl=posEnrollmentToken
        ?`https://hottubfactoryoutlet.com/account.html#pos_activate=${posEnrollmentToken}`
        :`https://hottubfactoryoutlet.com/account.html?activate=${encodeURIComponent(activationToken)}`;
    }
    const userField=[{name:'Purchase Discount',value:purchaseDiscount?`${purchaseDiscount}% employee code`:'None'},{name:'AutoShip Savings',value:hasAutoship?`${autoshipDiscount}%`:'None'},{name:'AutoShip Discount Policy',value:hasAutoship&&t.attribution?'10% of current price until canceled':hasAutoship?'5% standard AutoShip':'None'},{name:'Fulfillment',value:String(body.fulfillment||'ship')}];
    if(pos)userField.push({name:'POS Department',value:pos.department},{name:'POS Customer',value:String(pos.customer_id)});
    if(t.attribution)userField.push({name:'Employee Code',value:t.attribution.code},{name:'Employee Name',value:t.attribution.employeeName},{name:'Employee ID',value:t.attribution.employeeId});
    const d=t.destination;
    const transactionRequest={transactionType:'authCaptureTransaction',amount:total,order:{invoiceNumber:invoice,description:(hasAutoship?'HTFO order with AutoShip enrollment':'HTFO online order')+attributionText},lineItems:{lineItem:t.items.map(x=>({itemId:x.id,name:x.name,description:(x.autoship?`${x.description} | AutoShip ${Math.round(x.autoshipLockedDiscount*100)}% of current price until canceled | every ${x.frequencyMonths} months`:x.description)+(x.cover_form_id?` | Cover Form ${x.cover_form_id}`:''),quantity:x.quantity,unitPrice:x.unit_price,taxable:true}))},tax:{amount:t.tax,name:'Sales Tax'},shipping:{amount:t.shipping,name:'Shipping'},billTo:{firstName:t.customer.first,lastName:t.customer.last,address:t.customer.street,city:t.customer.city,state:t.customer.state,zip:t.customer.zip,country:'US',email:t.customer.email},shipTo:{firstName:t.customer.first,lastName:t.customer.last,address:d.street,city:d.city,state:d.state,zip:d.zip,country:'US'},userFields:{userField}};
    if(hasAutoship)transactionRequest.profile={customerProfileId};else transactionRequest.customer={email:t.customer.email};
    const request={getHostedPaymentPageRequest:{merchantAuthentication:auth(),transactionRequest,hostedPaymentSettings:{setting:[{settingName:'hostedPaymentReturnOptions',settingValue:JSON.stringify({showReceipt:true,url:returnUrl,urlText:hasAutoship?'Finish AutoShip & Open My Account':'Return to Hot Tub Factory Outlet',cancelUrl:process.env.STORE_CANCEL_URL||'https://hottubfactoryoutlet.com/cart.html',cancelUrlText:'Cancel'})},{settingName:'hostedPaymentCustomerOptions',settingValue:JSON.stringify({showEmail:true,requiredEmail:true,addPaymentProfile:hasAutoship})},{settingName:'hostedPaymentPaymentOptions',settingValue:JSON.stringify({cardCodeRequired:true,showCreditCard:true,showBankAccount:false})}]}}};
    const j=await anet(request);if(!j.token)throw new Error('Authorize.Net did not return a payment token');
    return {token:j.token,formUrl:authForm,...(posEnrollmentToken?{activationToken}:{}),invoice,merchandise,shipping:t.shipping,tax:t.tax,total,autoship:hasAutoship,purchaseDiscount,autoshipDiscount,autoshipDiscountPersistsUntilCancel:Boolean(hasAutoship&&t.attribution),employeeAttribution:t.attribution,customerProfileId:hasAutoship?customerProfileId:null};
}
app.post('/checkout/session',async(req,res)=>{
  try{res.json(await checkoutSession(req.body))}
  catch(error){res.status(400).json({error:error.message})}
});


// Enrollment can be accepted only when explicitly enabled on both applications.
const posAutoShipEnabled=()=>process.env.HTFO_POS_AUTOSHIP_ENABLED==='true'&&/^[a-f0-9]{128}$/i.test(process.env.STORE_AUTHORIZE_SIGNATURE_KEY||'');
async function posIntent(token,action){
  if(!/^[a-f0-9]{64}$/.test(String(token||'')))throw Error('This AutoShip link is invalid.');
  const intent=await fulfillmentPost('/htfo-pos/retail/autoship-intent',{token,action});
  if(!intent?.ok)throw Error('Cashier AutoShip is unavailable.');
  return intent;
}
app.get('/pos-autoship',(req,res)=>res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}).type('html').send(posAutoShipPage));
app.get('/pos-autoship.js',(req,res)=>res.set('Cache-Control','no-store').type('js').send(posAutoShipScript));
app.post('/pos-autoship/:action',async(req,res)=>{
  res.set('Cache-Control','no-store');
  if(!posAutoShipEnabled())return res.status(503).json({error:'Cashier AutoShip enrollment is awaiting merchant acceptance testing.'});
  const {token}=req.body||{};
  let claimed=false;
  try{
    const action=req.params.action;
    if(!['review','quote','start'].includes(action))return res.sendStatus(404);
    if(action==='start'){
      const signed=verifyToken(req.body.quote),name=String(req.body.name||'').trim();
      if(signed.kind!=='pos-autoship-quote'||signed.token!==token||name.length<3||name.length>100||req.body.accepted!==true){
        throw Error('Review the quote and accept the recurring payment authorization.');
      }
      const intent=await posIntent(token,'claim');
      claimed=true;
      if(String(signed.pos.customer_id)!==String(intent.customer_id)||signed.body.email!==intent.email){
        throw Error('The customer record changed. Review a new quote before continuing.');
      }
      const consent=await fulfillmentPost('/htfo-pos/retail/autoship-intent',{token,action:'consent',name,quote:{
        total:signed.pos.total,start_date:signed.pos.quote.start_date,frequency_months:signed.body.items[0].frequencyMonths,
        occurrences:occurrencesFor(signed.body.items[0].frequencyMonths),items:signed.pos.quote.items.map(item=>({sku:item.id,quantity:item.quantity,unit_price:item.unit_price}))
      }});
      if(!consent?.ok)throw Error('The authorization could not be saved.');
      const activationToken=randomBytes(32).toString('hex');
      const checkout=await checkoutSession(signed.body,signed.pos,activationToken);
      const saved=await fulfillmentPost('/htfo-pos/retail/autoship-intent',{token,action:'prepare_activation',activationToken,payload:checkout.activationToken});
      if(!saved?.ok)throw Error('The enrollment could not be saved.');
      return res.json({token:checkout.token,formUrl:checkout.formUrl});
    }
    const intent=await posIntent(token,'read');
    if(action==='review')return res.json({ok:true});
    const body={items:intent.items,first:intent.first_name,last:intent.last_name,email:intent.email,phone:intent.phone,fulfillment:'ship',shippingAddress:req.body.shippingAddress};
    const quote=await taxForOrder(body);
    const months=intent.items[0].frequencyMonths;
    const total=money(quote.items.reduce((sum,item)=>sum+item.unit_price*item.quantity,0)+quote.shipping+quote.tax);
    if(total<=0)throw Error('The order amount is invalid.');
    quote.start_date=addMonthsISO(months);
    const pos={customer_id:intent.customer_id,department:intent.department,total,quote};
    res.json({quote:signToken({kind:'pos-autoship-quote',token,body,pos},900),items:quote.items.map(({description,quantity})=>({description,quantity})),total,months,start_date:quote.start_date,occurrences:occurrencesFor(months)});
  }catch(error){
    if(claimed)await posIntent(token,'release').catch(()=>{});
    res.status(400).json({error:error.message});
  }
});

app.listen(port,()=>console.log(`HTFO store backend listening on ${port}`));
