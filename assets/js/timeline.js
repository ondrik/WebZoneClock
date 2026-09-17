/**
 * The time-travel ruler along the bottom of the map.
 *
 * Dragging the handle shifts every clock, tile colour and the map's day/night
 * shading by the same offset, which is what turns a row of clocks into a
 * meeting planner. The offset is held relative to now, so the display keeps
 * ticking while you are away from "now" — the pill reads "+1:41", not a fixed
 * instant.
 *
 * Hours are laid out in the home city's local time, since that is the frame
 * of reference someone picking a meeting slot is actually working in.
 */

import { zonedParts, formatTime } from './tz.js';

const HOUR = 3600000;
const SPAN = 48 * HOUR; // a day either side of now
const HALF = SPAN / 2;

export class Timeline {
  constructor(els, onScrub) {
    this.els = els;
    this.onScrub = onScrub;
    this.offsetMs = 0;
    this.dragging = false;
    this.bind();
  }

  bind() {
    const { ruler, handle, clear } = this.els;

    // Clicking the ruler jumps; dragging scrubs. Pointer capture keeps the
    // drag alive when the cursor leaves the ruler, including past the edges.
    ruler.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.handle-clear')) return;
      this.dragging = true;
      ruler.setPointerCapture(e.pointerId);
      this.scrubToClientX(e.clientX);
      e.preventDefault();
    });

    ruler.addEventListener('pointermove', (e) => {
      if (this.dragging) this.scrubToClientX(e.clientX);
    });

    const end = (e) => {
      if (!this.dragging) return;
      this.dragging = false;
      if (ruler.hasPointerCapture?.(e.pointerId)) ruler.releasePointerCapture(e.pointerId);
    };
    ruler.addEventListener('pointerup', end);
    ruler.addEventListener('pointercancel', end);

    clear.addEventListener('click', (e) => {
      e.stopPropagation();
      this.set(0);
    });

    // Keyboard: a quarter hour a press, an hour with Shift, home resets.
    ruler.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? HOUR : 15 * 60000;
      if (e.key === 'ArrowRight') this.set(this.offsetMs + step);
      else if (e.key === 'ArrowLeft') this.set(this.offsetMs - step);
      else if (e.key === 'Home' || e.key === 'Escape') this.set(0);
      else return;
      e.preventDefault();
    });

    handle.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.set(0);
      }
    });
  }

  scrubToClientX(clientX) {
    const rect = this.els.ruler.getBoundingClientRect();
    if (!rect.width) return;
    const frac = clamp((clientX - rect.left) / rect.width, 0, 1);
    this.set(Math.round((frac * SPAN - HALF) / 60000) * 60000);
  }

  set(ms) {
    const next = clamp(ms, -HALF, HALF);
    if (next === this.offsetMs) return;
    this.offsetMs = next;
    this.onScrub(next);
  }

  /**
   * Redraw ticks, day bands and the handle. `realNow` is the true current
   * time; the handle sits at `realNow + offsetMs`.
   */
  render(realNow, refTz, hour12) {
    const { ruler, ticks, handle, label, line, bar } = this.els;
    const width = ruler.clientWidth;
    if (!width) return;

    const nowMs = realNow.getTime();
    const start = nowMs - HALF;
    const selectedMs = nowMs + this.offsetMs;

    const refToday = zonedParts(realNow, refTz);
    ticks.textContent = '';

    // Walk hour by hour from the first whole hour in the window.
    const firstTick = Math.ceil(start / HOUR) * HOUR;
    const pxPerHour = (width / SPAN) * HOUR;
    const labelEvery = pxPerHour < 26 ? 3 : pxPerHour < 46 ? 2 : 1;

    let prevDay = null;
    for (let t = firstTick; t <= start + SPAN; t += HOUR) {
      const parts = zonedParts(new Date(t), refTz);
      const x = ((t - start) / SPAN) * 100;

      const isDayStart = prevDay !== null && parts.day !== prevDay;
      prevDay = parts.day;

      if (isDayStart) {
        const edge = document.createElement('div');
        edge.className = 'tick-dayedge';
        edge.style.left = `${x}%`;
        ticks.appendChild(edge);

        const name = document.createElement('div');
        name.className = 'tick-dayname';
        name.style.left = `${x}%`;
        name.textContent = dayName(parts, refToday, refTz, t);
        ticks.appendChild(name);
      }

      const tick = document.createElement('div');
      tick.className = 'tick';
      tick.style.left = `${x}%`;
      // Midnight and noon get a stronger mark; they are the landmarks.
      if (parts.hour === 0) tick.classList.add('major');
      else if (parts.hour === 12) tick.classList.add('mid');
      ticks.appendChild(tick);

      if (parts.hour % labelEvery === 0) {
        const text = document.createElement('div');
        text.className = 'tick-label';
        text.style.left = `${x}%`;
        text.textContent = tickLabel(parts, hour12);
        ticks.appendChild(text);
      }
    }

    // The bar from "now" to the selection, coloured by direction.
    const nowPct = 50;
    const selPct = ((selectedMs - start) / SPAN) * 100;
    const lo = Math.min(nowPct, selPct);
    line.style.left = `${lo}%`;
    line.style.width = `${Math.abs(selPct - nowPct)}%`;
    line.dataset.dir = this.offsetMs === 0 ? 'none' : this.offsetMs > 0 ? 'future' : 'past';

    handle.style.left = `${selPct}%`;
    handle.dataset.dir = line.dataset.dir;
    label.textContent = this.offsetMs === 0 ? 'Now' : deltaLabel(this.offsetMs);

    ruler.setAttribute('aria-valuenow', String(Math.round(this.offsetMs / 60000)));
    ruler.setAttribute(
      'aria-valuetext',
      this.offsetMs === 0 ? 'Now' : `${deltaLabel(this.offsetMs)} from now`,
    );
    bar.dataset.travelling = String(this.offsetMs !== 0);
  }
}

/** "+1:41" / "-6:44" — the offset from now, as the original shows it. */
function deltaLabel(ms) {
  const sign = ms < 0 ? '-' : '+';
  const mins = Math.round(Math.abs(ms) / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${sign}${h}:${String(m).padStart(2, '0')}`;
}

function tickLabel(parts, hour12) {
  if (!hour12) return `${String(parts.hour).padStart(2, '0')}`;
  if (parts.hour === 0) return '12 AM';
  if (parts.hour === 12) return '12 PM';
  return String(parts.hour % 12);
}

function dayName(parts, refToday, refTz, t) {
  const diff = Math.round(
    (Date.UTC(parts.year, parts.month - 1, parts.day) -
      Date.UTC(refToday.year, refToday.month - 1, refToday.day)) /
      86400000,
  );
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: refTz,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).format(new Date(t));
  } catch {
    return `${parts.day}`;
  }
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
