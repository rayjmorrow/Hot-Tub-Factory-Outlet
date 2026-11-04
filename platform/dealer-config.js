// Dealer-level configuration. Keep business-specific data out of shared platform logic.
window.HTFO_PLATFORM = window.HTFO_PLATFORM || {};
window.HTFO_PLATFORM.dealer = {
  id: "htfo",
  name: "Hot Tub Factory Outlet",
  market: "Greater Pittsburgh",
  website: "https://www.hottubfactoryoutlet.com",
  phone: "412-326-0361",
  locations: [
    { id: "monroeville", name: "Monroeville", address: "4680 Old William Penn Hwy, Monroeville, PA 15146" },
    { id: "wexford", name: "Wexford", address: "10269 Perry Hwy, Wexford, PA 15090" }
  ],
  assistant: {
    enabled: true,
    name: "Bubbles",
    preserveBrandName: true,
    goals: ["answer product questions", "help shoppers choose", "qualify leads", "handoff to sales"]
  },
  crm: { provider: null, endpoint: null },
  attribution: { preserveUtm: true, preserveLandingPage: true, preserveReferrer: true }
};
