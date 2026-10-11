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
    CREATE INDEX IF NOT EXISTS idx_crm_tasks_due ON crm_tasks(status,due_at);
    CREATE INDEX IF NOT EXISTS idx_crm_email_submission ON crm_email_messages(submission_id,created_at DESC);`);
}
function splitName(n){const p=String(n||'').trim().split(/\s+/).filter(Boolean);return{first:p.shift()||null,last:p.length?p.join(' '):null}}
function showroomFrom(tags=[]){const a=(Array.isArray(tags)?tags:[]).map(x=>String(x).toLowerCase());return a.includes('showroom-wexford')?'Wexford':a.includes('showroom-monroeville')?'Monroeville':a.includes('showroom-either')?'Either':null}
function merge(t,l){return String(t||'').replaceAll('{Name}',clean(l.first_name)||'there').replaceAll('{FirstName}',clean(l.first_name)||'there').replaceAll('{Product}',clean(l.product_interest)||'').replaceAll('{Brand}',clean(l.brand_interest)||'').replaceAll('{Model}',clean(l.model_interest)||'')}
async function sms(to,body){const a=sid(),b=token(),from=salesNumber();if(!a||!b||!from)throw new Error('Sales Twilio is not fully configured');const form=new URLSearchParams({To:String(to),From:from,Body:String(body)});const r=await fetch('https://api.twilio.com/2010-04-01/Accounts/'+encodeURIComponent(a)+'/Messages.json',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(a+':'+b).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:form});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.message||('Twilio returned '+r.status));return j}
async function opted(phone){if(!phone)return true;const d=String(phone).replace(/\D/g,'');return (await q(`SELECT 1 FROM crm_sms_messages WHERE regexp_replace(from_number,'\\D','','g')=$1 AND direction IN ('inbound','inbound-shadow') AND upper(trim(body)) IN ('STOP','STOPALL','UNSUBSCRIBE','CANCEL','END','QUIT') LIMIT 1`,[d])).rowCount>0}
async function email(to,subject,body,name){const key=String(process.env.BREVO_API_KEY||'').trim(),from=String(process.env.CRM_FROM_EMAIL||process.env.FULFILLMENT_FROM_EMAIL||'').trim();if(!key||!from)throw new Error('CRM email sender is not configured');const r=await fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'api-key':key,'Content-Type':'application/json'},body:JSON.stringify({sender:{email:from,name:String(process.env.CRM_FROM_NAME||'Hot Tub Factory Outlet')},to:[{email:to,name:name||to}],subject,textContent:body})});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.message||('Brevo returned '+r.status));return j}

function normalizePipelineStage(name,status){
  const s=String(status||'').toLowerCase(),n=String(name||'').trim().toLowerCase();
  if(s==='won')return 'Sold';
  if(s==='lost'||s==='abandoned')return 'Lost';
  if(!n)return null;
  if(n.includes('new'))return 'New Lead';
  if(n.includes('contact'))return 'Contacted';
  if(n.includes('appoint'))return 'Appointment';
  if(n.includes('visit')||n.includes('showroom'))return 'Visited Showroom';
  if(n.includes('quot')||n.includes('proposal')||n.includes('price'))return 'Quoted';
  if(n.includes('sold')||n.includes('won'))return 'Sold';
  if(n.includes('lost')||n.includes('dead')||n.includes('closed'))return 'Lost';
  return null;
}
function stageFromHighLevel(status,probability){
  const s=String(status||'').toLowerCase(),p=Number(probability)||0;
  if(s==='won')return 'Sold';
  if(s==='lost'||s==='abandoned')return 'Lost';
  if(p<=20)return 'New Lead';
  if(p<=35)return 'Contacted';
  if(p<=50)return 'Appointment';
  if(p<=65)return 'Visited Showroom';
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
    FROM crm_website_leads`)).rows[0];
  res.json(r);
}catch(e){res.status(500).json({error:e.message})}});

router.get('/crm/v1/staff',...guard,async(req,res)=>{try{await ensure();res.json((await q(`SELECT id,username,display_name,role FROM service_users WHERE active=true AND role IN ('admin','owner','manager','service_manager','sales') ORDER BY display_name`)).rows)}catch(e){res.status(500).json({error:e.message})}});

