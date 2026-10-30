import express from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { q } from './service-db.js';

const router=express.Router();
const clean=v=>v==null?null:String(v).trim();
const digits=v=>String(v||'').replace(/\D/g,'');
const sid=()=>String(process.env.TWILIO_ACCOUNT_SID||'').trim();
const token=()=>String(process.env.TWILIO_AUTH_TOKEN||'').trim();
const serviceNumber=()=>String(process.env.TWILIO_SERVICE_PHONE_NUMBER||'').trim();
const managerPhone=()=>String(process.env.SERVICE_MANAGER_SMS_TO||process.env.SERVICE_MANAGER_PHONE||'').trim();
const jwtSecret=()=>{if(!process.env.SERVICE_JWT_SECRET)throw new Error('SERVICE_JWT_SECRET is required');return process.env.SERVICE_JWT_SECRET};
function auth(req,res,next){try{const raw=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');if(!raw)return res.status(401).json({error:'Login required'});req.user=jwt.verify(raw,jwtSecret());next()}catch{return res.status(401).json({error:'Session expired or invalid'})}}
function manager(req,res,next){if(!['admin','owner','manager','service_manager'].includes(String(req.user?.role||'').toLowerCase()))return res.status(403).json({error:'Manager permission required'});next()}
async function ensure(){
  await q(`CREATE TABLE IF NOT EXISTS service_customer_messages(
    id BIGSERIAL PRIMARY KEY,
    customer_id BIGINT REFERENCES service_customers(id) ON DELETE SET NULL,
    twilio_sid TEXT NOT NULL UNIQUE,
    direction TEXT NOT NULL,
    from_number TEXT,
    to_number TEXT,
    body TEXT,
    status TEXT,
    media JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await q('ALTER TABLE service_customer_messages ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ');
  await q('ALTER TABLE service_customer_messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ');
  await q('ALTER TABLE service_customer_messages ADD COLUMN IF NOT EXISTS sent_by TEXT');
  await q('CREATE INDEX IF NOT EXISTS idx_service_customer_messages_customer ON service_customer_messages(customer_id,created_at)');
  await q("CREATE INDEX IF NOT EXISTS idx_service_customer_messages_unread ON service_customer_messages(customer_id,created_at) WHERE direction='inbound' AND read_at IS NULL");
  await q(`CREATE TABLE IF NOT EXISTS service_message_alert_settings(
    id INT PRIMARY KEY DEFAULT 1 CHECK(id=1),
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    primary_name TEXT NOT NULL DEFAULT 'Rick',
    primary_phone TEXT,
    backup_name TEXT NOT NULL DEFAULT 'Ray',
    backup_phone TEXT,
    route_to_backup BOOLEAN NOT NULL DEFAULT FALSE,
    quiet_start TIME NOT NULL DEFAULT '20:00',
    quiet_end TIME NOT NULL DEFAULT '08:00',
    timezone TEXT NOT NULL DEFAULT 'America/New_York',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by TEXT
  )`);
  await q(`INSERT INTO service_message_alert_settings(id,enabled,primary_phone)
    VALUES(1,$1,$2)
    ON CONFLICT(id) DO NOTHING`,[Boolean(managerPhone()),managerPhone()||null]);
}
async function alertSettings(){
  await ensure();
  return (await q('SELECT * FROM service_message_alert_settings WHERE id=1')).rows[0];
}
function localMinutes(timeZone='America/New_York'){
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  return Number(p.hour||0)*60+Number(p.minute||0);
}
function hmMinutes(v){const m=String(v||'').match(/^(\d{1,2}):(\d{2})/);return m?Number(m[1])*60+Number(m[2]):0}
function inQuietHours(settings){
  const now=localMinutes(settings.timezone||'America/New_York'),start=hmMinutes(settings.quiet_start),end=hmMinutes(settings.quiet_end);
  if(start===end)return false;
  return start<end?(now>=start&&now<end):(now>=start||now<end);
}
async function sendAlertSms(to,body){
  if(!to||!serviceNumber()||!sid()||!token())return false;
  const form=new URLSearchParams({To:to,From:serviceNumber(),Body:String(body||'').slice(0,1200)});
  try{await twilioJson(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid())}/Messages.json`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form});return true}catch{return false}
}
async function notifyUnnotifiedInbound(){
  const settings=await alertSettings();
  if(!settings?.enabled||inQuietHours(settings))return 0;
  const to=settings.route_to_backup?settings.backup_phone:settings.primary_phone;
  const name=settings.route_to_backup?(settings.backup_name||'backup'):(settings.primary_name||'primary');
  if(!to)return 0;
  const rows=(await q("SELECT * FROM service_customer_messages WHERE direction='inbound' AND notified_at IS NULL AND read_at IS NULL ORDER BY created_at ASC LIMIT 100")).rows;
  if(!rows.length)return 0;
  let body='New service text in HTFO Operations CRM.';
  if(rows.length>1)body=`${rows.length} unread service texts are waiting in HTFO Operations CRM.`;
  const ok=await sendAlertSms(to,body);
  if(!ok)return 0;
  await q("UPDATE service_customer_messages SET notified_at=NOW(),updated_at=NOW() WHERE id = ANY($1::bigint[])",[rows.map(x=>x.id)]);
  return rows.length;
}

