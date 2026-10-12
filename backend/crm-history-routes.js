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

async function ensure(){
  await q("ALTER TABLE crm_website_leads ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ");
  await q("CREATE TABLE IF NOT EXISTS crm_highlevel_events(id BIGSERIAL PRIMARY KEY,external_id TEXT NOT NULL UNIQUE,submission_id TEXT REFERENCES crm_website_leads(submission_id) ON DELETE CASCADE,ghl_contact_id TEXT,ghl_conversation_id TEXT,event_type TEXT NOT NULL,direction TEXT,subject TEXT,body TEXT,author TEXT,status TEXT,occurred_at TIMESTAMPTZ NOT NULL,raw JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await q("CREATE INDEX IF NOT EXISTS idx_crm_hl_events_submission ON crm_highlevel_events(submission_id,occurred_at DESC)");
}
async function source(path,params={}){
  const base=String(process.env.CRM_IMPORT_SOURCE_URL||'').trim(),token=String(process.env.CRM_IMPORT_SECRET||'').trim();
  if(!base||!token)throw new Error('HighLevel migration source is not configured');
  const u=new URL(path,new URL(base).origin);
  for(const [k,v] of Object.entries(params))if(v!==''&&v!=null)u.searchParams.set(k,String(v));
  const r=await fetch(u,{headers:{'x-htfo-import-secret':token,Accept:'application/json'}});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j.message||j.error||('Migration source returned '+r.status));
  return j;
}
function msDate(v){if(v==null)return null;if(typeof v==='object'&&v.seconds)return new Date(Number(v.seconds)*1000).toISOString();const n=Number(v);if(Number.isFinite(n)&&n>100000000000)return new Date(n).toISOString();if(Number.isFinite(n)&&n>1000000000)return new Date(n*1000).toISOString();const d=new Date(v);return isNaN(d)?null:d.toISOString()}
const stopWords=new Set(['STOP','STOPALL','UNSUBSCRIBE','CANCEL','END','QUIT']);
const isStop=(direction,body)=>String(direction||'').toLowerCase().includes('inbound')&&stopWords.has(String(body||'').trim().toUpperCase());

router.post('/crm/v1/sync/highlevel-activity',...guard,async(req,res)=>{
  try{
    if(!isManager(req))return res.status(403).json({error:'Manager access required'});
    await ensure();let afterId='',after='',pages=0,matched=0,unmatched=0;
    do{
      const j=await source('/internal/crm/highlevel-conversations',{startAfterId:afterId,startAfter:after});
      const rows=j.conversations||[];
      for(const x of rows){
        const cid=String(x.contactId||'').replace(/^conversations_/,'');if(!cid){unmatched++;continue}
        const lead=(await q('SELECT submission_id FROM crm_website_leads WHERE ghl_contact_id=$1 LIMIT 1',[cid])).rows[0];if(!lead){unmatched++;continue}
        const occurred=msDate(x.lastMessageDate)||msDate(x.dateUpdated)||msDate(x.dateAdded);
        if(occurred)await q('UPDATE crm_website_leads SET last_activity_at=GREATEST(COALESCE(last_activity_at,$2::timestamptz),$2::timestamptz),updated_at=NOW() WHERE submission_id=$1',[lead.submission_id,occurred]);
        if(occurred&&x.lastMessageBody){const eid='hl-conv-last-'+String(x.id||'').replace(/^conversations_/,'');await q('INSERT INTO crm_highlevel_events(external_id,submission_id,ghl_contact_id,ghl_conversation_id,event_type,direction,body,occurred_at,raw) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT(external_id) DO UPDATE SET body=EXCLUDED.body,direction=EXCLUDED.direction,occurred_at=EXCLUDED.occurred_at,raw=EXCLUDED.raw',[eid,lead.submission_id,cid,String(x.id||'').replace(/^conversations_/,''),String(x.lastMessageType||'').toLowerCase().includes('email')?'email':'message',clean(x.lastMessageDirection),String(x.lastMessageBody),occurred,JSON.stringify(x)]);if(isStop(x.lastMessageDirection,x.lastMessageBody)){const phone=clean(x.phone||x.contactPhone||x.contact?.phone);if(phone)await q("INSERT INTO crm_sms_messages(twilio_sid,direction,from_number,to_number,body,status,lead_submission_id) VALUES($1,'inbound-shadow',$2,'', $3,'historical-optout',$4) ON CONFLICT(twilio_sid) DO NOTHING",['hl-stop-summary-'+String(x.id||'').replace(/^conversations_/,''),phone,String(x.lastMessageBody),lead.submission_id]).catch(()=>{})}}
        matched++;
      }
      pages++;afterId=clean(j.meta?.startAfterId)||'';after=clean(j.meta?.startAfter)||'';if(!rows.length||pages>=100)break;
    }while(afterId||after);
    res.json({ok:true,pages,matched,unmatched});
  }catch(e){res.status(502).json({error:e.message})}
});

