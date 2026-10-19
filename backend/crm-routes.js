import express from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { q } from './service-db.js';

const router=express.Router();
const clean=v=>v==null?null:String(v).trim();
const phoneDigits=v=>String(v||'').replace(/\D/g,'');
function secret(){if(!process.env.SERVICE_JWT_SECRET)throw new Error('SERVICE_JWT_SECRET is required');return process.env.SERVICE_JWT_SECRET}
const twilioNumber=()=>String(process.env.TWILIO_PHONE_NUMBER||'').trim();
const twilioSid=()=>String(process.env.TWILIO_ACCOUNT_SID||'').trim();
const twilioToken=()=>String(process.env.TWILIO_AUTH_TOKEN||'').trim();

async function ensureSmsTable(){
  await q(`CREATE TABLE IF NOT EXISTS crm_sms_messages (
    id BIGSERIAL PRIMARY KEY,
    twilio_sid TEXT UNIQUE,
    direction TEXT NOT NULL,
    from_number TEXT,
    to_number TEXT,
    body TEXT,
    status TEXT,
    lead_submission_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
}
async function ensureLeadInterestFields(){
  await q(`ALTER TABLE crm_website_leads ADD COLUMN IF NOT EXISTS product_interest TEXT;
    ALTER TABLE crm_website_leads ADD COLUMN IF NOT EXISTS brand_interest TEXT;
    ALTER TABLE crm_website_leads ADD COLUMN IF NOT EXISTS model_interest TEXT;
    CREATE INDEX IF NOT EXISTS idx_crm_lead_product_interest ON crm_website_leads(product_interest);
    CREATE INDEX IF NOT EXISTS idx_crm_lead_brand_interest ON crm_website_leads(brand_interest);
    CREATE INDEX IF NOT EXISTS idx_crm_lead_model_interest ON crm_website_leads(model_interest);`);
}

async function ensureCrmWorkspaceTables(){
  await q(`CREATE TABLE IF NOT EXISTS crm_lead_notes(
    id BIGSERIAL PRIMARY KEY,
    submission_id TEXT NOT NULL REFERENCES crm_website_leads(submission_id) ON DELETE CASCADE,
    note_type TEXT NOT NULL DEFAULT 'General',
    body TEXT NOT NULL,
    quoted_price NUMERIC(12,2),
    financing_interest TEXT,
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ALTER TABLE crm_lead_notes ADD COLUMN IF NOT EXISTS note_type TEXT NOT NULL DEFAULT 'General';
  ALTER TABLE crm_lead_notes ADD COLUMN IF NOT EXISTS quoted_price NUMERIC(12,2);
  ALTER TABLE crm_lead_notes ADD COLUMN IF NOT EXISTS financing_interest TEXT;
  CREATE INDEX IF NOT EXISTS idx_crm_lead_notes_submission ON crm_lead_notes(submission_id,created_at DESC);`);
}

function twilioSignatureOk(req){
  const token=twilioToken();
  if(!token)return false;
  const supplied=String(req.get('X-Twilio-Signature')||'');
  const proto=String(req.get('X-Forwarded-Proto')||req.protocol||'https').split(',')[0].trim();
  const host=req.get('host');
  const url=proto+'://'+host+req.originalUrl;
  const params=req.body&&typeof req.body==='object'?req.body:{};
  const payload=Object.keys(params).sort().reduce((s,k)=>s+k+String(params[k]??''),url);
  const expected=crypto.createHmac('sha1',token).update(payload).digest('base64');
  try{return crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(expected))}catch{return false}
}
export async function syncTwilioMessages(days=14,limit=1000){
  const sid=twilioSid(),token=twilioToken(),owned=twilioNumber();
  if(!sid||!token||!owned)throw new Error('Twilio is not fully configured');
  await ensureSmsTable();
  const after=new Date(Date.now()-Math.max(1,Number(days)||14)*86400000).toISOString().slice(0,10);
  let url=`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json?PageSize=1000&DateSent%3E=${encodeURIComponent(after)}`;
  let seen=0,inserted=0;
  while(url && seen<limit){
    const r=await fetch(url,{headers:{Authorization:'Basic '+Buffer.from(sid+':'+token).toString('base64')}});
    const j=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(j.message||`Twilio returned ${r.status}`);
    for(const m of (j.messages||[])){
      if(seen++>=limit)break;
      const from=String(m.from||''),to=String(m.to||'');
      const direction=from===owned?'outbound':(to===owned?'inbound':String(m.direction||'unknown'));
      const peer=direction==='inbound'?from:to,digits=phoneDigits(peer);
      const lead=(await q("SELECT submission_id FROM crm_website_leads WHERE deleted_at IS NULL AND regexp_replace(coalesce(phone,''),'\\D','','g')=$1 ORDER BY received_at DESC LIMIT 1",[digits])).rows[0];
      const rs=await q(`INSERT INTO crm_sms_messages(twilio_sid,direction,from_number,to_number,body,status,created_at,lead_submission_id)
        VALUES($1,$2,$3,$4,$5,$6,COALESCE($7::timestamptz,NOW()),$8)
        ON CONFLICT (twilio_sid) DO UPDATE SET lead_submission_id=COALESCE(crm_sms_messages.lead_submission_id,EXCLUDED.lead_submission_id) RETURNING id`,
        [String(m.sid||''),direction,from,to,String(m.body||''),String(m.status||''),m.date_sent||m.date_created||null,lead?.submission_id||null]);
      if(lead?.submission_id&&direction==='inbound')await q("UPDATE crm_website_leads SET last_activity_at=GREATEST(COALESCE(last_activity_at,NOW()),COALESCE($2::timestamptz,NOW())),updated_at=NOW() WHERE submission_id=$1",[lead.submission_id,m.date_sent||m.date_created||null]).catch(()=>{});
      if(rs.rowCount)inserted++;
    }
    const next=j.next_page_uri;
    url=next?('https://api.twilio.com'+next):'';
  }
  return{seen,inserted,days};
}

async function sendTwilioSms(to,body){
  const sid=twilioSid(),token=twilioToken(),from=twilioNumber();
  if(!sid||!token||!from)throw new Error('Twilio is not fully configured');
  const form=new URLSearchParams({To:String(to),From:from,Body:String(body)});
  const r=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,{
    method:'POST',
    headers:{Authorization:'Basic '+Buffer.from(sid+':'+token).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},
    body:form
  });
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j.message||`Twilio returned ${r.status}`);
  return j;
}
function auth(req,res,next){
  try{
    const raw=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
    if(!raw)return res.status(401).json({error:'Login required'});
    req.user=jwt.verify(raw,secret());next();
  }catch{res.status(401).json({error:'Session expired or invalid'})}
}



router.post('/crm/twilio/sync',auth,async(req,res)=>{
  try{res.json({ok:true,...await syncTwilioMessages(req.body?.days||14,req.body?.limit||1000)})}
  catch(e){res.status(502).json({error:e.message})}
});

router.get('/crm/twilio/campaign-count',auth,async(req,res)=>{
  try{
    await syncTwilioMessages(req.query?.days||14,1000);
    const phrase=clean(req.query?.phrase)||'Take our hot tub quiz and earn $500 or $1000 off your hot tub purchase!';
    const rows=(await q(`SELECT count(*)::int count, min(created_at) first_sent, max(created_at) last_sent
      FROM crm_sms_messages WHERE direction='outbound' AND body ILIKE $1`,['%'+phrase+'%'])).rows[0];
    const samples=(await q(`SELECT to_number,body,status,created_at FROM crm_sms_messages
      WHERE direction='outbound' AND body ILIKE $1 ORDER BY created_at DESC LIMIT 10`,['%'+phrase+'%'])).rows;
    res.json({phrase,...rows,samples});
  }catch(e){res.status(500).json({error:e.message})}
});

router.get('/crm/telephony',auth,async(req,res)=>{
  res.json({
    provider:'Twilio',
    phone_number:twilioNumber()||null,
    account_configured:Boolean(twilioSid()),
    sms_ready:Boolean(twilioNumber()&&twilioSid()&&twilioToken())
  });
});

router.post('/crm/sms/send',auth,async(req,res)=>{
  try{
    const to=clean(req.body?.to),body=clean(req.body?.body),leadSubmissionId=clean(req.body?.lead_submission_id);
    if(!to||!body)return res.status(400).json({error:'to and body are required'});
    await ensureSmsTable();
    const msg=await sendTwilioSms(to,body);
    await q(`INSERT INTO crm_sms_messages(twilio_sid,direction,from_number,to_number,body,status,lead_submission_id)
      VALUES($1,'outbound',$2,$3,$4,$5,$6)
      ON CONFLICT (twilio_sid) DO NOTHING`,[msg.sid,twilioNumber(),to,body,msg.status||'queued',leadSubmissionId]);
    res.json({ok:true,sid:msg.sid,status:msg.status||'queued'});
  }catch(e){res.status(502).json({error:e.message})}
});

router.post('/crm/twilio/incoming',async(req,res)=>{
  try{
    if(!twilioSignatureOk(req))return res.status(403).send('Invalid Twilio signature');
    await ensureSmsTable();
    const b=req.body||{};
    const from=clean(b.From),to=clean(b.To),body=clean(b.Body),digits=phoneDigits(from);
    const lead=(await q("SELECT submission_id FROM crm_website_leads WHERE deleted_at IS NULL AND regexp_replace(coalesce(phone,''),'\\D','','g')=$1 ORDER BY received_at DESC LIMIT 1",[digits])).rows[0];
    await q(`INSERT INTO crm_sms_messages(twilio_sid,direction,from_number,to_number,body,status,lead_submission_id)
      VALUES($1,'inbound',$2,$3,$4,$5,$6)
      ON CONFLICT (twilio_sid) DO UPDATE SET lead_submission_id=COALESCE(crm_sms_messages.lead_submission_id,EXCLUDED.lead_submission_id)`,[clean(b.MessageSid),from,to,body,clean(b.SmsStatus)||'received',lead?.submission_id||null]);
    if(lead?.submission_id)await q("UPDATE crm_website_leads SET last_activity_at=NOW(),pipeline_stage=CASE WHEN pipeline_stage IN ('New Lead','Attempted Contact') THEN 'Two Way Conversation' ELSE pipeline_stage END,updated_at=NOW() WHERE submission_id=$1",[lead.submission_id]);
    res.type('text/xml').send('<Response></Response>');
  }catch(e){res.status(500).send('SMS ingest failed')}
});

router.get('/crm/sms',auth,async(req,res)=>{
  try{
    await ensureSmsTable();
    const phone=clean(req.query.phone);
    const params=[];let where='';
    if(phone){params.push(phone);where='WHERE from_number=$1 OR to_number=$1'}
    const rows=(await q(`SELECT id,twilio_sid,direction,from_number,to_number,body,status,lead_submission_id,created_at
      FROM crm_sms_messages ${where} ORDER BY created_at DESC LIMIT 250`,params)).rows;
    res.json(rows);
  }catch(e){res.status(500).json({error:e.message})}
});


router.post('/crm/shadow/inbound',async(req,res)=>{
  try{
    const secret=String(process.env.CRM_SHADOW_WEBHOOK_SECRET||'').trim();
    const supplied=String(req.get('x-htfo-shadow-secret')||req.query?.secret||'').trim();
    if(!secret||supplied!==secret)return res.status(403).json({error:'Forbidden'});
    await ensureSmsTable();
    const b=req.body||{};
    const from=clean(b.from||b.phone||b.contact_phone||b.contact?.phone);
    const to=clean(b.to||twilioNumber());
    const body=clean(b.body||b.message||b.text||b.message_body);
    const externalId=clean(b.message_id||b.id||b.external_id||b.conversation_message_id);
    const status=clean(b.status)||'shadow';
    if(!from||!body)return res.status(400).json({error:'from and body are required'});
    const shadowSid=externalId?('shadow:'+externalId):('shadow:'+crypto.createHash('sha256').update([from,to,body].join('|')).digest('hex').slice(0,48));
    const digits=phoneDigits(from);
    const lead=(await q("SELECT submission_id FROM crm_website_leads WHERE deleted_at IS NULL AND regexp_replace(coalesce(phone,''),'\\D','','g')=$1 ORDER BY received_at DESC LIMIT 1",[digits])).rows[0];
    await q(`INSERT INTO crm_sms_messages(twilio_sid,direction,from_number,to_number,body,status,lead_submission_id)
      VALUES($1,'inbound-shadow',$2,$3,$4,$5,$6)
      ON CONFLICT (twilio_sid) DO UPDATE SET lead_submission_id=COALESCE(crm_sms_messages.lead_submission_id,EXCLUDED.lead_submission_id)`,[shadowSid,from,to,body,status,lead?.submission_id||null]);
    if(lead?.submission_id)await q("UPDATE crm_website_leads SET last_activity_at=NOW(),pipeline_stage=CASE WHEN pipeline_stage IN ('New Lead','Attempted Contact') THEN 'Two Way Conversation' ELSE pipeline_stage END,updated_at=NOW() WHERE submission_id=$1",[lead.submission_id]);
    res.json({ok:true,id:shadowSid,matched:Boolean(lead?.submission_id)});
  }catch(e){res.status(500).json({error:e.message})}
});


router.get('/crm/audit/recent-leads',async(req,res)=>{
  try{
    const secret=String(process.env.CRM_SHADOW_WEBHOOK_SECRET||'').trim();
    const supplied=String(req.get('x-htfo-shadow-secret')||req.query?.secret||'').trim();
    if(!secret||supplied!==secret)return res.status(403).json({error:'Forbidden'});
    const limit=Math.min(100,Math.max(1,Number(req.query?.limit)||50));
    const rows=(await q(`SELECT submission_id,first_name,last_name,email,phone,source,tags,pipeline_stage,
      ghl_contact_status,ghl_contact_id,ghl_opportunity_status,ghl_opportunity_id,received_at,updated_at
      FROM crm_website_leads ORDER BY received_at DESC LIMIT $1`,[limit])).rows;
    res.json(rows);
  }catch(e){res.status(500).json({error:e.message})}
});

router.get('/crm/dashboard',auth,async(req,res)=>{
  await ensureLeadInterestFields();
  const [totals,stages,sources,delivery]=await Promise.all([
    q(`SELECT count(*)::int total,
      count(*) FILTER (WHERE received_at>=NOW()-INTERVAL '24 hours')::int last_24_hours,
      count(*) FILTER (WHERE received_at>=NOW()-INTERVAL '7 days')::int last_7_days,
      count(*) FILTER (WHERE pipeline_stage NOT IN ('Won','Lost'))::int open
      FROM crm_website_leads`),
    q(`SELECT pipeline_stage,count(*)::int count FROM crm_website_leads GROUP BY pipeline_stage ORDER BY count DESC`),
    q(`SELECT source,count(*)::int count FROM crm_website_leads GROUP BY source ORDER BY count DESC LIMIT 10`),
    q(`SELECT
      count(*) FILTER (WHERE ghl_contact_status='failed')::int contact_failures,
      count(*) FILTER (WHERE ghl_opportunity_status='failed')::int opportunity_failures,
      count(*) FILTER (WHERE ghl_contact_status='sent')::int contacts_sent,
      count(*) FILTER (WHERE ghl_opportunity_status='sent')::int opportunities_sent
      FROM crm_website_leads`)
  ]);
  res.json({totals:totals.rows[0],stages:stages.rows,sources:sources.rows,delivery:delivery.rows[0]});
});

router.get('/crm/leads',auth,async(req,res)=>{
  await ensureLeadInterestFields();
  const term=clean(req.query.q)||'',stage=clean(req.query.stage),product=clean(req.query.product),brand=clean(req.query.brand),model=clean(req.query.model),limit=Math.min(1000,Math.max(1,Number(req.query.limit)||250));
  const params=[`%${term}%`];let where=`WHERE concat_ws(' ',first_name,last_name,email,phone,source,note,product_interest,brand_interest,model_interest,tags::text,payload::text) ILIKE $1`;
  if(stage){params.push(stage);where+=` AND pipeline_stage=${params.length}`}
  if(product){params.push(product);where+=` AND lower(coalesce(product_interest,''))=lower(${params.length})`}
  if(brand){params.push(`%${brand}%`);where+=` AND coalesce(brand_interest,'') ILIKE ${params.length}`}
  if(model){params.push(`%${model}%`);where+=` AND coalesce(model_interest,'') ILIKE ${params.length}`}
  params.push(limit);
  const rows=(await q(`SELECT submission_id,first_name,last_name,email,phone,source,tags,note,payload,product_interest,brand_interest,model_interest,lifecycle_stage,pipeline_stage,
      ghl_contact_status,ghl_contact_id,ghl_contact_error,ghl_opportunity_status,ghl_opportunity_id,ghl_opportunity_error,received_at,updated_at
    FROM crm_website_leads ${where} ORDER BY received_at DESC LIMIT $${params.length}`,params)).rows;
  res.json(rows);
});

router.get('/crm/leads/:submissionId/detail',auth,async(req,res)=>{
  try{
    await Promise.all([ensureSmsTable(),ensureCrmWorkspaceTables(),ensureLeadInterestFields()]);
    const lead=(await q(`SELECT submission_id,first_name,last_name,email,phone,source,tags,note,payload,product_interest,brand_interest,model_interest,lifecycle_stage,pipeline_stage,
      ghl_contact_status,ghl_contact_id,ghl_contact_error,ghl_opportunity_status,ghl_opportunity_id,ghl_opportunity_error,received_at,updated_at
      FROM crm_website_leads WHERE submission_id=$1`,[req.params.submissionId])).rows[0];
    if(!lead)return res.status(404).json({error:'Lead not found'});
    const [notes,sms]=await Promise.all([
      q('SELECT id,note_type,body,quoted_price,financing_interest,created_by,created_at FROM crm_lead_notes WHERE submission_id=$1 ORDER BY created_at DESC',[req.params.submissionId]),
      lead.phone?q(`SELECT id,twilio_sid,direction,from_number,to_number,body,status,created_at FROM crm_sms_messages
        WHERE from_number=$1 OR to_number=$1 OR lead_submission_id=$2 ORDER BY created_at DESC LIMIT 500`,[lead.phone,req.params.submissionId]):Promise.resolve({rows:[]})
    ]);
    res.json({lead,notes:notes.rows,sms:sms.rows});
  }catch(e){res.status(500).json({error:e.message})}
});

router.post('/crm/leads/:submissionId/notes',auth,async(req,res)=>{
  try{
    await ensureCrmWorkspaceTables();
    const body=clean(req.body?.body),noteType=clean(req.body?.note_type)||'General',financingInterest=clean(req.body?.financing_interest);
    const quotedPrice=req.body?.quoted_price==null||req.body?.quoted_price===''?null:Number(req.body.quoted_price);
    if(!body)return res.status(400).json({error:'Note is required'});
    if(quotedPrice!=null&&(!Number.isFinite(quotedPrice)||quotedPrice<0))return res.status(400).json({error:'Quoted price must be a valid positive amount'});
    const exists=(await q('SELECT 1 FROM crm_website_leads WHERE submission_id=$1',[req.params.submissionId])).rowCount;
    if(!exists)return res.status(404).json({error:'Lead not found'});
    const row=(await q(`INSERT INTO crm_lead_notes(submission_id,note_type,body,quoted_price,financing_interest,created_by)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING id,note_type,body,quoted_price,financing_interest,created_by,created_at`,
      [req.params.submissionId,noteType,body,quotedPrice,financingInterest,req.user?.name||req.user?.username||'staff'])).rows[0];
    res.status(201).json(row);
  }catch(e){res.status(500).json({error:e.message})}
});

router.post('/crm/campaigns/sms/preview',auth,async(req,res)=>{
  try{
    await Promise.all([ensureLeadInterestFields(),ensureSmsTable()]);
    const ids=Array.isArray(req.body?.submission_ids)?req.body.submission_ids.map(clean).filter(Boolean).slice(0,500):[];
    const template=String(req.body?.template||'').trim();
    if(!ids.length||!template)return res.status(400).json({error:'Recipients and template are required'});
    const rows=(await q(`SELECT submission_id,first_name,last_name,phone,product_interest,brand_interest,model_interest
      FROM crm_website_leads WHERE submission_id=ANY($1::text[])`,[ids])).rows;
    const normalized=p=>String(p||'').replace(/\D/g,'');
    const out=[];
    for(const r of rows){
      const phone=clean(r.phone),digits=normalized(phone);
      let suppressed=false;
      if(phone){
        const stop=(await q(`SELECT 1 FROM crm_sms_messages
          WHERE regexp_replace(from_number,'\\D','','g')=$1
            AND direction IN ('inbound','inbound-shadow')
            AND upper(trim(body)) IN ('STOP','STOPALL','UNSUBSCRIBE','CANCEL','END','QUIT')
          LIMIT 1`,[digits])).rowCount>0;
        suppressed=stop;
      }
      const body=template
        .replaceAll('{Name}',clean(r.first_name)||'there')
        .replaceAll('{FirstName}',clean(r.first_name)||'there')
        .replaceAll('{Brand}',clean(r.brand_interest)||'')
        .replaceAll('{Model}',clean(r.model_interest)||'')
        .replaceAll('{Product}',clean(r.product_interest)||'');
      out.push({submission_id:r.submission_id,name:[r.first_name,r.last_name].filter(Boolean).join(' '),phone,body,suppressed,reason:suppressed?'Previously opted out by SMS':(!phone?'No phone number':null)});
    }
    res.json({total:out.length,sendable:out.filter(x=>x.phone&&!x.suppressed).length,suppressed:out.filter(x=>x.suppressed||!x.phone).length,recipients:out});
  }catch(e){res.status(500).json({error:e.message})}
});

router.patch('/crm/leads/:submissionId/interest',auth,async(req,res)=>{
  try{
    await ensureLeadInterestFields();
    const allowedProducts=new Set(['Hot Tub','Swim Spa','Pool','Sauna','Outdoor Kitchen']);
    const product=clean(req.body?.product_interest),brand=clean(req.body?.brand_interest),model=clean(req.body?.model_interest);
    if(product&&!allowedProducts.has(product))return res.status(400).json({error:'Invalid product interest'});
    const row=(await q(`UPDATE crm_website_leads
      SET product_interest=$2,brand_interest=$3,model_interest=$4,updated_at=NOW()
      WHERE submission_id=$1
      RETURNING submission_id,product_interest,brand_interest,model_interest,updated_at`,
      [req.params.submissionId,product||null,brand||null,model||null])).rows[0];
    if(!row)return res.status(404).json({error:'Lead not found'});
    res.json(row);
  }catch(e){res.status(500).json({error:e.message})}
});

router.patch('/crm/leads/:submissionId',auth,async(req,res)=>{
  const stage=clean(req.body?.pipeline_stage),allowed=new Set(['New Lead','Attempted Contact','Two Way Conversation','Appointment Set','Showroom Visit','Quoted','Won','Lost']);
  if(!allowed.has(stage))return res.status(400).json({error:'Invalid pipeline stage'});
  const row=(await q(`UPDATE crm_website_leads SET pipeline_stage=$2,lifecycle_stage=CASE WHEN $2='Won' THEN 'Customer' WHEN $2='Lost' THEN 'Past Prospect' ELSE 'Prospect' END,updated_at=NOW() WHERE submission_id=$1 RETURNING *`,[req.params.submissionId,stage])).rows[0];
  if(!row)return res.status(404).json({error:'Lead not found'});
  res.json(row);
});

export default router;
