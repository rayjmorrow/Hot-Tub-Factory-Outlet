import { q } from './service-db.js';

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
    return {promoted:0,batch:null};
  }
  const b=batch.rows[0];

  const before=await q('SELECT count(*)::int n FROM service_customers');

  await q(`
    INSERT INTO service_customers(first_name,last_name,email,phone,street,city,state,zip,notes,source)
    SELECT
      NULLIF(trim(s.first_name),''),
      NULLIF(trim(s.last_name),''),
      NULLIF(lower(trim(s.primary_email)),''),
      NULLIF(trim(s.primary_phone),''),
      NULLIF(trim(s.street),''),
      NULLIF(trim(s.city),''),
      NULLIF(upper(trim(s.state)),''),
      NULLIF(trim(s.zip),''),
      NULLIF(concat_ws(E'\n',
        CASE WHEN nullif(trim(s.secondary_phone),'') IS NOT NULL THEN 'Secondary phone: '||trim(s.secondary_phone) END,
        CASE WHEN nullif(trim(s.additional_phones),'') IS NOT NULL THEN 'Additional phones: '||trim(s.additional_phones) END,
        CASE WHEN nullif(trim(s.additional_emails),'') IS NOT NULL THEN 'Additional emails: '||trim(s.additional_emails) END,
        CASE WHEN nullif(trim(s.recent_notes),'') IS NOT NULL THEN 'Historical notes: '||trim(s.recent_notes) END
      ),''),
      'HTFO master import'
    FROM service_customer_import_staging s
    WHERE s.batch_id=$1 AND s.row_status='staged'
      AND NOT EXISTS (
        SELECT 1 FROM service_customers c
        WHERE regexp_replace(lower(concat_ws(' ',c.street,c.city,c.state,c.zip)),'[^a-z0-9]','','g')=s.normalized_address
           OR (s.primary_email IS NOT NULL AND s.primary_email<>'' AND lower(c.email)=lower(s.primary_email))
           OR (s.primary_phone IS NOT NULL AND s.primary_phone<>'' AND regexp_replace(c.phone,'\\D','','g')=regexp_replace(s.primary_phone,'\\D','','g'))
      )
  `,[b.id]);

  await q(`
    INSERT INTO service_customer_import_links(staging_id,batch_id,source_customer_id,customer_id,aliases,merged_customer_ids,review_note)
    SELECT s.id,s.batch_id,s.source_customer_id,c.id,s.aliases,s.merged_customer_ids,s.review_note
    FROM service_customer_import_staging s
    JOIN LATERAL (
      SELECT c.id
      FROM service_customers c
      WHERE regexp_replace(lower(concat_ws(' ',c.street,c.city,c.state,c.zip)),'[^a-z0-9]','','g')=s.normalized_address
         OR (s.primary_email IS NOT NULL AND s.primary_email<>'' AND lower(c.email)=lower(s.primary_email))
         OR (s.primary_phone IS NOT NULL AND s.primary_phone<>'' AND regexp_replace(c.phone,'\\D','','g')=regexp_replace(s.primary_phone,'\\D','','g'))
      ORDER BY CASE WHEN regexp_replace(lower(concat_ws(' ',c.street,c.city,c.state,c.zip)),'[^a-z0-9]','','g')=s.normalized_address THEN 0 ELSE 1 END, c.id
      LIMIT 1
    ) c ON true
    WHERE s.batch_id=$1 AND s.row_status='staged'
    ON CONFLICT(staging_id) DO NOTHING
  `,[b.id]);

  await q(`
    INSERT INTO service_equipment(customer_id,equipment_type,brand,model,install_date,notes)
    SELECT l.customer_id,'Hot Tub',NULLIF(trim(s.spa_makes),''),NULLIF(trim(s.spa_models),''),s.purchase_date,
      'Imported from historical HTFO customer database. Serial number not auto-assigned.'
    FROM service_customer_import_staging s
    JOIN service_customer_import_links l ON l.staging_id=s.id
    WHERE s.batch_id=$1
      AND (NULLIF(trim(s.spa_makes),'') IS NOT NULL OR NULLIF(trim(s.spa_models),'') IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM service_equipment e WHERE e.customer_id=l.customer_id)
  `,[b.id]);

  await q(`UPDATE service_customer_import_staging SET row_status='promoted',updated_at=NOW() WHERE batch_id=$1 AND row_status='staged'`,[b.id]);
  await q(`UPDATE service_customer_import_batches SET status='promoted',updated_at=NOW() WHERE id=$1`,[b.id]);

  const after=await q('SELECT count(*)::int n FROM service_customers');
  const linked=await q('SELECT count(*)::int n FROM service_customer_import_links WHERE batch_id=$1',[b.id]);
  const promoted=after.rows[0].n-before.rows[0].n;
  console.log(`Customer promotion complete: ${promoted} inserted, ${linked.rows[0].n} staged rows linked, batch ${b.batch_key}.`);
  return {promoted,linked:linked.rows[0].n,batch:b.batch_key};
}
