import { q } from './service-db.js';

const clean=v=>v==null?null:String(v).trim();
const splitFirst=v=>clean(v)||null;
const splitLast=v=>clean(v)||null;

export async function promoteLatestStagedCustomers(){
  await q(`
    CREATE TABLE IF NOT EXISTS service_customer_import_links (
      id BIGSERIAL PRIMARY KEY,
      staging_id BIGINT UNIQUE,
      batch_id BIGINT,
      source_customer_id TEXT,
      customer_id BIGINT NOT NULL REFERENCES service_customers(id) ON DELETE CASCADE,
      aliases TEXT,
      merged_customer_ids TEXT,
      review_note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_service_customer_import_links_customer ON service_customer_import_links(customer_id);
  `);

  const batch=await q(`SELECT * FROM service_customer_import_batches WHERE status='staging' ORDER BY created_at DESC LIMIT 1`);
  if(!batch.rowCount){
    console.log('Customer promotion: no staged batch awaiting promotion.');
    return {promoted:0,skipped:0,batch:null};
  }

  const b=batch.rows[0];
  const staged=await q(`SELECT * FROM service_customer_import_staging WHERE batch_id=$1 AND row_status='staged' ORDER BY id`,[b.id]);
  let promoted=0,skipped=0;

  for(const s of staged.rows){
    const linked=await q('SELECT customer_id FROM service_customer_import_links WHERE staging_id=$1',[s.id]);
    if(linked.rowCount){ skipped++; continue; }

    // Duplicate protection: normalized address first, then email, then phone.
    let existing={rowCount:0,rows:[]};
    if(s.normalized_address){
      existing=await q(`SELECT id FROM service_customers WHERE regexp_replace(lower(concat_ws(' ',street,city,state,zip)),'[^a-z0-9]','','g')=$1 LIMIT 1`,[s.normalized_address]);
    }
    if(!existing.rowCount && s.primary_email){
      existing=await q('SELECT id FROM service_customers WHERE lower(email)=lower($1) LIMIT 1',[s.primary_email]);
    }
    if(!existing.rowCount && s.primary_phone){
      existing=await q("SELECT id FROM service_customers WHERE regexp_replace(phone,'\\D','','g')=regexp_replace($1,'\\D','','g') LIMIT 1",[s.primary_phone]);
    }

    let customerId;
    if(existing.rowCount){
      customerId=existing.rows[0].id;
      skipped++;
    }else{
      const notes=[
        s.secondary_phone?`Secondary phone: ${s.secondary_phone}`:null,
        s.additional_phones?`Additional phones: ${s.additional_phones}`:null,
        s.additional_emails?`Additional emails: ${s.additional_emails}`:null,
        s.recent_notes?`Historical notes: ${s.recent_notes}`:null
      ].filter(Boolean).join('\n');
      const r=await q(`INSERT INTO service_customers(first_name,last_name,email,phone,street,city,state,zip,notes,source)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,[
          splitFirst(s.first_name),splitLast(s.last_name),clean(s.primary_email),clean(s.primary_phone),clean(s.street),clean(s.city),clean(s.state),clean(s.zip),notes||null,'HTFO master import'
        ]);
      customerId=r.rows[0].id;
      promoted++;
    }

    await q(`INSERT INTO service_customer_import_links(staging_id,batch_id,source_customer_id,customer_id,aliases,merged_customer_ids,review_note)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(staging_id) DO NOTHING`,[
        s.id,b.id,clean(s.source_customer_id),customerId,clean(s.aliases),clean(s.merged_customer_ids),clean(s.review_note)
      ]);

    // Seed one equipment record when make/model history is available. Keep serial blank because old calendar names may contain serials ambiguously.
    if((s.spa_makes||s.spa_models) && !(await q('SELECT 1 FROM service_equipment WHERE customer_id=$1 LIMIT 1',[customerId])).rowCount){
      await q(`INSERT INTO service_equipment(customer_id,equipment_type,brand,model,install_date,notes)
        VALUES($1,'Hot Tub',$2,$3,$4,$5)`,[
          customerId,clean(s.spa_makes),clean(s.spa_models),s.purchase_date||null,
          'Imported from historical HTFO customer database. Serial number not auto-assigned.'
        ]);
    }

    await q(`UPDATE service_customer_import_staging SET row_status='promoted',updated_at=NOW() WHERE id=$1`,[s.id]);
  }

  await q(`UPDATE service_customer_import_batches SET status='promoted',updated_at=NOW() WHERE id=$1`,[b.id]);
  console.log(`Customer promotion complete: ${promoted} inserted, ${skipped} linked/skipped, batch ${b.batch_key}.`);
  return {promoted,skipped,batch:b.batch_key};
}
