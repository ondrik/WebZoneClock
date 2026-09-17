/**
 * Five looks over one set of features.
 *
 * A theme is more than a palette: it picks how the city strip is built
 * (`strip`) and how the map is drawn (`map`), because a departure board and an
 * engraved orrery are not the same layout with different colours. Webfonts are
 * fetched only for the theme in use, so switching costs one stylesheet rather
 * than loading six families up front.
 */

export const THEMES = [
  {
    id: 'daylight',
    name: 'Daylight',
    blurb: 'Each city as a band of its own sunlight',
    strip: 'bands',
    map: 'soft',
    scheme: 'light',
    swatch: ['#f3f5f8', '#1b2a4a', '#f4b860'],
    fonts:
      'family=Fraunces:opsz,wght@9..144,300..600&family=Archivo:wght@400;500;600',
  },
  {
    id: 'orrery',
    name: 'Orrery',
    blurb: 'Brass dials and an engraved chart',
    strip: 'dials',
    map: 'engraved',
    scheme: 'dark',
    swatch: ['#0d1218', '#c2954a', '#4f9c86'],
    fonts: 'family=Spectral:wght@200;300;400&family=Inter:wght@400;500;600',
  },
  {
    id: 'solari',
    name: 'Solari',
    blurb: 'A split-flap departure board',
    strip: 'board',
    map: 'filled',
    scheme: 'dark',
    swatch: ['#111113', '#e8a72c', '#e9e6de'],
    fonts: 'family=Barlow+Condensed:wght@400;500;600;700',
  },
  {
    id: 'riso',
    name: 'Two-ink',
    blurb: 'Teal and coral, overprinted',
    strip: 'poster',
    map: 'halftone',
    scheme: 'light',
    swatch: ['#e7ebe6', '#0d5c57', '#ff5545'],
    fonts: 'family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,700;12..96,800',
  },
  {
    id: 'classic',
    name: 'Classic',
    blurb: 'The original charcoal and green',
    strip: 'tiles',
    map: 'filled',
    scheme: 'dark',
    swatch: ['#1b1b1d', '#9fc92e', '#ffffff'],
    fonts: 'family=Inter:wght@100..700',
  },
];

export const DEFAULT_THEME = 'daylight';

const byId = new Map(THEMES.map((t) => [t.id, t]));

export function getTheme(id) {
  return byId.get(id) || byId.get(DEFAULT_THEME);
}

/**
 * Apply a theme: set the attributes the CSS keys off, and make sure its
 * webfonts are on the way. Returns the resolved theme.
 */
export function applyTheme(id) {
  const theme = getTheme(id);
  const root = document.documentElement;

  root.dataset.theme = theme.id;
  root.dataset.strip = theme.strip;
  root.dataset.map = theme.map;
  root.style.colorScheme = theme.scheme;

  ensureFonts(theme);
  return theme;
}

const loaded = new Map();

/**
 * Fetch a theme's webfonts once. Resolves when they are actually ready, so the
 * caller can re-measure anything whose layout depends on their metrics.
 */
function ensureFonts(theme) {
  let promise = loaded.get(theme.id);
  if (promise) return promise;

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?${theme.fonts}&display=swap`;

  promise = new Promise((resolve) => {
    link.addEventListener('load', resolve, { once: true });
    link.addEventListener('error', resolve, { once: true });
    setTimeout(resolve, 3000); // never block the UI on a slow font host
  }).then(() => document.fonts?.ready);

  document.head.appendChild(link);
  loaded.set(theme.id, promise);
  return promise;
}

/** Resolves when the theme's faces are usable. */
export function themeFontsReady(theme) {
  return ensureFonts(theme);
}

/**
 * Colours the canvas map needs, pulled from the active theme's CSS variables
 * so the map and the page can never drift apart.
 */
export function mapColors() {
  const s = getComputedStyle(document.documentElement);
  const read = (name, fallback) => (s.getPropertyValue(name) || fallback).trim();
  return {
    backdrop: read('--map-backdrop', '#1b1b1d'),
    ocean: read('--map-ocean', '#1b2532'),
    land: read('--map-land', '#6a6a6c'),
    line: read('--map-line', '#6a6a6c'),
    graticule: read('--map-graticule', 'rgba(255,255,255,0.08)'),
    night: read('--map-night', '0 0 0'),
    nightAlpha: Number(read('--map-night-alpha', '0.33')) || 0.33,
  };
}
