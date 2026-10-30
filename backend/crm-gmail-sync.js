import crypto from 'node:crypto';
import { q } from './service-db.js';
import { ensureServiceCustomerEmails } from './service-email-routes.js';

const clean=v=>v==null?null:String(v).trim();
const DEFAULT_MAILBOXES=['ray@hottubfactoryoutlet.com','rick@hottubfactoryoutlet.com','steve@hottubfactoryoutlet.com'];
const tokenCache=new Map();

function b64url(input){
  return Buffer.from(input).toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}
function serviceAccount(){
  const raw=String(process.env.GOOGLE_SERVICE_ACCOUNT_JSON||'').trim();
  if(!raw)throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing');
  const j=JSON.parse(raw);
  if(!j.client_email||!j.private_key)throw new Error('Google service-account JSON is incomplete');
  return j;
}
function mailboxes(){
  const configured=String(process.env.GMAIL_SYNC_MAILBOXES||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
  return configured.length?configured:DEFAULT_MAILBOXES;
}
async function accessToken(mailbox){
  const cached=tokenCache.get(mailbox);
  if(cached&&cached.expiresAt>Date.now()+120000)return cached.token;
  const sa=serviceAccount(),now=Math.floor(Date.now()/1000);
  const header=b64url(JSON.stringify({alg:'RS256',typ:'JWT'}));
  const payload=b64url(JSON.stringify({
    iss:sa.client_email,
    scope:'https://www.googleapis.com/auth/gmail.readonly',
    aud:'https://oauth2.googleapis.com/token',
    iat:now,
    exp:now+3600,
    sub:mailbox
  }));
  const signingInput=header+'.'+payload;
  const sig=crypto.sign('RSA-SHA256',Buffer.from(signingInput),sa.private_key);
  const assertion=signingInput+'.'+b64url(sig);
  const form=new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion});
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form,signal:AbortSignal.timeout(15000)});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j.error_description||j.error||('Google token request returned '+r.status));
  tokenCache.set(mailbox,{token:j.access_token,expiresAt:Date.now()+(Number(j.expires_in)||3600)*1000});
  return j.access_token;
}
async function gmail(mailbox,path){
  const token=await accessToken(mailbox);
  const r=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/'+path,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j.error?.message||('Gmail returned '+r.status+' for '+mailbox));
  return j;
}
function decode(data){
  if(!data)return'';
  const s=String(data).replace(/-/g,'+').replace(/_/g,'/');
  return Buffer.from(s,'base64').toString('utf8');
}
function header(payload,name){
  return clean((payload?.headers||[]).find(h=>String(h.name||'').toLowerCase()===name.toLowerCase())?.value);
}
function emailFromHeader(v){
  const s=String(v||'');
  const angle=s.match(/<([^>]+@[^>]+)>/);
  if(angle)return angle[1].trim().toLowerCase();
  const plain=s.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return plain?plain[0].toLowerCase():null;
}
function htmlToText(s){
  return String(s||'').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/p>/gi,'\n').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/\r/g,'').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
