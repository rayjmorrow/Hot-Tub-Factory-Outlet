import { q } from './service-db.js';

export async function initServicePaymentGuard(){
  await q(`
    ALTER TABLE service_customer_orders ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0;
    ALTER TABLE service_customer_orders ADD COLUMN IF NOT EXISTS delivery_exception_authorized BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE service_customer_orders ADD COLUMN IF NOT EXISTS delivery_exception_reason TEXT;
    ALTER TABLE service_customer_orders ADD COLUMN IF NOT EXISTS delivery_exception_by TEXT;
    ALTER TABLE service_customer_orders ADD COLUMN IF NOT EXISTS delivery_exception_at TIMESTAMPTZ;

    CREATE OR REPLACE FUNCTION htfo_require_payment_before_service_schedule() RETURNS trigger AS $
    DECLARE order_total NUMERIC; order_paid NUMERIC; exception_ok BOOLEAN;
    BEGIN
      IF COALESCE(NEW.job_type,'service')='delivery' AND NEW.scheduled_start IS NOT NULL THEN
        IF NEW.customer_order_id IS NULL THEN
          RAISE EXCEPTION 'Delivery must be scheduled from a customer sales order';
        END IF;
        SELECT total_amount,amount_paid,delivery_exception_authorized
          INTO order_total,order_paid,exception_ok
          FROM service_customer_orders
          WHERE id=NEW.customer_order_id AND customer_id=NEW.customer_id;
        IF order_total IS NULL THEN
          RAISE EXCEPTION 'Delivery sales order was not found for this customer';
        END IF;
        IF COALESCE(order_paid,0) + 0.005 < COALESCE(order_total,0) AND COALESCE(exception_ok,false)=false THEN
          RAISE EXCEPTION 'Spa must be paid in full before delivery can be scheduled unless Rick or Ray authorizes an exception';
        END IF;
      END IF;
      RETURN NEW;
    END;
    $ LANGUAGE plpgsql;

    CREATE OR REPLACE FUNCTION htfo_require_payment_before_service_schedule_legacy() RETURNS trigger AS $
    DECLARE payment_state TEXT;
    BEGIN
      IF COALESCE(NEW.job_type,'service')='service' AND NEW.scheduled_start IS NOT NULL THEN
        SELECT payment_status INTO payment_state
        FROM service_customer_payment_settings
        WHERE customer_id=NEW.customer_id;

        IF COALESCE(payment_state,'needed') NOT IN ('card_on_file','cash_check_approved') THEN
          RAISE EXCEPTION 'Payment method must be secured before scheduling service';
        END IF;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_htfo_require_payment_before_service_schedule ON service_work_orders;
    CREATE TRIGGER trg_htfo_require_payment_before_service_schedule
      BEFORE INSERT OR UPDATE OF scheduled_start,customer_id,job_type
      ON service_work_orders
      FOR EACH ROW EXECUTE FUNCTION htfo_require_payment_before_service_schedule_legacy();

    DROP TRIGGER IF EXISTS trg_htfo_require_payment_before_delivery_schedule ON service_work_orders;
    CREATE TRIGGER trg_htfo_require_payment_before_delivery_schedule
      BEFORE INSERT OR UPDATE OF scheduled_start,customer_id,job_type,customer_order_id
      ON service_work_orders
      FOR EACH ROW EXECUTE FUNCTION htfo_require_payment_before_service_schedule();
  `);
}
