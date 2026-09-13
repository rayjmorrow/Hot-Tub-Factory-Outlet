# HTFO Dealer OS v5.1

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

## v5.1 delivery proof workflow
A delivery cannot be marked Completed until the required proof package exists:
- customer "happy picture" beside the delivered hot tub;
- proof-of-delivery photo showing the product in place;
- customer typed acceptance name;
- explicit receipt acknowledgement;
- completion timestamp and completing user;
- model/serial data when available.

Ray and Rick can open the delivery record to review the evidence package. The Owner Command Center includes deliveries due today and delivery issues/incomplete proof. Completion automatically schedules the post-delivery review workflow.

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
