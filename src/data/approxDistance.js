/**
 * Equirectangular ("flat earth") distance approximation — pure, no Cesium/DOM.
 *
 * Six modules had grown their own copy of the same three lines (flights,
 * meshFloorSampler, traffic, locations, annotationResolver, gevActions), and
 * every copy carried the same defect: a raw `lon2 - lon1` delta. Across the
 * antimeridian that delta is the LONG way round — 179°E to 179°W reads as
 * −358° instead of +2°, so two points ~220 km apart measured ~39,800 km. Every
 * caller uses these helpers as a proximity GATE (is this contact within
 * 150 km of the viewer? did the viewport centre shift far enough to refetch?),
 * so the inflated delta silently failed the gate for anything near ±180° —
 * the ground-floor clamp never armed over the Pacific, the mesh-floor probe
 * never fired, and "nearest" picks chose the wrong contact.
 *
 * {@link wrapLongitudeDeltaDeg} folds the delta back into [−180, 180] so the
 * short way round always wins. The approximation itself is unchanged and still
 * only appropriate for the short, mid-latitude spans these gates measure — use
 * a haversine for anything reported to the operator as a real distance.
 *
 * @module data/approxDistance
 */

/** Metres per degree of latitude (WGS84 mean). */
export const M_PER_DEG_LAT = 111_320;
/** Kilometres per degree of latitude, the same constant in km. */
export const KM_PER_DEG_LAT = M_PER_DEG_LAT / 1000;

const DEG_TO_RAD = Math.PI / 180;

/**
 * Fold a longitude difference into [−180, 180] so it always describes the
 * short way around the globe. A delta already in range is returned exactly as
 * given. At the single ±180 boundary either sign describes the same span, and
 * callers square or take the magnitude, so the sign there does not matter.
 *
 * @param {number} deltaDeg - Raw `lonB - lonA` in degrees (any magnitude).
 * @returns {number} Equivalent delta in [−180, 180], or NaN for non-finite input.
 */
export function wrapLongitudeDeltaDeg(deltaDeg) {
  if (!Number.isFinite(deltaDeg)) return Number.NaN;
  // Return an in-range delta untouched. The modulo round-trip below perturbs
  // the low bits (~1e-14 on a small delta), which is enough to break exact
  // idempotency for callers that re-derive a span from their own output.
  if (deltaDeg >= -180 && deltaDeg <= 180) return deltaDeg;
  return (((deltaDeg + 180) % 360) + 360) % 360 - 180;
}

/**
 * Normalize an absolute longitude into [−180, 180). Values that have drifted
 * out of range — by arithmetic that added a span to a longitude near ±180, say —
 * come back to the value every downstream consumer expects.
 *
 * @param {number} lonDeg - Longitude in degrees (any magnitude).
 * @returns {number} Longitude in [−180, 180), or NaN for non-finite input.
 */
export function normalizeLongitudeDeg(lonDeg) {
  if (!Number.isFinite(lonDeg)) return Number.NaN;
  // Return an in-range value untouched. The modulo round-trip below perturbs
  // the low bits (~1e-13 on a typical longitude), which is enough to break
  // exact idempotency for callers that re-clamp their own output.
  if (lonDeg >= -180 && lonDeg < 180) return lonDeg;
  return (((lonDeg + 180) % 360) + 360) % 360 - 180;
}

/**
 * Signed north/east offsets (degrees) between two points, longitude wrapped.
 * The east component is scaled by cos(mean latitude), the standard
 * equirectangular convergence correction.
 *
 * @param {number} latA @param {number} lonA @param {number} latB @param {number} lonB
 * @returns {{dLatDeg: number, dLonDeg: number}} Latitude and scaled-longitude offsets.
 */
export function approxOffsetsDeg(latA, lonA, latB, lonB) {
  const dLatDeg = latB - latA;
  const dLonDeg = wrapLongitudeDeltaDeg(lonB - lonA)
    * Math.cos(((latA + latB) / 2) * DEG_TO_RAD);
  return { dLatDeg, dLonDeg };
}

/**
 * Squared distance in *degrees* — for ranking candidates against each other
 * (and against degree-based thresholds) without paying for a square root.
 *
 * @param {number} latA @param {number} lonA @param {number} latB @param {number} lonB
 * @returns {number} Squared degree distance.
 */
export function approxDistanceDegSq(latA, lonA, latB, lonB) {
  const { dLatDeg, dLonDeg } = approxOffsetsDeg(latA, lonA, latB, lonB);
  return dLatDeg * dLatDeg + dLonDeg * dLonDeg;
}

/**
 * Approximate distance in metres.
 *
 * @param {number} latA @param {number} lonA @param {number} latB @param {number} lonB
 * @returns {number} Distance in metres.
 */
export function approxDistanceM(latA, lonA, latB, lonB) {
  const { dLatDeg, dLonDeg } = approxOffsetsDeg(latA, lonA, latB, lonB);
  return Math.hypot(dLatDeg * M_PER_DEG_LAT, dLonDeg * M_PER_DEG_LAT);
}

/**
 * Approximate distance in kilometres.
 *
 * @param {number} latA @param {number} lonA @param {number} latB @param {number} lonB
 * @returns {number} Distance in kilometres.
 */
export function approxDistanceKm(latA, lonA, latB, lonB) {
  const { dLatDeg, dLonDeg } = approxOffsetsDeg(latA, lonA, latB, lonB);
  return Math.hypot(dLatDeg * KM_PER_DEG_LAT, dLonDeg * KM_PER_DEG_LAT);
}
