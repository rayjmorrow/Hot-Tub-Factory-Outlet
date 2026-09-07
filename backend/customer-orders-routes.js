import express from 'express';
import jwt from 'jsonwebtoken';
import { q } from './service-db.js';

const router=express.Router();
const clean=v=>v==null?null:String(v).trim();
const money=v=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;
const qty=v=>Math.max(.01,Number(v)||1);
function secret(){if(!process.env.SERVICE_JWT_SECRET)throw new Error('SERVICE_JWT_SECRET is required');return process.env.SERVICE_JWT_SECRET}
function auth(req,res,next){try{const raw=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');if(!raw)return res.status(401).json({error:'Login required'});req.user=jwt.verify(raw,secret());next()}catch{res.status(401).json({error:'Session expired or invalid'})}}

export async function initCustomerOrders(){
  await q(`
    CREATE TABLE IF NOT EXISTS service_recurring_orders (
      id BIGSERIAL PRIMARY KEY,
      customer_id BIGINT NOT NULL REFERENCES service_customers(id) ON DELETE CASCADE,
      external_subscription_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      frequency_value INT NOT NULL DEFAULT 30,
      frequency_unit TEXT NOT NULL DEFAULT 'days',
      next_ship_date DATE,
      payment_reference TEXT,
      shipping_method TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_service_recurring_customer ON service_recurring_orders(customer_id,status,next_ship_date);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_service_recurring_external ON service_recurring_orders(external_subscription_id) WHERE external_subscription_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS service_recurring_order_items (
      id BIGSERIAL PRIMARY KEY,
      recurring_order_id BIGINT NOT NULL REFERENCES service_recurring_orders(id) ON DELETE CASCADE,
      product_id TEXT,
      sku TEXT,
      description TEXT NOT NULL,
      quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
      unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS service_customer_orders (
      id BIGSERIAL PRIMARY KEY,
      customer_id BIGINT NOT NULL REFERENCES service_customers(id) ON DELETE CASCADE,
      recurring_order_id BIGINT REFERENCES service_recurring_orders(id) ON DELETE SET NULL,
      external_order_id TEXT,
      order_number TEXT,
      status TEXT NOT NULL DEFAULT 'scheduled',
      order_type TEXT NOT NULL DEFAULT 'online',
      scheduled_ship_date DATE,
      shipped_at TIMESTAMPTZ,
      subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
      tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      shipping_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'online',
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_service_orders_customer ON service_customer_orders(customer_id,scheduled_ship_date DESC,created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_service_orders_external ON service_customer_orders(external_order_id) WHERE external_order_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS service_customer_order_items (
      id BIGSERIAL PRIMARY KEY,
      order_id BIGINT NOT NULL REFERENCES service_customer_orders(id) ON DELETE CASCADE,
      recurring_order_item_id BIGINT REFERENCES service_recurring_order_items(id) ON DELETE SET NULL,
      product_id TEXT,
      sku TEXT,
      description TEXT NOT NULL,
      quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
      unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      line_total NUMERIC(12,2) NOT NULL DEFAULT 0,
      item_scope TEXT NOT NULL DEFAULT 'one_time',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS service_order_change_log (
      id BIGSERIAL PRIMARY KEY,
      customer_id BIGINT NOT NULL REFERENCES service_customers(id) ON DELETE CASCADE,
      order_id BIGINT REFERENCES service_customer_orders(id) ON DELETE SET NULL,
      recurring_order_id BIGINT REFERENCES service_recurring_orders(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      description TEXT NOT NULL,
      actor TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function recalcOrder(orderId){
  const subtotal=(await q('SELECT coalesce(sum(line_total),0)::numeric subtotal FROM service_customer_order_items WHERE order_id=$1',[orderId])).rows[0].subtotal;
  const row=(await q(`UPDATE service_customer_orders SET subtotal=$2,total_amount=$2+tax_amount+shipping_amount,updated_at=NOW() WHERE id=$1 RETURNING *`,[orderId,money(subtotal)])).rows[0];
  return row;
}
async function logChange({customerId,orderId=null,recurringOrderId=null,action,description,actor}){
  await q(`INSERT INTO service_order_change_log(customer_id,order_id,recurring_order_id,action,description,actor) VALUES($1,$2,$3,$4,$5,$6)`,[customerId,orderId,recurringOrderId,action,description,actor||null]);
}

router.get('/customers/:id/orders',auth,async(req,res)=>{
  const id=req.params.id;
  const customer=(await q('SELECT id FROM service_customers WHERE id=$1',[id])).rows[0];
  if(!customer)return res.status(404).json({error:'Customer not found'});
  const [orders,subs,changes]=await Promise.all([
    q(`SELECT * FROM service_customer_orders WHERE customer_id=$1 ORDER BY coalesce(scheduled_ship_date,created_at::date) DESC,id DESC`,[id]),
    q(`SELECT * FROM service_recurring_orders WHERE customer_id=$1 ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,next_ship_date NULLS LAST,id DESC`,[id]),
    q(`SELECT * FROM service_order_change_log WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 100`,[id])
  ]);
  const orderRows=[];
  for(const o of orders.rows){const items=(await q('SELECT * FROM service_customer_order_items WHERE order_id=$1 ORDER BY id',[o.id])).rows;orderRows.push({...o,items})}
  const subRows=[];
  for(const s of subs.rows){const items=(await q('SELECT * FROM service_recurring_order_items WHERE recurring_order_id=$1 AND active=true ORDER BY id',[s.id])).rows;subRows.push({...s,items})}
  res.json({orders:orderRows,recurringOrders:subRows,changes:changes.rows});
});

router.post('/customers/:id/orders',auth,async(req,res)=>{
  const b=req.body||{};
  const customer=(await q('SELECT id FROM service_customers WHERE id=$1',[req.params.id])).rows[0];
  if(!customer)return res.status(404).json({error:'Customer not found'});
  const orderNo=clean(b.order_number)||`ORD-${new Date().getFullYear()}-${Date.now().toString().slice(-7)}`;
  const r=(await q(`INSERT INTO service_customer_orders(customer_id,recurring_order_id,external_order_id,order_number,status,order_type,scheduled_ship_date,tax_amount,shipping_amount,source,notes)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[req.params.id,b.recurring_order_id||null,clean(b.external_order_id),orderNo,clean(b.status)||'scheduled',clean(b.order_type)||'online',b.scheduled_ship_date||null,money(b.tax_amount),money(b.shipping_amount),clean(b.source)||'online',clean(b.notes)])).rows[0];
  await logChange({customerId:req.params.id,orderId:r.id,action:'order_created',description:`Created order ${orderNo}`,actor:req.user?.name||req.user?.username});
  res.status(201).json(r);
});

