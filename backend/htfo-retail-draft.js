import {q,transaction} from './service-db.js';
import {retailPriceOverrides,retailPriceJoin,retailPriceCents} from './htfo-retail-catalog.js';
import {merchantRouteForDepartment} from './htfo-merchant-routes.js';
const number=(x,min,max,label)=>{if(!Number.isSafeInteger(x)||x<min||x>max)throw Error('Invalid '+label);return x};
export async function createUnpaidRetailDraft(body,actor){
 const lines=body?.items;if(!Array.isArray(lines)||lines.length<1||lines.length>30)throw Error('Add 1–30 retail items');
 const overrides=await retailPriceOverrides();
 const products=[];
 for(const item of lines){
  const id=number(Number(item.sku_id),1,100000000,'SKU'),qty=number(item.qty,1,99,'quantity');
  const p=(await q(`SELECT p.id,p.description,p.taxable,
   COALESCE(NULLIF(p.supplier_part_number,''),NULLIF(p.manufacturer_part_number,''),'PART-'||p.id::text) AS sku,
   ${retailPriceCents} AS price_cents FROM service_parts p ${retailPriceJoin} WHERE p.id=$2 AND p.active=true`,[overrides,id])).rows[0];
  if(!p)throw Error('Item no longer exists');
  products.push({id,qty,sku:p.sku,name:p.description,price:p.price_cents,taxable:p.taxable});
 }
 const subtotal=products.reduce((n,p)=>n+p.qty*p.price,0),taxable=products.filter(x=>x.taxable).reduce((n,p)=>n+p.qty*p.price,0);
 const settings=(await q("SELECT tax_rate_bps FROM htfo_dealer_settings WHERE dealer_key='htfo'")).rows[0];
 const rate=Number(settings?.tax_rate_bps??700),tax=Math.round(taxable*rate/10000),total=subtotal+tax;
 const customer=body?.customer_id?number(Number(body.customer_id),1,100000000,'customer ID'):null;
 const ref=String(body?.reference_key||'').trim().slice(0,120)||null;
 const department=String(body?.department||'').trim();
 if(!['monroeville_sales','wexford_sales'].includes(department))throw Error('Select Monroeville or Wexford for this counter sale');
 const merchantRoute=merchantRouteForDepartment(department);
 return transaction(async run=>{
  if(ref){const existing=(await run('SELECT id,total_cents,tax_cents,payment_status,department,merchant_route FROM htfo_pos_receipts WHERE reference_key=$1',[ref])).rows[0];
   if(existing){if(Number(existing.total_cents)!==total||existing.department!==department)throw Error('Draft reference was reused for a different total or department');return {...existing,already_exists:true}}}
  const created=(await run('INSERT INTO htfo_pos_receipts(customer_id,subtotal_cents,tax_cents,total_cents,tax_rate_bps,reference_key,created_by,department,merchant_route) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(reference_key) DO NOTHING RETURNING id,total_cents,tax_cents,payment_status,department,merchant_route',[customer,subtotal,tax,total,rate,ref,actor,department,merchantRoute])).rows[0];
  if(!created){const old=(await run('SELECT id,total_cents,tax_cents,payment_status,department,merchant_route FROM htfo_pos_receipts WHERE reference_key=$1',[ref])).rows[0];if(Number(old.total_cents)!==total||old.department!==department)throw Error('Reference belongs to another draft or department');return {...old,already_exists:true}}
  for(const p of products)await run('INSERT INTO htfo_pos_part_lines(receipt_id,part_id,qty,price_cents,sku_at_sale,description_at_sale,taxable_at_sale) VALUES($1,$2,$3,$4,$5,$6,$7)',[created.id,p.id,p.qty,p.price,p.sku,p.name,p.taxable]);
  return created;
 });
}
