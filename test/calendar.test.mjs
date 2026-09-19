import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIcs } from '../assets/js/calendar.js';

const entries = [
  { city: { label: 'Brno', country: 'Czechia' }, time: '18:00', meridiem: '', offsetLabel: 'GMT+2' },
  { city: { label: 'San Francisco, CA', country: 'United States' }, time: '9:00', meridiem: 'AM', offsetLabel: 'GMT-7' },
];

const lines = (ics) => ics.split('\r\n');

test('the file is a well-formed VCALENDAR with CRLF endings', () => {
  const ics = buildIcs(new Date('2026-09-17T16:00:00Z'), entries);
  assert.ok(ics.includes('\r\n'), 'no CRLF');
  assert.ok(!/[^\r]\n/.test(ics), 'found a bare LF');
  const l = lines(ics);
  assert.equal(l[0], 'BEGIN:VCALENDAR');
  assert.equal(l.at(-2), 'END:VCALENDAR');
  assert.ok(l.includes('BEGIN:VEVENT') && l.includes('END:VEVENT'));
});

test('the event is half an hour at the selected instant', () => {
  const ics = buildIcs(new Date('2026-09-17T16:00:00Z'), entries);
  assert.ok(ics.includes('DTSTART:20260917T160000Z'), 'wrong start');
  assert.ok(ics.includes('DTEND:20260917T163000Z'), 'wrong end');
});

test('seconds are rounded to the minute', () => {
  const ics = buildIcs(new Date('2026-09-17T16:00:40Z'), entries);
  assert.ok(ics.includes('DTSTART:20260917T160100Z'), 'not rounded');
});

test('no line exceeds 75 octets, and folds continue with a space', () => {
  const longEntries = [
    { city: { label: 'Nuku’alofa', country: 'Tonga' }, time: '05:00', meridiem: '', offsetLabel: 'GMT+13' },
    { city: { label: 'Petropavlovsk Kamchatskiy', country: 'Russia' }, time: '03:00', meridiem: '', offsetLabel: 'GMT+12' },
    { city: { label: 'Ittoqqortoormiit', country: 'Greenland' }, time: '17:00', meridiem: '', offsetLabel: 'GMT-1' },
  ];
  const ics = buildIcs(new Date('2026-09-17T16:00:00Z'), longEntries);
  const enc = new TextEncoder();
  for (const line of lines(ics)) {
    assert.ok(enc.encode(line).length <= 75, `line too long (${enc.encode(line).length}): ${line}`);
  }
  // A folded line is only valid if its continuation starts with whitespace.
  const folded = lines(ics).filter((l) => l.startsWith(' '));
  assert.ok(folded.length > 0, 'expected the description to fold');
});

test('folding never splits a multi-byte character', () => {
  const accented = Array.from({ length: 6 }, (_, i) => ({
    city: { label: `Zürich ${'é'.repeat(8)}${i}`, country: 'Switzerland' },
    time: '12:00', meridiem: '', offsetLabel: 'GMT+2',
  }));
  const ics = buildIcs(new Date('2026-09-17T16:00:00Z'), accented);
  assert.ok(!ics.includes('�'), 'replacement character in output');
  // Re-decoding the bytes must give back exactly what we produced.
  const bytes = new TextEncoder().encode(ics);
  assert.equal(new TextDecoder('utf-8', { fatal: true }).decode(bytes), ics);
});

test('separators in city names are escaped', () => {
  const ics = buildIcs(new Date('2026-09-17T16:00:00Z'), entries);
  const summary = ics.split('\r\n').find((l) => l.startsWith('SUMMARY:'));
  assert.ok(summary.includes('San Francisco\\, CA'), `comma unescaped: ${summary}`);
  assert.ok(!/(^|[^\\]),/.test(summary.slice('SUMMARY:'.length)), 'raw comma left in');
  assert.ok(ics.includes('\\n'), 'description newlines not escaped');
});

test('every local time reaches the description', () => {
  const ics = buildIcs(new Date('2026-09-17T16:00:00Z'), entries);
  assert.ok(ics.replace(/\r\n /g, '').includes('9:00 AM'), 'meridiem lost');
  assert.ok(ics.replace(/\r\n /g, '').includes('GMT-7'), 'offset lost');
});

test('each event gets its own identifier', () => {
  const uid = (ics) => lines(ics).find((l) => l.startsWith('UID:'));
  const a = uid(buildIcs(new Date('2026-09-17T16:00:00Z'), entries));
  const b = uid(buildIcs(new Date('2026-09-17T16:00:00Z'), entries));
  assert.notEqual(a, b, 'UIDs collided');
});
