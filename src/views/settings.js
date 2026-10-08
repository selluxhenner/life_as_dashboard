import { h } from '../core/dom.js';
import { state, save, notify } from '../core/store.js';
import { panel } from '../components/panel.js';
import { viewHead, seg, toggle, btn, chip, empty, select } from '../components/ui.js';
import { confirmDialog } from '../components/overlay.js';
import { apiConfig, api, errorText, DEFAULT_SERVER, BUILT_IN } from '../core/api.js';
import { pairAndConnect, disconnectSync, runSync, syncStatus } from '../core/sync.js';
import { remote, refresh } from '../core/remote.js';
import { applyTheme, THEMES } from '../core/theme.js';
import { platform } from '../core/platform.js';
import { toast } from '../core/fx.js';
import { fmt } from '../core/dates.js';
import { scheduleCal } from '../core/calendar-sync.js';
import { icon } from '../core/icons.js';
import { native, nativeStatus, nativeCall, onNativeStatus } from '../core/native.js';
import { speak, stopSpeaking, clearVoiceCache, VOICE_SAMPLES, PREMIUM_VOICES, SPEEDS, voiceSettings, voiceScore, systemVoices } from '../voice/tts.js';

const row = (label, hint, control) => h('div.set-row', h('div.grow', h('div.title', label), hint ? h('div.sub', hint) : null), control);

// Unsaved form input survives re-renders (sync status updates rebuild the view).
const draft = { url: null, token: '' };

function serverPanel() {
  const cfg = apiConfig();
  const url = h('input.field', { type: 'url', value: draft.url ?? (cfg ? cfg.url : DEFAULT_SERVER), 'aria-label': 'Server URL', spellcheck: false, oninput: e => { draft.url = e.target.value; } });
  const token = h('input.field', { type: 'password', placeholder: cfg ? '•••••••• (paired)' : 'Pairing token from the server', 'aria-label': 'Pairing token', autocomplete: 'off', value: draft.token, oninput: e => { draft.token = e.target.value; } });
  const msg = h('div.hint', { role: 'status' });
  const pair = async () => {
    // a build with a built-in server needs no token: "Connect" uses it
    const tok = token.value.trim() || (BUILT_IN && !cfg ? BUILT_IN.token : '');
    if (!url.value.trim() || !tok) { msg.textContent = 'Enter the server URL and the pairing token.'; return; }
    msg.textContent = 'Connecting…';
    try {
      await pairAndConnect(url.value, tok);
      draft.url = null; draft.token = '';
      msg.textContent = 'Connected. This device now syncs with the server.';
      toast('Device connected', 'pulse');
    } catch (e) { msg.textContent = errorText(e); }
  };
  return panel({ title: 'Server', readout: cfg ? h('span', chip(syncStatus.state === 'ok' ? 'connected' : syncStatus.state, syncStatus.state === 'ok' ? 'ok' : 'warn')) : chip('local only', null, 'plain') },
    h('p.dim', { style: { marginBottom: '12px' } }, 'Agentic OS runs its background work (briefing, news, inbox, agent) on your server. This device keeps working offline and syncs when it can.'),
    h('label.label', 'Server URL'), url,
    BUILT_IN ? null : [h('label.label', cfg ? 'Pair again (optional)' : 'Pairing token'), token],
    msg,
    h('div.input-row', { style: { marginTop: '12px' } },
      cfg && BUILT_IN ? null : h('button.btn.primary', { type: 'button', onclick: pair }, cfg ? 'Re-pair' : BUILT_IN ? 'Connect' : 'Pair this device'),
      cfg ? h('button.btn', { type: 'button', onclick: () => runSync() }, 'Sync now') : null,
      cfg ? h('button.btn.danger', { type: 'button', onclick: () => { disconnectSync(); notify(); } }, BUILT_IN ? 'Disconnect' : 'Unpair') : null),
    cfg && state.sync.lastSync ? h('div.hint', `Last sync ${fmt.ago(state.sync.lastSync)} · ${Object.keys(state.sync.dirty).length} local change(s) waiting`) : null);
}

