# Hot Tub Factory Outlet Service Operations
## Staff User Guide

This guide explains how HTFO staff use the private service system for customers, scheduling, work orders, parts, estimates, invoices, and service history.

---

# 1. Who Uses What

## Store / Office Staff
Use the system to:
- find or add customers
- schedule service calls
- confirm customer address and contact information
- attach the correct spa/equipment record
- review service history
- review invoices and payment status

## Service Technician
Use the system to:
- open assigned service calls
- read the customer's complaint and prior history
- record diagnosis
- record work performed
- record labor time
- search the parts catalog
- request required parts
- create the information needed for an estimate
- record final parts used
- complete the work order

Technicians do **not** place supplier orders.

## Service Manager
Use the system to:
- review technician diagnoses and part requests
- verify part selection
- approve part requests
- place the actual supplier order
- record supplier order numbers
- mark parts received
- review pricing rules
- finalize unusual estimates
- review completed work orders before invoicing when necessary

## Administrator
Can perform all service-manager functions plus manage system configuration and staff access.

---

# 2. Signing In

1. Open the private HTFO Service Operations page.
2. Enter your assigned username.
3. Enter your password.
4. Select **Sign in**.

The service portal is separate from the public shopping website. Customer service records are not stored in public website files.

If your session expires, sign in again. Do not share staff passwords.

---

# 3. Dashboard

The Dashboard is the starting screen after login.

It shows:
- **Today's Calls** — scheduled service visits for today
- **Open Work Orders** — calls that are not completed or cancelled
- **Customers** — number of customer records in the system
- **Unpaid Invoices** — total outstanding service invoice balance
- **Upcoming Service** — the next scheduled service calls

Use this screen at the beginning of the day to see current workload.

---

# 4. Finding a Customer

1. Select **Customers**.
2. Type any useful information into the search box.

You can search by:
- first or last name
- company
- phone number
- email address
- street address
- city
- ZIP code

3. Select the customer to open the record.

The customer record shows contact information, equipment, previous service calls, and invoices.

### Before creating a new customer
Always search first. This reduces duplicate customer records.

---

# 5. Adding a Customer

1. Select **Customers**.
2. Select **+ Customer**.
3. Enter the customer's information.
4. Add useful notes if appropriate.
5. Select **Save Customer**.

Recommended minimum information:
- first and last name
- phone
- service address
- city/state/ZIP

Email should be recorded whenever available because it can be used later for estimates, invoices, and receipts.

---

# 6. Importing the Existing Customer List

Administrators can use **Import CSV** to load an existing customer list.

The importer recognizes common CSV headings for:
- first name
- last name
- company
- email
- phone/mobile/cell
- street/address
- address 2/apartment/suite
- city
- state
- ZIP/postal code
- notes

The importer checks email and phone numbers and skips likely duplicates rather than blindly creating another customer record.

After import, uncertain duplicates should be reviewed manually.

---

# 7. Equipment / Spa Records

A customer may have more than one piece of equipment.

Examples:
- hot tub
- swim spa
- sauna
- pool equipment
- other serviceable equipment

Each equipment record can contain:
- equipment type
- brand
- model
- serial number
- installation date
- warranty expiration date
- equipment location notes
- permanent equipment notes

Whenever possible, record the serial number. This gives HTFO a permanent history for the actual spa rather than only the owner.

---

# 8. Scheduling a Service Call

1. Select **Schedule**.
2. Select **+ Service Call**.
3. Choose the customer.
4. Choose the appointment date and time.
5. Assign the technician if known.
6. Set priority:
   - normal
   - high
   - urgent
7. Mark whether the call appears to be warranty-related.
8. Enter the customer's complaint in their own words when useful.
9. Add internal notes if needed.
10. Select **Create Work Order**.

The system automatically creates a work-order number.

---

# 9. Technician Workflow at the Customer's Home

Before starting work, open the customer's work order and review:
- complaint
- spa/equipment information
- previous service history
- warranty information
- internal notes

During or after diagnosis, record:
- diagnosis
- work performed
- labor time
- parts required or used
- relevant internal notes
- warranty status if it changes

Photos can be incorporated into the production workflow as the portal is finalized.

Do not erase useful diagnostic history just because a problem has been repaired.

---

# 10. Looking Up a Part

1. Select **Parts**.
2. Search using any information you know.

The search can use:
- supplier part number
- manufacturer part number
- description
- brand
- category

Examples:
- `5.5 kw heater`
- `circulation pump`
- `6540-723`
- `Vita control panel`

The result displays:
- part description
- supplier part number
- manufacturer part number
- supplier
- HTFO cost
- calculated HTFO customer selling price

The customer selling price is calculated from the pricing rules supplied by HTFO management. The technician does not need to calculate markup manually.

---

# 11. Parts Pricing Rules

Parts can be priced using management-defined rules such as:
- percentage markup over cost
- target gross-margin percentage
- cost multiplier
- fixed dollar amount above cost
- minimum selling price
- minimum gross-profit dollars
- category-specific pricing
- manually fixed sell price for an individual part

Example only:

If a pump costs HTFO $300 and the applicable rule produces a $499 selling price, the technician sees the customer price without needing to perform the calculation.

Actual HTFO pricing rules must be entered by management before production use.

---

# 12. When a Technician Needs a Part

The technician identifies the correct part and creates a **part request** tied to the work order.

The request records:
- work order
- customer
- requested part
- quantity
- technician/requester
- notes
- request status

The technician does not place the supplier order.

This prevents accidental orders and keeps purchasing control with the service manager.

