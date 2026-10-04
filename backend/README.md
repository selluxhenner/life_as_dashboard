# LIFE OS API

Cloudflare Worker + D1. Hält die To-dos, damit Dashboard (Windows), App/Widget (Handy) und Claude denselben Stand sehen.

## Lokal entwickeln

```bash
npm install
npm run db:migrate:local
npm run dev          # http://127.0.0.1:8787, Token steht in .dev.vars
npm test             # Integrationstests gegen den laufenden Dev-Server
```

## Einmalig deployen

```bash
npx wrangler login                      # im Browser bei Cloudflare anmelden
npx wrangler d1 create lifeos           # ausgegebene database_id in wrangler.toml eintragen
npm run db:migrate:remote
npx wrangler secret put API_TOKEN       # langes Zufalls-Token eingeben, gut aufbewahren
npm run deploy                          # gibt die URL aus: https://lifeos-api.<name>.workers.dev
```

Token erzeugen: `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`

Danach im Dashboard oben auf **SYNC AUS** klicken, URL + Token eintragen, **Verbinden**. Auf jedem Gerät einmal.

## Google Kalender einrichten (einmalig)

1. In der [Google Cloud Console](https://console.cloud.google.com/) ein Projekt anlegen und die **Google Calendar API** aktivieren.
2. **OAuth-Zustimmungsbildschirm**: Typ „Extern“, dich selbst als Testnutzer eintragen. Bereiche: `calendar.events` und `calendar.calendarlist.readonly`.
   Solange die App im Status „Testing“ ist, läuft die Anmeldung nach 7 Tagen ab. Für Dauerbetrieb auf „In Produktion“ stellen (für den Eigengebrauch ist keine Google-Prüfung nötig, es erscheint nur ein Warnhinweis).
3. **Anmeldedaten → OAuth-Client-ID → Webanwendung**. Autorisierte Weiterleitungs-URIs:
   - `https://lifeos-api.<name>.workers.dev/api/gcal/callback`
   - lokal zusätzlich `http://127.0.0.1:8787/api/gcal/callback`
4. Secrets setzen:
   ```bash
   npm run db:migrate:remote
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   npm run deploy
   ```
   Lokal stattdessen `GOOGLE_CLIENT_ID=…` und `GOOGLE_CLIENT_SECRET=…` in `.dev.vars`.
5. Im Dashboard **SYNC** öffnen → **Mit Google verbinden**. Einmal reicht für alle Geräte.

Was passiert:
- **App → Kalender:** Tagesplan-Blöcke werden Termine im Hauptkalender (Ende = nächster Block, max. 3 h, sonst 60 Min.), To-dos mit Fälligkeit werden ganztägige Einträge ohne Erinnerung. Erledigtes bekommt ein ✓, Gelöschtes verschwindet. Abgeglichen wird ab 7 Tagen in der Vergangenheit.
- **Kalender → App:** Termine aller sichtbaren Kalender erscheinen im Tagesplan, in der Woche und als „Nächster Termin“ auf Home (nur lesend, Klick öffnet Google Kalender).
- Änderungen an LIFE-OS-Terminen direkt in Google bleiben stehen, bis der Eintrag in der App wieder geändert wird.

## API

Alle Routen ausser `/api/health` brauchen `Authorization: Bearer <API_TOKEN>`.

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/api/health` | Lebenszeichen |
| GET | `/api/todos` | Alle offenen und erledigten To-dos (`?all=1` inkl. gelöschte) |
| GET | `/api/todos/:id` | Ein To-do |
| POST | `/api/todos` | Anlegen: ein Objekt oder `{ "todos": [...] }` (max. 200) |
| PATCH | `/api/todos/:id` | Felder ändern, z. B. `{ "done": true }` |
| DELETE | `/api/todos/:id` | Löschen (bleibt als Tombstone für den Sync) |
| POST | `/api/sync` | App-Sync: `{ since, upserts }` → `{ todos, cursor }` |
| GET | `/api/gcal/status` | `{ configured, connected, account }` |
| POST | `/api/gcal/connect` | → `{ url }` der Google-Anmeldung |
| GET | `/api/gcal/callback` | Rückkehr von Google (ohne Bearer, signierter `state`) |
| DELETE | `/api/gcal` | Kalender trennen, Token widerrufen |
| GET | `/api/gcal/events?from=&to=` | Termine (YYYY-MM-DD, `to` exklusiv, max. 120 Tage) |
| POST | `/api/gcal/push` | `{ timeZone, upserts:[{key,title,date,time?,endTime?,done,notes?}], deletes:[key] }`, max. 20 |

Felder: `id, title, notes, done, priority (high|med|low), due (YYYY-MM-DD), project, sort, source (app|widget|claude|api), createdAt, updatedAt, completedAt, deleted`.
Konflikte: die jüngere Änderung (`updatedAt`) gewinnt.
