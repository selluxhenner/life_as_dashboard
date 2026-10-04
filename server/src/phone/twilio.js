// Phone check-ins (prototype): Twilio calls Kevin, ConversationRelay turns speech <-> text, the agent runs the conversation.
// Hard limits: feature flag, monthly € cap (checked before dialling), per-call time limit, quiet hours.
// The real hard stop is a prepaid Twilio balance with auto-recharge OFF.
import { createHmac } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { config } from '../config.js';
import { db, j } from '../db.js';
import { getSetting } from '../settings.js';
import { uid, hmac, safeEqual } from '../lib/crypto.js';
import { localTime, monthKey } from '../lib/time.js';
import { runAgent } from '../agent/runner.js';
import { notify } from '../notify/index.js';

const EUR_PER_MIN = 0.12;   // conservative: Twilio DE mobile outbound + ConversationRelay

export function phoneSpend(month = monthKey()) {
  return db.get('SELECT COALESCE(SUM(COALESCE(cost_eur, 0)), 0) s FROM calls WHERE created_at >= ?', new Date(month + '-01T00:00:00Z').getTime()).s;
}

function inQuietHours([from, to]) {
  const t = localTime();
  return from > to ? (t >= from || t < to) : (t >= from && t < to);
}

const sign = id => hmac(config.apiToken, 'call:' + id);

