import express from 'express';
import jwt from 'jsonwebtoken';
import { q } from './service-db.js';

const router=express.Router();
const secret=()=>{if(!process.env.SERVICE_JWT_SECRET)throw new Error('SERVICE_JWT_SECRET is required');return process.env.SERVICE_JWT_SECRET};
const clean=v=>v==null?null:String(v).trim();
const num=v=>Number(v||0);
const money=v=>Math.round(num(v)*100)/100;
function auth(req,res,next){try{const raw=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');if(!raw)return res.status(401).json({error:'Login required'});req.user=jwt.verify(raw,secret());next()}catch{res.status(401).json({error:'Session expired or invalid'})}}
function manager(req,res,next){if(!['admin','manager','service_manager'].includes(String(req.user?.role||'').toLowerCase()))return res.status(403).json({error:'Service manager approval required'});next()}

async function sellPrice(part){
  if(part.sell_price!=null && Number(part.sell_price)>0) return money(part.sell_price);
  const rules=(await q(`SELECT * FROM service_pricing_rules WHERE active=true AND (category IS NULL OR lower(category)=lower($1)) ORDER BY CASE WHEN category IS NULL THEN 1 ELSE 0 END,priority,id`,[part.category||''])).rows;
  let price=num(part.cost);
  const r=rules[0];
  if(r){
    if(r.rule_type==='markup_percent') price=num(part.cost)*(1+num(r.value)/100);
    else if(r.rule_type==='margin_percent') price=num(part.cost)/(1-(num(r.value)/100));
    else if(r.rule_type==='multiplier') price=num(part.cost)*num(r.value);
    else if(r.rule_type==='fixed_add') price=num(part.cost)+num(r.value);
    if(r.minimum_profit!=null) price=Math.max(price,num(part.cost)+num(r.minimum_profit));
    if(r.minimum_sell!=null) price=Math.max(price,num(r.minimum_sell));
  } else if(part.list_price!=null && Number(part.list_price)>0) price=num(part.list_price);
  return money(price);
}

router.get('/parts',auth,async(req,res)=>{
  const term=clean(req.query.q)||'';
  const r=await q(`SELECT * FROM service_parts WHERE active=true AND (supplier_part_number ILIKE $1 OR manufacturer_part_number ILIKE $1 OR description ILIKE $1 OR brand ILIKE $1 OR category ILIKE $1) ORDER BY description LIMIT 100`,[`%${term}%`]);
  const rows=[];for(const p of r.rows)rows.push({...p,calculated_sell_price:await sellPrice(p)});res.json(rows);
});

router.post('/parts/import',auth,manager,async(req,res)=>{
  const rows=Array.isArray(req.body?.rows)?req.body.rows:[];let inserted=0,updated=0;
  for(const b of rows){
    const supplierNo=clean(b.supplier_part_number||b.part_number||b.sku),mfgNo=clean(b.manufacturer_part_number||b.mfg_part_number),desc=clean(b.description||b.name);
    if(!desc)continue;
    let hit=null;
    if(supplierNo)hit=(await q('SELECT id FROM service_parts WHERE lower(coalesce(supplier,$1))=lower(coalesce($1,supplier)) AND lower(supplier_part_number)=lower($2) LIMIT 1',[clean(b.supplier),supplierNo])).rows[0];
    if(!hit&&mfgNo)hit=(await q('SELECT id FROM service_parts WHERE lower(manufacturer_part_number)=lower($1) LIMIT 1',[mfgNo])).rows[0];
    const vals=[clean(b.supplier),supplierNo,mfgNo,desc,clean(b.brand),clean(b.category),money(b.cost),b.list_price==null?null:money(b.list_price),b.sell_price==null?null:money(b.sell_price),b.taxable!==false,clean(b.supplier_url),b.source_updated_at||null];
    if(hit){await q(`UPDATE service_parts SET supplier=$2,supplier_part_number=$3,manufacturer_part_number=$4,description=$5,brand=$6,category=$7,cost=$8,list_price=$9,sell_price=$10,taxable=$11,supplier_url=$12,source_updated_at=$13,updated_at=NOW() WHERE id=$1`,[hit.id,...vals]);updated++}
    else{await q(`INSERT INTO service_parts(supplier,supplier_part_number,manufacturer_part_number,description,brand,category,cost,list_price,sell_price,taxable,supplier_url,source_updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,vals);inserted++}
  }
  res.json({inserted,updated,total:rows.length});
});

router.get('/pricing-rules',auth,async(req,res)=>res.json((await q('SELECT * FROM service_pricing_rules ORDER BY priority,id')).rows));
router.post('/pricing-rules',auth,manager,async(req,res)=>{
  const b=req.body||{};const r=await q(`INSERT INTO service_pricing_rules(name,category,rule_type,value,minimum_sell,minimum_profit,priority) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[clean(b.name)||'Default Parts Pricing',clean(b.category),clean(b.rule_type)||'markup_percent',num(b.value),b.minimum_sell==null?null:money(b.minimum_sell),b.minimum_profit==null?null:money(b.minimum_profit),Number(b.priority||100)]);res.status(201).json(r.rows[0]);
});

router.post('/work-orders/:id/estimate',auth,async(req,res)=>{
  const wo=(await q('SELECT * FROM service_work_orders WHERE id=$1',[req.params.id])).rows[0];if(!wo)return res.status(404).json({error:'Work order not found'});
  const items=Array.isArray(req.body?.items)?req.body.items:[];
  const estNo=`EST-${new Date().getFullYear()}-${Date.now().toString().slice(-7)}`;
  let partsSubtotal=0,taxableSubtotal=0;const priced=[];
  for(const i of items){
    const p=(await q('SELECT * FROM service_parts WHERE id=$1',[i.part_id])).rows[0];if(!p)continue;
    const qty=Math.max(.01,num(i.quantity)||1),unit=await sellPrice(p),line=money(qty*unit);partsSubtotal+=line;if(p.taxable)taxableSubtotal+=line;priced.push({part:p,qty,unit,line});
  }
  const labor=money(req.body?.labor_amount??wo.labor_amount),trip=money(req.body?.trip_amount??wo.trip_amount),taxRate=num(req.body?.tax_rate||0),tax=money((taxableSubtotal+(req.body?.tax_labor?labor:0))*taxRate),total=money(partsSubtotal+labor+trip+tax);
  const est=(await q(`INSERT INTO service_estimates(estimate_number,work_order_id,customer_id,status,labor_amount,trip_amount,tax_amount,total_amount,customer_note,manager_note) VALUES($1,$2,$3,'draft',$4,$5,$6,$7,$8,$9) RETURNING *`,[estNo,wo.id,wo.customer_id,labor,trip,tax,total,clean(req.body?.customer_note),clean(req.body?.manager_note)])).rows[0];
  for(const x of priced){await q(`INSERT INTO service_estimate_items(estimate_id,part_id,description,quantity,unit_cost,unit_price,line_total,taxable) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[est.id,x.part.id,x.part.description,x.qty,num(x.part.cost),x.unit,x.line,x.part.taxable])}
  const full=(await q('SELECT * FROM service_estimate_items WHERE estimate_id=$1 ORDER BY id',[est.id])).rows;
  res.status(201).json({...est,parts_subtotal:money(partsSubtotal),items:full});
});

router.get('/estimates/:id',auth,async(req,res)=>{
  const e=(await q(`SELECT e.*,w.work_order_number,concat_ws(' ',c.first_name,c.last_name) customer_name,c.email,c.phone FROM service_estimates e JOIN service_work_orders w ON w.id=e.work_order_id JOIN service_customers c ON c.id=e.customer_id WHERE e.id=$1`,[req.params.id])).rows[0];if(!e)return res.status(404).json({error:'Estimate not found'});e.items=(await q('SELECT * FROM service_estimate_items WHERE estimate_id=$1 ORDER BY id',[e.id])).rows;res.json(e);
});
router.patch('/estimates/:id/status',auth,async(req,res)=>{
  const status=clean(req.body?.status);if(!['draft','sent','approved','rejected','expired'].includes(status))return res.status(400).json({error:'Invalid estimate status'});
  const r=await q(`UPDATE service_estimates SET status=$2,approved_at=CASE WHEN $2='approved' THEN NOW() ELSE approved_at END,rejected_at=CASE WHEN $2='rejected' THEN NOW() ELSE rejected_at END,updated_at=NOW() WHERE id=$1 RETURNING *`,[req.params.id,status]);if(!r.rowCount)return res.status(404).json({error:'Estimate not found'});res.json(r.rows[0]);
});

router.post('/work-orders/:id/part-request',auth,async(req,res)=>{
  const b=req.body||{};const p=(await q('SELECT id FROM service_parts WHERE id=$1',[b.part_id])).rows[0];if(!p)return res.status(404).json({error:'Part not found'});
  const r=await q(`INSERT INTO service_part_requests(work_order_id,estimate_id,part_id,requested_by,requested_quantity,status,notes) VALUES($1,$2,$3,$4,$5,'requested',$6) RETURNING *`,[req.params.id,b.estimate_id||null,b.part_id,req.user.name||req.user.username,Math.max(.01,num(b.quantity)||1),clean(b.notes)]);res.status(201).json(r.rows[0]);
});
router.get('/part-requests',auth,async(req,res)=>{
  const r=await q(`SELECT pr.*,p.description,p.supplier,p.supplier_part_number,p.manufacturer_part_number,p.cost,w.work_order_number,concat_ws(' ',c.first_name,c.last_name) customer_name FROM service_part_requests pr JOIN service_parts p ON p.id=pr.part_id JOIN service_work_orders w ON w.id=pr.work_order_id JOIN service_customers c ON c.id=w.customer_id ORDER BY CASE pr.status WHEN 'requested' THEN 0 WHEN 'approved' THEN 1 WHEN 'ordered' THEN 2 ELSE 3 END,pr.created_at DESC`);res.json(r.rows);
});
router.patch('/part-requests/:id/approve',auth,manager,async(req,res)=>{
  const r=await q(`UPDATE service_part_requests SET status='approved',manager_approved_by=$2,manager_approved_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *`,[req.params.id,req.user.name||req.user.username]);if(!r.rowCount)return res.status(404).json({error:'Part request not found'});res.json(r.rows[0]);
});
router.patch('/part-requests/:id/order',auth,manager,async(req,res)=>{
  const orderNo=clean(req.body?.supplier_order_number);const r=await q(`UPDATE service_part_requests SET status='ordered',supplier_order_number=$2,ordered_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *`,[req.params.id,orderNo]);if(!r.rowCount)return res.status(404).json({error:'Part request not found'});res.json(r.rows[0]);
});
router.patch('/part-requests/:id/receive',auth,manager,async(req,res)=>{
  const r=await q(`UPDATE service_part_requests SET status='received',received_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *`,[req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Part request not found'});res.json(r.rows[0]);
});

export default router;
