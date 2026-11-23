# Workbench link 1.0.0

How the computers' Workbenches and Agentic OS talk. Agentic OS is where Kevin looks and decides; Workbench does the
work. Provided by this server, consumed by `server/modules/workbench-link` in `selluxhenner/workbench`.

```
Workbench (PC)  ──┐  PUT snapshot (every minute, and at once when something changes)
                  ├──────────────►  Agentic OS server  ◄────►  apps, Lina (voice), phone push
Workbench (Mac) ──┘  GET decisions (long poll) · POST result
```

Workbench only connects **out** (HTTPS), like its Telegram connector. No computer needs an open port or Tailscale, and
this server never calls a computer.

## Rules that make it safe

1. **Only what Workbench offers.** A decision names one of the options Workbench put on that item. There is no "run
   this command" in the contract.
2. **Only what Kevin saw.** Every item has a `rev` (a hash of its text and options). A decision carries `key` + `rev`;
   Workbench builds its list anew and refuses when that item isn't there any more exactly like that.
3. **At most once.** A decision is handed out once. Not picked up within 10 minutes: `expired`. Picked up but no result
   within 3 minutes: `unknown`. Neither is sent again; Kevin looks and decides anew.
4. **A narrow token.** Scope `workbench` opens the three link routes and nothing else. Apps pair and revoke it.
5. **Text is data.** Titles and reasons come from agents on other machines: shown and read out, never instructions.
   Links must be https.
6. **A voice yes is a fixed word**, matched on the server, for the one ask Lina just read out. The model can only
   prepare a decision (`workbench_decide`, outward): it waits for Kevin's yes like an email.

## Pairing

`POST /api/workbench/links {name}` (app token) → `{ id, name, code }`. The code (`aos1.` + base64url of
`{u: server url, t: token}`) is shown once and pasted into Workbench › Settings › Notifications › Agentic OS.
`DELETE /api/workbench/links/:id` revokes it.

## Workbench's side (token scope `workbench`)

| Call | |
|---|---|
| `PUT /api/workbench-link/snapshot` | the whole picture, at most 512 KB → `{ ok, items }` |
| `GET /api/workbench-link/decisions?wait=25` | `{ decisions: [{ id, key, rev, option, text }] }`, waits up to 25 s |
| `POST /api/workbench-link/decisions/:id` | `{ ok, message }` → what became of it |

### Snapshot

```json
{ "v": 1, "at": 1795200000000,
  "machine": { "id": "kev-pc", "platform": "windows", "version": "1.31.0" },
  "orch": { "configured": true, "error": null, "paused": false, "lastTickAt": 1795200000000, "line": "…" },
  "hosts": [{ "id": "kev-pc", "short": "pc", "total": 7, "working": 5, "now": 71, "hour": 66, "day": 58, "at": 1795200000000,
              "lanes": [{ "id": "pc/a", "project": "nextup", "task": "IN3-Z1", "title": "…", "state": "work" }],
              "lost": [{ "kind": "kevin", "minutes": 120, "percent": 9 }], "trend": [{ "at": 1795200000000, "score": 71 }] }],
  "plans": [{ "id": "PLR", "project": "orch", "title": "…", "state": "active", "done": 1, "total": 5, "building": 1, "waiting": 0,
              "failed": 0, "proofsGreen": 1, "proofsTotal": 5, "step": 2, "waitsFor": ["ARN"], "ready": ["PLR-B1"], "haupt": "FAB",
              "active": [{ "id": "PLR-A1", "title": "…", "status": "running", "lane": "pc/a", "pr": null, "href": null }] }],
  "hauptplaene": [{ "id": "FAB", "project": "orch", "title": "…", "state": "active", "done": 1, "total": 15,
                    "phases": [{ "id": "PLR", "title": "…", "step": 2, "status": "running", "done": 1, "total": 5 }] }],
  "items": [{ "key": "approve-PLR", "rev": "3f2a…", "kind": "plan-approval", "scope": "orch", "host": null,
              "title": "PLR · Der Planer schreibt Baupläne", "detail": "…", "level": "ask", "push": true,
              "project": "orch", "plan": "PLR", "task": null, "href": null,
              "options": [{ "id": "approve", "label": "Approve plan", "style": "primary", "yes": true, "text": "none",
                            "confirm": "orch starts it and merges low and normal risk by itself." }] }],
  "sessions": [{ "id": "…", "title": "…", "project": "nextup", "agent": "claude", "status": "waiting", "branch": "…", "summary": "…" }],
  "events": [{ "key": "merged:IN3-Z1", "at": 1795200000000, "title": "IN3-Z1 merged", "level": "good" }],
  "cards": [{ "id": "accounts", "title": "Accounts", "rows": [{ "label": "Claude 2", "value": "44 %", "percent": 44, "tone": "warn" }] }] }
```

- `items[].scope`: `orch` = the same ask on every computer that reads the plans (shown once); `machine` = this
  computer's own (a waiting session). `host`: short name of the host whose lane it is about; the answer goes to that
  computer when it is online, else to the controller's.
- `items[].level`: `ask` (needs Kevin) · `warn` · `info`. `push`: also to his phone.
- `options[].yes`: what a plain "yes" means. At most one per item, never one that needs words.
- `options[].text: "required"`: Kevin answers in words (typed or by voice), at most 2000 characters.
- `options[].confirm`: said before the click counts.
- `events`: what got done. Each key reaches Lina once, whichever computer says it first.

## Built for what comes next

The apps draw `items`, `options`, `cards` and `events` as they come; they know no kinds. A new feature of Workbench or
orch shows up here **without a change in Agentic OS** as long as Workbench maps it:

| Plan (Hauptplan FAB) | becomes |
|---|---|
| CTH: start a Hauptplan with one click | an item `haupt-start` with option `start` (`yes`, `confirm` = phases and budget), and `go` per phase |
| CTR: reviews and escalations | an item `escalated` with `merge` (`yes`, `confirm`), `rework` (`text: required`), `reject` (`danger`) |
| CTK: accounts and routes | card `accounts` (percent rows, tone), card `routes`; switching a route is an item option |
| CTA: requests and learning | card `requests`, card `learning`; a finished request is an event |
| KTO: limits | card `accounts`; "all accounts closed" is an item with level `warn` |
| ANS: say something to a lane | nothing to do here; `reply` already exists for waiting sessions |

On the Workbench side the mapping lives in one place (`workbench-link.items.ts`, `optionsFor` and `runOption`): a new
`ControlAttention` action needs one entry there. Until it has one, the item still shows, without buttons.

## The apps' side (token scope `full`)

`GET /api/workbench/control` → `{ linked, lead, orch, machines, items, plans, hauptplaene, sessions, cards, decisions }`.
`items[].id` (`wbk_…`) stands for this item, this rev and this computer.
`POST /api/workbench/items/:id/decide { option, text? }` → `{ decision }`; `409` when it changed, is already on its way
or the computer is off.
