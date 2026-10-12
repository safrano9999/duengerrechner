// Shared by the original browser UI, Node.js and Cloudflare Workers.
globalThis.DuengerCore = Object.freeze({
  nutrients: Object.freeze(['n', 'n-no3', 'n-nh4', 'n-nu', 'n-org', 'p', 'k', 'ca', 'mg', 's', 'b', 'cu', 'fe', 'mn', 'mo', 'zn', 'na', 'cl']),
  conversions: Object.freeze({
    cao: { to: 'ca', factor: 0.715 }, k2o: { to: 'k', factor: 0.8302 },
    mgo: { to: 'mg', factor: 0.603 }, no3: { to: 'n', factor: 0.226 },
    p2o5: { to: 'p', factor: 0.436 }, po4: { to: 'p', factor: 0.326 },
    so4: { to: 's', factor: 0.334 },
  }),
  round: (value, decimals = 2) => Number(value.toFixed(decimals)),
  scale: (value, multiplier = 1) => Number((value * multiplier).toFixed(3)) || 0,
  calcGH: (ca, mg) => ca * 0.14 + mg * 0.2307,
  calcKH: (ks) => ks === 0 ? 0 : (ks - 0.05) * 2.8,
});
