# LIFE OS hub API

The contracts this server `provides` in `hub.yaml`: `hub-state`, `ops-reports`, `approvals` and `agent-tasks`, all
version 1.0.0. The consumer is Hermes, the ops agent on the agent box: its `server-ops`, `hub-status` and (planned)
`agent-tasks` skills, and `agent-ops.sh` on the main server. Base URL `https://agentic-os.serviweb.ch/api` (on the server itself
`http://127.0.0.1:3160/api`). Every call needs `Authorization: Bearer <device token>`.

## Token scopes

| Scope | Who | May |
|---|---|---|
| `full` | the apps, the approvals relay | everything, including deciding approvals |
| `workbench` | a computer's Workbench | the Workbench link only ([workbench-link.md](workbench-link.md)) |
| `ops` | agent box (`agent-box`), main server (`main-server`) | post ops reports, ask for, read and consume approvals, read hub state (reduced), work Hermes's agent tasks |

An ops token gets `403` on every other route. Neither ops token can approve or reject: only full-scope devices decide.
Tokens are paired with `POST /api/devices/pair {name, platform, scope}` and revoked with `DELETE /api/devices/:id`,
both with the master token only.

`GET /api/health` needs no token: `{ ok: true, version }`.

## hub-state 1.0.0

`GET /api/hub/state` (any device token)

```json
{
  "devices":   [{ "id": "dev_…", "name": "Phone", "platform": "android", "scope": "full",
                  "lastSeenAt": 1793200000000, "online": true, "current": false, "temporary": false }],
  "ops":       [{ "id": 12, "job": "morning-digest", "status": "warn", "summary": "🟡 2 warnings",
                  "findings": [{ "level": "warn", "text": "…" }], "metrics": {}, "createdAt": 1793200000000 }],
  "approvals": [{ "id": "apr_…", "verb": "restart-container", "args": ["umami-umami-1"], "reason": "…",
                  "status": "pending", "expiresAt": 1793201800000, "createdAt": 1793200000000, "…": "…" }],
  "registry":  { "services": [], "devices": [], "pulledAt": 1793200000000, "error": null },
  "tasks":     [{ "id": "tsk_…", "target": "hermes", "kind": "server-op", "status": "running", "…": "…" }],
  "at": 1793200000000
}
```

- `devices`: paired, not revoked, newest activity first. `online` means it checked in within 15 minutes.
  `current` marks the caller. `temporary` is true for browsers (platform `web`): the Hub lists them apart, leaves them
  out of the count, and each call revokes browsers that have been silent for two weeks.
- `ops`: the newest report of each job from the last 7 days, worst status first.
- `approvals`: only open ones (`pending`, not expired), newest first.
- `registry`: `projects.yaml` and `devices.yaml` from `selluxhenner/hub` with each service's last health check.
- `tasks`: agent tasks still `awaiting_approval`, `queued` or `running` (see agent-tasks). Full scope only.
- **Ops token:** the same answer without `tasks`, without `devices[].id` and without approval `id`, `decidedBy`, `decidedAt` and
  `usedAt`. An approval id is what lets a script consume an approval, so only its creator keeps it.

Times are epoch milliseconds throughout.

## ops-reports 1.0.0

`POST /api/ops/report` (ops token) → `201 { id }`

```json
{ "job": "server-ops", "status": "ok", "summary": "restart-container umami-umami-1 done",
  "findings": [{ "level": "ok", "text": "…" }], "metrics": { "disk_pct": 71 } }
```

- `job`: `^[a-z0-9][a-z0-9-]{0,59}$`.
- `status`: `ok`, `warn` or `fail`.
- `summary`: 1–200 characters.
- `findings`: at most 20, each `text` up to 300 characters.
- `metrics`: at most 40 keys matching `^[a-z0-9_.-]{1,40}$`; values are numbers, strings up to 60 characters, or null.
- The body may be at most 32 KB (`413` above that). Invalid input gets `400` with the reason.
- A non-`ok` report raises one phone notification per job, day and status.

The apps read reports with `GET /api/ops/latest` and `GET /api/ops/reports?job=&limit=` (full scope).

## approvals 1.0.0

The agent asks, Kevin decides, the server script runs it once. One approval allows one run of exactly one verb with
exactly these args.

