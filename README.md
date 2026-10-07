# Agentic OS

A personal operating system: day plan, calendar (Google + Fuxam lessons), inbox (several Gmail accounts + Slack), a morning briefing, a world news map, an AI-models tracker, a Berlin job hunt, and an assistant you can type or talk to. It can also phone you.

| Part | Where | Tech |
|---|---|---|
| App (UI) | `src/` | Vite + vanilla JS modules. Design system in [DESIGN.md](DESIGN.md) |
| Desktop | `src-tauri/` | Tauri 2: global hotkey **Ctrl+Alt+Space** (falls back to **Ctrl+Alt+O** if another app owns it; the tray tooltip shows the active one), tray icon, starts with Windows |
| Android | `android/` | Capacitor |
| Server | `server/` | Node 22 + Hono + SQLite, runs on Hetzner at `agentic-os.serviweb.ch` |

## Everyday commands

These all run from the repo root.

**Develop the UI** (opens on http://localhost:5500):
```bash
npm run dev
```

**Run the frontend tests** (data migrations, English-only UI check):
```bash
npm test
```

**Desktop app with hot reload:**
```bash
npm run desktop:dev
```

**Desktop installer:** builds to `src-tauri/target/release/bundle/nsis/*.exe`.
```bash
npm run desktop:build
```

The installer has its own design: a logo splash with a soft chime, the dot-matrix globe, the app's fonts and a dark theme on every page, including the uninstaller. It lives in `src-tauri/installer/`:
- `installer.nsi` is Tauri's template with small `AOS:` hooks.
- `theme.nsh` holds the styling.
- `art/make_art.py` renders the artwork at 100–200 % into `assets/`.

**Preview the installer design** without installing anything (add `-- --uninstall` for the uninstaller, `-- --art` to re-render the artwork first):
```bash
npm run installer:preview
```

**Android:** runs the build and `cap sync`, then open `android/` in Android Studio and press Run. The native parts (notifications, morning alarm, widgets, Quick Settings tile, shortcuts) live in `android/app/src/main/java/com/kevinschmid/lifeos/pulse/`; the web app talks to them through `src/core/native.js`.
```bash
npm run build:android
```

**Server locally** (inside `server/`; needs a `server/.env` with at least `API_TOKEN`):
```bash
npm --prefix server run dev
```

**Server tests:**
```bash
npm --prefix server test
```

## First-time setup

### 1. Hetzner server
**Current setup (shared box `hetzner` = 178.104.253.90, already runs nginx, Docker and Node 20 for other sites):**
the server runs as the Docker container `agentic-os` on `127.0.0.1:3160`, behind an nginx site. Nothing system-wide is replaced.
- Code and data: `~/agentic-os/` (as `kschmid`). Secrets: `~/agentic-os/.env` (mode 600). SQLite: `~/agentic-os/data/`.
- Deploy from your PC (Git Bash):
  ```bash
  ./server/deploy/deploy-docker.sh
  ```
- One time only, on the server, to add the nginx site + Let's Encrypt cert:
  ```bash
  sudo bash ~/agentic-os/nginx-setup.sh
  ```
- Logs: `ssh hetzner docker logs -f agentic-os`

**Fresh, dedicated server instead (Caddy + systemd):**
1. DNS: create an `A` record `agentic-os.serviweb.ch` pointing to the server's IP.
2. On the server, as root, run `server/deploy/setup-server.sh`. It installs Node 22, Caddy, the firewall and a service user.
3. Create `/etc/agentic-os.env` from [`server/.env.example`](server/.env.example). Generate `API_TOKEN` and `ENC_KEY` with the commands written in that file.
4. From your PC, deploy:
   ```bash
   ./server/deploy/deploy.sh root@<server-ip>
   ```
   Add `--web` to also host the web build.
5. Check that it is running: `https://agentic-os.serviweb.ch/api/health` should return `{"ok":true}`.
6. Optional: add a nightly backup to the server's crontab:
   ```
   15 3 * * * /srv/agentic-os/server/deploy/backup.sh
   ```

### 2. Connect your devices (no login)
The database is the server's SQLite file (`~/agentic-os/data/`). Every device keeps a full offline copy and syncs with it.

**Without any login screen (recommended):** put a token into your builds once, and every device you install them on connects by itself on first start.
1. Make a device token just for your builds (revocable under Settings → Devices):
   ```bash
   curl -s -X POST https://agentic-os.serviweb.ch/api/devices/pair -H "Authorization: Bearer <API_TOKEN>" -H "Content-Type: application/json" -d '{"name":"My builds","platform":"build"}'
   ```
2. Copy [`.env.example`](.env.example) to `.env.local` (git-ignored) and set `VITE_SYNC_TOKEN` to the `token` from step 1.
3. Build as usual (`npm run desktop:build`, `npm run build:android`). Settings → Server then only shows **Disconnect** / **Connect**.

Only install these builds on your own devices — the token is inside the app.

**By hand instead:** open **Settings → Server**. The URL is pre-filled. Paste the `API_TOKEN` and press **Pair this device**.
- Each device gets its own revocable token. The master token is not stored on the device.
- Paired devices share everything: tasks, jobs, plan blocks, week planner, habits, captures, goals, routines, weight and the theme. Sound and motion stay per device. The newest edit wins per item.
- A device that already has data keeps it when it is paired: habits with the same name are combined, and plan blocks of the same day are put together.

### 3. Connections (Settings → Connections)
**Google** (any number of accounts; Calendar and/or Gmail, read-only):
1. In Google Cloud Console, create an OAuth client of type **Web application**.
2. Set the redirect URI to `https://agentic-os.serviweb.ch/api/oauth/google/callback`.
3. Enable the **Google Calendar API** and the **Gmail API**.
4. On the OAuth consent screen, set publishing status to **In production**. In "Testing" mode the tokens expire after 7 days and the morning jobs stop. An unverified app is fine for your own accounts; you'll see a warning screen once per account.
5. Put the client ID and secret in `/etc/agentic-os.env`.

**Slack:**
1. Go to api.slack.com/apps → Create app → From scratch, and pick your workspace.
2. Under OAuth & Permissions → **User Token Scopes**, add:
   `channels:history`, `channels:read`, `groups:history`, `groups:read`, `im:history`, `im:read`, `mpim:history`, `mpim:read`, `users:read`, `search:read`
3. Install the app to the workspace, copy the `xoxp-…` token, and paste it into Settings. Then use **Channels** to pick the channels you want to follow.

**Fuxam:** copy your calendar subscription link (iCal / webcal) and paste it under **School · Fuxam**. Lessons show up in amber.

### 4. AI, voice, phone, notifications
These keys all go in `/etc/agentic-os.env`.

**AI and voice:**
- `ANTHROPIC_API_KEY` is needed for the briefing, news digests, AI tracker, inbox triage and the assistant.
  - Models: `claude-sonnet-5-5` writes, `claude-haiku-4-5` classifies.
  - A monthly cap is set in settings (default $40).
- `ELEVENLABS_API_KEY` is the natural voice (Eleven v4) and push-to-talk speech-to-text (Scribe v2), all with one key.
  - The Starter plan ($6/month) covers a daily briefing, World and spoken replies; Creator ($22) is for heavy use or voice cloning.
  - Pick the voice and model in Settings › Voice. `ELEVENLABS_VOICE_ID` only sets the default voice.
  - Audio is cached on the server for 14 days (`data/tts/`), so replaying the briefing on another device costs nothing.
- `OPENAI_API_KEY` (optional) is the fallback voice and transcription when ElevenLabs isn't set or fails.
- `AA_API_KEY` is a free Artificial Analysis key that powers the "best models" leaderboard.

**Voice agent:**
- **Morning briefing → Listen:** a 30-second spoken summary written together with the card, never the card read aloud. It opens with one line on the shape of the day, then up to four things that matter and what to do about them, and closes by saying what it left out ("everything else can wait"). It may add what the card doesn't show, such as rain at the times you're out or one world event that matters.
- **Ask:** tap, speak, tap Send. Claude answers in one to three spoken sentences and knows what you just heard ("tell me more about the second one"). The mic in the status bar does the same from any page. Exchanges also appear in the Agent chat.
- **World → Listen:** the world in 30 seconds: the big picture in one line, the four or five events that matter and why, and what was left out. With a filter on, the summary lines for that slice (or its top three headlines) and how many more are on the page.
- **How it sounds:** quick and lively. Eleven v4 gets a quick-pace direction and a tone per sentence (upbeat, serious, urgent …) so it rises and falls like a person talking; Settings › Voice › Speed (Calm / Brisk / Fast, Brisk by default) sets how fast every voice plays.
- **Automatic:** Settings › Automation › *Play the spoken briefing automatically* plays it the first time the app is in front each morning. If the system blocks sound until you tap, the next tap starts it.

**Notifications:**
Settings › Notifications picks what reaches you. These are server settings, so they apply to every device.
- the morning briefing
- breaking world news: ≥ 9/10 and ≥ 2 outlets. News about Germany counts at ≥ 8.
- major AI news: one alert per company in 12 hours. Level: frontier models only, big launches (default) or notable.
- meeting prep
- job hunt and assistant

Breaking and AI news share a daily cap (default 6).

- **Android (native, in the app itself):** the app posts its own notifications, each kind on its own channel, also while the app is closed.
  - **Every morning at the briefing time:** an exact alarm (on the minute, also in Doze) shows today's briefing: headline, overview and the spoken points, with **Listen** and **World** buttons. If the briefing isn't written yet, you get a reminder that today's update is on the page; the briefing replaces it quietly when it arrives.
  - **Every 15 minutes:** a background check (WorkManager) fetches new alerts. It survives reboots and app updates.
  - **Lock screen:**
    - All notifications show their text on the lock screen. It is news, not private mail.
    - The **Briefing** Quick Settings tile: pull down on the lock screen, tap it, and today's briefing opens right there without unlocking.
    - An optional pinned **lock-screen card** with Briefing · World · Ask.
    - Two **home-screen widgets**. On phones that allow lock-screen widgets, they can go there too.
      - **Day plan:** the lesson that is on now or next with its **room** in a big badge and a live countdown, the rest of the day (lessons, meetings, plan blocks) with rooms, and where tomorrow starts. From 20:00, or after the last item, it shows tomorrow. Make it small for just "next lesson + room".
      - **Briefing:** the briefing headline, the world's top stories and the top AI news.
    - Long-press the app icon for the **Briefing / World / AI news / Ask** shortcuts. On Samsung you can also put the app itself into the lock-screen shortcuts (Settings › Lock screen › Shortcuts).
  - **Setup on the phone:** Settings › Notifications. Allow notifications (asked on first start), press **Keep awake** so Android never delays the checks, then **Add Quick Settings tile** and **Add day plan widget** / **Add briefing widget**. Use the **Test** buttons to see each kind.
  - **Optional instant push** (seconds instead of up to 15 minutes): the server sends Firebase a content-free "check now", and the phone fetches the alert itself.
    1. Create a free Firebase project at console.firebase.google.com.
    2. Add an Android app with package `com.kevinschmid.lifeos`, download `google-services.json` into `android/app/` (git-ignored), and rebuild the APK.
    3. Under Project settings › Service accounts › *Generate new private key*, save the file on the server as `~/agentic-os/data/fcm-service-account.json`, or set `FCM_CREDENTIALS` to its path.
    4. Settings › Notifications then shows "instantly by push".
- **Desktop:** notifications show natively in the desktop app.
- **ntfy (optional, any device):** install the **ntfy** app, subscribe to a long random topic, and put that topic in `NTFY_TOPIC`.

**Phone check-ins (prototype):**
1. Create a Twilio account, verify your own number and buy or choose a caller ID.
2. Load about €10 of **prepaid credit with auto-recharge OFF**. That is the hard stop.
3. Turn the feature on in Settings → Automation, then press **Test call**.

## Schedule (server, Europe/Berlin)
| When | What |
|---|---|
| every 15 min | Gmail + Slack refresh, inbox triage, meeting prep 30 min before events |
| every 30 min, 06–24 | news poll, scoring, breaking-news detection (≥ 9/10 and ≥ 2 outlets) |
| 07:00 · 13:00 · 19:00 | world digest per continent |
| hourly at :20, 06–24 | AI watch: new vendor posts classified; major launches raise an alert |
| 07:30 | AI models daily |
| 07:50 | morning briefing (card + 30-second spoken version); the phone shows it at 08:00 on the minute. The time can be changed in Settings |
| 10:00 | job-hunt follow-ups (+ Berlin role suggestions if switched on) |

Run a job by hand (master token):
```bash
curl -X POST https://agentic-os.serviweb.ch/api/dev/run-job -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" -d '{"job":"briefing","force":true}'
```

## Safety model
- **One user.** The master token pairs devices. Device tokens are stored hashed and can be revoked.
- **Secrets stay on the server.** Google refresh tokens, Slack tokens and the ICS link are AES-GCM encrypted at rest.
- **Untrusted content.** Emails, Slack messages and news are wrapped as data for the model, never treated as instructions.
- **Assistant actions:** it may create todos, notes, job entries and blocks on your own calendar. Emails and calls only ever go to the **approval queue** (Assistant → Needs your approval).
- **Room to grow.** Tables carry a `user_id` (always 1 today), so adding more people later means adding a login, not redesigning.

## Legacy
The pre-v2 single-file app is kept in `legacy/`. The old Cloudflare Worker is in `backend/`; it has been replaced by `server/`.
