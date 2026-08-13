"use strict";

// Great-circle distance in km.
//
// The warehouse has always refined its bounding-box query with this before
// returning results, so a warehouse search respects the radius exactly. The
// live path had no equivalent, which is why the same slider meant two different
// things depending on where the leads came from.
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

module.exports = { haversineKm };
