import jwt from 'jsonwebtoken';
import { q } from './service-db.js';
import { ensureServiceCustomerEmails } from './service-email-routes.js';

const scope='https://www.googleapis.com/auth/gmail.readonly';
const domain='@hottubfactoryoutlet.com';
let running=false;

function cfg(){
  const raw=String(process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64||'').trim();
  if(!raw)return null;
  try{return JSON.parse(Buffer.from(raw,'base64').toString('utf8'))}catch{return null}
}
function users(){
  return String(process.env.GOOGLE_GMAIL_USERS||'ray@hottubfactoryoutlet.com,rick@hottubfactoryoutlet.com,steve@hottubfactoryoutlet.com')
    .split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
}
function b64urlDecode(s=''){
  s=String(s).replace(/-/g,'+').replace(/_/g,'/');
  while(s.length%4)s+='=';
  return Buffer.from(s,'base64').toString('utf8');
}
function headers(payload){
  const out={};for(const h of payload?.headers||[])out[String(h.name||'').toLowerCase()]=String(h.value||'');return out;
}
function textBody(part){
  if(!part)return'';
  if(part.mimeType==='text/plain'&&part.body?.data)return b64urlDecode(part.body.data);
  for(const p of part.parts||[]){const t=textBody(p);if(t)return t}
  if(part.body?.data)return b64urlDecode(part.body.data).replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ');
  return'';
}
function cleanBody(s){
  return String(s||'').replace(/\r/g,'').split(/\nOn .+wrote:\n/i)[0].split(/\nFrom:\s.+\nSent:/i)[0].trim().slice(0,20000);
}
function emailAddress(s){
  const m=String(s||'').match(/<([^>]+)>/);return (m?m[1]:String(s||'')).trim().toLowerCase();
}
async function tokenFor(subject){
  const c=cfg();if(!c?.client_email||!c?.private_key)return null;
  const now=Math.floor(Date.now()/1000);
  const assertion=jwt.sign({iss:c.client_email,scope,aud:c.token_uri||'https://oauth2.googleapis.com/token',iat:now,exp:now+3600,sub:subject},c.private_key,{algorithm:'RS256'});
  const r=await fetch(c.token_uri||'https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})});
  const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error_description||j.error||('Google token '+r.status));return j.access_token;
}
async function gmailGet(tok,path){
  const r=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/'+path,{headers:{Authorization:'Bearer '+tok}});
  const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error?.message||('Gmail '+r.status));return j;
}
async function importMessage(owner,msg){
  const h=headers(msg.payload),from=emailAddress(h.from),to=emailAddress(h.to),subject=String(h.subject||'').trim(),body=cleanBody(textBody(msg.payload));
  if(!from||from.endsWith(domain)||!body)return false;
  const gmailId='gmail:'+owner+':'+msg.id;
  const cid=(subject.match(/\[HTFO-CID:(\d+)\]/i)||[])[1];
  const leadId=(subject.match(/\[HTFO-LEAD:([^\]]+)\]/i)||[])[1];

  if(cid){
    await ensureServiceCustomerEmails();
    const customer=(await q('SELECT id,email FROM service_customers WHERE id=$1',[cid])).rows[0];
    if(customer?.email&&String(customer.email).toLowerCase()===from){
      const ins=await q(`INSERT INTO service_customer_emails(customer_id,direction,from_email,to_email,subject,body,provider_id,status,created_at)
        VALUES($1,'inbound',$2,$3,$4,$5,$6,'received',to_timestamp($7/1000.0))
        ON CONFLICT(provider_id) WHERE provider_id IS NOT NULL DO NOTHING RETURNING id`,
        [customer.id,from,owner,subject,body,gmailId,Number(msg.internalDate||Date.now())]);
      if(ins.rowCount){
        await q("UPDATE service_customer_emails SET replied_at=COALESCE(replied_at,NOW()) WHERE customer_id=$1 AND direction='outbound' AND created_at=(SELECT max(created_at) FROM service_customer_emails WHERE customer_id=$1 AND direction='outbound')",[customer.id]).catch(()=>{});
        return true;
      }
    }
  }

  let lead=null;
  if(leadId)lead=(await q('SELECT submission_id,email FROM crm_website_leads WHERE submission_id=$1 AND deleted_at IS NULL',[leadId])).rows[0];
  if(!lead)lead=(await q('SELECT submission_id,email FROM crm_website_leads WHERE lower(trim(email))=$1 AND deleted_at IS NULL ORDER BY received_at DESC LIMIT 1',[from])).rows[0];
  if(lead){
    const exists=(await q('SELECT 1 FROM crm_email_messages WHERE provider_id=$1 LIMIT 1',[gmailId])).rowCount;
    if(!exists){
      await q(`INSERT INTO crm_email_messages(submission_id,to_email,subject,body,provider_id,status,created_by,direction,from_email,received_at)
        VALUES($1,$2,$3,$4,$5,'received','customer','inbound',$6,to_timestamp($7/1000.0))`,
        [lead.submission_id,owner,subject,body,gmailId,from,Number(msg.internalDate||Date.now())]);
      await q("UPDATE crm_website_leads SET last_activity_at=NOW(),pipeline_stage=CASE WHEN pipeline_stage IN ('New Lead','Attempted Contact') THEN 'Two Way Conversation' ELSE pipeline_stage END,updated_at=NOW() WHERE submission_id=$1",[lead.submission_id]);
      await q("UPDATE crm_email_messages SET replied_at=COALESCE(replied_at,NOW()) WHERE submission_id=$1 AND direction='outbound' AND created_at=(SELECT max(created_at) FROM crm_email_messages WHERE submission_id=$1 AND direction='outbound')",[lead.submission_id]).catch(()=>{});
      return true;
    }
  }

  // Service fallback: if no marker, match a unique service customer email.
  const customers=(await q('SELECT id,email FROM service_customers WHERE lower(trim(email))=$1 LIMIT 2',[from])).rows;
  if(customers.length===1){
    await ensureServiceCustomerEmails();
    const customer=customers[0];
    const ins=await q(`INSERT INTO service_customer_emails(customer_id,direction,from_email,to_email,subject,body,provider_id,status,created_at)
      VALUES($1,'inbound',$2,$3,$4,$5,$6,'received',to_timestamp($7/1000.0))
      ON CONFLICT(provider_id) WHERE provider_id IS NOT NULL DO NOTHING RETURNING id`,
      [customer.id,from,owner,subject,body,gmailId,Number(msg.internalDate||Date.now())]);
    return Boolean(ins.rowCount);
  }
  return false;
}