router.post('/customers/:id/recurring-orders',auth,async(req,res)=>{
  const b=req.body||{};
  const customer=(await q('SELECT id FROM service_customers WHERE id=$1',[req.params.id])).rows[0];
  if(!customer)return res.status(404).json({error:'Customer not found'});
  const r=(await q(`INSERT INTO service_recurring_orders(customer_id,external_subscription_id,status,frequency_value,frequency_unit,next_ship_date,payment_reference,shipping_method,notes)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[req.params.id,clean(b.external_subscription_id),clean(b.status)||'active',Math.max(1,Number(b.frequency_value)||30),clean(b.frequency_unit)||'days',b.next_ship_date||null,clean(b.payment_reference),clean(b.shipping_method),clean(b.notes)])).rows[0];
  await logChange({customerId:req.params.id,recurringOrderId:r.id,action:'autoship_created',description:`Created ${r.frequency_value}-${r.frequency_unit} auto-ship`,actor:req.user?.name||req.user?.username});
  res.status(201).json(r);
});

router.patch('/recurring-orders/:id',auth,async(req,res)=>{
  const current=(await q('SELECT * FROM service_recurring_orders WHERE id=$1',[req.params.id])).rows[0];
  if(!current)return res.status(404).json({error:'Auto-ship not found'});
  const b=req.body||{};
  const status=clean(b.status)||current.status;
  if(!['active','paused','cancelled'].includes(status))return res.status(400).json({error:'Invalid auto-ship status'});
  const r=(await q(`UPDATE service_recurring_orders SET status=$2,frequency_value=$3,frequency_unit=$4,next_ship_date=$5,shipping_method=coalesce($6,shipping_method),notes=coalesce($7,notes),updated_at=NOW() WHERE id=$1 RETURNING *`,[req.params.id,status,Math.max(1,Number(b.frequency_value??current.frequency_value)||30),clean(b.frequency_unit)||current.frequency_unit,b.next_ship_date===undefined?current.next_ship_date:(b.next_ship_date||null),clean(b.shipping_method),clean(b.notes)])).rows[0];
  await logChange({customerId:r.customer_id,recurringOrderId:r.id,action:'autoship_updated',description:`Auto-ship updated: ${r.status}, every ${r.frequency_value} ${r.frequency_unit}${r.next_ship_date?`, next ${r.next_ship_date}`:''}`,actor:req.user?.name||req.user?.username});
  res.json(r);
});

router.patch('/orders/:id',auth,async(req,res)=>{
  const current=(await q('SELECT * FROM service_customer_orders WHERE id=$1',[req.params.id])).rows[0];
  if(!current)return res.status(404).json({error:'Order not found'});
  const b=req.body||{};
  const status=clean(b.status)||current.status;
  const r=(await q(`UPDATE service_customer_orders SET status=$2,scheduled_ship_date=$3,shipping_amount=$4,tax_amount=$5,notes=coalesce($6,notes),updated_at=NOW() WHERE id=$1 RETURNING *`,[req.params.id,status,b.scheduled_ship_date===undefined?current.scheduled_ship_date:(b.scheduled_ship_date||null),money(b.shipping_amount??current.shipping_amount),money(b.tax_amount??current.tax_amount),clean(b.notes)])).rows[0];
  const updated=await recalcOrder(r.id);
  await logChange({customerId:r.customer_id,orderId:r.id,action:'order_updated',description:`Order ${r.order_number||r.id} updated: ${status}${r.scheduled_ship_date?`, ship ${r.scheduled_ship_date}`:''}`,actor:req.user?.name||req.user?.username});
  res.json(updated);
});

router.post('/orders/:id/add-item',auth,async(req,res)=>{
  const order=(await q('SELECT * FROM service_customer_orders WHERE id=$1',[req.params.id])).rows[0];
  if(!order)return res.status(404).json({error:'Order not found'});
  if(['shipped','cancelled'].includes(order.status))return res.status(409).json({error:'This order can no longer be edited'});
  const b=req.body||{},description=clean(b.description),scope=clean(b.scope)||'one_time';
  if(!description)return res.status(400).json({error:'Product description is required'});
  if(!['one_time','recurring'].includes(scope))return res.status(400).json({error:'scope must be one_time or recurring'});
  const quantity=qty(b.quantity),unitPrice=money(b.unit_price),lineTotal=money(quantity*unitPrice);
  let recurringItemId=null,recurringOrderId=order.recurring_order_id||b.recurring_order_id||null;
  if(scope==='recurring'){
    if(!recurringOrderId)return res.status(400).json({error:'Choose an auto-ship before adding a recurring item'});
    const sub=(await q('SELECT * FROM service_recurring_orders WHERE id=$1 AND customer_id=$2',[recurringOrderId,order.customer_id])).rows[0];
    if(!sub)return res.status(404).json({error:'Auto-ship not found for this customer'});
    recurringItemId=(await q(`INSERT INTO service_recurring_order_items(recurring_order_id,product_id,sku,description,quantity,unit_price) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[recurringOrderId,clean(b.product_id),clean(b.sku),description,quantity,unitPrice])).rows[0].id;
  }
  const item=(await q(`INSERT INTO service_customer_order_items(order_id,recurring_order_item_id,product_id,sku,description,quantity,unit_price,line_total,item_scope)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[order.id,recurringItemId,clean(b.product_id),clean(b.sku),description,quantity,unitPrice,lineTotal,scope])).rows[0];
  const updated=await recalcOrder(order.id);
  await logChange({customerId:order.customer_id,orderId:order.id,recurringOrderId:scope==='recurring'?recurringOrderId:null,action:scope==='recurring'?'item_added_recurring':'item_added_one_time',description:`Added ${quantity} × ${description} to ${order.order_number||'scheduled order'} (${scope==='recurring'?'also future auto-ship':'this shipment only'})`,actor:req.user?.name||req.user?.username});
  res.status(201).json({item,order:updated});
});

router.patch('/orders/:orderId/items/:itemId',auth,async(req,res)=>{
  const item=(await q(`SELECT i.*,o.customer_id,o.status order_status,o.order_number FROM service_customer_order_items i JOIN service_customer_orders o ON o.id=i.order_id WHERE i.id=$1 AND i.order_id=$2`,[req.params.itemId,req.params.orderId])).rows[0];
  if(!item)return res.status(404).json({error:'Order item not found'});
  if(['shipped','cancelled'].includes(item.order_status))return res.status(409).json({error:'This order can no longer be edited'});
  const b=req.body||{},quantity=qty(b.quantity??item.quantity),unitPrice=money(b.unit_price??item.unit_price),description=clean(b.description)||item.description;
  const updated=(await q(`UPDATE service_customer_order_items SET description=$3,quantity=$4,unit_price=$5,line_total=$4*$5,updated_at=NOW() WHERE id=$1 AND order_id=$2 RETURNING *`,[req.params.itemId,req.params.orderId,description,quantity,unitPrice])).rows[0];
  if(item.recurring_order_item_id && b.update_recurring===true){await q(`UPDATE service_recurring_order_items SET description=$2,quantity=$3,unit_price=$4,updated_at=NOW() WHERE id=$1`,[item.recurring_order_item_id,description,quantity,unitPrice])}
  const order=await recalcOrder(req.params.orderId);
  await logChange({customerId:item.customer_id,orderId:req.params.orderId,action:'item_updated',description:`Updated ${description} on ${item.order_number||'order'}${item.recurring_order_item_id&&b.update_recurring===true?' and future auto-ship':' for this order only'}`,actor:req.user?.name||req.user?.username});
  res.json({item:updated,order});
});

router.delete('/orders/:orderId/items/:itemId',auth,async(req,res)=>{
  const item=(await q(`SELECT i.*,o.customer_id,o.status order_status,o.order_number FROM service_customer_order_items i JOIN service_customer_orders o ON o.id=i.order_id WHERE i.id=$1 AND i.order_id=$2`,[req.params.itemId,req.params.orderId])).rows[0];
  if(!item)return res.status(404).json({error:'Order item not found'});
  if(['shipped','cancelled'].includes(item.order_status))return res.status(409).json({error:'This order can no longer be edited'});
  const removeRecurring=req.query.recurring==='true';
  await q('DELETE FROM service_customer_order_items WHERE id=$1',[item.id]);
  if(removeRecurring&&item.recurring_order_item_id)await q('UPDATE service_recurring_order_items SET active=false,updated_at=NOW() WHERE id=$1',[item.recurring_order_item_id]);
  const order=await recalcOrder(req.params.orderId);
  await logChange({customerId:item.customer_id,orderId:req.params.orderId,action:'item_removed',description:`Removed ${item.description} from ${item.order_number||'order'}${removeRecurring&&item.recurring_order_item_id?' and future auto-ship':' only'}`,actor:req.user?.name||req.user?.username});
  res.json({ok:true,order});
});

router.post('/orders/sync',auth,async(req,res)=>{
  const rows=Array.isArray(req.body?.orders)?req.body.orders:[];let upserted=0,skipped=0;
  for(const b of rows){
    const customerId=b.customer_id;if(!customerId||!clean(b.external_order_id)){skipped++;continue}
    const existing=(await q('SELECT id FROM service_customer_orders WHERE external_order_id=$1',[clean(b.external_order_id)])).rows[0];
    let orderId;
    if(existing){orderId=existing.id;await q(`UPDATE service_customer_orders SET status=$2,order_number=$3,scheduled_ship_date=$4,shipped_at=$5,tax_amount=$6,shipping_amount=$7,source='online',updated_at=NOW() WHERE id=$1`,[orderId,clean(b.status)||'scheduled',clean(b.order_number),b.scheduled_ship_date||null,b.shipped_at||null,money(b.tax_amount),money(b.shipping_amount)]);await q('DELETE FROM service_customer_order_items WHERE order_id=$1',[orderId])}
    else{orderId=(await q(`INSERT INTO service_customer_orders(customer_id,external_order_id,order_number,status,order_type,scheduled_ship_date,shipped_at,tax_amount,shipping_amount,source) VALUES($1,$2,$3,$4,'online',$5,$6,$7,$8,'online') RETURNING id`,[customerId,clean(b.external_order_id),clean(b.order_number),clean(b.status)||'scheduled',b.scheduled_ship_date||null,b.shipped_at||null,money(b.tax_amount),money(b.shipping_amount)])).rows[0].id}
    for(const i of Array.isArray(b.items)?b.items:[]){const quantity=qty(i.quantity),unitPrice=money(i.unit_price);await q(`INSERT INTO service_customer_order_items(order_id,product_id,sku,description,quantity,unit_price,line_total,item_scope) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[orderId,clean(i.product_id),clean(i.sku),clean(i.description)||'Online item',quantity,unitPrice,money(quantity*unitPrice),clean(i.item_scope)||'one_time'])}
    await recalcOrder(orderId);upserted++;
  }
  res.json({upserted,skipped,total:rows.length});
});

export default router;
