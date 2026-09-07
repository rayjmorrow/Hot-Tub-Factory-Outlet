import { q } from './service-db.js';

export async function initServiceTenancy(){
  await q(`
    CREATE TABLE IF NOT EXISTS service_tenants (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS service_locations (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL REFERENCES service_tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      street TEXT,
      city TEXT,
      state TEXT,
      zip TEXT,
      phone TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(tenant_id,name)
    );
  `);

  const tenantName=process.env.SERVICE_TENANT_NAME||'Hot Tub Factory Outlet';
  const tenantSlug=process.env.SERVICE_TENANT_SLUG||'htfo';
  const tenant=(await q(`INSERT INTO service_tenants(name,slug) VALUES($1,$2)
    ON CONFLICT(slug) DO UPDATE SET name=EXCLUDED.name,updated_at=NOW() RETURNING id`,[tenantName,tenantSlug])).rows[0];

  await q(`INSERT INTO service_locations(tenant_id,name) VALUES($1,'Monroeville'),($1,'Wexford') ON CONFLICT(tenant_id,name) DO NOTHING`,[tenant.id]);

  const tenantTables=['service_users','service_customers','service_equipment','service_requests','service_work_orders','service_invoices','service_parts','service_estimates','service_part_requests'];
  for(const table of tenantTables){
    const exists=await q('SELECT to_regclass($1) name',[table]);
    if(!exists.rows[0]?.name) continue;
    await q(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS tenant_id BIGINT REFERENCES service_tenants(id)`);
    await q(`UPDATE ${table} SET tenant_id=$1 WHERE tenant_id IS NULL`,[tenant.id]);
    await q(`CREATE INDEX IF NOT EXISTS idx_${table}_tenant ON ${table}(tenant_id)`);
  }

  const locationTables=['service_users','service_customers','service_work_orders','service_invoices'];
  for(const table of locationTables){
    const exists=await q('SELECT to_regclass($1) name',[table]);
    if(!exists.rows[0]?.name) continue;
    await q(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS location_id BIGINT REFERENCES service_locations(id)`);
    await q(`CREATE INDEX IF NOT EXISTS idx_${table}_location ON ${table}(location_id)`);
  }
}
