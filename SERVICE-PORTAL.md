# HTFO Service Operations Portal

Private staff portal for service scheduling, customer/equipment history, work orders, invoices and payments.

## What is included

- Username/password staff authentication with 12-hour sessions
- Customer database with search and CSV bulk import
- Duplicate protection during CSV import using email and phone
- Multiple equipment records per customer
- Equipment fields for type, brand, model, serial number, install date and warranty date
- Service scheduling and technician assignment
- Work-order numbers, status, priority and warranty flags
- Complaint, diagnosis, work performed, parts used and internal notes
- Labor hours, labor amount, parts, trip charge, tax and total
- Customer signature storage field
- Service history by customer
- Service invoice records and paid/partial/unpaid status
- Dashboard for today's calls, open work orders, customer count and unpaid balance
- Mobile-friendly staff interface at `/service-portal.html`

## Architecture

The public site remains static. Private customer/service records are stored only in the server-side PostgreSQL database and exposed through authenticated `/api/service/*` endpoints.

The service backend entry point is `backend/service-server.js`. It uses the same allowed-origin policy as the existing store backend.

## Required server settings

See `backend/.env.example` for:

- `DATABASE_URL`
- `DATABASE_SSL`
- `SERVICE_PORT`
- `SERVICE_JWT_SECRET`
- `SERVICE_ADMIN_USER`
- `SERVICE_ADMIN_PASSWORD`
- `SERVICE_ADMIN_NAME`

The administrator password is hashed before storage. Do not put real credentials in GitHub.

## Database initialization

On service-backend startup the database tables are created automatically. If the bootstrap administrator does not yet exist, the server creates it from the environment variables.

## Starting the service backend

From `backend/`:

```bash
npm install
npm run service
```

## Customer CSV import

The browser importer recognizes common headers for:

- first name
- last name
- company
- email
- phone/mobile/cell
- address/street
- address 2/apartment/suite
- city
- state
- ZIP/postal code
- notes

The endpoint also accepts a normalized array of customer records, so future migration scripts can send cleaned customer data directly.

## Apple Calendar migration

Historical Apple Calendar service notes should be imported in a second migration step after customer matching. Recommended matching order is phone/email first, then address/name, followed by manual review of uncertain matches. Calendar history should become completed work orders so each customer receives a real service timeline instead of one large notes field.

## Next deployment step

Provision a persistent PostgreSQL database and deploy `backend/service-server.js` on the same backend host (or another private API host). Then set the service portal API base to that deployed service endpoint before merging to production.

## Payment integration

Service invoices are stored now. Online Authorize.Net collection can be wired to the existing store payment functions after the service backend is deployed, so paid transactions update the service invoice automatically instead of requiring staff to mark them paid manually.
