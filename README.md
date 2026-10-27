# Agent Harbor

A local monitor for your AI work sessions. Each observed session gets a boat in your harbor; open it to follow its terminal-style event history and see when it requests attention or finishes a response.

Agent Harbor is an early learning project built with React, TypeScript, and Vite. It uses lifecycle hooks for Claude Code and Codex, with an experimental cache observer for Claude Desktop. Browser alerts include optional sound, desktop notifications, and a tab indicator. Automatic discovery of running sessions and orchestration are future work.

## What you can see

- A harbor of session boats, labeled with saved session names, platforms, and available project labels.
- Orange dots for input requests/errors and blue dots for ready responses, based on the latest received event.
- Click a boat for its session history, or open **Event log** for the complete retained stream.
- Clear individual boats until their next event arrives.
- Counts based on the boats currently in view.
- Text search and an Attention filter for input requests and errors.
- Pause/resume and Clear view controls.
- The latest 500 signals in the live view, plus persistent, paged signal history.
- Notification settings for event types, sound/volume, desktop alerts, tab indicators, and background-only delivery.

| Integration                   | Session startup | Prompt submitted | Permission requested | Structured question | Response finished |
| ----------------------------- | --------------- | ---------------- | -------------------- | ------------------- | ----------------- |
| Claude Code                   | Yes             | Yes              | Yes                  | —                   | Yes               |
| Codex                         | —               | Yes              | Yes                  | —                   | Yes               |
| Claude Desktop (experimental) | —               | —                | —                    | Cache observation   | Cache observation |

Claude Code and Codex have user-level installers, so you can connect local sessions across projects without adding Harbor scripts to each repository. Codex delivery has been exercised in the CLI, VS Code extension, and desktop app. Hook availability depends on your installed client and version. The installers target macOS/POSIX shells; Windows setup is not supported yet.

## Quick start

Requires npm and Node.js **20.19+ on the 20.x line, or 22.12+**. Connecting an agent also requires that agent's hook support.

The dashboard and Wi-Fi server use portable Node.js/browser APIs and should also run on Linux and Windows, but the current setup has only been tested on macOS. The hook installers require a POSIX shell; native Windows hook setup is not supported. The experimental Claude Desktop observer is macOS-specific. Viewing Harbor from another device only requires a browser, regardless of that device's operating system.

```sh
git clone https://github.com/AdrianusVieira/Agent-Harbor.git
cd Agent-Harbor
npm ci
npm run dev
```

Open <http://127.0.0.1:5173>. `npm run dev` starts one server for both the host computer and devices on the same trusted Wi-Fi. On macOS it also starts the experimental Claude Desktop observer; Ctrl+C stops both. The same server serves the UI and receives events; all addresses share its event history. Keep it running while monitoring sessions. A fresh data directory starts empty until a connected agent sends something; later starts restore saved signals.

### Local login

Open <http://127.0.0.1:5173> on the computer running Harbor to create the first
username and password. Use a username of 3–80 letters/numbers/dots/dashes/underscores
and a password of at least 12 characters. This is one Harbor login for the entire
local dataset; the telemetry Accounts page still describes agent account usage.
After setup, sign in with the same login through the Wi-Fi URL on another device.
Authenticated Wi-Fi users can now read account emails and captured sanitized
prompt text. There is no localhost-only restriction after signing in.

Browser APIs, saved history, network URLs, and the live SSE stream require a valid
session, including on localhost. Before credentials exist, data access stays
locked; first-account creation requires a same-origin request on localhost.
Sign out in the sidebar (or top bar when the sidebar is hidden). Expired/revoked
sessions cannot read new API data or receive new stream events; the UI returns to
login when it observes invalidation. A suspended/offline browser may retain an
already rendered page until it resumes.