function appearancePanel() {
  const s = state.settings;
  return panel({ title: 'Appearance' },
    h('div.theme-cards', THEMES.map(t => h('button.theme-card' + (s.theme === t.id ? '.on' : ''), {
      type: 'button', 'aria-pressed': String(s.theme === t.id),
      onclick: () => { s.theme = t.id; applyTheme(t.id); save(); }
    }, h('div.swatches', t.swatches.map(c => h('i', { style: { background: c } }))), h('div.title', t.name), h('div.sub', t.note)))),
    row('Motion', 'Calm turns off decorative animation.', seg([{ value: 'full', label: 'Full' }, { value: 'calm', label: 'Calm' }], s.motion, v => { s.motion = v; document.documentElement.dataset.motion = v; save(); }, 'Motion')),
    row('Interface sounds', 'Soft ticks on actions.', toggle(s.sound, v => { s.sound = v; save(); }, 'Interface sounds')),
    row('Home location', 'Used for sunrise, sunset and the map marker.', h('span.data', `${s.home.city} · ${s.home.lat}, ${s.home.lon}`)));
}

function connectionsPanel() {
  const { data, connected, error } = remote('connections', '/api/connections', 60000);
  if (!connected) return panel({ title: 'Connections' }, empty('Pair this device first', 'Google, Slack and Fuxam are connected on the server, so every device sees them.'));
  const list = (data && data.connections) || [];
  const reload = () => refresh('connections', '/api/connections');
  let features = { calendar: true, gmail: true };
  const addGoogle = async () => {
    const win = window.open('', '_blank');
    try {
      const r = await api.post('/api/connections/google/start', { features: Object.keys(features).filter(k => features[k]) });
      if (win) win.location.href = r.url; else location.href = r.url;
      toast('Finish the Google sign-in, then come back here.');
    } catch (e) { if (win) win.close(); toast(errorText(e), 'flare'); }
  };
  const slackToken = h('input.field', { type: 'password', placeholder: 'xoxp-… user token', 'aria-label': 'Slack user token', autocomplete: 'off' });
  const icsUrl = h('input.field', { type: 'url', placeholder: 'Fuxam calendar link (webcal:// or https://)', 'aria-label': 'Fuxam calendar link' });
  const addSlack = async () => {
    if (!slackToken.value.trim()) return;
    try { await api.post('/api/connections/slack', { token: slackToken.value.trim() }); slackToken.value = ''; toast('Slack connected', 'pulse'); reload(); }
    catch (e) { toast(errorText(e), 'flare'); }
  };
  const addIcs = async () => {
    if (!icsUrl.value.trim()) return;
    try {
      const r = await api.post('/api/connections/ics', { url: icsUrl.value.trim(), label: 'School' });
      icsUrl.value = '';
      toast(r.preview && r.preview.length ? `Found ${r.preview.length} upcoming lessons, next: ${r.preview[0].title}` : 'Calendar added', 'pulse');
      reload(); scheduleCal(0, true);
    } catch (e) { toast(errorText(e), 'flare'); }
  };
  const remove = async c => { if (!await confirmDialog({ title: `Disconnect “${c.label || c.account}”?`, message: c.provider === 'google' ? 'Its calendar events and emails disappear from Agentic OS. You can connect it again any time.' : 'Its data disappears from Agentic OS. You can connect it again any time.', confirm: 'Disconnect' })) return; try { await api.del('/api/connections/' + c.id); reload(); } catch (e) { toast(errorText(e), 'flare'); } };
  const icon = { google: 'G', slack: '#', ics: '▦' };
  return panel({ title: 'Connections', readout: list.length + ' connected' },
    error && !data ? h('div.hint', errorText(error)) : null,
    h('div.rows', list.map(c => h('div.row',
      h('span.conn-badge', { style: { '--c': c.color || 'var(--signal)' } }, icon[c.provider] || '?'),
      h('div.grow', h('div.title', c.account || c.label), h('div.sub', [c.provider === 'google' ? (c.features || []).join(' + ') : c.provider === 'ics' ? 'School calendar' : 'Slack · ' + ((c.config && c.config.channels || []).length) + ' channels', c.lastSyncAt ? 'synced ' + fmt.ago(c.lastSyncAt) : null].filter(Boolean).join(' · '))),
      c.status === 'reauth' ? h('button.btn.sm', { type: 'button', onclick: addGoogle }, 'Reconnect') : chip(c.status === 'ok' ? 'ok' : c.status, c.status === 'ok' ? 'ok' : 'alert'),
      c.provider === 'slack' ? h('button.btn.sm.ghost', { type: 'button', onclick: () => pickChannels(c) }, 'Channels') : null,
      h('button.btn.sm.ghost.danger', { type: 'button', onclick: () => remove(c) }, 'Remove')))),
    h('div.conn-add',
      h('div.conn-block', h('div.title', 'Google account'), h('div.sub', 'Calendar and/or Gmail (read-only). Add as many accounts as you like.'),
        h('div.input-row', { style: { marginTop: '8px' } },
          h('label.inline-toggle', h('input', { type: 'checkbox', checked: true, onchange: e => { features.calendar = e.target.checked; } }), 'Calendar'),
          h('label.inline-toggle', h('input', { type: 'checkbox', checked: true, onchange: e => { features.gmail = e.target.checked; } }), 'Gmail'),
          h('button.btn', { type: 'button', onclick: addGoogle }, 'Add Google account'))),
      h('div.conn-block', h('div.title', 'Slack'), h('div.sub', 'Create a Slack app with a user token (scopes in the README), then paste it here.'),
        h('div.input-row', { style: { marginTop: '8px' } }, slackToken, h('button.btn', { type: 'button', onclick: addSlack }, 'Connect'))),
      h('div.conn-block', h('div.title', 'School · Fuxam'), h('div.sub', 'In Fuxam, copy your calendar subscription link.'),
        h('div.input-row', { style: { marginTop: '8px' } }, icsUrl, h('button.btn', { type: 'button', onclick: addIcs }, 'Add')))));
}

