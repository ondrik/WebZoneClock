import test from 'node:test';
import assert from 'node:assert/strict';
import {
  zonedParts, offsetMinutes, offsetLabel, formatTime, dayDelta, dayState,
  isWeekend, normalizeHours, DEFAULT_HOURS,
} from '../assets/js/tz.js';

/**
 * The bands are half-open: 17:59 is still working hours and 18:00 is not;
 * 08:59 is awake and 09:00 is not. Evening belongs with the night. Guarding
 * the edges here because they are a behavioural contract that nothing else in
 * the code states, and an off-by-one would be easy to miss by eye.
 */
test('day-state boundaries match the observed contract', () => {
  const expected = {
    0: 'asleep', 5: 'asleep', 6: 'awake', 8: 'awake',
    9: 'work', 12: 'work', 17: 'work',
    18: 'asleep', 21: 'asleep', 23: 'asleep',
  };
  for (const [hour, want] of Object.entries(expected)) {
    assert.equal(dayState(Number(hour)), want, `hour ${hour}`);
  }
});

test('custom working hours move the boundaries with them', () => {
  const nightShift = { dayStart: 13, workStart: 16, workEnd: 24 };
  assert.equal(dayState(12, nightShift), 'asleep');
  assert.equal(dayState(13, nightShift), 'awake');
  assert.equal(dayState(15, nightShift), 'awake');
  assert.equal(dayState(16, nightShift), 'work');
  assert.equal(dayState(23, nightShift), 'work');
  assert.equal(dayState(0, nightShift), 'asleep');
});

test('nobody is at work on a weekend', () => {
  assert.equal(dayState(12, DEFAULT_HOURS, false), 'work');
  assert.equal(dayState(12, DEFAULT_HOURS, true), 'awake');
  // Outside the waking window a weekend changes nothing.
  assert.equal(dayState(3, DEFAULT_HOURS, true), 'asleep');
  assert.equal(dayState(20, DEFAULT_HOURS, true), 'asleep');
});

test('weekends are detected in the city\'s own week', () => {
  // 2026-09-19 is a Saturday.
  const sat = new Date('2026-09-19T12:00:00Z');
  assert.equal(isWeekend(zonedParts(sat, 'Europe/Prague')), true);
  // Same instant, but already Sunday in Auckland.
  assert.equal(isWeekend(zonedParts(sat, 'Pacific/Auckland')), true);
  // 2026-09-17 is a Thursday everywhere that matters here.
  const thu = new Date('2026-09-17T12:00:00Z');
  assert.equal(isWeekend(zonedParts(thu, 'Europe/Prague')), false);
  // Friday afternoon in Prague is already Saturday in Tokyo. This is the whole
  // point of deciding per city rather than once for the viewer.
  const fri = new Date('2026-09-18T16:00:00Z');
  assert.equal(isWeekend(zonedParts(fri, 'Europe/Prague')), false);
  assert.equal(isWeekend(zonedParts(fri, 'Asia/Tokyo')), true);
});

test('hour settings are kept ordered and in range', () => {
  assert.deepEqual(normalizeHours({ dayStart: 6, workStart: 9, workEnd: 18 }),
    { dayStart: 6, workStart: 9, workEnd: 18 });
  // Work cannot start before you are up, nor end before it starts; each bound
  // is repaired to the nearest value that keeps the order.
  assert.deepEqual(normalizeHours({ dayStart: 10, workStart: 8, workEnd: 9 }),
    { dayStart: 10, workStart: 10, workEnd: 11 });
  assert.deepEqual(normalizeHours({ dayStart: 0, workStart: 23, workEnd: 2 }),
    { dayStart: 0, workStart: 23, workEnd: 24 });
  // Rubbish falls back to the defaults.
  assert.deepEqual(normalizeHours(undefined), DEFAULT_HOURS);
  assert.deepEqual(normalizeHours({ dayStart: 'x', workStart: null, workEnd: NaN }), DEFAULT_HOURS);
});

