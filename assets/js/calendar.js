/**
 * "Add to calendar": an .ics file for the moment currently selected on the
 * timeline, with every city's local time written into the event so the people
 * you send it to can see the spread at a glance. A downloaded file rather than
 * a calendar integration, since the app has no account to connect to.
 */

const DURATION_MIN = 30;

export function downloadInvite(instant, entries) {
  const ics = buildIcs(instant, entries);
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `webzoneclock-${stampLocalish(instant)}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the download a moment to start before the blob goes away.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function buildIcs(instant, entries) {
  const start = new Date(Math.round(instant.getTime() / 60000) * 60000);
  const end = new Date(start.getTime() + DURATION_MIN * 60000);

  const perCity = entries.map((e) => {
    const time = e.meridiem ? `${e.time} ${e.meridiem}` : e.time;
    return { label: e.city.label, country: e.city.country, time, offset: e.offsetLabel };
  });

  const summary = `Call — ${perCity.map((c) => `${c.time} ${c.label}`).join(' · ')}`;
  const description = [
    'Local times for this slot:',
    ...perCity.map((c) => `${c.time}  ${c.label}, ${c.country} (${c.offset})`),
    '',
    'Planned with WebZoneClock.',
  ].join('\n');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//WebZoneClock//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${cryptoId()}@webzoneclock`,
    `DTSTAMP:${utcStamp(new Date())}`,
    `DTSTART:${utcStamp(start)}`,
    `DTEND:${utcStamp(end)}`,
    `SUMMARY:${escapeText(summary)}`,
    `DESCRIPTION:${escapeText(description)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  // RFC 5545 wants CRLF line endings and lines folded at 75 octets.
  return lines.map(fold).join('\r\n') + '\r\n';
}

function utcStamp(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** A filename-safe stamp in the viewer's own zone, for the download name. */
function stampLocalish(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function escapeText(s) {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * RFC 5545 line folding. The limit is octets, so the cut is measured in UTF-8
 * bytes and never lands inside a character.
 */
function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;

  const out = [];
  let budget = 75; // subsequent lines lose one octet to the leading space
  let current = '';
  let used = 0;

  for (const ch of line) {
    const size = enc.encode(ch).length;
    if (used + size > budget) {
      out.push(current);
      current = '';
      used = 0;
      budget = 74;
    }
    current += ch;
    used += size;
  }
  if (current) out.push(current);

  return out.map((part, i) => (i === 0 ? part : ` ${part}`)).join('\r\n');
}

function cryptoId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
