import express from 'express';
import {q,transaction} from './service-db.js';

const maxBytes=25*1024*1024;
const jobBytes=100*1024*1024;
const categories=new Set(['arrival_damage','problem','old_part','installed_part','other']);
const columns='id,work_order_id,work_order_number,category,note,mime_type,byte_size,uploaded_by,created_at';
const validId=id=>/^\d{1,15}$/.test(id);

export async function initServiceEvidence(){
  await q(`CREATE TABLE IF NOT EXISTS service_job_evidence(
    id BIGSERIAL PRIMARY KEY,
    customer_id BIGINT NOT NULL REFERENCES service_customers(id) ON DELETE CASCADE,
    work_order_id BIGINT REFERENCES service_work_orders(id) ON DELETE SET NULL,
    work_order_number TEXT NOT NULL,
    category TEXT NOT NULL,
    note TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    uploaded_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    content BYTEA NOT NULL
  );
  CREATE INDEX IF NOT EXISTS service_job_evidence_customer ON service_job_evidence(customer_id,id DESC);
  CREATE INDEX IF NOT EXISTS service_job_evidence_work_order ON service_job_evidence(work_order_id,id DESC);`);
}

export function evidenceFormat(data){
  if(!Buffer.isBuffer(data)||data.length<12)return null;
  const tag=(start,end)=>data.toString('latin1',start,end);
  if(data[0]===255&&data[1]===216&&data[2]===255)return ['image/jpeg','jpg'];
  if(data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return ['image/png','png'];
  if(tag(0,4)==='RIFF'&&tag(8,12)==='WEBP')return ['image/webp','webp'];
  if(tag(4,8)!=='ftyp'||data.length<16)return null;
  const brand=tag(8,12);
  if(['heic','heix','hevc','hevx','mif1','msf1'].includes(brand))return ['image/heic','heic'];
  if(brand==='qt  ')return ['video/quicktime','mov'];
  if(['isom','iso2','mp41','mp42','avc1','M4V ','MSNV'].includes(brand))return ['video/mp4','mp4'];
  return null;
}

const fail=(status,message)=>Object.assign(new Error(message),{status});
const handle=fn=>(req,res,next)=>Promise.resolve().then(()=>fn(req,res,next)).catch(next);

export function mountServiceEvidence(router,{auth,canManage,canAccessWorkOrder}){
  const raw=express.raw({type:'application/octet-stream',limit:maxBytes});
  const work=async(req,run=q,lock=false)=>{
    if(!validId(req.params.id))throw fail(404,'Work order not found');
    const {rows:[order]}=await run(`SELECT id,customer_id,work_order_number,job_type,assigned_to,assigned_team
      FROM service_work_orders WHERE id=$1${lock?' FOR UPDATE':''}`,[req.params.id]);
    if(!order)throw fail(404,'Work order not found');
    if(String(req.user.role).toLowerCase()==='sales'&&!canManage(req)||!canAccessWorkOrder(req,order)){
      throw fail(403,'This job is not assigned to you');
    }
    return order;
  };
  const access=handle(async(req,_res,next)=>{await work(req);next()});
  router.get('/field/work-orders/:id/evidence',auth,access,handle(async(req,res)=>{
    const {rows}=await q(`SELECT ${columns} FROM service_job_evidence WHERE work_order_id=$1 ORDER BY id DESC`,[req.params.id]);
    res.set('Cache-Control','private, no-store').json(rows);
  }));
  router.post('/field/work-orders/:id/evidence',auth,access,raw,handle(async(req,res)=>{
    const format=evidenceFormat(req.body);
    if(!format)throw fail(415,'Choose a JPEG, PNG, HEIC, WebP, MP4, or MOV file.');
    const category=req.get('X-Evidence-Category');
    if(!categories.has(category))throw fail(400,'Choose an evidence category.');
    let note;
    try{note=decodeURIComponent(req.get('X-Evidence-Note')||'').trim()}catch{throw fail(400,'Invalid evidence note.')}
    if(note.length>500||note.includes('\0'))throw fail(400,'Use 500 characters or fewer for the note.');
    const row=await transaction(async run=>{
      const order=await work(req,run,true);
      const {rows:[usage]}=await run('SELECT count(*)::int files,coalesce(sum(byte_size),0) bytes FROM service_job_evidence WHERE work_order_id=$1',[order.id]);
      if(usage.files>=20||Number(usage.bytes)+req.body.length>jobBytes)throw fail(409,'This job has reached its evidence limit of 20 files or 100 MB.');
      const {rows:[saved]}=await run(`INSERT INTO service_job_evidence
        (customer_id,work_order_id,work_order_number,category,note,mime_type,byte_size,uploaded_by,content)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${columns}`,
        [order.customer_id,order.id,order.work_order_number,category,note,format[0],req.body.length,req.user.name||req.user.username||String(req.user.sub),req.body]);
      return saved;
    });
    res.set('Cache-Control','private, no-store').status(201).json(row);
  }));
  router.get('/customers/:id/service-evidence',auth,handle(async(req,res)=>{
    if(!canManage(req))throw fail(403,'Manager access required');
    if(!validId(req.params.id))throw fail(404,'Customer not found');
    const before=req.query.before;
    if(before!==undefined&&!validId(before))throw fail(400,'Invalid evidence page.');
    const {rows}=await q(`SELECT ${columns} FROM service_job_evidence
      WHERE customer_id=$1 AND ($2::bigint IS NULL OR id<$2) ORDER BY id DESC LIMIT 51`,[req.params.id,before??null]);
    res.set('Cache-Control','private, no-store').json({items:rows.slice(0,50),next:rows.length>50?rows[49].id:null});
  }));
  router.get('/service-evidence/:id/file',auth,handle(async(req,res)=>{
    if(!validId(req.params.id))throw fail(404,'Evidence not found');
    const {rows:[record]}=await q(`SELECT e.mime_type,w.id,w.job_type,w.assigned_to,w.assigned_team
      FROM service_job_evidence e LEFT JOIN service_work_orders w ON w.id=e.work_order_id WHERE e.id=$1`,[req.params.id]);
    if(!record)throw fail(404,'Evidence not found');
    if(!canManage(req)&&(!record.id||String(req.user.role).toLowerCase()==='sales'||!canAccessWorkOrder(req,record))){
      throw fail(403,'This evidence is not available to you');
    }
    const {rows:[file]}=await q('SELECT content FROM service_job_evidence WHERE id=$1',[req.params.id]);
    if(!file)throw fail(404,'Evidence not found');
    const content=Buffer.from(file.content);
    const format=evidenceFormat(content);
    if(!format||format[0]!==record.mime_type)throw fail(415,'Evidence format unavailable');
    res.set({'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',
      'Content-Disposition':`attachment; filename="service-evidence-${req.params.id}.${format[1]}"`})
      .type(record.mime_type).send(content);
  }));
  router.use(['/field/work-orders/:id/evidence','/customers/:id/service-evidence','/service-evidence/:id/file'],(err,req,res,next)=>{
    if(res.headersSent)return next(err);
    if(err.type==='entity.too.large')return res.status(413).json({error:'Choose a file no larger than 25 MB. Trim longer videos first.'});
    if(err.status&&err.status<500)return res.status(err.status).json({error:err.message});
    console.error('Service evidence request failed',err.code||err.name);
    res.status(500).json({error:'Unable to access service evidence. Please try again.'});
  });
}