async function twilioJson(url,opts={}){
  const r=await fetch(url,{...opts,headers:{Authorization:'Basic '+Buffer.from(sid()+':'+token()).toString('base64'),...(opts.headers||{})}});
  const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.message||('Twilio returned '+r.status));return j;
}
async function customerForPhone(phone){const d=digits(phone);if(!d)return null;return (await q("SELECT id FROM service_customers WHERE regexp_replace(coalesce(phone,''),'\\D','','g')=$1 ORDER BY id DESC LIMIT 1",[d])).rows[0]||null}
async function mediaForMessage(messageSid){
  try{const j=await twilioJson(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid())}/Messages/${encodeURIComponent(messageSid)}/Media.json?PageSize=50`);return (j.media_list||[]).map(m=>({sid:m.sid,content_type:m.content_type||null,date_created:m.date_created||null}))}catch{return []}
}
export async function syncServiceTwilioMessages(days=7,limit=500){
  if(!sid()||!token()||!serviceNumber())return{skipped:true,reason:'Service Twilio number not configured'};
  await ensure();const after=new Date(Date.now()-Math.max(1,Number(days)||7)*86400000).toISOString().slice(0,10);let url=`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid())}/Messages.json?PageSize=1000&DateSent%3E=${encodeURIComponent(after)}`,seen=0,upserted=0;
  while(url&&seen<limit){const j=await twilioJson(url);for(const m of (j.messages||[])){if(seen++>=limit)break;const from=String(m.from||''),to=String(m.to||''),owned=serviceNumber();if(from!==owned&&to!==owned)continue;const direction=to===owned?'inbound':'outbound',peer=direction==='inbound'?from:to,cust=await customerForPhone(peer),media=Number(m.num_media||0)>0?await mediaForMessage(String(m.sid||'')):[];
    await q(`INSERT INTO service_customer_messages(customer_id,twilio_sid,direction,from_number,to_number,body,status,media,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,COALESCE($9::timestamptz,NOW())) ON CONFLICT(twilio_sid) DO UPDATE SET customer_id=COALESCE(service_customer_messages.customer_id,EXCLUDED.customer_id),status=EXCLUDED.status,body=EXCLUDED.body,media=CASE WHEN EXCLUDED.media='[]'::jsonb THEN service_customer_messages.media ELSE EXCLUDED.media END,updated_at=NOW()`,[cust?.id||null,String(m.sid||''),direction,from,to,String(m.body||''),String(m.status||''),JSON.stringify(media),m.date_sent||m.date_created||null]);upserted++;
  }url=j.next_page_uri?('https://api.twilio.com'+j.next_page_uri):''}
  await notifyUnnotifiedInbound().catch(()=>{});
  return{seen,upserted,days};
}
function signatureOk(req){const t=token();if(!t)return false;const supplied=String(req.get('X-Twilio-Signature')||'');const proto=String(req.get('X-Forwarded-Proto')||req.protocol||'https').split(',')[0].trim(),host=req.get('host'),url=proto+'://'+host+req.originalUrl,params=req.body&&typeof req.body==='object'?req.body:{};const payload=Object.keys(params).sort().reduce((s,k)=>s+k+String(params[k]??''),url),expected=crypto.createHmac('sha1',t).update(payload).digest('base64');try{return crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(expected))}catch{return false}}

router.post('/service-messaging/twilio/incoming',async(req,res)=>{try{if(!signatureOk(req))return res.status(403).send('Invalid Twilio signature');await ensure();const b=req.body||{},from=clean(b.From),to=clean(b.To),messageSid=clean(b.MessageSid),cust=await customerForPhone(from);const media=[];for(let i=0;i<Number(b.NumMedia||0);i++){const url=clean(b['MediaUrl'+i]),ct=clean(b['MediaContentType'+i]),ms=url?url.split('/').pop():null;if(ms)media.push({sid:ms,content_type:ct})}await q(`INSERT INTO service_customer_messages(customer_id,twilio_sid,direction,from_number,to_number,body,status,media) VALUES($1,$2,'inbound',$3,$4,$5,$6,$7::jsonb) ON CONFLICT(twilio_sid) DO UPDATE SET customer_id=COALESCE(service_customer_messages.customer_id,EXCLUDED.customer_id),body=EXCLUDED.body,media=EXCLUDED.media,status=EXCLUDED.status,updated_at=NOW()`,[cust?.id||null,messageSid,from,to,clean(b.Body),clean(b.SmsStatus)||'received',JSON.stringify(media)]);await notifyUnnotifiedInbound().catch(()=>{});res.type('text/xml').send('<Response></Response>')}catch(e){res.status(500).send('Service message ingest failed')}});

router.get('/customers/:id/messages',auth,async(req,res)=>{try{await ensure();await syncServiceTwilioMessages(14,500).catch(()=>{});const rows=(await q('SELECT id,twilio_sid,direction,from_number,to_number,body,status,media,read_at,sent_by,created_at FROM service_customer_messages WHERE customer_id=$1 ORDER BY created_at ASC LIMIT 1000',[req.params.id])).rows;res.json({service_number:serviceNumber()||null,messages:rows})}catch(e){res.status(500).json({error:e.message})}});

router.post('/customers/:id/messages',auth,async(req,res)=>{try{await ensure();if(!serviceNumber())return res.status(503).json({error:'Service texting number is not configured yet'});const customer=(await q('SELECT id,first_name,last_name,phone FROM service_customers WHERE id=$1',[req.params.id])).rows[0];if(!customer?.phone)return res.status(400).json({error:'Customer has no phone number'});const body=String(req.body?.body||'').trim();if(!body)return res.status(400).json({error:'Message is required'});const form=new URLSearchParams({To:customer.phone,From:serviceNumber(),Body:body});const j=await twilioJson(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid())}/Messages.json`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form});await q(`INSERT INTO service_customer_messages(customer_id,twilio_sid,direction,from_number,to_number,body,status,sent_by) VALUES($1,$2,'outbound',$3,$4,$5,$6,$7) ON CONFLICT(twilio_sid) DO NOTHING`,[customer.id,j.sid,serviceNumber(),customer.phone,body,j.status||'queued',req.user?.name||req.user?.username||'HTFO Staff']);res.json({ok:true,sid:j.sid,status:j.status||'queued'})}catch(e){res.status(502).json({error:e.message})}});

