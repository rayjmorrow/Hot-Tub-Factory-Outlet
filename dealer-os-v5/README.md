# HTFO Dealer OS v5.3

Development integration scaffold for the HTFO dealer operating system.

## v5 capabilities
1. Missed-call recovery with immediate Bubbles SMS queueing when consent exists.
2. Priority-scored salesperson call queue with logged outcomes.
3. Owner Command Center with human-attention routing.
4. Dormant-lead resurrection.
5. Bubbles Sales Coach / next-best-action recommendations.
6. Competitor-geofence configuration and provider seam.
7. Event Campaign Builder with draft email/SMS campaign creation.
8. Review Engine with delivery/service trigger endpoint.
9. AI-first/human-second routing.

## v5.2 delivery proof + spa package workflow
A delivery cannot be marked Completed until the required proof package exists:
- customer "happy picture" beside the delivered hot tub;
- proof-of-delivery photo showing the product in place;
- customer typed acceptance name;
- explicit receipt acknowledgement;
- customer finger signature captured on the iPhone;
- completion timestamp and completing user;
- model/serial data when available.

For spa deliveries the form carries customer name, address, phone and email from the customer record and preloads the standard package:
- Promo Step;
- Frog Ease Start-Up Kit;
- Spa Ease 100 cover lifter for qualifying brands.

Innova Spas and Eco Spas do not automatically receive the Spa Ease 100. The lifter field remains editable so another cover-lifter model can be substituted when needed.

The delivery form includes notes for damage, backordered items, missing accessories, property issues or other exceptions. Ray and Rick can review the stored proof package from the delivery record.

## v5.3 Waze field navigation
- Technician Today, Week, Calendar Day and Work Order views include one-tap Waze routing from the customer address.
- Delivery board and delivery record include one-tap Waze routing.
- Waze receives the full street, city, state and ZIP destination so field staff do not retype addresses.

## Routing states
- AI Can Handle
- Human Attention Recommended
- Hot Lead — Call Now
- Appointment Booked
- Long-Term Nurture

## Application routes
- /command-center
- /deliveries
- /delivery/:id
- /call-queue
- /ai-coach
- /setter-queue
- /reviews
- /event-builder
- /advanced-ads

## Integration endpoints
- POST /api/call-event
- POST /api/review-trigger

The working application package is kept separate from the public HTFO site while it is tested. External carrier, AI, review, ad-publisher, and geofencing integrations remain adapter-based so the dealer platform is not locked to one vendor.