test('offsets follow daylight saving', () => {
  assert.equal(offsetMinutes(new Date('2026-01-15T12:00:00Z'), 'Europe/Prague'), 60);
  assert.equal(offsetMinutes(new Date('2026-07-15T12:00:00Z'), 'Europe/Prague'), 120);
  assert.equal(offsetMinutes(new Date('2026-01-15T12:00:00Z'), 'America/New_York'), -300);
  assert.equal(offsetMinutes(new Date('2026-07-15T12:00:00Z'), 'America/New_York'), -240);
});

test('sub-hour zones survive the offset maths', () => {
  const t = new Date('2026-09-17T13:08:00Z');
  assert.equal(offsetMinutes(t, 'Asia/Kolkata'), 330);
  assert.equal(offsetMinutes(t, 'Asia/Kathmandu'), 345);
  assert.equal(offsetMinutes(t, 'Australia/Eucla'), 525);
  assert.equal(offsetMinutes(t, 'Pacific/Marquesas'), -570);
  assert.equal(offsetMinutes(t, 'Pacific/Kiritimati'), 840);
});

test('offset labels read the way the app shows them', () => {
  const t = new Date('2026-09-17T13:08:00Z');
  assert.equal(offsetLabel(t, 'UTC'), 'GMT');
  assert.equal(offsetLabel(t, 'Europe/Prague'), 'GMT+2');
  assert.equal(offsetLabel(t, 'America/Los_Angeles'), 'GMT-7');
  assert.equal(offsetLabel(t, 'Asia/Kolkata'), 'GMT+5:30');
  assert.equal(offsetLabel(t, 'Pacific/Marquesas'), 'GMT-9:30');
});

test('the screenshot moment reproduces exactly', () => {
  const t = new Date('2026-09-17T13:08:00Z');
  const at = (tz) => formatTime(zonedParts(t, tz), false).time;
  assert.equal(at('Australia/Sydney'), '23:08');
  assert.equal(at('Asia/Tokyo'), '22:08');
  assert.equal(at('Asia/Taipei'), '21:08');
  assert.equal(at('Europe/Prague'), '15:08');
  assert.equal(at('Europe/London'), '14:08');
  assert.equal(at('America/Los_Angeles'), '06:08');
});

test('12-hour formatting handles midnight and noon', () => {
  const mk = (hour) => ({ hour, minute: 5 });
  assert.deepEqual(formatTime(mk(0), true), { time: '12:05', meridiem: 'AM' });
  assert.deepEqual(formatTime(mk(12), true), { time: '12:05', meridiem: 'PM' });
  assert.deepEqual(formatTime(mk(13), true), { time: '1:05', meridiem: 'PM' });
  assert.deepEqual(formatTime(mk(0), false), { time: '00:05', meridiem: '' });
});

test('day difference is reported across the date line', () => {
  // Mid-afternoon in Prague: the far east is already on tomorrow.
  const afternoon = new Date('2026-09-17T13:08:00Z');
  const pragueAfternoon = zonedParts(afternoon, 'Europe/Prague');
  assert.equal(dayDelta(zonedParts(afternoon, 'Pacific/Chatham'), pragueAfternoon), 1);
  assert.equal(dayDelta(zonedParts(afternoon, 'America/Los_Angeles'), pragueAfternoon), 0);

  // Early morning in Prague: now the far west is still on yesterday. No zone
  // can be a day behind at 13:08 UTC, so this needs its own instant.
  const earlyMorning = new Date('2026-09-17T01:00:00Z');
  const pragueMorning = zonedParts(earlyMorning, 'Europe/Prague');
  assert.equal(dayDelta(zonedParts(earlyMorning, 'Pacific/Midway'), pragueMorning), -1);
  assert.equal(dayDelta(zonedParts(earlyMorning, 'America/Los_Angeles'), pragueMorning), -1);
});

test('zoned parts round-trip back to the instant', () => {
  const t = new Date('2026-07-04T18:42:31Z');
  for (const tz of ['UTC', 'Asia/Tokyo', 'America/St_Johns', 'Pacific/Chatham']) {
    const p = zonedParts(t, tz);
    const rebuilt = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
      - offsetMinutes(t, tz) * 60000;
    assert.equal(rebuilt, t.getTime() - t.getMilliseconds(), tz);
  }
});
