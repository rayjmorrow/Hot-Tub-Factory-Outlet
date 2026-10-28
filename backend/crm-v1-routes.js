import express from 'express';
import {randomBytes,createHash} from 'node:crypto';
import jwt from 'jsonwebtoken';
import PDFDocument from 'pdfkit';
import { proposedSalesTermsReference } from './proposed-sales-terms-inhouse.js';
import { q } from './service-db.js';

const router=express.Router();
const clean=v=>v==null?null:String(v).trim();
const secret=()=>{if(!process.env.SERVICE_JWT_SECRET)throw new Error('SERVICE_JWT_SECRET is required');return process.env.SERVICE_JWT_SECRET};
function auth(req,res,next){try{const raw=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');if(!raw)return res.status(401).json({error:'Login required'});req.user=jwt.verify(raw,secret());next()}catch{return res.status(401).json({error:'Session expired or invalid'})}}
function role(req,res,next){if(!['admin','owner','manager','service_manager','sales'].includes(String(req.user?.role||'').toLowerCase()))return res.status(403).json({error:'CRM access requires a sales or management role'});next()}
const guard=[auth,role];
const isManager=req=>['admin','owner','manager','service_manager'].includes(String(req.user?.role||'').toLowerCase());
const sid=()=>String(process.env.TWILIO_ACCOUNT_SID||'').trim();
const token=()=>String(process.env.TWILIO_AUTH_TOKEN||'').trim();
const salesNumber=()=>String(process.env.TWILIO_SALES_PHONE_NUMBER||process.env.TWILIO_PHONE_NUMBER||'').trim();

async function ensure(){
  await q(`ALTER TABLE crm_website_leads ADD COLUMN IF NOT EXISTS product_interest TEXT;
    ALTER TABLE crm_website_leads ADD COLUMN IF NOT EXISTS brand_interest TEXT;
    ALTER TABLE crm_website_leads ADD COLUMN IF NOT EXISTS model_interest TEXT;
    ALTER TABLE crm_website_leads ADD COLUMN IF NOT EXISTS assigned_to TEXT;
    ALTER TABLE crm_website_leads ADD COLUMN IF NOT EXISTS showroom TEXT;
    ALTER TABLE crm_website_leads ADD COLUMN IF NOT EXISTS next_follow_up_at TIMESTAMPTZ;
    ALTER TABLE crm_website_leads ADD COLUMN IF NOT EXISTS last_contacted_at TIMESTAMPTZ;
    ALTER TABLE crm_website_leads ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;
    ALTER TABLE crm_website_leads ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
    ALTER TABLE crm_website_leads ADD COLUMN IF NOT EXISTS deleted_by TEXT;
    ALTER TABLE crm_website_leads ADD COLUMN IF NOT EXISTS has_opportunity BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE crm_website_leads ADD COLUMN IF NOT EXISTS ghl_pipeline_id TEXT;
    ALTER TABLE crm_website_leads ADD COLUMN IF NOT EXISTS ghl_pipeline_stage_id TEXT;
    ALTER TABLE crm_website_leads ADD COLUMN IF NOT EXISTS ghl_assigned_user_id TEXT;
    ALTER TABLE crm_website_leads ADD COLUMN IF NOT EXISTS ghl_assigned_user_name TEXT;
    ALTER TABLE crm_website_leads ADD COLUMN IF NOT EXISTS ghl_opportunity_value NUMERIC(12,2);
    ALTER TABLE crm_website_leads ADD COLUMN IF NOT EXISTS ghl_stage_probability NUMERIC(8,2);
    ALTER TABLE crm_website_leads ADD COLUMN IF NOT EXISTS ghl_last_stage_change_at TIMESTAMPTZ;
    ALTER TABLE crm_website_leads ADD COLUMN IF NOT EXISTS ghl_last_status_change_at TIMESTAMPTZ;
    CREATE TABLE IF NOT EXISTS crm_tasks(id BIGSERIAL PRIMARY KEY,submission_id TEXT REFERENCES crm_website_leads(submission_id) ON DELETE CASCADE,title TEXT NOT NULL,due_at TIMESTAMPTZ NOT NULL,assigned_to TEXT,status TEXT NOT NULL DEFAULT 'open',created_by TEXT,completed_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS crm_email_messages(id BIGSERIAL PRIMARY KEY,submission_id TEXT REFERENCES crm_website_leads(submission_id) ON DELETE CASCADE,to_email TEXT NOT NULL,subject TEXT NOT NULL,body TEXT NOT NULL,provider_id TEXT,status TEXT NOT NULL DEFAULT 'queued',created_by TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    ALTER TABLE crm_email_messages ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'outbound';
    ALTER TABLE crm_email_messages ADD COLUMN IF NOT EXISTS from_email TEXT;
    ALTER TABLE crm_email_messages ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ;
    CREATE INDEX IF NOT EXISTS idx_crm_tasks_due ON crm_tasks(status,due_at);
    CREATE INDEX IF NOT EXISTS idx_crm_email_submission ON crm_email_messages(submission_id,created_at DESC);`);
  await q("CREATE TABLE IF NOT EXISTS crm_highlevel_events(id BIGSERIAL PRIMARY KEY,external_id TEXT NOT NULL UNIQUE,submission_id TEXT REFERENCES crm_website_leads(submission_id) ON DELETE CASCADE,ghl_contact_id TEXT,ghl_conversation_id TEXT,event_type TEXT NOT NULL,direction TEXT,subject TEXT,body TEXT,author TEXT,status TEXT,occurred_at TIMESTAMPTZ NOT NULL,raw JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await q(`UPDATE crm_website_leads SET pipeline_stage=CASE pipeline_stage
    WHEN 'Contacted' THEN 'Attempted Contact'
    WHEN 'Appointment' THEN 'Appointment Set'
    WHEN 'Visited Showroom' THEN 'Showroom Visit'
    WHEN 'Sold' THEN 'Won'
    ELSE pipeline_stage END
    WHERE pipeline_stage IN ('Contacted','Appointment','Visited Showroom','Sold')`);
}
function splitName(n){const p=String(n||'').trim().split(/\s+/).filter(Boolean);return{first:p.shift()||null,last:p.length?p.join(' '):null}}
function showroomFrom(tags=[]){const a=(Array.isArray(tags)?tags:[]).map(x=>String(x).toLowerCase());return a.includes('showroom-wexford')?'Wexford':a.includes('showroom-monroeville')?'Monroeville':a.includes('showroom-either')?'Either':null}
function merge(t,l){return String(t||'').replaceAll('{Name}',clean(l.first_name)||'there').replaceAll('{FirstName}',clean(l.first_name)||'there').replaceAll('{Product}',clean(l.product_interest)||'').replaceAll('{Brand}',clean(l.brand_interest)||'').replaceAll('{Model}',clean(l.model_interest)||'')}
async function sms(to,body){const a=sid(),b=token(),from=salesNumber();if(!a||!b||!from)throw new Error('Sales Twilio is not fully configured');const form=new URLSearchParams({To:String(to),From:from,Body:String(body)});const r=await fetch('https://api.twilio.com/2010-04-01/Accounts/'+encodeURIComponent(a)+'/Messages.json',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(a+':'+b).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:form});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.message||('Twilio returned '+r.status));return j}
async function opted(phone){if(!phone)return true;const d=String(phone).replace(/\D/g,'');return (await q(`SELECT 1 FROM crm_sms_messages WHERE regexp_replace(from_number,'\\D','','g')=$1 AND direction IN ('inbound','inbound-shadow') AND upper(trim(body)) IN ('STOP','STOPALL','UNSUBSCRIBE','CANCEL','END','QUIT') LIMIT 1`,[d])).rowCount>0}
function staffEmail(u){
  const username=String(u?.username||'').trim().toLowerCase();
  const display=String(u?.name||u?.display_name||'').trim().toLowerCase();
  const map={steve:'steve@hottubfactoryoutlet.com',rick:'rick@hottubfactoryoutlet.com',ray:'ray@hottubfactoryoutlet.com'};
  if(map[username])return map[username];
  if(display.startsWith('steve'))return map.steve;
  if(display.startsWith('rick'))return map.rick;
  if(display.startsWith('ray'))return map.ray;
  return String(process.env.CRM_FROM_EMAIL||process.env.FULFILLMENT_FROM_EMAIL||'').trim();
}
async function email(to,subject,body,name,user,submissionId){
  const key=String(process.env.BREVO_API_KEY||'').trim(),from=staffEmail(user);
  if(!key||!from)throw new Error('CRM email sender is not configured');
  const senderName=String(user?.name||user?.display_name||process.env.CRM_FROM_NAME||'Hot Tub Factory Outlet').trim();
  const replyDomain=String(process.env.CRM_REPLY_DOMAIN||'reply.hottubfactoryoutlet.com').trim();
  const safeUser=String(user?.username||user?.name||'sales').toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,20)||'sales';
  const replyAddress=submissionId?`crm+${submissionId}+${safeUser}@${replyDomain}`:from;
  const payload={sender:{email:from,name:senderName},replyTo:{email:replyAddress,name:senderName},to:[{email:to,name:name||to}],subject,textContent:body,tags:submissionId?[`htfo-crm-${submissionId}`]:undefined};
  const r=await fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'api-key':key,'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j.message||('Brevo returned '+r.status));
  return {...j,from};
}

function normalizePipelineStage(name,status){
  const s=String(status||'').toLowerCase(),n=String(name||'').trim().toLowerCase();
  if(s==='won')return 'Won';
  if(s==='lost'||s==='abandoned')return 'Lost';
  if(!n)return null;
  if(n.includes('new'))return 'New Lead';
  if(n.includes('attempt'))return 'Attempted Contact';
  if(n.includes('two way')||n.includes('2 way')||n.includes('conversation')||n.includes('engaged'))return 'Two Way Conversation';
  if(n.includes('appoint'))return 'Appointment Set';
  if(n.includes('visit')||n.includes('showroom'))return 'Showroom Visit';
  if(n.includes('quot')||n.includes('proposal')||n.includes('price'))return 'Quoted';
  if(n.includes('sold')||n.includes('won'))return 'Won';
  if(n.includes('contact'))return 'Attempted Contact';
  if(n.includes('lost')||n.includes('dead')||n.includes('closed'))return 'Lost';
  return null;
}
function stageFromHighLevel(status,probability){
  const s=String(status||'').toLowerCase(),p=Number(probability)||0;
  if(s==='won')return 'Won';
  if(s==='lost'||s==='abandoned')return 'Lost';
  if(p<=20)return 'New Lead';
  if(p<=30)return 'Attempted Contact';
  if(p<=40)return 'Two Way Conversation';
  if(p<=55)return 'Appointment Set';
  if(p<=70)return 'Showroom Visit';
  return 'Quoted';
}
function contactIdFromOpportunity(x){
  return clean(x?.contact?.id)||clean((x?.relations||[]).find(r=>r?.objectKey==='contact')?.recordId)||String(x?.contactId||'').replace(/^opportunities_/,'')||null;
}
async function importSource(path,params={}){
  const source=String(process.env.CRM_IMPORT_SOURCE_URL||'').trim(),secret=String(process.env.CRM_IMPORT_SECRET||'').trim();
  if(!source||!secret)throw new Error('HighLevel migration source is not configured');
  const u=new URL(path,new URL(source).origin);
  for(const [k,v] of Object.entries(params))if(v!==''&&v!=null)u.searchParams.set(k,String(v));
  const r=await fetch(u,{headers:{'x-htfo-import-secret':secret,Accept:'application/json'}}),j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j.message||j.error||('Migration source returned '+r.status));
  return j;
}

router.get('/crm/v1/me',...guard,(req,res)=>res.json({user:req.user}));
router.get('/crm/v1/dashboard',...guard,async(req,res)=>{try{
  await ensure();
  const r=(await q(`SELECT
    count(*)::int contacts,
    count(*) FILTER(WHERE has_opportunity=true AND lower(coalesce(ghl_opportunity_status,'open'))='open')::int open_opportunities,
    count(*) FILTER(WHERE has_opportunity=true AND lower(coalesce(ghl_opportunity_status,''))='won')::int won,
    count(*) FILTER(WHERE has_opportunity=true AND lower(coalesce(ghl_opportunity_status,''))='lost')::int lost,
    count(*) FILTER(WHERE has_opportunity=true)::int total_opportunities,
    count(*) FILTER(WHERE has_opportunity=false)::int contacts_without_opportunity
    FROM crm_website_leads WHERE deleted_at IS NULL`)).rows[0];
  res.json(r);
}catch(e){res.status(500).json({error:e.message})}});

router.get('/crm/v1/staff',...guard,async(req,res)=>{try{await ensure();res.json((await q(`SELECT id,username,display_name,role FROM service_users WHERE active=true AND role IN ('admin','owner','manager','service_manager','sales') ORDER BY display_name`)).rows)}catch(e){res.status(500).json({error:e.message})}});

router.post('/crm/v1/leads',...guard,async(req,res)=>{try{
  await ensure();
  const b=req.body||{},first=clean(b.first_name),last=clean(b.last_name),phone=clean(b.phone),emailAddr=clean(b.email);
  if(!first&&!last)return res.status(400).json({error:'First or last name is required'});
  if(!phone&&!emailAddr)return res.status(400).json({error:'Phone or email is required'});
  const source=clean(b.source)||'Walk-In';
  if(!['Walk-In','Phone','Referral','Other'].includes(source))return res.status(400).json({error:'Choose a valid lead source'});
  let existing=null;
  if(emailAddr)existing=(await q("SELECT submission_id,first_name,last_name,email,phone FROM crm_website_leads WHERE deleted_at IS NULL AND lower(coalesce(email,''))=lower($1) ORDER BY received_at DESC LIMIT 1",[emailAddr])).rows[0]||null;
  if(!existing&&phone)existing=(await q("SELECT submission_id,first_name,last_name,email,phone FROM crm_website_leads WHERE deleted_at IS NULL AND regexp_replace(coalesce(phone,''),'\\D','','g')=regexp_replace($1,'\\D','','g') ORDER BY received_at DESC LIMIT 1",[phone])).rows[0]||null;
  if(existing)return res.status(409).json({error:'A lead with this phone or email already exists',existing});
  const who=clean(req.user?.name)||clean(req.user?.username)||null;
  const id='manual-'+Date.now()+'-'+Math.random().toString(36).slice(2,8);
  const assigned=clean(b.assigned_to)||who,showroom=clean(b.showroom),product=clean(b.product_interest),brand=clean(b.brand_interest),model=clean(b.model_interest),note=clean(b.note),follow=b.next_follow_up_at||null;
  const payload={manual_entry:true,entry_method:source,created_by:who};
  const r=await q(`INSERT INTO crm_website_leads(submission_id,first_name,last_name,email,phone,source,note,payload,product_interest,brand_interest,model_interest,assigned_to,showroom,next_follow_up_at,lifecycle_stage,pipeline_stage,has_opportunity,received_at,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,'Prospect','New Lead',true,NOW(),NOW()) RETURNING *`,
    [id,first,last,emailAddr,phone,source,note,JSON.stringify(payload),product,brand,model,assigned,showroom,follow]);
  if(follow)await q(`INSERT INTO crm_tasks(submission_id,title,due_at,assigned_to,created_by) VALUES($1,$2,$3,$4,$5)`,[id,'Follow up with '+[first,last].filter(Boolean).join(' '),follow,assigned,who]).catch(()=>{});
  res.status(201).json(r.rows[0]);
}catch(e){res.status(500).json({error:e.message})}});

router.get('/crm/v1/leads',...guard,async(req,res)=>{try{
  await ensure();const term=clean(req.query.q)||'',stage=clean(req.query.stage),product=clean(req.query.product),brand=clean(req.query.brand),model=clean(req.query.model),assigned=clean(req.query.assigned_to),showroom=clean(req.query.showroom);
  const p=['%'+term+'%'];let w=`WHERE deleted_at IS NULL AND concat_ws(' ',first_name,last_name,email,phone,source,note,product_interest,brand_interest,model_interest,tags::text,payload::text) ILIKE $1`;
  if(stage){p.push(stage);w+=' AND pipeline_stage=$'+p.length}if(product){p.push(product);w+=' AND lower(coalesce(product_interest,\'\'))=lower($'+p.length+')'}if(brand){p.push('%'+brand+'%');w+=' AND coalesce(brand_interest,\'\') ILIKE $'+p.length}if(model){p.push('%'+model+'%');w+=' AND coalesce(model_interest,\'\') ILIKE $'+p.length}if(assigned){p.push(assigned);w+=' AND lower(coalesce(assigned_to,\'\'))=lower($'+p.length+')'}if(showroom){p.push(showroom);w+=' AND lower(coalesce(showroom,\'\'))=lower($'+p.length+')'}
  p.push(Math.min(1500,Math.max(1,Number(req.query.limit)||500)));
  res.json((await q(`SELECT * FROM (SELECT submission_id,first_name,last_name,email,phone,source,tags,note,payload,product_interest,brand_interest,model_interest,assigned_to,showroom,next_follow_up_at,last_contacted_at,last_activity_at,has_opportunity,ghl_opportunity_status,ghl_opportunity_id,ghl_pipeline_id,ghl_pipeline_stage_id,ghl_assigned_user_id,ghl_assigned_user_name,ghl_opportunity_value,ghl_stage_probability,ghl_last_stage_change_at,ghl_last_status_change_at,lifecycle_stage,pipeline_stage,ghl_contact_id,received_at,updated_at , GREATEST(
    (SELECT MAX(m.created_at) FROM crm_sms_messages m WHERE m.lead_submission_id=crm_website_leads.submission_id AND lower(m.direction) LIKE 'inbound%' AND m.status IS DISTINCT FROM 'historical-optout'),
    (SELECT MAX(COALESCE(e.received_at,e.created_at)) FROM crm_email_messages e WHERE e.submission_id=crm_website_leads.submission_id AND lower(e.direction)='inbound'),
    (SELECT MAX(h.occurred_at) FROM crm_highlevel_events h WHERE h.submission_id=crm_website_leads.submission_id AND lower(h.direction)='inbound')
  ) AS last_customer_reply_at FROM crm_website_leads ${w}) activity_leads ORDER BY GREATEST(received_at,last_customer_reply_at) DESC,submission_id LIMIT $${p.length}`,p)).rows);
}catch(e){res.status(500).json({error:e.message})}});

router.get('/crm/v1/conversations',...guard,async(req,res)=>{try{
  await ensure();
  const days=Math.min(365,Math.max(1,Number(req.query.days)||30));
  const limit=Math.min(1000,Math.max(1,Number(req.query.limit)||300));
  const channel=clean(req.query.channel)||'all',direction=clean(req.query.direction)||'all',term=clean(req.query.q)||'';
  const params=[String(days),String(limit),term?('%'+term+'%'):null,channel,direction];
  const rows=(await q(`
    WITH sms AS (
      SELECT m.id::text message_id,'sms'::text channel,m.direction,NULL::text subject,m.body,m.status,m.created_at occurred_at,
        COALESCE(m.lead_submission_id,match.submission_id) submission_id
      FROM crm_sms_messages m
      LEFT JOIN LATERAL (
        SELECT l.submission_id FROM crm_website_leads l
        WHERE l.deleted_at IS NULL
          AND regexp_replace(coalesce(l.phone,''),'\\D','','g')=regexp_replace(
            CASE WHEN lower(coalesce(m.direction,'')) LIKE 'inbound%' THEN coalesce(m.from_number,'') ELSE coalesce(m.to_number,'') END,
            '\\D','','g')
          AND regexp_replace(coalesce(l.phone,''),'\\D','','g')<>''
        ORDER BY l.received_at DESC LIMIT 1
      ) match ON true
      WHERE m.created_at >= NOW()-($1::text||' days')::interval
    ),
    email AS (
      SELECT e.id::text message_id,'email'::text channel,e.direction,e.subject,e.body,e.status,COALESCE(e.received_at,e.created_at) occurred_at,e.submission_id
      FROM crm_email_messages e
      WHERE COALESCE(e.received_at,e.created_at) >= NOW()-($1::text||' days')::interval
    ),
    messages AS (SELECT * FROM sms UNION ALL SELECT * FROM email)
    SELECT m.*,l.first_name,l.last_name,l.phone,l.email,l.assigned_to,l.showroom,l.pipeline_stage,l.product_interest,l.brand_interest,l.model_interest
    FROM messages m
    LEFT JOIN crm_website_leads l ON l.submission_id=m.submission_id AND l.deleted_at IS NULL
    WHERE ($4='all' OR m.channel=$4)
      AND ($5='all' OR CASE WHEN $5='inbound' THEN lower(coalesce(m.direction,'')) LIKE 'inbound%' ELSE lower(coalesce(m.direction,'')) NOT LIKE 'inbound%' END)
      AND ($3::text IS NULL OR concat_ws(' ',l.first_name,l.last_name,l.phone,l.email,l.assigned_to,m.subject,m.body) ILIKE $3)
    ORDER BY m.occurred_at DESC
    LIMIT $2::int
  `,params)).rows;
  const stats=rows.reduce((a,r)=>{a.total++;a[r.channel]=(a[r.channel]||0)+1;if(String(r.direction||'').toLowerCase().startsWith('inbound'))a.inbound++;else a.outbound++;return a},{total:0,sms:0,email:0,inbound:0,outbound:0});
  res.json({days,stats,conversations:rows});
}catch(e){res.status(500).json({error:e.message})}});

router.get('/crm/v1/leads/:id',...guard,async(req,res)=>{try{
  await ensure();const lead=(await q(`SELECT submission_id,first_name,last_name,email,phone,source,tags,note,payload,product_interest,brand_interest,model_interest,assigned_to,showroom,next_follow_up_at,last_contacted_at,last_activity_at,has_opportunity,ghl_opportunity_status,ghl_opportunity_id,ghl_pipeline_id,ghl_pipeline_stage_id,ghl_assigned_user_id,ghl_assigned_user_name,ghl_opportunity_value,ghl_stage_probability,ghl_last_stage_change_at,ghl_last_status_change_at,lifecycle_stage,pipeline_stage,ghl_contact_id,received_at,updated_at FROM crm_website_leads WHERE submission_id=$1 AND deleted_at IS NULL`,[req.params.id])).rows[0];if(!lead)return res.status(404).json({error:'Lead not found'});
  const [notes,smsRows,emails,tasks]=await Promise.all([q('SELECT id,note_type,body,quoted_price,financing_interest,created_by,created_at FROM crm_lead_notes WHERE submission_id=$1 ORDER BY created_at DESC',[req.params.id]),q(`SELECT id,direction,from_number,to_number,body,status,created_at FROM crm_sms_messages WHERE lead_submission_id=$2 OR (nullif(${threadPhoneSql('$1::text')},'') IS NOT NULL AND ${threadPhoneSql("CASE WHEN lower(coalesce(direction,'')) LIKE 'inbound%' THEN from_number ELSE to_number END")}=${threadPhoneSql('$1::text')}) ORDER BY created_at DESC LIMIT 500`,[lead.phone||'',req.params.id]),q('SELECT * FROM crm_email_messages WHERE submission_id=$1 ORDER BY created_at DESC LIMIT 250',[req.params.id]),q('SELECT * FROM crm_tasks WHERE submission_id=$1 ORDER BY due_at DESC',[req.params.id])]);
  res.json({lead,notes:notes.rows,sms:smsRows.rows,emails:emails.rows,tasks:tasks.rows});
}catch(e){res.status(500).json({error:e.message})}});

router.patch('/crm/v1/leads/:id/profile',...guard,async(req,res)=>{try{await ensure();const b=req.body||{};const r=await q(`UPDATE crm_website_leads SET assigned_to=$2,showroom=$3,next_follow_up_at=$4,last_contacted_at=CASE WHEN $5::boolean THEN NOW() ELSE last_contacted_at END,updated_at=NOW() WHERE submission_id=$1 RETURNING submission_id,assigned_to,showroom,next_follow_up_at,last_contacted_at`,[req.params.id,clean(b.assigned_to),clean(b.showroom),b.next_follow_up_at||null,Boolean(b.mark_contacted)]);if(!r.rowCount)return res.status(404).json({error:'Lead not found'});res.json(r.rows[0])}catch(e){res.status(500).json({error:e.message})}});

router.get('/crm/v1/today',...guard,async(req,res)=>{try{
  await ensure();const who=clean(req.query.assigned_to)||clean(req.user?.name)||clean(req.user?.username),mine=String(req.query.mine||'false')==='true',p=mine&&who?[who]:[],owner=mine&&who?' AND lower(coalesce(assigned_to,\'\'))=lower($1)':'';
  const [n,u,f,t]=await Promise.all([q(`SELECT submission_id,first_name,last_name,phone,email,source,assigned_to,pipeline_stage,received_at FROM crm_website_leads WHERE deleted_at IS NULL AND received_at>=CURRENT_DATE ${owner} ORDER BY received_at DESC LIMIT 100`,p),q(`SELECT submission_id,first_name,last_name,phone,email,source,assigned_to,pipeline_stage,received_at FROM crm_website_leads WHERE deleted_at IS NULL AND pipeline_stage='New Lead' AND last_contacted_at IS NULL ${owner} ORDER BY received_at ASC LIMIT 100`,p),q(`SELECT submission_id,first_name,last_name,phone,email,assigned_to,next_follow_up_at,pipeline_stage FROM crm_website_leads WHERE deleted_at IS NULL AND next_follow_up_at IS NOT NULL AND next_follow_up_at<CURRENT_DATE+INTERVAL '1 day' AND pipeline_stage NOT IN ('Won','Lost') ${owner} ORDER BY next_follow_up_at ASC LIMIT 100`,p),q(`SELECT t.*,concat_ws(' ',l.first_name,l.last_name) lead_name,l.phone,l.email FROM crm_tasks t LEFT JOIN crm_website_leads l ON l.submission_id=t.submission_id WHERE t.status='open' AND t.due_at<CURRENT_DATE+INTERVAL '1 day' ${mine&&who?'AND lower(coalesce(t.assigned_to,\'\'))=lower($1)':''} ORDER BY t.due_at ASC LIMIT 100`,p)]);
  res.json({new_leads:n.rows,uncontacted:u.rows,followups:f.rows,tasks:t.rows});
}catch(e){res.status(500).json({error:e.message})}});

router.post('/crm/v1/tasks',...guard,async(req,res)=>{try{await ensure();const title=clean(req.body?.title),due=req.body?.due_at;if(!title||!due)return res.status(400).json({error:'Task title and due date are required'});const r=await q(`INSERT INTO crm_tasks(submission_id,title,due_at,assigned_to,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *`,[clean(req.body?.submission_id),title,due,clean(req.body?.assigned_to)||clean(req.user?.name),clean(req.user?.name)||clean(req.user?.username)]);if(r.rows[0].submission_id)await q('UPDATE crm_website_leads SET next_follow_up_at=$2,updated_at=NOW() WHERE submission_id=$1',[r.rows[0].submission_id,due]);res.status(201).json(r.rows[0])}catch(e){res.status(500).json({error:e.message})}});
router.patch('/crm/v1/tasks/:id',...guard,async(req,res)=>{try{await ensure();const s=clean(req.body?.status)||'completed',r=await q(`UPDATE crm_tasks SET status=$2,completed_at=CASE WHEN $2='completed' THEN NOW() ELSE NULL END WHERE id=$1 RETURNING *`,[req.params.id,s]);if(!r.rowCount)return res.status(404).json({error:'Task not found'});res.json(r.rows[0])}catch(e){res.status(500).json({error:e.message})}});

router.post('/crm/v1/leads/:id/email',...guard,async(req,res)=>{try{await ensure();const l=(await q('SELECT first_name,last_name,email FROM crm_website_leads WHERE submission_id=$1',[req.params.id])).rows[0];if(!l?.email)return res.status(400).json({error:'Lead has no email address'});const subject=clean(req.body?.subject),body=clean(req.body?.body);if(!subject||!body)return res.status(400).json({error:'Subject and message are required'});const sent=await email(l.email,subject,body,[l.first_name,l.last_name].filter(Boolean).join(' '),req.user,req.params.id);const r=await q(`INSERT INTO crm_email_messages(submission_id,to_email,subject,body,provider_id,status,created_by,direction,from_email) VALUES($1,$2,$3,$4,$5,'sent',$6,'outbound',$7) RETURNING *`,[req.params.id,l.email,subject,body,clean(sent.messageId),clean(req.user?.name)||clean(req.user?.username),clean(sent.from)]);await q('UPDATE crm_website_leads SET last_contacted_at=NOW(),updated_at=NOW() WHERE submission_id=$1',[req.params.id]);res.status(201).json(r.rows[0])}catch(e){res.status(502).json({error:e.message})}});

router.post('/crm/v1/campaigns/email/preview',...guard,async(req,res)=>{try{
  await ensure();
  const ids=Array.isArray(req.body?.submission_ids)?req.body.submission_ids.map(clean).filter(Boolean).slice(0,250):[];
  const subjectTpl=String(req.body?.subject||'').trim(),bodyTpl=String(req.body?.template||'').trim();
  if(!ids.length||!subjectTpl||!bodyTpl)return res.status(400).json({error:'Recipients, subject and template are required'});
  const rows=(await q(`SELECT submission_id,first_name,last_name,email,product_interest,brand_interest,model_interest FROM crm_website_leads WHERE deleted_at IS NULL AND submission_id=ANY($1::text[])`,[ids])).rows;
  const recipients=rows.map(l=>({submission_id:l.submission_id,email:l.email,name:[l.first_name,l.last_name].filter(Boolean).join(' '),subject:merge(subjectTpl,l),body:merge(bodyTpl,l),sendable:Boolean(l.email)}));
  res.json({total:recipients.length,sendable:recipients.filter(x=>x.sendable).length,recipients});
}catch(e){res.status(500).json({error:e.message})}});

router.post('/crm/v1/campaigns/email/send',...guard,async(req,res)=>{try{
  await ensure();
  const ids=Array.isArray(req.body?.submission_ids)?req.body.submission_ids.map(clean).filter(Boolean).slice(0,250):[];
  const subjectTpl=String(req.body?.subject||'').trim(),bodyTpl=String(req.body?.template||'').trim();
  if(String(req.body?.confirm||'')!=='SEND')return res.status(400).json({error:'Campaign send requires confirmation'});
  if(!ids.length||!subjectTpl||!bodyTpl)return res.status(400).json({error:'Recipients, subject and template are required'});
  const rows=(await q(`SELECT submission_id,first_name,last_name,email,product_interest,brand_interest,model_interest FROM crm_website_leads WHERE deleted_at IS NULL AND submission_id=ANY($1::text[])`,[ids])).rows;
  let sent=0,skipped=0,failed=0;
  for(const l of rows){
    if(!l.email){skipped++;continue}
    try{
      const subject=merge(subjectTpl,l),body=merge(bodyTpl,l);
      const m=await email(l.email,subject,body,[l.first_name,l.last_name].filter(Boolean).join(' '),req.user,l.submission_id);
      await q(`INSERT INTO crm_email_messages(submission_id,to_email,subject,body,provider_id,status,created_by,direction,from_email) VALUES($1,$2,$3,$4,$5,'sent',$6,'outbound',$7)`,[l.submission_id,l.email,subject,body,clean(m.messageId),clean(req.user?.name)||clean(req.user?.username),clean(m.from)]);
      await q("UPDATE crm_website_leads SET last_contacted_at=NOW(),last_activity_at=NOW(),pipeline_stage=CASE WHEN pipeline_stage='New Lead' THEN 'Attempted Contact' ELSE pipeline_stage END,updated_at=NOW() WHERE submission_id=$1",[l.submission_id]);
      sent++;
    }catch(e){failed++}
  }
  res.json({ok:true,total:rows.length,sent,skipped,failed});
}catch(e){res.status(500).json({error:e.message})}});

router.post('/crm/v1/campaigns/sms/send',...guard,async(req,res)=>{try{await ensure();const ids=Array.isArray(req.body?.submission_ids)?req.body.submission_ids.map(clean).filter(Boolean).slice(0,250):[],tpl=String(req.body?.template||'').trim();if(String(req.body?.confirm||'')!=='SEND')return res.status(400).json({error:'Campaign send requires confirmation'});if(!ids.length||!tpl)return res.status(400).json({error:'Recipients and template are required'});const rows=(await q(`SELECT submission_id,first_name,last_name,phone,product_interest,brand_interest,model_interest FROM crm_website_leads WHERE submission_id=ANY($1::text[])`,[ids])).rows;let sent=0,suppressed=0,failed=0;for(const l of rows){if(!l.phone||await opted(l.phone)){suppressed++;continue}try{const body=merge(tpl,l),m=await sms(l.phone,body);await q(`INSERT INTO crm_sms_messages(twilio_sid,direction,from_number,to_number,body,status,lead_submission_id) VALUES($1,'outbound',$2,$3,$4,$5,$6) ON CONFLICT(twilio_sid) DO NOTHING`,[m.sid,salesNumber(),l.phone,body,m.status||'queued',l.submission_id]);await q("UPDATE crm_website_leads SET last_contacted_at=NOW(),pipeline_stage=CASE WHEN pipeline_stage='New Lead' THEN 'Attempted Contact' ELSE pipeline_stage END,updated_at=NOW() WHERE submission_id=$1",[l.submission_id]);sent++}catch{failed++}}res.json({ok:true,total:rows.length,sent,suppressed,failed})}catch(e){res.status(500).json({error:e.message})}});

router.delete('/crm/v1/leads/:id',...guard,async(req,res)=>{try{
  if(!isManager(req))return res.status(403).json({error:'Manager access required'});
  await ensure();
  const who=clean(req.user?.name)||clean(req.user?.username)||'Manager';
  const r=await q(`UPDATE crm_website_leads SET deleted_at=NOW(),deleted_by=$2,updated_at=NOW() WHERE submission_id=$1 AND deleted_at IS NULL RETURNING submission_id,first_name,last_name`,[req.params.id,who]);
  if(!r.rowCount)return res.status(404).json({error:'Lead not found'});
  await q("UPDATE crm_tasks SET status='cancelled',completed_at=NOW() WHERE submission_id=$1 AND status='open'",[req.params.id]).catch(()=>{});
  res.json({ok:true,lead:r.rows[0]});
}catch(e){res.status(500).json({error:e.message})}});

router.get('/crm/v1/reports/summary',...guard,async(req,res)=>{try{await ensure();const days=Math.min(365,Math.max(1,Number(req.query.days)||30)),overall=(await q(`SELECT count(*)::int leads,count(*) FILTER(WHERE pipeline_stage='Appointment Set')::int appointments,count(*) FILTER(WHERE pipeline_stage='Showroom Visit')::int showroom_visits,count(*) FILTER(WHERE pipeline_stage='Quoted')::int quoted,count(*) FILTER(WHERE pipeline_stage='Won')::int sold,count(*) FILTER(WHERE pipeline_stage='Lost')::int lost FROM crm_website_leads WHERE received_at>=NOW()-($1::text||' days')::interval`,[String(days)])).rows[0];const grp=async col=>(await q('SELECT '+col+' label,count(*)::int leads,count(*) FILTER(WHERE pipeline_stage=\'Won\')::int sold FROM crm_website_leads WHERE received_at>=NOW()-($1::text||\' days\')::interval GROUP BY '+col+' ORDER BY leads DESC NULLS LAST LIMIT 50',[String(days)])).rows;const [sources,salespeople,products,brands,models]=await Promise.all([grp('source'),grp('assigned_to'),grp('product_interest'),grp('brand_interest'),grp('model_interest')]);res.json({days,overall,sources,salespeople,products,brands,models})}catch(e){res.status(500).json({error:e.message})}});

router.post('/crm/v1/reconcile/highlevel',...guard,async(req,res)=>{try{
  if(!isManager(req))return res.status(403).json({error:'Manager access required'});
  await ensure();
  let users={},stageNames={};
  try{
    const uj=await importSource('/internal/crm/highlevel-users');
    for(const u of (uj.users||[]))if(u?.id)users[String(u.id)]=clean(u.name)||clean(u.email)||String(u.id);
  }catch(e){console.warn('HighLevel user mapping unavailable:',e.message)}
  try{
    const pj=await importSource('/internal/crm/highlevel-pipelines');
    for(const p of (pj.pipelines||[]))for(const s of (p.stages||[]))if(s?.id)stageNames[String(s.id)]=clean(s.name);
  }catch(e){console.warn('HighLevel pipeline mapping unavailable:',e.message)}
  await q("UPDATE crm_website_leads SET has_opportunity=false WHERE note='Imported from HighLevel'");
  let afterId='',after='',pages=0,matched=0,unmatched=0,open=0,won=0,lost=0;
  do{
    const j=await importSource('/internal/crm/highlevel-opportunities',{startAfterId:afterId,startAfter:after});
    const opportunities=j.opportunities||[];
    for(const x of opportunities){
      const contactId=contactIdFromOpportunity(x);
      if(!contactId){unmatched++;continue}
      const exactStageName=stageNames[String(x.pipelineStageId||'')]||null;
      const stage=normalizePipelineStage(exactStageName,x.status)||stageFromHighLevel(x.status,x.effectiveProbability),assignedId=clean(x.assignedTo),assignedName=users[assignedId]||null;
      const r=await q(`UPDATE crm_website_leads SET
        has_opportunity=true,
        ghl_opportunity_id=$2,
        ghl_opportunity_status=$3,
        ghl_pipeline_id=$4,
        ghl_pipeline_stage_id=$5,
        ghl_assigned_user_id=$6,
        ghl_assigned_user_name=$7,
        assigned_to=COALESCE($7,assigned_to),
        ghl_opportunity_value=$8,
        ghl_stage_probability=$9,
        ghl_last_stage_change_at=$10,
        ghl_last_status_change_at=$11,
        pipeline_stage=$12,
        updated_at=NOW()
        WHERE ghl_contact_id=$1
        RETURNING submission_id`,[
          contactId,String(x.id||'').replace(/^opportunities_/,'')||null,clean(x.status),clean(x.pipelineId),clean(x.pipelineStageId),
          assignedId,assignedName,Number(x.monetaryValue)||0,Number(x.effectiveProbability)||0,
          x.lastStageChangeAt||null,x.lastStatusChangeAt||null,stage
        ]);
      if(r.rowCount)matched++;else unmatched++;
      if(String(x.status).toLowerCase()==='won')won++;else if(String(x.status).toLowerCase()==='lost')lost++;else open++;
    }
    pages++;
    afterId=clean(j.meta?.startAfterId)||'';
    after=clean(j.meta?.startAfter)||'';
    if(!opportunities.length||pages>=100)break;
  }while(afterId||after);
  const summary=(await q(`SELECT count(*)::int contacts,count(*) FILTER(WHERE has_opportunity=true)::int opportunities,count(*) FILTER(WHERE has_opportunity=false)::int contacts_without_opportunity FROM crm_website_leads`)).rows[0];
  res.json({ok:true,pages,matched,unmatched,open,won,lost,...summary});
}catch(e){res.status(502).json({error:e.message})}});

router.post('/crm/v1/import/highlevel',...guard,async(req,res)=>{try{
  if(!isManager(req))return res.status(403).json({error:'Manager access required'});await ensure();
  const key=String(process.env.GHL_API_TOKEN||'').trim(),loc=String(process.env.GHL_LOCATION_ID||'').trim(),source=String(process.env.CRM_IMPORT_SOURCE_URL||'').trim(),importSecret=String(process.env.CRM_IMPORT_SECRET||'').trim();
  if((!key||!loc)&&(!source||!importSecret))return res.status(503).json({error:'HighLevel import source is not configured'});
  let afterId='',after='',imported=0,updated=0,pages=0;do{
    let u,headers;
    if(key&&loc){u=new URL('https://services.leadconnectorhq.com/contacts/');u.searchParams.set('locationId',loc);u.searchParams.set('limit','100');headers={Authorization:'Bearer '+key,Version:'2021-07-28',Accept:'application/json'}}
    else{u=new URL(source);headers={'x-htfo-import-secret':importSecret,Accept:'application/json'}}
    if(afterId)u.searchParams.set('startAfterId',afterId);if(after)u.searchParams.set('startAfter',after);
    const r=await fetch(u,{headers}),j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.message||j.error||('HighLevel import returned '+r.status));const contacts=j.contacts||[];for(const x of contacts){const id=String(x.id||'').replace(/^contacts_/,'');if(!id)continue;const nm=splitName(x.name||[x.firstName,x.lastName].filter(Boolean).join(' '));if(!nm.first)nm.first=clean(x.phone)||clean(x.email)||'HighLevel Contact';const tags=Array.isArray(x.tags)?x.tags:[],showroom=showroomFrom(tags),hit=(await q('SELECT submission_id FROM crm_website_leads WHERE ghl_contact_id=$1 LIMIT 1',[id])).rows[0];if(hit){await q(`UPDATE crm_website_leads SET first_name=COALESCE($2,first_name),last_name=COALESCE($3,last_name),email=COALESCE($4,email),phone=COALESCE($5,phone),source=COALESCE($6,source),tags=CASE WHEN $7::jsonb='[]'::jsonb THEN tags ELSE $7::jsonb END,showroom=COALESCE($8,showroom),updated_at=NOW() WHERE submission_id=$1`,[hit.submission_id,nm.first,nm.last,clean(x.email),clean(x.phone),clean(x.source),JSON.stringify(tags),showroom]);updated++}else{await q(`INSERT INTO crm_website_leads(submission_id,first_name,last_name,email,phone,source,tags,note,payload,lifecycle_stage,pipeline_stage,ghl_contact_status,ghl_contact_id,received_at,updated_at,showroom) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,'Imported from HighLevel',$8::jsonb,'Prospect','New Lead','sent',$9,COALESCE($10::timestamptz,NOW()),NOW(),$11) ON CONFLICT(submission_id) DO NOTHING`,['ghl-'+id,nm.first,nm.last,clean(x.email),clean(x.phone),clean(x.source)||'HighLevel Import',JSON.stringify(tags),JSON.stringify({highlevel_import:true}),id,x.dateAdded||x.createdAt||null,showroom]);imported++}}pages++;afterId=clean(j.meta?.startAfterId)||'';after=clean(j.meta?.startAfter)||'';if(!contacts.length||pages>=50)break}while(afterId||after);res.json({ok:true,imported,updated,pages})
}catch(e){res.status(502).json({error:e.message})}});

// Stage one: persisted drafts only. Signing, charging and Operations handoff are not enabled.
async function ensureSalesDrafts(){await q(`CREATE TABLE IF NOT EXISTS crm_sales_drafts(
 id BIGSERIAL PRIMARY KEY, document JSONB NOT NULL, version INTEGER NOT NULL DEFAULT 1,
 created_by TEXT, updated_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
 await q(`ALTER TABLE crm_sales_drafts ADD COLUMN IF NOT EXISTS owner_user_id BIGINT REFERENCES service_users(id);
 UPDATE crm_sales_drafts d SET owner_user_id=u.id FROM (SELECT d2.id draft_id,MIN(u2.id) id FROM crm_sales_drafts d2 JOIN service_users u2 ON lower(d2.created_by)=lower(u2.display_name) OR lower(d2.created_by)=lower(u2.username) WHERE d2.owner_user_id IS NULL GROUP BY d2.id HAVING COUNT(*)=1) u WHERE d.id=u.draft_id AND d.owner_user_id IS NULL`)}
function validateSalesDraft(input){
 const text=(v,max=500)=>String(v??'').trim().slice(0,max);
 const cents=(v,label)=>{if(!Number.isSafeInteger(v)||v<0||v>100000000)throw new Error('Invalid '+label);return v};
 const customer={};for(const k of ['first_name','last_name','email','phone','secondary_phone','street','city','state','zip'])customer[k]=text(input.customer?.[k]);
 const spa={};for(const k of ['brand','model','year','shell','cabinet','serial','manufacturer_add_ons'])spa[k]=text(input.spa?.[k]);
 const msrp=cents(input.msrp,'MSRP'),discount=cents(input.discount,'discount');
 if(discount>msrp)throw new Error('Spa discount cannot exceed MSRP');
 if(!Array.isArray(input.items)||input.items.length>40)throw new Error('Use no more than 40 accessory lines');
 const items=input.items.map(x=>{const quantity=Number(x.quantity);if(!Number.isInteger(quantity)||quantity<1||quantity>100)throw new Error('Accessory quantity must be 1–100');return {description:text(x.description),quantity,unit_price:cents(x.unit_price,'accessory price'),taxable:x.taxable!==false}});
 const rate=Number(input.tax_rate);if(!Number.isInteger(rate)||rate<0||rate>1500)throw new Error('Tax rate must be between 0% and 15%');
 if(!Array.isArray(input.payments)||input.payments.length>40)throw new Error('Use no more than 40 payment records');
 const payments=input.payments.map(x=>{if(!['Cash','Check','Card — paid externally','Bank funding received','Other'].includes(x.method))throw new Error('Invalid payment method');if(!/^\d{4}-\d{2}-\d{2}$/.test(x.date)||!Number.isFinite(Date.parse(x.date)))throw new Error('Invalid payment date');const reference=text(x.reference,120);if(x.method==='Card — paid externally'&&!reference)throw new Error('Terminal authorization code required for card payment');if(/(?:\d[ -]?){13,19}/.test(reference))throw new Error('Never enter credit card numbers in payment references');return{date:x.date,method:x.method,amount:cents(x.amount,'payment'),reference}});
 const finance={bank:text(input.finance?.bank),amount:cents(input.finance?.amount??0,'financed amount'),complete:input.finance?.complete===true};
 const spaNet=msrp-discount,accessories=items.reduce((n,x)=>n+x.unit_price*x.quantity,0),subtotal=spaNet+accessories;
 const taxable=spaNet+items.filter(x=>x.taxable).reduce((n,x)=>n+x.unit_price*x.quantity,0),tax=Math.round(taxable*rate/10000),total=subtotal+tax,paid=payments.reduce((n,x)=>n+x.amount,0),balance=Math.max(0,total-paid);
 // Received bank funds count as payments; only unfunded financing can cover the remaining balance.
 const funded=payments.filter(x=>x.method==='Bank funding received').reduce((n,x)=>n+x.amount,0),financeOutstanding=Math.max(0,finance.amount-funded);
 const paymentRequirementMet=total>0&&(paid>=total||(finance.complete&&finance.bank&&financeOutstanding>=balance));
 return {customer,spa,msrp,discount,items,tax_rate:rate,payments,finance,submission_id:text(input.submission_id,150),salesperson:text(input.salesperson),location:text(input.location),contract_date:text(input.contract_date,10),notes:text(input.notes,4000),totals:{subtotal,tax,total,paid,balance,overpayment:Math.max(0,paid-total),finance_outstanding:financeOutstanding,payment_requirement_met:Boolean(paymentRequirementMet)},status:'draft',terms_version:null};
}
const salesAdmin=req=>['admin','owner'].includes(String(req.user?.role||'').toLowerCase());
async function salesIdentity(req,res,next){try{const row=(await q('SELECT id,username,display_name,role FROM service_users WHERE id=$1 AND active=true',[req.user.sub])).rows[0];if(!row)return res.status(401).json({error:'Active staff login required'});if(!['admin','owner','manager','service_manager','sales'].includes(row.role))return res.status(403).json({error:'Sales access required'});req.user={...req.user,sub:row.id,username:row.username,name:row.display_name,role:row.role};next()}catch(e){res.status(500).json({error:'Unable to verify staff access'})}}
// Sensitive check images are stored separately from customer-facing agreement JSON.
// Only the original salesperson/owner or admins can read or upload them.
let checkImageSchemaPromise;
async function ensureCheckImages(){
 if(!checkImageSchemaPromise)checkImageSchemaPromise=q(`CREATE TABLE IF NOT EXISTS crm_sales_check_images(
   draft_id BIGINT NOT NULL REFERENCES crm_sales_drafts(id) ON DELETE CASCADE,
   payment_index INTEGER NOT NULL,
   payment_fingerprint TEXT NOT NULL,
   content BYTEA NOT NULL,
   mime_type TEXT NOT NULL DEFAULT 'image/jpeg',
   created_by TEXT NOT NULL,
   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
   PRIMARY KEY(draft_id,payment_index)
 )`).catch(e=>{checkImageSchemaPromise=null;throw e});
 return checkImageSchemaPromise;
}
const paymentFingerprint=p=>createHash('sha256').update(JSON.stringify([p.date,p.method,p.amount,p.reference])).digest('hex');
async function checkImageContext(req){
 await ensureSalesDrafts();await ensureCheckImages();
 const row=(await q('SELECT id,owner_user_id,document FROM crm_sales_drafts WHERE id=$1',[req.params.id])).rows[0];
 if(!row)return {error:404,message:'Agreement not found'};
 if(!salesAdmin(req)&&String(row.owner_user_id)!==String(req.user.sub))return {error:403,message:'Only the original salesperson or an administrator may access check images'};
 const index=Number(req.params.paymentIndex),p=row.document.payments?.[index];
 if(!Number.isInteger(index)||index<0||index>=40||!p||p.method!=='Check')return {error:400,message:'Choose a check payment saved on this agreement'};
 return {row,index,p,fingerprint:paymentFingerprint(p)};
}
router.get('/crm/v1/sales-drafts/:id/check-images/:paymentIndex',...guard,salesIdentity,async(req,res)=>{
 try{const c=await checkImageContext(req);if(c.error)return res.status(c.error).json({error:c.message});
 const image=(await q('SELECT content,mime_type FROM crm_sales_check_images WHERE draft_id=$1 AND payment_index=$2 AND payment_fingerprint=$3',[c.row.id,c.index,c.fingerprint])).rows[0];
 if(!image)return res.status(404).json({error:'No check image attached'});
 res.setHeader('Cache-Control','no-store, private');res.setHeader('Content-Disposition','inline; filename="check-record.jpg"');
 res.type('image/jpeg').send(image.content);
 }catch(e){res.status(500).json({error:'Unable to load check image'})}
});
router.post('/crm/v1/sales-drafts/:id/check-images/:paymentIndex',...guard,salesIdentity,async(req,res)=>{
 try{const c=await checkImageContext(req);if(c.error)return res.status(c.error).json({error:c.message});
 const encoded=String(req.body?.image||'');
 if(!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(encoded))return res.status(400).json({error:'Upload a JPEG image'});
 const b=Buffer.from(encoded.slice('data:image/jpeg;base64,'.length),'base64');
 if(b.length<100||b.length>850000||b[0]!==0xff||b[1]!==0xd8||b[b.length-2]!==0xff||b[b.length-1]!==0xd9)return res.status(400).json({error:'Invalid JPEG or image exceeds 850 KB'});
 await q(`INSERT INTO crm_sales_check_images(draft_id,payment_index,payment_fingerprint,content,created_by)
 VALUES($1,$2,$3,$4,$5) ON CONFLICT(draft_id,payment_index) DO UPDATE SET payment_fingerprint=EXCLUDED.payment_fingerprint,content=EXCLUDED.content,created_by=EXCLUDED.created_by,created_at=NOW()`,[c.row.id,c.index,c.fingerprint,b,req.user.name||req.user.username]);
 res.json({ok:true,payment_index:c.index});
 }catch(e){res.status(500).json({error:'Unable to save check image'})}
});
router.delete('/crm/v1/sales-drafts/:id/check-images/:paymentIndex',...guard,salesIdentity,async(req,res)=>{
 try{const c=await checkImageContext(req);if(c.error)return res.status(c.error).json({error:c.message});
 await q('DELETE FROM crm_sales_check_images WHERE draft_id=$1 AND payment_index=$2',[c.row.id,c.index]);res.json({ok:true})
 }catch(e){res.status(500).json({error:'Unable to remove check image'})}
});

// Confidential MSRP pricebook. Dealer cost never returned to sales users.
let salesPricebookSchema;
function ensureSalesPricebook(){
 if(!salesPricebookSchema)salesPricebookSchema=q(`CREATE TABLE IF NOT EXISTS crm_sales_pricebook (
 brand TEXT NOT NULL, model TEXT NOT NULL, wholesale_cents BIGINT NOT NULL CHECK (wholesale_cents>0),
 source TEXT NOT NULL DEFAULT '', updated_by TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(brand,model)
 )`).catch(e=>{salesPricebookSchema=null;throw e});
 return salesPricebookSchema;
}
// Factory-installed options use a separate retail rule: twice dealer cost, with no freight or financing adjustment.
const optionRetailFromWholesale=cents=>{if(!Number.isSafeInteger(cents)||cents<0)throw new Error('Invalid option cost');return cents*2};
router.post('/crm/v1/admin/sales-pricebook/option-preview',...guard,salesIdentity,(req,res)=>{
 if(!salesAdmin(req))return res.status(403).json({error:'Administrator access required'});
 const cost=Number(req.body?.wholesale_cents);
 if(!Number.isSafeInteger(cost)||cost<0||cost>100000000)return res.status(400).json({error:'Invalid factory-option wholesale cost'});
 res.json({retail_price_cents:optionRetailFromWholesale(cost),rule:'2x factory-option cost; no added fees or freight'});
});
const listFromWholesale=cents=>{
 const par=((cents/100+750)/0.6)+600;
 return Math.ceil((par/0.76)*1.33);
};
router.get('/crm/v1/sales-pricebook/quote',...guard,salesIdentity,async(req,res)=>{
 try{
  const brand=String(req.query.brand||'').trim(),model=String(req.query.model||'').trim();
  if(!brand||!model)return res.status(400).json({error:'Brand and model required'});
  await ensureSalesPricebook();
  const p=(await q('SELECT wholesale_cents FROM crm_sales_pricebook WHERE lower(brand)=lower($1) AND lower(model)=lower($2)',[brand,model])).rows[0];
  if(!p)return res.status(404).json({error:'No approved model price available'});
  res.json({brand,model,list_price_cents:listFromWholesale(Number(p.wholesale_cents))*100});
 }catch(e){res.status(500).json({error:'Unable to retrieve model price'})}
});
router.post('/crm/v1/admin/sales-pricebook/import',...guard,salesIdentity,async(req,res)=>{
 if(!salesAdmin(req))return res.status(403).json({error:'Administrator access required'});
 try{
  const rows=req.body?.prices;
  if(!Array.isArray(rows)||rows.length<1||rows.length>250)return res.status(400).json({error:'Provide 1–250 model prices'});
  const cleanRows=rows.map(x=>{
   const brand=String(x.brand||'').trim(),model=String(x.model||'').trim(),cost=Number(x.wholesale_cents),source=String(x.source||'').slice(0,160);
   if(!['American Whirlpool','Vita Spa','Cal Spas','AquaSolus','Eco Spas','Innova Spas'].includes(brand)||!model||model.length>80||!Number.isSafeInteger(cost)||cost<=0||cost>100000000)return null;
   return {brand,model,cost,source};
  });
  if(cleanRows.some(x=>!x))return res.status(400).json({error:'Invalid model or wholesale amount'});
  if(new Set(cleanRows.map(x=>x.brand.toLowerCase()+'|'+x.model.toLowerCase())).size!==cleanRows.length)return res.status(400).json({error:'Duplicate brand and model in import'});
  await ensureSalesPricebook();
  for(const x of cleanRows)await q(`INSERT INTO crm_sales_pricebook(brand,model,wholesale_cents,source,updated_by)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT(brand,model) DO UPDATE SET wholesale_cents=excluded.wholesale_cents,
    source=excluded.source,updated_by=excluded.updated_by,updated_at=NOW()`,[x.brand,x.model,x.cost,x.source,req.user.name||req.user.username]);
  res.json({ok:true,imported:cleanRows.length});
 }catch(e){res.status(500).json({error:'Unable to import prices'})}
});
// Immutable signed agreements. Signed copies are stored separately from editable drafts.
async function ensureExecutedContracts(){
 await q(`CREATE TABLE IF NOT EXISTS crm_sales_executed_contracts (
 id BIGSERIAL PRIMARY KEY, draft_id BIGINT NOT NULL UNIQUE REFERENCES crm_sales_drafts(id),
 submission_id TEXT, customer_email TEXT NOT NULL, salesperson_email TEXT NOT NULL,
 executed_document JSONB NOT NULL, customer_name TEXT NOT NULL, salesperson_name TEXT NOT NULL,
 customer_signature BYTEA NOT NULL, salesperson_signature BYTEA NOT NULL,
 terms_text TEXT NOT NULL, terms_version TEXT NOT NULL,
 pdf_data BYTEA NOT NULL, pdf_sha256 TEXT NOT NULL,
 executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 sent_customer_at TIMESTAMPTZ, sent_salesperson_at TIMESTAMPTZ, sent_owner_at TIMESTAMPTZ,
 last_error TEXT
 )`);
}
const signatureImage=(value,label)=>{
 const match=String(value||'').match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
 if(!match)throw new Error(label+' signature image must be PNG');
 const bytes=Buffer.from(match[1],'base64');
 if(bytes.length<120||bytes.length>350000||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw new Error('Invalid '+label+' signature');
 return bytes;
};
const currency=c=>'$'+(Number(c||0)/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
async function signedPdf(d,id,sign){
 return new Promise((resolve,reject)=>{
  const pdf=new PDFDocument({size:'LETTER',margin:44,autoFirstPage:true,info:{Title:'HTFO Executed Sales Agreement '+id,Author:'Hot Tub Factory Outlet'}});
  const chunks=[];pdf.on('data',chunk=>chunks.push(chunk));pdf.on('error',reject);pdf.on('end',()=>resolve(Buffer.concat(chunks)));
  const row=(title,value)=>{if(pdf.y>704)pdf.addPage();pdf.font('Helvetica-Bold').fontSize(9).text(title,{continued:true});pdf.font('Helvetica').text('  '+String(value||''));pdf.moveDown(.25)};
  pdf.font('Helvetica-Bold').fontSize(19).text('HOT TUB FACTORY OUTLET');
  pdf.font('Helvetica').fontSize(10).text('Monroeville & Wexford');
  pdf.font('Helvetica-Bold').fontSize(12).text('EXECUTED SALES AGREEMENT #'+id);pdf.moveDown(.6);
  row('Executed UTC:',new Date().toISOString());row('Customer:',sign.customer_name);row('Email:',d.customer.email);row('Phone:',d.customer.phone);row('Address:',[d.customer.street,d.customer.city,d.customer.state,d.customer.zip].filter(Boolean).join(', '));
  row('Salesperson:',sign.salesperson_name);row('Location:',d.location);
  row('Brand / Model:',[d.spa.brand,d.spa.model].join(' / '));row('Serial:',d.spa.serial);
  row('Shell / Cabinet:',[d.spa.shell,d.spa.cabinet].join(' / '));row('Factory add-ons:',d.spa.manufacturer_add_ons||'None');
  row('HTFO list price:',currency(d.msrp));if(d.discount)row('Negotiated discount:',currency(d.discount));
  row('Spa sale price:',currency(d.msrp-d.discount));
  for(const item of d.items||[])row('Item:',item.quantity+' x '+item.description+' — '+currency(item.unit_price*item.quantity));
  row('Subtotal:',currency(d.totals.subtotal));row('Tax:',currency(d.totals.tax));row('Total:',currency(d.totals.total));
  row('Payments recorded:',currency(d.totals.paid));row('Balance due:',currency(d.totals.balance));
  row('Financing:',[d.finance?.bank||'None',currency(d.finance?.amount)].join(' — '));
  if(d.notes)row('Special instructions:',d.notes);
  pdf.moveDown(1);pdf.font('Helvetica-Bold').fontSize(12).text('AGREED TERMS');
  pdf.font('Helvetica').fontSize(9).text(sign.terms_text,{width:520});pdf.moveDown(.6);
  if(pdf.y>610)pdf.addPage();
  pdf.font('Helvetica-Bold').fontSize(10).text('Customer signature: '+sign.customer_name);
  pdf.image(sign.customer_png,{fit:[225,85]});pdf.moveDown(.5);
  if(pdf.y>610)pdf.addPage();
  pdf.font('Helvetica-Bold').fontSize(10).text('Salesperson signature: '+sign.salesperson_name);
  pdf.image(sign.salesperson_png,{fit:[225,85]});
  pdf.font('Helvetica').fontSize(8).text('Electronic consent recorded; terms version '+sign.terms_version);
  pdf.end();
 });
}
async function sendContractPdf(to,name,subject,body,fileName,pdf,author){
 const key=String(process.env.BREVO_API_KEY||'').trim(),from=staffEmail(author);
 if(!key||!from)throw new Error('Email provider or sales sender not configured');
 const payload={sender:{email:from,name:'Hot Tub Factory Outlet'},to:[{email:to,name:name||to}],subject,textContent:body,attachment:[{name:fileName,content:pdf.toString('base64')}]};
 const r=await fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'api-key':key,'Content-Type':'application/json'},body:JSON.stringify(payload)});
 if(!r.ok){const msg=await r.text();throw new Error('Email delivery failed: '+r.status+' '+msg.slice(0,180))}
}
router.get('/crm/v1/sales-terms',...guard,salesIdentity,(req,res)=>{
 const text=String(process.env.HTFO_APPROVED_SALES_TERMS||'').trim(),version=String(process.env.HTFO_SALES_TERMS_VERSION||'').trim();
 if(!text||!version)return res.json({ready:false,version:'legacy-reference',text:proposedSalesTermsReference,review_required:true});
 res.json({ready:true,version,text});
});
router.post('/crm/v1/sales-drafts/:id/execute',...guard,salesIdentity,async(req,res)=>{
 try{
  const terms=String(process.env.HTFO_APPROVED_SALES_TERMS||'').trim(),termsVersion=String(process.env.HTFO_SALES_TERMS_VERSION||'').trim();
  if(!terms||!termsVersion)return res.status(409).json({error:'Owner-approved final sales terms are not configured; agreement cannot be executed'});
  if(req.body?.consent!==true)return res.status(400).json({error:'Both signers must affirm the final contract terms'});
  if(String(req.body?.terms_version||'')!==termsVersion)return res.status(409).json({error:'Contract terms changed; review the latest version before signing'});
  await ensureSalesDrafts();await ensureExecutedContracts();
  const draft=(await q('SELECT * FROM crm_sales_drafts WHERE id=$1',[req.params.id])).rows[0];
  if(!draft)return res.status(404).json({error:'Agreement not found'});
  if(!salesAdmin(req)&&String(draft.owner_user_id)!==String(req.user.sub))return res.status(403).json({error:'Salesperson must own this agreement'});
  if((await q('SELECT 1 FROM crm_sales_executed_contracts WHERE draft_id=$1',[draft.id])).rowCount)return res.status(409).json({error:'Agreement is already executed; retrieve the signed copy'});
  const d=validateSalesDraft(draft.document);
  if(d.msrp<=0||!d.customer.email||!d.customer.first_name||!d.customer.last_name||!d.spa.brand||!d.spa.model)return res.status(400).json({error:'Complete customer email, name, spa and MSRP before signing'});
  const customerName=String(req.body.customer_name||'').trim(),salesName=String(req.body.salesperson_name||'').trim();
  if(customerName.length<3||salesName.length<3)return res.status(400).json({error:'Both printed signer names required'});
  const customer_png=signatureImage(req.body.customer_signature,'Customer'),salesperson_png=signatureImage(req.body.salesperson_signature,'Salesperson');
  const ownerEmail='ray@hottubfactoryoutlet.com',salesEmail=staffEmail(req.user);
  if(!salesEmail||!salesEmail.includes('@'))return res.status(409).json({error:'Salesperson email is not configured'});
  const pdf=await signedPdf(d,draft.id,{customer_name:customerName,salesperson_name:salesName,customer_png,salesperson_png,terms_text:terms,terms_version:termsVersion});
  const hash=createHash('sha256').update(pdf).digest('hex');
  // Customer profile association: retain the CRM lead ID if known, otherwise resolve unambiguously by email.
  let submissionId=d.submission_id||null;
  if(!submissionId){
   const matches=(await q("SELECT submission_id FROM crm_website_leads WHERE deleted_at IS NULL AND lower(email)=lower($1) ORDER BY received_at DESC LIMIT 2",[d.customer.email])).rows;
   if(matches.length===1)submissionId=matches[0].submission_id;
   else if(matches.length>1)return res.status(409).json({error:'Multiple customer profiles have this email. Open the correct customer profile before executing'});
  }
  if(submissionId){
   const found=(await q('SELECT submission_id FROM crm_website_leads WHERE submission_id=$1 AND deleted_at IS NULL',[submissionId])).rows;
   if(!found.length)return res.status(409).json({error:'Linked customer profile was not found. Reopen the agreement from the customer profile'});
  }else{
   await ensure();
   submissionId='signed-'+randomBytes(10).toString('hex');
   await q(`INSERT INTO crm_website_leads(submission_id,first_name,last_name,email,phone,source,note,payload,product_interest,brand_interest,model_interest,assigned_to,showroom,lifecycle_stage,pipeline_stage,has_opportunity,received_at,updated_at)
     VALUES($1,$2,$3,$4,$5,'Walk-In','Sales agreement customer profile',$6::jsonb,$7,$8,$9,$10,$11,'Customer','Won',true,NOW(),NOW())`,
    [submissionId,d.customer.first_name,d.customer.last_name,d.customer.email,d.customer.phone,JSON.stringify({created_by_signed_agreement:draft.id}),'Hot Tub',d.spa.brand,d.spa.model,req.user.name||req.user.username,d.location]);
  }
  await q(`INSERT INTO crm_sales_executed_contracts
   (draft_id,submission_id,customer_email,salesperson_email,executed_document,customer_name,salesperson_name,customer_signature,salesperson_signature,terms_text,terms_version,pdf_data,pdf_sha256)
   VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13)`,
   [draft.id,submissionId,d.customer.email,salesEmail,JSON.stringify(d),customerName,salesName,customer_png,salesperson_png,terms,termsVersion,pdf,hash]);
  res.status(201).json({ok:true,draft_id:draft.id,sha256:hash,stored:true,delivery:'pending'});
 }catch(e){res.status(400).json({error:e.message||'Could not execute contract'})}
});
router.get('/crm/v1/leads/:submissionId/signed-contracts',...guard,salesIdentity,async(req,res)=>{
 try{await ensureExecutedContracts();const rows=(await q('SELECT draft_id,customer_name,executed_at,pdf_sha256,sent_customer_at,sent_salesperson_at,sent_owner_at FROM crm_sales_executed_contracts WHERE submission_id=$1 ORDER BY executed_at DESC',[req.params.submissionId])).rows;res.json(rows)}catch(e){res.status(500).json({error:'Could not load signed agreements'})}
});
router.get('/crm/v1/sales-drafts/:id/executed-pdf',...guard,salesIdentity,async(req,res)=>{
 try{
  await ensureExecutedContracts();
  const row=(await q('SELECT c.pdf_data,d.owner_user_id FROM crm_sales_executed_contracts c JOIN crm_sales_drafts d ON d.id=c.draft_id WHERE c.draft_id=$1',[req.params.id])).rows[0];
  if(!row)return res.status(404).json({error:'Executed contract not found'});
  if(!salesAdmin(req)&&String(row.owner_user_id)!==String(req.user.sub))return res.status(403).json({error:'Not authorized'});
  res.type('application/pdf').set('Content-Disposition','attachment; filename="HTFO-Signed-'+req.params.id+'.pdf"').send(row.pdf_data);
 }catch(e){res.status(500).json({error:'Unable to read signed contract'})}
});
router.post('/crm/v1/sales-drafts/:id/send-executed',...guard,salesIdentity,async(req,res)=>{
 try{
  await ensureExecutedContracts();
  const row=(await q('SELECT c.*,d.owner_user_id FROM crm_sales_executed_contracts c JOIN crm_sales_drafts d ON d.id=c.draft_id WHERE c.draft_id=$1',[req.params.id])).rows[0];
  if(!row)return res.status(404).json({error:'No executed contract to deliver'});
  if(!salesAdmin(req)&&String(row.owner_user_id)!==String(req.user.sub))return res.status(403).json({error:'Not authorized'});
  const list=[['customer',row.customer_email,row.customer_name,'sent_customer_at'],['salesperson',row.salesperson_email,row.salesperson_name,'sent_salesperson_at'],['owner','ray@hottubfactoryoutlet.com','HTFO Owner','sent_owner_at']];
  const sent=[];for(const [role,to,name,column] of list){
   if(row[column]){sent.push(role+': already sent');continue}
   const author={username:req.user.username,name:req.user.name};
   await sendContractPdf(to,name,'Signed HTFO Sales Agreement #'+row.draft_id,'Attached is the signed sales agreement for '+row.customer_name+'.', 'HTFO-Signed-'+row.draft_id+'.pdf',row.pdf_data,author);
   await q('UPDATE crm_sales_executed_contracts SET '+column+'=NOW(),last_error=NULL WHERE draft_id=$1',[row.draft_id]);sent.push(role+': delivered');
  }
  res.json({ok:true,deliveries:sent});
 }catch(e){res.status(502).json({error:e.message||'Email delivery incomplete; retry will skip completed recipients'})}
});
router.get('/crm/v1/admin/order-list',...guard,salesIdentity,async(req,res)=>{if(!salesAdmin(req))return res.status(403).json({error:'Order list is restricted to the administrator'});try{await ensureSalesDrafts();const rows=(await q('SELECT id,document,created_by,updated_at FROM crm_sales_drafts ORDER BY updated_at DESC LIMIT 1000')).rows;res.json(rows.map(r=>{const d=r.document,items=d.items||[],lifts=items.filter(x=>/lift|roller|LFSE|CLP100|VSL400|VSLA201/i.test(x.description)),steps=items.filter(x=>/step|STCS|STDS/i.test(x.description));return{id:r.id,status:'Draft',sale_date:d.contract_date||'',salesperson:d.salesperson||r.created_by,brand:d.spa?.brand||'',serial:d.spa?.serial||'',model:d.spa?.model||'',shell:d.spa?.shell||'',cabinet:d.spa?.cabinet||'',manufacturer_add_ons:d.spa?.manufacturer_add_ons||'',other_items:items.filter(x=>!lifts.includes(x)&&!steps.includes(x)).map(x=>x.quantity+' × '+x.description).join('; '),customer_last_name:d.customer?.last_name||'',cover_lift_model:lifts.map(x=>x.quantity+' × '+x.description).join('; '),step_model:steps.map(x=>x.quantity+' × '+x.description).join('; ')}}))}catch(e){res.status(500).json({error:e.message})}});
router.get('/crm/v1/sales-drafts',...guard,salesIdentity,async(req,res)=>{try{await ensureSalesDrafts();res.json((await q('SELECT * FROM crm_sales_drafts ORDER BY updated_at DESC LIMIT 200')).rows)}catch(e){res.status(500).json({error:e.message})}});
router.post('/crm/v1/sales-drafts',...guard,salesIdentity,async(req,res)=>{try{const document=validateSalesDraft(req.body);document.salesperson=req.user.name||req.user.username;await ensureSalesDrafts();const who=String(req.user.name||req.user.username);res.status(201).json((await q('INSERT INTO crm_sales_drafts(document,created_by,updated_by,owner_user_id) VALUES($1::jsonb,$2,$2,$3) RETURNING *',[JSON.stringify(document),who,req.user.sub])).rows[0])}catch(e){res.status(400).json({error:e.message})}});
router.put('/crm/v1/sales-drafts/:id',...guard,salesIdentity,async(req,res)=>{try{const document=validateSalesDraft(req.body);const version=Number(req.body.version);if(!Number.isInteger(version)||version<1)return res.status(400).json({error:'Draft version is required'});await ensureSalesDrafts();const existing=(await q('SELECT owner_user_id,document FROM crm_sales_drafts WHERE id=$1',[req.params.id])).rows[0];if(!existing||(!salesAdmin(req)&&String(existing.owner_user_id)!==String(req.user.sub)))return res.status(404).json({error:'Agreement not found'});await ensureExecutedContracts();if((await q('SELECT 1 FROM crm_sales_executed_contracts WHERE draft_id=$1',[req.params.id])).rowCount)return res.status(409).json({error:'Signed agreement is locked; use a customer-authorized change order'});if(commercialChanged(existing.document,document))return res.status(409).json({error:'Agreement changes require a customer-signed change order'});document.salesperson=existing.document.salesperson||'';const who=String(req.user.name||req.user.username);const params=[JSON.stringify(document),who,req.params.id,version];let access='';if(!salesAdmin(req)){params.push(req.user.sub);access=' AND owner_user_id=$5'}const row=(await q('UPDATE crm_sales_drafts SET document=$1::jsonb,version=version+1,updated_by=$2,updated_at=NOW() WHERE id=$3 AND version=$4'+access+' RETURNING *',params)).rows[0];if(!row)return res.status(409).json({error:'This draft changed or no longer exists. Reopen it from the log before saving.'});res.json(row)}catch(e){res.status(400).json({error:e.message})}});

// Customer-authorized revisions. Snapshots are retained; commission ownership is never reassigned.
let changeSchemaPromise;
async function ensureChangeOrders(){if(!changeSchemaPromise)changeSchemaPromise=(async()=>{await ensureSalesDrafts();await q(`CREATE TABLE IF NOT EXISTS crm_sales_change_orders(
 id BIGSERIAL PRIMARY KEY,draft_id BIGINT NOT NULL REFERENCES crm_sales_drafts(id),base_version INTEGER NOT NULL,
 base_document JSONB NOT NULL,proposed_document JSONB NOT NULL,document_hash TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',reason TEXT NOT NULL,created_by TEXT NOT NULL,created_user JSONB NOT NULL,
 token_hash TEXT UNIQUE,expires_at TIMESTAMPTZ,delivery_channel TEXT,delivery_status TEXT,delivery_error TEXT,
 signed_name TEXT,signed_at TIMESTAMPTZ,signer_ip TEXT,signer_agent TEXT,consent_text TEXT,
 cancelled_by TEXT,cancelled_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_change_pending ON crm_sales_change_orders(draft_id) WHERE status='pending'`)})().catch(e=>{changeSchemaPromise=null;throw e});return changeSchemaPromise}
const changeConsent='I have reviewed the original and updated agreement details, including the pricing difference. I authorize these changes and agree to use my typed name as my electronic signature for this change order.';
const changeHash=value=>createHash('sha256').update(String(value)).digest('hex');
const customerReviewUrl=raw=>'https://htfo-service-operations.onrender.com/api/service/crm/v1/change-orders/customer#'+raw;
function changedSalesDocument(original,input){
 const proposed=validateSalesDraft({...original,spa:input.spa,msrp:input.msrp,discount:input.discount,items:input.items,tax_rate:input.tax_rate,notes:input.notes});
 // Contacts, payments, financing, salesperson and original terms cannot be changed through a change order.
 proposed.customer=original.customer;proposed.payments=original.payments;proposed.finance=original.finance;proposed.salesperson=original.salesperson;
 proposed.status=original.status;proposed.terms_version=original.terms_version;return proposed;
}
const changeFields=['spa','msrp','discount','items','tax_rate','notes'];
const stableChangeJSON=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
const commercialChanged=(a,b)=>{const left=validateSalesDraft(a),right=validateSalesDraft(b);return changeFields.some(k=>stableChangeJSON(left[k])!==stableChangeJSON(right[k]))};
function agreementCopy(d){const money=n=>'$'+(Number(n||0)/100).toFixed(2);return[
 'HOT TUB FACTORY OUTLET — UPDATED DRAFT AGREEMENT',
 'This change approval does not replace the original purchase-contract signing step.',
 'Customer: '+[d.customer?.first_name,d.customer?.last_name].filter(Boolean).join(' '),
 'Address: '+[d.customer?.street,d.customer?.city,d.customer?.state,d.customer?.zip].filter(Boolean).join(', '),
 'Phone: '+(d.customer?.phone||''),'Email: '+(d.customer?.email||''),
 'Original salesperson: '+(d.salesperson||''),'Contract date: '+(d.contract_date||''),
 ...Object.entries(d.spa||{}).map(([k,v])=>k.replaceAll('_',' ')+': '+(v||'')),
 'Spa MSRP: '+money(d.msrp),'Manual discount: '+money(d.discount),
 ...(d.items||[]).map(x=>x.quantity+' × '+x.description+' @ '+money(x.unit_price)+' = '+money(x.quantity*x.unit_price)),
 'Subtotal: '+money(d.totals?.subtotal),'Tax ('+(d.tax_rate/100)+'%): '+money(d.totals?.tax),'Total: '+money(d.totals?.total),
 'Payments recorded: '+money(d.totals?.paid),'Balance: '+money(d.totals?.balance),
 'Financing bank: '+(d.finance?.bank||''),'Financed amount: '+money(d.finance?.amount),
 'Financing agreements completed: '+(d.finance?.complete?'Yes':'No'),
 ...(d.payments||[]).map(x=>'Payment: '+x.date+' · '+x.method+' · '+money(x.amount)+' · '+(x.reference||'')),
 'Notes: '+(d.notes||''),'Delivery and removal: HTFO in-house employees.'
 ].join('\n')}
async function dispatchChange(c,channel,staffUser){
 if(!['email','sms'].includes(channel))throw new Error('Choose email or text');
 const customer=c.base_document.customer||{},to=channel==='email'?customer.email:customer.phone;
 if(!to)throw new Error('The original agreement has no '+(channel==='email'?'email address':'phone number'));
 if(channel==='sms'&&await opted(to))throw new Error('Customer has opted out of text messages');
 const raw=randomBytes(32).toString('hex'),url=customerReviewUrl(raw),approved=c.status==='approved';
 await q("UPDATE crm_sales_change_orders SET token_hash=$2,expires_at=NOW()+INTERVAL '7 days',delivery_channel=$3,delivery_status='sending',delivery_error=NULL WHERE id=$1",[c.id,changeHash(raw),channel]);
 const subject=approved?'Your updated HTFO agreement — change order '+c.id:'Please review and sign HTFO change order '+c.id;
 const body=approved?('Your change order has been signed.\nSigned by '+c.signed_name+' on '+new Date(c.signed_at).toISOString()+'\n\n'+agreementCopy(c.proposed_document)+'\n\nView and print your signed change order and updated agreement:\n'+url):('Please review the requested changes to your HTFO agreement.\n\n'+c.reason+'\n\nOriginal total: $'+(c.base_document.totals.total/100).toFixed(2)+'\nUpdated total: $'+(c.proposed_document.totals.total/100).toFixed(2)+'\n\nReview both versions and sign here:\n'+url+'\n\nThis link expires in 7 days. No changes take effect until you approve.');
 try{if(channel==='email')await email(to,subject,body,[customer.first_name,customer.last_name].filter(Boolean).join(' '),staffUser,c.base_document.submission_id||null);else await sms(to,approved?'HTFO: Your signed change order and updated agreement are ready to view or print: '+url:'HTFO: Please review and sign your requested agreement changes: '+url);await q("UPDATE crm_sales_change_orders SET delivery_status='sent',delivery_error=NULL WHERE id=$1",[c.id]);return {sent:true,channel,to}}catch(e){await q("UPDATE crm_sales_change_orders SET delivery_status='failed',delivery_error=$2 WHERE id=$1",[c.id,String(e.message).slice(0,500)]);throw e}
}
router.get('/crm/v1/sales-drafts/:id/change-orders',...guard,salesIdentity,async(req,res)=>{try{await ensureChangeOrders();res.json((await q('SELECT id,draft_id,base_version,base_document,proposed_document,status,reason,created_by,created_at,delivery_channel,delivery_status,delivery_error,signed_name,signed_at,cancelled_by,cancelled_at FROM crm_sales_change_orders WHERE draft_id=$1 ORDER BY created_at DESC',[req.params.id])).rows)}catch(e){res.status(500).json({error:e.message})}});
router.post('/crm/v1/sales-drafts/:id/change-orders',...guard,salesIdentity,async(req,res)=>{try{await ensureChangeOrders();const base=(await q('SELECT * FROM crm_sales_drafts WHERE id=$1',[req.params.id])).rows[0];if(!base)return res.status(404).json({error:'Agreement not found'});if(Number(req.body.version)!==base.version)return res.status(409).json({error:'Reopen the latest agreement before proposing a change'});const reason=String(req.body.reason||'').trim().slice(0,2000);if(!reason)return res.status(400).json({error:'Describe the customer-requested change'});const proposed=changedSalesDocument(base.document,req.body);if(!commercialChanged(base.document,proposed))return res.status(400).json({error:'No agreement changes were entered'});const row=(await q(`INSERT INTO crm_sales_change_orders(draft_id,base_version,base_document,proposed_document,document_hash,reason,created_by,created_user) SELECT id,version,document,$3::jsonb,$4,$5,$6,$7::jsonb FROM crm_sales_drafts WHERE id=$1 AND version=$2 RETURNING id,status`,[base.id,base.version,JSON.stringify(proposed),changeHash(stableChangeJSON(proposed)),reason,req.user.name||req.user.username,JSON.stringify(req.user)])).rows[0];if(!row)return res.status(409).json({error:'Agreement changed. Reopen it and try again.'});res.status(201).json(row)}catch(e){res.status(e.code==='23505'?409:400).json({error:e.code==='23505'?'A pending change order already exists. Review or cancel it first.':e.message})}});
router.post('/crm/v1/change-orders/:id/send',...guard,salesIdentity,async(req,res)=>{try{await ensureChangeOrders();const c=(await q('SELECT c.*,d.version current_version FROM crm_sales_change_orders c JOIN crm_sales_drafts d ON d.id=c.draft_id WHERE c.id=$1',[req.params.id])).rows[0];if(!c||!['pending','approved'].includes(c.status))return res.status(404).json({error:'Active change order not found'});if(c.status==='pending'&&c.base_version!==c.current_version)return res.status(409).json({error:'Agreement changed. Cancel this request and create a new one.'});res.json(await dispatchChange(c,req.body.channel,req.user))}catch(e){res.status(502).json({error:e.message})}});
router.post('/crm/v1/change-orders/:id/cancel',...guard,salesIdentity,async(req,res)=>{try{await ensureChangeOrders();const c=(await q("UPDATE crm_sales_change_orders SET status='cancelled',cancelled_at=NOW(),cancelled_by=$2,token_hash=NULL WHERE id=$1 AND status='pending' RETURNING id",[req.params.id,req.user.name||req.user.username])).rows[0];if(!c)return res.status(409).json({error:'Change order is no longer pending'});res.json({ok:true})}catch(e){res.status(400).json({error:e.message})}});
async function publicChange(raw){if(!/^[a-f0-9]{64}$/.test(String(raw||'')))return null;await ensureChangeOrders();return(await q("SELECT c.*,d.version current_version FROM crm_sales_change_orders c JOIN crm_sales_drafts d ON d.id=c.draft_id WHERE token_hash=$1 AND expires_at>NOW() AND c.status IN ('pending','approved')",[changeHash(raw)])).rows[0]||null}
router.post('/crm/v1/change-orders/customer/review',async(req,res)=>{res.setHeader('Cache-Control','no-store');try{const c=await publicChange(req.body.token);if(!c)return res.status(410).json({error:'This link is invalid, cancelled or expired. Please contact HTFO.'});const stale=c.status==='pending'&&c.current_version!==c.base_version;res.json({id:c.id,draft_id:c.draft_id,status:c.status,reason:c.reason,original:c.base_document,updated:c.proposed_document,signed_name:c.signed_name,signed_at:c.signed_at,document_hash:c.document_hash,consent_text:changeConsent,can_sign:c.status==='pending'&&!stale,stale,original_copy:agreementCopy(c.base_document),updated_copy:agreementCopy(c.proposed_document)})}catch(e){res.status(500).json({error:'Unable to load this change order'})}});
router.post('/crm/v1/change-orders/customer/sign',async(req,res)=>{res.setHeader('Cache-Control','no-store');try{if(req.body.consent!==true)return res.status(400).json({error:'Please confirm your approval and electronic signature consent'});const name=String(req.body.name||'').trim().slice(0,150);if(name.length<2)return res.status(400).json({error:'Enter your full name to sign'});const c=await publicChange(req.body.token);if(!c)return res.status(410).json({error:'This link has expired or is unavailable'});if(c.status==='approved')return res.json({ok:true,already_signed:true});const result=(await q(`WITH candidate AS (
 SELECT * FROM crm_sales_change_orders WHERE id=$1 AND token_hash=$2 AND status='pending' AND expires_at>NOW() FOR UPDATE
 ), changed AS (
 UPDATE crm_sales_drafts d SET document=c.proposed_document,version=d.version+1,updated_by=$3,updated_at=NOW() FROM candidate c WHERE d.id=c.draft_id AND d.version=c.base_version RETURNING d.id
 ) UPDATE crm_sales_change_orders c SET status='approved',signed_name=$4,signed_at=NOW(),signer_ip=$5,signer_agent=$6,consent_text=$7 FROM changed d WHERE c.id=$1 AND c.draft_id=d.id AND c.status='pending' RETURNING c.*`,[c.id,changeHash(req.body.token),'Customer-approved change order '+c.id,name,String(req.ip||'').slice(0,100),String(req.get('user-agent')||'').slice(0,500),changeConsent])).rows[0];if(!result)return res.status(409).json({error:'The agreement or change request has changed. Contact HTFO for an updated request.'});let notification='sent';try{const channel=result.base_document.customer?.email?'email':'sms';const customer=result.base_document.customer||{},url=customerReviewUrl(req.body.token);if(channel==='email')await email(customer.email,'Your signed HTFO change order '+result.id,'Signed by '+name+'\n\n'+agreementCopy(result.proposed_document)+'\n\nView and print the signed change order and updated copy:\n'+url,[customer.first_name,customer.last_name].filter(Boolean).join(' '),result.created_user,result.base_document.submission_id||null);else{if(await opted(customer.phone))throw new Error('Customer opted out of texts');await sms(customer.phone,'HTFO: Your signed change order and updated agreement are available to view and print: '+url)}await q("UPDATE crm_sales_change_orders SET delivery_status='receipt_sent',delivery_error=NULL WHERE id=$1",[result.id])}catch(e){notification='failed';await q("UPDATE crm_sales_change_orders SET delivery_status='receipt_failed',delivery_error=$2 WHERE id=$1",[result.id,String(e.message).slice(0,500)])}res.json({ok:true,notification})}catch(e){res.status(500).json({error:'Unable to apply this change order. Please reload before trying again.'})}});

const changeCustomerPage=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HTFO change order</title><style>
*{box-sizing:border-box}body{margin:0;background:#f3f6f8;color:#172331;font:16px system-ui,-apple-system,sans-serif}main{max-width:960px;margin:auto;padding:22px}header{background:#082642;color:white;padding:24px}h1{font-size:26px;margin:4px 0}section,details{background:white;border:1px solid #dbe4ea;border-radius:12px;padding:18px;margin:16px 0}.note{background:#fff7e5;border:1px solid #ead9a4;padding:14px;border-radius:10px}table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;vertical-align:top;padding:10px;border-bottom:1px solid #dbe4ea;white-space:pre-wrap;overflow-wrap:anywhere}th{color:#082642}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.6 system-ui}label{display:block;margin:14px 0}input[type=text]{display:block;width:100%;padding:13px;border:1px solid #8ba5b8;border-radius:8px;font:inherit;margin-top:8px}input[type=checkbox]{width:22px;height:22px;vertical-align:middle;margin-right:8px}button{padding:13px 18px;min-height:46px;border:0;border-radius:8px;background:#0b79b7;color:white;font:700 16px system-ui;cursor:pointer}button:disabled{opacity:.55}summary{cursor:pointer;font-weight:700;padding:6px}#status{white-space:pre-wrap;line-height:1.6}#signed{background:#eaf4ec;padding:15px;border-radius:10px;white-space:pre-wrap}small{color:#617181}@media(max-width:600px){main{padding:12px}th,td{padding:7px;font-size:13px}h1{font-size:22px}}@media print{header{background:white;color:black}body{background:white}#signForm,#printButton{display:none}section,details{break-inside:avoid;border:0;padding:0}main{max-width:none}pre{font-size:11px}}
</style><script src="/api/service/crm/v1/change-orders/customer.js" defer></script></head><body><header><div>HOT TUB FACTORY OUTLET</div><h1>Review your change order</h1></header><main><p id="status" role="status">Loading your secure change order…</p><div id="content" hidden><p id="draftNote" class="note">This approves changes to a draft agreement. Initial purchase-contract signing is a separate step.</p><h2 id="title"></h2><p id="reason"></p><section><h3>What changes</h3><table><thead><tr><th>Item</th><th>Original</th><th>Updated</th></tr></thead><tbody id="changes"></tbody></table><p id="price"></p></section><details><summary>Original agreement copy</summary><pre id="original"></pre></details><details open><summary>Updated agreement copy</summary><pre id="updated"></pre></details><div id="signed" hidden></div><form id="signForm"><section><h3>Customer authorization</h3><p id="consentText"></p><label>Full name — electronic signature<input id="signature" type="text" autocomplete="name" maxlength="150" minlength="2" required></label><label><input id="consent" type="checkbox" required>I approve the changes shown and consent to sign electronically.</label><button id="signButton">Sign and authorize changes</button><p><small>Anyone with this private link can view the agreement. Keep it private. Please contact HTFO if anything is incorrect.</small></p></section></form><button id="printButton" type="button">Print / Save PDF</button></div></main></body></html>`;
const changeCustomerScript=String.raw`(()=>{
const root='/api/service/crm/v1/change-orders/customer',token=location.hash.slice(1),Q=s=>document.querySelector(s),money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(n||0)/100);
async function request(path,data){const r=await fetch(root+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...data,token})}),j=await r.json();if(!r.ok)throw new Error(j.error||'Unable to complete this request');return j}
function row(label,old,value){if(String(old??'')===String(value??''))return;const tr=document.createElement('tr');for(const v of [label,old??'',value??'']){const td=document.createElement('td');td.textContent=String(v);tr.append(td)}Q('#changes').append(tr)}
const items=d=>(d.items||[]).map(x=>x.quantity+' × '+x.description+' @ '+money(x.unit_price)+' = '+money(x.quantity*x.unit_price)).join('\n');
async function load(){try{const c=await request('/review',{});Q('#content').hidden=false;Q('#title').textContent='Change order '+c.id+' · Agreement '+c.draft_id;Q('#reason').textContent=c.reason;Q('#draftNote').hidden=c.original.status!=='draft';Q('#original').textContent=c.original_copy;Q('#updated').textContent=c.updated_copy;Q('#consentText').textContent=c.consent_text;Q('#changes').replaceChildren();const a=c.original,b=c.updated;for(const key of new Set([...Object.keys(a.spa||{}),...Object.keys(b.spa||{})]))row(key.replaceAll('_',' '),a.spa?.[key],b.spa?.[key]);for(const [key,label]of [['msrp','Spa MSRP'],['discount','Manual discount']])row(label,money(a[key]),money(b[key]));row('Accessories / services',items(a),items(b));row('Sales tax rate',a.tax_rate/100+'%',b.tax_rate/100+'%');row('Notes',a.notes,b.notes);row('Total price',money(a.totals.total),money(b.totals.total));row('Balance',money(a.totals.balance),money(b.totals.balance));const difference=b.totals.total-a.totals.total;Q('#price').textContent='Original total: '+money(a.totals.total)+' · Updated total: '+money(b.totals.total)+' · Difference: '+money(difference);Q('#signForm').hidden=!c.can_sign;Q('#signed').hidden=c.status!=='approved';if(c.status==='approved')Q('#signed').textContent='APPROVED CHANGE ORDER\nElectronically signed by '+c.signed_name+'\n'+new Date(c.signed_at).toLocaleString()+'\nDocument reference: '+c.document_hash;Q('#status').textContent=c.stale?'This request has been superseded by an agreement update. Please contact HTFO for a new request.':c.status==='approved'?'Your approved changes have been saved. You can print or save your updated copy below.':'Please review all changes and updated pricing before signing.'}catch(e){Q('#status').textContent=e.message;Q('#content').hidden=true}}
Q('#signForm').onsubmit=async e=>{e.preventDefault();Q('#signButton').disabled=true;Q('#status').textContent='Saving your authorization…';try{const r=await request('/sign',{name:Q('#signature').value,consent:Q('#consent').checked});await load();if(r.notification==='failed')Q('#status').textContent+=' Your changes are approved, but the confirmation message could not be sent. Please save this copy or contact HTFO.'}catch(e){Q('#status').textContent=e.message}finally{Q('#signButton').disabled=false}};Q('#printButton').onclick=()=>{document.querySelectorAll('details').forEach(d=>d.open=true);window.print()};load();
})();`;
router.get('/crm/v1/change-orders/customer',(_req,res)=>{res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.type('html').send(changeCustomerPage)});
router.get('/crm/v1/change-orders/customer.js',(_req,res)=>{res.setHeader('Cache-Control','no-store');res.type('application/javascript').send(changeCustomerScript)});

// Group by verified contact identifiers, never by display name.
const threadPhoneSql=column=>{const d=`regexp_replace(coalesce(${column},''),'[^0-9]','','g')`;return `(CASE WHEN length(${d})=11 AND left(${d},1)='1' THEN substring(${d} from 2) ELSE ${d} END)`};
let threadSchemaPromise;
async function ensureThreadSchema(){if(!threadSchemaPromise)threadSchemaPromise=(async()=>{await ensure();await q(`
 CREATE INDEX IF NOT EXISTS idx_crm_thread_lead_phone ON crm_website_leads ((${threadPhoneSql('phone')})) WHERE deleted_at IS NULL;
 CREATE INDEX IF NOT EXISTS idx_crm_thread_lead_email ON crm_website_leads ((lower(trim(coalesce(email,''))))) WHERE deleted_at IS NULL;
 CREATE INDEX IF NOT EXISTS idx_crm_thread_sms_date ON crm_sms_messages(created_at DESC);
 CREATE INDEX IF NOT EXISTS idx_crm_thread_email_date ON crm_email_messages((COALESCE(received_at,created_at)) DESC);`);})().catch(e=>{threadSchemaPromise=null;throw e});return threadSchemaPromise}
function conversationThreadCte(detail=false){const contacts=detail?`key_contacts AS (SELECT submission_id,${threadPhoneSql('phone')} phone,lower(trim(coalesce(email,''))) email FROM crm_website_leads WHERE deleted_at IS NULL AND ('phone:'||${threadPhoneSql('phone')}=$2 OR 'email:'||lower(trim(coalesce(email,'')))=$2 OR 'lead:'||submission_id=$2)),`:'';
 const smsKey=detail?` AND ('phone:'||${threadPhoneSql("CASE WHEN lower(coalesce(m.direction,'')) LIKE 'inbound%' THEN m.from_number ELSE m.to_number END")}=$2 OR m.lead_submission_id IN (SELECT submission_id FROM key_contacts) OR ${threadPhoneSql("CASE WHEN lower(coalesce(m.direction,'')) LIKE 'inbound%' THEN m.from_number ELSE m.to_number END")} IN (SELECT phone FROM key_contacts WHERE phone<>'') OR 'unknown:sms:'||m.id::text=$2)`:'';
 const emailKey=detail?` AND (e.submission_id IN (SELECT submission_id FROM key_contacts) OR lower(trim(coalesce(CASE WHEN lower(coalesce(e.direction,'')) LIKE 'inbound%' THEN e.from_email ELSE e.to_email END,''))) IN (SELECT email FROM key_contacts WHERE email<>'') OR 'email:'||lower(trim(coalesce(CASE WHEN lower(coalesce(e.direction,'')) LIKE 'inbound%' THEN e.from_email ELSE e.to_email END,'')))=$2 OR 'unknown:email:'||e.id::text=$2)`:'';
 return `WITH ${contacts}raw_messages AS (
 SELECT m.id::text message_id,'sms'::text channel,m.direction,NULL::text subject,m.body,m.status,m.created_at occurred_at,m.lead_submission_id original_lead,
 CASE WHEN lower(coalesce(m.direction,'')) LIKE 'inbound%' THEN m.from_number ELSE m.to_number END peer,
 ${threadPhoneSql("CASE WHEN lower(coalesce(m.direction,'')) LIKE 'inbound%' THEN m.from_number ELSE m.to_number END")} peer_phone,NULL::text peer_email
 FROM crm_sms_messages m WHERE m.created_at >= $1::timestamptz ${smsKey}
 UNION ALL
 SELECT e.id::text,'email'::text,e.direction,e.subject,e.body,e.status,COALESCE(e.received_at,e.created_at),e.submission_id,
 CASE WHEN lower(coalesce(e.direction,'')) LIKE 'inbound%' THEN e.from_email ELSE e.to_email END,
 NULL::text,lower(trim(coalesce(CASE WHEN lower(coalesce(e.direction,'')) LIKE 'inbound%' THEN e.from_email ELSE e.to_email END,'')))
 FROM crm_email_messages e WHERE COALESCE(e.received_at,e.created_at) >= $1::timestamptz ${emailKey}
 ), resolved AS (
 SELECT m.*,l.submission_id,l.first_name,l.last_name,l.phone,l.email,l.assigned_to,l.pipeline_stage,
 CASE WHEN coalesce(nullif(${threadPhoneSql('l.phone')},''),nullif(m.peer_phone,'')) IS NOT NULL THEN 'phone:'||coalesce(nullif(${threadPhoneSql('l.phone')},''),nullif(m.peer_phone,''))
 WHEN coalesce(nullif(lower(trim(l.email)),''),nullif(m.peer_email,'')) IS NOT NULL THEN 'email:'||coalesce(nullif(lower(trim(l.email)),''),nullif(m.peer_email,''))
 WHEN l.submission_id IS NOT NULL THEN 'lead:'||l.submission_id ELSE 'unknown:'||m.channel||':'||m.message_id END thread_key
 FROM raw_messages m
 LEFT JOIN LATERAL (
 SELECT x.submission_id,x.first_name,x.last_name,x.phone,x.email,x.assigned_to,x.pipeline_stage
 FROM crm_website_leads x WHERE x.deleted_at IS NULL AND (
 x.submission_id=m.original_lead OR (m.peer_phone<>'' AND ${threadPhoneSql('x.phone')}=m.peer_phone)
 OR (m.peer_email<>'' AND lower(trim(coalesce(x.email,'')))=m.peer_email))
 ORDER BY (trim(concat_ws(' ',x.first_name,x.last_name))<>'') DESC,(x.submission_id=m.original_lead) DESC NULLS LAST,x.received_at DESC,x.submission_id LIMIT 1
 ) l ON true
 )`}
router.get('/crm/v1/conversation-threads',...guard,async(req,res)=>{try{await ensureThreadSchema();const days=Math.min(365,Math.max(1,Number(req.query.days)||30)),limit=Math.min(500,Math.max(1,Number(req.query.limit)||300));
 const channel=['sms','email'].includes(req.query.channel)?req.query.channel:'all',direction=['inbound','outbound'].includes(req.query.direction)?req.query.direction:'all',term=String(req.query.q||'').trim().slice(0,300);
 const cutoff=new Date(Date.now()-days*86400000).toISOString();const rows=(await q(conversationThreadCte()+`, filtered AS (
 SELECT * FROM resolved WHERE ($2='all' OR channel=$2) AND ($3='all' OR CASE WHEN $3='inbound' THEN lower(coalesce(direction,'')) LIKE 'inbound%' ELSE lower(coalesce(direction,'')) NOT LIKE 'inbound%' END)
 AND ($4::text IS NULL OR concat_ws(' ',first_name,last_name,phone,email,peer,subject,body,assigned_to) ILIKE $4)
 ), ranked AS (
 SELECT *,row_number() OVER(PARTITION BY thread_key ORDER BY occurred_at DESC,channel,message_id DESC) rn,
 count(*) OVER(PARTITION BY thread_key)::int message_count,
 count(*) FILTER(WHERE lower(coalesce(direction,'')) LIKE 'inbound%') OVER(PARTITION BY thread_key)::int inbound_count,
 count(*) FILTER(WHERE channel='sms') OVER(PARTITION BY thread_key)::int sms_count,
 max(occurred_at) FILTER(WHERE lower(coalesce(direction,'')) LIKE 'inbound%') OVER(PARTITION BY thread_key) last_inbound_at,
 count(*) FILTER(WHERE channel='email') OVER(PARTITION BY thread_key)::int email_count
 FROM filtered)
 SELECT thread_key,submission_id,first_name,last_name,phone,email,peer,assigned_to,pipeline_stage,channel,direction,subject,left(body,180) body,occurred_at,message_count,inbound_count,sms_count,email_count,last_inbound_at,count(*) OVER()::int total_threads
 FROM ranked WHERE rn=1 ORDER BY occurred_at DESC,thread_key LIMIT $5`,[cutoff,channel,direction,term?'%'+term+'%':null,limit])).rows;
 const stats=rows.reduce((a,r)=>{a.total++;a.inbound+=r.inbound_count;a.outbound+=r.message_count-r.inbound_count;a.sms+=r.sms_count;a.email+=r.email_count;a.messages+=r.message_count;return a},{total:0,messages:0,inbound:0,outbound:0,sms:0,email:0});res.json({days,stats,total_threads:rows[0]?.total_threads||0,threads:rows})
}catch(e){res.status(500).json({error:e.message})}});
router.get('/crm/v1/conversation-threads/messages',...guard,async(req,res)=>{try{await ensureThreadSchema();const key=String(req.query.key||'');if(!/^(phone|email|lead|unknown):.{1,240}$/.test(key))return res.status(400).json({error:'Choose a valid conversation'});
 const beforeAt=req.query.before_at?new Date(String(req.query.before_at)):null;if(beforeAt&&!Number.isFinite(beforeAt.getTime()))return res.status(400).json({error:'Invalid history cursor'});
 const rows=(await q(conversationThreadCte(true)+` SELECT message_id,channel,direction,subject,body,status,occurred_at,submission_id,peer FROM resolved WHERE thread_key=$2 AND ($3::timestamptz IS NULL OR (occurred_at,channel||':'||message_id)<($3::timestamptz,$4::text)) ORDER BY occurred_at DESC,channel||':'||message_id DESC LIMIT 101`,['1970-01-01T00:00:00.000Z',key,beforeAt?.toISOString()||null,String(req.query.before_key||'')])).rows;
 const hasMore=rows.length>100,items=rows.slice(0,100),last=items.at(-1);res.json({messages:items.reverse(),has_more:hasMore,next:hasMore?{at:last.occurred_at,key:last.channel+':'+last.message_id}:null})
}catch(e){res.status(500).json({error:e.message})}});

export default router;
