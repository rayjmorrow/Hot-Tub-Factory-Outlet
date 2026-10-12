import express from 'express';
import jwt from 'jsonwebtoken';
import { q } from './service-db.js';

const router=express.Router();
const clean=v=>v==null?null:String(v).trim();
const num=v=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;
function secret(){if(!process.env.SERVICE_JWT_SECRET)throw new Error('SERVICE_JWT_SECRET is required');return process.env.SERVICE_JWT_SECRET}
function auth(req,res,next){try{const raw=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');if(!raw)return res.status(401).json({error:'Login required'});req.user=jwt.verify(raw,secret());next()}catch{return res.status(401).json({error:'Session expired or invalid'})}}
function financeOwner(req,res,next){
  const allowed=String(process.env.SERVICE_FINANCIALS_OWNER_USERS||'ray,ray morrow,raymond morrow').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
  const ids=[req.user?.username,req.user?.name].map(x=>String(x||'').trim().toLowerCase()).filter(Boolean);
  const isOwner=String(req.user?.role||'').toLowerCase()==='owner'||ids.some(x=>allowed.includes(x));
  if(!isOwner)return res.status(403).json({error:'Owner-only financial access'});
  next();
}

async function ensure(){
  await q(`CREATE TABLE IF NOT EXISTS service_department_expenses(
    id BIGSERIAL PRIMARY KEY,
    expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
    expense_type TEXT NOT NULL DEFAULT 'other',
    employee_name TEXT,
    description TEXT NOT NULL,
    amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'manual',
    reference TEXT,
    notes TEXT,
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await q('CREATE INDEX IF NOT EXISTS idx_service_department_expenses_date ON service_department_expenses(expense_date)');
  await q('CREATE INDEX IF NOT EXISTS idx_service_department_expenses_type ON service_department_expenses(expense_type)');
}

function period(req){
  const now=new Date(),from=clean(req.query.from)||new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)).toISOString().slice(0,10),to=clean(req.query.to)||new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,0)).toISOString().slice(0,10);
  return{from,to};
}

router.get('/financials/summary',auth,financeOwner,async(req,res)=>{try{
  await ensure();const {from,to}=period(req);
  const [ar,warranty,collections,delivery,expenses,parts,wo]=await Promise.all([
    q(`SELECT coalesce(sum(greatest(total_amount-amount_paid,0)),0)::numeric outstanding,
      count(*) FILTER(WHERE total_amount-amount_paid>0.009)::int open_invoices,
      coalesce(sum(greatest(total_amount-amount_paid,0)) FILTER(WHERE created_at<CURRENT_DATE-INTERVAL '30 days'),0)::numeric over_30
      FROM service_invoices`),
    q(`SELECT coalesce(sum(greatest(total_claimed-total_paid,0)),0)::numeric outstanding,
      coalesce(sum(total_paid) FILTER(WHERE paid_at::date BETWEEN $1::date AND $2::date),0)::numeric paid_period,
      count(*) FILTER(WHERE greatest(total_claimed-total_paid,0)>0.009)::int open_claims
      FROM service_warranty_claims`,[from,to]),
    q(`SELECT coalesce(sum(amount),0)::numeric collected FROM service_payments WHERE received_at::date BETWEEN $1::date AND $2::date`,[from,to]),
    q(`SELECT count(*)::int deliveries,coalesce(count(*)*400,0)::numeric internal_revenue
      FROM service_work_orders WHERE lower(coalesce(job_type,''))='delivery' AND lower(coalesce(status,''))='completed'
      AND coalesce(completed_at,updated_at,created_at)::date BETWEEN $1::date AND $2::date`,[from,to]),
    q(`SELECT coalesce(sum(amount),0)::numeric total,
      coalesce(sum(amount) FILTER(WHERE expense_type='payroll'),0)::numeric payroll,
      coalesce(sum(amount) FILTER(WHERE expense_type<>'payroll'),0)::numeric other
      FROM service_department_expenses WHERE expense_date BETWEEN $1::date AND $2::date`,[from,to]),
    q(`SELECT coalesce(sum(coalesce(p.cost,0)*li.quantity),0)::numeric cost
      FROM service_invoice_line_items li
      LEFT JOIN service_parts p ON p.id=li.part_id
      JOIN service_work_orders w ON w.id=li.work_order_id
      WHERE lower(coalesce(w.status,''))='completed'
      AND coalesce(w.completed_at,w.updated_at,w.created_at)::date BETWEEN $1::date AND $2::date`,[from,to]),
    q(`SELECT count(*) FILTER(WHERE lower(coalesce(status,''))='completed' AND lower(coalesce(job_type,''))='service')::int completed_service,
      count(*) FILTER(WHERE lower(coalesce(status,''))='completed' AND lower(coalesce(job_type,''))='delivery')::int completed_delivery
      FROM service_work_orders WHERE coalesce(completed_at,updated_at,created_at)::date BETWEEN $1::date AND $2::date`,[from,to])
  ]);
  const customerCollected=num(collections.rows[0].collected),warrantyPaid=num(warranty.rows[0].paid_period),deliveryRevenue=num(delivery.rows[0].internal_revenue),payroll=num(expenses.rows[0].payroll),other=num(expenses.rows[0].other),partsCost=num(parts.rows[0].cost);
  const revenue=num(customerCollected+warrantyPaid+deliveryRevenue),costs=num(payroll+other+partsCost),profit=num(revenue-costs);
  res.json({period:{from,to},collections:{customer_collected:customerCollected,warranty_credits_received:warrantyPaid,delivery_internal_revenue:deliveryRevenue,delivery_rate:400,total_revenue:revenue},receivables:{customer_ar:num(ar.rows[0].outstanding),customer_open_invoices:ar.rows[0].open_invoices,customer_over_30:num(ar.rows[0].over_30),warranty_receivable:num(warranty.rows[0].outstanding),warranty_open_claims:warranty.rows[0].open_claims,total_open:num(num(ar.rows[0].outstanding)+num(warranty.rows[0].outstanding))},costs:{payroll,parts_cost:partsCost,other,total:costs},profit_loss:{net:profit,self_sustaining:profit>=0},activity:{completed_service:wo.rows[0].completed_service,completed_deliveries:wo.rows[0].completed_delivery}});
}catch(e){res.status(500).json({error:e.message})}});

router.get('/financials/open-balances',auth,financeOwner,async(req,res)=>{try{
  const rows=(await q(`SELECT i.id invoice_id,i.invoice_number,i.total_amount,i.amount_paid,(i.total_amount-i.amount_paid) balance,i.created_at,
    greatest(0,(CURRENT_DATE-i.created_at::date))::int age_days,w.id work_order_id,w.work_order_number,w.status work_order_status,
    concat_ws(' ',c.first_name,c.last_name) customer_name,c.phone,c.email,
    coalesce(ps.payment_status,'needed') payment_status,ps.card_brand,ps.card_last_four
    FROM service_invoices i
    LEFT JOIN service_work_orders w ON w.id=i.work_order_id
    JOIN service_customers c ON c.id=i.customer_id
    LEFT JOIN service_customer_payment_settings ps ON ps.customer_id=i.customer_id
    WHERE i.total_amount-i.amount_paid>0.009 ORDER BY age_days DESC,balance DESC`)).rows;
  res.json(rows);
}catch(e){res.status(500).json({error:e.message})}});

router.get('/financials/work-order-history',auth,financeOwner,async(req,res)=>{try{
  const {from,to}=period(req);
  const rows=(await q(`SELECT w.id,w.work_order_number,w.job_type,w.status,w.warranty,w.scheduled_start,w.completed_at,w.assigned_to,
    concat_ws(' ',c.first_name,c.last_name) customer_name,e.brand,e.model,e.serial_number,
    coalesce(i.total_amount,0) billed,coalesce(i.amount_paid,0) paid,greatest(coalesce(i.total_amount,0)-coalesce(i.amount_paid,0),0) balance,
    coalesce(sum(wc.total_claimed),0) warranty_claimed,coalesce(sum(wc.total_paid),0) warranty_paid,
    greatest(coalesce(sum(wc.total_claimed),0)-coalesce(sum(wc.total_paid),0),0) warranty_outstanding,
    CASE WHEN lower(coalesce(w.job_type,''))='delivery' AND lower(coalesce(w.status,''))='completed' THEN 400 ELSE 0 END delivery_internal_revenue
    FROM service_work_orders w JOIN service_customers c ON c.id=w.customer_id
    LEFT JOIN service_equipment e ON e.id=w.equipment_id
    LEFT JOIN service_invoices i ON i.id=(SELECT id FROM service_invoices ii WHERE ii.work_order_id=w.id ORDER BY created_at DESC LIMIT 1)
    LEFT JOIN service_warranty_claims wc ON wc.work_order_id=w.id
    WHERE coalesce(w.completed_at,w.scheduled_start,w.created_at)::date BETWEEN $1::date AND $2::date
    GROUP BY w.id,c.first_name,c.last_name,e.brand,e.model,e.serial_number,i.total_amount,i.amount_paid
    ORDER BY coalesce(w.completed_at,w.scheduled_start,w.created_at) DESC`,[from,to])).rows;
  res.json(rows);
}catch(e){res.status(500).json({error:e.message})}});

router.get('/financials/warranty-receivables',auth,financeOwner,async(req,res)=>{try{
  const rows=(await q(`SELECT wc.*,w.work_order_number,concat_ws(' ',c.first_name,c.last_name) customer_name,
    (wc.total_claimed-wc.total_paid) outstanding,
    greatest(0,(CURRENT_DATE-coalesce(wc.submitted_at,wc.created_at)::date))::int age_days
    FROM service_warranty_claims wc JOIN service_work_orders w ON w.id=wc.work_order_id JOIN service_customers c ON c.id=w.customer_id
    WHERE wc.total_claimed-wc.total_paid>0.009 ORDER BY age_days DESC,outstanding DESC`)).rows;
  res.json(rows);
}catch(e){res.status(500).json({error:e.message})}});

router.get('/financials/expenses',auth,financeOwner,async(req,res)=>{try{await ensure();const {from,to}=period(req);res.json((await q('SELECT * FROM service_department_expenses WHERE expense_date BETWEEN $1::date AND $2::date ORDER BY expense_date DESC,id DESC',[from,to])).rows)}catch(e){res.status(500).json({error:e.message})}});
router.post('/financials/expenses',auth,financeOwner,async(req,res)=>{try{
  await ensure();const b=req.body||{},amount=num(b.amount),description=clean(b.description);
  if(amount<=0||!description)return res.status(400).json({error:'Description and amount are required'});
  const r=await q(`INSERT INTO service_department_expenses(expense_date,expense_type,employee_name,description,amount,source,reference,notes,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[b.expense_date||new Date().toISOString().slice(0,10),clean(b.expense_type)||'other',clean(b.employee_name),description,amount,clean(b.source)||'manual',clean(b.reference),clean(b.notes),clean(req.user?.name)||clean(req.user?.username)]);
  res.status(201).json(r.rows[0]);
}catch(e){res.status(500).json({error:e.message})}});

router.post('/financials/expenses/import',auth,financeOwner,async(req,res)=>{try{
  await ensure();const rows=Array.isArray(req.body?.rows)?req.body.rows:[];let inserted=0,skipped=0;
  for(const b of rows){const amount=num(b.amount),description=clean(b.description)||clean(b.memo)||'Payroll / service expense';if(amount<=0){skipped++;continue}
    await q(`INSERT INTO service_department_expenses(expense_date,expense_type,employee_name,description,amount,source,reference,notes,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[b.expense_date||b.date||new Date().toISOString().slice(0,10),clean(b.expense_type)||'payroll',clean(b.employee_name)||clean(b.employee),description,amount,clean(b.source)||'csv',clean(b.reference)||clean(b.check_number),clean(b.notes),clean(req.user?.name)||clean(req.user?.username)]);inserted++}
  res.json({inserted,skipped,total:rows.length});
}catch(e){res.status(500).json({error:e.message})}});

export default router;