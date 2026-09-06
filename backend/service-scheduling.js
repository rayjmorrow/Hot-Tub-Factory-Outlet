import { q } from './service-db.js';

export async function initServiceScheduling(){
  await q(`
    ALTER TABLE service_work_orders ADD COLUMN IF NOT EXISTS job_type TEXT NOT NULL DEFAULT 'service';
    ALTER TABLE service_work_orders ADD COLUMN IF NOT EXISTS assigned_team TEXT;

    CREATE TABLE IF NOT EXISTS service_dispatch_resources (
      id BIGSERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      resource_type TEXT NOT NULL DEFAULT 'technician',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INT NOT NULL DEFAULT 100,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    INSERT INTO service_dispatch_resources(name,resource_type,sort_order)
    VALUES
      ('Bill','technician',10),
      ('Dave','technician',20),
      ('Rick','technician',30),
      ('Delivery','team',40)
    ON CONFLICT (name) DO NOTHING;

    CREATE INDEX IF NOT EXISTS idx_service_work_orders_job_type ON service_work_orders(job_type);
    CREATE INDEX IF NOT EXISTS idx_service_work_orders_assigned_team ON service_work_orders(assigned_team);
  `);
}
