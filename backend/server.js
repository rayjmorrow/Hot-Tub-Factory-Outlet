import 'dotenv/config';
import express from 'express';
import cors from 'cors';

const app=express();
const port=Number(process.env.PORT||8787);
const allowed=(process.env.ALLOWED_ORIGIN||'https://rayjmorrow.github.io').split(',').map(x=>x.trim());
app.use(cors({origin:(origin,cb)=>{if(!origin||allowed.includes(origin))return cb(null,true);cb(new Error('Origin not allowed'));}}));
app.use(express.json({limit:'256kb'}));

const money=n=>Math.round((Number(n)||0)*100)/100;
const taxjarBase=process.env.TAXJAR_SANDBOX==='true'?'https://api.sandbox.taxjar.com/v2':'https://api.taxjar.com/v2';
const authApi=process.env.AUTHORIZE_SANDBOX==='true'?'https://apitest.authorize.net/xml/v1/request.api':'https://api.authorize.net/xml/v1/request.api';
const authForm=process.env.AUTHORIZE_SANDBOX==='true'?'https://test.authorize.net/payment/payment':'https://accept.authorize.net/payment/payment';
const ghlBase='https://services.leadconnectorhq.com';

function requireEnv(names){const missing=names.filter(n=>!process.env[n]||process.env[n]==='replace_me');if(missing.length)throw new Error(`Missing server configuration: ${missing.join(', ')}`)}
function cleanItems(items){if(!Array.isArray(items)||!items.length)throw new Error('Cart is empty');return items.map((x,i)=>({id:String(x.id||x.sku||`item-${i+1}`).slice(0,31),name:String(x.name||'Item').slice(0,31),description:String(x.name||'Item').slice(0,255),quantity:Math.max(1,Math.min(999,Number(x.qty)||1)),unit_price:money(x.price),product_tax_code:x.product_tax_code||undefined}));}
function customer(body){const a=body.shippingAddress||{};return{first:String(body.first||'').trim(),last:String(body.last||'').trim(),email:String(body.email||'').trim(),phone:String(body.phone||'').trim(),street:String(a.street||'').trim(),street2:String(a.street2||'').trim(),city:String(a.city||'').trim(),state:String(a.state||'').trim().toUpperCase(),zip:String(a.zip||'').trim(),country:String(a.country||'US').trim().toUpperCase()};}
function validateShip(c){for(const k of ['first','last','email','street','city','state','zip'])if(!c[k])throw new Error(`Missing ${k}`);if(c.country==='US'&&!/^[A-Z]{2}$/.test(c.state))throw new Error('State must be a 2-letter code');}
function text(v,max=500){return String(v??'').trim().slice(0,max);}
function validEmail(v){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);}
function ghlHeaders(){return{Authorization:`Bearer ${process.env.GHL_API_TOKEN}`,Version:'v3','Content-Type':'application/json',Accept:'application/json'};}