Login data lives in private `data/auth.sqlite3`, beside the telemetry and signal
databases. The password uses a random salt and Node's asynchronous scrypt; plaintext
passwords are not stored. Random sessions last 12 hours, persist through server
restarts, and are stored as token hashes. Cookies are HttpOnly and SameSite=Strict;
they use Secure when served directly over HTTPS. The app stores no passwords or
session tokens in localStorage. Login work and attempts are bounded, and Origin,
Host and actual socket-peer checks protect setup and browser requests. See
[Node crypto](https://nodejs.org/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback)
and [OWASP session guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

To recover a forgotten login, run on the Harbor computer:

```sh
npm run auth:reset
```

Use the same `HARBOR_DATA_DIR` as the server if customized. Reset removes only the
Harbor login and its sessions, preserving telemetry, lifecycle history and browser
preferences. Reopen localhost to create a new login. There is no remote reset or
public account registration.

The existing HTTP Wi-Fi connection is **not encrypted**: credentials and cookies
can be observed by someone able to inspect that network traffic. Use only trusted
networks; this feature does not configure HTTPS or make Harbor suitable for public
internet exposure. Login controls HTTP access; it does not encrypt the SQLite files
or stop other programs running as your OS user from reading them.

Agent collection remains independent of browser login. Only existing loopback
command senders without a browser Origin may POST to the exact event/tool-return
endpoints. OTLP collectors keep their existing loopback-only restrictions. Logging
out, waiting to set up credentials, or resetting the login does not stop collection
or change agent hooks, exporters, permissions, or trust.

### Workspace navigation

The sidebar has two sections, each with three separate pages:

| Section | Pages |
| --- | --- |
| Harbor | Dashboard · Signal History · Notification Settings |
| Telemetry | Dashboard · Sessions · Accounts |

Harbor's Dashboard contains live boats and their logbooks. Signal History pages
through saved lifecycle events. Notification Settings contains notification
controls and Wi-Fi access. Telemetry's Dashboard contains usage totals and trends;
Sessions provides search and session details; Accounts shows Claude account usage after login. Accounts has no Codex attribution because those records do not
supply it. Each telemetry page requests only the data it displays.

Hide/show sidebar is saved per browser origin. On small screens both labeled
groups remain visible above the page. Routes support reload and Back/Forward:
`#/harbor/dashboard`, `#/harbor/signals`, `#/harbor/notifications`,
`#/telemetry/dashboard`, `#/telemetry/sessions`, and `#/telemetry/accounts`.
Source-scoped session links remain supported, including older bookmarks. One live
SSE subscription stays mounted across all pages, so navigation does not stop
collection or alerts.

### Local telemetry and saved history

Harbor now collects Claude Code and Codex telemetry in the same process as its
hook receiver and Desktop observer. Use **Harbor → Dashboard** for live boats. Under **Telemetry**, Dashboard shows source totals and the cumulative token chart, Sessions provides search and per-session tokens, request timing, prompts, and tool activity, and Accounts shows Claude account usage. Date filters apply to the displayed page. **Usage & history**
on a boat opens that exact source/session. **Signal history** pages through saved
lifecycle events. Imported usage does not create boats, change their status, or
trigger notifications.

The collector and usage-aggregation code is adapted from the sibling telemetry dashboards as consolidated in Minecode. Harbor does not depend on those checkouts at runtime.

The local-only OTLP HTTP/JSON receivers are:

| Source | Endpoint |
| --- | --- |
| Claude Code | `http://127.0.0.1:4318/v1/metrics` and `/v1/logs` |
| Codex | `http://127.0.0.1:18766/v1/logs` |

Stop Minecode and the standalone telemetry dashboard servers before starting
Harbor: they use the same telemetry ports. Existing exporters targeting those
addresses require no endpoint changes. A port conflict stops Harbor with an
explanation and releases any partially opened listeners. Ctrl+C closes the
collectors, SSE clients, Desktop observer, timers, and databases together. Vite
configuration restarts also release the old collectors before listening again.
No detached process, login service, or new hook registration is installed.

For Claude Code, telemetry must already be enabled using
`CLAUDE_CODE_ENABLE_TELEMETRY=1`, `OTEL_METRICS_EXPORTER=otlp`,
`OTEL_LOGS_EXPORTER=otlp`, `OTEL_EXPORTER_OTLP_PROTOCOL=http/json`, and
`OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318` in its launch environment or
supported user settings. A `project.id` resource attribute or supported repository
metadata supplies telemetry project labels. For Codex, the user-level `[otel]`
configuration must use an `otlp-http` exporter with
`endpoint = "http://127.0.0.1:18766/v1/logs"` and `protocol = "json"`.
Changing exporter settings requires the client's normal reload/restart; Harbor
never edits permission or trust settings. The hook installers configure lifecycle
signals only, not OTLP exporters.

History lives in Git-ignored `data/claude.sqlite3`, `data/codex.sqlite3`, and
`data/signals.sqlite3`, plus `data/auth.sqlite3` for the local login. Set `HARBOR_DATA_DIR` consistently for import and startup
to use another dedicated directory. The directory is private (0700) and databases
are private (0600). Vite denies serving database files and the data directory.
History is retained until you remove/archive it; there is no automatic age-based
pruning in this version. Stop Harbor before backing up, moving, or deleting its
storage. Do not delete SQLite WAL/SHM sidecars while a database is open.

To merge history from sibling Minecode and both standalone dashboards, stop
Harbor and run:

```sh
npm run telemetry:import
npm run dev
```

Import uses consistent SQLite snapshots, merges existing record fingerprints to
avoid counting overlapping copies twice, keeps the newest saved Claude titles,
and honors deletion markers. Repeating it is safe. Original databases remain
untouched and temporary snapshots are removed, including on failure. The importer
uses those repositories' default `data/` locations; custom legacy locations need
a separate migration. Fresh collection does not require the sibling checkouts.
Harbor restores only its latest 500 saved signals to the live stream; older
signals remain available in Signal history. Historical snapshots stay silent.
Pending approval fingerprints are not persisted, so a restart cannot resolve an
old permission wait using its old fingerprint. The next lifecycle signal can
replace that historical status.

**Data boundary:** telemetry is richer than Harbor's hook messages. The collectors
allowlist usage fields and never store raw OTLP bodies, response text, tool
arguments/results, or error details. They can store sanitized prompt text if the
agent exports it. Claude's `OTEL_LOG_USER_PROMPTS=1` and Codex's
`log_user_prompt = true` enable prompt export; leave them off to avoid capturing
future prompt text. Sanitization is best effort and cannot guarantee complete
redaction. Claude records can also contain account emails. Protect backups like
the databases themselves.

Authenticated browser clients can read usage summaries, session metadata, generic
activity, saved lifecycle signals, account emails and sanitized prompt text, both
on localhost and over Wi-Fi. Unauthenticated browser API requests return 401.
No new transcript/title scanners are installed. New session labels come
from existing hook metadata; imported explicit Claude titles remain available.
Telemetry-only sessions stay in Telemetry until hooks supply lifecycle signals.
Claude Desktop has no usage collector here.

Claude costs are estimates and may be partial; active time is available only when
reported. Codex cost and active time remain unavailable. Cached input and reasoning
output are subsets, not extra tokens to add again. Telemetry delivery is batched,
so it is not a replacement for hook-based waiting/ready transitions. Usage and
session lists refresh every 15 seconds while the telemetry view is open. Session
details are snapshots; returning to the list and reopening refreshes them. Historical
queries run in a read-only worker thread so they do not block lifecycle delivery.
The worker and its bounded caches close with Harbor; no child server is spawned.

### View on a phone over Wi-Fi

With `npm run dev` already running, connect your phone to the same trusted Wi-Fi as the host computer. Open the `Network` URL printed at startup, such as `http://192.168.1.20:5173`, in your phone's browser. No second server or environment is needed. The dashboard adapts to small screens and shares the host's live event history. Boat dismissals and view controls belong to each browser. Keep the host awake and Harbor running; restarting the server restores the latest saved signals. Pending permission matching remains memory-only. `npm run dev:lan` remains an alias for the same startup mode.

In **Harbor → Notification Settings**, the **Open on another device** panel also shows the host's current private IPv4 URLs, with a Copy button. Addresses refresh every 30 seconds and when the page regains focus. It uses the server's listening port and network interfaces; it does not test whether another device can connect. Multiple local interfaces can produce multiple addresses. Loopback-only mode does not advertise a Wi-Fi URL.

All startup commands use port **5173** and check for an existing local listener before starting, in addition to Vite's strict-port setting. Stop the running server before switching modes; running a local-only and Wi-Fi instance together can split hook delivery and browser history on systems that allow overlapping network bindings. The host's Wi-Fi IP address can change. If an old phone link stops working, open Harbor locally on the host computer to find the updated URL.

The default command listens on all IPv4 interfaces. Devices that can reach that port must sign in before viewing session names, events, or telemetry. Use it only on a trusted local network, without public port forwarding. Event submissions remain restricted to loopback connections, so existing local observers need no changes. For access from the host computer only, stop the server and run `npm run dev:local`. If the phone cannot connect, check the host firewall and whether the Wi-Fi isolates devices from one another.

### Connect Claude Code

From the Harbor checkout:

```sh
npm run hooks:preview
npm run hooks:install
```

This installs six background handlers in `~/.claude/settings.json`: `SessionStart` (startup), `UserPromptSubmit`, `PermissionRequest`, `PostToolUse`, `PostToolUseFailure`, and `Stop`. The two tool-return handlers only help clear matching permission waits; ordinary tool results do not add events to the log. If `CLAUDE_CONFIG_DIR` is set, setup uses `settings.json` in that directory instead.

Open a fresh local Claude Code session to load the hooks. Complete any normal trust prompts in Claude Code. For custom labels, give your session a name with `/rename` where supported.

See the [Claude Code hook reference](https://code.claude.com/docs/en/hooks) for event behavior and client requirements.

### Connect Codex

From the Harbor checkout:

```sh
npm run hooks:codex:preview
npm run hooks:codex:install
```

This installs four background observers in `~/.codex/hooks.json`: `PermissionRequest`, `PostToolUse`, `Stop`, and `UserPromptSubmit`. If `CODEX_HOME` is set, setup uses `hooks.json` in that directory instead. `PostToolUse` only helps clear matching permission waits; ordinary tool returns do not add events to the log.

Open the Codex CLI and run `/hooks`. Review and trust the Harbor commands from the **user-level** hook file, including `PostToolUse` when upgrading an older installation. New or changed definitions require Codex's normal trust review before they can run; installation does not grant trust or change feature flags. Then open a fresh local session in your chosen client.

See the [Codex hook reference](https://learn.chatgpt.com/docs/hooks) for hook availability, configuration, and trust controls.

### Experimental Claude Desktop observer

This experimental macOS observer reports structured input requests and response completion from supported Claude Desktop cache records. These records use a generic `chat` classification; the observer cannot reliably distinguish Cowork tasks from ordinary chats. Events therefore use source **`claude-desktop`**.

On macOS, `npm run dev`, `npm run dev:lan`, and `npm run dev:local` start the observer automatically after the receiver begins listening. It runs inside Harbor's process and stops when Harbor closes; configuration restarts stop the previous observer before starting a new one. No second terminal is needed. Other operating systems run the dashboard without this macOS observer. If the cache is missing or unsupported, Harbor stays available and the observer reports a warning and retries.

Wait for **baseline loaded** in Harbor's terminal, then send a new prompt in Claude Desktop. A newly cached response whose active assistant message has `stop_reason: end_turn` can produce **reply ready**. If that active reply contains a successful `ask_user_input_v0` call, it produces **needs input** with the fixed message “Claude Desktop asked for input.” instead. A later completed reply without another structured question produces **reply ready**. Old questions in earlier messages are ignored. Existing history is ignored at startup, and renaming or rereading a response does not send another event. Press **Ctrl+C** in Harbor's terminal to stop the server and observer together; nothing is installed in Claude settings or registered to start at login.

Structured questions are observed requests for input, not tool-permission gates or an explicit live “unanswered” flag. The observer does not interpret ordinary chat text as a question or detect the instant you select an answer. It can remain **needs input** until the following response finishes. Live **needs input → reply ready** delivery has been verified for a named conversation; Skip/cancel behavior remains unverified. If a later cache write adds a question to the same response, **needs input** takes priority and that response cannot switch back to ready; a new response is required.

The observer polls once per second, but delivery depends on when Desktop saves its cache. Live delivery has been verified for a named Desktop conversation, including a user-run minimized-window check. Coverage beyond those checks remains experimental. It does not observe prompt submission, processing, approval requests, or the instant a response becomes visible. A submitted prompt can appear in the supported cache only after its response finishes, so a newly cached human message is not a reliable live **working** signal. To reject late-loaded history, it checks the message's `updated_at`, falling back to `created_at` when the update timestamp is absent. These dates do not establish completion; `end_turn` does. Starting the watcher after a response has begun can miss that response if its stored message timestamp predates the baseline.

The default source is `~/Library/Application Support/Claude/IndexedDB/https_claude.ai_0.indexeddb.leveldb`. `CLAUDE_DESKTOP_CACHE_DIR` overrides the directory. Account switching and other account/profile cache layouts are not verified. Harbor's integrated observer always uses its own listening port. For a baseline-only check that sends no events:

```sh
npm run watch:claude-desktop -- --once
```

The standalone `npm run watch:claude-desktop` command remains available for diagnostics against a separately managed receiver, with `HARBOR_PORT` overriding its destination. Do not run it alongside Harbor's integrated observer for the same cache; both could send the same events.

Compatibility is intentionally limited to inline conversation records in numbered LevelDB `.log` files, Blink serialization version 21, and supported V8 15/16 values. The reader checks fragment checksums and tolerates incomplete tails without opening the database through LevelDB or modifying it. Compacted `.ldb` files, external/compressed blobs, and unsupported values are not decoded; a warning means coverage is incomplete. Limits are 8 MiB per log, 32 MiB total, and 32 logs. Missing/corrupt logs pause reading; a detected sequence reset or gap establishes a fresh baseline without replaying history. Intermediate responses can be missed between snapshots.

**Privacy:** the cache contains conversation content. The observer decodes supported records in memory, extracts only IDs, saved names, and response/question-request metadata, and sends the same minimal event fields as the other adapters. It does not save cache copies to disk or log/forward prompt/response text, question/answer text, choices, or tool arguments. It keeps only bounded observation identities in memory between scans. Receiver failures have a timeout and are not retried. The prototype uses no screenshots, Claude credentials, private network APIs, or changes to permissions.

### Check the connection

With Harbor running, open a fresh agent session in another local repository and send:

> Without using tools, reply only with: Harbor connection check complete.

Look for **working**, followed by **reply ready**, for the same source and session. Claude Code also reports **started** on startup. Async delivery can be delayed or arrive out of order; a short response may finish before you notice the working event.

## How installation works

Preview prints Harbor's proposed commands without writing files. Installation preserves unrelated settings and hooks, makes a private backup before replacing an existing configuration file, and does not add duplicates when repeated. Malformed configuration stops setup without overwriting the file.

Commands use absolute paths to the Node executable used during setup, this checkout's local `tsx` dependency, and the observer scripts. Other projects need no Harbor dependencies. **Keep this checkout, its dependencies, and that Node executable available.** Reinstall if you move the checkout or replace the Node installation.

Setup and uninstall manage only command handlers ending in ` # agent-harbor`. They do not change agent permissions or approve requests. Remove any older project-local Harbor registrations when migrating to user-level hooks: both scopes can run and produce duplicates. The installers do not edit other repositories.

To remove the user-level observers, run the relevant command from this checkout:

```sh
# Claude Code
npm run hooks:uninstall

# Codex
npm run hooks:codex:uninstall
```

Uninstall preserves unrelated settings and hooks. Backups stay beside the corresponding user configuration file. Open fresh agent sessions after configuration changes.

## Reading the stream

The home view groups received events by source and session ID, showing one boat per session in alphabetical name order. Click a boat to open its terminal history, or choose **Event log** to browse all retained events. **Back to harbor** returns to the boats.

When available, **Project · name** appears beneath the platform. Claude Code and
Codex use only the final folder name from the hook's working directory, never
the full path. This is a working-folder label, not a verified repository name or
the Codex app's custom project title. Other senders can supply an explicit
`projectName`; the Desktop cache observer currently supplies none. Missing
metadata leaves the line out. The receiver retains the latest known project
label per source/session in local storage, and terminal search also
matches it. Existing boats gain the label on a new event carrying this metadata.

Project-label delivery and retention have been checked with isolated hook and
receiver fixtures. Live client delivery and the rendered boat layout have not
yet been verified for this addition.

An orange dot marks a latest **needs input** or **error** event; a blue dot marks **reply ready**. Other statuses have no colored dot. Status text accompanies the colors. These are the latest observed signals, including when the receiver is offline; they are not proof of current processing or overall task completion.

Returning to the tab, restoring the page, or reconnecting the network while Harbor is visible requests a fresh receiver snapshot. The connection indicator shows **Connecting…** until that snapshot arrives. This helps recover from stale browser connections after backgrounding; it cannot recover events the receiver never received or events that arrived while Harbor was stopped.

Claude Code and Codex boats gently sail when their latest signal is **working** and the receiver is connected. The boat and water settle when that status changes or the connection drops. Reduced-motion preferences disable the animation. Desktop/Cowork boats stay still because working detection is unsupported there.

Use the **×** on a boat to clear it from the harbor. It stays hidden across reloads and reconnects until a new event arrives for that same source and session ID. Clearing a boat does not delete its history. The browser stores up to 500 dismissal markers (source/session IDs and last-event IDs) locally; if browser storage is unavailable, dismissal lasts only for the page visit. Clearing site data resets these markers.

| Label           | What was observed                                                                              |
| --------------- | ---------------------------------------------------------------------------------------------- |
| **started**     | A Claude Code session started.                                                                 |
| **working**     | A prompt was submitted, or a Claude Code/Codex tool returned after a matching permission wait. |
| **needs input** | An agent requested tool permission, or Desktop presented a structured question.                |
| **reply ready** | The agent finished its current response.                                                       |

**Reply ready means a response is available, not that the overall task is complete.** Individual tool successes and failures are intentionally excluded. The event contract also accepts `error` and `ended`, but the bundled observers do not currently emit them.

A permission request can be handled by automatic review without a human prompt. Harbor does not detect the instant of approval, denial, or cancellation. For Claude Code and Codex, a matching tool return clears the observed permission wait; when no other tracked or ambiguous wait remains, Harbor emits **working** and removes the orange dot. Claude Code observes both successful and failed tool returns, excluding interrupted failures. These continuation messages are permission-state transitions; ordinary tool results stay out of the log. **Reply ready** still comes only from response completion. Approval stays in the originating agent.

Codex interactive question forms are not currently monitored. Asking the user a question is a separate interaction from requesting tool permission, so it may not produce a **needs input** event. A boat can therefore retain its earlier working signal while such a question is open.

Request/return matching uses an opaque SHA-256 fingerprint of session, prompt ID (Claude Code) or turn ID (Codex), canonical tool name, and shared tool-input metadata. The receiver keeps each source's pending waits separate, and fingerprints do not appear in event history. Matching is best effort: missing metadata, identical overlapping calls, lost or out-of-order hook delivery, or a receiver restart can leave a wait unresolved until another lifecycle signal. Claude Code runtimes that omit `prompt_id` retain the wait until another lifecycle signal. A long-running approved command can keep the orange dot until it returns. There is no timeout-based clearing or per-tool completion/error feed. Desktop/Cowork keeps its existing waiting-to-ready behavior.

For Claude Code's `AskUserQuestion`, the fingerprint uses the question
definitions from `tool_input.questions`, excluding answers, annotations, and
other fields added during the interaction. A matching tool return can then
resolve its tracked wait without hiding a separate pending permission. This
answer-enrichment case is covered by isolated adapter/receiver regression tests.
A live Claude Code question → matching tool-return working → reply-ready
sequence has also been observed at the receiver, with the wait resolved before
response completion. Exact browser presentation timing, Skip/cancel, and
interruption behavior remain unverified. Past returns are not replayed to clear
an existing wait.

The stream is a history of observations. A quiet session is not proof that it stopped or is stuck, and counts are not a complete inventory of running agents. The terminal's Attention filter includes historical waiting/error events, even if a later event changed that session's status. Boat dots and summary counts use each visible boat's latest event.

**Pause** freezes the displayed terminal history while events continue to arrive, within the retained buffer. Its pending count covers the selected session, or all sessions in **Event log**. **Clear view** hides the current terminal's history in this page visit; it does not clear boats or delete receiver history. Reloading restores retained events. Restarting the development server clears the receiver's history.

### Session names

Sessions are identified by **source + session ID**, so matching names do not merge sessions. Search accepts names and IDs; hovering over a name reveals its ID.

- **Claude Code:** forwards explicit custom `session_title` metadata from startup and prompt-submit hooks. Automatically generated titles are not included by this adapter.
- **Codex:** reads the matching saved `thread_name` from `session_index.jsonl` under `CODEX_HOME` or `~/.codex`. This includes custom renames and may include generated names. The file is read-only and is an internal Codex format, so compatibility may change.
- **Claude Desktop prototype:** reads the cached conversation's saved `tree.name`. It does not generate a name from message text.

Missing name metadata never blocks event delivery. A newly created session may show its ID before a name is saved; Codex names are checked once per event without waiting or retrying. Subsequent events can carry the name, and the receiver retains known names in local storage. Historical rows keep their earlier labels.

### Notifications

Open **Harbor → Notification Settings**, below the Wi-Fi panel. Sound and desktop alerts start off; the tab indicator starts on. Choose **Needs input / error** and/or **Reply ready**. By default, sound and desktop alerts run only when that Harbor tab is in the background; turn off **Sound and desktop only in background** to receive them while viewing it too, including when keeping Harbor visible on a phone as a second screen. **Test sound** plays a preview regardless of the sound/background switches; its result explains whether live alerts are enabled or muted by those settings. Pausing the terminal does not pause alerts.

- **Sound:** enable **Play a chime**, choose the volume, and use **Test sound**. Each chime has three spaced notes over about 0.9 seconds, rising for reply-ready and falling for attention. After opening or reloading a tab, browsers may require another click: the panel shows **Sound needs a click** with **Enable sound in this tab**. Live alerts try to resume a context you already activated; browser rejection or a stalled resume stays quiet and is reported. **Last live sound** explains foreground muting, disabled event types/volume, browser audio blocking, another tab's claim, or catch-up after reconnect. A link in Sound jumps to the background-only setting under Behavior. Sound is generated locally; no audio files or external service are used. Bursts are coalesced into one chime.
- **Tab indicator:** new qualifying live events while you are away update the title, such as **(2) Agent Harbor**, and the favicon (orange for attention, blue for replies). The count is sessions with unseen alert events in that tab, not the harbor's total attention count. Returning to the tab clears it; later working/ended signals or reconnect snapshots can also resolve it. Browsers control whether they display favicons.
- **Desktop notifications:** enable the checkbox to request browser permission, then use **Test desktop notification**. Clicking a session notification focuses Harbor and opens that source/session's log. The alert contains the platform and saved session name (or short ID), plus a fixed status; event message details are excluded. System notification permissions and Focus/Do Not Disturb still apply. A test confirms a display request, not a guarantee that the OS presented it.

Desktop notifications require a supported browser in a secure context: use `http://127.0.0.1:5173` or `http://localhost:5173` on the host computer, or trusted HTTPS. Plain HTTP through a Wi-Fi IP does not qualify, even on the host; that address still supports in-page sound and tab indicators. Mobile desktop-notification support varies. Harbor does not currently include a service worker, HTTPS setup, Home Screen installation, or Web Push.

Only new live status transitions alert. Startup/reconnect snapshots, duplicate IDs, and repeated same-status events in the same session stay quiet. Settings changes do not replay old events. Alert claims are coordinated between tabs at the same browser address with Web Locks and browser storage where available. Without those facilities, deduplication is best effort; use one Harbor tab to avoid repeated alerts. Different origins (for example `localhost` versus `127.0.0.1`), browser profiles, and devices are independent.

Settings persist per browser origin and sync between its open tabs; audio activation is per tab. Up to 500 event-ID/channel claims are retained locally to reduce duplicate alerts, without saving event content. If storage is unavailable, settings and deduplication fall back to this page visit. These are page-driven alerts: Harbor must remain open and connected. Closing or suspending the page, stopping the host server, or losing delivery can prevent alerts; missed snapshots are not replayed as notifications. On phones, background audio or page execution can pause despite sound permission; use a visible Harbor page for testing foreground chimes. A boat updating on return alone does not prove background delivery. Existing observer coverage limits still apply.

## Privacy and limits

The bundled observers send the source, session ID, optional session name and project label, event type, and a fixed message. Permission messages also include the tool name. They do not forward prompt text, response text, raw tool arguments, tool output/error details, transcript content, model details, or full working-directory paths. Coding-agent hooks select only the final working-folder name for the optional project label. Claude Code and Codex permission/return observers additionally send an opaque matching fingerprint to the loopback receiver, derived in memory without persisting the input. This fingerprint is not encryption or anonymization. It and the bounded pending-wait state stay out of the browser's event stream. Session names and project labels are displayed in Harbor, so their contents are part of the monitoring data.

Events go to the local loopback receiver. The observers emit no context or approval decisions; delivery failures exit normally so an unavailable Harbor receiver does not block an agent. Events are not queued or retried while Harbor is offline.

The receiver has **no authentication** and is intended for local development on a trusted network. The default `npm run dev` enables local and same-Wi-Fi viewing; `npm run dev:local` binds only to `127.0.0.1`. Event submissions require a loopback connection in either mode. It is not a hosted monitoring service. Hook setup applies to local clients using the configured agent home, not remote sessions, cloud environments, or other machines.

Lifecycle signals and allowlisted telemetry now persist in local SQLite databases. There is no installed background service, screen capture, dedicated Cowork hook integration, or Web Push delivery. Boat-dismissal markers, notification preferences, and bounded event-ID/channel alert claims persist in browser storage. The experimental Desktop observer has the narrower coverage described above.

## Troubleshooting

| Symptom                                         | Check                                                                                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| No events                                       | Keep `npm run dev` running on port 5173. Resume the view, clear search, and select All events. Open a fresh agent session after installing hooks. |
| Codex hooks are skipped                         | Use `/hooks` in the CLI to review the user-level definitions. Check your client's hook support and any startup warning.                           |
| One client misses events after setup            | Finish active work, restart that client, and open a fresh local session. Clients may retain earlier configuration.                                |
| Duplicate events                                | Check for older Harbor registrations in project-local settings alongside the user-level hooks.                                                    |
| IDs appear instead of names                     | Set a custom session name where supported and submit another prompt. Missing or late metadata falls back to the ID.                               |
| Hooks fail after moving Harbor or updating Node | Run the installer again to refresh absolute paths.                                                                                                |
| Static preview shows no live events             | `npm run preview` serves the production UI only. The receiver runs with `npm run dev`.                                                            |
| Sound is enabled but silent                     | Click **Enable sound in this tab** or **Test sound**, raise the volume, and check the background-only setting and system audio. |
| Desktop notifications unavailable or blocked    | Open Harbor through localhost on the host computer, enable browser permission, and check system notification settings. The HTTP Wi-Fi address cannot enable desktop alerts. |

Observers default to port **5173**. `HARBOR_PORT`, when inherited by the agent process, overrides their destination port; it must match the development server. Setting it does not change Vite's listening port.

## Development

```text
agent hook → observer → POST /api/events → SQLite + bounded live buffer → SSE → React UI
agent OTLP exporter → loopback telemetry receiver → SQLite → telemetry views
```

Tool-return observers instead post minimal matching metadata to `/api/codex/tool-returned` or `/api/claude-code/tool-returned`. The receiver publishes an activity event only when a matching pending permission group clears; ordinary or unrelated returns produce no history entry.

React and plain CSS provide the monochrome terminal interface. A small Node HTTP middleware in Vite validates events and streams them with Server-Sent Events. SQLite stores local lifecycle and telemetry history through better-sqlite3. No cloud service is involved.

| Path                                       | Purpose                                                          |
| ------------------------------------------ | ---------------------------------------------------------------- |
| [`scripts/`](scripts/)                     | Agent observers, hook installers, and isolated integration tests |
| [`server/receiver.ts`](server/receiver.ts) | Event validation, persistent signals, and bounded SSE delivery |
| [`scripts/telemetry-plugin.ts`](scripts/telemetry-plugin.ts) | Owns stores and receivers through listen, restart, and close |
| [`server/telemetryApi.ts`](server/telemetryApi.ts) | Usage summaries, session details, accounts, and saved signals |
| [`src/TelemetryPanel.tsx`](src/TelemetryPanel.tsx) | Usage history, date filters, charts, and session details |
| [`src/App.tsx`](src/App.tsx)               | Event stream and browser controls                                |
| [`src/events.ts`](src/events.ts)           | Shared event types and labels                                    |
| [`src/styles.css`](src/styles.css)         | Design tokens and responsive layout                              |
| [`vite.config.ts`](vite.config.ts)         | Development receiver wiring                                      |

Useful checks:

```sh
npm run typecheck
npm test
npm run build
```

Tests use temporary configuration files and isolated receivers. They make no model calls and do not send synthetic events to your running Harbor instance. `npm run build` checks types and creates the static frontend; it does not package a production receiver.

Coding assistants should read [`AGENTS.md`](AGENTS.md); [`CLAUDE.md`](CLAUDE.md) points to the same instructions.

### Event API

`POST /api/events` accepts JSON with `Content-Type: application/json`, up to **16 KiB** per request:

```json
{
  "message": "Agent finished its response.",
  "projectName": "Example project",
  "sessionId": "example-session",
  "sessionName": "Fix login",
  "source": "example-agent",
  "type": "ready"
}
```

| Field         | Requirement                                                    |
| ------------- | -------------------------------------------------------------- |
| `message`     | Non-empty string, up to 4,000 characters                       |
| `projectName` | Optional non-empty string, up to 200 characters, without control characters |
| `sessionId`   | Non-empty string, up to 120 characters                         |
| `sessionName` | Optional non-empty string, up to 200 characters                |
| `source`      | Non-empty string, up to 60 characters                          |
| `type`        | `started`, `activity`, `waiting`, `ready`, `error`, or `ended` |

The receiver adds `id` and `receivedAt` using receiver time. `GET /api/stream` sends an initial SSE `snapshot` and subsequent `event` messages. Browser requests from other origins are rejected. See [`server/receiver.ts`](server/receiver.ts) and [`src/events.ts`](src/events.ts) for the implementation.