async function pickChannels(c) {
  try {
    const r = await api.get('/api/slack/channels');
    const chosen = new Set((c.config && c.config.channels) || []);
    const names = r.channels.map(ch => `${chosen.has(ch.id) ? '[x]' : '[ ]'} ${ch.name}`).join('\n');
    const ans = prompt('Channels to follow (comma-separated names):\n\n' + names, r.channels.filter(ch => chosen.has(ch.id)).map(ch => ch.name).join(', '));
    if (ans == null) return;
    const wanted = ans.split(',').map(s => s.trim().replace(/^#/, '')).filter(Boolean);
    const ids = r.channels.filter(ch => wanted.includes(ch.name)).map(ch => ch.id);
    await api.patch('/api/connections/' + c.id, { config: { ...(c.config || {}), channels: ids } });
    refresh('connections', '/api/connections');
    toast(`Following ${ids.length} channel(s)`, 'pulse');
  } catch (e) { toast(errorText(e), 'flare'); }
}

function serverSettingsPanel() {
  const { data, connected } = remote('serverSettings', '/api/settings', 5 * 60000);
  if (!connected || !data) return null;
  const ss = data.settings || {};
  const patch = async (key, value) => {
    try { await api.patch('/api/settings', { [key]: value }); refresh('serverSettings', '/api/settings'); toast('Saved'); }
    catch (e) { toast(errorText(e), 'flare'); }
  };
  const briefing = ss.briefing || { time: '08:00' };
  const phone = ss.phone || {};
  const voice = ss.voice || {};
  // the phone moves its morning alarm when it next reads the glance: make that now
  const time = h('input.field.narrow', { type: 'time', value: briefing.time, onchange: async e => {
    await patch('briefing', { ...briefing, time: e.target.value });
    if (native) nativeCall('checkNow', { glance: true }).catch(() => {});
  } });
  const phoneNum = h('input.field', { type: 'tel', value: phone.number || '', placeholder: '+49 …', onchange: e => patch('phone', { ...phone, number: e.target.value }) });
  return panel({ title: 'Automation' },
    row('Morning briefing', 'Generated a few minutes before, then pushed to your devices.', time),
    row('Play the spoken briefing automatically', 'The 30-second version, the first time the app is in front each morning (until noon).', toggle(!!voice.autoRead, v => patch('voice', { ...voice, autoRead: v }), 'Auto-read')),
    h('div.set-sep'),
    row('Phone check-ins (prototype)', `The assistant can call you to collect answers. Hard cap €${phone.monthlyCapEur || 10}/month.`, toggle(!!phone.enabled, v => patch('phone', { ...phone, enabled: v }), 'Phone calls')),
    phone.enabled ? h('div', row('Your number', 'Verified caller ID on Twilio.', phoneNum),
      row('Quiet hours', 'No calls in this window.', h('span.data', (phone.quietHours || ['21:30', '08:30']).join(' → '))),
      h('div.input-row', h('button.btn', { type: 'button', onclick: async () => { try { await api.post('/api/phone/call', { purpose: 'test', questions: ['Is this a good moment to test the call?'] }); toast('Calling you…', 'pulse'); } catch (e) { toast(errorText(e), 'flare'); } } }, 'Test call'))) : null);
}

/* ---------- notifications ----------
   What reaches you is set on the server (it applies to every device and to ntfy). On Android this panel also shows
   whether the phone can actually receive it: permission, the exact morning alarm, battery, plus tile, widget and card. */
const AI_LEVELS = [{ value: 10, label: 'Frontier only' }, { value: 9, label: 'Big launches' }, { value: 8, label: 'Notable' }];
const PER_DAY = [{ value: 3, label: '3' }, { value: 6, label: '6' }, { value: 10, label: '10' }];
const CHANNEL_NAMES = { briefing: 'Morning briefing', breaking: 'Breaking world news', ai: 'Major AI news', calendar: 'Meeting prep', jobs: 'Job hunt', agent: 'Assistant', general: 'Other', pinned: 'Lock-screen card' };
let watchingNative = false;

function whenText(t) {
  const d = new Date(t), now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const day = d.toDateString() === now.toDateString() ? 'today' : d.toDateString() === tomorrow.toDateString() ? 'tomorrow' : d.toLocaleDateString('en-GB', { weekday: 'short' });
  return day + ' at ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

async function phoneAct(method, args, done) {
  try { const r = await native[method](args); if (done) done(r); await nativeCall('status'); }
  catch (e) { toast(String((e && e.message) || e), 'flare'); }
}

function phoneSection() {
  if (!watchingNative) { watchingNative = true; onNativeStatus(() => notify()); }
  const st = nativeStatus;
  if (!st) { nativeCall('status').catch(() => {}); return h('div.hint', 'Checking this phone…'); }
  const allowed = st.notifications === 'granted';
  const muted = (st.channelsOff || []).map(id => CHANNEL_NAMES[id] || id);
  const allow = () => phoneAct(st.notifications === 'prompt' ? 'requestNotifications' : 'openSettings', { what: 'notifications' });
  const test = kind => phoneAct('test', { kind }, () => toast(kind === 'morning' ? 'Morning notification sent' : 'Test notification sent', 'pulse'));
  const tileAdded = r => { if (r && (r.result === 'added' || r.result === 'already')) toast('Tile ready. Pull down on the lock screen and tap Briefing.', 'pulse'); };
  return h('div',
    row('This phone', !allowed ? 'Notifications are blocked, so nothing can reach you.'
      : muted.length ? 'Allowed, but muted here: ' + muted.join(', ') + '.' : 'Allowed. Every kind has its own channel in Android settings.',
      allowed ? btn('Channels', () => phoneAct('openSettings', { what: 'notifications' }), 'sm ghost') : btn('Allow', allow, 'sm primary')),
    row('Morning alarm', st.nextMorningAt
      ? `Next ${whenText(st.nextMorningAt)}${st.exactAlarms ? ', on the minute.' : '. Exact alarms are off, so it may come a few minutes late.'}`
      : 'Not set yet: connect to your server first.',
      st.exactAlarms ? chip('exact', 'ok') : btn('Allow exact', () => phoneAct('openSettings', { what: 'alarms' }), 'sm')),
    row('Background checks', `Every 15 minutes${st.pushRegistered ? ' and instantly by push' : ''}. Last check ${st.lastCheckAt ? fmt.ago(st.lastCheckAt) : 'not yet'}.`
      + (st.lastError ? ' ' + st.lastError : '') + (st.batteryUnrestricted ? '' : ' Android may delay them while the phone sleeps.'),
      st.batteryUnrestricted ? chip('never asleep', 'ok') : btn('Keep awake', () => phoneAct('openSettings', { what: 'battery' }), 'sm')),
    row('Lock-screen card', 'Today’s headline with Briefing, World and Ask, pinned to the lock screen and the shade.',
      toggle(!!st.pinned, v => phoneAct('setPinned', { on: v }), 'Pin today to the lock screen')),
    h('div.input-row', { style: { marginTop: '8px', flexWrap: 'wrap' } },
      st.canAddTile ? btn('Add Quick Settings tile', () => phoneAct('addTile', {}, tileAdded), 'sm') : null,
      st.canAddWidget ? btn(st.dayWidgets ? 'Add another day plan' : 'Add day plan widget', () => phoneAct('addWidget', { which: 'day' }), 'sm') : null,
      st.canAddWidget ? btn(st.widgets ? 'Add another briefing widget' : 'Add briefing widget', () => phoneAct('addWidget', { which: 'glance' }), 'sm') : null,
      st.canAddWidget ? btn(st.captureWidgets ? 'Add another capture widget' : 'Add capture widget', () => phoneAct('addWidget', { which: 'capture' }), 'sm') : null),
    h('div.hint', 'The tile works on the lock screen: pull down, tap Briefing and read today without unlocking.'),
    h('div.input-row', { style: { marginTop: '8px', flexWrap: 'wrap' } },
      btn('Test morning', () => test('morning'), 'sm ghost'), btn('Test breaking', () => test('breaking'), 'sm ghost'), btn('Test AI', () => test('ai'), 'sm ghost')),
    h('div.set-sep'));
}

function notificationsPanel() {
  const { data, connected } = remote('serverSettings', '/api/settings', 5 * 60000);
  const ss = (data && data.settings) || {};
  const a = { briefing: true, breaking: true, ai: true, calendar: true, jobs: true, agent: true, aiThreshold: 9, homeCountry: 'Germany', maxPerDay: 6, ...(ss.alerts || {}) };
  const patch = async v => {
    try { await api.patch('/api/settings', { alerts: { ...a, ...v } }); refresh('serverSettings', '/api/settings'); toast('Saved'); }
    catch (e) { toast(errorText(e), 'flare'); }
  };
  const st = nativeStatus;
  const readout = !native || !st ? null
    : st.notifications === 'granted' && st.configured && !st.lastError ? chip('ready', 'ok') : chip('check', 'warn');
  return panel({ title: 'Notifications', readout },
    native ? phoneSection() : null,
    !connected || !data ? empty('Pair this device first', 'Alerts are raised by your server.') : h('div',
      row('Morning briefing', `At ${(ss.briefing || {}).time || '08:00'} (set under Automation). If it isn’t written yet, a reminder that today’s update is on the page.`,
        toggle(!!a.briefing, v => patch({ briefing: v }), 'Morning briefing notification')),
      row('Breaking world news', `Major events reported by several outlets. News about ${a.homeCountry || 'your country'} counts one step earlier.`,
        toggle(!!a.breaking, v => patch({ breaking: v }), 'Breaking news')),
      row('Major AI news', 'New models and big launches, at most one per company in 12 hours.', toggle(!!a.ai, v => patch({ ai: v }), 'Major AI news')),
      a.ai ? row('AI alert level', null, seg(AI_LEVELS, a.aiThreshold, v => patch({ aiThreshold: v }), 'AI alert level')) : null,
      a.breaking || a.ai ? row('News alerts per day', 'Breaking and AI together; the rest waits on the World and AI pages.',
        seg(PER_DAY, a.maxPerDay, v => patch({ maxPerDay: v }), 'News alerts per day')) : null,
      row('Meeting prep', 'A short prep note 30 minutes before a meeting.', toggle(!!a.calendar, v => patch({ calendar: v }), 'Meeting prep')),
      row('Job hunt and assistant', 'Due follow-ups, approvals and call summaries.', toggle(!!(a.jobs && a.agent), v => patch({ jobs: v, agent: v }), 'Job hunt and assistant'))));
}

let voicesLoaded = false;
let previewAudio = null;
const ELEVEN_HINT = 'Add ELEVENLABS_API_KEY to the server’s .env and restart it. Starter ($6/month) covers a daily briefing, World and spoken replies; Creator ($22) if you talk to it a lot. The same key also does speech-to-text.';

/* ElevenLabs (the natural voice). Voice and model live on the server, so every device sounds the same. */
function elevenSection(info, paired) {
  if (!paired || !info) return null;
  if (!info.eleven) return row('Natural voice', 'ElevenLabs isn’t set up on the server yet. ' + ELEVEN_HINT, chip('not set up', 'warn'));
  const e = info.eleven;
  const patchVoice = async patch => {
    try { await api.patch('/api/settings', { voice: patch }); clearVoiceCache(); refresh('voiceInfo', '/api/voice/info'); refresh('serverSettings', '/api/settings'); }
    catch (err) { toast(errorText(err), 'flare'); }
  };
  const { data, error } = remote('elevenVoices', '/api/voice/voices', 60 * 60000);
  // your own voices (cloned, designed, saved from the library) first, then the premade ones
  const voices = ((data && data.voices) || []).slice().sort((a, b) => (a.category === 'premade') - (b.category === 'premade') || a.name.localeCompare(b.name));
  const acc = e.account;
  const credits = acc && acc.limit ? `${acc.tier ? acc.tier + ' plan, ' : ''}${acc.used.toLocaleString('en-GB')} of ${acc.limit.toLocaleString('en-GB')} credits used this month` : 'connected';
  const model = e.models.find(m => m.id === e.model) || e.models[0];
  const pick = v => {
    if (previewAudio) previewAudio.pause();
    if (v.preview) { previewAudio = new Audio(v.preview); previewAudio.play().catch(() => {}); }
    patchVoice({ elevenVoice: v.id });
  };
  return h('div.eleven',
    row('Natural voice', `ElevenLabs, ${credits}. Model: ${model.note}. Tap a voice to hear its sample; it is then used everywhere.`,
      seg(e.models.map(m => ({ value: m.id, label: m.label })), e.model, val => patchVoice({ elevenModel: val }), 'ElevenLabs model')),
    voices.length
      ? h('div.voice-cards.eleven-voices', voices.map(v => h('button.voice-card' + (v.id === e.voiceId ? '.on' : ''), {
          type: 'button', 'aria-pressed': String(v.id === e.voiceId), title: v.description || v.name, onclick: () => pick(v)
        }, h('span.title', v.name), h('span.sub', [v.accent, v.tone, v.gender].filter(Boolean).join(' · ') || v.category))))
      : h('div.hint', error ? 'Couldn’t load the voices: ' + errorText(error) : 'Loading voices…'));
}

function voicePanel() {
  const v = voiceSettings();
  const set = patch => { state.settings.voice = { ...v, ...patch }; save(); };
  if (!voicesLoaded) systemVoices().then(() => { voicesLoaded = true; notify(); });
  const all = 'speechSynthesis' in window ? speechSynthesis.getVoices() : [];
  const paired = !!apiConfig();
  const info = paired ? remote('voiceInfo', '/api/voice/info', 10 * 60000).data : null;
  const server = info && info.tts;                     // 'elevenlabs' | 'openai' | null
  const test = lang => speak(VOICE_SAMPLES[lang], null, { lang });
  const langRow = (lang, name) => {
    const list = all.map(x => [voiceScore(x, lang), x]).filter(x => x[0] >= 0).sort((a, b) => b[0] - a[0]).map(x => x[1]);
    const control = list.length
      ? select([{ value: '', label: 'Best · ' + list[0].name.replace(/^Microsoft |\s*-.*$/g, '') }, ...list.map(x => ({ value: x.name, label: x.name.replace(/^Microsoft |\s*-.*$/g, '') }))],
          v.system[lang] || '', val => set({ system: { ...v.system, [lang]: val } }), name + ' system voice', 'field sm voice-select')
      : chip('none installed', 'warn');
    return row(name + ' voice', list.length ? 'Used for ' + name + ' text when the server voice is off or unreachable.' : 'Add one in Windows Settings › Time & language › Speech › Add voices.',
      h('div.input-row', control, h('button.btn.sm', { type: 'button', onclick: () => test(lang) }, icon('volume'), 'Test')));
  };
  const readout = !paired || v.provider === 'system' || !server ? 'device voice' : server === 'elevenlabs' ? 'ElevenLabs' : 'OpenAI · ' + v.premiumVoice;
  return panel({ title: 'Voice', cls: 'voice-panel', readout },
    row('Language', v.language === 'auto' ? 'Each text is read in its own language: English with an English voice, German with a German one.' : 'Everything is read in English with an English voice.',
      seg([{ value: 'en', label: 'English' }, { value: 'auto', label: 'Match text' }], v.language, val => set({ language: val }), 'Voice language')),
    row('Engine', paired ? 'Auto uses the natural voice from your server and falls back to this device.' : 'Pair the server to unlock the natural voice. Until then this device’s voices are used.',
      seg([{ value: 'auto', label: 'Auto' }, { value: 'premium', label: 'Server' }, { value: 'system', label: 'Device' }], v.provider, val => set({ provider: val }), 'Voice engine')),
    v.provider !== 'system' ? elevenSection(info, paired) : null,
    v.provider !== 'system' && server === 'openai' ? h('div.voice-cards', PREMIUM_VOICES.map(p => h('button.voice-card' + (v.premiumVoice === p.id ? '.on' : ''), {
      type: 'button', 'aria-pressed': String(v.premiumVoice === p.id), disabled: !paired,
      onclick: () => { set({ premiumVoice: p.id }); speak(VOICE_SAMPLES.en, null, { lang: 'en' }); }
    }, h('span.title', p.label), h('span.sub', p.note)))) : null,
    row('Speed', 'How fast every voice talks. Brisk fits a whole briefing into 30 seconds; Fast if you want it even quicker.',
      seg(SPEEDS.map(o => ({ ...o, value: String(o.value) })), String(v.rate), val => { set({ rate: parseFloat(val) }); test('en'); }, 'Speed')),
    langRow('en', 'English'),
    v.language === 'auto' ? langRow('de', 'German') : null,
    h('div.input-row', { style: { marginTop: '8px' } },
      h('button.btn.sm', { type: 'button', onclick: () => test('en') }, icon('play'), 'Test English'),
      v.language === 'auto' ? h('button.btn.sm', { type: 'button', onclick: () => test('de') }, icon('play'), 'Test German') : null,
      h('button.btn.sm.ghost', { type: 'button', onclick: () => { stopSpeaking(); if (previewAudio) previewAudio.pause(); } }, 'Stop')));
}

function usagePanel() {
  const { data, connected } = remote('usage', '/api/usage', 10 * 60000);
  if (!connected || !data) return null;
  const u = data.usage || {};
  return panel({ title: 'Usage this month', readout: data.month || '' },
    h('div.grid.g-3',
      h('div.stat', h('div.k', 'AI'), h('div.v', '$' + (u.aiUsd || 0).toFixed(2), h('small', 'of $' + (u.aiCapUsd || 40)))),
      h('div.stat', h('div.k', 'Voice'), h('div.v', '$' + (u.voiceUsd || 0).toFixed(2))),
      h('div.stat', h('div.k', 'Phone'), h('div.v', '€' + (u.phoneEur || 0).toFixed(2), h('small', 'of €' + (u.phoneCapEur || 10))))));
}

function featuresPanel() {
  const f = state.settings.flags;
  return panel({ title: 'Features' },
    row('Rank & points', 'The old military-rank points system. Your history is kept; nothing is back-filled when you turn it on.', toggle(f.points, v => { f.points = v; save(); }, 'Rank and points')),
    row('Job suggestions', 'Let the server suggest Berlin Werkstudent/part-time roles daily.', toggle(f.jobsAi, v => { f.jobsAi = v; save(); api.patch('/api/settings', { flags: { ...f } }).catch(() => {}); }, 'Job suggestions')));
}

function dataPanel() {
  const exportData = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `agentic-os-${new Date().toISOString().slice(0, 10)}.json` });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return panel({ title: 'Data' },
    row('Export', 'Download everything stored on this device as JSON.', btn('Export', exportData)),
    row('Version', null, h('span.data', `v2.0 · ${platform.kind}`)));
}

export default {
  id: 'settings',
  render(root) {
    root.append(h('div.view.settings',
      viewHead('Settings', 'Server, connections, appearance and automation.'),
      h('div.grid.g-2',
        h('div.stack', serverPanel(), notificationsPanel(), connectionsPanel(), serverSettingsPanel()),
        h('div.stack', appearancePanel(), voicePanel(), featuresPanel(), usagePanel(), dataPanel()))));
  }
};
