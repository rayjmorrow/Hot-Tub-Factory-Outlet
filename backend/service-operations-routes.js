import express from 'express';
import jwt from 'jsonwebtoken';
import { q } from './service-db.js';

const router=express.Router();
const clean=v=>v==null?null:String(v).trim();
function secret(){if(!process.env.SERVICE_JWT_SECRET)throw new Error('SERVICE_JWT_SECRET is required');return process.env.SERVICE_JWT_SECRET}
function auth(req,res,next){try{const raw=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');if(!raw)return res.status(401).json({error:'Login required'});req.user=jwt.verify(raw,secret());next()}catch{res.status(401).json({error:'Session expired or invalid'})}}

router.get('/dispatch-resources',auth,async(req,res)=>{
  const r=await q(`SELECT id,name,resource_type,sort_order FROM service_dispatch_resources WHERE active=true ORDER BY sort_order,name`);
  res.json(r.rows);
});

router.get('/calendar',auth,async(req,res)=>{
  const from=clean(req.query.from),to=clean(req.query.to),assigned=clean(req.query.assigned),jobType=clean(req.query.job_type);
  if(!from||!to)return res.status(400).json({error:'from and to are required'});
  const params=[from,to];
  let where=`w.scheduled_start >= $1 AND w.scheduled_start < $2`;
  if(assigned&&assigned!=='all'){params.push(assigned);where+=` AND COALESCE(w.assigned_to,w.assigned_team)=$${params.length}`}
  if(jobType&&jobType!=='all'){params.push(jobType);where+=` AND w.job_type=$${params.length}`}
  const r=await q(`SELECT w.id,w.work_order_number,w.customer_id,w.equipment_id,w.job_type,w.status,w.priority,w.scheduled_start,w.scheduled_end,w.appointment_minutes,w.assigned_to,w.assigned_team,w.complaint,w.part_source_status,w.part_source_name,w.expected_part_date,w.pickup_required,w.scheduling_note,w.total_amount,
    concat_ws(' ',c.first_name,c.last_name) customer_name,c.phone,c.street,c.city,c.state,c.zip,
    e.equipment_type,e.brand,e.model,e.serial_number,
    COALESCE(ps.payment_status,'needed') payment_status,ps.card_brand,ps.card_last_four
    FROM service_work_orders w
    JOIN service_customers c ON c.id=w.customer_id
    LEFT JOIN service_equipment e ON e.id=w.equipment_id
    LEFT JOIN service_customer_payment_settings ps ON ps.customer_id=w.customer_id
    WHERE ${where}
    ORDER BY w.scheduled_start`,params);
  res.json(r.rows);
});

router.get('/work-orders/:id/detail',auth,async(req,res)=>{
  const w=await q(`SELECT w.*,concat_ws(' ',c.first_name,c.last_name) customer_name,c.phone,c.email,c.street,c.street2,c.city,c.state,c.zip,
    e.equipment_type,e.brand,e.model,e.serial_number,e.install_date,e.warranty_expires,e.location_notes,
    COALESCE(ps.payment_status,'needed') payment_status,ps.card_brand,ps.card_last_four
    FROM service_work_orders w JOIN service_customers c ON c.id=w.customer_id
    LEFT JOIN service_equipment e ON e.id=w.equipment_id
    LEFT JOIN service_customer_payment_settings ps ON ps.customer_id=w.customer_id
    WHERE w.id=$1`,[req.params.id]);
  if(!w.rowCount)return res.status(404).json({error:'Work order not found'});
  const [invoice,parts,warranty]=await Promise.all([
    q('SELECT * FROM service_invoices WHERE work_order_id=$1 ORDER BY created_at DESC LIMIT 1',[req.params.id]),
    q(`SELECT pr.*,p.description,p.brand,p.supplier,p.supplier_part_number,p.manufacturer_part_number FROM service_part_requests pr LEFT JOIN service_parts p ON p.id=pr.part_id WHERE pr.work_order_id=$1 ORDER BY pr.created_at`,[req.params.id]),
    q('SELECT * FROM service_warranty_claims WHERE work_order_id=$1 ORDER BY created_at DESC',[req.params.id])
  ]);
  let payments=[];
  if(invoice.rowCount){payments=(await q('SELECT * FROM service_payments WHERE invoice_id=$1 ORDER BY received_at DESC',[invoice.rows[0].id])).rows}
  res.json({workOrder:w.rows[0],invoice:invoice.rows[0]||null,payments,partRequests:parts.rows,warrantyClaims:warranty.rows});
});

router.get('/invoices',auth,async(req,res)=>{
  const status=clean(req.query.status),term=clean(req.query.q);
  const params=[];let where='WHERE 1=1';
  if(status&&status!=='all'){params.push(status);where+=` AND i.status=$${params.length}`}
  if(term){params.push(`%${term}%`);where+=` AND concat_ws(' ',i.invoice_number,w.work_order_number,c.first_name,c.last_name,c.phone,c.email,e.serial_number) ILIKE $${params.length}`}
  const r=await q(`SELECT i.*,w.work_order_number,w.status work_order_status,w.assigned_to,w.scheduled_start,
    concat_ws(' ',c.first_name,c.last_name) customer_name,c.phone,c.email,
    e.equipment_type,e.brand,e.model,e.serial_number,
    COALESCE(ps.payment_status,'needed') payment_status,ps.card_brand,ps.card_last_four,
    (i.total_amount-i.amount_paid) balance
    FROM service_invoices i
    LEFT JOIN service_work_orders w ON w.id=i.work_order_id
    JOIN service_customers c ON c.id=i.customer_id
    LEFT JOIN service_equipment e ON e.id=w.equipment_id
    LEFT JOIN service_customer_payment_settings ps ON ps.customer_id=i.customer_id
    ${where}
    ORDER BY i.created_at DESC LIMIT 500`,params);
  res.json(r.rows);
});

router.get('/invoices/:id/detail',auth,async(req,res)=>{
  const i=await q(`SELECT i.*,w.work_order_number,w.status work_order_status,w.assigned_to,w.complaint,w.diagnosis,w.work_performed,w.diagnostic_amount,w.labor_hours,w.labor_amount,w.parts_amount,w.trip_amount,w.tax_amount,
    concat_ws(' ',c.first_name,c.last_name) customer_name,c.phone,c.email,c.street,c.city,c.state,c.zip,
    e.equipment_type,e.brand,e.model,e.serial_number,
    COALESCE(ps.payment_status,'needed') payment_status,ps.card_brand,ps.card_last_four
    FROM service_invoices i
    LEFT JOIN service_work_orders w ON w.id=i.work_order_id
    JOIN service_customers c ON c.id=i.customer_id
    LEFT JOIN service_equipment e ON e.id=w.equipment_id
    LEFT JOIN service_customer_payment_settings ps ON ps.customer_id=i.customer_id
    WHERE i.id=$1`,[req.params.id]);
  if(!i.rowCount)return res.status(404).json({error:'Invoice not found'});
  const payments=await q('SELECT * FROM service_payments WHERE invoice_id=$1 ORDER BY received_at DESC',[req.params.id]);
  res.json({invoice:i.rows[0],payments:payments.rows});
});

export default router;
