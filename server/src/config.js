// Configuration from environment (optionally a .env file next to package.json).
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = resolve(ROOT, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const e = process.env;
export const config = {
  port: Number(e.PORT || 8787),
  host: e.HOST || '127.0.0.1',
  publicUrl: (e.PUBLIC_URL || 'http://127.0.0.1:8787').replace(/\/+$/, ''),
  dataDir: resolve(ROOT, e.DATA_DIR || 'data'),
  tz: e.HOME_TZ || 'Europe/Berlin',
  home: { lat: Number(e.HOME_LAT || 52.52), lon: Number(e.HOME_LON || 13.405), city: e.HOME_CITY || 'Berlin' },
  dev: e.DEV === '1',
  apiToken: e.API_TOKEN || '',
  encKey: e.ENC_KEY || '',
  corsOrigins: (e.CORS_ORIGINS || 'http://tauri.localhost,tauri://localhost,https://tauri.localhost,https://localhost,capacitor://localhost,http://localhost')
    .split(',').map(s => s.trim()).filter(Boolean),
  google: { clientId: e.GOOGLE_CLIENT_ID || '', clientSecret: e.GOOGLE_CLIENT_SECRET || '' },
  anthropicKey: e.ANTHROPIC_API_KEY || '',
  // voice: Lina's spoken turns ("Hey Lina", push-to-talk, phone), where an answer within a second matters most
  models: { main: e.AI_MODEL_MAIN || 'claude-sonnet-5-5', fast: e.AI_MODEL_FAST || 'claude-haiku-4-5', voice: e.AI_MODEL_VOICE || 'claude-haiku-5-5' },
  openaiKey: e.OPENAI_API_KEY || '',
  elevenKey: e.ELEVENLABS_API_KEY || '',
  elevenVoice: e.ELEVENLABS_VOICE_ID || '',
  elevenApi: (e.ELEVENLABS_API_URL || 'https://api.elevenlabs.io').replace(/\/+$/, ''),   // override only for tests / EU residency
  aaKey: e.AA_API_KEY || '',
  twilio: { sid: e.TWILIO_ACCOUNT_SID || '', token: e.TWILIO_AUTH_TOKEN || '', from: e.TWILIO_FROM || '' },
  ntfy: { url: (e.NTFY_URL || 'https://ntfy.sh').replace(/\/+$/, ''), topic: e.NTFY_TOPIC || '' },
  fcmCredentials: ''                     // set below, once dataDir is known
};
config.fcmCredentials = resolve(ROOT, e.FCM_CREDENTIALS || resolve(config.dataDir, 'fcm-service-account.json'));

if (!config.apiToken) {
  console.error('API_TOKEN is not set. Put it in server/.env (see .env.example).');
  process.exit(1);
}
mkdirSync(config.dataDir, { recursive: true });
