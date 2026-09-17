/**
 * Equirectangular projection, sized to the box it has to live in.
 *
 * Longitude always spans the full 360°. The latitude window is then derived
 * from the box's aspect ratio so that degrees of latitude and longitude get
 * the same number of pixels — the map is never stretched. On a box too tall
 * to hold the whole globe at that scale, the map is letterboxed into a band
 * rather than distorted to fill the space.
 */

// The window is centred a little north of the equator: that is where the land
// and the people are, and it keeps Svalbard and Tierra del Fuego both in view
// at a typical desktop aspect ratio.
const CENTER_LAT = 12;

// Latitude window limits. Below the minimum the map would be a letterbox slit;
// above 180° there is no more globe to show.
const MIN_LAT_SPAN = 110;
const MAX_LAT_SPAN = 180;

// The widest the map itself is allowed to get, so a narrow phone viewport
// letterboxes instead of squashing the continents.
const MIN_MAP_ASPECT = 2;

export function makeProjection(boxWidth, boxHeight) {
  const w = Math.max(1, boxWidth);
  const h = Math.max(1, boxHeight);

  const mapW = w;
  const mapH = Math.min(h, w / MIN_MAP_ASPECT);
  const offsetX = 0;
  const offsetY = (h - mapH) / 2;

  const latSpan = clamp((360 * mapH) / mapW, MIN_LAT_SPAN, MAX_LAT_SPAN);

  let latTop = CENTER_LAT + latSpan / 2;
  let latBottom = CENTER_LAT - latSpan / 2;
  if (latTop > 90) {
    latBottom -= latTop - 90;
    latTop = 90;
  }
  if (latBottom < -90) {
    latTop += -90 - latBottom;
    latBottom = -90;
  }

  return {
    latTop,
    latBottom,
    rect: { x: offsetX, y: offsetY, w: mapW, h: mapH },

    x(lon) {
      return offsetX + ((lon + 180) / 360) * mapW;
    },
    y(lat) {
      return offsetY + ((latTop - lat) / (latTop - latBottom)) * mapH;
    },
    lonAt(px) {
      return ((px - offsetX) / mapW) * 360 - 180;
    },
    latAt(py) {
      return latTop - ((py - offsetY) / mapH) * (latTop - latBottom);
    },
    covers(lat) {
      return lat <= latTop && lat >= latBottom;
    },
  };
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