export async function syncGmailReplies(days=30){
  if(running)return{skipped:true,reason:'already running'};
  const c=cfg();if(!c)return{skipped:true,reason:'credential missing'};
  running=true;
  try{
    let scanned=0,imported=0,mailboxes=0;
    for(const owner of users()){
      const tok=await tokenFor(owner);mailboxes++;
      let pageToken='';
      for(let page=0;page<3;page++){
        const qs=new URLSearchParams({q:`newer_than:${Math.max(1,days)}d`,maxResults:'100'});
        if(pageToken)qs.set('pageToken',pageToken);
        const list=await gmailGet(tok,'messages?'+qs.toString());
        for(const x of list.messages||[]){
          const msg=await gmailGet(tok,'messages/'+encodeURIComponent(x.id)+'?format=full');
          scanned++;if(await importMessage(owner,msg))imported++;
        }
        pageToken=list.nextPageToken||'';if(!pageToken)break;
      }
    }
    return{ok:true,mailboxes,scanned,imported};
  }finally{running=false}
}

export async function testGmailAccess(){
  const out=[];for(const owner of users()){const tok=await tokenFor(owner);const p=await gmailGet(tok,'profile');out.push({owner,emailAddress:p.emailAddress||owner,messagesTotal:p.messagesTotal||0})}return out;
}
