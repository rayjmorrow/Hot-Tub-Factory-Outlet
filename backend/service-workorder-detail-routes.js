import express from 'express';
import jwt from 'jsonwebtoken';
import { q } from './service-db.js';

const router=express.Router();
const secret=()=>{
  if(!process.env.SERVICE_JWT_SECRET) throw new Error('SERVICE_JWT_SECRET is required');
  return process.env.SERVICE_JWT_SECRET;
};
function auth(req,res,next){
  try{
    const raw=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
    if(!raw) return res.status(401).json({error:'Login required'});
    req.user=jwt.verify(raw,secret());
    next();
  }catch{ res.status(401).json({error:'Session expired or invalid'}); }
}
const canDelete=req=>['admin','owner','manager','service_manager'].includes(req.user?.role);

router.get('/work-orders/:id/detail',auth,async(req,res)=>{
  const r=await q(`SELECT w.*,concat_ws(' ',c.first_name,c.last_name) customer_name,c.phone,c.email,c.street,c.street2,c.city,c.state,c.zip,
    e.equipment_type,e.brand,e.model,e.serial_number,e.install_date,e.warranty_expires
    FROM service_work_orders w
    JOIN service_customers c ON c.id=w.customer_id
    LEFT JOIN service_equipment e ON e.id=w.equipment_id
    WHERE w.id=$1`,[req.params.id]);
  if(!r.rowCount) return res.status(404).json({error:'Work order not found'});
  const [inv,est,parts]=await Promise.all([
    q('SELECT id,invoice_number,status,total_amount,amount_paid FROM service_invoices WHERE work_order_id=$1 ORDER BY created_at DESC',[req.params.id]),
    q('SELECT id,estimate_number,status,total_amount FROM service_estimates WHERE work_order_id=$1 ORDER BY created_at DESC',[req.params.id]),
    q('SELECT id,status,requested_quantity,source_status,source_name FROM service_part_requests WHERE work_order_id=$1 ORDER BY created_at DESC',[req.params.id])
  ]);
  let deliveryOrder=null,deliveryOrderItems=[];
  const workOrder=r.rows[0];
  if(String(workOrder.job_type||'').toLowerCase()==='delivery' && workOrder.customer_order_id){
    deliveryOrder=(await q('SELECT id,order_number,status,total_amount,amount_paid,delivery_exception_authorized,delivery_exception_reason,source FROM service_customer_orders WHERE id=$1',[workOrder.customer_order_id])).rows[0]||null;
    deliveryOrderItems=(await q('SELECT id,description,quantity,sku,unit_price,line_total FROM service_customer_order_items WHERE order_id=$1 ORDER BY id',[workOrder.customer_order_id])).rows;
  }
  res.json({workOrder,invoices:inv.rows,estimates:est.rows,partRequests:parts.rows,deliveryOrder,deliveryOrderItems,canDelete:canDelete(req)});
});

router.delete('/work-orders/:id',auth,async(req,res)=>{
  if(!canDelete(req)) return res.status(403).json({error:'Manager permission required to delete a work order'});
  const w=await q('SELECT * FROM service_work_orders WHERE id=$1',[req.params.id]);
  if(!w.rowCount) return res.status(404).json({error:'Work order not found'});
  const invoice=await q('SELECT id,invoice_number,status FROM service_invoices WHERE work_order_id=$1 LIMIT 1',[req.params.id]);
  if(invoice.rowCount) return res.status(409).json({error:`This work order has invoice ${invoice.rows[0].invoice_number}. Remove or void the invoice before deleting the work order.`});
  if(w.rows[0].status==='completed') return res.status(409).json({error:'Completed work orders cannot be deleted. Cancel or correct the record instead.'});
  await q('UPDATE service_requests SET work_order_id=NULL,updated_at=NOW() WHERE work_order_id=$1',[req.params.id]);
  await q('DELETE FROM service_work_orders WHERE id=$1',[req.params.id]);
  res.json({ok:true,deleted_work_order:w.rows[0].work_order_number});
});

export default router;
