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
      status TEXT NOT NULL DEFAULT 'scheduled',
      priority TEXT NOT NULL DEFAULT 'normal',
      scheduled_start TIMESTAMPTZ,
      scheduled_end TIMESTAMPTZ,
      complaint TEXT,
      diagnosis TEXT,
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
    CREATE INDEX IF NOT EXISTS idx_service_work_orders_schedule ON service_work_orders (scheduled_start);
    CREATE INDEX IF NOT EXISTS idx_service_work_orders_customer ON service_work_orders (customer_id);

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
  `);
}

export async function q(text, params=[]){ return pool.query(text, params); }
