import express from 'express';
import jwt from 'jsonwebtoken';
import { q } from './service-db.js';

const router=express.Router();
function secret(){if(!process.env.SERVICE_JWT_SECRET)throw new Error('SERVICE_JWT_SECRET is required');return process.env.SERVICE_JWT_SECRET}
function auth(req,res,next){try{const raw=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');if(!raw)return res.status(401).json({error:'Login required'});req.user=jwt.verify(raw,secret());next()}catch{res.status(401).json({error:'Session expired or invalid'})}}\nfunction canManage(req){return ['admin','owner','manager','service_manager'].includes(String(req.user?.role||'').toLowerCase())}\nfunction canAccessWorkOrder(req,w){if(canManage(req))return true;const who=String(req.user?.name||req.user?.username||'').trim().toLowerCase();return [w.assigned_to,w.assigned_team].some(v=>String(v||'').trim().toLowerCase()===who)}

router.get('/field/work-orders/:id',auth,async(req,res)=>{
  const w=await q(`SELECT w.*,concat_ws(' ',c.first_name,c.last_name) customer_name,c.phone,c.email,c.street,c.street2,c.city,c.state,c.zip,e.equipment_type,e.brand,e.model,e.serial_number FROM service_work_orders w JOIN service_customers c ON c.id=w.customer_id LEFT JOIN service_equipment e ON e.id=w.equipment_id WHERE w.id=$1`,[req.params.id]);
  if(!w.rowCount)return res.status(404).json({error:'Work order not found'});\n  if(!canAccessWorkOrder(req,w.rows[0]))return res.status(403).json({error:'This job is not assigned to you'});
  const inv=await q(`SELECT *,total_amount-amount_paid balance FROM service_invoices WHERE work_order_id=$1 ORDER BY created_at DESC LIMIT 1`,[req.params.id]);
  const payments=inv.rowCount?await q(`SELECT amount,payment_method,reference_number,collected_by_name,received_at FROM service_payments WHERE invoice_id=$1 ORDER BY received_at DESC`,[inv.rows[0].id]):{rows:[]};
  res.json({workOrder:w.rows[0],invoice:inv.rows[0]||null,payments:payments.rows});
});


function clean(v){return v==null?null:String(v).trim()}
function bool(v){return v===true||v===1||v==='1'||String(v).toLowerCase()==='true'}

router.patch('/field/deliveries/:id/progress',auth,async(req,res)=>{
  const w=(await q('SELECT * FROM service_work_orders WHERE id=$1',[req.params.id])).rows[0];
  if(!w)return res.status(404).json({error:'Delivery not found'});
  if(String(w.job_type||'')!=='delivery')return res.status(400).json({error:'This work order is not a delivery'});
  const b=req.body||{};
  const r=(await q(`UPDATE service_work_orders SET
    delivery_serial_number=coalesce($2,delivery_serial_number),
    delivery_cover_lifter=coalesce($3,delivery_cover_lifter),
    delivery_exception_notes=coalesce($4,delivery_exception_notes),
    delivery_correct_spa=coalesce($5,delivery_correct_spa),
    delivery_package_confirmed=coalesce($6,delivery_package_confirmed),
    delivery_damage_reviewed=coalesce($7,delivery_damage_reviewed),
    delivery_customer_reviewed=coalesce($8,delivery_customer_reviewed),
    delivery_acceptance_confirmed=coalesce($9,delivery_acceptance_confirmed),
    delivery_signature_accepted=coalesce($10,delivery_signature_accepted),
    delivery_proof_photo=coalesce($11,delivery_proof_photo),
    delivery_happy_photo=coalesce($12,delivery_happy_photo),
    delivery_signature_data=coalesce($13,delivery_signature_data),
    updated_at=NOW()
    WHERE id=$1 RETURNING *`,[
      req.params.id,
      b.serial_number===undefined?null:clean(b.serial_number),
      b.cover_lifter===undefined?null:clean(b.cover_lifter),
      b.exception_notes===undefined?null:clean(b.exception_notes),
      b.correct_spa===undefined?null:bool(b.correct_spa),
      b.package_confirmed===undefined?null:bool(b.package_confirmed),
      b.damage_reviewed===undefined?null:bool(b.damage_reviewed),
      b.customer_reviewed===undefined?null:bool(b.customer_reviewed),
      b.acceptance_confirmed===undefined?null:bool(b.acceptance_confirmed),
      b.signature_accepted===undefined?null:bool(b.signature_accepted),
      b.proof_photo===undefined?null:String(b.proof_photo||''),
      b.happy_photo===undefined?null:String(b.happy_photo||''),
      b.signature_data===undefined?null:String(b.signature_data||'')
    ])).rows[0];
  res.json(r);
});

router.post('/field/deliveries/:id/complete',auth,async(req,res)=>{
  const w=(await q('SELECT * FROM service_work_orders WHERE id=$1',[req.params.id])).rows[0];
  if(!w)return res.status(404).json({error:'Delivery not found'});
  if(String(w.job_type||'')!=='delivery')return res.status(400).json({error:'This work order is not a delivery'});
  const missing=[];
  if(!clean(w.delivery_serial_number))missing.push('serial number');
  if(!w.delivery_correct_spa)missing.push('correct spa verification');
  if(!w.delivery_package_confirmed)missing.push('included items verification');
  if(!w.delivery_damage_reviewed)missing.push('damage/backorder review');
  if(!w.delivery_proof_photo)missing.push('proof-of-delivery photo');
  if(!w.delivery_happy_photo)missing.push('happy picture');
  if(!w.delivery_customer_reviewed)missing.push('customer review');
  if(!w.delivery_acceptance_confirmed)missing.push('customer acknowledgement');
  if(!w.delivery_signature_accepted||!w.delivery_signature_data)missing.push('accepted customer signature');
  if(missing.length)return res.status(409).json({error:'Delivery cannot be completed. Missing: '+missing.join(', '),missing});
  const actor=req.user?.name||req.user?.username||'Delivery';
  const updated=(await q(`UPDATE service_work_orders SET status='completed',completed_at=NOW(),delivery_completed_by=$2,customer_signature=delivery_signature_data,updated_at=NOW() WHERE id=$1 RETURNING *`,[req.params.id,actor])).rows[0];
  if(updated.equipment_id && clean(updated.delivery_serial_number)){
    await q('UPDATE service_equipment SET serial_number=$2,updated_at=NOW() WHERE id=$1',[updated.equipment_id,clean(updated.delivery_serial_number)]);
  }
  res.json({ok:true,workOrder:updated});
});

export default router;
