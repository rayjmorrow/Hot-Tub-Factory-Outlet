const code=value=>String(value||'').trim().slice(0,120);
const CATALOG_URL='https://raw.githubusercontent.com/rayjmorrow/Hot-Tub-Factory-Outlet/main/retail-catalog.json';
export async function publishedRetailCatalog(){
 const response=await fetch(CATALOG_URL,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw Error('Published retail catalog unavailable ('+response.status+')');
 const data=await response.json();
 if(!Array.isArray(data.products)||data.products.length>1000||!data.version)throw Error('Invalid published retail catalog');
 const seen=new Set();
 const products=data.products.map(p=>{
  const sku=code(p.sku),name=code(p.name),category=code(p.category);
  const price=Number(p.price_cents);
  if(!sku||!name||!Number.isSafeInteger(price)||price<1||seen.has(sku.toLowerCase()))throw Error('Invalid or duplicated published SKU');
  seen.add(sku.toLowerCase());
  return {sku,name,category,price_cents:price,sku_status:p.sku_status};
 });
 return {version:String(data.version),products,excluded:data.excluded||[]};
}

export async function retailPriceOverrides(){
 const catalog=await publishedRetailCatalog();
 return JSON.stringify(catalog.products.filter(p=>p.sku_status==='published_sku').map(p=>({
  sku:p.sku.toLowerCase(),price_cents:p.price_cents
 })));
}

// Only an unambiguous active supplier SKU is linked to the shared catalog.
export const retailPriceJoin=`LEFT JOIN jsonb_to_recordset($1::jsonb) AS shared(sku text, price_cents integer)
 ON shared.sku=lower(trim(p.supplier_part_number))
 AND NOT EXISTS (SELECT 1 FROM service_parts duplicate
   WHERE duplicate.active=true AND duplicate.id<>p.id
   AND lower(trim(duplicate.supplier_part_number))=shared.sku)`;
export const retailPriceCents=`COALESCE(shared.price_cents,ROUND(COALESCE(NULLIF(p.sell_price,0),p.list_price,0)*100)::int)`;