export async function placeCall({ purpose, questions = [] }) {
  const ph = getSetting('phone');
  if (!ph.enabled) throw new Error('Phone check-ins are switched off in Settings');
  if (!config.twilio.sid || !config.twilio.token || !config.twilio.from) throw new Error('Twilio is not configured on the server');
  if (!/^\+\d{8,15}$/.test(ph.number || '')) throw new Error('Set your phone number (+49…) in Settings');
  if (purpose !== 'test' && inQuietHours(ph.quietHours)) throw new Error('Quiet hours — no calls right now');
  const projected = phoneSpend() + (ph.maxSeconds / 60) * EUR_PER_MIN;
  if (projected > ph.monthlyCapEur) throw new Error(`Monthly phone budget (€${ph.monthlyCapEur}) would be exceeded`);

  const id = uid('call_');
  db.run('INSERT INTO calls (id, purpose, questions, status, created_at) VALUES (?, ?, ?, ?, ?)', id, purpose, j.str(questions), 'dialing', Date.now());
  const params = new URLSearchParams({
    To: ph.number, From: config.twilio.from, TimeLimit: String(ph.maxSeconds), Timeout: '25',
    Url: `${config.publicUrl}/api/phone/twiml/${id}?sig=${sign(id)}`,
    StatusCallback: `${config.publicUrl}/api/phone/status/${id}?sig=${sign(id)}`, StatusCallbackMethod: 'POST'
  });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.twilio.sid}/Calls.json`, {
    method: 'POST', body: params,
    headers: { Authorization: 'Basic ' + Buffer.from(config.twilio.sid + ':' + config.twilio.token).toString('base64') }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { db.run("UPDATE calls SET status = 'failed', outcome = ? WHERE id = ?", data.message || 'Twilio error', id); throw new Error('Twilio: ' + (data.message || res.status)); }
  db.run('UPDATE calls SET twilio_sid = ? WHERE id = ?', data.sid, id);
  return { callId: id, status: 'dialing' };
}

/* Twilio request signature: base64(HMAC-SHA1(authToken, url + sorted POST params)). */
export function validTwilioSignature(url, params, signature) {
  if (!config.twilio.token) return false;
  const data = url + Object.keys(params).sort().map(k => k + params[k]).join('');
  return safeEqual(createHmac('sha1', config.twilio.token).update(data).digest('base64'), signature || '');
}

export function twiml(id) {
  const call = db.get('SELECT * FROM calls WHERE id = ?', id);
  const greeting = call?.purpose === 'test'
    ? 'Hi Kevin, this is your Agentic OS assistant. This is a test call. Say anything, or say goodbye to hang up.'
    : `Hi Kevin, it's your assistant. Quick check-in about ${call?.purpose || 'your day'}. Is now okay?`;
  const ws = config.publicUrl.replace(/^http/, 'ws') + `/api/phone/relay/${id}?sig=${sign(id)}`;
  const esc = s => s.replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[ch]);
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Connect><ConversationRelay url="${esc(ws)}" welcomeGreeting="${esc(greeting)}" language="en-GB" interruptible="true" /></Connect></Response>`;
}

export function callStatus(id, p) {
  const st = p.CallStatus;
  const dur = Number(p.CallDuration || 0);
  if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(st)) {
    db.run('UPDATE calls SET status = ?, ended_at = ?, duration_s = ?, cost_eur = ? WHERE id = ?',
      st, Date.now(), dur, Math.ceil(dur / 60) * EUR_PER_MIN, id);
    const call = db.get('SELECT * FROM calls WHERE id = ?', id);
    if (st === 'completed' && call?.outcome) notify({ title: 'Call summary', body: call.outcome.slice(0, 280), url: '#/assistant' });
    else if (st !== 'completed') notify({ title: 'Call not answered', body: `Status: ${st}`, url: '#/assistant' });
  } else db.run('UPDATE calls SET status = ?, started_at = COALESCE(started_at, ?) WHERE id = ?', st, Date.now(), id);
}

/* ConversationRelay WebSocket: text in (voicePrompt), text out (tokens). */
export function attachRelay(server) {
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://x');
    const m = url.pathname.match(/^\/api\/phone\/relay\/([\w]+)$/);
    if (!m || !safeEqual(url.searchParams.get('sig'), sign(m[1]))) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => session(ws, m[1]));
  });
}

function session(ws, id) {
  const call = db.get('SELECT * FROM calls WHERE id = ?', id);
  const questions = j.parse(call?.questions, []);
  const transcript = [];
  let busy = false, conversationId = null;
  const extraSystem = `You are on a phone call with Kevin (purpose: ${call?.purpose || 'check-in'}).` +
    (questions.length ? ` Ask these questions one at a time and wait for each answer: ${questions.map((q, i) => `${i + 1}) ${q}`).join(' ')}.` : '') +
    ' When you have the answers (or Kevin wants to stop): save what he said with add_note and create_todo where useful, say a short goodbye and end your reply with the token [END].';
  const say = (text, last = true) => ws.send(JSON.stringify({ type: 'text', token: text, last }));

  ws.on('message', async raw => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === 'setup') { db.run("UPDATE calls SET status = 'in-progress', started_at = ? WHERE id = ?", Date.now(), id); return; }
    if (msg.type !== 'prompt' || !msg.last || busy) return;
    busy = true;
    transcript.push({ who: 'kevin', text: msg.voicePrompt });
    try {
      const r = await runAgent({ message: msg.voicePrompt, conversationId, trigger: 'phone', allowed: ['read', 'internal'], extraSystem });
      conversationId = r.conversationId;
      const end = r.text.includes('[END]');
      const reply = r.text.replace('[END]', '').trim() || 'Okay.';
      transcript.push({ who: 'assistant', text: reply });
      say(reply);
      if (end) setTimeout(() => ws.send(JSON.stringify({ type: 'end' })), 4000);
    } catch (e) {
      say('Sorry, something went wrong on my side. I will send you a message instead. Bye.');
      setTimeout(() => ws.send(JSON.stringify({ type: 'end' })), 3000);
    } finally { busy = false; }
  });
  ws.on('close', () => {
    const outcome = transcript.filter(t => t.who === 'kevin').map(t => t.text).join(' / ').slice(0, 600);
    db.run('UPDATE calls SET transcript = ?, outcome = ? WHERE id = ?', j.str(transcript), outcome || null, id);
  });
}

export function listCalls() {
  return db.all('SELECT id, purpose, status, started_at, ended_at, duration_s, cost_eur, transcript, outcome, created_at FROM calls ORDER BY created_at DESC LIMIT 20')
    .map(c => ({ ...c, transcript: j.parse(c.transcript, []) }));
}
