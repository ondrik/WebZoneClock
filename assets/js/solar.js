/**
 * Low-precision solar position, good to a fraction of a degree — far better
 * than the pixel resolution of a world map.
 * Formulae: NOAA / Astronomical Almanac "approximate solar coordinates".
 */

const RAD = Math.PI / 180;
const J2000 = 2451545.0;
const UNIX_EPOCH_JD = 2440587.5;

/** Latitude/longitude on Earth where the sun is directly overhead. */
export function subsolarPoint(date) {
  const n = date.getTime() / 86400000 + UNIX_EPOCH_JD - J2000; // days since J2000.0

  const meanLon = 280.460 + 0.9856474 * n;
  const meanAnom = (357.528 + 0.9856003 * n) * RAD;
  const eclipticLon =
    (meanLon + 1.915 * Math.sin(meanAnom) + 0.020 * Math.sin(2 * meanAnom)) * RAD;
  const obliquity = (23.439 - 0.0000004 * n) * RAD;

  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLon));
  const rightAscension = Math.atan2(
    Math.cos(obliquity) * Math.sin(eclipticLon),
    Math.cos(eclipticLon),
  );

  // Greenwich mean sidereal time, in hours.
  let gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  if (gmst < 0) gmst += 24;

  const lon = wrapLon(rightAscension / RAD - gmst * 15);
  return { lat: declination / RAD, lon };
}

/** Sun's angle above the horizon, in degrees, at a point on the globe. */
export function solarElevation(lat, lon, sub) {
  const phi = lat * RAD;
  const dec = sub.lat * RAD;
  const hourAngle = (lon - sub.lon) * RAD;
  const sinEl =
    Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(hourAngle);
  return Math.asin(Math.max(-1, Math.min(1, sinEl))) / RAD;
}

function wrapLon(lon) {
  return ((lon + 540) % 360) - 180;
}