router.get('/crm/v1/leads',...guard,async(req,res)=>{try{
  await ensure();const term=clean(req.query.q)||'',stage=clean(req.query.stage),product=clean(req.query.product),brand=clean(req.query.brand),model=clean(req.query.model),assigned=clean(req.query.assigned_to),showroom=clean(req.query.showroom);
  const p=['%'+term+'%'];let w=`WHERE concat_ws(' ',first_name,last_name,email,phone,source,note,product_interest,brand_interest,model_interest,tags::text,payload::text) ILIKE $1`;
  if(stage){p.push(stage);w+=' AND pipeline_stage=$'+p.length}if(product){p.push(product);w+=' AND lower(coalesce(product_interest,\'\'))=lower($'+p.length+')'}if(brand){p.push('%'+brand+'%');w+=' AND coalesce(brand_interest,\'\') ILIKE $'+p.length}if(model){p.push('%'+model+'%');w+=' AND coalesce(model_interest,\'\') ILIKE $'+p.length}if(assigned){p.push(assigned);w+=' AND lower(coalesce(assigned_to,\'\'))=lower($'+p.length+')'}if(showroom){p.push(showroom);w+=' AND lower(coalesce(showroom,\'\'))=lower($'+p.length+')'}
  p.push(Math.min(1500,Math.max(1,Number(req.query.limit)||500)));
  res.json((await q(`SELECT submission_id,first_name,last_name,email,phone,source,tags,note,payload,product_interest,brand_interest,model_interest,assigned_to,showroom,next_follow_up_at,last_contacted_at,has_opportunity,ghl_opportunity_status,ghl_opportunity_id,ghl_pipeline_id,ghl_pipeline_stage_id,ghl_assigned_user_id,ghl_assigned_user_name,ghl_opportunity_value,ghl_stage_probability,ghl_last_stage_change_at,ghl_last_status_change_at,lifecycle_stage,pipeline_stage,ghl_contact_id,received_at,updated_at FROM crm_website_leads ${w} ORDER BY received_at DESC LIMIT $${p.length}`,p)).rows);
}catch(e){res.status(500).json({error:e.message})}});

router.get('/crm/v1/leads/:id',...guard,async(req,res)=>{try{
  await ensure();const lead=(await q(`SELECT submission_id,first_name,last_name,email,phone,source,tags,note,payload,product_interest,brand_interest,model_interest,assigned_to,showroom,next_follow_up_at,last_contacted_at,has_opportunity,ghl_opportunity_status,ghl_opportunity_id,ghl_pipeline_id,ghl_pipeline_stage_id,ghl_assigned_user_id,ghl_assigned_user_name,ghl_opportunity_value,ghl_stage_probability,ghl_last_stage_change_at,ghl_last_status_change_at,lifecycle_stage,pipeline_stage,ghl_contact_id,received_at,updated_at FROM crm_website_leads WHERE submission_id=$1`,[req.params.id])).rows[0];if(!lead)return res.status(404).json({error:'Lead not found'});
  const [notes,smsRows,emails,tasks]=await Promise.all([q('SELECT id,note_type,body,quoted_price,financing_interest,created_by,created_at FROM crm_lead_notes WHERE submission_id=$1 ORDER BY created_at DESC',[req.params.id]),lead.phone?q(`SELECT id,direction,from_number,to_number,body,status,created_at FROM crm_sms_messages WHERE from_number=$1 OR to_number=$1 OR lead_submission_id=$2 ORDER BY created_at DESC LIMIT 500`,[lead.phone,req.params.id]):Promise.resolve({rows:[]}),q('SELECT * FROM crm_email_messages WHERE submission_id=$1 ORDER BY created_at DESC LIMIT 250',[req.params.id]),q('SELECT * FROM crm_tasks WHERE submission_id=$1 ORDER BY due_at DESC',[req.params.id])]);
  res.json({lead,notes:notes.rows,sms:smsRows.rows,emails:emails.rows,tasks:tasks.rows});
}catch(e){res.status(500).json({error:e.message})}});

