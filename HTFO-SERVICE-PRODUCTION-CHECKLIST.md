# HTFO Service Operations — Production Launch Checklist

This checklist separates work that can be completed in code from decisions, credentials, and real data that must come from HTFO.

## 1. Workflow / application
- [x] Staff authentication foundation
- [x] Customer database/search
- [x] Customer detail with service history and invoices
- [x] Multiple products/equipment per customer
- [x] Store product type, brand, model, serial number, install/purchase date, warranty date, location and notes
- [x] Create a service call directly from a customer/product record
- [x] Work-order foundation
- [x] Service + delivery dispatch foundation
- [x] Manager-only dispatch changes
- [x] Technician mobile/PWA foundation
- [x] Parts catalog and request queue foundation
- [x] Estimate foundation
- [x] Invoice foundation
- [x] Cash/check field payment ledger foundation
- [x] Hosted-card checkout foundation
- [x] Card-on-file authorization/token foundation
- [x] Manager Charge Card on File action
- [x] Payment-method-required-before-service-scheduling guard
- [x] Warranty receivables foundation
- [x] Database audit-trail foundation
- [x] Production desktop portal monthly/day/hourly calendar workflow
- [x] Full work-order detail view on desktop portal
- [x] Global invoices screen on desktop portal
- [x] Product-specific service-history joins in work-order/calendar views
- [x] Manager staff-account/admin console foundation
- [x] Manager audit-history viewer foundation
- [ ] Add photo/attachment storage
- [ ] Add customer signature capture/storage strategy
- [ ] Add printable invoice/work-order documents
- [ ] Add warranty form template/fill workflow per manufacturer

## 2. Database / architecture
- [x] PostgreSQL schema foundation
- [x] Customer → Equipment → Work Order → Invoice relationships
- [x] Parts / estimates / warranty / payment schema foundations
- [x] Audit log table and automatic insert/update/delete history triggers
- [x] Add Dealer/Tenant and Location foundation before broad real-data import
- [ ] Normalize dispatch assignment to resource IDs instead of names
- [ ] Map staff users to dispatch resources
- [ ] Finalize indexes and production migration scripts

## 3. Hosting / production infrastructure
- [ ] Identify current backend hosting, if any
- [ ] Select/confirm production Node/Express host
- [ ] Provision production PostgreSQL database
- [ ] Configure service API hostname (recommended: service-api.hottubfactoryoutlet.com)
- [ ] Configure private portal hostname (recommended: service.hottubfactoryoutlet.com)
- [ ] Configure HTTPS
- [ ] Configure environment variables/secrets outside GitHub
- [ ] Configure CORS only for approved HTFO origins
- [ ] Configure health/uptime monitoring

## 4. Backup / recovery requirements
- [ ] Automatic database backup every day
- [ ] Retain at least 30 days of daily backups
- [ ] Enable point-in-time recovery when supported by database host
- [ ] Keep an independent periodic backup outside the primary database provider
- [ ] Document restore procedure
- [ ] Perform a real restore test before production launch
- [ ] Repeat restore test periodically

### Recovery target
The goal is to be able to recover from accidental deletion, a bad deployment, database corruption, or host failure without relying on a single copy of production data.

## 5. Security / staff access
- [ ] Create Ray admin account
- [ ] Create Rick service-manager account
- [ ] Create Bill technician account
- [ ] Create Dave technician account
- [ ] Decide additional staff roles
- [x] Individual-account management foundation; no shared production password required
- [x] Manager password reset foundation
- [ ] Add self-service password change/reset if desired
- [ ] Review role permissions before launch
- [x] Backend blocks regular technicians from dispatch changes
- [x] Backend charge overrides restricted to owner/admin/service-manager roles
- [x] Card-on-file architecture stores processor profile tokens/last four, not raw card numbers or CVV

