import express from 'express';
import jwt from 'jsonwebtoken';
import { q } from './service-db.js';

const router=express.Router();
const clean=v=>v==null?null:String(v).trim();
const money=v=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;
const qty=v=>Math.max(.01,Number(v)||1);
function secret(){if(!process.env.SERVICE_JWT_SECRET)throw new Error('SERVICE_JWT_SECRET is required');return process.env.SERVICE_JWT_SECRET}
function auth(req,res,next){try{const raw=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');if(!raw)return res.status(401).json({error:'Login required'});req.user=jwt.verify(raw,secret());next()}catch{res.status(401).json({error:'Session expired or invalid'})}}
function isFullOps(req){
  const role=String(req.user?.role||'').toLowerCase();
  if(['admin','owner','manager','service_manager'].includes(role))return true;
  const allow=(process.env.SERVICE_FULL_OPS_USERS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
  return allow.includes(String(req.user?.username||'').toLowerCase());
}
function fullOps(req,res,next){if(!isFullOps(req))return res.status(403).json({error:'Ray/Rick manager permission required'});next()}

export async function initCustomerOrderControls(){
  await q(`
    CREATE TABLE IF NOT EXISTS service_order_product_catalog (
      id BIGSERIAL PRIMARY KEY,
      product_id TEXT,
      sku TEXT UNIQUE,
      description TEXT NOT NULL,
      unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      source TEXT NOT NULL DEFAULT 'online',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_service_order_catalog_desc ON service_order_product_catalog USING gin (to_tsvector('english',description));

    CREATE TABLE IF NOT EXISTS service_order_discount_codes (
      id BIGSERIAL PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      description TEXT,
      discount_type TEXT NOT NULL DEFAULT 'percent',
      discount_value NUMERIC(12,2) NOT NULL DEFAULT 0,
      minimum_subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
      maximum_discount NUMERIC(12,2),
      starts_at TIMESTAMPTZ,
      ends_at TIMESTAMPTZ,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS service_order_discounts (
      id BIGSERIAL PRIMARY KEY,
      order_id BIGINT NOT NULL REFERENCES service_customer_orders(id) ON DELETE CASCADE,
      discount_code_id BIGINT REFERENCES service_order_discount_codes(id),
      code TEXT NOT NULL,
      description TEXT,
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      applied_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(order_id,code)
    );
  `);
}

async function logChange({customerId,orderId=null,recurringOrderId=null,action,description,actor}){
  await q(`INSERT INTO service_order_change_log(customer_id,order_id,recurring_order_id,action,description,actor) VALUES($1,$2,$3,$4,$5,$6)`,[customerId,orderId,recurringOrderId,action,description,actor||null]);
}
async function recalcOrder(orderId){
  const [s,d]=await Promise.all([
    q('SELECT coalesce(sum(line_total),0)::numeric subtotal FROM service_customer_order_items WHERE order_id=$1',[orderId]),
    q('SELECT coalesce(sum(amount),0)::numeric discounts FROM service_order_discounts WHERE order_id=$1',[orderId])
  ]);
  const subtotal=money(s.rows[0].subtotal),discounts=Math.min(subtotal,money(d.rows[0].discounts));
  return (await q(`UPDATE service_customer_orders SET subtotal=$2,total_amount=greatest(0,$2-$3)+tax_amount+shipping_amount,updated_at=NOW() WHERE id=$1 RETURNING *`,[orderId,subtotal,discounts])).rows[0];
}
async function catalogItem(b){
  if(b.catalog_id){return (await q('SELECT * FROM service_order_product_catalog WHERE id=$1 AND active=true',[b.catalog_id])).rows[0]||null}
  if(clean(b.sku)){return (await q('SELECT * FROM service_order_product_catalog WHERE lower(sku)=lower($1) AND active=true',[clean(b.sku)])).rows[0]||null}
  return null;
}

router.get('/order-product-catalog',auth,async(req,res)=>{
  const term=`%${clean(req.query.q)||''}%`;
  const r=await q(`SELECT * FROM service_order_product_catalog WHERE active=true AND (description ILIKE $1 OR sku ILIKE $1 OR product_id ILIKE $1) ORDER BY description LIMIT 100`,[term]);
  res.json(r.rows);
});
router.post('/order-product-catalog',auth,fullOps,async(req,res)=>{
  const b=req.body||{},description=clean(b.description);if(!description)return res.status(400).json({error:'Description required'});
  const r=(await q(`INSERT INTO service_order_product_catalog(product_id,sku,description,unit_price,source) VALUES($1,$2,$3,$4,$5) ON CONFLICT(sku) DO UPDATE SET product_id=excluded.product_id,description=excluded.description,unit_price=excluded.unit_price,active=true,source=excluded.source,updated_at=NOW() RETURNING *`,[clean(b.product_id),clean(b.sku),description,money(b.unit_price),clean(b.source)||'online'])).rows[0];
  res.status(201).json(r);
});

router.get('/order-discount-codes',auth,async(req,res)=>{
  const rows=(await q(`SELECT id,code,description,discount_type,discount_value,minimum_subtotal,maximum_discount,starts_at,ends_at FROM service_order_discount_codes WHERE active=true AND (starts_at IS NULL OR starts_at<=NOW()) AND (ends_at IS NULL OR ends_at>=NOW()) ORDER BY code`)).rows;
  res.json(rows);
});
router.post('/order-discount-codes',auth,fullOps,async(req,res)=>{
  const b=req.body||{},code=String(b.code||'').trim().toUpperCase();if(!code)return res.status(400).json({error:'Code required'});
  const type=clean(b.discount_type)||'percent';if(!['percent','fixed'].includes(type))return res.status(400).json({error:'discount_type must be percent or fixed'});
  const r=(await q(`INSERT INTO service_order_discount_codes(code,description,discount_type,discount_value,minimum_subtotal,maximum_discount,starts_at,ends_at,active,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[code,clean(b.description),type,money(b.discount_value),money(b.minimum_subtotal),b.maximum_discount==null?null:money(b.maximum_discount),b.starts_at||null,b.ends_at||null,b.active!==false,req.user?.name||req.user?.username])).rows[0];
  res.status(201).json(r);
});
router.patch('/order-discount-codes/:id',auth,fullOps,async(req,res)=>{
  const cur=(await q('SELECT * FROM service_order_discount_codes WHERE id=$1',[req.params.id])).rows[0];if(!cur)return res.status(404).json({error:'Discount code not found'});
  const b=req.body||{},type=clean(b.discount_type)||cur.discount_type;if(!['percent','fixed'].includes(type))return res.status(400).json({error:'Invalid discount type'});
  const r=(await q(`UPDATE service_order_discount_codes SET description=coalesce($2,description),discount_type=$3,discount_value=$4,minimum_subtotal=$5,maximum_discount=$6,starts_at=$7,ends_at=$8,active=$9,updated_at=NOW() WHERE id=$1 RETURNING *`,[req.params.id,clean(b.description),type,money(b.discount_value??cur.discount_value),money(b.minimum_subtotal??cur.minimum_subtotal),b.maximum_discount===undefined?cur.maximum_discount:(b.maximum_discount==null?null:money(b.maximum_discount)),b.starts_at===undefined?cur.starts_at:(b.starts_at||null),b.ends_at===undefined?cur.ends_at:(b.ends_at||null),b.active===undefined?cur.active:Boolean(b.active)])).rows[0];
  res.json(r);
});

router.get('/orders/:id/discounts',auth,async(req,res)=>res.json((await q('SELECT * FROM service_order_discounts WHERE order_id=$1 ORDER BY created_at',[req.params.id])).rows));
router.post('/orders/:id/apply-discount-code',auth,async(req,res)=>{
  const order=(await q('SELECT * FROM service_customer_orders WHERE id=$1',[req.params.id])).rows[0];if(!order)return res.status(404).json({error:'Order not found'});
  if(['shipped','cancelled'].includes(order.status))return res.status(409).json({error:'This order can no longer be edited'});
  const code=String(req.body?.code||'').trim().toUpperCase();if(!code)return res.status(400).json({error:'Discount code required'});
  const c=(await q(`SELECT * FROM service_order_discount_codes WHERE code=$1 AND active=true AND (starts_at IS NULL OR starts_at<=NOW()) AND (ends_at IS NULL OR ends_at>=NOW())`,[code])).rows[0];
  if(!c)return res.status(400).json({error:'Discount code is invalid or inactive'});
  const subtotal=money((await q('SELECT coalesce(sum(line_total),0)::numeric n FROM service_customer_order_items WHERE order_id=$1',[order.id])).rows[0].n);
  if(subtotal<Number(c.minimum_subtotal||0))return res.status(400).json({error:`Order must be at least $${Number(c.minimum_subtotal).toFixed(2)} for this code`});
  let amount=c.discount_type==='percent'?subtotal*(Number(c.discount_value)/100):Number(c.discount_value);if(c.maximum_discount!=null)amount=Math.min(amount,Number(c.maximum_discount));amount=money(Math.min(subtotal,Math.max(0,amount)));
  const d=(await q(`INSERT INTO service_order_discounts(order_id,discount_code_id,code,description,amount,applied_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(order_id,code) DO UPDATE SET amount=excluded.amount,description=excluded.description,applied_by=excluded.applied_by RETURNING *`,[order.id,c.id,c.code,c.description,amount,req.user?.name||req.user?.username])).rows[0];
  const updated=await recalcOrder(order.id);
  await logChange({customerId:order.customer_id,orderId:order.id,action:'discount_code_applied',description:`Applied approved code ${c.code}: -$${amount.toFixed(2)}`,actor:req.user?.name||req.user?.username});
  res.json({discount:d,order:updated});
});
router.delete('/orders/:orderId/discounts/:id',auth,fullOps,async(req,res)=>{
  const order=(await q('SELECT * FROM service_customer_orders WHERE id=$1',[req.params.orderId])).rows[0];if(!order)return res.status(404).json({error:'Order not found'});
  const d=(await q('DELETE FROM service_order_discounts WHERE id=$1 AND order_id=$2 RETURNING *',[req.params.id,req.params.orderId])).rows[0];if(!d)return res.status(404).json({error:'Discount not found'});
  const updated=await recalcOrder(order.id);await logChange({customerId:order.customer_id,orderId:order.id,action:'discount_removed',description:`Removed discount ${d.code}`,actor:req.user?.name||req.user?.username});res.json({ok:true,order:updated});
});

// These routes intentionally mount before legacy customer-order routes to enforce permissions.
router.post('/customers/:id/recurring-orders',auth,fullOps,(req,res,next)=>next());
router.patch('/recurring-orders/:id',auth,fullOps,(req,res,next)=>next());
router.patch('/orders/:id',auth,fullOps,(req,res,next)=>next());
router.delete('/orders/:orderId/items/:itemId',auth,fullOps,(req,res,next)=>next());

router.post('/orders/:id/add-item',auth,async(req,res)=>{
  const order=(await q('SELECT * FROM service_customer_orders WHERE id=$1',[req.params.id])).rows[0];if(!order)return res.status(404).json({error:'Order not found'});
  if(['shipped','cancelled'].includes(order.status))return res.status(409).json({error:'This order can no longer be edited'});
  const b=req.body||{},scope=clean(b.scope)||'one_time';if(!['one_time','recurring'].includes(scope))return res.status(400).json({error:'scope must be one_time or recurring'});
  const cat=await catalogItem(b);if(!cat&&!isFullOps(req))return res.status(400).json({error:'Sales/service staff must select an approved product from the order pricebook'});
  const description=cat?.description||clean(b.description);if(!description)return res.status(400).json({error:'Product description required'});
  const quantity=qty(b.quantity),unitPrice=cat?money(cat.unit_price):money(b.unit_price),lineTotal=money(quantity*unitPrice);
  let recurringItemId=null,recurringOrderId=order.recurring_order_id||b.recurring_order_id||null;
  if(scope==='recurring'){
    if(!recurringOrderId)return res.status(400).json({error:'Choose an auto-ship before adding a recurring item'});
    const sub=(await q('SELECT * FROM service_recurring_orders WHERE id=$1 AND customer_id=$2 AND status<>\'cancelled\'',[recurringOrderId,order.customer_id])).rows[0];if(!sub)return res.status(404).json({error:'Auto-ship not found'});
    recurringItemId=(await q(`INSERT INTO service_recurring_order_items(recurring_order_id,product_id,sku,description,quantity,unit_price) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[recurringOrderId,cat?.product_id||clean(b.product_id),cat?.sku||clean(b.sku),description,quantity,unitPrice])).rows[0].id;
  }
  const item=(await q(`INSERT INTO service_customer_order_items(order_id,recurring_order_item_id,product_id,sku,description,quantity,unit_price,line_total,item_scope) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[order.id,recurringItemId,cat?.product_id||clean(b.product_id),cat?.sku||clean(b.sku),description,quantity,unitPrice,lineTotal,scope])).rows[0];
  const updated=await recalcOrder(order.id);await logChange({customerId:order.customer_id,orderId:order.id,recurringOrderId:scope==='recurring'?recurringOrderId:null,action:scope==='recurring'?'item_added_recurring':'item_added_one_time',description:`Added ${quantity} × ${description} at approved price $${unitPrice.toFixed(2)} (${scope==='recurring'?'future auto-ship too':'this shipment only'})`,actor:req.user?.name||req.user?.username});res.status(201).json({item,order:updated});
});

router.patch('/orders/:orderId/items/:itemId',auth,async(req,res)=>{
  const item=(await q(`SELECT i.*,o.customer_id,o.status order_status,o.order_number FROM service_customer_order_items i JOIN service_customer_orders o ON o.id=i.order_id WHERE i.id=$1 AND i.order_id=$2`,[req.params.itemId,req.params.orderId])).rows[0];if(!item)return res.status(404).json({error:'Order item not found'});
  if(['shipped','cancelled'].includes(item.order_status))return res.status(409).json({error:'This order can no longer be edited'});
  const b=req.body||{},quantity=qty(b.quantity??item.quantity),description=clean(b.description)||item.description;
  if(!isFullOps(req)&&b.unit_price!=null&&money(b.unit_price)!==money(item.unit_price))return res.status(403).json({error:'Sales/service staff cannot change prices. Use an approved discount code.'});
  const unitPrice=isFullOps(req)&&b.unit_price!=null?money(b.unit_price):money(item.unit_price);
  const updated=(await q(`UPDATE service_customer_order_items SET description=$3,quantity=$4,unit_price=$5,line_total=$4*$5,updated_at=NOW() WHERE id=$1 AND order_id=$2 RETURNING *`,[req.params.itemId,req.params.orderId,description,quantity,unitPrice])).rows[0];
  if(item.recurring_order_item_id&&b.update_recurring===true){await q(`UPDATE service_recurring_order_items SET description=$2,quantity=$3,unit_price=$4,updated_at=NOW() WHERE id=$1`,[item.recurring_order_item_id,description,quantity,unitPrice])}
  const order=await recalcOrder(req.params.orderId);await logChange({customerId:item.customer_id,orderId:req.params.orderId,action:'item_updated',description:`Updated ${description}; price ${isFullOps(req)?'manager-controlled':'unchanged'}${item.recurring_order_item_id&&b.update_recurring===true?' and future auto-ship updated':''}`,actor:req.user?.name||req.user?.username});res.json({item:updated,order});
});

export default router;
