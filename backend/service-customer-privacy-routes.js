import express from 'express';
import jwt from 'jsonwebtoken';
import { q } from './service-db.js';

const router=express.Router();
const clean=v=>v==null?null:String(v).trim();
const secret=()=>{
  if(!process.env.SERVICE_JWT_SECRET) throw new Error('SERVICE_JWT_SECRET is required');
  return process.env.SERVICE_JWT_SECRET;
};
const managerRoles=new Set(['admin','owner','manager','service_manager']);
function auth(req,res,next){
  try{
    const raw=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
    if(!raw) return res.status(401).json({error:'Login required'});
    req.user=jwt.verify(raw,secret());
    next();
  }catch{res.status(401).json({error:'Session expired or invalid'});}
}
function managerOnly(req,res,next){
  if(!managerRoles.has(req.user?.role)) return res.status(403).json({error:'Manager permission required'});
  next();
}

export async function initCustomerPrivacy(){
  await q(`
    ALTER TABLE service_customers ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE service_customers ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
    ALTER TABLE service_customers ADD COLUMN IF NOT EXISTS archived_by TEXT;
    CREATE INDEX IF NOT EXISTS idx_service_customers_active ON service_customers(active);
  `);
}

// These routes intentionally sit before the legacy customer GET routes so archived customers stay out of normal staff search.
router.get('/customers',auth,async(req,res)=>{
  const term=`%${clean(req.query.q)||''}%`;
  const r=await q(`SELECT * FROM service_customers
    WHERE active=true AND concat_ws(' ',first_name,last_name,company,email,phone,street,city,zip) ILIKE $1
    ORDER BY last_name NULLS LAST,first_name NULLS LAST LIMIT 250`,[term]);
  res.json(r.rows);
});

router.get('/customers/:id',auth,async(req,res,next)=>{
  if(!/^\d+$/.test(String(req.params.id||''))) return next();
  const [c,e,w,i]=await Promise.all([
    q('SELECT * FROM service_customers WHERE id=$1 AND active=true',[req.params.id]),
    q('SELECT * FROM service_equipment WHERE customer_id=$1 ORDER BY created_at DESC',[req.params.id]),
    q('SELECT * FROM service_work_orders WHERE customer_id=$1 ORDER BY scheduled_start DESC NULLS LAST,created_at DESC',[req.params.id]),
    q('SELECT * FROM service_invoices WHERE customer_id=$1 ORDER BY created_at DESC',[req.params.id])
  ]);
  if(!c.rowCount) return res.status(404).json({error:'Customer not found'});
  res.json({customer:c.rows[0],equipment:e.rows,workOrders:w.rows,invoices:i.rows});
});

router.delete('/customers/:id',auth,managerOnly,async(req,res)=>{
  const c=await q('SELECT id,first_name,last_name FROM service_customers WHERE id=$1 AND active=true',[req.params.id]);
  if(!c.rowCount) return res.status(404).json({error:'Customer not found'});
  await q('UPDATE service_customers SET active=false,archived_at=NOW(),archived_by=$2,updated_at=NOW() WHERE id=$1',[req.params.id,req.user?.name||req.user?.username||'manager']);
  res.json({ok:true,removed_from_active_database:true,customer_id:Number(req.params.id)});
});

router.post('/customers/:id/restore',auth,managerOnly,async(req,res)=>{
  const r=await q('UPDATE service_customers SET active=true,archived_at=NULL,archived_by=NULL,updated_at=NOW() WHERE id=$1 RETURNING id,first_name,last_name',[req.params.id]);
  if(!r.rowCount) return res.status(404).json({error:'Customer not found'});
  res.json({ok:true,restored:true,customer:r.rows[0]});
});

export default router;
