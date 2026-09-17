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
import { mapColors } from './themes.js';

// Night shading: fully lit above DAY_ELEV, fully dark below NIGHT_ELEV, with a
// soft twilight ramp between them.
const DAY_ELEV = 4;
const NIGHT_ELEV = -8;

const HALFTONE_PITCH = 7; // px between dot centres
const GRATICULE_STEP = 20; // degrees between engraved graticule lines

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

  /** `mode` is the active theme's map style: filled, soft, engraved, halftone. */
  draw(now, showDaylight, mode = 'filled') {
    const { ctx, width: w, height: h } = this;
    if (!w || !h) return;

    const { rect } = this.proj;
    const colors = mapColors();

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = colors.backdrop;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = colors.ocean;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

    // Everything else stays inside the map band.
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip();

    if (mode === 'engraved') this.drawGraticule(colors);

    if (this.land) {
      if (mode === 'engraved') this.strokeLand(colors);
      else if (mode === 'halftone') this.stippleLand(colors);
      else this.fillLand(colors);
    }

    if (showDaylight) this.drawNight(now, colors);

    ctx.restore();
  }

  /** Walk every land ring once, handing each to `plot`. */
  eachRing(plot) {
    const { proj } = this;
    for (const polygon of this.land) {
      // Rings are stored with continuous (unwrapped) longitudes, so a shape
      // straddling the antimeridian runs past +/-180 instead of snapping back
      // across the map. Drawing it shifted by a full turn either way brings
      // the wrapped half in at the opposite edge; the canvas clips the rest.
      for (const shift of polygon.shifts) {
        plot(polygon.rings, shift, proj);
      }
    }
  }

  tracePolygon(rings, shift, proj) {
    const { ctx } = this;
    ctx.beginPath();
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i += 2) {
        const x = proj.x(ring[i] + shift);
        const y = proj.y(ring[i + 1]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    }
  }

  fillLand(colors) {
    const { ctx } = this;
    ctx.fillStyle = colors.land;
    this.eachRing((rings, shift, proj) => {
      this.tracePolygon(rings, shift, proj);
      // Rings after the first are holes (lakes); even-odd cuts them out.
      ctx.fill('evenodd');
    });
  }

  /** Coastlines as hairlines over open ground, the way a chart is engraved. */
  strokeLand(colors) {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = colors.line;
    ctx.lineWidth = 0.9;
    ctx.lineJoin = 'round';
    this.eachRing((rings, shift, proj) => {
      this.tracePolygon(rings, shift, proj);
      ctx.stroke();
    });
    ctx.restore();
  }

  /** Land as a field of printed dots. */
  stippleLand(colors) {
    const { ctx } = this;
    const { rect } = this.proj;

    // Draw the landmass to an offscreen mask, then read it back to decide
    // where a dot belongs — far simpler than testing point-in-polygon.
    const mask = document.createElement('canvas');
    mask.width = Math.max(1, Math.round(rect.w));
    mask.height = Math.max(1, Math.round(rect.h));
    const mctx = mask.getContext('2d', { willReadFrequently: true });

    mctx.translate(-rect.x, -rect.y);
    mctx.fillStyle = '#000';
    const saved = this.ctx;
    this.ctx = mctx;
    this.eachRing((rings, shift, proj) => {
      this.tracePolygon(rings, shift, proj);
      mctx.fill('evenodd');
    });
    this.ctx = saved;

    const data = mctx.getImageData(0, 0, mask.width, mask.height).data;
    ctx.fillStyle = colors.land;

    for (let y = HALFTONE_PITCH / 2; y < mask.height; y += HALFTONE_PITCH) {
      for (let x = HALFTONE_PITCH / 2; x < mask.width; x += HALFTONE_PITCH) {
        const i = ((y | 0) * mask.width + (x | 0)) * 4 + 3;
        if (data[i] < 128) continue;
        ctx.beginPath();
        ctx.arc(rect.x + x, rect.y + y, HALFTONE_PITCH * 0.32, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /** Meridians and parallels, for the chart-like themes. */
  drawGraticule(colors) {
    const { ctx, proj } = this;
    const { rect } = proj;

    ctx.save();
    ctx.strokeStyle = colors.graticule;
    ctx.lineWidth = 0.7;

    for (let lon = -180; lon <= 180; lon += GRATICULE_STEP) {
      const x = proj.x(lon);
      ctx.beginPath();
      ctx.moveTo(x, rect.y);
      ctx.lineTo(x, rect.y + rect.h);
      ctx.stroke();
    }
    for (let lat = -80; lat <= 80; lat += GRATICULE_STEP) {
      const y = proj.y(lat);
      if (y < rect.y || y > rect.y + rect.h) continue;
      ctx.beginPath();
      ctx.moveTo(rect.x, y);
      ctx.lineTo(rect.x + rect.w, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawNight(now, colors) {
    const sub = subsolarPoint(now);
    const data = this.shadeData.data;
    const { latTop, latBottom } = this.proj;
    // Night is tinted rather than simply black, so a pale theme dims towards
    // its own indigo instead of going muddy.
    const [nr, ng, nb] = parseRgbTriplet(colors.night);

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
        data[i] = nr;
        data[i + 1] = ng;
        data[i + 2] = nb;
        data[i + 3] = Math.round(eased * colors.nightAlpha * 255);
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

/** "27 42 74" -> [27, 42, 74]; falls back to black. */
function parseRgbTriplet(value) {
  const nums = String(value).match(/\d+/g);
  if (!nums || nums.length < 3) return [0, 0, 0];
  return [Number(nums[0]), Number(nums[1]), Number(nums[2])];
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
