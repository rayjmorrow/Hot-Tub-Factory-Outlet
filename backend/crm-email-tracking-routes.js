import express from 'express';
import {createHash} from 'node:crypto';
import jwt from 'jsonwebtoken';
import { q } from './service-db.js';

const router=express.Router();
const clean=v=>v==null?null:String(v).trim();
const key=()=>String(process.env.BREVO_API_KEY||'').trim();
const jwtSecret=()=>{if(!process.env.SERVICE_JWT_SECRET)throw new Error('SERVICE_JWT_SECRET is required');return process.env.SERVICE_JWT_SECRET};
function auth(req,res,next){try{const raw=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');if(!raw)return res.status(401).json({error:'Login required'});req.user=jwt.verify(raw,jwtSecret());next()}catch{return res.status(401).json({error:'Session expired or invalid'})}}
function role(req,res,next){if(!['admin','owner','manager','service_manager','sales'].includes(String(req.user?.role||'').toLowerCase()))return res.status(403).json({error:'CRM access required'});next()}
const guard=[auth,role];
const hookSecret=()=>key()?createHash('sha256').update('htfo-brevo-events:'+key()).digest('hex'):'';
const mapEvent=e=>({
  request:'accepted',sent:'accepted',delivered:'delivered',
  opened:'opened',uniqueOpened:'opened',unique_opened:'opened',
  click:'clicked',clicked:'clicked',
  unsubscribed:'unsubscribed',
  spam:'complained',
  hardBounce:'bounced',hard_bounce:'bounced',softBounce:'bounced',soft_bounce:'bounced',
  invalid:'bounced',invalid_email:'bounced',blocked:'failed',error:'failed',deferred:'failed'
}[String(e||'')]||null);

export async function ensureEmailTrackingSchema(){
  await q(`CREATE TABLE IF NOT EXISTS crm_email_campaigns(
    id TEXT PRIMARY KEY,
    subject TEXT,
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await q(`ALTER TABLE crm_email_messages ADD COLUMN IF NOT EXISTS campaign_id TEXT;
    ALTER TABLE crm_email_messages ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
    ALTER TABLE crm_email_messages ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
    ALTER TABLE crm_email_messages ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ;
    ALTER TABLE crm_email_messages ADD COLUMN IF NOT EXISTS clicked_at TIMESTAMPTZ;
    ALTER TABLE crm_email_messages ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ;
    ALTER TABLE crm_email_messages ADD COLUMN IF NOT EXISTS unsubscribed_at TIMESTAMPTZ;
    ALTER TABLE crm_email_messages ADD COLUMN IF NOT EXISTS complained_at TIMESTAMPTZ;
    ALTER TABLE crm_email_messages ADD COLUMN IF NOT EXISTS bounced_at TIMESTAMPTZ;
    ALTER TABLE crm_email_messages ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ;
    ALTER TABLE crm_email_messages ADD COLUMN IF NOT EXISTS skipped_at TIMESTAMPTZ;
    ALTER TABLE crm_email_messages ADD COLUMN IF NOT EXISTS last_event_at TIMESTAMPTZ;
    ALTER TABLE crm_email_messages ADD COLUMN IF NOT EXISTS click_url TEXT;`);
  await q(`CREATE TABLE IF NOT EXISTS crm_email_events(
    event_key TEXT PRIMARY KEY,
    provider_id TEXT,
    email TEXT,
    event_type TEXT NOT NULL,
    event_at TIMESTAMPTZ NOT NULL,
    url TEXT,
    raw JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await q('CREATE INDEX IF NOT EXISTS idx_crm_email_campaign ON crm_email_messages(campaign_id,created_at DESC)');
}

function eventTime(p){
  const n=Number(p.ts_event||p.ts||0);
  if(n>0)return new Date(n*1000);
  const d=new Date(p.date||Date.now());
  return Number.isFinite(d.getTime())?d:new Date();
}
async function applyEvent(p){
  const kind=mapEvent(p.event);if(!kind)return false;
  await ensureEmailTrackingSchema();
  const provider=clean(p['message-id']||p.messageId||p.message_id),email=clean(p.email||p.to)?.toLowerCase()||null,when=eventTime(p);
  const url=clean(p.link||p.url);
  const eventKey=createHash('sha256').update([provider,email,p.event,p.ts_event||p.ts||p.date||'',url||''].join('|')).digest('hex');
  const ins=await q(`INSERT INTO crm_email_events(event_key,provider_id,email,event_type,event_at,url,raw)
    VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT(event_key) DO NOTHING RETURNING event_key`,
    [eventKey,provider,email,kind,when.toISOString(),url,JSON.stringify(p)]);
  if(!ins.rowCount)return false;
  const col={accepted:'accepted_at',delivered:'delivered_at',opened:'opened_at',clicked:'clicked_at',unsubscribed:'unsubscribed_at',complained:'complained_at',bounced:'bounced_at',failed:'failed_at'}[kind];
  const status={accepted:'accepted',delivered:'delivered',opened:'opened',clicked:'clicked',unsubscribed:'unsubscribed',complained:'complained',bounced:'bounced',failed:'failed'}[kind];
  if(col){
    if(kind==='clicked'){
      await q(`UPDATE crm_email_messages SET ${col}=COALESCE(${col},$1),last_event_at=GREATEST(COALESCE(last_event_at,$1),$1),status=$2,click_url=COALESCE($3,click_url)
        WHERE direction='outbound' AND ((provider_id IS NOT NULL AND provider_id=$4) OR ($5::text IS NOT NULL AND lower(to_email)=$5 AND created_at BETWEEN $1::timestamptz-interval '2 days' AND $1::timestamptz+interval '2 days'))`,
        [when.toISOString(),status,url,provider,email]);
    }else{
      await q(`UPDATE crm_email_messages SET ${col}=COALESCE(${col},$1),last_event_at=GREATEST(COALESCE(last_event_at,$1),$1),status=$2
        WHERE direction='outbound' AND ((provider_id IS NOT NULL AND provider_id=$3) OR ($4::text IS NOT NULL AND lower(to_email)=$4 AND created_at BETWEEN $1::timestamptz-interval '2 days' AND $1::timestamptz+interval '2 days'))`,
        [when.toISOString(),status,provider,email]);
    }
  }
  return true;
}

router.post('/crm/v1/email-events/brevo',async(req,res)=>{
  try{
    if(!hookSecret()||String(req.get('x-htfo-brevo-hook')||'')!==hookSecret())return res.status(403).json({error:'Forbidden'});
    const items=Array.isArray(req.body)?req.body:(Array.isArray(req.body?.items)?req.body.items:[req.body]);
    let saved=0;for(const p of items)if(p&&await applyEvent(p))saved++;
    res.json({ok:true,saved});
  }catch(e){res.status(500).json({error:e.message})}
});

router.get('/crm/v1/email-campaigns',...guard,async(req,res)=>{
  try{
    await ensureEmailTrackingSchema();
    const rows=(await q(`SELECT c.id,c.subject,c.created_by,c.created_at,
      count(m.id)::int total,
      count(*) FILTER(WHERE m.accepted_at IS NOT NULL OR m.status IN ('accepted','sent','delivered','opened','clicked'))::int accepted,
      count(*) FILTER(WHERE m.delivered_at IS NOT NULL)::int delivered,
      count(*) FILTER(WHERE m.opened_at IS NOT NULL)::int opened,
      count(*) FILTER(WHERE m.clicked_at IS NOT NULL)::int clicked,
      count(*) FILTER(WHERE m.replied_at IS NOT NULL)::int replied,
      count(*) FILTER(WHERE m.unsubscribed_at IS NOT NULL)::int unsubscribed,
      count(*) FILTER(WHERE m.complained_at IS NOT NULL)::int complained,
      count(*) FILTER(WHERE m.bounced_at IS NOT NULL)::int bounced,
      count(*) FILTER(WHERE m.failed_at IS NOT NULL)::int failed,
      count(*) FILTER(WHERE m.skipped_at IS NOT NULL)::int skipped
      FROM crm_email_campaigns c LEFT JOIN crm_email_messages m ON m.campaign_id=c.id
      GROUP BY c.id,c.subject,c.created_by,c.created_at ORDER BY c.created_at DESC LIMIT 100`)).rows;
    res.json({campaigns:rows});
  }catch(e){res.status(500).json({error:e.message})}
});

router.get('/crm/v1/email-campaigns/:id/stats',...guard,async(req,res)=>{
  try{
    await ensureEmailTrackingSchema();
    const campaign=(await q('SELECT * FROM crm_email_campaigns WHERE id=$1',[req.params.id])).rows[0];
    if(!campaign)return res.status(404).json({error:'Campaign not found'});
    const rows=(await q(`SELECT m.id,m.submission_id,m.to_email,m.status,m.created_at,m.accepted_at,m.delivered_at,m.opened_at,m.clicked_at,m.replied_at,m.unsubscribed_at,m.complained_at,m.bounced_at,m.failed_at,m.skipped_at,m.click_url,
      concat_ws(' ',l.first_name,l.last_name) name
      FROM crm_email_messages m LEFT JOIN crm_website_leads l ON l.submission_id=m.submission_id
      WHERE m.campaign_id=$1 ORDER BY COALESCE(m.last_event_at,m.created_at) DESC,m.id DESC`,[req.params.id])).rows;
    const n=k=>rows.filter(r=>k(r)).length,total=rows.length;
    const stats={
      all:total,
      accepted:n(r=>r.accepted_at||['accepted','sent','delivered','opened','clicked'].includes(r.status)),
      delivered:n(r=>r.delivered_at),opened:n(r=>r.opened_at),clicked:n(r=>r.clicked_at),replied:n(r=>r.replied_at),
      unsubscribed:n(r=>r.unsubscribed_at),complained:n(r=>r.complained_at),bounced:n(r=>r.bounced_at),failed:n(r=>r.failed_at),skipped:n(r=>r.skipped_at)
    };
    res.json({campaign,stats,recipients:rows});
  }catch(e){res.status(500).json({error:e.message})}
});

export async function ensureBrevoEmailTrackingWebhook(){
  const apiKey=key();if(!apiKey)return{skipped:true,reason:'BREVO_API_KEY missing'};
  const base=String(process.env.SERVICE_PUBLIC_URL||'https://htfo-service-operations.onrender.com').replace(/\/$/,'');
  const url=base+'/api/service/crm/v1/email-events/brevo';
  const headers={'api-key':apiKey,'Content-Type':'application/json','Accept':'application/json'};
  const list=await fetch('https://api.brevo.com/v3/webhooks?type=transactional',{headers});
  const existing=list.ok?await list.json().catch(()=>({webhooks:[]})):{webhooks:[]};
  const found=(existing.webhooks||[]).find(w=>w.url===url);
  const body={url,description:'HTFO CRM email engagement tracking',events:['sent','delivered','hardBounce','softBounce','blocked','spam','invalid','deferred','click','opened','uniqueOpened','unsubscribed'],type:'transactional',headers:[{key:'x-htfo-brevo-hook',value:hookSecret()}]};
  const endpoint=found?`https://api.brevo.com/v3/webhooks/${found.id}`:'https://api.brevo.com/v3/webhooks';
  const r=await fetch(endpoint,{method:found?'PUT':'POST',headers,body:JSON.stringify(body)});
  if(!r.ok){const j=await r.json().catch(()=>({}));throw new Error(j.message||('Brevo webhook setup returned '+r.status))}
  return{ok:true,updated:Boolean(found)};
}

export default router;