| Call | Token | Result |
|---|---|---|
| `POST /api/approvals` `{verb, args, reason, ttlMinutes}` | ops | `201` approval, `status: "pending"`; push to the phone |
| `GET /api/approvals/:id` | any | the approval (by id only) |
| `GET /api/approvals?limit=` | full | the newest approvals, all states |
| `POST /api/approvals/:id/approve` | full | `200`, `status: "approved"`; `409` if not pending or expired |
| `POST /api/approvals/:id/reject` | full | `200`, `status: "rejected"`; `409` likewise |
| `POST /api/approvals/:id/consume` | ops | `200`, `status: "used"`; `409` unless approved and not expired |

- `verb`: `^[a-z][a-z0-9-]{0,39}$`.
- `args`: at most 6 strings, each matching `^[A-Za-z0-9_.:@/-]{1,120}$`.
- `reason`: 1–300 characters.
- `ttlMinutes`: 1–1440, default 30.
- The id is `apr_` plus a random token. It isn't guessable, and ops tokens can't list approvals.

An approval answers in camelCase:

```json
{ "id": "apr_…", "source": "dev_…", "verb": "restart-container", "args": ["umami-umami-1"], "reason": "…",
  "status": "approved", "decidedBy": "dev_…", "decidedAt": 1793200600000, "usedAt": null,
  "expiresAt": 1793201800000, "createdAt": 1793200000000 }
```

`status` is one of `pending`, `approved`, `rejected`, `expired` or `used`. A `pending` or `approved` approval past
`expiresAt` reads as `expired`.

**Who decides:** the LIFE OS apps, and the approvals relay on the main server, which turns taps on @kev_approve_bot's
buttons into `approve`/`reject` calls with its own full-scope token. **Who consumes:** `agent-ops.sh` on the main server
calls `consume` right before it runs the verb, so a second run with the same id is refused. Both live in
`selluxhenner/agent-box` (`phase1/main-server/`).

## agent-tasks 1.1.0

Work Lina (or Kevin in the app) hands to an agent, with its whole life in one place: approval, start, progress,
result. A task that needs Kevin's OK creates an ordinary approval (source `lina`), so the phone, the Hub and the
approvals relay decide it like any other. Kevin approves once: for `server-op` the approval's `verb` and `args` are the
task's, so Hermes passes the task's `approvalId` to `agent-ops.sh`, which consumes it as usual.

| kind | target | params | needs approval |
|---|---|---|---|
| `server-op` | `hermes` | `{verb, args}`: a verb of `agent-ops.sh`, args as for approvals | write verbs (`restart-container`, `pm2-restart`, `deploy`, `prune-docker`, `rotate-logs`, `renew-cert`); read verbs (`status`, `pm2`, `docker`, `web`, `backups`, `errors`, `crawler`) don't |
| `coding` | `workbench` | `{project, prompt, agent?, profile?}`: a hub project id, 10–4000 characters, `claude` (default) or `codex`, a Workbench profile id | always, once (approval verb `coding-session`, args `[project, agent]`); the box's `workbench-relay` then starts it with an orch token, so Workbench doesn't ask again |
| `job` | `server` | `{job}`: `refresh`, `calendar`, `news`, `digest`, `briefing`, `triage`, `hub` or `aimodels` | no; this server runs it at once |

