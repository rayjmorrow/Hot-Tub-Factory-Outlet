import { q } from './service-db.js';

export function calculateTripCharge(minutes){
  const m=Math.max(0,Number(minutes)||0);
  if(m<=30) return 80;
  return 80 + Math.ceil((m-30)/15)*15;
}

export async function initServiceFinancials(){
  await q(`
    ALTER TABLE service_work_orders ADD COLUMN IF NOT EXISTS travel_minutes NUMERIC(8,2);
    ALTER TABLE service_work_orders ADD COLUMN IF NOT EXISTS calculated_trip_charge NUMERIC(12,2) NOT NULL DEFAULT 80;
    ALTER TABLE service_work_orders ADD COLUMN IF NOT EXISTS trip_charge_override NUMERIC(12,2);
    ALTER TABLE service_work_orders ADD COLUMN IF NOT EXISTS trip_charge_override_reason TEXT;
    ALTER TABLE service_work_orders ADD COLUMN IF NOT EXISTS travel_time_source TEXT;

    CREATE TABLE IF NOT EXISTS service_warranty_claims (
      id BIGSERIAL PRIMARY KEY,
      work_order_id BIGINT NOT NULL REFERENCES service_work_orders(id) ON DELETE CASCADE,
      supplier TEXT NOT NULL,
      claim_number TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      labor_claimed NUMERIC(12,2) NOT NULL DEFAULT 0,
      parts_claimed NUMERIC(12,2) NOT NULL DEFAULT 0,
      trip_claimed NUMERIC(12,2) NOT NULL DEFAULT 0,
      other_claimed NUMERIC(12,2) NOT NULL DEFAULT 0,
      total_claimed NUMERIC(12,2) NOT NULL DEFAULT 0,
      total_approved NUMERIC(12,2) NOT NULL DEFAULT 0,
      total_paid NUMERIC(12,2) NOT NULL DEFAULT 0,
      submitted_at TIMESTAMPTZ,
      approved_at TIMESTAMPTZ,
      paid_at TIMESTAMPTZ,
      payment_reference TEXT,
      denial_reason TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_service_warranty_claims_status ON service_warranty_claims(status);
    CREATE INDEX IF NOT EXISTS idx_service_warranty_claims_supplier ON service_warranty_claims(supplier);
    CREATE INDEX IF NOT EXISTS idx_service_warranty_claims_work_order ON service_warranty_claims(work_order_id);

    CREATE OR REPLACE FUNCTION htfo_set_trip_charge() RETURNS trigger AS $$
    DECLARE m NUMERIC;
    DECLARE calc NUMERIC;
    BEGIN
      m := COALESCE(NEW.travel_minutes,0);
      IF m <= 30 THEN calc := 80;
      ELSE calc := 80 + CEIL((m-30)/15)*15;
      END IF;
      NEW.calculated_trip_charge := calc;
      NEW.trip_amount := COALESCE(NEW.trip_charge_override,calc);
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_htfo_set_trip_charge ON service_work_orders;
    CREATE TRIGGER trg_htfo_set_trip_charge
      BEFORE INSERT OR UPDATE OF travel_minutes, trip_charge_override
      ON service_work_orders
      FOR EACH ROW EXECUTE FUNCTION htfo_set_trip_charge();
  `);
}