router.patch('/crm/v1/leads/:id/profile',...guard,async(req,res)=>{try{await ensure();const b=req.body||{};const r=await q(`UPDATE crm_website_leads SET assigned_to=$2,showroom=$3,next_follow_up_at=$4,last_contacted_at=CASE WHEN $5::boolean THEN NOW() ELSE last_contacted_at END,updated_at=NOW() WHERE submission_id=$1 RETURNING submission_id,assigned_to,showroom,next_follow_up_at,last_contacted_at`,[req.params.id,clean(b.assigned_to),clean(b.showroom),b.next_follow_up_at||null,Boolean(b.mark_contacted)]);if(!r.rowCount)return res.status(404).json({error:'Lead not found'});res.json(r.rows[0])}catch(e){res.status(500).json({error:e.message})}});

router.get('/crm/v1/today',...guard,async(req,res)=>{try{
  await ensure();const who=clean(req.query.assigned_to)||clean(req.user?.name)||clean(req.user?.username),mine=String(req.query.mine||'false')==='true',p=mine&&who?[who]:[],owner=mine&&who?' AND lower(coalesce(assigned_to,\'\'))=lower($1)':'';
  const [n,u,f,t]=await Promise.all([q(`SELECT submission_id,first_name,last_name,phone,email,source,assigned_to,pipeline_stage,received_at FROM crm_website_leads WHERE received_at>=CURRENT_DATE ${owner} ORDER BY received_at DESC LIMIT 100`,p),q(`SELECT submission_id,first_name,last_name,phone,email,source,assigned_to,pipeline_stage,received_at FROM crm_website_leads WHERE pipeline_stage='New Lead' AND last_contacted_at IS NULL ${owner} ORDER BY received_at ASC LIMIT 100`,p),q(`SELECT submission_id,first_name,last_name,phone,email,assigned_to,next_follow_up_at,pipeline_stage FROM crm_website_leads WHERE next_follow_up_at IS NOT NULL AND next_follow_up_at<CURRENT_DATE+INTERVAL '1 day' AND pipeline_stage NOT IN ('Sold','Lost') ${owner} ORDER BY next_follow_up_at ASC LIMIT 100`,p),q(`SELECT t.*,concat_ws(' ',l.first_name,l.last_name) lead_name,l.phone,l.email FROM crm_tasks t LEFT JOIN crm_website_leads l ON l.submission_id=t.submission_id WHERE t.status='open' AND t.due_at<CURRENT_DATE+INTERVAL '1 day' ${mine&&who?'AND lower(coalesce(t.assigned_to,\'\'))=lower($1)':''} ORDER BY t.due_at ASC LIMIT 100`,p)]);
  res.json({new_leads:n.rows,uncontacted:u.rows,followups:f.rows,tasks:t.rows});
}catch(e){res.status(500).json({error:e.message})}});

router.post('/crm/v1/tasks',...guard,async(req,res)=>{try{await ensure();const title=clean(req.body?.title),due=req.body?.due_at;if(!title||!due)return res.status(400).json({error:'Task title and due date are required'});const r=await q(`INSERT INTO crm_tasks(submission_id,title,due_at,assigned_to,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *`,[clean(req.body?.submission_id),title,due,clean(req.body?.assigned_to)||clean(req.user?.name),clean(req.user?.name)||clean(req.user?.username)]);if(r.rows[0].submission_id)await q('UPDATE crm_website_leads SET next_follow_up_at=$2,updated_at=NOW() WHERE submission_id=$1',[r.rows[0].submission_id,due]);res.status(201).json(r.rows[0])}catch(e){res.status(500).json({error:e.message})}});
router.patch('/crm/v1/tasks/:id',...guard,async(req,res)=>{try{await ensure();const s=clean(req.body?.status)||'completed',r=await q(`UPDATE crm_tasks SET status=$2,completed_at=CASE WHEN $2='completed' THEN NOW() ELSE NULL END WHERE id=$1 RETURNING *`,[req.params.id,s]);if(!r.rowCount)return res.status(404).json({error:'Task not found'});res.json(r.rows[0])}catch(e){res.status(500).json({error:e.message})}});

