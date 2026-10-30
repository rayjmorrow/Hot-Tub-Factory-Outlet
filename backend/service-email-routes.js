import express from 'express';
import jwt from 'jsonwebtoken';
import { q } from './service-db.js';

const router=express.Router();
const clean=v=>v==null?null:String(v).trim();
const jwtSecret=()=>{if(!process.env.SERVICE_JWT_SECRET)throw new Error('SERVICE_JWT_SECRET is required');return process.env.SERVICE_JWT_SECRET};
function auth(req,res,next){try{const raw=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');if(!raw)return res.status(401).json({error:'Login required'});req.user=jwt.verify(raw,jwtSecret());next()}catch{return res.status(401).json({error:'Session expired or invalid'})}}

export async function ensureServiceCustomerEmails(){
  await q(`CREATE TABLE IF NOT EXISTS service_customer_emails(
    id BIGSERIAL PRIMARY KEY,
    customer_id BIGINT NOT NULL REFERENCES service_customers(id) ON DELETE CASCADE,
    direction TEXT NOT NULL CHECK(direction IN ('inbound','outbound')),
    from_email TEXT,
    to_email TEXT,
    subject TEXT,
    body TEXT,
    provider_id TEXT,
    status TEXT,
    sent_by TEXT,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await q('CREATE UNIQUE INDEX IF NOT EXISTS idx_service_customer_emails_provider ON service_customer_emails(provider_id) WHERE provider_id IS NOT NULL');
  await q('CREATE INDEX IF NOT EXISTS idx_service_customer_emails_customer ON service_customer_emails(customer_id,created_at)');
  await q("CREATE INDEX IF NOT EXISTS idx_service_customer_emails_unread ON service_customer_emails(customer_id,created_at) WHERE direction='inbound' AND read_at IS NULL");
}
function staffEmail(user){
  const u=String(user?.username||'').trim().toLowerCase(),n=String(user?.name||user?.display_name||'').trim().toLowerCase();
  const map={steve:'steve@hottubfactoryoutlet.com',rick:'rick@hottubfactoryoutlet.com',ray:'ray@hottubfactoryoutlet.com'};
  if(map[u])return map[u];
  if(n.startsWith('steve'))return map.steve;
  if(n.startsWith('rick'))return map.rick;
  if(n.startsWith('ray'))return map.ray;
  return String(process.env.CRM_FROM_EMAIL||process.env.FULFILLMENT_FROM_EMAIL||'').trim();
}
function safeStaff(user){
  return String(user?.username||user?.name||'service').toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,20)||'service';
}
async function sendEmail(customer,user,subject,body){
  const key=String(process.env.BREVO_API_KEY||'').trim(),from=staffEmail(user);
  if(!key||!from)throw new Error('Operations email sender is not configured');
  const replyDomain=String(process.env.CRM_REPLY_DOMAIN||'reply.hottubfactoryoutlet.com').trim();
  const senderName=String(user?.name||user?.username||'HTFO Service').trim();
  const replyAddress=`service+${customer.id}+${safeStaff(user)}@${replyDomain}`;
  const payload={
    sender:{email:from,name:senderName},
    replyTo:{email:replyAddress,name:senderName},
    to:[{email:customer.email,name:[customer.first_name,customer.last_name].filter(Boolean).join(' ')||customer.email}],
    subject,textContent:body,
    tags:[`htfo-service-customer-${customer.id}`]
  };
  const r=await fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'api-key':key,'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j.message||('Brevo returned '+r.status));
  return {...j,from,replyAddress};
}

router.get('/customers/:id/emails',auth,async(req,res)=>{
  try{
    await ensureServiceCustomerEmails();
    const customer=(await q('SELECT id,first_name,last_name,email FROM service_customers WHERE id=$1',[req.params.id])).rows[0];
    if(!customer)return res.status(404).json({error:'Customer not found'});
    const rows=(await q('SELECT id,direction,from_email,to_email,subject,body,provider_id,status,sent_by,read_at,created_at FROM service_customer_emails WHERE customer_id=$1 ORDER BY created_at ASC,id ASC LIMIT 1000',[customer.id])).rows;
    await q("UPDATE service_customer_emails SET read_at=COALESCE(read_at,NOW()) WHERE customer_id=$1 AND direction='inbound' AND read_at IS NULL",[customer.id]);
    res.json({customer_email:customer.email||null,emails:rows});
  }catch(e){res.status(500).json({error:e.message})}
});

router.post('/customers/:id/emails',auth,async(req,res)=>{
  try{
    await ensureServiceCustomerEmails();
    const customer=(await q('SELECT id,first_name,last_name,email FROM service_customers WHERE id=$1',[req.params.id])).rows[0];
    if(!customer)return res.status(404).json({error:'Customer not found'});
    if(!customer.email)return res.status(400).json({error:'Customer has no email address on file'});
    const subject=String(req.body?.subject||'HTFO Service').trim().slice(0,240);
    const body=String(req.body?.body||'').trim();
    if(!body)return res.status(400).json({error:'Email message is required'});
    if(body.length>20000)return res.status(400).json({error:'Email message is too long'});
    const sent=await sendEmail(customer,req.user,subject,body);
    await q(`INSERT INTO service_customer_emails(customer_id,direction,from_email,to_email,subject,body,provider_id,status,sent_by)
      VALUES($1,'outbound',$2,$3,$4,$5,$6,'sent',$7)`,
      [customer.id,sent.from,customer.email,subject,body,sent.messageId||sent.message_id||null,req.user?.name||req.user?.username||'HTFO Staff']);
    res.json({ok:true,status:'sent'});
  }catch(e){res.status(502).json({error:e.message})}
});

export default router;