## 6. HTFO business rules needed from Ray/Rick
- [x] Standard labor rate — $150/hour
- [x] Minimum/diagnostic charge — $100 diagnostic
- [x] Standard service-call duration — 60 minutes; leaks may be scheduled longer
- [x] Taxability — 7% on parts; labor non-taxable
- [ ] Parts markup/margin rules
- [ ] Final trip-charge rule confirmation and whether travel time is one-way
- [x] Charge overrides — Ray and Rick only
- [x] Discount/charge override authority — Ray and Rick only
- [ ] Warranty labor reimbursement rules by manufacturer
- [ ] Warranty trip reimbursement rules by manufacturer
- [ ] Warranty parts/return requirements
- [ ] Cancellation/no-show policy, if any

## 7. Customer data migration
- [ ] Gather customer CSV/source data
- [x] Add tenant/location foundation first
- [ ] Import into staging database
- [ ] Deduplicate by normalized email/phone/address
- [ ] Review duplicates manually
- [ ] Import/attach equipment and serial numbers where available
- [ ] Decide what historical Apple Calendar/service data to migrate
- [ ] Validate sample customer histories before production import

## 8. Public service request integration
- [x] Public service request page
- [x] Temporary email forwarding to Rick
- [ ] Verify one-time FormSubmit activation
- [x] Production API intake endpoint built
- [x] Create or match customer automatically from request
- [x] Insert request into service queue
- [ ] Switch live public form from temporary email-only submission to production API after backend deployment
- [ ] Notify Rick automatically from production request workflow
- [x] Keep customer confirmation page/message
- [x] Honeypot spam field foundation
- [ ] Add production rate limiting/abuse protection

## 9. Payments
- [x] Invoice-to-payment data model foundation
- [x] Cash/check payment ledger foundation
- [x] Hosted Authorize.Net card checkout foundation
- [x] Customer card-on-file authorization page foundation
- [x] Authorize.Net customer/payment profile token storage foundation
- [x] Card on File / Cash-Check Approved / Payment Needed states
- [x] Manager-only remote Charge Card on File action
- [x] Scheduling guard requires card on file or cash/check approval for service calls
- [ ] Review final customer authorization language against HTFO/Authorize.Net requirements
- [ ] Confirm production Authorize.Net credentials in server environment
- [ ] Complete automatic server-side webhook verification/linking for hosted card payments
- [ ] Test full card-on-file authorization and remote charge
- [ ] Test hosted card payment and invoice auto-update
- [ ] Test partial payment
- [ ] Test cash payment
- [ ] Test check payment with check number
- [ ] Test refund/void policy and workflow if required

## 10. Warranty
- [x] Warranty receivables foundation
- [ ] Upload manufacturer warranty claim forms
- [ ] Map each form's fields once
- [ ] Auto-fill customer/product/model/serial/work-order information
- [x] Claim number/status/claimed/approved/paid data foundation
- [ ] Correct outstanding receivable logic to use approved amount after approval
- [ ] Add aging/reporting by manufacturer

## 11. Notifications / integrations
- [ ] New request notification to Rick
- [ ] Appointment confirmation to customer
- [ ] Technician en-route notification
- [ ] Reschedule/parts-delay notification
- [ ] Invoice/payment link notification
- [ ] Decide which notifications use HighLevel/LeadConnector vs direct service backend
- [ ] Add route-time provider for automatic travel time

## 12. Production acceptance test
Before real launch, complete one full test using test data:
- [ ] Create customer
- [ ] Add multiple products to customer
- [ ] Secure payment method or approve cash/check
- [ ] Create service call from specific product
- [ ] Schedule/assign technician
- [ ] Open job on technician phone
- [ ] Enter diagnosis/work performed
- [ ] Add/request part
- [ ] Complete work order
- [ ] Create invoice
- [ ] Record cash/check payment
- [ ] Run hosted card test
- [ ] Run card-on-file remote charge test
- [ ] Verify paid/partial balance
- [ ] Verify customer/product history
- [ ] Generate warranty paperwork
- [ ] Verify audit trail
- [ ] Verify backup exists
- [ ] Restore backup into test environment

## Launch gate
Do not move real customer/service data into production until these five items are complete:
1. Production database exists with automated backups.
2. Private backend is hosted over HTTPS with secrets outside GitHub.
3. Tenant/location structure is finalized.
4. Staff roles/accounts and permissions are tested.
5. End-to-end acceptance test and backup restore test both pass.
