import express from 'express';
import jwt from 'jsonwebtoken';
import { q } from './service-db.js';

const router=express.Router();
const clean=v=>v==null?null:String(v).trim();
const num=v=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;
function secret(){if(!process.env.SERVICE_JWT_SECRET)throw new Error('SERVICE_JWT_SECRET is required');return process.env.SERVICE_JWT_SECRET}
function auth(req,res,next){try{const raw=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');if(!raw)return res.status(401).json({error:'Login required'});req.user=jwt.verify(raw,secret());next()}catch{res.status(401).json({error:'Session expired or invalid'})}}

export async function initServiceCustomerValue(){
  await q(`
    CREATE TABLE IF NOT EXISTS service_retail_transactions (
      id BIGSERIAL PRIMARY KEY,
      customer_id BIGINT NOT NULL REFERENCES service_customers(id) ON DELETE CASCADE,
      transaction_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      transaction_number TEXT,
      category TEXT NOT NULL DEFAULT 'retail',
      description TEXT NOT NULL,
      brand TEXT,
      model TEXT,
      serial_number TEXT,
      quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
      subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
      tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      salesperson TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      source_record_id TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_service_retail_customer_date ON service_retail_transactions(customer_id,transaction_date DESC);
    CREATE INDEX IF NOT EXISTS idx_service_retail_category ON service_retail_transactions(customer_id,category,transaction_date DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_service_retail_source_record ON service_retail_transactions(source,source_record_id) WHERE source_record_id IS NOT NULL;
  `);
}

router.get('/customers/:id/value-history',auth,async(req,res)=>{
  const id=req.params.id;
  const customer=(await q('SELECT * FROM service_customers WHERE id=$1',[id])).rows[0];
  if(!customer)return res.status(404).json({error:'Customer not found'});
  const [retail,service,serviceCalls,equipment]=await Promise.all([
    q(`SELECT * FROM service_retail_transactions WHERE customer_id=$1 ORDER BY transaction_date DESC,id DESC`,[id]),
    q(`SELECT i.*,w.work_order_number,w.equipment_id,e.equipment_type,e.brand equipment_brand,e.model equipment_model,e.serial_number
       FROM service_invoices i LEFT JOIN service_work_orders w ON w.id=i.work_order_id LEFT JOIN service_equipment e ON e.id=w.equipment_id
       WHERE i.customer_id=$1 ORDER BY i.created_at DESC`,[id]),
    q(`SELECT w.*,e.equipment_type,e.brand,e.model,e.serial_number FROM service_work_orders w LEFT JOIN service_equipment e ON e.id=w.equipment_id WHERE w.customer_id=$1 ORDER BY coalesce(w.scheduled_start,w.created_at) DESC`,[id]),
    q(`SELECT * FROM service_equipment WHERE customer_id=$1 ORDER BY coalesce(install_date,created_at::date) DESC`,[id])
  ]);
  const retailRows=retail.rows,serviceRows=service.rows,calls=serviceCalls.rows;
  const retailLifetime=retailRows.reduce((s,r)=>s+Number(r.total_amount||0),0);
  const serviceLifetime=serviceRows.reduce((s,r)=>s+Number(r.total_amount||0),0);
  const chemicalRows=retailRows.filter(r=>['chemical','chemicals','water care','water-care'].includes(String(r.category||'').toLowerCase()));
  const cutoff=Date.now()-365*86400000;
  const chemical12=chemicalRows.filter(r=>new Date(r.transaction_date).getTime()>=cutoff).reduce((s,r)=>s+Number(r.total_amount||0),0);
  const lastRetail=retailRows[0]?.transaction_date||null;
  const lastChemical=chemicalRows[0]?.transaction_date||null;
  const lastService=calls[0]?(calls[0].scheduled_start||calls[0].created_at):null;
  const firstDates=[customer.created_at,...retailRows.map(r=>r.transaction_date),...calls.map(r=>r.created_at)].filter(Boolean).map(x=>new Date(x).getTime()).filter(Number.isFinite);
  const customerSince=firstDates.length?new Date(Math.min(...firstDates)).toISOString():customer.created_at;
  let relationship='One-Time / Low Activity';
  if(chemical12>=500)relationship='Strong Chemical Customer';
  else if(chemical12>0)relationship='Active Chemical Customer';
  else if(retailRows.length>1||serviceRows.length>1)relationship='Repeat Customer';
  else if(equipment.rows.length&&retailRows.length<=1)relationship='Equipment Buyer — Low Follow-Up';
  const timeline=[];
  for(const r of retailRows)timeline.push({type:'purchase',date:r.transaction_date,title:r.description,detail:[r.category,r.brand,r.model].filter(Boolean).join(' · '),amount:Number(r.total_amount||0),transaction_number:r.transaction_number});
  for(const w of calls)timeline.push({type:'service',date:w.scheduled_start||w.created_at,title:w.work_order_number,detail:[w.complaint,w.equipment_type,w.brand,w.model].filter(Boolean).join(' · '),amount:null,status:w.status});
  for(const i of serviceRows)timeline.push({type:'invoice',date:i.created_at,title:i.invoice_number,detail:`Service invoice · ${i.status}`,amount:Number(i.total_amount||0),status:i.status});
  timeline.sort((a,b)=>new Date(b.date)-new Date(a.date));
  res.json({customer,summary:{relationship,lifetime_retail:num(retailLifetime),lifetime_service:num(serviceLifetime),lifetime_total:num(retailLifetime+serviceLifetime),chemical_12_months:num(chemical12),chemical_purchase_count:chemicalRows.length,last_retail_purchase:lastRetail,last_chemical_purchase:lastChemical,last_service:lastService,products_owned:equipment.rows.length,service_calls:calls.length,customer_since:customerSince},retail:retailRows,serviceInvoices:serviceRows,serviceCalls:calls,equipment:equipment.rows,timeline});
});

router.post('/customers/:id/retail-transactions',auth,async(req,res)=>{
  const b=req.body||{};
  if(!clean(b.description))return res.status(400).json({error:'Description is required'});
  const customer=(await q('SELECT id FROM service_customers WHERE id=$1',[req.params.id])).rows[0];
  if(!customer)return res.status(404).json({error:'Customer not found'});
  const subtotal=num(b.subtotal),tax=num(b.tax_amount),total=b.total_amount==null?num(subtotal+tax):num(b.total_amount);
  const r=await q(`INSERT INTO service_retail_transactions(customer_id,transaction_date,transaction_number,category,description,brand,model,serial_number,quantity,subtotal,tax_amount,total_amount,salesperson,source,source_record_id,notes)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,[req.params.id,b.transaction_date||new Date().toISOString(),clean(b.transaction_number),clean(b.category)||'retail',clean(b.description),clean(b.brand),clean(b.model),clean(b.serial_number),Math.max(.01,Number(b.quantity)||1),subtotal,tax,total,clean(b.salesperson),clean(b.source)||'manual',clean(b.source_record_id),clean(b.notes)]);
  res.status(201).json(r.rows[0]);
});

export default router;
