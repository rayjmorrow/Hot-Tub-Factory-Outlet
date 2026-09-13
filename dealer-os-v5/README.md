# HTFO Dealer OS v5.0

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

## Routing states
- AI Can Handle
- Human Attention Recommended
- Hot Lead — Call Now
- Appointment Booked
- Long-Term Nurture

## New application routes
- /command-center
- /call-queue
- /ai-coach
- /setter-queue
- /reviews
- /event-builder
- /advanced-ads

## New integration endpoints
- POST /api/call-event
- POST /api/review-trigger

The working v5 application package is being kept separate from the public HTFO site while it is tested. External carrier, AI, review, ad-publisher, and geofencing integrations remain adapter-based so the dealer platform is not locked to one vendor.
