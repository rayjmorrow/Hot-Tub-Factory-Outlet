# Dealer Growth Platform Foundation

Hot Tub Factory Outlet is Dealer 001 and the proving ground for a reusable, manufacturer-neutral dealer growth platform.

## Architecture rules

1. Preserve the HTFO customer experience; platform work should not make the public site generic.
2. Dealer-specific identity, locations, offers, brands, CRM destinations and assistant settings belong in configuration/data rather than shared logic.
3. Products should evolve toward a common catalog model with category-specific attributes.
4. Spa Finder is a reusable recommendation engine fed by dealer inventory.
5. Bubbles remains HTFO's assistant and is a first-class platform capability. The assistant engine should support dealer-specific names, knowledge, inventory, policies and promotions.
6. All conversion surfaces should emit the same canonical lead structure.
7. Preserve attribution from ad/UTM through lead and eventually appointment/sale.
8. Design hierarchy: Platform -> Dealer -> Location -> Brand -> Product -> Lead.
9. Future territory support should allow ZIP/county/radius definitions without coupling the core platform to Pittsburgh.
10. Build SaaS-ready seams now; do not delay HTFO launches to build speculative SaaS infrastructure.

## Near-term migration

- Centralize dealer/business constants.
- Normalize product records and brand enablement.
- Route forms and Spa Finder output through the canonical lead model.
- Expand Bubbles into a dealer-aware qualification and recommendation layer.
- Add CRM adapter boundary rather than coding directly to one CRM.
- Add persistent campaign attribution.
- Keep reusable education/content modules separate from dealer presentation.

## Success criterion

The HTFO implementation must remain excellent on its own while a future dealer can be onboarded primarily by supplying configuration, catalog, branding, territory and integrations instead of cloning and rewriting the application.
