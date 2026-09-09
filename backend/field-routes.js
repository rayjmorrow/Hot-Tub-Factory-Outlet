import express from 'express';
import jwt from 'jsonwebtoken';
import { q } from './service-db.js';

const router=express.Router();
function secret(){if(!process.env.SERVICE_JWT_SECRET)throw new Error('SERVICE_JWT_SECRET is required');return process.env.SERVICE_JWT_SECRET}
function auth(req,res,next){try{const raw=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');if(!raw)return res.status(401).json({error:'Login required'});req.user=jwt.verify(raw,secret());next()}catch{res.status(401).json({error:'Session expired or invalid'})}}

router.get('/field/work-orders/:id',auth,async(req,res)=>{
  const w=await q(`SELECT w.*,concat_ws(' ',c.first_name,c.last_name) customer_name,c.phone,c.email,c.street,c.street2,c.city,c.state,c.zip,e.equipment_type,e.brand,e.model,e.serial_number FROM service_work_orders w JOIN service_customers c ON c.id=w.customer_id LEFT JOIN service_equipment e ON e.id=w.equipment_id WHERE w.id=$1`,[req.params.id]);
  if(!w.rowCount)return res.status(404).json({error:'Work order not found'});
  const inv=await q(`SELECT *,total_amount-amount_paid balance FROM service_invoices WHERE work_order_id=$1 ORDER BY created_at DESC LIMIT 1`,[req.params.id]);
  const payments=inv.rowCount?await q(`SELECT amount,payment_method,reference_number,collected_by_name,received_at FROM service_payments WHERE invoice_id=$1 ORDER BY received_at DESC`,[inv.rows[0].id]):{rows:[]};
  res.json({workOrder:w.rows[0],invoice:inv.rows[0]||null,payments:payments.rows});
});

export default router;
