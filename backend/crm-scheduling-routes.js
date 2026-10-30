import express from 'express';
import jwt from 'jsonwebtoken';
import { q } from './service-db.js';

const router=express.Router();
const clean=v=>v==null?null:String(v).trim();
const secret=()=>{if(!process.env.SERVICE_JWT_SECRET)throw new Error('SERVICE_JWT_SECRET is required');return process.env.SERVICE_JWT_SECRET};
function auth(req,res,next){try{const raw=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');if(!raw)return res.status(401).json({error:'Login required'});req.user=jwt.verify(raw,secret());next()}catch{return res.status(401).json({error:'Session expired or invalid'})}}
function role(req,res,next){if(!['admin','owner','manager','service_manager','sales'].includes(String(req.user?.role||'').toLowerCase()))return res.status(403).json({error:'CRM access requires a sales or management role'});next()}
const guard=[auth,role];
const isManager=req=>['admin','owner','manager','service_manager'].includes(String(req.user?.role||'').toLowerCase());
const salesNumber=()=>String(process.env.TWILIO_SALES_PHONE_NUMBER||process.env.TWILIO_PHONE_NUMBER||'').trim();

async function ensure(){
  await q("CREATE TABLE IF NOT EXISTS crm_scheduled_messages(id BIGSERIAL PRIMARY KEY,submission_id TEXT REFERENCES crm_website_leads(submission_id) ON DELETE CASCADE,channel TEXT NOT NULL CHECK(channel IN ('sms','email')),scheduled_for TIMESTAMPTZ NOT NULL,subject TEXT,body TEXT NOT NULL,assigned_to TEXT,created_by TEXT,status TEXT NOT NULL DEFAULT 'scheduled',provider_id TEXT,error TEXT,sent_at TIMESTAMPTZ,cancelled_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await q("ALTER TABLE crm_scheduled_messages ADD COLUMN IF NOT EXISTS sender_name TEXT");
  await q("ALTER TABLE crm_scheduled_messages ADD COLUMN IF NOT EXISTS from_email TEXT");
  await q("CREATE INDEX IF NOT EXISTS idx_crm_scheduled_due ON crm_scheduled_messages(status,scheduled_for)");
}
async function opted(phone){if(!phone)return true;const d=String(phone).replace(/\D/g,'');return (await q("SELECT 1 FROM crm_sms_messages WHERE regexp_replace(from_number,'\\D','','g')=$1 AND direction IN ('inbound','inbound-shadow') AND upper(trim(body)) IN ('STOP','STOPALL','UNSUBSCRIBE','CANCEL','END','QUIT') LIMIT 1",[d])).rowCount>0}
async function sendSms(to,body){const sid=String(process.env.TWILIO_ACCOUNT_SID||'').trim(),token=String(process.env.TWILIO_AUTH_TOKEN||'').trim(),from=salesNumber();if(!sid||!token||!from)throw new Error('Sales Twilio is not configured');const form=new URLSearchParams({To:String(to),From:from,Body:String(body)});const r=await fetch('https://api.twilio.com/2010-04-01/Accounts/'+encodeURIComponent(sid)+'/Messages.json',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(sid+':'+token).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:form});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.message||('Twilio returned '+r.status));return j}
function salespersonEmail(name){
  const n=String(name||'').trim().toLowerCase();
  if(n.startsWith('steve'))return 'steve@hottubfactoryoutlet.com';
  if(n.startsWith('rick'))return 'rick@hottubfactoryoutlet.com';
  if(n.startsWith('ray'))return 'ray@hottubfactoryoutlet.com';
  return String(process.env.CRM_FROM_EMAIL||process.env.FULFILLMENT_FROM_EMAIL||'').trim();
}
async function sendEmail(to,subject,body,name,salesperson,submissionId,fromOverride,senderOverride){
  const key=String(process.env.BREVO_API_KEY||'').trim(),from=String(fromOverride||salespersonEmail(salesperson)).trim();
  if(!key||!from)throw new Error('CRM email sender is not configured');
  const senderName=String(senderOverride||salesperson||process.env.CRM_FROM_NAME||'Hot Tub Factory Outlet');
  const replyAddress=from;
  const trackedSubject=submissionId?(String(subject||'Hot Tub Factory Outlet').replace(/\\s*\\[HTFO-CRM:[^\\]]+\\]\\s*$/i,'').trim()+\` [HTFO-CRM:\${submissionId}]\`):subject;
  const r=await fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'api-key':key,'Content-Type':'application/json'},body:JSON.stringify({sender:{email:from,name:senderName},replyTo:{email:replyAddress,name:senderName},to:[{email:to,name:name||to}],subject:trackedSubject,textContent:body,tags:submissionId?[\`htfo-crm-\${submissionId}\`]:undefined})});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j.message||('Brevo returned '+r.status));
  return {...j,from};
}

export async function runCrmScheduledMessages(){
  await ensure();
  const due=(await q("SELECT s.*,l.first_name,l.last_name,l.phone,l.email FROM crm_scheduled_messages s JOIN crm_website_leads l ON l.submission_id=s.submission_id WHERE s.status='scheduled' AND s.scheduled_for<=NOW() ORDER BY s.scheduled_for ASC LIMIT 50 FOR UPDATE SKIP LOCKED")).rows;
  let sent=0,failed=0,suppressed=0;
  for(const m of due){
    try{
      if(m.channel==='sms'){
        if(!m.phone||await opted(m.phone)){await q("UPDATE crm_scheduled_messages SET status='suppressed',error='No phone or SMS opt-out',updated_at=NOW() WHERE id=$1",[m.id]);suppressed++;continue}
        const x=await sendSms(m.phone,m.body);
        await q("INSERT INTO crm_sms_messages(twilio_sid,direction,from_number,to_number,body,status,lead_submission_id) VALUES($1,'outbound',$2,$3,$4,$5,$6) ON CONFLICT(twilio_sid) DO NOTHING",[x.sid,salesNumber(),m.phone,m.body,x.status||'queued',m.submission_id]);
        await q("UPDATE crm_scheduled_messages SET status='sent',provider_id=$2,sent_at=NOW(),updated_at=NOW() WHERE id=$1",[m.id,x.sid]);
      }else{
        if(!m.email)throw new Error('Lead has no email address');
        const x=await sendEmail(m.email,m.subject||'Hot Tub Factory Outlet',m.body,[m.first_name,m.last_name].filter(Boolean).join(' '),m.sender_name||m.assigned_to||m.created_by,m.submission_id,m.from_email,m.sender_name);
        await q("INSERT INTO crm_email_messages(submission_id,to_email,subject,body,provider_id,status,created_by,direction,from_email) VALUES($1,$2,$3,$4,$5,'sent',$6,'outbound',$7)",[m.submission_id,m.email,m.subject||'Hot Tub Factory Outlet',m.body,clean(x.messageId),m.created_by,clean(x.from)]);
        await q("UPDATE crm_scheduled_messages SET status='sent',provider_id=$2,sent_at=NOW(),updated_at=NOW() WHERE id=$1",[m.id,clean(x.messageId)]);
      }
      await q("UPDATE crm_website_leads SET last_contacted_at=NOW(),last_activity_at=NOW(),updated_at=NOW() WHERE submission_id=$1",[m.submission_id]);sent++;
    }catch(e){await q("UPDATE crm_scheduled_messages SET status='failed',error=$2,updated_at=NOW() WHERE id=$1",[m.id,String(e.message||e)]);failed++}
  }
  return{processed:due.length,sent,failed,suppressed};
}

router.post('/crm/v1/scheduled-messages',...guard,async(req,res)=>{try{
  await ensure();const id=clean(req.body?.submission_id),channel=clean(req.body?.channel),scheduled=req.body?.scheduled_for,body=String(req.body?.body||'').trim(),subject=clean(req.body?.subject);
  if(!id||!['sms','email'].includes(channel)||!scheduled||!body)return res.status(400).json({error:'Lead, channel, date/time and message are required'});
  if(new Date(scheduled).getTime()<=Date.now())return res.status(400).json({error:'Scheduled time must be in the future'});
  const lead=(await q('SELECT submission_id,assigned_to,phone,email FROM crm_website_leads WHERE submission_id=$1',[id])).rows[0];if(!lead)return res.status(404).json({error:'Lead not found'});
  if(channel==='sms'&&!lead.phone)return res.status(400).json({error:'Lead has no phone number'});if(channel==='email'&&!lead.email)return res.status(400).json({error:'Lead has no email address'});
  const who=clean(req.user?.name)||clean(req.user?.username),owner=clean(req.body?.assigned_to)||lead.assigned_to||who;const senderName=clean(req.body?.sender_name),fromEmail=clean(req.body?.from_email);
  const r=await q("INSERT INTO crm_scheduled_messages(submission_id,channel,scheduled_for,subject,body,assigned_to,created_by,sender_name,from_email) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",[id,channel,scheduled,subject,body,owner,who,senderName,fromEmail]);res.status(201).json(r.rows[0]);
}catch(e){res.status(500).json({error:e.message})}});

router.get('/crm/v1/scheduled-messages',...guard,async(req,res)=>{try{await ensure();const id=clean(req.query.submission_id),mine=String(req.query.mine||'false')==='true',who=clean(req.user?.name)||clean(req.user?.username);const p=[];let w='WHERE 1=1';if(id){p.push(id);w+=' AND s.submission_id=$'+p.length}if(mine){p.push(who);w+=' AND lower(coalesce(s.assigned_to,\'\'))=lower($'+p.length+')'}const r=await q('SELECT s.*,concat_ws(\' \',l.first_name,l.last_name) lead_name,l.phone,l.email FROM crm_scheduled_messages s JOIN crm_website_leads l ON l.submission_id=s.submission_id '+w+' ORDER BY s.scheduled_for ASC LIMIT 500',p);res.json(r.rows)}catch(e){res.status(500).json({error:e.message})}});

router.patch('/crm/v1/scheduled-messages/:id',...guard,async(req,res)=>{try{await ensure();const existing=(await q('SELECT * FROM crm_scheduled_messages WHERE id=$1',[req.params.id])).rows[0];if(!existing)return res.status(404).json({error:'Scheduled message not found'});const who=clean(req.user?.name)||clean(req.user?.username);if(!isManager(req)&&String(existing.created_by||'').toLowerCase()!==String(who||'').toLowerCase()&&String(existing.assigned_to||'').toLowerCase()!==String(who||'').toLowerCase())return res.status(403).json({error:'Not allowed'});if(existing.status!=='scheduled')return res.status(400).json({error:'Only scheduled messages can be edited'});const when=req.body?.scheduled_for||existing.scheduled_for,body=String(req.body?.body??existing.body).trim(),subject=clean(req.body?.subject??existing.subject);if(new Date(when).getTime()<=Date.now())return res.status(400).json({error:'Scheduled time must be in the future'});const r=await q("UPDATE crm_scheduled_messages SET scheduled_for=$2,subject=$3,body=$4,updated_at=NOW() WHERE id=$1 RETURNING *",[req.params.id,when,subject,body]);res.json(r.rows[0])}catch(e){res.status(500).json({error:e.message})}});

router.delete('/crm/v1/scheduled-messages/:id',...guard,async(req,res)=>{try{await ensure();const r=await q("UPDATE crm_scheduled_messages SET status='cancelled',cancelled_at=NOW(),updated_at=NOW() WHERE id=$1 AND status='scheduled' RETURNING *",[req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Scheduled message not found or already processed'});res.json(r.rows[0])}catch(e){res.status(500).json({error:e.message})}});

router.get('/crm/v1/my-day',...guard,async(req,res)=>{try{
  await ensure();const who=clean(req.query.assigned_to)||clean(req.user?.name)||clean(req.user?.username),team=String(req.query.team||'false')==='true'&&isManager(req);const p=team?[]:[who];const ownerTask=team?'':' AND lower(coalesce(t.assigned_to,\'\'))=lower($1)',ownerLead=team?'':' AND lower(coalesce(l.assigned_to,\'\'))=lower($1)',ownerMsg=team?'':' AND lower(coalesce(s.assigned_to,\'\'))=lower($1)';
  const [tasks,followups,messages,newLeads]=await Promise.all([
    q("SELECT t.*,concat_ws(' ',l.first_name,l.last_name) lead_name,l.phone,l.email FROM crm_tasks t LEFT JOIN crm_website_leads l ON l.submission_id=t.submission_id WHERE t.status='open' AND t.due_at<CURRENT_DATE+INTERVAL '1 day'"+ownerTask+" ORDER BY t.due_at ASC LIMIT 200",p),
    q("SELECT l.submission_id,l.first_name,l.last_name,l.phone,l.email,l.assigned_to,l.next_follow_up_at,l.pipeline_stage FROM crm_website_leads l WHERE l.next_follow_up_at IS NOT NULL AND l.next_follow_up_at<CURRENT_DATE+INTERVAL '1 day' AND l.pipeline_stage NOT IN ('Sold','Lost')"+ownerLead+" ORDER BY l.next_follow_up_at ASC LIMIT 200",p),
    q("SELECT s.*,concat_ws(' ',l.first_name,l.last_name) lead_name FROM crm_scheduled_messages s JOIN crm_website_leads l ON l.submission_id=s.submission_id WHERE s.status='scheduled' AND s.scheduled_for<CURRENT_DATE+INTERVAL '1 day'"+ownerMsg+" ORDER BY s.scheduled_for ASC LIMIT 200",p),
    q("SELECT l.submission_id,l.first_name,l.last_name,l.phone,l.email,l.source,l.assigned_to,l.received_at FROM crm_website_leads l WHERE l.received_at>=CURRENT_DATE AND l.pipeline_stage='New Lead'"+ownerLead+" ORDER BY l.received_at DESC LIMIT 200",p)
  ]);
  res.json({owner:team?'Team':who,tasks:tasks.rows,followups:followups.rows,scheduled_messages:messages.rows,new_leads:newLeads.rows});
}catch(e){res.status(500).json({error:e.message})}});

export default router;