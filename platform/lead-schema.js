// Canonical lead shape shared by forms, Spa Finder, ads and Bubbles.
window.HTFO_PLATFORM = window.HTFO_PLATFORM || {};
window.HTFO_PLATFORM.createLead = function createLead(input = {}) {
  const params = new URLSearchParams(window.location.search);
  return {
    schemaVersion: 1,
    dealerId: window.HTFO_PLATFORM.dealer?.id || "htfo",
    contact: input.contact || {},
    interest: input.interest || {},
    qualification: input.qualification || {},
    source: {
      channel: input.channel || "website",
      component: input.component || "form",
      landingPage: window.location.href,
      referrer: document.referrer || null,
      utmSource: params.get("utm_source"),
      utmMedium: params.get("utm_medium"),
      utmCampaign: params.get("utm_campaign"),
      utmContent: params.get("utm_content"),
      utmTerm: params.get("utm_term")
    },
    conversation: input.conversation || null,
    createdAt: new Date().toISOString()
  };
};
