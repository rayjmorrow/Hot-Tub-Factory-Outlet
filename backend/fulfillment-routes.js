import express from 'express';
import jwt from 'jsonwebtoken';
import { q } from './service-db.js';

const router=express.Router();
const clean=v=>v==null?null:String(v).trim();
const num=v=>Number(v||0);
const ymd=d=>new Date(d).toISOString().slice(0,10);
const addDays=(date,days)=>{const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return ymd(d)};
function secret(){if(!process.env.SERVICE_JWT_SECRET)throw new Error('SERVICE_JWT_SECRET is required');return process.env.SERVICE_JWT_SECRET}
function auth(req,res,next){try{const raw=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');if(!raw)return res.status(401).json({error:'Login required'});req.user=jwt.verify(raw,secret());next()}catch{res.status(401).json({error:'Session expired or invalid'})}}
function manager(req,res,next){const role=String(req.user?.role||'').toLowerCase();if(!['admin','owner','manager','service_manager'].includes(role))return res.status(403).json({error:'Manager permission required'});next()}
function csv(v){const s=String(v??'');return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}

export async function initFulfillment(){
  await q(`
    ALTER TABLE service_customer_orders ADD COLUMN IF NOT EXISTS fulfillment_status TEXT NOT NULL DEFAULT 'waiting';
    ALTER TABLE service_customer_orders ADD COLUMN IF NOT EXISTS carrier TEXT;
    ALTER TABLE service_customer_orders ADD COLUMN IF NOT EXISTS shipping_service TEXT;
    ALTER TABLE service_customer_orders ADD COLUMN IF NOT EXISTS tracking_number TEXT;
    ALTER TABLE service_customer_orders ADD COLUMN IF NOT EXISTS package_weight_lbs NUMERIC(8,2);
    ALTER TABLE service_customer_orders ADD COLUMN IF NOT EXISTS package_length_in NUMERIC(8,2);
    ALTER TABLE service_customer_orders ADD COLUMN IF NOT EXISTS package_width_in NUMERIC(8,2);
    ALTER TABLE service_customer_orders ADD COLUMN IF NOT EXISTS package_height_in NUMERIC(8,2);
    ALTER TABLE service_customer_orders ADD COLUMN IF NOT EXISTS fulfilled_by TEXT;
    ALTER TABLE service_customer_orders ADD COLUMN IF NOT EXISTS local_delivery BOOLEAN NOT NULL DEFAULT FALSE;
    CREATE TABLE IF NOT EXISTS service_fulfillment_events(
      id BIGSERIAL PRIMARY KEY,
      order_id BIGINT REFERENCES service_customer_orders(id) ON DELETE CASCADE,
      recurring_order_id BIGINT REFERENCES service_recurring_orders(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      description TEXT NOT NULL,
      actor TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS service_notification_outbox(
      id BIGSERIAL PRIMARY KEY,
      customer_id BIGINT REFERENCES service_customers(id) ON DELETE CASCADE,
      order_id BIGINT REFERENCES service_customer_orders(id) ON DELETE CASCADE,
      recipient TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      provider_message_id TEXT,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      sent_at TIMESTAMPTZ
    );
  `);
}
async function logEvent(orderId,recurringOrderId,eventType,description,actor='system'){
  await q('INSERT INTO service_fulfillment_events(order_id,recurring_order_id,event_type,description,actor) VALUES($1,$2,$3,$4,$5)',[orderId||null,recurringOrderId||null,eventType,description,actor]);
}
async function queueEmail(customerId,orderId,recipient,subject,body){
  if(!recipient)return;
  const row=(await q('INSERT INTO service_notification_outbox(customer_id,order_id,recipient,subject,body) VALUES($1,$2,$3,$4,$5) RETURNING id',[customerId,orderId||null,recipient,subject,body])).rows[0];
  const key=process.env.BREVO_API_KEY,fromEmail=process.env.FULFILLMENT_FROM_EMAIL||process.env.BREVO_FROM_EMAIL;
  if(!key||!fromEmail)return;
  try{
    const r=await fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'Content-Type':'application/json','api-key':key},body:JSON.stringify({sender:{name:process.env.FULFILLMENT_FROM_NAME||'Hot Tub Factory Outlet',email:fromEmail},to:[{email:recipient}],subject,textContent:body})});
    const j=await r.json().catch(()=>({})); if(!r.ok)throw new Error(j.message||('Brevo '+r.status));
    await q('UPDATE service_notification_outbox SET status=$2,provider_message_id=$3,sent_at=NOW() WHERE id=$1',[row.id,'sent',j.messageId||null]);
  }catch(e){await q('UPDATE service_notification_outbox SET status=$2,last_error=$3 WHERE id=$1',[row.id,'failed',String(e.message||e).slice(0,1000)])}
}
export async function runFulfillmentAutomation(){
  const today=ymd(new Date()),reminderThrough=addDays(today,14),createThrough=addDays(today,5);
  const subs=(await q(`SELECT r.*,c.first_name,c.last_name,c.email FROM service_recurring_orders r JOIN service_customers c ON c.id=r.customer_id WHERE r.status='active' AND r.next_ship_date IS NOT NULL AND r.next_ship_date <= $1::date ORDER BY r.next_ship_date`,[reminderThrough])).rows;
  for(const s of subs){
    const cycle=ymd(s.next_ship_date);
    const reminded=(await q("SELECT 1 FROM service_fulfillment_events WHERE recurring_order_id=$1 AND event_type='autoship_reminder' AND description LIKE $2 LIMIT 1",[s.id,'%'+cycle+'%'])).rows[0];
    if(!reminded){
      await logEvent(null,s.id,'autoship_reminder','AutoShip scheduled for '+cycle+': customer reminder/add-on window opened.');
      await queueEmail(s.customer_id,null,s.email,'Your upcoming Hot Tub Factory Outlet AutoShip','Hi '+(s.first_name||'')+',\\n\\nYour next AutoShip is scheduled for '+cycle+'. If you need to add anything, please contact us before the order is finalized.\\n\\nHot Tub Factory Outlet');
    }
    if(cycle<=createThrough){
      const exists=(await q('SELECT id FROM service_customer_orders WHERE recurring_order_id=$1 AND scheduled_ship_date=$2::date LIMIT 1',[s.id,cycle])).rows[0];
      if(!exists){
        const orderNo='AUTO-'+new Date().getFullYear()+'-'+Date.now().toString().slice(-7);
        const order=(await q(`INSERT INTO service_customer_orders(customer_id,recurring_order_id,order_number,status,order_type,scheduled_ship_date,source,fulfillment_status,package_weight_lbs,package_length_in,package_width_in,package_height_in)
          VALUES($1,$2,$3,'processing','autoship',$4,'autoship','waiting',10,12,12,12) RETURNING *`,[s.customer_id,s.id,orderNo,cycle])).rows[0];
        const items=(await q('SELECT * FROM service_recurring_order_items WHERE recurring_order_id=$1 AND active=true ORDER BY id',[s.id])).rows;
        for(const i of items)await q(`INSERT INTO service_customer_order_items(order_id,recurring_order_item_id,product_id,sku,description,quantity,unit_price,line_total,item_scope)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,'recurring')`,[order.id,i.id,i.product_id,i.sku,i.description,i.quantity,i.unit_price,num(i.quantity)*num(i.unit_price)]);
        await q(`UPDATE service_customer_orders SET subtotal=(SELECT coalesce(sum(line_total),0) FROM service_customer_order_items WHERE order_id=$1),total_amount=(SELECT coalesce(sum(line_total),0) FROM service_customer_order_items WHERE order_id=$1)+tax_amount+shipping_amount WHERE id=$1`,[order.id]);
        const next=addDays(cycle,Math.max(1,Number(s.frequency_value)||30));
        await q('UPDATE service_recurring_orders SET next_ship_date=$2::date,updated_at=NOW() WHERE id=$1',[s.id,next]);
        await logEvent(order.id,s.id,'autoship_order_created','AutoShip order '+orderNo+' created for '+cycle+'. Next cycle '+next+'.');
      }
    }
  }
}
async function queueRows(){
  return (await q(`SELECT o.*,c.first_name,c.last_name,c.company,c.email,c.phone,c.street,c.street2,c.city,c.state,c.zip,
    coalesce((SELECT json_agg(json_build_object('id',i.id,'sku',i.sku,'description',i.description,'quantity',i.quantity,'unit_price',i.unit_price,'line_total',i.line_total) ORDER BY i.id) FROM service_customer_order_items i WHERE i.order_id=o.id),'[]'::json) items
    FROM service_customer_orders o JOIN service_customers c ON c.id=o.customer_id
    WHERE o.status <> 'cancelled' AND coalesce(o.fulfillment_status,'waiting') NOT IN ('shipped','delivered')
      AND (o.source IN ('online','autoship') OR o.order_type IN ('online','autoship','ship'))
    ORDER BY coalesce(o.scheduled_ship_date,o.created_at::date),o.created_at`)).rows;
}

