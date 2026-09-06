import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false } });

export async function initServiceDb(){
  if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for the service portal');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS service_users (
      id BIGSERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'staff',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS service_customers (
      id BIGSERIAL PRIMARY KEY,
      first_name TEXT, last_name TEXT, company TEXT,
      email TEXT, phone TEXT,
      street TEXT, street2 TEXT, city TEXT, state TEXT, zip TEXT,
      notes TEXT,
      source TEXT DEFAULT 'manual',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_service_customers_name ON service_customers (last_name, first_name);
    CREATE INDEX IF NOT EXISTS idx_service_customers_email ON service_customers (email);
    CREATE INDEX IF NOT EXISTS idx_service_customers_phone ON service_customers (phone);

    CREATE TABLE IF NOT EXISTS service_equipment (
      id BIGSERIAL PRIMARY KEY,
      customer_id BIGINT NOT NULL REFERENCES service_customers(id) ON DELETE CASCADE,
      equipment_type TEXT NOT NULL DEFAULT 'Hot Tub',
      brand TEXT, model TEXT, serial_number TEXT,
      install_date DATE, warranty_expires DATE,
      location_notes TEXT, notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_service_equipment_serial ON service_equipment (serial_number);

    CREATE TABLE IF NOT EXISTS service_work_orders (
      id BIGSERIAL PRIMARY KEY,
      work_order_number TEXT UNIQUE NOT NULL,
      customer_id BIGINT NOT NULL REFERENCES service_customers(id),
      equipment_id BIGINT REFERENCES service_equipment(id),
      assigned_to TEXT,
      status TEXT NOT NULL DEFAULT 'requested',
      priority TEXT NOT NULL DEFAULT 'normal',
      scheduled_start TIMESTAMPTZ,
      scheduled_end TIMESTAMPTZ,
      complaint TEXT,
      diagnosis TEXT,
      likely_issue TEXT,
      part_source_status TEXT NOT NULL DEFAULT 'unknown',
      part_source_name TEXT,
      expected_part_date DATE,
      pickup_required BOOLEAN NOT NULL DEFAULT FALSE,
      schedule_override BOOLEAN NOT NULL DEFAULT FALSE,
      scheduling_note TEXT,
      work_performed TEXT,
      parts_used TEXT,
      labor_hours NUMERIC(8,2) DEFAULT 0,
      labor_amount NUMERIC(12,2) DEFAULT 0,
      parts_amount NUMERIC(12,2) DEFAULT 0,
      trip_amount NUMERIC(12,2) DEFAULT 0,
      tax_amount NUMERIC(12,2) DEFAULT 0,
      total_amount NUMERIC(12,2) DEFAULT 0,
      warranty BOOLEAN NOT NULL DEFAULT FALSE,
      internal_notes TEXT,
      customer_signature TEXT,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE service_work_orders ADD COLUMN IF NOT EXISTS likely_issue TEXT;
    ALTER TABLE service_work_orders ADD COLUMN IF NOT EXISTS part_source_status TEXT NOT NULL DEFAULT 'unknown';
    ALTER TABLE service_work_orders ADD COLUMN IF NOT EXISTS part_source_name TEXT;
    ALTER TABLE service_work_orders ADD COLUMN IF NOT EXISTS expected_part_date DATE;
    ALTER TABLE service_work_orders ADD COLUMN IF NOT EXISTS pickup_required BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE service_work_orders ADD COLUMN IF NOT EXISTS schedule_override BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE service_work_orders ADD COLUMN IF NOT EXISTS scheduling_note TEXT;
    CREATE INDEX IF NOT EXISTS idx_service_work_orders_schedule ON service_work_orders (scheduled_start);
    CREATE INDEX IF NOT EXISTS idx_service_work_orders_customer ON service_work_orders (customer_id);

    CREATE TABLE IF NOT EXISTS service_requests (
      id BIGSERIAL PRIMARY KEY,
      customer_id BIGINT NOT NULL REFERENCES service_customers(id),
      equipment_id BIGINT REFERENCES service_equipment(id),
      complaint TEXT NOT NULL,
      likely_issue TEXT,
      preferred_date_1 DATE,
      preferred_window_1 TEXT,
      preferred_date_2 DATE,
      preferred_window_2 TEXT,
      customer_must_be_home BOOLEAN NOT NULL DEFAULT FALSE,
      status TEXT NOT NULL DEFAULT 'requested',
      manager_note TEXT,
      work_order_id BIGINT REFERENCES service_work_orders(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_service_requests_status ON service_requests(status);

    CREATE TABLE IF NOT EXISTS service_invoices (
      id BIGSERIAL PRIMARY KEY,
      invoice_number TEXT UNIQUE NOT NULL,
      work_order_id BIGINT REFERENCES service_work_orders(id),
      customer_id BIGINT NOT NULL REFERENCES service_customers(id),
      status TEXT NOT NULL DEFAULT 'draft',
      subtotal NUMERIC(12,2) DEFAULT 0,
      tax_amount NUMERIC(12,2) DEFAULT 0,
      total_amount NUMERIC(12,2) DEFAULT 0,
      amount_paid NUMERIC(12,2) DEFAULT 0,
      payment_method TEXT,
      paid_at TIMESTAMPTZ,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS service_parts (
      id BIGSERIAL PRIMARY KEY,
      supplier TEXT,
      supplier_part_number TEXT,
      manufacturer_part_number TEXT,
      description TEXT NOT NULL,
      brand TEXT,
      category TEXT,
      cost NUMERIC(12,2) NOT NULL DEFAULT 0,
      list_price NUMERIC(12,2),
      sell_price NUMERIC(12,2),
      quantity_on_hand NUMERIC(10,2) NOT NULL DEFAULT 0,
      quantity_committed NUMERIC(10,2) NOT NULL DEFAULT 0,
      reorder_point NUMERIC(10,2) NOT NULL DEFAULT 0,
      bin_location TEXT,
      taxable BOOLEAN NOT NULL DEFAULT TRUE,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      supplier_url TEXT,
      source_updated_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE service_parts ADD COLUMN IF NOT EXISTS quantity_on_hand NUMERIC(10,2) NOT NULL DEFAULT 0;
    ALTER TABLE service_parts ADD COLUMN IF NOT EXISTS quantity_committed NUMERIC(10,2) NOT NULL DEFAULT 0;
    ALTER TABLE service_parts ADD COLUMN IF NOT EXISTS reorder_point NUMERIC(10,2) NOT NULL DEFAULT 0;
    ALTER TABLE service_parts ADD COLUMN IF NOT EXISTS bin_location TEXT;
    CREATE INDEX IF NOT EXISTS idx_service_parts_supplier_no ON service_parts (supplier_part_number);
    CREATE INDEX IF NOT EXISTS idx_service_parts_mfg_no ON service_parts (manufacturer_part_number);
    CREATE INDEX IF NOT EXISTS idx_service_parts_desc ON service_parts USING gin (to_tsvector('english', description));

    CREATE TABLE IF NOT EXISTS service_issue_parts (
      id BIGSERIAL PRIMARY KEY,
      issue_key TEXT NOT NULL,
      part_id BIGINT NOT NULL REFERENCES service_parts(id),
      quantity_required NUMERIC(10,2) NOT NULL DEFAULT 1,
      priority INT NOT NULL DEFAULT 100,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      UNIQUE(issue_key,part_id)
    );

    CREATE TABLE IF NOT EXISTS service_pricing_rules (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT,
      rule_type TEXT NOT NULL DEFAULT 'markup_percent',
      value NUMERIC(12,4) NOT NULL,
      minimum_sell NUMERIC(12,2),
      minimum_profit NUMERIC(12,2),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      priority INT NOT NULL DEFAULT 100,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS service_estimates (
      id BIGSERIAL PRIMARY KEY,
      estimate_number TEXT UNIQUE NOT NULL,
      work_order_id BIGINT NOT NULL REFERENCES service_work_orders(id) ON DELETE CASCADE,
      customer_id BIGINT NOT NULL REFERENCES service_customers(id),
      status TEXT NOT NULL DEFAULT 'draft',
      labor_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      trip_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      customer_note TEXT,
      manager_note TEXT,
      approved_at TIMESTAMPTZ,
      rejected_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS service_estimate_items (
      id BIGSERIAL PRIMARY KEY,
      estimate_id BIGINT NOT NULL REFERENCES service_estimates(id) ON DELETE CASCADE,
      part_id BIGINT REFERENCES service_parts(id),
      description TEXT NOT NULL,
      quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
      unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
      unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      line_total NUMERIC(12,2) NOT NULL DEFAULT 0,
      taxable BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS service_part_requests (
      id BIGSERIAL PRIMARY KEY,
      work_order_id BIGINT NOT NULL REFERENCES service_work_orders(id) ON DELETE CASCADE,
      estimate_id BIGINT REFERENCES service_estimates(id),
      part_id BIGINT REFERENCES service_parts(id),
      requested_by TEXT,
      requested_quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'requested',
      source_status TEXT NOT NULL DEFAULT 'unsourced',
      source_name TEXT,
      expected_available_date DATE,
      pickup_required BOOLEAN NOT NULL DEFAULT FALSE,
      manager_approved_by TEXT,
      manager_approved_at TIMESTAMPTZ,
      supplier_order_number TEXT,
      ordered_at TIMESTAMPTZ,
      received_at TIMESTAMPTZ,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE service_part_requests ADD COLUMN IF NOT EXISTS source_status TEXT NOT NULL DEFAULT 'unsourced';
    ALTER TABLE service_part_requests ADD COLUMN IF NOT EXISTS source_name TEXT;
    ALTER TABLE service_part_requests ADD COLUMN IF NOT EXISTS expected_available_date DATE;
    ALTER TABLE service_part_requests ADD COLUMN IF NOT EXISTS pickup_required BOOLEAN NOT NULL DEFAULT FALSE;
  `);
}

export async function q(text, params=[]){ return pool.query(text, params); }
