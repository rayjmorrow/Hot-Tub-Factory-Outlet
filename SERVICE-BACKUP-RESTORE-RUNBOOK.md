# HTFO Service Operations — Backup & Restore Runbook

## Required production backup policy

The production PostgreSQL database is the system of record for customers, equipment/serial numbers, service requests, appointments, work orders, invoices, payments, warranty claims, parts activity and audit history.

Before production launch, the database host must provide:

1. Automatic backups at least once every 24 hours.
2. At least 30 days of daily backup retention.
3. Point-in-time recovery (PITR) when supported by the selected provider.
4. Encryption in transit and at rest.
5. A documented restore path into a separate database/environment.

HTFO should also keep an independent periodic backup outside the primary database provider. A practical starting policy is a weekly encrypted PostgreSQL dump retained for at least 90 days in a separate storage provider/account.

## What GitHub does and does not back up

GitHub protects/version-controls the application source code. It is not a backup of the production PostgreSQL data. Never commit production database dumps, customer exports, card-profile tokens, API keys, passwords or other production secrets to GitHub.

## Recovery objectives

Initial targets for the service system:

- Recovery Point Objective (RPO): no more than 24 hours of data loss from the daily-backup layer; substantially less when PITR is enabled.
- Recovery Time Objective (RTO): restore a usable service database and API within the same business day for a major database incident.

These targets can be tightened after production usage and hosting capabilities are known.

## Daily automated checks

Production monitoring should verify both:

- `GET /health` — application process is responding.
- `GET /ready` — application can successfully query PostgreSQL.

An application can be healthy while the database is unavailable; both checks matter.

## Monthly restore test

At least monthly during the first production quarter, then on a regular schedule thereafter:

1. Select a recent production backup.
2. Restore it into a non-production PostgreSQL database.
3. Point a staging copy of the service API at the restored database using staging-only secrets.
4. Confirm `/ready` reports database connectivity.
5. Verify a sample customer opens correctly.
6. Verify that customer's equipment and serial number records.
7. Verify work-order history.
8. Verify invoice/payment history.
9. Verify warranty claims and audit history.
10. Record the backup timestamp, restore start/end time, tester and result.
11. Destroy the temporary restored environment when testing is complete unless it is the designated staging environment.

A backup should not be considered proven until a restore has succeeded.

## Incident recovery sequence

If production data is damaged or unavailable:

1. Stop writes to the affected production database if continuing writes could make recovery worse.
2. Preserve the failed database/snapshot for investigation; do not immediately destroy it.
3. Determine the last known-good time from audit history, monitoring and staff reports.
4. Prefer PITR to a moment immediately before the incident when available.
5. Otherwise restore the newest known-good daily backup.
6. Restore into a new database first rather than overwriting the failed database in place.
7. Run integrity checks and inspect recent customers/work orders/invoices/payments.
8. Point the service API to the recovered database only after validation.
9. Confirm `/ready` and run a short acceptance test.
10. Document what happened and any records that must be re-entered.

## Independent backup

Once the hosting provider is selected, configure a separate scheduled export. The export process must:

- use a dedicated least-privilege backup credential when possible;
- encrypt the dump before or during storage;
- write to a provider/account separate from the primary PostgreSQL host;
- never place the backup inside the public website or GitHub repository;
- retain enough generations that an unnoticed corruption is not copied over every usable backup.

## Before launch — mandatory evidence

Do not mark backup/recovery complete until HTFO can document:

- database provider and plan;
- automatic backup frequency;
- retention period;
- PITR availability/retention;
- independent-backup destination and schedule;
- one successful restore-test date;
- who is responsible for reviewing backup failures.

The production-launch checklist remains the source of truth for whether these items are complete.
