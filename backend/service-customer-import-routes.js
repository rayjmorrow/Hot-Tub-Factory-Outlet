import express from 'express';
import jwt from 'jsonwebtoken';
import { q } from './service-db.js';

const router=express.Router();
const clean=v=>v==null?null:String(v).trim();
const secret=()=>{
  if(!process.env.SERVICE_JWT_SECRET) throw new Error('SERVICE_JWT_SECRET is required');
  return process.env.SERVICE_JWT_SECRET;
};
const allowedRoles=new Set(['admin','manager','service_manager','owner']);

function auth(req,res,next){
  try{
    const raw=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
    if(!raw) return res.status(401).json({error:'Login required'});
    req.user=jwt.verify(raw,secret());
    next();
  }catch{
    res.status(401).json({error:'Session expired or invalid'});
  }
}
function manageOnly(req,res,next){
  if(!allowedRoles.has(req.user?.role)) return res.status(403).json({error:'Manager permission required'});
  next();
}
function normalizeAddress(b){
  return [b.street,b.city,b.state,b.zip]
    .map(v=>clean(v)||'')
    .join(' ')
    .toLowerCase()
    .replace(/\bstreet\b/g,'st').replace(/\broad\b/g,'rd').replace(/\bdrive\b/g,'dr')
    .replace(/\blane\b/g,'ln').replace(/\bavenue\b/g,'ave').replace(/\bhighway\b/g,'hwy')
    .replace(/\bcourt\b/g,'ct').replace(/\bboulevard\b/g,'blvd').replace(/\bplace\b/g,'pl')
    .replace(/\bterrace\b/g,'ter').replace(/\bcircle\b/g,'cir').replace(/\bparkway\b/g,'pkwy')
    .replace(/[^a-z0-9]/g,'');
}
function phoneDigits(v){
  let d=String(v||'').replace(/\D/g,'');
  if(d.length===11&&d.startsWith('1')) d=d.slice(1);
  return d.length===10?d:'';
}

export async function initServiceCustomerImport(){
  await q(`
    CREATE TABLE IF NOT EXISTS service_customer_import_batches (
      id BIGSERIAL PRIMARY KEY,
      batch_key TEXT UNIQUE NOT NULL,
      source_name TEXT NOT NULL,
      source_row_count INT NOT NULL DEFAULT 0,
      imported_row_count INT NOT NULL DEFAULT 0,
      created_by BIGINT,
      created_by_name TEXT,
      status TEXT NOT NULL DEFAULT 'staging',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS service_customer_import_staging (
      id BIGSERIAL PRIMARY KEY,
      batch_id BIGINT NOT NULL REFERENCES service_customer_import_batches(id) ON DELETE CASCADE,
      source_customer_id TEXT,
      customer_name TEXT,
      first_name TEXT,
      last_name TEXT,
      aliases TEXT,
      street TEXT,
      city TEXT,
      state TEXT,
      zip TEXT,
      normalized_address TEXT,
      primary_phone TEXT,
      secondary_phone TEXT,
      additional_phones TEXT,
      primary_email TEXT,
      additional_emails TEXT,
      spa_makes TEXT,
      spa_models TEXT,
      purchase_date DATE,
      first_activity DATE,
      latest_activity DATE,
      calendar_event_count INT NOT NULL DEFAULT 0,
      source TEXT,
      merged_record_count INT NOT NULL DEFAULT 1,
      merged_customer_ids TEXT,
      review_note TEXT,
      recent_notes TEXT,
      raw_record JSONB NOT NULL DEFAULT '{}'::jsonb,
      row_status TEXT NOT NULL DEFAULT 'staged',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(batch_id, normalized_address)
    );
    CREATE INDEX IF NOT EXISTS idx_service_customer_import_batch ON service_customer_import_staging(batch_id);
    CREATE INDEX IF NOT EXISTS idx_service_customer_import_address ON service_customer_import_staging(normalized_address);
    CREATE INDEX IF NOT EXISTS idx_service_customer_import_phone ON service_customer_import_staging(primary_phone);
    CREATE INDEX IF NOT EXISTS idx_service_customer_import_email ON service_customer_import_staging(primary_email);
  `);
}

router.get('/customer-import/staging/batches',auth,manageOnly,async(req,res)=>{
  const r=await q(`SELECT b.*,count(s.id)::int staged_rows
    FROM service_customer_import_batches b
    LEFT JOIN service_customer_import_staging s ON s.batch_id=b.id
    GROUP BY b.id ORDER BY b.created_at DESC LIMIT 50`);
  res.json(r.rows);
});

