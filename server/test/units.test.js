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

test('spoken script: grounded topics only, two sentences each, fits the 30-second budget', async () => {
  const { shapeSpoken, cleanSay, spokenText, spokenScript, stripTags, words, MAX_WORDS } = await import('../src/voice/script.js');
  assert.equal(cleanSay('The DAX fell 2.5% today. Lessons start at 9.30. A third sentence is cut.'), 'The DAX fell 2.5% today. Lessons start at 9.30.');
  assert.equal(cleanSay('**Rain** from 4 pm · take a jacket'), 'Rain from 4 pm, take a jacket.');
  assert.equal(cleanSay('[excited] See [the post](https://x.y) now'), 'See the post now.');
  const say = n => Array.from({ length: n }, (_, i) => 'word' + i).join(' ') + '.';
  const out = shapeSpoken({
    greeting: 'Good morning, Kevin.',
    overview: 'Busy morning, free afternoon.',
    overviewTone: 'bright',
    topics: [
      { label: 'First up', say: say(20), tone: 'urgent', refs: ['ev:1'] },
      { label: 'Made up', say: say(5), refs: ['ev:999'] },          // not in the data: dropped
      { label: 'Inbox', say: say(20), tone: 'shouty', refs: ['mail:1', 'ev:999'] },  // the bad ref is removed, the topic stays
      { label: 'Rain', say: say(20), tone: 'relaxed', refs: ['weather'] },
      { label: 'World', say: say(20), refs: ['world:0'] },
      { label: 'Jobs', say: say(20), refs: ['job:1'] }
    ],
    outro: 'Everything else can wait.'
  }, r => r !== 'ev:999');
  assert.deepEqual(out.topics.map(t => t.label), ['First up', 'Inbox', 'Rain']);
  assert.deepEqual(out.topics[1].refs, ['mail:1']);
  assert.equal(out.topics[1].tone, undefined);                       // unknown tones are dropped, not passed to the voice
  assert.ok(out.words <= MAX_WORDS && out.seconds <= 30, `${out.words} words, ${out.seconds} s`);
  assert.equal(words(spokenText(out)), out.words);
  assert.ok(spokenText(out).startsWith('Good morning, Kevin. Busy morning, free afternoon. word0'));
  assert.ok(spokenText(out).endsWith('Everything else can wait.'));
  // the voice gets the same words with a quick pace up front and a tone per line
  const script = spokenScript(out);
  assert.ok(script.startsWith('[Quick, lively, energetic pace, bright, upbeat] Good morning, Kevin. [bright, upbeat] Busy morning'));
  assert.ok(script.includes('[focused, urgent] word0'));
  assert.ok(script.endsWith('[relaxed, easy] Everything else can wait.'));
  assert.equal(stripTags(script), spokenText(out));
  // over budget: topics go first, then the outro, then the overview
  const tight = shapeSpoken({ greeting: 'Hi.', overview: say(10), topics: [{ say: say(30), refs: ['a'] }], outro: say(8) }, () => true, 42);
  assert.equal(tight.outro, '');
  assert.ok(tight.overview);
});

test('Lina: wake words are stripped, short yes/no answers are recognised in English, German and Swiss German', async () => {
  const { stripWake, yesNo, guessLang, saidLina } = await import('../src/voice/lina.js');
  for (const s of ['Hey Lina, schedule a meeting', 'Hi, Lena. What is next?', 'hoi leena mach en termin', 'Lina?', 'Okay, hey Lina'])
    assert.ok(saidLina(s), s);
  for (const s of ['Hey Linda, can you send it', 'The line near the arena', 'I talked to Max and then later to Lina about it'])
    assert.ok(!saidLina(s), s);
  assert.equal(stripWake('Hey Lina, schedule a meeting at 3pm.'), 'schedule a meeting at 3pm.');
  assert.equal(stripWake('Hoi Lina plan es Meeting'), 'plan es Meeting');
  assert.equal(stripWake('hallo leena: um drei'), 'um drei');
  assert.equal(stripWake('Hey Lina.'), '');
  assert.equal(stripWake('Linear is a tool'), 'Linear is a tool');
  for (const s of ['Yes.', 'yes please', 'Yeah, send it!', 'ok', 'Ja.', 'Jo, gärn', 'Ja bitte', 'Klar, schick es', 'passt'])
    assert.equal(yesNo(s)?.answer, 'yes', s);
  for (const s of ['No.', 'Nope', 'Nein, danke', 'nei', 'nöd schicke', "don't send it"])
    assert.equal(yesNo(s)?.answer, 'no', s);
  for (const s of ['Yes, but make it 4pm', 'Ja, aber später', 'Who is invited?', 'Schedule another one with Anna tomorrow at ten please'])
    assert.equal(yesNo(s), null, s);
  assert.equal(yesNo('Jo gärn').lang, 'de');
  assert.equal(yesNo('yes').lang, 'en');
  assert.equal(guessLang('Ich habe das Meeting um 15 Uhr eingetragen. Soll ich die Einladung schicken?'), 'de');
  assert.equal(guessLang('I put the meeting at 3 pm on your calendar. Shall I send the invite?'), 'en');
});