router.get('/service-messaging/alert-settings',auth,manager,async(req,res)=>{try{
  const s=await alertSettings();
  res.json({
    enabled:Boolean(s.enabled),
    primary_name:s.primary_name||'Rick',
    primary_phone:s.primary_phone||'',
    backup_name:s.backup_name||'Ray',
    backup_phone:s.backup_phone||'',
    route_to_backup:Boolean(s.route_to_backup),
    quiet_start:String(s.quiet_start||'20:00').slice(0,5),
    quiet_end:String(s.quiet_end||'08:00').slice(0,5),
    timezone:s.timezone||'America/New_York'
  });
}catch(e){res.status(500).json({error:e.message})}});

router.patch('/service-messaging/alert-settings',auth,manager,async(req,res)=>{try{
  await ensure();const b=req.body||{};
  const phone=v=>{const d=digits(v);return d?('+'+(d.length===10?'1'+d:d)):null};
  const primaryPhone=phone(b.primary_phone),backupPhone=phone(b.backup_phone);
  const quietStart=/^\d{2}:\d{2}$/.test(String(b.quiet_start||''))?b.quiet_start:'20:00';
  const quietEnd=/^\d{2}:\d{2}$/.test(String(b.quiet_end||''))?b.quiet_end:'08:00';
  const row=(await q(`UPDATE service_message_alert_settings SET
    enabled=$1,primary_name=$2,primary_phone=$3,backup_name=$4,backup_phone=$5,
    route_to_backup=$6,quiet_start=$7::time,quiet_end=$8::time,updated_at=NOW(),updated_by=$9
    WHERE id=1 RETURNING *`,[
      Boolean(b.enabled),clean(b.primary_name)||'Rick',primaryPhone,clean(b.backup_name)||'Ray',backupPhone,
      Boolean(b.route_to_backup),quietStart,quietEnd,req.user?.name||req.user?.username||'Manager'
    ])).rows[0];
  res.json({ok:true,settings:row});
}catch(e){res.status(400).json({error:e.message})}});

