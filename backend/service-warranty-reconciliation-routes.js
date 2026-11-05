import express from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import {q,transaction} from './service-db.js';

const router=express.Router();
const text=v=>String(v??'').trim();
const serial=v=>text(v).toUpperCase().replace(/[^A-Z0-9]/g,'');
const cash=v=>{if(v==null||v==='')return null;const n=Number(String(v).replace(/[,$ ]/g,''));return Number.isFinite(n)&&n>=0&&n<=1000000?Math.round(n*100)/100:null};
function owner(req,res,next){
 try{
  const token=text(req.get('authorization')).replace(/^Bearer\s+/i,'');
  const me=jwt.verify(token,process.env.SERVICE_JWT_SECRET);
  const name=text(me.username||me.name).toLowerCase(),role=text(me.role).toLowerCase();
  if(role!=='owner'&&role!=='admin'&&!['ray','ray morrow','raymond morrow'].includes(name))return res.status(403).json({error:'Owner or administrator access required'});
  req.operator=me;next();
 }catch{return res.status(401).json({error:'Sign in again'})}
}
async function ensure(){
 await q(`CREATE TABLE IF NOT EXISTS htfo_warranty_import_batches(
  id BIGSERIAL PRIMARY KEY,supplier TEXT NOT NULL,file_name TEXT,content_hash TEXT NOT NULL UNIQUE,
  imported_by TEXT,created_at TIMESTAMPTZ DEFAULT NOW(),row_count INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS htfo_warranty_import_lines(
  id BIGSERIAL PRIMARY KEY,batch_id BIGINT NOT NULL REFERENCES htfo_warranty_import_batches(id),
  line_number INTEGER NOT NULL,serial_number TEXT NOT NULL,work_order_id BIGINT REFERENCES service_work_orders(id),
  claim_id BIGINT REFERENCES service_warranty_claims(id),claim_number TEXT,
  manufacturer_status TEXT,reported_claimed NUMERIC(12,2),reported_approved NUMERIC(12,2),reported_paid NUMERIC(12,2),
  payment_reference TEXT,notes TEXT,match_status TEXT NOT NULL,raw_row JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),UNIQUE(batch_id,line_number));
 CREATE INDEX IF NOT EXISTS idx_htfo_warranty_lines_serial ON htfo_warranty_import_lines(serial_number);
 CREATE INDEX IF NOT EXISTS idx_htfo_warranty_lines_claim ON htfo_warranty_import_lines(claim_id);
 CREATE INDEX IF NOT EXISTS idx_htfo_warranty_lines_work ON htfo_warranty_import_lines(work_order_id);
 ALTER TABLE htfo_warranty_import_lines ADD COLUMN IF NOT EXISTS applied_credit NUMERIC(12,2);
 ALTER TABLE htfo_warranty_import_lines ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ;
 ALTER TABLE htfo_warranty_import_lines ADD COLUMN IF NOT EXISTS applied_by TEXT;
 CREATE TABLE IF NOT EXISTS htfo_warranty_credit_events(
 id BIGSERIAL PRIMARY KEY,
 import_line_id BIGINT NOT NULL UNIQUE REFERENCES htfo_warranty_import_lines(id),
 claim_id BIGINT NOT NULL REFERENCES service_warranty_claims(id),
 approved_before NUMERIC(12,2) NOT NULL,approved_after NUMERIC(12,2) NOT NULL,
 credited_by TEXT NOT NULL,credited_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
}
async function matched(line,run=q){
 const sn=serial(line.serial),claim=text(line.claim_number);
 let claims=[];
 if(claim)claims=(await run(`SELECT wc.id,wc.work_order_id,wc.total_claimed,wc.total_paid,wc.total_approved,
  w.work_order_number,e.serial_number FROM service_warranty_claims wc
  JOIN service_work_orders w ON w.id=wc.work_order_id LEFT JOIN service_equipment e ON e.id=w.equipment_id
  WHERE lower(wc.claim_number)=lower($1) AND lower(wc.supplier) LIKE '%cal%' ORDER BY wc.id`,[claim])).rows;
 if(!claims.length&&sn){
  const rows=(await run(`SELECT wc.id,wc.work_order_id,wc.total_claimed,wc.total_paid,wc.total_approved,w.work_order_number,e.serial_number
  FROM service_warranty_claims wc JOIN service_work_orders w ON w.id=wc.work_order_id
  JOIN service_equipment e ON e.id=w.equipment_id WHERE upper(regexp_replace(e.serial_number,'[^A-Za-z0-9]','','g'))=$1
  AND lower(wc.supplier) LIKE '%cal%' ORDER BY wc.id`,[sn])).rows;
  claims=rows;
 }
 if(claims.length===1)return {match_status:'matched_claim',claim_id:claims[0].id,work_order_id:claims[0].work_order_id,internal:claims[0]};
 if(claims.length>1)return {match_status:'multiple_claims',claim_id:null,work_order_id:null};
 const work=sn?(await run(`SELECT w.id,w.work_order_number,w.total_amount,w.warranty,e.serial_number
  FROM service_work_orders w JOIN service_equipment e ON e.id=w.equipment_id
  WHERE upper(regexp_replace(e.serial_number,'[^A-Za-z0-9]','','g'))=$1 ORDER BY w.id DESC LIMIT 3`,[sn])).rows:[];
 if(work.length===1)return {match_status:'matched_work_order_no_claim',claim_id:null,work_order_id:work[0].id,internal:work[0]};
 return {match_status:work.length?'multiple_work_orders':'unmatched_serial',claim_id:null,work_order_id:null};
}
function normalize(r,i){
 const item={serial:text(r.serial||r.serial_number||r.spa_serial||r.serial_no),claim_number:text(r.claim_number||r.claim_no||r.claim||r.warranty_claim),
  manufacturer_status:text(r.status||r.claim_status),reported_claimed:cash(r.claimed??r.amount_claimed),
  reported_approved:cash(r.approved??r.amount_approved),
  reported_paid:cash(r.paid??r.amount_paid),
  payment_reference:text(r.payment_reference||r.check_number||r.payment_id||r.reference),notes:text(r.notes||r.description)};
 if(!item.serial)throw Error('Row '+(i+2)+' is missing a serial number');
 for(const k of ['claimed','approved','paid'])if((r[k]??r['amount_'+k])!=null&&text(r[k]??r['amount_'+k])!==''&&item['reported_'+k]===null)throw Error('Invalid '+k+' amount on row '+(i+2));
 return item;
}
router.post('/warranty/cal-spas/preview',owner,async(req,res)=>{
 try{
  await ensure();const incoming=req.body?.rows;
  if(!Array.isArray(incoming)||!incoming.length||incoming.length>1000)return res.status(400).json({error:'Upload between 1 and 1,000 CSV records'});
  const rows=incoming.map(normalize),matches=[];
  for(let i=0;i<rows.length;i++)matches.push({...rows[i],line_number:i+2,...await matched(rows[i])});
  const counts=matches.reduce((a,r)=>(a[r.match_status]=(a[r.match_status]||0)+1,a),{});
  res.set('Cache-Control','no-store').json({rows:matches,counts,notice:'Preview only. A manufacturer CSV is not proof of settlement. No claimed, approved or paid amount has been changed.'});
 }catch(e){res.status(400).json({error:e.message})}
});
router.post('/warranty/cal-spas/import',owner,async(req,res)=>{
 try{
  await ensure();const incoming=req.body?.rows,filename=text(req.body?.file_name).slice(0,180);
  if(req.body?.confirm!=='IMPORT_AS_EVIDENCE'||!Array.isArray(incoming)||!incoming.length||incoming.length>1000)return res.status(400).json({error:'Review and explicitly confirm the CSV import'});
  const rows=incoming.map(normalize),hash=crypto.createHash('sha256').update(JSON.stringify({supplier:'Cal Spas',rows})).digest('hex');
  const result=await transaction(async run=>{
   if((await run('SELECT id FROM htfo_warranty_import_batches WHERE content_hash=$1',[hash])).rowCount)return {duplicate:true};
   const batch=(await run(`INSERT INTO htfo_warranty_import_batches(supplier,file_name,content_hash,imported_by,row_count) VALUES('Cal Spas',$1,$2,$3,$4) RETURNING id`,
    [filename,hash,text(req.operator.name||req.operator.username),rows.length])).rows[0];
   const counts={};
   for(let i=0;i<rows.length;i++){
    const line=rows[i],m=await matched(line,run);counts[m.match_status]=(counts[m.match_status]||0)+1;
    await run(`INSERT INTO htfo_warranty_import_lines(batch_id,line_number,serial_number,work_order_id,claim_id,claim_number,manufacturer_status,
      reported_claimed,reported_approved,reported_paid,payment_reference,notes,match_status,raw_row)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)`,
     [batch.id,i+2,line.serial,m.work_order_id,m.claim_id,line.claim_number,line.manufacturer_status,
      line.reported_claimed,line.reported_approved,line.reported_paid,line.payment_reference,line.notes,m.match_status,JSON.stringify(incoming[i])]);
   }
   return {batch_id:batch.id,imported:rows.length,counts};
  });
  res.status(result.duplicate?409:201).json(result.duplicate?{error:'This identical Cal Spas report was already imported; no duplicate entries created'}:
   {...result,note:'Staged as manufacturer evidence. Internal claimed/paid figures have not been overwritten.'});
 }catch(e){res.status(400).json({error:e.message})}
});
router.get('/warranty/cal-spas/reconciliation',owner,async(req,res)=>{
 try{
  await ensure();
  const claims=(await q(`SELECT wc.id,wc.work_order_id,wc.supplier,wc.claim_number,wc.status,wc.total_claimed,wc.total_approved,wc.total_paid,wc.submitted_at,
   w.work_order_number,w.completed_at,w.labor_hours,w.labor_amount,w.parts_amount,w.trip_amount,w.work_performed,w.diagnosis,
   e.serial_number,concat_ws(' ',c.first_name,c.last_name) customer_name,
   (SELECT count(*)::int FROM htfo_warranty_import_lines li WHERE li.claim_id=wc.id) imported_line_count
   FROM service_warranty_claims wc JOIN service_work_orders w ON w.id=wc.work_order_id
   JOIN service_customers c ON c.id=w.customer_id LEFT JOIN service_equipment e ON e.id=w.equipment_id
   WHERE lower(wc.supplier) LIKE '%cal%' ORDER BY wc.created_at DESC LIMIT 2000`)).rows;
  const missing=(await q(`SELECT w.id work_order_id,w.work_order_number,w.completed_at,w.labor_amount,w.parts_amount,w.trip_amount,
   e.serial_number,concat_ws(' ',c.first_name,c.last_name) customer_name
   FROM service_work_orders w JOIN service_equipment e ON e.id=w.equipment_id
   JOIN service_customers c ON c.id=w.customer_id
   WHERE w.warranty=true AND lower(coalesce(e.brand,'')) LIKE '%cal%'
   AND NOT EXISTS(SELECT 1 FROM service_warranty_claims wc WHERE wc.work_order_id=w.id AND lower(wc.supplier) LIKE '%cal%')
   ORDER BY w.created_at DESC LIMIT 500`)).rows;
  const batches=(await q("SELECT id,file_name,created_at,row_count FROM htfo_warranty_import_batches WHERE supplier='Cal Spas' ORDER BY created_at DESC LIMIT 100")).rows;
  const imports=(await q(`SELECT li.*,b.created_at imported_at,b.file_name,w.work_order_number,wc.total_claimed internal_claimed,
   wc.total_paid internal_paid FROM htfo_warranty_import_lines li
   JOIN htfo_warranty_import_batches b ON b.id=li.batch_id LEFT JOIN service_work_orders w ON w.id=li.work_order_id
   LEFT JOIN service_warranty_claims wc ON wc.id=li.claim_id WHERE b.supplier='Cal Spas'
   ORDER BY li.created_at DESC,li.id DESC LIMIT 2000`)).rows;
  const total=claims.reduce((s,r)=>s+Math.max(0,Number(r.total_claimed||0)-Number(r.total_paid||0)),0);
  const uncredited=claims.reduce((n,r)=>n+Math.max(0,Number(r.total_claimed||0)-Number(r.total_approved||0)),0);
  const approvedUnpaid=claims.reduce((n,r)=>n+Math.max(0,Number(r.total_approved||0)-Number(r.total_paid||0)),0);
  res.set('Cache-Control','no-store').json({summary:{claims:claims.length,claimed:claims.reduce((s,r)=>s+Number(r.total_claimed||0),0),
   recorded_paid:claims.reduce((s,r)=>s+Number(r.total_paid||0),0),unreconciled_claim_balance:Math.round(total*100)/100,uncredited_balance:Math.round(uncredited*100)/100,approved_not_received:Math.round(approvedUnpaid*100)/100,
   warranty_jobs_without_claim:missing.length,imported_lines:imports.length},claims,unclaimed_work_orders:missing,imports,batches,
   notice:'Internal paid amounts are staff-entered and require verification against bank deposits; manufacturer CSV paid amounts are kept separate.'});
 }catch(e){res.status(503).json({error:'Warranty reconciliation unavailable: '+e.message})}
});
router.get('/warranty/cal-spas/reconciliation.csv',owner,async(req,res)=>{
 try{
  await ensure();const result=(await q(`SELECT wc.claim_number,w.work_order_number,e.serial_number,coalesce(w.completed_at,w.created_at)::date completed,
   wc.status,wc.total_claimed,wc.total_approved,wc.total_paid,(wc.total_claimed-wc.total_paid) outstanding,
   w.labor_hours,w.work_performed,w.diagnosis
   FROM service_warranty_claims wc JOIN service_work_orders w ON w.id=wc.work_order_id
   LEFT JOIN service_equipment e ON e.id=w.equipment_id WHERE lower(wc.supplier) LIKE '%cal%' ORDER BY wc.created_at DESC`)).rows;
  const safe=v=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,' ').replaceAll('"','""')+'"';
  const fields=['claim_number','work_order_number','serial_number','completed','status','total_claimed','total_approved','total_paid','outstanding','labor_hours','work_performed','diagnosis'];
  res.set('Content-Type','text/csv; charset=utf-8').set('Cache-Control','no-store')
   .set('Content-Disposition','attachment; filename="HTFO-Cal-Spas-Warranty-Receivables.csv"')
   .send('\uFEFF'+[fields,...result.map(row=>fields.map(k=>row[k]))].map(a=>a.map(safe).join(',')).join('\r\n'));
 }catch(e){res.status(503).json({error:'CSV export unavailable'})}
});
export default router;