function messageBody(payload){
  let plain='',html='';
  const walk=p=>{
    const mime=String(p?.mimeType||'').toLowerCase();
    if(mime==='text/plain'&&p?.body?.data&&!plain)plain=decode(p.body.data);
    if(mime==='text/html'&&p?.body?.data&&!html)html=decode(p.body.data);
    for(const part of (p?.parts||[]))walk(part);
  };
  walk(payload);
  if(!plain&&payload?.body?.data){
    const raw=decode(payload.body.data);
    if(String(payload.mimeType||'').toLowerCase()==='text/html')html=raw;else plain=raw;
  }
  return String(plain||htmlToText(html)||'').trim().slice(0,20000);
}
async function ensureSchema(){
  await q(`ALTER TABLE crm_email_messages ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'outbound';
    ALTER TABLE crm_email_messages ADD COLUMN IF NOT EXISTS from_email TEXT;
    ALTER TABLE crm_email_messages ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ;
    ALTER TABLE crm_email_messages ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ;`);
  await ensureServiceCustomerEmails();
}
async function matchSales(subject,fromEmail){
  const m=String(subject||'').match(/\[HTFO-CRM:([^\]]+)\]/i);
  if(m){
    const row=(await q('SELECT submission_id,email FROM crm_website_leads WHERE submission_id=$1 AND deleted_at IS NULL',[m[1]])).rows[0];
    if(row&&(!row.email||!fromEmail||row.email.toLowerCase()===fromEmail.toLowerCase()))return row;
  }
  if(!fromEmail)return null;
  return (await q(`SELECT submission_id,email FROM crm_website_leads
    WHERE deleted_at IS NULL AND lower(coalesce(email,''))=lower($1)
    ORDER BY COALESCE(last_activity_at,updated_at,received_at) DESC LIMIT 1`,[fromEmail])).rows[0]||null;
}
async function matchService(subject,fromEmail){
  const m=String(subject||'').match(/\[HTFO-CID:(\d+)\]/i);
  if(m){
    const row=(await q('SELECT id,email FROM service_customers WHERE id=$1',[m[1]])).rows[0];
    if(row&&(!row.email||!fromEmail||row.email.toLowerCase()===fromEmail.toLowerCase()))return row;
  }
  if(!fromEmail)return null;
  return (await q(`SELECT id,email FROM service_customers WHERE lower(coalesce(email,''))=lower($1) ORDER BY id DESC LIMIT 1`,[fromEmail])).rows[0]||null;
}
async function ingest(mailbox,msg){
  const payload=msg.payload||{},subject=header(payload,'Subject')||'Re: HTFO message';
  const fromEmail=emailFromHeader(header(payload,'From'));
  if(!fromEmail||mailboxes().includes(fromEmail))return{skipped:true};
  const body=messageBody(payload);
  if(!body)return{skipped:true};
  const receivedAt=new Date(Number(msg.internalDate)||Date.now()).toISOString();
  const providerId='gmail:'+mailbox+':'+msg.id;

  const duplicate=(await q('SELECT 1 FROM crm_email_messages WHERE provider_id=$1 LIMIT 1',[providerId])).rowCount ||
    (await q('SELECT 1 FROM service_customer_emails WHERE provider_id=$1 LIMIT 1',[providerId])).rowCount;
  if(duplicate)return{duplicate:true};

  const sales=await matchSales(subject,fromEmail);
  if(sales){
    await q(`INSERT INTO crm_email_messages(submission_id,to_email,subject,body,provider_id,status,created_by,direction,from_email,received_at,created_at)
      VALUES($1,$2,$3,$4,$5,'received','gmail-sync','inbound',$6,$7,$7)`,
      [sales.submission_id,mailbox,subject,body,providerId,fromEmail,receivedAt]);
    await q(`UPDATE crm_website_leads SET last_activity_at=GREATEST(COALESCE(last_activity_at,$2::timestamptz),$2::timestamptz),
      pipeline_stage=CASE WHEN pipeline_stage IN ('New Lead','Attempted Contact') THEN 'Two Way Conversation' ELSE pipeline_stage END,updated_at=NOW()
      WHERE submission_id=$1`,[sales.submission_id,receivedAt]);
    await q(`UPDATE crm_email_messages SET replied_at=COALESCE(replied_at,$2::timestamptz)
      WHERE id=(SELECT id FROM crm_email_messages WHERE submission_id=$1 AND direction='outbound' ORDER BY created_at DESC LIMIT 1)`,
      [sales.submission_id,receivedAt]).catch(()=>{});
    return{sales:true};
  }

  const customer=await matchService(subject,fromEmail);
  if(customer){
    await q(`INSERT INTO service_customer_emails(customer_id,direction,from_email,to_email,subject,body,provider_id,status,created_at)
      VALUES($1,'inbound',$2,$3,$4,$5,$6,'received',$7)`,
      [customer.id,fromEmail,mailbox,subject,body,providerId,receivedAt]);
    return{service:true};
  }
  return{unmatched:true};
}
export async function syncGmailReplies(days=30,maxPerMailbox=250){
  await ensureSchema();
  const out={mailboxes:0,seen:0,saved_sales:0,saved_service:0,duplicates:0,unmatched:0,skipped:0,errors:[]};
  for(const mailbox of mailboxes()){
    out.mailboxes++;
    try{
      let pageToken='',remaining=Math.max(1,Number(maxPerMailbox)||250);
      while(remaining>0){
        const params=new URLSearchParams({labelIds:'INBOX',q:'newer_than:'+Math.max(1,Number(days)||30)+'d',maxResults:String(Math.min(100,remaining))});
        if(pageToken)params.set('pageToken',pageToken);
        const list=await gmail(mailbox,'messages?'+params.toString());
        for(const item of (list.messages||[])){
          if(remaining--<=0)break;
          out.seen++;
          try{
            const msg=await gmail(mailbox,'messages/'+encodeURIComponent(item.id)+'?format=full');
            const r=await ingest(mailbox,msg);
            if(r.sales)out.saved_sales++; else if(r.service)out.saved_service++; else if(r.duplicate)out.duplicates++; else if(r.unmatched)out.unmatched++; else out.skipped++;
          }catch(e){out.errors.push(mailbox+': '+String(e.message||e))}
        }
        pageToken=list.nextPageToken||'';
        if(!pageToken||remaining<=0)break;
      }
    }catch(e){out.errors.push(mailbox+': '+String(e.message||e))}
  }
  return out;
}
