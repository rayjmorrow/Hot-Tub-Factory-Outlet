import express from 'express';
import jwt from 'jsonwebtoken';
import {q} from './service-db.js';

const router=express.Router();
const DEPARTMENTS=['monroeville_sales','wexford_sales','online_sales','service'];
const validDate=value=>/^\\d{4}-\\d{2}-\\d{2}$/.test(String(value||''))?String(value):null;
function ownerOnly(req,res,next){
 try{
  const bearer=String(req.get('authorization')||'').replace(/^Bearer\\s+/i,'');
  const user=jwt.verify(bearer,process.env.SERVICE_JWT_SECRET);
  if(String(user.role||'').toLowerCase()!=='owner'&&String(user.role||'').toLowerCase()!=='admin')
   return res.status(403).json({error:'Owner-only departmental reporting'});
  next();
 }catch{return res.status(401).json({error:'Login required'})}
}
router.get('/htfo-departments/summary',ownerOnly,async(req,res)=>{
 try{
  const from=validDate(req.query.from)||new Date().toISOString().slice(0,7)+'-01';
  const to=validDate(req.query.to)||new Date().toISOString().slice(0,10);
  if(from>to)return res.status(400).json({error:'Invalid report date range'});
  const [signed,retail,online,service]=await Promise.all([
   q(`SELECT coalesce(nullif(executed_document->>'sales_department',''),'unassigned') department,
    count(*)::int count,
    coalesce(sum((executed_document->'totals'->>'total')::numeric),0)::numeric total_cents,
    coalesce(sum((executed_document->'totals'->>'paid')::numeric),0)::numeric recorded_paid_cents
    FROM crm_sales_executed_contracts
    WHERE executed_at::date BETWEEN $1::date AND $2::date GROUP BY 1`,[from,to]),
   q(`SELECT department,payment_status,count(*)::int count,
    coalesce(sum(total_cents),0)::numeric total_cents
    FROM htfo_pos_receipts WHERE created_at::date BETWEEN $1::date AND $2::date
    GROUP BY department,payment_status`,[from,to]),
   q(`SELECT sales_department department,count(*)::int count,
    coalesce(sum(total_amount),0)::numeric gross_usd
    FROM service_customer_orders
    WHERE source='online' AND created_at::date BETWEEN $1::date AND $2::date
    GROUP BY sales_department`,[from,to]),
   q(`SELECT coalesce(sum(amount),0)::numeric collected_usd,count(*)::int count
    FROM service_payments WHERE received_at::date BETWEEN $1::date AND $2::date`,[from,to])
  ]);
  const byDepartment=Object.fromEntries(DEPARTMENTS.map(k=>[k,{department:k,signed_agreements:0,signed_contract_value_cents:0,
   agreement_recorded_paid_cents:0,retail_unpaid_drafts:0,retail_unpaid_draft_cents:0,online_fulfillment_orders:0,
   online_order_gross_usd:0,service_payments_collected_usd:0}]));
  const unassigned=[];
  function target(k){if(!byDepartment[k]){const row={department:k};unassigned.push(row);return row}return byDepartment[k]}
  for(const x of signed.rows){const d=target(x.department);d.signed_agreements=Number(x.count);d.signed_contract_value_cents=Number(x.total_cents);d.agreement_recorded_paid_cents=Number(x.recorded_paid_cents)}
  for(const x of retail.rows){const d=target(x.department);if(x.payment_status==='unpaid'){d.retail_unpaid_drafts=Number(x.count);d.retail_unpaid_draft_cents=Number(x.total_cents)}}
  for(const x of online.rows){const d=target(x.department);d.online_fulfillment_orders=Number(x.count);d.online_order_gross_usd=Number(x.gross_usd)}
  byDepartment.service.service_payments_collected_usd=Number(service.rows[0]?.collected_usd||0);
  res.set('Cache-Control','no-store');
  res.json({from,to,departments:byDepartment,unassigned,notes:[
   'Signed agreement totals are contract values, not verified settlement or recognized revenue.',
   'Retail unpaid drafts are not collected sales; they are excluded from paid revenue.',
   'Online fulfillment amounts are recorded after payment handoff, not bank-reconciled deposits.',
   'Service payment totals are collected payments, not service profitability.',
   'Historical records without an assigned department are not automatically attributed.'
  ]});
 }catch(e){res.status(503).json({error:'Department reporting unavailable until all source tables are ready'})}
});
export default router;
