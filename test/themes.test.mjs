import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { THEMES, DEFAULT_THEME, getTheme } from '../assets/js/themes.js';

const css = await readFile(new URL('../assets/css/themes.css', import.meta.url), 'utf8');

/** Token block for each `[data-theme="x"] { ... }` rule. */
function themeTokens() {
  const out = new Map();
  for (const m of css.matchAll(/\[data-theme="(\w+)"\]\s*\{([\s\S]*?)\n\}/g)) {
    const toks = Object.fromEntries(
      [...m[2].matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, k, v]) => [k, v.trim()]),
    );
    out.set(m[1], toks);
  }
  return out;
}

function rgb(hex) {
  const h = hex.trim().replace(/^#/, '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

function relativeLuminance([r, g, b]) {
  const f = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a, b) {
  const [x, y] = [relativeLuminance(a), relativeLuminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// Text pairs that must clear WCAG AA for body copy, and UI/large-text pairs
// that must clear the 3:1 floor.
const AA_TEXT = [
  ['--fg', '--bg'], ['--fg-soft', '--bg'], ['--fg', '--menu-bg'],
  ['--fg-mute', '--bg'], ['--fg-mute', '--menu-bg'],
  ['--pin-city', '--map-ocean'], ['--pin-country', '--map-ocean'],
];
const AA_LARGE = [
  ['--accent', '--bg'], ['--accent-fg', '--accent'],
  ['--pin-work', '--map-ocean'], ['--pin-dim', '--map-ocean'],
];

test('every theme declares the tokens the structure depends on', () => {
  const tokens = themeTokens();
  assert.equal(tokens.size, THEMES.length, 'a theme is missing its token block');
  const required = [...new Set([...AA_TEXT, ...AA_LARGE].flat())];
  for (const t of THEMES) {
    const got = tokens.get(t.id);
    assert.ok(got, `no token block for ${t.id}`);
    for (const key of [...required, '--font-ui', '--font-display', '--map-night-alpha']) {
      assert.ok(got[key], `${t.id} is missing ${key}`);
    }
  }
});

test('every colour token is a valid hex or a colour function', () => {
  for (const [id, toks] of themeTokens()) {
    for (const [k, v] of Object.entries(toks)) {
      if (!v.startsWith('#')) continue;
      assert.ok(rgb(v), `${id} ${k} is not a valid colour: ${v}`);
    }
  }
});

test('body text clears WCAG AA in every theme', () => {
  const failures = [];
  for (const [id, toks] of themeTokens()) {
    for (const [fg, bg] of AA_TEXT) {
      const [a, b] = [rgb(toks[fg] || ''), rgb(toks[bg] || '')];
      if (!a || !b) continue;
      const r = contrast(a, b);
      if (r < 4.5) failures.push(`${id}: ${fg} on ${bg} = ${r.toFixed(2)}`);
    }
  }
  assert.deepEqual(failures, [], `contrast below 4.5:\n  ${failures.join('\n  ')}`);
});

test('accents and markers clear the 3:1 floor for UI and large text', () => {
  const failures = [];
  for (const [id, toks] of themeTokens()) {
    for (const [fg, bg] of AA_LARGE) {
      const [a, b] = [rgb(toks[fg] || ''), rgb(toks[bg] || '')];
      if (!a || !b) continue;
      const r = contrast(a, b);
      if (r < 3) failures.push(`${id}: ${fg} on ${bg} = ${r.toFixed(2)}`);
    }
  }
  assert.deepEqual(failures, [], `contrast below 3.0:\n  ${failures.join('\n  ')}`);
});

test('the registry and the stylesheet agree', () => {
  for (const t of THEMES) {
    assert.ok(css.includes(`[data-strip="${t.strip}"]`), `no layout for strip "${t.strip}"`);
    assert.equal(t.swatch.length, 3, `${t.id} swatch`);
    for (const c of t.swatch) assert.ok(rgb(c), `${t.id} swatch colour ${c}`);
    assert.ok(t.fonts.includes('family='), `${t.id} font query`);
    assert.ok(['light', 'dark'].includes(t.scheme), `${t.id} scheme`);
  }
});

test('an unknown theme falls back to the default', () => {
  assert.equal(getTheme('nope').id, DEFAULT_THEME);
  assert.equal(getTheme(undefined).id, DEFAULT_THEME);
  assert.ok(THEMES.some((t) => t.id === DEFAULT_THEME), 'default not in registry');
});