function storeSecretOk(req){const expected=process.env.FULFILLMENT_WEBHOOK_SECRET||'';const got=req.headers['x-htfo-fulfillment-secret']||'';return expected&&got===expected}
router.post('/fulfillment/store-order',async(req,res)=>{
  if(!storeSecretOk(req))return res.status(401).json({error:'Unauthorized fulfillment handoff'});
  const b=req.body||{},cust=b.customer||{},items=Array.isArray(b.items)?b.items:[];
  const email=clean(cust.email)?.toLowerCase()||null,phone=clean(cust.phone);
  let customer=null;
  if(email)customer=(await q('SELECT * FROM service_customers WHERE lower(email)=lower($1) ORDER BY id DESC LIMIT 1',[email])).rows[0];
  if(!customer&&phone)customer=(await q('SELECT * FROM service_customers WHERE phone=$1 ORDER BY id DESC LIMIT 1',[phone])).rows[0];
  if(!customer){
    customer=(await q(`INSERT INTO service_customers(first_name,last_name,email,phone,street,street2,city,state,zip,notes)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[clean(cust.first_name),clean(cust.last_name),email,phone,clean(cust.street),clean(cust.street2),clean(cust.city),clean(cust.state),clean(cust.zip),'Created from online store fulfillment handoff'])).rows[0];
  }else{
    customer=(await q(`UPDATE service_customers SET first_name=coalesce($2,first_name),last_name=coalesce($3,last_name),email=coalesce($4,email),phone=coalesce($5,phone),street=coalesce($6,street),street2=coalesce($7,street2),city=coalesce($8,city),state=coalesce($9,state),zip=coalesce($10,zip),updated_at=NOW() WHERE id=$1 RETURNING *`,
      [customer.id,clean(cust.first_name),clean(cust.last_name),email,phone,clean(cust.street),clean(cust.street2),clean(cust.city),clean(cust.state),clean(cust.zip)])).rows[0];
  }
  const external=clean(b.external_order_id)||clean(b.transaction_id)||clean(b.order_number);
  if(external){
    const existing=(await q('SELECT * FROM service_customer_orders WHERE external_order_id=$1 LIMIT 1',[external])).rows[0];
    if(existing)return res.json({ok:true,duplicate:true,order_id:existing.id});
  }
  const orderNo=clean(b.order_number)||('WEB-'+new Date().getFullYear()+'-'+Date.now().toString().slice(-7));
  const order=(await q(`INSERT INTO service_customer_orders(customer_id,external_order_id,order_number,status,order_type,shipping_amount,total_amount,source,fulfillment_status,package_weight_lbs,package_length_in,package_width_in,package_height_in,notes)
    VALUES($1,$2,$3,'processing','online',$4,$5,'online','waiting',$6,$7,$8,$9,$10) RETURNING *`,
    [customer.id,external,orderNo,num(b.shipping_amount),num(b.total_amount),num(b.package_weight_lbs)||10,num(b.package_length_in)||12,num(b.package_width_in)||12,num(b.package_height_in)||12,clean(b.notes)])).rows[0];
  for(const i of items){
    const qty=Math.max(.01,num(i.quantity)||1),unit=num(i.unit_price);
    await q(`INSERT INTO service_customer_order_items(order_id,product_id,sku,description,quantity,unit_price,line_total,item_scope)
      VALUES($1,$2,$3,$4,$5,$6,$7,'one_time')`,[order.id,clean(i.product_id),clean(i.sku),clean(i.description)||'Online item',qty,unit,qty*unit]);
  }
  await q(`UPDATE service_customer_orders SET subtotal=(SELECT coalesce(sum(line_total),0) FROM service_customer_order_items WHERE order_id=$1),updated_at=NOW() WHERE id=$1`,[order.id]);
  await logEvent(order.id,null,'store_order_received','Online store order '+orderNo+' entered Fulfillment.','online store');
  res.status(201).json({ok:true,order_id:order.id,customer_id:customer.id});
});


router.post('/fulfillment/store-autoship',async(req,res)=>{
  if(!storeSecretOk(req))return res.status(401).json({error:'Unauthorized AutoShip handoff'});
  const b=req.body||{},cust=b.customer||{},email=clean(cust.email)?.toLowerCase()||null,phone=clean(cust.phone);
  let customer=null;
  if(email)customer=(await q('SELECT * FROM service_customers WHERE lower(email)=lower($1) ORDER BY id DESC LIMIT 1',[email])).rows[0];
  if(!customer&&phone)customer=(await q('SELECT * FROM service_customers WHERE phone=$1 ORDER BY id DESC LIMIT 1',[phone])).rows[0];
  if(!customer)return res.status(404).json({error:'Customer must exist before AutoShip handoff'});
  const created=[];
  for(const sub of (Array.isArray(b.subscriptions)?b.subscriptions:[])){
    const external=clean(sub.subscriptionId);
    let rec=external?(await q('SELECT * FROM service_recurring_orders WHERE external_subscription_id=$1 LIMIT 1',[external])).rows[0]:null;
    if(!rec){
      const months=Math.max(1,Number(sub.frequencyMonths)||1),days=months*30,next=clean(sub.startDate)||addDays(ymd(new Date()),days);
      rec=(await q(`INSERT INTO service_recurring_orders(customer_id,external_subscription_id,status,frequency_value,frequency_unit,next_ship_date,payment_reference,shipping_method,notes)
        VALUES($1,$2,'active',$3,'days',$4,$5,'ship',$6) RETURNING *`,[customer.id,external,days,next,clean(b.payment_reference),'Online store AutoShip'])).rows[0];
      const subItems=Array.isArray(sub.items)?sub.items:[];
      for(const i of subItems)await q(`INSERT INTO service_recurring_order_items(recurring_order_id,product_id,sku,description,quantity,unit_price,active)
        VALUES($1,$2,$3,$4,$5,$6,true)`,[rec.id,clean(i.id),clean(i.sku),clean(i.name)||clean(i.description)||'AutoShip item',Math.max(.01,num(i.quantity)||1),num(i.unit_price)]);
      await logEvent(null,rec.id,'autoship_enrolled','AutoShip enrolled from online store. First shipment '+next+'.','online store');
    }
    created.push(rec);
  }
  await runFulfillmentAutomation();
  res.json({ok:true,recurring_orders:created.map(x=>x.id)});
});

router.get('/fulfillment/queue',auth,async(req,res)=>{await runFulfillmentAutomation();res.json(await queueRows())});
router.get('/fulfillment/summary',auth,async(req,res)=>{
  await runFulfillmentAutomation(); const rows=await queueRows(),today=ymd(new Date());
  const alerts=(await q(`SELECT e.*,c.first_name,c.last_name FROM service_fulfillment_events e LEFT JOIN service_recurring_orders r ON r.id=e.recurring_order_id LEFT JOIN service_customers c ON c.id=r.customer_id WHERE e.created_at>=NOW()-INTERVAL '21 days' ORDER BY e.created_at DESC LIMIT 50`)).rows;
  const mail=(await q('SELECT id,order_id,recipient,subject,status,last_error,created_at,sent_at FROM service_notification_outbox ORDER BY created_at DESC LIMIT 50')).rows;
  res.json({waiting:rows.length,overdue:rows.filter(x=>x.scheduled_ship_date&&ymd(x.scheduled_ship_date)<today).length,alerts,mail});
});
router.patch('/fulfillment/orders/:id',auth,async(req,res)=>{
  const o=(await q('SELECT * FROM service_customer_orders WHERE id=$1',[req.params.id])).rows[0];if(!o)return res.status(404).json({error:'Order not found'});
  const b=req.body||{},status=clean(b.fulfillment_status)||o.fulfillment_status||'waiting';
  if(!['waiting','processing','hold','ready','packed','shipped','delivered'].includes(status))return res.status(400).json({error:'Invalid fulfillment status'});
  const row=(await q(`UPDATE service_customer_orders SET fulfillment_status=$2,package_weight_lbs=$3,package_length_in=$4,package_width_in=$5,package_height_in=$6,updated_at=NOW() WHERE id=$1 RETURNING *`,
    [o.id,status,num(b.package_weight_lbs??o.package_weight_lbs)||null,num(b.package_length_in??o.package_length_in)||null,num(b.package_width_in??o.package_width_in)||null,num(b.package_height_in??o.package_height_in)||null])).rows[0];
  await logEvent(o.id,o.recurring_order_id,'fulfillment_status','Fulfillment status changed to '+status+'.',req.user?.name||req.user?.username);res.json(row);
});
router.post('/fulfillment/orders/:id/ship',auth,async(req,res)=>{
  const o=(await q(`SELECT o.*,c.first_name,c.email FROM service_customer_orders o JOIN service_customers c ON c.id=o.customer_id WHERE o.id=$1`,[req.params.id])).rows[0];if(!o)return res.status(404).json({error:'Order not found'});
  const b=req.body||{},local=Boolean(b.local_delivery),tracking=clean(b.tracking_number),carrier=local?'HTFO Local Delivery':(clean(b.carrier)||'Carrier'),service=local?'Local Delivery':clean(b.shipping_service);
  if(!local&&!tracking)return res.status(400).json({error:'Tracking number is required unless this is an HTFO local delivery'});
  const row=(await q(`UPDATE service_customer_orders SET fulfillment_status='shipped',status='shipped',shipped_at=NOW(),carrier=$2,shipping_service=$3,tracking_number=$4,fulfilled_by=$5,local_delivery=$6,updated_at=NOW() WHERE id=$1 RETURNING *`,
    [o.id,carrier,service,tracking,req.user?.name||req.user?.username||null,local])).rows[0];
  const desc=local?'Order '+(o.order_number||o.id)+' handled as HTFO local delivery.':'Order '+(o.order_number||o.id)+' shipped via '+carrier+(service?' '+service:'')+'. Tracking '+tracking+'.';
  await logEvent(o.id,o.recurring_order_id,local?'local_delivery':'shipped',desc,req.user?.name||req.user?.username);
  if(o.email){const info=local?'Our HTFO team is handling your local delivery.':'Carrier: '+carrier+(service?' '+service:'')+'\\nTracking: '+tracking;await queueEmail(o.customer_id,o.id,o.email,'Your Hot Tub Factory Outlet order has shipped','Hi '+(o.first_name||'')+',\\n\\nYour order '+(o.order_number||o.id)+' has shipped.\\n\\n'+info+'\\n\\nThank you,\\nHot Tub Factory Outlet')}
  res.json(row);
});
router.get('/fulfillment/pirate-ship.csv',auth,async(req,res)=>{
  await runFulfillmentAutomation(); const rows=await queueRows(),selected=String(req.query.ids||'').split(',').filter(Boolean),use=selected.length?rows.filter(x=>selected.includes(String(x.id))):rows;
  const headers=['Order ID','Full Name','Company','Address Line 1','Address Line 2','City','State','Zip','Country','Email','Phone','Weight Pounds','Length','Width','Height','Order Items','Note'],lines=[headers.join(',')];
  for(const o of use){const items=(o.items||[]).map(i=>Number(i.quantity)+' x '+i.description).join('; ');lines.push([o.order_number||o.id,[o.first_name,o.last_name].filter(Boolean).join(' '),o.company||'',o.street||'',o.street2||'',o.city||'',o.state||'',o.zip||'','US',o.email||'',o.phone||'',o.package_weight_lbs||10,o.package_length_in||12,o.package_width_in||12,o.package_height_in||12,items,o.notes||''].map(csv).join(','))}
  res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="htfo-pirate-ship-'+ymd(new Date())+'.csv"');res.send(lines.join('\\n'));
});
export default router;