router.get('/customer-import/staging/:batchKey',auth,manageOnly,async(req,res)=>{
  const term=`%${clean(req.query.q)||''}%`;
  const b=await q('SELECT * FROM service_customer_import_batches WHERE batch_key=$1',[req.params.batchKey]);
  if(!b.rowCount) return res.status(404).json({error:'Staging batch not found'});
  const rows=await q(`SELECT * FROM service_customer_import_staging
    WHERE batch_id=$1 AND concat_ws(' ',customer_name,aliases,street,city,state,zip,primary_phone,secondary_phone,primary_email,spa_makes,spa_models) ILIKE $2
    ORDER BY customer_name NULLS LAST,street NULLS LAST LIMIT 500`,[b.rows[0].id,term]);
  res.json({batch:b.rows[0],rows:rows.rows});
});

router.post('/customer-import/staging',auth,manageOnly,async(req,res)=>{
  const rows=Array.isArray(req.body?.rows)?req.body.rows:[];
  if(!rows.length) return res.status(400).json({error:'No customer rows supplied'});
  if(rows.length>300) return res.status(413).json({error:'Import batches are limited to 300 rows per request'});
  const sourceName=clean(req.body?.source_name)||'HTFO master customer database';
  const batchKey=clean(req.body?.batch_key)||`htfo-${new Date().toISOString().slice(0,10)}`;
  const batch=await q(`INSERT INTO service_customer_import_batches(batch_key,source_name,source_row_count,created_by,created_by_name)
    VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(batch_key) DO UPDATE SET source_name=EXCLUDED.source_name,source_row_count=greatest(service_customer_import_batches.source_row_count,EXCLUDED.source_row_count),updated_at=NOW()
    RETURNING *`,[batchKey,sourceName,Number(req.body?.source_row_count)||rows.length,req.user?.sub||null,req.user?.name||req.user?.username||null]);
  let staged=0,updated=0,rejected=0;
  for(const raw of rows){
    const b=raw||{};
    const normalizedAddress=normalizeAddress(b);
    if(!normalizedAddress){ rejected++; continue; }
    const params=[
      batch.rows[0].id,clean(b.source_customer_id),clean(b.customer_name),clean(b.first_name),clean(b.last_name),clean(b.aliases),
      clean(b.street),clean(b.city),clean(b.state)?.toUpperCase()||null,clean(b.zip),normalizedAddress,
      phoneDigits(b.primary_phone),phoneDigits(b.secondary_phone),clean(b.additional_phones),clean(b.primary_email)?.toLowerCase()||null,
      clean(b.additional_emails),clean(b.spa_makes),clean(b.spa_models),b.purchase_date||null,b.first_activity||null,b.latest_activity||null,
      Math.max(0,Number(b.calendar_event_count)||0),clean(b.source),Math.max(1,Number(b.merged_record_count)||1),clean(b.merged_customer_ids),
      clean(b.review_note),clean(b.recent_notes),JSON.stringify(b)
    ];
    const hit=await q(`INSERT INTO service_customer_import_staging(
      batch_id,source_customer_id,customer_name,first_name,last_name,aliases,street,city,state,zip,normalized_address,
      primary_phone,secondary_phone,additional_phones,primary_email,additional_emails,spa_makes,spa_models,purchase_date,first_activity,latest_activity,
      calendar_event_count,source,merged_record_count,merged_customer_ids,review_note,recent_notes,raw_record)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28::jsonb)
      ON CONFLICT(batch_id,normalized_address) DO UPDATE SET
        source_customer_id=EXCLUDED.source_customer_id,customer_name=EXCLUDED.customer_name,first_name=EXCLUDED.first_name,last_name=EXCLUDED.last_name,
        aliases=EXCLUDED.aliases,street=EXCLUDED.street,city=EXCLUDED.city,state=EXCLUDED.state,zip=EXCLUDED.zip,primary_phone=EXCLUDED.primary_phone,
        secondary_phone=EXCLUDED.secondary_phone,additional_phones=EXCLUDED.additional_phones,primary_email=EXCLUDED.primary_email,
        additional_emails=EXCLUDED.additional_emails,spa_makes=EXCLUDED.spa_makes,spa_models=EXCLUDED.spa_models,purchase_date=EXCLUDED.purchase_date,
        first_activity=EXCLUDED.first_activity,latest_activity=EXCLUDED.latest_activity,calendar_event_count=EXCLUDED.calendar_event_count,source=EXCLUDED.source,
        merged_record_count=EXCLUDED.merged_record_count,merged_customer_ids=EXCLUDED.merged_customer_ids,review_note=EXCLUDED.review_note,recent_notes=EXCLUDED.recent_notes,
        raw_record=EXCLUDED.raw_record,updated_at=NOW()
      RETURNING (xmax=0) inserted`,params);
    if(hit.rows[0]?.inserted) staged++; else updated++;
  }
  await q(`UPDATE service_customer_import_batches SET imported_row_count=(SELECT count(*) FROM service_customer_import_staging WHERE batch_id=$1),updated_at=NOW() WHERE id=$1`,[batch.rows[0].id]);
  res.json({ok:true,batch_key:batchKey,staged,updated,rejected,production_customers_changed:0});
});

export default router;