async function taxForOrder(body){requireEnv(['TAXJAR_API_KEY','SHIP_FROM_STATE','SHIP_FROM_ZIP','SHIP_FROM_CITY','SHIP_FROM_STREET']);const items=cleanItems(body.items);const c=customer(body);validateShip(c);const shipping=money(body.shipping||0);const payload={from_country:process.env.SHIP_FROM_COUNTRY||'US',from_zip:process.env.SHIP_FROM_ZIP,from_state:process.env.SHIP_FROM_STATE,from_city:process.env.SHIP_FROM_CITY,from_street:process.env.SHIP_FROM_STREET,to_country:c.country,to_zip:c.zip,to_state:c.state,to_city:c.city,to_street:[c.street,c.street2].filter(Boolean).join(' '),shipping,line_items:items};const r=await fetch(`${taxjarBase}/taxes`,{method:'POST',headers:{Authorization:`Bearer ${process.env.TAXJAR_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(payload)});const json=await r.json().catch(()=>({}));if(!r.ok)throw new Error(json?.detail||json?.error||`TaxJar returned ${r.status}`);return{items,customer:c,shipping,tax:money(json.tax?.amount_to_collect||0),rate:Number(json.tax?.rate||0),hasNexus:json.tax?.has_nexus!==false,taxableAmount:money(json.tax?.taxable_amount||0),raw:json.tax};}

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
  const body=text(note,5000);
  if(!body)return false;
  try{
    const userId=await noteAuthorId();
    if(!userId){console.warn('Lead note skipped: no HighLevel note author found');return false;}
    const nr=await fetch(`${ghlBase}/contacts/${encodeURIComponent(contactId)}/notes`,{method:'POST',headers:ghlHeaders(),body:JSON.stringify({userId,body,title:'Website Lead Details',pinned:false})});
    if(!nr.ok){const nj=await nr.json().catch(()=>({}));console.warn('Lead note failed:',nj?.message||nj?.error||nr.status);return false;}
    return true;
  }catch(e){console.warn('Lead note failed:',e.message);return false;}
}

app.get('/health',(req,res)=>res.json({ok:true,taxjar:process.env.TAXJAR_SANDBOX==='true'?'sandbox':'production',authorize:process.env.AUTHORIZE_SANDBOX==='true'?'sandbox':'production',ghl:Boolean(process.env.GHL_API_TOKEN&&process.env.GHL_LOCATION_ID)}));

app.post('/lead',async(req,res)=>{
  try{
    requireEnv(['GHL_API_TOKEN','GHL_LOCATION_ID']);
    const firstName=text(req.body.firstName||req.body.first,100);
    const lastName=text(req.body.lastName||req.body.last,100);
    const email=text(req.body.email,254).toLowerCase();
    const phone=text(req.body.phone,50);
    if(!firstName)throw new Error('First name is required');
    if(!email&&!phone)throw new Error('Email or phone is required');
    if(email&&!validEmail(email))throw new Error('Please enter a valid email address');

    const source=text(req.body.source||'HTFO Website',100);
    const customFields=Array.isArray(req.body.customFields)?req.body.customFields.slice(0,25):undefined;
    const payload={firstName,lastName,email:email||undefined,phone:phone||undefined,locationId:process.env.GHL_LOCATION_ID,source,country:'US',createNewIfDuplicateAllowed:false,customFields};
    Object.keys(payload).forEach(k=>payload[k]===undefined&&delete payload[k]);

    const r=await fetch(`${ghlBase}/contacts/upsert`,{method:'POST',headers:ghlHeaders(),body:JSON.stringify(payload)});
    const json=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(json?.message||json?.error||`HighLevel contact upsert returned ${r.status}`);

    const contactId=json?.contact?.id;
    if(!contactId)throw new Error('HighLevel did not return a contact ID');

    const tags=['website-lead',...((Array.isArray(req.body.tags)?req.body.tags:[]).map(x=>text(x,100)).filter(Boolean))];
    const uniqueTags=[...new Set(tags)].slice(0,20);
    const tr=await fetch(`${ghlBase}/contacts/${encodeURIComponent(contactId)}/tags`,{method:'POST',headers:ghlHeaders(),body:JSON.stringify({tags:uniqueTags})});
    const tagJson=await tr.json().catch(()=>({}));
    if(!tr.ok)throw new Error(tagJson?.message||tagJson?.error||`HighLevel tag update returned ${tr.status}`);

    const noteSaved=await addContactNote(contactId,req.body.note);
    res.status(json?.new?201:200).json({ok:true,new:Boolean(json?.new),contactId,source,tags:tagJson?.tags||uniqueTags,noteSaved});
  }catch(e){
    console.error('Lead capture error:',e);
    res.status(400).json({ok:false,error:e.message});
  }
});

app.post('/tax',async(req,res)=>{try{const t=await taxForOrder(req.body);res.json({tax:t.tax,rate:t.rate,hasNexus:t.hasNexus,taxableAmount:t.taxableAmount});}catch(e){res.status(400).json({error:e.message});}});

app.post('/checkout/session',async(req,res)=>{try{requireEnv(['AUTHORIZE_API_LOGIN_ID','AUTHORIZE_TRANSACTION_KEY']);const t=await taxForOrder(req.body);const merchandise=money(t.items.reduce((s,x)=>s+x.quantity*x.unit_price,0));const total=money(merchandise+t.shipping+t.tax);if(total<=0)throw new Error('Order total must be greater than zero');if(req.body.fulfillment==='ship'&&!Number.isFinite(Number(req.body.shipping)))throw new Error('Shipping amount is required before payment');const invoice=`HTFO-${Date.now()}`.slice(0,20);const returnUrl=process.env.STORE_RETURN_URL;const cancelUrl=process.env.STORE_CANCEL_URL;const request={getHostedPaymentPageRequest:{merchantAuthentication:{name:process.env.AUTHORIZE_API_LOGIN_ID,transactionKey:process.env.AUTHORIZE_TRANSACTION_KEY},transactionRequest:{transactionType:'authCaptureTransaction',amount:total,order:{invoiceNumber:invoice,description:'Hot Tub Factory Outlet online order'},tax:{amount:t.tax,name:'Sales Tax',description:'TaxJar calculated sales tax'},shipping:{amount:t.shipping,name:'Shipping',description:req.body.fulfillment==='ship'?'Shipping':'Store pickup'},customer:{email:t.customer.email},billTo:{firstName:t.customer.first,lastName:t.customer.last,address:t.customer.street,city:t.customer.city,state:t.customer.state,zip:t.customer.zip,country:t.customer.country,email:t.customer.email},shipTo:{firstName:t.customer.first,lastName:t.customer.last,address:t.customer.street,city:t.customer.city,state:t.customer.state,zip:t.customer.zip,country:t.customer.country},lineItems:{lineItem:t.items.map(x=>({itemId:x.id,name:x.name,description:x.description,quantity:x.quantity,unitPrice:x.unit_price,taxable:true}))}},hostedPaymentSettings:{setting:[{settingName:'hostedPaymentReturnOptions',settingValue:JSON.stringify({showReceipt:true,url:returnUrl,urlText:'Return to Hot Tub Factory Outlet',cancelUrl,cancelUrlText:'Cancel'})},{settingName:'hostedPaymentButtonOptions',settingValue:JSON.stringify({text:'Pay'})},{settingName:'hostedPaymentBillingAddressOptions',settingValue:JSON.stringify({show:true,required:true})},{settingName:'hostedPaymentCustomerOptions',settingValue:JSON.stringify({showEmail:true,requiredEmail:true,addPaymentProfile:false})},{settingName:'hostedPaymentPaymentOptions',settingValue:JSON.stringify({cardCodeRequired:true,showCreditCard:true,showBankAccount:false})}]}}};const r=await fetch(authApi,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});const json=await r.json().catch(()=>({}));const result=json?.messages?.resultCode;if(!r.ok||result!=='Ok'||!json.token)throw new Error(json?.messages?.message?.[0]?.text||`Authorize.Net returned ${r.status}`);res.json({token:json.token,formUrl:authForm,invoice,merchandise,shipping:t.shipping,tax:t.tax,total});}catch(e){res.status(400).json({error:e.message});}});

app.listen(port,()=>console.log(`HTFO store backend listening on ${port}`));
