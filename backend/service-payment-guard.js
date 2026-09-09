import { q } from './service-db.js';

export async function initServicePaymentGuard(){
  await q(`
    CREATE OR REPLACE FUNCTION htfo_require_payment_before_service_schedule() RETURNS trigger AS $$
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
      FOR EACH ROW EXECUTE FUNCTION htfo_require_payment_before_service_schedule();
  `);
}
