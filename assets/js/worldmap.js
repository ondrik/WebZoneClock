/**
 * The world map: land drawn from pre-decoded rings onto a canvas, with a
 * day/night terminator composited over the top.
 *
 * The terminator is computed on a coarse grid and scaled up with smoothing.
 * Solar elevation varies smoothly across the globe, so the interpolation is
 * indistinguishable from a per-pixel solve and costs a fraction as much.
 */

import { makeProjection } from './geo.js';
import { subsolarPoint, solarElevation } from './solar.js';

const BACKDROP = '#1b1b1d'; // shown in the letterbox bands, matches the page
const OCEAN = '#1b2532';
const LAND = '#6a6a6c';

// Night shading: fully lit above DAY_ELEV, fully dark below NIGHT_ELEV, with a
// soft twilight ramp between them.
const DAY_ELEV = 4;
const NIGHT_ELEV = -8;
const NIGHT_ALPHA = 0.33;

const GRID_W = 480;
const GRID_H = 240;

export class WorldMap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.land = null;
    this.width = 0;
    this.height = 0;
    this.proj = makeProjection(1, 1);

    this.shade = document.createElement('canvas');
    this.shade.width = GRID_W;
    this.shade.height = GRID_H;
    this.shadeCtx = this.shade.getContext('2d');
    this.shadeData = this.shadeCtx.createImageData(GRID_W, GRID_H);
  }

  async load() {
    const res = await fetch('data/land.json');
    if (!res.ok) throw new Error(`land.json: HTTP ${res.status}`);
    this.land = (await res.json()).polygons.map(unwrapPolygon);
  }

  /** Match the backing store to the element's CSS size and pixel density. */
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));

    this.width = w;
    this.height = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.proj = makeProjection(w, h);
  }

  draw(now, showDaylight) {
    const { ctx, width: w, height: h } = this;
    if (!w || !h) return;

    const { rect } = this.proj;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = BACKDROP;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = OCEAN;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

    // Everything else stays inside the map band.
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip();

    if (this.land) this.drawLand();
    if (showDaylight) this.drawNight(now);

    ctx.restore();
  }

  drawLand() {
    const { ctx, proj } = this;
    ctx.fillStyle = LAND;

    for (const polygon of this.land) {
      // Rings are stored with continuous (unwrapped) longitudes, so a shape
      // straddling the antimeridian runs past +/-180 instead of snapping back
      // across the map. Drawing it shifted by a full turn either way brings
      // the wrapped half in at the opposite edge; the canvas clips the rest.
      for (const shift of polygon.shifts) {
        ctx.beginPath();
        for (const ring of polygon.rings) {
          for (let i = 0; i < ring.length; i += 2) {
            const x = proj.x(ring[i] + shift);
            const y = proj.y(ring[i + 1]);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();
        }
        // Rings after the first are holes (lakes); even-odd cuts them out.
        ctx.fill('evenodd');
      }
    }
  }

  drawNight(now) {
    const sub = subsolarPoint(now);
    const data = this.shadeData.data;
    const { latTop, latBottom } = this.proj;

    for (let gy = 0; gy < GRID_H; gy++) {
      // Sample at cell centres so the edges of the grid stay put when scaled.
      const lat = latTop - ((gy + 0.5) / GRID_H) * (latTop - latBottom);
      for (let gx = 0; gx < GRID_W; gx++) {
        const lon = ((gx + 0.5) / GRID_W) * 360 - 180;
        const elev = solarElevation(lat, lon, sub);

        let t = (DAY_ELEV - elev) / (DAY_ELEV - NIGHT_ELEV);
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const eased = t * t * (3 - 2 * t); // smoothstep

        const i = (gy * GRID_W + gx) * 4;
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
        data[i + 3] = Math.round(eased * NIGHT_ALPHA * 255);
      }
    }

    this.shadeCtx.putImageData(this.shadeData, 0, 0);

    const { ctx } = this;
    const { rect } = this.proj;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.shade, rect.x, rect.y, rect.w, rect.h);
    ctx.restore();
  }

  /** Pixel position of a city inside the map box, clamped to stay visible. */
  locate(city) {
    const { rect } = this.proj;
    return {
      x: clamp(this.proj.x(city.lon), rect.x, rect.x + rect.w),
      y: clamp(this.proj.y(city.lat), rect.y, rect.y + rect.h),
      offMap: !this.proj.covers(city.lat),
    };
  }

  /** Inverse lookup, for turning a click on the map into coordinates. */
  unlocate(x, y) {
    return { lat: this.proj.latAt(y), lon: this.proj.lonAt(x) };
  }
}

/**
 * Rewrite a polygon's longitudes so each ring is continuous, and work out
 * which whole-turn shifts can actually put part of it on screen.
 */
function unwrapPolygon(rings) {
  let min = Infinity;
  let max = -Infinity;

  const unwrapped = rings.map((ring) => {
    const out = new Float64Array(ring.length);
    let prev = ring[0];
    let lon = ring[0];
    out[0] = lon;
    out[1] = ring[1];
    min = Math.min(min, lon);
    max = Math.max(max, lon);

    for (let i = 2; i < ring.length; i += 2) {
      const raw = ring[i];
      let step = raw - prev;
      // A step longer than half the globe is the seam, not real movement.
      if (step > 180) step -= 360;
      else if (step < -180) step += 360;
      lon += step;
      prev = raw;
      out[i] = lon;
      out[i + 1] = ring[i + 1];
      if (lon < min) min = lon;
      if (lon > max) max = lon;
    }
    return out;
  });

  const shifts = [];
  for (const shift of [-360, 0, 360]) {
    if (max + shift >= -180 && min + shift <= 180) shifts.push(shift);
  }

  return { rings: unwrapped, shifts };
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
