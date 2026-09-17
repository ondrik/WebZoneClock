/**
 * City markers laid over the map.
 *
 * A pin is anchored at its city's exact coordinates and never moves — only
 * its label does. Labels are placed with a small greedy solver: each tries a
 * handful of offsets and takes the first that clears every label and dot
 * already on the map. Bigger cities are placed first, so when something has
 * to give, it is the small town that moves.
 */

const GAP = 5;
const DOT_GAP = 12; // space between the dot and the start of its label
const DOT_R = 7; // half-size of the keep-clear box around every dot

// Candidate label offsets, best first: beside the dot, then progressively
// further above or below it, on either side.
const CANDIDATES = [];
for (const dy of [0, -30, 30, -58, 58, -86, 86]) {
  CANDIDATES.push({ side: 'right', dy });
  CANDIDATES.push({ side: 'left', dy });
}

export class PinLayer {
  constructor(el) {
    this.el = el;
    this.nodes = new Map(); // city id -> node bundle
    // Height at the bottom of the map that something else is covering (the
    // time bar), and which labels must therefore stay clear of.
    this.bottomInset = 0;
  }

  /** Returns true if the inset actually changed, so callers can skip a relayout. */
  setBottomInset(px) {
    const next = Math.max(0, Math.round(px));
    if (next === this.bottomInset) return false;
    this.bottomInset = next;
    return true;
  }

  /**
   * `entries` is [{ city, state, time, isHome }]; `map` supplies pixel
   * positions. The DOM is the output.
   */
  render(entries, map) {
    const seen = new Set();

    for (const entry of entries) {
      seen.add(entry.city.id);
      let node = this.nodes.get(entry.city.id);
      if (!node) {
        node = buildPin();
        this.nodes.set(entry.city.id, node);
        this.el.appendChild(node.root);
      }
      fillPin(node, entry);
    }

    for (const [id, node] of this.nodes) {
      if (!seen.has(id)) {
        node.root.remove();
        this.nodes.delete(id);
      }
    }

    this.layout(entries, map);
  }

  layout(entries, map) {
    // Labels are kept inside the map band, not the letterbox around it, and
    // out from under whatever is overlaying its bottom edge.
    const rect = map.proj.rect;
    const bounds = {
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: Math.max(40, rect.h - this.bottomInset),
    };
    if (!bounds.w || !bounds.h) return;

    // Anchor every pin first, so the solver can route labels around all the
    // dots and not just the ones placed before it.
    const anchors = new Map();
    const placed = [];

    for (const entry of entries) {
      const node = this.nodes.get(entry.city.id);
      if (!node) continue;
      const { x, y, offMap } = map.locate(entry.city);
      anchors.set(entry.city.id, { x, y });
      node.root.style.left = `${x}px`;
      node.root.style.top = `${y}px`;
      // Pinned to the edge rather than its true position.
      node.root.classList.toggle('off-map', offMap);
      placed.push({ left: x - DOT_R, top: y - DOT_R, right: x + DOT_R, bottom: y + DOT_R });
    }

    // Prominent cities claim the preferred side.
    const ordered = [...entries].sort((a, b) => b.city.pop - a.city.pop);

    for (const entry of ordered) {
      const node = this.nodes.get(entry.city.id);
      const anchor = anchors.get(entry.city.id);
      if (!node || !anchor) continue;

      const bw = node.label.offsetWidth || 86;
      const bh = node.label.offsetHeight || 34;

      let chosen = null;
      for (const cand of CANDIDATES) {
        const box = labelBox(cand, anchor, bw, bh, bounds);
        if (!box) continue;
        if (placed.some((p) => overlaps(p, box))) continue;
        chosen = { cand, box };
        break;
      }
      // Nothing clears: take the preferred spot and accept the overlap.
      if (!chosen) {
        const cand = CANDIDATES[0];
        chosen = { cand, box: labelBox(cand, anchor, bw, bh, bounds, true) };
      }

      placed.push(chosen.box);
      node.root.classList.toggle('flip', chosen.cand.side === 'left');
      // Positioned relative to the anchor, which stays on the city.
      node.label.style.top = `${chosen.box.top - anchor.y}px`;
    }
  }

  /** Spotlight one pin and fade the rest; pass null to clear. */
  highlight(id) {
    for (const [pinId, node] of this.nodes) {
      node.root.classList.toggle('is-hot', id !== null && pinId === id);
      node.root.classList.toggle('is-cold', id !== null && pinId !== id);
    }
  }
}

function labelBox(cand, anchor, bw, bh, bounds, force = false) {
  const left = cand.side === 'right' ? anchor.x + DOT_GAP : anchor.x - DOT_GAP - bw;
  const top = anchor.y + cand.dy - bh / 2;

  const minLeft = bounds.x + 2;
  const maxLeft = bounds.x + bounds.w - bw - 2;
  const minTop = bounds.y + 2;
  const maxTop = bounds.y + bounds.h - bh - 2;

  if (!force && (left < minLeft || left > maxLeft)) return null;

  const clampedTop = Math.max(minTop, Math.min(maxTop, top));
  // Being pulled back into bounds means this offset does not really fit.
  if (!force && Math.abs(clampedTop - top) > 1) return null;

  const finalLeft = force ? Math.max(minLeft, Math.min(maxLeft, left)) : left;
  return {
    left: finalLeft,
    top: clampedTop,
    right: finalLeft + bw,
    bottom: clampedTop + bh,
  };
}

function overlaps(a, b) {
  return (
    a.left - GAP < b.right &&
    b.left - GAP < a.right &&
    a.top - GAP < b.bottom &&
    b.top - GAP < a.bottom
  );
}

function buildPin() {
  const root = document.createElement('div');
  root.className = 'pin';

  const marker = document.createElement('span');
  root.appendChild(marker);

  const label = document.createElement('div');
  label.className = 'pin-label';

  const time = document.createElement('div');
  time.className = 'pin-time';
  const city = document.createElement('div');
  city.className = 'pin-city';
  const country = document.createElement('div');
  country.className = 'pin-country';

  label.append(time, city, country);
  root.appendChild(label);

  return { root, marker, label, time, city, country };
}

function fillPin(node, entry) {
  node.root.dataset.state = entry.state;

  if (entry.isHome) {
    if (node.marker.className !== 'pin-arrow') {
      node.marker.className = 'pin-arrow';
      node.marker.innerHTML = HOME_ARROW;
    }
  } else if (node.marker.className !== 'pin-dot') {
    node.marker.className = 'pin-dot';
    node.marker.innerHTML = '';
  }

  node.time.textContent = entry.time;
  node.city.textContent = entry.city.label;
  node.country.textContent = entry.city.country;
}

const HOME_ARROW =
  '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M11 1L1 5.6l3.7 1.1L6 11z"/></svg>';
