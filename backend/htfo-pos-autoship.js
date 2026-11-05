import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {q} from './service-db.js';
import {publishedRetailCatalog} from './htfo-retail-catalog.js';

const departments=new Set(['monroeville_sales','wexford_sales']);
const hash=value=>createHash('sha256').update(value).digest('hex');
const enabled=()=>process.env.HTFO_POS_AUTOSHIP_ENABLED==='true';
let schema;
function ensure(){
 if(!schema)schema=q(`CREATE TABLE IF NOT EXISTS htfo_pos_autoship_intents(
  token_hash TEXT PRIMARY KEY, customer_id BIGINT NOT NULL REFERENCES service_customers(id),
  employee_id BIGINT NOT NULL REFERENCES service_users(id), department TEXT NOT NULL,
  items JSONB NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
  checkout_started_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 );
 ALTER TABLE htfo_pos_autoship_intents ADD COLUMN IF NOT EXISTS consent_record JSONB;
 ALTER TABLE htfo_pos_autoship_intents ADD COLUMN IF NOT EXISTS authorized_at TIMESTAMPTZ;
 `).catch(error=>{schema=null;throw error});
 return schema;
}
export async function createPOSAutoShipIntent(body,employee){
 const checkoutUrl=process.env.HTFO_POS_AUTOSHIP_CHECKOUT_URL;
 if(!enabled()||!checkoutUrl)throw Error('Cashier AutoShip enrollment is awaiting merchant acceptance testing.');
 const department=body?.department,customerId=Number(body?.customer_id),months=Number(body?.frequency_months);
 if(!departments.has(department)||!Number.isSafeInteger(customerId)||customerId<1||!Number.isSafeInteger(months)||months<1||months>12){
  throw Error('Select a customer, showroom and delivery interval.');
 }
 const customer=(await q('SELECT id,email FROM service_customers WHERE id=$1',[customerId])).rows[0];
 if(!customer?.email?.trim())throw Error('The selected customer needs an email address.');
 const lines=body.items;
 if(!Array.isArray(lines)||!lines.length||lines.length>30||new Set(lines.map(x=>x.sku_id)).size!==lines.length){
  throw Error('Add up to 30 different AutoShip products.');
 }
 const catalog=await publishedRetailCatalog();
 const products=new Map(catalog.products.filter(p=>p.sku_status==='published_sku'&&p.category!=='Accessories').map(p=>[p.sku.toLowerCase(),p]));
 const rows=(await q(`SELECT p.id,lower(trim(p.supplier_part_number)) sku
  FROM service_parts p WHERE p.active=true AND p.id=ANY($1::bigint[])
  AND NOT EXISTS(SELECT 1 FROM service_parts d WHERE d.active=true AND d.id<>p.id
    AND lower(trim(d.supplier_part_number))=lower(trim(p.supplier_part_number)))`,[lines.map(x=>x.sku_id)])).rows;
 const byId=new Map(rows.map(row=>[String(row.id),row]));
 const items=lines.map(line=>{
  const product=products.get(byId.get(String(line.sku_id))?.sku);
  if(!product||!Number.isSafeInteger(line.qty)||line.qty<1||line.qty>99)throw Error('AutoShip requires a matched spa-care SKU with a quantity from 1 to 99.');
  return {sku:product.sku,qty:line.qty,autoship:true,frequencyMonths:months};
 });
 const url=new URL(checkoutUrl);
 if(url.protocol!=='https:')throw Error('Secure AutoShip checkout URL required');
 await ensure();
 const token=randomBytes(32).toString('hex');
 await q(`INSERT INTO htfo_pos_autoship_intents(token_hash,customer_id,employee_id,department,items,expires_at)
  VALUES($1,$2,$3,$4,$5::jsonb,NOW()+INTERVAL '1 day')`,[hash(token),customerId,employee,department,JSON.stringify(items)]);
 url.hash=token;
 return {url:url.toString(),expires_hours:24};
}

export async function accessPOSAutoShipIntent(req,res){
 res.set('Cache-Control','no-store');
 const expected=Buffer.from(process.env.FULFILLMENT_WEBHOOK_SECRET||''),supplied=Buffer.from(req.get('x-htfo-fulfillment-secret')||'');
 if(!enabled()||!expected.length||expected.length!==supplied.length||!timingSafeEqual(expected,supplied))return res.sendStatus(404);
 const {token,action}=req.body||{};
 if(!/^[a-f0-9]{64}$/.test(String(token||''))||!['read','claim','release','consent'].includes(action))return res.sendStatus(404);
 try{
  await ensure();
  const key=hash(token);
  if(action==='release'){
   await q('UPDATE htfo_pos_autoship_intents SET checkout_started_at=NULL WHERE token_hash=$1',[key]);
   return res.json({ok:true});
  }
  if(action==='consent'){
   const name=String(req.body.name||'').trim(),quote=req.body.quote;
   if(name.length<3||name.length>100||!quote||!Array.isArray(quote.items))return res.sendStatus(400);
   const saved=await q(`UPDATE htfo_pos_autoship_intents SET consent_record=$2::jsonb,authorized_at=NOW()
    WHERE token_hash=$1 AND checkout_started_at IS NOT NULL AND expires_at>NOW() RETURNING token_hash`,
    [key,JSON.stringify({name,quote,version:'htfo-pos-autoship-2026-11'})]);
   if(!saved.rowCount)return res.sendStatus(410);
   return res.json({ok:true});
  }
  const record=(await q(action==='claim'?`UPDATE htfo_pos_autoship_intents i SET checkout_started_at=NOW()
   FROM service_customers c WHERE i.token_hash=$1 AND i.expires_at>NOW() AND i.checkout_started_at IS NULL AND c.id=i.customer_id
   RETURNING i.customer_id,i.employee_id,i.department,i.items,c.first_name,c.last_name,c.email,c.phone`:
   `SELECT i.customer_id,i.employee_id,i.department,i.items,c.first_name,c.last_name,c.email,c.phone
    FROM htfo_pos_autoship_intents i JOIN service_customers c ON c.id=i.customer_id
    WHERE i.token_hash=$1 AND i.expires_at>NOW() AND i.checkout_started_at IS NULL`,[key])).rows[0];
  if(!record)return res.status(410).json({error:'This AutoShip link has expired or checkout has already started.'});
  res.json({ok:true,...record});
 }catch(error){res.status(503).json({error:'AutoShip enrollment is temporarily unavailable.'})}
}