router.post('/crm/v1/leads/:id/email',...guard,async(req,res)=>{try{await ensure();const l=(await q('SELECT first_name,last_name,email FROM crm_website_leads WHERE submission_id=$1',[req.params.id])).rows[0];if(!l?.email)return res.status(400).json({error:'Lead has no email address'});const subject=clean(req.body?.subject),body=clean(req.body?.body);if(!subject||!body)return res.status(400).json({error:'Subject and message are required'});const sent=await email(l.email,subject,body,[l.first_name,l.last_name].filter(Boolean).join(' '));const r=await q(`INSERT INTO crm_email_messages(submission_id,to_email,subject,body,provider_id,status,created_by) VALUES($1,$2,$3,$4,$5,'sent',$6) RETURNING *`,[req.params.id,l.email,subject,body,clean(sent.messageId),clean(req.user?.name)||clean(req.user?.username)]);await q('UPDATE crm_website_leads SET last_contacted_at=NOW(),updated_at=NOW() WHERE submission_id=$1',[req.params.id]);res.status(201).json(r.rows[0])}catch(e){res.status(502).json({error:e.message})}});

router.post('/crm/v1/campaigns/sms/send',...guard,async(req,res)=>{try{await ensure();const ids=Array.isArray(req.body?.submission_ids)?req.body.submission_ids.map(clean).filter(Boolean).slice(0,250):[],tpl=String(req.body?.template||'').trim();if(String(req.body?.confirm||'')!=='SEND')return res.status(400).json({error:'Campaign send requires confirmation'});if(!ids.length||!tpl)return res.status(400).json({error:'Recipients and template are required'});const rows=(await q(`SELECT submission_id,first_name,last_name,phone,product_interest,brand_interest,model_interest FROM crm_website_leads WHERE submission_id=ANY($1::text[])`,[ids])).rows;let sent=0,suppressed=0,failed=0;for(const l of rows){if(!l.phone||await opted(l.phone)){suppressed++;continue}try{const body=merge(tpl,l),m=await sms(l.phone,body);await q(`INSERT INTO crm_sms_messages(twilio_sid,direction,from_number,to_number,body,status,lead_submission_id) VALUES($1,'outbound',$2,$3,$4,$5,$6) ON CONFLICT(twilio_sid) DO NOTHING`,[m.sid,salesNumber(),l.phone,body,m.status||'queued',l.submission_id]);await q('UPDATE crm_website_leads SET last_contacted_at=NOW(),updated_at=NOW() WHERE submission_id=$1',[l.submission_id]);sent++}catch{failed++}}res.json({ok:true,total:rows.length,sent,suppressed,failed})}catch(e){res.status(500).json({error:e.message})}});

router.get('/crm/v1/reports/summary',...guard,async(req,res)=>{try{await ensure();const days=Math.min(365,Math.max(1,Number(req.query.days)||30)),overall=(await q(`SELECT count(*)::int leads,count(*) FILTER(WHERE pipeline_stage='Appointment')::int appointments,count(*) FILTER(WHERE pipeline_stage='Visited Showroom')::int showroom_visits,count(*) FILTER(WHERE pipeline_stage='Quoted')::int quoted,count(*) FILTER(WHERE pipeline_stage='Sold')::int sold,count(*) FILTER(WHERE pipeline_stage='Lost')::int lost FROM crm_website_leads WHERE received_at>=NOW()-($1::text||' days')::interval`,[String(days)])).rows[0];const grp=async col=>(await q('SELECT '+col+' label,count(*)::int leads,count(*) FILTER(WHERE pipeline_stage=\'Sold\')::int sold FROM crm_website_leads WHERE received_at>=NOW()-($1::text||\' days\')::interval GROUP BY '+col+' ORDER BY leads DESC NULLS LAST LIMIT 50',[String(days)])).rows;const [sources,salespeople,products,brands,models]=await Promise.all([grp('source'),grp('assigned_to'),grp('product_interest'),grp('brand_interest'),grp('model_interest')]);res.json({days,overall,sources,salespeople,products,brands,models})}catch(e){res.status(500).json({error:e.message})}});

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

export default router;
