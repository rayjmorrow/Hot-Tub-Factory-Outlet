import express from 'express';
import jwt from 'jsonwebtoken';
import { q } from './service-db.js';
import { calculateTripCharge } from './service-financials.js';

const router=express.Router();
const clean=v=>v==null?null:String(v).trim();
const num=v=>Number(v||0);
function secret(){if(!process.env.SERVICE_JWT_SECRET)throw new Error('SERVICE_JWT_SECRET is required');return process.env.SERVICE_JWT_SECRET}
function auth(req,res,next){try{const raw=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');if(!raw)return res.status(401).json({error:'Login required'});req.user=jwt.verify(raw,secret());next()}catch{res.status(401).json({error:'Session expired or invalid'})}}
function manager(req,res,next){if(!['admin','manager','service_manager'].includes(req.user?.role))return res.status(403).json({error:'Service manager permission required'});next()}

router.get('/trip-charge/preview',auth,(req,res)=>{
  const minutes=Math.max(0,num(req.query.minutes));
  res.json({travel_minutes:minutes,calculated_trip_charge:calculateTripCharge(minutes),rule:'$80 through 30 minutes; then +$15 per additional 15-minute block'});
});

router.patch('/work-orders/:id/trip-charge',auth,manager,async(req,res)=>{
  const minutes=Math.max(0,num(req.body?.travel_minutes));
  const override=req.body?.override_amount===null||req.body?.override_amount===''||req.body?.override_amount===undefined?null:Math.max(0,num(req.body.override_amount));
  const reason=clean(req.body?.override_reason), source=clean(req.body?.travel_time_source)||'manager_entered';
  const calc=calculateTripCharge(minutes);
  const r=await q(`UPDATE service_work_orders SET travel_minutes=$2,calculated_trip_charge=$3,trip_charge_override=$4,trip_charge_override_reason=$5,travel_time_source=$6,trip_amount=$7,updated_at=NOW() WHERE id=$1 RETURNING id,work_order_number,travel_minutes,calculated_trip_charge,trip_charge_override,trip_charge_override_reason,trip_amount,travel_time_source`,[req.params.id,minutes,calc,override,reason,source,override??calc]);
  if(!r.rowCount)return res.status(404).json({error:'Work order not found'});
  res.json(r.rows[0]);
});

router.get('/warranty-claims',auth,async(req,res)=>{
  const status=clean(req.query.status);
  const params=[];let where='';if(status){params.push(status);where='WHERE wc.status=$1'}
  const r=await q(`SELECT wc.*,w.work_order_number,concat_ws(' ',c.first_name,c.last_name) customer_name,(wc.total_claimed-wc.total_paid) outstanding FROM service_warranty_claims wc JOIN service_work_orders w ON w.id=wc.work_order_id JOIN service_customers c ON c.id=w.customer_id ${where} ORDER BY wc.created_at DESC LIMIT 500`,params);
  res.json(r.rows);
});

router.post('/work-orders/:id/warranty-claim',auth,manager,async(req,res)=>{
  const b=req.body||{};
  const labor=num(b.labor_claimed),parts=num(b.parts_claimed),trip=num(b.trip_claimed),other=num(b.other_claimed),total=labor+parts+trip+other;
  const r=await q(`INSERT INTO service_warranty_claims(work_order_id,supplier,claim_number,status,labor_claimed,parts_claimed,trip_claimed,other_claimed,total_claimed,total_approved,total_paid,submitted_at,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,[req.params.id,clean(b.supplier),clean(b.claim_number),clean(b.status)||'draft',labor,parts,trip,other,total,num(b.total_approved),num(b.total_paid),b.submitted_at||null,clean(b.notes)]);
  res.status(201).json(r.rows[0]);
});

router.patch('/warranty-claims/:id',auth,manager,async(req,res)=>{
  const b=req.body||{};
  const r=await q(`UPDATE service_warranty_claims SET claim_number=coalesce($2,claim_number),status=coalesce($3,status),total_approved=coalesce($4,total_approved),total_paid=coalesce($5,total_paid),submitted_at=coalesce($6,submitted_at),approved_at=coalesce($7,approved_at),paid_at=coalesce($8,paid_at),payment_reference=coalesce($9,payment_reference),denial_reason=coalesce($10,denial_reason),notes=coalesce($11,notes),updated_at=NOW() WHERE id=$1 RETURNING *`,[req.params.id,clean(b.claim_number),clean(b.status),b.total_approved==null?null:num(b.total_approved),b.total_paid==null?null:num(b.total_paid),b.submitted_at||null,b.approved_at||null,b.paid_at||null,clean(b.payment_reference),clean(b.denial_reason),clean(b.notes)]);
  if(!r.rowCount)return res.status(404).json({error:'Warranty claim not found'});
  res.json(r.rows[0]);
});

router.get('/warranty-summary',auth,async(req,res)=>{
  const r=await q(`SELECT coalesce(sum(total_claimed),0)::numeric claimed,coalesce(sum(total_approved),0)::numeric approved,coalesce(sum(total_paid),0)::numeric paid,coalesce(sum(total_claimed-total_paid),0)::numeric outstanding,count(*) FILTER (WHERE status NOT IN ('paid','denied','closed'))::int open_claims FROM service_warranty_claims`);
  res.json(r.rows[0]);
});

export default router;
