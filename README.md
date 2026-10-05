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

**Android:** runs the build and `cap sync`, then open `android/` in Android Studio and press Run.
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

### 2. Pair your devices
In the app, open **Settings → Server**. The URL is pre-filled. Paste the `API_TOKEN` and press **Pair this device**.
- Each device gets its own revocable token. The master token is not stored on the device.
- Paired devices share everything: tasks, jobs, plan blocks, week planner, habits, captures, goals, routines, reflections, focus sessions, weight and the theme. Sound and motion stay per device. The newest edit wins per item.
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
- `OPENAI_API_KEY` is used for push-to-talk speech-to-text and the premium read-aloud voice.
- `AA_API_KEY` is a free Artificial Analysis key that powers the "best models" leaderboard.

**Notifications:**
- **Phone:** install the **ntfy** app, subscribe to a long random topic, and put that topic in `NTFY_TOPIC`.
- **Desktop:** notifications show natively in the desktop app.

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
| 07:30 | AI models daily |
| 07:50 | morning briefing; you get a notification at 08:00. The time can be changed in Settings |
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