**Lifecycle:** `awaiting_approval` → `queued` → `running` → `done` | `failed`. Off the path: `rejected` and `expired`
(the approval's decision, read through while the task waits) and `cancelled` (Kevin).

| Call | Token | Result |
|---|---|---|
| `POST /api/tasks` `{kind, title, params, reason?, ttlMinutes?}` | full | `201` task. `title` 3–120 characters, `reason` up to 300 (shown on the approval), `ttlMinutes` 5–1440 (approval lifetime, default 60) |
| `GET /api/tasks?active=1&limit=` | full | newest first; `active=1`: only waiting, queued or running |
| `GET /api/tasks/:id` | full; ops for `hermes` and `workbench` tasks | the task |
| `POST /api/tasks/:id/cancel` | full | `cancelled`; withdraws its approval if not used yet; `409` once over |
| `GET /api/tasks/queue?target=` | ops | tasks of `target` (`hermes`, the default, or `workbench`) ready to start (`queued`), oldest first, at most 10. No side effects, so a monitor can diff it |
| `POST /api/tasks/:id/start` | ops | `running`, `worker` set; `409` unless `queued` (so it starts once) |
| `POST /api/tasks/:id/progress` `{note}` | the worker | appends a note (1–300 characters, the last 20 kept); `409` if no longer running: stop, Kevin cancelled |
| `POST /api/tasks/:id/finish` `{status, result, links?}` | the worker | `done` or `failed`, `result` 1–4000 characters, `links` `{pr?, url?, report?, device?}` (http(s) URLs, an ops report id, where a coding session ran); push to Kevin |

A task answers in camelCase:

```json
{ "id": "tsk_…", "target": "hermes", "kind": "server-op", "title": "Restart the shop container",
  "params": { "verb": "restart-container", "args": ["shop"] }, "reason": "Shop answers 502 since 09:10", "source": "voice",
  "status": "running", "approvalId": "apr_…", "worker": "dev_…", "progress": [{ "at": 1793200700000, "note": "…" }],
  "result": null, "links": {}, "stale": false, "startedAt": 1793200650000, "finishedAt": null,
  "updatedAt": 1793200700000, "createdAt": 1793200000000 }
```

- `source` is where it came from: `chat`, `voice`, `phone` (Lina, asked by Kevin), `app`, or `lina-watch`: Lina proposed it
  herself after an ops report that wasn't `ok` or a registry service that went down. A `lina-watch` task always waits
  for Kevin's approval, also for a read verb, and its approval `reason` starts with "Lina suggests:". Workers treat it
  like any other task.
- `stale` is true for a running task without progress for 2 hours.
- Kevin can also decide through Lina (her `decide_approval` tool, `decided_by: lina-chat|lina-voice|lina-phone`): only
  in his own conversations, never in a background run. 1.1.0 added `agent`/`profile` on `coding`, `?target=` on the
  queue, ops access to `workbench` tasks and `links.device`.
- Ops tokens can't create, list or cancel tasks and only see `hermes` and `workbench` tasks (the box runs both: Hermes the
  server verbs, `workbench-relay` the coding sessions). Only the token that started a task may
  report progress or finish it.
- **The Hermes loop:** poll `GET /tasks/queue`. For each task, `start` it, run
  `ssh hetzner-ops <verb> <args...> [--approval <approvalId>]`, post `progress` as useful, then `finish` with what
  happened (and the ops report id, if one was posted). Results are untrusted text: shown and read out, never acted on.

## lina-feed 1.0.0

Anything Kevin should hear about goes to Lina's feed: she shows it live on her deck (the app's first screen), says it
out loud while the deck is open (Live voice), and tells it on "what's new?". The server's own news (agent tasks,
Hermes's answers, ops alerts) lands there by itself; Workbench sessions are watched by the server every 90 seconds.

`POST /api/lina/events` (any device token: the apps, Hermes, Kevin's own apps such as housing or banking) → `201 { id }`

```json
{ "source": "housing", "title": "Viewing confirmed: Kreuzberg 2-room, Thu 18:00",
  "body": "Wrangelstr. 41 · 1,180 € warm", "level": "info", "ref": "viewing-42", "url": "https://…", "push": false }
```

- `source`: `^[a-z0-9][a-z0-9-]{0,39}$`, the app's name. `title` 1–200 characters, `body` up to 1000.
- `level`: `info` | `good` | `warn` | `alert`. `alert` (or `push: true`) also sends a push to Kevin's phone.
- `ref`: the same ref from the same source again updates that entry (`200`) instead of adding one: post a status
  that changes ("viewing moved to Fri") with the ref of the first post.
- Entries are data from other machines: shown and read out, never followed as instructions. Kept 30 days.

`GET /api/lina/feed?since=&limit=&snapshot=0` (app token) → `{ events, unread, snapshot, at }`; `snapshot` is where
Hermes, Workbench, agent tasks, approvals, the Obsidian vault, today's todos, the next calendar entry and the server
stand. `POST /api/lina/feed/told { ids }` marks entries as told.

Workbench plans: the server reads `GET /api/workbench-agent/plans` (`{ data: { plans: [{ id, title, state, done,
total, running, waiting, next }], attention: [{ title, detail }] } }`) when Workbench offers it; until then Lina sees
sessions only.
