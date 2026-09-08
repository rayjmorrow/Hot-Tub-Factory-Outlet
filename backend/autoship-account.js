import crypto from 'crypto';

const b64url=s=>Buffer.from(s).toString('base64url');
const fromB64=s=>Buffer.from(s,'base64url').toString('utf8');

function secret(){
  const s=process.env.ACCOUNT_TOKEN_SECRET;
  if(!s) throw new Error('ACCOUNT_TOKEN_SECRET is not configured');
  return s;
}

export function signToken(payload,ttlSeconds=60*60*24*30){
  const body={...payload,exp:Math.floor(Date.now()/1000)+ttlSeconds};
  const enc=b64url(JSON.stringify(body));
  const sig=crypto.createHmac('sha256',secret()).update(enc).digest('base64url');
  return `${enc}.${sig}`;
}

export function verifyToken(token){
  const [enc,sig]=String(token||'').split('.');
  if(!enc||!sig) throw new Error('Invalid account token');
  const expected=crypto.createHmac('sha256',secret()).update(enc).digest('base64url');
  if(sig.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected))) throw new Error('Invalid account token');
  const body=JSON.parse(fromB64(enc));
  if(!body.exp||body.exp<Math.floor(Date.now()/1000)) throw new Error('Account token has expired');
  return body;
}

function merchantCustomerId(email){
  const h=crypto.createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex').slice(0,14);
  return `HTFO-${h}`.slice(0,20);
}

export async function ensureCustomerProfile(anet,auth,email){
  const clean=String(email||'').trim().toLowerCase();
  if(!clean) throw new Error('Email is required for AutoShip');
  try{
    const found=await anet({getCustomerProfileRequest:{merchantAuthentication:auth(),email:clean,includeIssuerInfo:false}});
    if(found?.profile?.customerProfileId) return String(found.profile.customerProfileId);
  }catch(e){
    if(!/not found|no records|E00040|E00039/i.test(String(e.message||''))){
      // Continue to create; Authorize.Net will return the existing ID if it is a duplicate.
    }
  }
  try{
    const created=await anet({createCustomerProfileRequest:{merchantAuthentication:auth(),profile:{merchantCustomerId:merchantCustomerId(clean),description:'HTFO online customer',email:clean}}});
    if(created?.customerProfileId) return String(created.customerProfileId);
  }catch(e){
    const m=String(e.message||'').match(/ID\s+(\d+)/i)||String(e.message||'').match(/(\d{5,})/);
    if(m) return m[1];
    throw e;
  }
  throw new Error('Could not create Authorize.Net customer profile');
}

export async function profileSummary(anet,auth,profileId){
  const j=await anet({getCustomerProfileRequest:{merchantAuthentication:auth(),customerProfileId:String(profileId),includeIssuerInfo:false}});
  const p=j.profile||{};
  const list=Array.isArray(p.paymentProfiles)?p.paymentProfiles:(p.paymentProfiles?[p.paymentProfiles]:[]);
  return {
    customerProfileId:String(p.customerProfileId||profileId),
    email:p.email||'',
    paymentProfiles:list.map(x=>({
      id:String(x.customerPaymentProfileId||''),
      cardNumber:x.payment?.creditCard?.cardNumber||'',
      expirationDate:x.payment?.creditCard?.expirationDate||'',
      firstName:x.billTo?.firstName||'',
      lastName:x.billTo?.lastName||''
    }))
  };
}

export function addMonthsISO(months){
  const d=new Date();
  const day=d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth()+Number(months||1));
  const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();
  d.setUTCDate(Math.min(day,last));
  return d.toISOString().slice(0,10);
}

export function occurrencesFor(months){
  const m=Math.max(1,Number(months)||1);
  return Math.max(1,Math.floor(36/m));
}
