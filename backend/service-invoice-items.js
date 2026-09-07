import express from 'express';
import jwt from 'jsonwebtoken';
import { q } from './service-db.js';

const router=express.Router();
const clean=v=>v==null?null:String(v).trim();
const num=v=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;
const secret=()=>{if(!process.env.SERVICE_JWT_SECRET)throw new Error('SERVICE_JWT_SECRET is required');return process.env.SERVICE_JWT_SECRET};
function auth(req,res,next){try{const raw=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');if(!raw)return res.status(401).json({error:'Login required'});req.user=jwt.verify(raw,secret());next()}catch{res.status(401).json({error:'Session expired or invalid'})}}
function canDiscount(req){
  const configured=String(process.env.SERVICE_CHARGE_OVERRIDE_USERS||'ray,rick').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
  const identities=[req.user?.username,req.user?.name].map(x=>String(x||'').trim().toLowerCase()).filter(Boolean);
  return identities.some(x=>configured.includes(x));
}
function discountManager(req,res,next){if(!canDiscount(req))return res.status(403).json({error:'Only authorized HTFO charge managers can apply or remove discounts'});next()}

export async function initServiceInvoiceItems(){
  await q(`
    CREATE TABLE IF NOT EXISTS service_invoice_line_items (
      id BIGSERIAL PRIMARY KEY,
      work_order_id BIGINT NOT NULL REFERENCES service_work_orders(id) ON DELETE CASCADE,
      invoice_id BIGINT REFERENCES service_invoices(id) ON DELETE SET NULL,
      part_id BIGINT REFERENCES service_parts(id),
      item_type TEXT NOT NULL DEFAULT 'part',
      description TEXT NOT NULL,
      sku TEXT,
      quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
      unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      line_total NUMERIC(12,2) NOT NULL DEFAULT 0,
      taxable BOOLEAN NOT NULL DEFAULT TRUE,
      added_by_user_id BIGINT REFERENCES service_users(id),
      added_by_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_service_invoice_items_wo ON service_invoice_line_items(work_order_id);
    CREATE INDEX IF NOT EXISTS idx_service_invoice_items_invoice ON service_invoice_line_items(invoice_id);

    CREATE TABLE IF NOT EXISTS service_invoice_discounts (
      id BIGSERIAL PRIMARY KEY,
      work_order_id BIGINT NOT NULL REFERENCES service_work_orders(id) ON DELETE CASCADE,
      invoice_id BIGINT REFERENCES service_invoices(id) ON DELETE SET NULL,
      discount_type TEXT NOT NULL,
      applies_to TEXT NOT NULL DEFAULT 'subtotal',
      value NUMERIC(12,2) NOT NULL,
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      reason TEXT NOT NULL,
      approved_by_user_id BIGINT REFERENCES service_users(id),
      approved_by_name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_service_invoice_discounts_wo ON service_invoice_discounts(work_order_id);
    CREATE INDEX IF NOT EXISTS idx_service_invoice_discounts_invoice ON service_invoice_discounts(invoice_id);
  `);
}

async function sellPrice(part){
  if(part.sell_price!=null&&Number(part.sell_price)>0)return num(part.sell_price);
  const rules=(await q(`SELECT * FROM service_pricing_rules WHERE active=true AND (category IS NULL OR lower(category)=lower($1)) ORDER BY CASE WHEN category IS NULL THEN 1 ELSE 0 END,priority,id`,[part.category||''])).rows;
  let price=Number(part.cost||0),r=rules[0];
  if(r){
    if(r.rule_type==='markup_percent')price=Number(part.cost||0)*(1+Number(r.value||0)/100);
    else if(r.rule_type==='margin_percent')price=Number(part.cost||0)/(1-(Number(r.value||0)/100));
    else if(r.rule_type==='multiplier')price=Number(part.cost||0)*Number(r.value||0);
    else if(r.rule_type==='fixed_add')price=Number(part.cost||0)+Number(r.value||0);
    if(r.minimum_profit!=null)price=Math.max(price,Number(part.cost||0)+Number(r.minimum_profit));
    if(r.minimum_sell!=null)price=Math.max(price,Number(r.minimum_sell));
  } else if(part.list_price!=null&&Number(part.list_price)>0) price=Number(part.list_price);
  return num(price);
}

async function recalc(workOrderId){
  const w=(await q('SELECT * FROM service_work_orders WHERE id=$1',[workOrderId])).rows[0];
  if(!w)throw new Error('Work order not found');
  const items=(await q('SELECT * FROM service_invoice_line_items WHERE work_order_id=$1 ORDER BY id',[workOrderId])).rows;
  const discounts=(await q('SELECT * FROM service_invoice_discounts WHERE work_order_id=$1 ORDER BY id',[workOrderId])).rows;
  const parts=num(items.filter(x=>x.item_type==='part').reduce((s,x)=>s+Number(x.line_total||0),0));
  const diagnostic=num(w.diagnostic_amount),labor=num(w.labor_amount),trip=num(w.trip_amount);
  const base={parts,diagnostic,labor,trip,subtotal:num(parts+diagnostic+labor+trip)};
  let partsDiscount=0,totalDiscount=0;
  for(const d of discounts){
    const target=d.applies_to==='parts'?parts:d.applies_to==='labor'?labor:d.applies_to==='diagnostic'?diagnostic:d.applies_to==='trip'?trip:base.subtotal;
    let amount=d.discount_type==='percent'?num(target*(Number(d.value||0)/100)):num(d.value);
    amount=Math.max(0,Math.min(target,amount));
    totalDiscount=num(totalDiscount+amount);
    if(d.applies_to==='parts')partsDiscount=num(partsDiscount+amount);
    if(Number(d.amount)!==amount)await q('UPDATE service_invoice_discounts SET amount=$2 WHERE id=$1',[d.id,amount]);
  }
  totalDiscount=Math.min(base.subtotal,totalDiscount);
  const taxableParts=Math.max(0,parts-Math.min(parts,partsDiscount));
  const tax=num(taxableParts*0.07);
  const subtotalAfter=num(base.subtotal-totalDiscount),total=num(subtotalAfter+tax);
  await q('UPDATE service_work_orders SET parts_amount=$2,tax_amount=$3,total_amount=$4,updated_at=NOW() WHERE id=$1',[workOrderId,parts,tax,total]);
  const inv=(await q('SELECT * FROM service_invoices WHERE work_order_id=$1 ORDER BY created_at DESC LIMIT 1',[workOrderId])).rows[0];
  if(inv){
    await q('UPDATE service_invoice_line_items SET invoice_id=$2 WHERE work_order_id=$1 AND invoice_id IS NULL',[workOrderId,inv.id]);
    await q('UPDATE service_invoice_discounts SET invoice_id=$2 WHERE work_order_id=$1 AND invoice_id IS NULL',[workOrderId,inv.id]);
    await q(`UPDATE service_invoices SET subtotal=$2,tax_amount=$3,total_amount=$4,status=CASE WHEN amount_paid >= $4 THEN 'paid' WHEN amount_paid>0 THEN 'partial' ELSE 'open' END,updated_at=NOW() WHERE id=$1`,[inv.id,subtotalAfter,tax,total]);
  }
  return {parts_subtotal:parts,discount_total:totalDiscount,subtotal:subtotalAfter,tax,total};
}

router.get('/work-orders/:id/invoice-items',auth,async(req,res)=>{
  const [items,discounts]=await Promise.all([
    q(`SELECT li.*,p.brand,p.manufacturer_part_number,p.supplier_part_number FROM service_invoice_line_items li LEFT JOIN service_parts p ON p.id=li.part_id WHERE li.work_order_id=$1 ORDER BY li.id`,[req.params.id]),
    q('SELECT * FROM service_invoice_discounts WHERE work_order_id=$1 ORDER BY created_at,id',[req.params.id])
  ]);
  const totals=await recalc(req.params.id);
  res.json({items:items.rows,discounts:discounts.rows,totals,can_discount:canDiscount(req)});
});

router.post('/work-orders/:id/invoice-items/part',auth,async(req,res)=>{
  try{
    const part=(await q('SELECT * FROM service_parts WHERE id=$1 AND active=true',[req.body?.part_id])).rows[0];
    if(!part)return res.status(404).json({error:'Part not found'});
    const qty=Math.max(.01,Number(req.body?.quantity)||1),unit=req.body?.unit_price==null?await sellPrice(part):num(req.body.unit_price),line=num(qty*unit);
    const r=await q(`INSERT INTO service_invoice_line_items(work_order_id,part_id,item_type,description,sku,quantity,unit_price,line_total,taxable,added_by_user_id,added_by_name)
      VALUES($1,$2,'part',$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[req.params.id,part.id,part.description,part.manufacturer_part_number||part.supplier_part_number,qty,unit,line,part.taxable!==false,req.user?.sub||null,req.user?.name||req.user?.username||'HTFO staff']);
    const totals=await recalc(req.params.id);res.status(201).json({item:r.rows[0],totals});
  }catch(e){res.status(400).json({error:e.message})}
});

router.delete('/work-orders/:id/invoice-items/:itemId',auth,async(req,res)=>{
  const r=await q('DELETE FROM service_invoice_line_items WHERE id=$1 AND work_order_id=$2 RETURNING *',[req.params.itemId,req.params.id]);
  if(!r.rowCount)return res.status(404).json({error:'Line item not found'});
  const totals=await recalc(req.params.id);res.json({ok:true,totals});
});

router.post('/work-orders/:id/discounts',auth,discountManager,async(req,res)=>{
  const b=req.body||{},type=clean(b.discount_type)||'fixed',applies=clean(b.applies_to)||'subtotal',reason=clean(b.reason),value=num(b.value);
  if(!['fixed','percent'].includes(type))return res.status(400).json({error:'Discount type must be fixed or percent'});
  if(!['subtotal','parts','labor','diagnostic','trip'].includes(applies))return res.status(400).json({error:'Invalid discount target'});
  if(value<=0)return res.status(400).json({error:'Discount value must be greater than zero'});
  if(type==='percent'&&value>100)return res.status(400).json({error:'Percent discount cannot exceed 100%'});
  if(!reason)return res.status(400).json({error:'A discount reason is required'});
  const r=await q(`INSERT INTO service_invoice_discounts(work_order_id,discount_type,applies_to,value,reason,approved_by_user_id,approved_by_name)
    VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[req.params.id,type,applies,value,reason,req.user?.sub||null,req.user?.name||req.user?.username||'Authorized manager']);
  const totals=await recalc(req.params.id);res.status(201).json({discount:r.rows[0],totals});
});

router.delete('/work-orders/:id/discounts/:discountId',auth,discountManager,async(req,res)=>{
  const r=await q('DELETE FROM service_invoice_discounts WHERE id=$1 AND work_order_id=$2 RETURNING *',[req.params.discountId,req.params.id]);
  if(!r.rowCount)return res.status(404).json({error:'Discount not found'});
  const totals=await recalc(req.params.id);res.json({ok:true,totals});
});

export default router;
