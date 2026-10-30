import express from 'express';
import { q } from './service-db.js';
import { ensureServiceCustomerEmails } from './service-email-routes.js';

const router=express.Router();
const clean=v=>v==null?null:String(v).trim();
function staffEmail(name){const n=String(name||'').trim().toLowerCase();if(n.startsWith('steve'))return 'steve@hottubfactoryoutlet.com';if(n.startsWith('rick'))return 'rick@hottubfactoryoutlet.com';if(n.startsWith('ray'))return 'ray@hottubfactoryoutlet.com';return String(process.env.CRM_FROM_EMAIL||process.env.FULFILLMENT_FROM_EMAIL||'').trim()}
async function ensure(){await q("ALTER TABLE crm_email_messages ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'outbound'; ALTER TABLE crm_email_messages ADD COLUMN IF NOT EXISTS from_email TEXT; ALTER TABLE crm_email_messages ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ")}
async function forward(to,subject,body){const key=String(process.env.BREVO_API_KEY||'').trim(),from=String(process.env.CRM_FROM_EMAIL||process.env.FULFILLMENT_FROM_EMAIL||'').trim();if(!key||!from||!to)return;const r=await fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'api-key':key,'Content-Type':'application/json'},body:JSON.stringify({sender:{email:from,name:'HTFO CRM'},to:[{email:to}],subject,textContent:body})});if(!r.ok){const j=await r.json().catch(()=>({}));throw new Error(j.message||('Brevo returned '+r.status))}}

router.post('/crm/email/inbound',async(req,res)=>{
  try{
    const expected=String(process.env.CRM_EMAIL_WEBHOOK_SECRET||'').trim();
    const supplied=String(req.query?.secret||req.get('x-htfo-email-secret')||'').trim();
    if(!expected||supplied!==expected)return res.status(403).json({error:'Forbidden'});
    await ensure();const items=Array.isArray(req.body?.items)?req.body.items:[];let saved=0,forwarded=0;
    for(const item of items){
      const tos=[...(Array.isArray(item.To)?item.To:[]),...(Array.isArray(item.Recipients)?item.Recipients.map(x=>typeof x==='string'?{Address:x}:x):[])];
      const addresses=tos.map(x=>String(x?.Address||x||''));
      const fromEmail=clean(item.From?.Address)||clean(item.from?.email),subject=clean(item.Subject)||'Re: HTFO message';
      const body=String(item.ExtractedMarkdownMessage||item.RawTextBody||item.RawHtmlBody||'').trim();if(!body)continue;
      const providerId=clean(item.MessageId)||clean(item.Uuid?.[0]);

      const serviceAddr=addresses.find(x=>/service\+/i.test(x))||'';
      const serviceMatch=serviceAddr.match(/service\+(\d+)\+([^@]+)@/i);
      if(serviceMatch){
        await ensureServiceCustomerEmails();
        const customer=(await q('SELECT id,email FROM service_customers WHERE id=$1',[serviceMatch[1]])).rows[0];
        if(customer?.email&&fromEmail&&customer.email.toLowerCase()===fromEmail.toLowerCase()){
          await q(`INSERT INTO service_customer_emails(customer_id,direction,from_email,to_email,subject,body,provider_id,status,created_at)
            VALUES($1,'inbound',$2,$3,$4,$5,$6,'received',NOW())
            ON CONFLICT(provider_id) WHERE provider_id IS NOT NULL DO NOTHING`,
            [customer.id,fromEmail,serviceAddr,subject,body,providerId]);
          saved++;
        }
        continue;
      }

      const addr=addresses.find(x=>/crm\+/i.test(x))||'';
      const m=addr.match(/crm\+([^+@]+)\+([^@]+)@/i);if(!m)continue;
      const submissionId=m[1],salesKey=m[2];
      const lead=(await q('SELECT submission_id,first_name,last_name,email,assigned_to FROM crm_website_leads WHERE submission_id=$1 AND deleted_at IS NULL',[submissionId])).rows[0];if(!lead)continue;
      await q("INSERT INTO crm_email_messages(submission_id,to_email,subject,body,provider_id,status,created_by,direction,from_email,received_at) VALUES($1,$2,$3,$4,$5,'received','customer','inbound',$6,NOW())",[submissionId,addr,subject,body,providerId,fromEmail]);
      await q("UPDATE crm_website_leads SET last_activity_at=NOW(),pipeline_stage=CASE WHEN pipeline_stage IN ('New Lead','Attempted Contact') THEN 'Two Way Conversation' ELSE pipeline_stage END,updated_at=NOW() WHERE submission_id=$1",[submissionId]);saved++;
      const target=staffEmail(lead.assigned_to||salesKey);if(target){await forward(target,subject,body);forwarded++}
    }
    res.json({ok:true,saved,forwarded});
  }catch(e){res.status(500).json({error:e.message})}
});

export default router;