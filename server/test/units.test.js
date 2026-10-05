// Pure units: ICS expansion across the DST switch, feed parsing, Berlin time helpers, crypto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.API_TOKEN ||= 'test-master-token';
process.env.DB_PATH ||= join(mkdtempSync(join(tmpdir(), 'agentic-u-')), 'u.db');

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Fuxam//Test//EN
BEGIN:VTIMEZONE
TZID:Europe/Berlin
BEGIN:DAYLIGHT
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
TZNAME:CEST
DTSTART:19700329T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
TZNAME:CET
DTSTART:19701025T030000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:lesson-1@fuxam
DTSTART;TZID=Europe/Berlin:20261019T091500
DTEND;TZID=Europe/Berlin:20261019T104500
RRULE:FREQ=WEEKLY;COUNT=4
EXDATE;TZID=Europe/Berlin:20261102T091500
SUMMARY:Software Engineering
LOCATION:Room 2.14
END:VEVENT
END:VCALENDAR`;

test('ICS: weekly lesson keeps 09:15 Berlin across the DST switch, honours EXDATE', async () => {
  const { expand } = await import('../src/connectors/ics.js');
  const evs = expand(ICS, new Date('2026-10-01T00:00:00Z'), new Date('2026-11-30T00:00:00Z'));
  assert.equal(evs.length, 3);                                   // 4 occurrences minus one EXDATE
  const berlin = iso => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' });
  assert.deepEqual(evs.map(e => berlin(e.start)), ['09:15', '09:15', '09:15']);
  assert.equal(evs[0].start, '2026-10-19T07:15:00.000Z');      // CEST (UTC+2)
  assert.equal(evs[1].start, '2026-10-26T08:15:00.000Z');      // CET (UTC+1), after 25 Oct
  assert.equal(evs[0].location, 'Room 2.14');
});

test('feeds: RSS and Atom are parsed', async () => {
  const { parseFeed } = await import('../src/lib/feeds.js');
  const rss = parseFeed(`<?xml version="1.0"?><rss><channel><item><title>Germany changes oil policy</title><link>https://ex.com/a</link><description>&lt;p&gt;Text&lt;/p&gt;</description><pubDate>Mon, 05 Oct 2026 06:00:00 GMT</pubDate></item></channel></rss>`);
  assert.equal(rss[0].title, 'Germany changes oil policy');
  assert.equal(rss[0].summary, 'Text');
  const atom = parseFeed(`<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>New model</title><link rel="alternate" href="https://ex.com/b"/><updated>2026-10-05T06:00:00Z</updated></entry></feed>`);
  assert.equal(atom[0].url, 'https://ex.com/b');
});

test('time: Berlin instants around DST', async () => {
  const { zonedInstant, localDate } = await import('../src/lib/time.js');
  assert.equal(zonedInstant('2026-10-24', '08:00').toISOString(), '2026-10-24T06:00:00.000Z');
  assert.equal(zonedInstant('2026-10-26', '08:00').toISOString(), '2026-10-26T07:00:00.000Z');
  assert.equal(localDate(new Date('2026-10-04T22:30:00Z')), '2026-10-05');
});

test('crypto: encrypt/decrypt round-trip, legacy plain rows readable', async () => {
  const { encrypt, decrypt } = await import('../src/lib/crypto.js');
  const blob = encrypt('xoxp-secret');
  assert.notEqual(blob, 'xoxp-secret');
  assert.equal(decrypt(blob), 'xoxp-secret');
  assert.equal(decrypt('plain:abc'), 'abc');
});

test('AI highlights: only known updates, no duplicates, at most 8, links from our data', async () => {
  const { cleanHighlights } = await import('../src/jobs/aimodels.js');
  const updates = Array.from({ length: 12 }, (_, i) => ({ id: 'u' + i, title: 'Update ' + i, url: 'https://lab.example/' + i, vendor: 'anthropic', kind: 'release', importance: 9, published_at: 1000 + i }));
  const picks = [
    { id: 'u3', title: 'Model X released', what: 'Faster and cheaper.' },
    { id: 'u3', title: 'dup', what: 'dup' },
    { id: 'made-up', title: 'Fake', what: 'Not in the data' },
    { id: 'u4', title: 'No text', what: '  ' },
    ...updates.slice(5).map(u => ({ id: u.id, title: '', what: 'Changed ' + u.id }))
  ];
  const out = cleanHighlights(picks, updates);
  assert.equal(out.length, 8);
  assert.deepEqual(out[0], { title: 'Model X released', what: 'Faster and cheaper.', vendor: 'anthropic', kind: 'release', importance: 9, url: 'https://lab.example/3', publishedAt: 1003 });
  assert.equal(out[1].title, 'Update 5');               // empty title falls back to the feed title
  assert.ok(!out.some(h => h.url.endsWith('/4')));
  assert.equal(cleanHighlights(undefined, updates).length, 0);
});

test('HTML mail becomes readable text', async () => {
  const { htmlToText } = await import('../src/connectors/gmail.js');
  const html = '<html><head><style>p{color:red}</style></head><body><p>Hi Kevin,</p><p>Your interview is on <b>Friday</b>.<br>Details: <a href="https://jobs.example/x">here</a></p><ul><li>CV</li><li>Portfolio</li></ul><p>Tom &amp; Ana&nbsp;&#8212; HR</p></body></html>';
  assert.equal(htmlToText(html), 'Hi Kevin,\nYour interview is on Friday.\nDetails: here (https://jobs.example/x)\n• CV\n• Portfolio\nTom & Ana — HR');
});
