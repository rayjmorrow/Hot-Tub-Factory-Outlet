import { q } from './service-db.js';

export async function initServiceAudit(){
  await q(`
    CREATE TABLE IF NOT EXISTS service_audit_log (
      id BIGSERIAL PRIMARY KEY,
      table_name TEXT NOT NULL,
      record_id TEXT,
      action TEXT NOT NULL,
      actor TEXT,
      old_data JSONB,
      new_data JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_service_audit_record ON service_audit_log(table_name,record_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_service_audit_created ON service_audit_log(created_at DESC);

    CREATE OR REPLACE FUNCTION htfo_service_audit_trigger() RETURNS trigger AS $$
    DECLARE
      old_json JSONB;
      new_json JSONB;
      rec_id TEXT;
      who TEXT;
    BEGIN
      old_json := CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END;
      new_json := CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END;
      rec_id := COALESCE(new_json->>'id',new_json->>'customer_id',old_json->>'id',old_json->>'customer_id');
      who := NULLIF(current_setting('app.service_actor',true),'');
      INSERT INTO service_audit_log(table_name,record_id,action,actor,old_data,new_data)
      VALUES(TG_TABLE_NAME,rec_id,TG_OP,COALESCE(who,current_user),old_json,new_json);
      RETURN COALESCE(NEW,OLD);
    END;
    $$ LANGUAGE plpgsql;
  `);

  const tables=[
    'service_customers','service_equipment','service_requests','service_work_orders',
    'service_invoices','service_payments','service_part_requests','service_estimates','service_warranty_claims',
    'service_customer_payment_settings'
  ];
  for(const table of tables){
    const exists=await q('SELECT to_regclass($1) name',[table]);
    if(!exists.rows[0]?.name) continue;
    const trigger=`htfo_audit_${table}`;
    await q(`DROP TRIGGER IF EXISTS ${trigger} ON ${table}`);
    await q(`CREATE TRIGGER ${trigger} AFTER INSERT OR UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION htfo_service_audit_trigger()`);
  }
}
