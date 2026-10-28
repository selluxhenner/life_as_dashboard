# LIFE OS hub API

The contracts this server `provides` in `hub.yaml`: `hub-state`, `ops-reports` and `approvals`, all version 1.0.0.
The consumer is Hermes, the ops agent on the agent box: its `server-ops` and `hub-status` skills, and
`agent-ops.sh` on the main server. Base URL `https://agentic-os.serviweb.ch/api` (on the server itself
`http://127.0.0.1:3160/api`). Every call needs `Authorization: Bearer <device token>`.

## Token scopes

| Scope | Who | May |
|---|---|---|
| `full` | the apps, the approvals relay | everything, including deciding approvals |
| `ops` | agent box (`agent-box`), main server (`main-server`) | post ops reports, ask for, read and consume approvals, read hub state (reduced) |

An ops token gets `403` on every other route. Neither ops token can approve or reject: only full-scope devices decide.
Tokens are paired with `POST /api/devices/pair {name, platform, scope}` (master token) and revoked with
`DELETE /api/devices/:id`.

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
  "at": 1793200000000
}
```

- `devices`: paired, not revoked, newest activity first. `online` means it checked in within 15 minutes.
  `current` marks the caller. `temporary` is true for browsers (platform `web`): the Hub lists them apart, leaves them
  out of the count, and each call revokes browsers that have been silent for two weeks.
- `ops`: the newest report of each job from the last 7 days, worst status first.
- `approvals`: only open ones (`pending`, not expired), newest first.
- `registry`: `projects.yaml` and `devices.yaml` from `selluxhenner/hub` with each service's last health check.
- **Ops token:** the same answer without `devices[].id` and without approval `id`, `decidedBy`, `decidedAt` and
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