router.get('/crm/v1/activity-filter',...guard,async(req,res)=>{
  try{await ensure();const days=Math.max(0,Number(req.query.days)||30),never=String(req.query.never||'false')==='true';const p=[];let w='';if(never)w='WHERE last_activity_at IS NULL';else{p.push(String(days));w="WHERE COALESCE(last_activity_at,last_contacted_at,received_at) < NOW()-($1::text||' days')::interval"}const rows=(await q('SELECT submission_id,first_name,last_name,email,phone,source,product_interest,brand_interest,model_interest,assigned_to,showroom,pipeline_stage,has_opportunity,ghl_opportunity_status,last_activity_at,last_contacted_at,received_at,ghl_contact_id FROM crm_website_leads '+w+' ORDER BY COALESCE(last_activity_at,last_contacted_at,received_at) ASC LIMIT 1500',p)).rows;res.json(rows)}catch(e){res.status(500).json({error:e.message})}
});

router.post('/crm/v1/sync/highlevel-contact-history',...guard,async(req,res)=>{
  try{
    await ensure();const submissionId=clean(req.body?.submission_id);if(!submissionId)return res.status(400).json({error:'submission_id is required'});
    const lead=(await q('SELECT submission_id,ghl_contact_id FROM crm_website_leads WHERE submission_id=$1',[submissionId])).rows[0];if(!lead?.ghl_contact_id)return res.status(404).json({error:'HighLevel contact not found'});
    const cid=lead.ghl_contact_id;let messagesSaved=0,notesSaved=0;
    const cs=await source('/internal/crm/highlevel-conversations',{contactId:cid});const conv=(cs.conversations||[])[0];
    if(conv?.id){const convId=String(conv.id).replace(/^conversations_/,'');const mj=await source('/internal/crm/highlevel-conversation-messages',{conversationId:convId});for(const m of (mj.messages||[])){const id=String(m.id||m.messageId||'');if(!id)continue;const occurred=msDate(m.dateAdded||m.dateCreated||m.createdAt||m.dateSent||m.timestamp)||new Date().toISOString();const typ=String(m.messageType||m.type||'').toLowerCase().includes('email')?'email':'message';await q('INSERT INTO crm_highlevel_events(external_id,submission_id,ghl_contact_id,ghl_conversation_id,event_type,direction,subject,body,status,occurred_at,raw) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) ON CONFLICT(external_id) DO UPDATE SET body=EXCLUDED.body,subject=EXCLUDED.subject,direction=EXCLUDED.direction,status=EXCLUDED.status,occurred_at=EXCLUDED.occurred_at,raw=EXCLUDED.raw',['hl-msg-'+id,submissionId,cid,convId,typ,clean(m.direction||m.messageDirection),clean(m.subject),String(m.body||m.message||m.text||''),clean(m.status),occurred,JSON.stringify(m)]);const msgBody=String(m.body||m.message||m.text||'');const msgDir=clean(m.direction||m.messageDirection);if(isStop(msgDir,msgBody)){const phone=clean(m.from||m.fromNumber||m.phone||m.contactPhone);if(phone)await q("INSERT INTO crm_sms_messages(twilio_sid,direction,from_number,to_number,body,status,lead_submission_id) VALUES($1,'inbound-shadow',$2,'',$3,'historical-optout',$4) ON CONFLICT(twilio_sid) DO NOTHING",['hl-stop-msg-'+id,phone,msgBody,submissionId]).catch(()=>{})};await q('UPDATE crm_website_leads SET last_activity_at=GREATEST(COALESCE(last_activity_at,$2::timestamptz),$2::timestamptz),updated_at=NOW() WHERE submission_id=$1',[submissionId,occurred]);messagesSaved++}}
    const nj=await source('/internal/crm/highlevel-contact-notes',{contactId:cid});for(const n of (nj.notes||[])){const id=String(n.id||'');if(!id)continue;const occurred=msDate(n.dateAdded||n.createdAt||n.updatedAt)||new Date().toISOString();await q("INSERT INTO crm_highlevel_events(external_id,submission_id,ghl_contact_id,event_type,body,author,occurred_at,raw) VALUES($1,$2,$3,'note',$4,$5,$6,$7::jsonb) ON CONFLICT(external_id) DO UPDATE SET body=EXCLUDED.body,author=EXCLUDED.author,occurred_at=EXCLUDED.occurred_at,raw=EXCLUDED.raw",['hl-note-'+id,submissionId,cid,String(n.body||n.note||n.content||''),clean(n.userName||n.author||n.createdBy),occurred,JSON.stringify(n)]);await q('UPDATE crm_website_leads SET last_activity_at=GREATEST(COALESCE(last_activity_at,$2::timestamptz),$2::timestamptz),updated_at=NOW() WHERE submission_id=$1',[submissionId,occurred]);notesSaved++}
    res.json({ok:true,messages_saved:messagesSaved,notes_saved:notesSaved});
  }catch(e){res.status(502).json({error:e.message})}
});

router.get('/crm/v1/leads/:id/highlevel-history',...guard,async(req,res)=>{try{await ensure();res.json((await q('SELECT external_id,event_type,direction,subject,body,author,status,occurred_at FROM crm_highlevel_events WHERE submission_id=$1 ORDER BY occurred_at DESC LIMIT 1000',[req.params.id])).rows)}catch(e){res.status(500).json({error:e.message})}});

export default router;