---

# 13. Service Manager Parts Queue

Select **Parts Queue**.

The queue shows each requested part and its status.

Typical workflow:

**Requested → Approved → Ordered → Received**

## Requested
The technician has identified the needed part.

The service manager should verify:
- correct part
- correct quantity
- supplier information
- warranty status if relevant
- customer approval/estimate status when required

Then select **Manager Approve**.

## Approved
The part is approved internally but has not yet been ordered.

The service manager places the order with the supplier.

After ordering:
1. enter the supplier order number if available
2. select **Mark Ordered**

## Ordered
The part is on order.

When received, select **Mark Received**.

The ordering action remains a human service-manager responsibility even if supplier lookup becomes automated.

---

# 14. Estimates

When a repair requires customer approval, the system can create an estimate directly from the work order.

The estimate can include:
- selected parts
- quantities
- calculated HTFO selling price
- labor
- service/trip charge
- applicable tax
- customer notes

The parts price is calculated from HTFO rules rather than showing supplier cost.

Estimate statuses are:
- draft
- sent
- approved
- rejected
- expired

When the customer approves an estimate, the approval becomes part of the service record.

---

# 15. Completing the Repair

Before completing the work order, the technician should confirm:
- final diagnosis is recorded
- work performed is complete
- actual parts used are correct
- labor hours are correct
- warranty status is correct
- internal notes are complete
- any required customer acknowledgment/signature has been captured

The completed work order becomes part of the permanent customer/equipment service history.

---

# 16. Invoice Creation

A completed work order can be converted into a service invoice.

The invoice is based on the final work-order values, including:
- labor
- parts
- trip/service charge
- tax
- total

The purpose is to eliminate retyping the same job into a separate billing system.

If the final repair differs from the estimate, the invoice should reflect what was actually performed and supplied.

---

# 17. Payment

Service invoices can track:
- open/unpaid
- partially paid
- paid
- payment method
- amount paid
- paid date

The production version can use HTFO's existing Authorize.Net website payment system so a customer can receive an invoice/payment link and the service invoice can update automatically after successful online payment.

Cash/check/manual payments can be recorded by authorized staff.

---

# 18. Customer Service History

The customer record keeps previous service calls together.

Instead of relying on old Apple Calendar notes, the intended history becomes structured records such as:

**March 14, 2024 — No Heat**  
Diagnosis: failed heater  
Work performed: replaced 5.5 kW heater  
Status: completed

**October 8, 2025 — Leak**  
Diagnosis: leaking pump union  
Work performed: replaced seal and repaired connection  
Status: completed

This makes previous repairs easy to find during later calls.

---

# 19. Apple Calendar Migration

Historical Apple Calendar appointments should be imported as completed historical work orders whenever the information can be matched reliably.

Preferred customer matching order:
1. phone/email
2. service address
3. customer name
4. manual review when uncertain

Do not automatically attach an old service note to a customer when the match is questionable.

The goal is to preserve history accurately, not merely import every calendar note.

---

# 20. What the Technician Does NOT Need to Do

The technician should not have to:
- search multiple supplier sites manually for common catalog parts
- calculate part markup
- calculate estimate totals manually
- create a separate invoice from scratch
- place supplier orders
- maintain a separate paper service-history system
- put completed call history back into Apple Calendar

The system should turn the technician's diagnosis and actual work into the paperwork automatically.

---

# 21. What the Service Manager Still Controls

The service manager remains responsible for:
- confirming unusual or uncertain part selections
- approving part requests
- placing supplier orders
- entering/confirming supplier order information
- overriding pricing when management policy permits
- reviewing unusual estimates
- resolving disputed or unusual invoices

Automation is intended to remove repetitive lookup and data entry, not remove purchasing control.

---

# 22. Recommended Daily Routine

## Morning — Service Manager / Office
1. Open Dashboard.
2. Review today's calls.
3. Confirm technician assignments.
4. Review outstanding Parts Queue items.
5. Review any unpaid or unresolved service items.

## During the Day — Technician
1. Open assigned call.
2. Review history.
3. Diagnose.
4. Record findings.
5. Look up/request parts if needed.
6. Complete work performed and labor information.

## End of Day — Service Manager
1. Review new part requests.
2. Place approved orders.
3. Review completed work orders.
4. Confirm invoices are created/sent as appropriate.
5. Check unresolved calls and reschedule/follow up as needed.

---

# 23. Training Rule

If information belongs to a particular service call, put it on that work order rather than relying only on a general customer note.

General customer notes are for permanent information. Work-order notes are for what happened on that particular call.

This distinction is what makes the service history useful several years later.

---

# 24. Production Checklist Before Staff Launch

Before HTFO begins using the portal for real service operations, management should confirm:
- production database is deployed and backed up
- staff usernames/roles are created
- final labor/service-call pricing is entered
- final parts markup rules are entered
- initial parts catalog is imported
- Authorize.Net service invoice payment flow is connected
- customer CSV import has been reviewed
- Apple Calendar history migration is tested on a small sample
- technician mobile screens are tested in the field
- staff complete a test service call from scheduling through payment

---

# HTFO Workflow Summary

**Customer calls / requests service**  
→ Find or add customer  
→ Schedule service  
→ Work order created  
→ Technician diagnoses  
→ System finds/prices needed part  
→ Estimate generated when needed  
→ Technician requests part  
→ Service manager approves and orders  
→ Part received / repair completed  
→ Final work order completed  
→ Invoice generated  
→ Customer pays  
→ Permanent service history retained