router.post('/service-messaging/alert-settings/test',auth,manager,async(req,res)=>{try{
  const s=await alertSettings(),to=s.route_to_backup?s.backup_phone:s.primary_phone;
  if(!to)return res.status(400).json({error:'No alert phone number is configured for the active recipient'});
  const ok=await sendAlertSms(to,'HTFO Operations CRM test alert. Service-text notifications are configured.');
  if(!ok)return res.status(502).json({error:'Twilio could not send the test alert'});
  res.json({ok:true});
}catch(e){res.status(500).json({error:e.message})}});

router.get('/service-messaging/inbox',auth,async(req,res)=>{try{
  await ensure();
  await syncServiceTwilioMessages(14,500).catch(()=>{});
  const rows=(await q(`
    WITH ranked AS (
      SELECT m.*,
        ROW_NUMBER() OVER(PARTITION BY m.customer_id ORDER BY m.created_at DESC,m.id DESC) rn
      FROM service_customer_messages m
      WHERE m.customer_id IS NOT NULL
    ),
    unread AS (
      SELECT customer_id,COUNT(*)::int unread_count
      FROM service_customer_messages
      WHERE customer_id IS NOT NULL AND direction='inbound' AND read_at IS NULL
      GROUP BY customer_id
    )
    SELECT r.customer_id,
      concat_ws(' ',c.first_name,c.last_name) customer_name,
      c.phone,
      r.body latest_body,
      r.direction latest_direction,
      r.created_at latest_at,
      r.status latest_status,
      COALESCE(u.unread_count,0)::int unread_count
    FROM ranked r
    JOIN service_customers c ON c.id=r.customer_id
    LEFT JOIN unread u ON u.customer_id=r.customer_id
    WHERE r.rn=1
    ORDER BY CASE WHEN COALESCE(u.unread_count,0)>0 THEN 0 ELSE 1 END,
             r.created_at DESC
    LIMIT 200
  `)).rows;
  const unreadTotal=rows.reduce((n,row)=>n+Number(row.unread_count||0),0);
  res.json({unread_total:unreadTotal,threads:rows});
}catch(e){res.status(500).json({error:e.message})}});

router.post('/customers/:id/messages/read',auth,async(req,res)=>{try{
  await ensure();
  const r=await q("UPDATE service_customer_messages SET read_at=COALESCE(read_at,NOW()),updated_at=NOW() WHERE customer_id=$1 AND direction='inbound' AND read_at IS NULL",[req.params.id]);
  res.json({ok:true,marked_read:r.rowCount||0});
}catch(e){res.status(500).json({error:e.message})}});

router.get('/customers/:id/messages/media/:messageSid/:mediaSid',auth,async(req,res)=>{try{await ensure();const hit=(await q(`SELECT 1 FROM service_customer_messages WHERE customer_id=$1 AND twilio_sid=$2 AND media @> $3::jsonb LIMIT 1`,[req.params.id,req.params.messageSid,JSON.stringify([{sid:req.params.mediaSid}])])).rowCount;if(!hit)return res.status(404).send('Media not found');const r=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid())}/Messages/${encodeURIComponent(req.params.messageSid)}/Media/${encodeURIComponent(req.params.mediaSid)}`,{headers:{Authorization:'Basic '+Buffer.from(sid()+':'+token()).toString('base64')}});if(!r.ok)return res.status(r.status).send('Unable to load media');res.setHeader('Content-Type',r.headers.get('content-type')||'application/octet-stream');const buf=Buffer.from(await r.arrayBuffer());res.send(buf)}catch(e){res.status(500).send('Unable to load media')}});

router.get('/service-messaging/unmatched',auth,async(req,res)=>{try{await ensure();await syncServiceTwilioMessages(14,500).catch(()=>{});res.json((await q("SELECT id,twilio_sid,from_number,to_number,body,status,media,created_at FROM service_customer_messages WHERE customer_id IS NULL AND direction='inbound' ORDER BY created_at DESC LIMIT 100")).rows)}catch(e){res.status(500).json({error:e.message})}});

export default router;