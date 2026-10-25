# Agent Harbor

A local monitor for your AI work sessions. Keep Claude Code and Codex events in one minimal, terminal-style interface, so you can see when a session requests attention or finishes a response.

Agent Harbor is an early learning project built with React, TypeScript, and Vite. It uses lifecycle hooks for Claude Code and Codex, with an experimental cache observer for Claude Desktop. Desktop notifications, automatic discovery of running sessions, and orchestration are future work.

## What you can see

- A live event stream with session names, sources, timestamps, and status labels.
- Counts based on each observed session's latest received event.
- Text search and an Attention filter for permission requests and errors.
- Pause/resume and Clear view controls.
- The last 500 events, held in memory and replayed when the browser reconnects.

| Integration                   | Session startup | Prompt submitted | Permission requested | Response finished |
| ----------------------------- | --------------- | ---------------- | -------------------- | ----------------- |
| Claude Code                   | Yes             | Yes              | Yes                  | Yes               |
| Codex                         | —               | Yes              | Yes                  | Yes               |
| Claude Desktop (experimental) | —               | —                | —                    | Cache observation |

Claude Code and Codex have user-level installers, so you can connect local sessions across projects without adding Harbor scripts to each repository. Codex delivery has been exercised in the CLI, VS Code extension, and desktop app. Hook availability depends on your installed client and version. The installers target macOS/POSIX shells; Windows setup is not supported yet.

## Quick start

Requires npm and Node.js **20.19+ on the 20.x line, or 22.12+**. Connecting an agent also requires that agent's hook support.

```sh
git clone https://github.com/AdrianusVieira/Agent-Harbor.git
cd Agent-Harbor
npm ci
npm run dev
```

Open <http://127.0.0.1:5173>. Keep the development server running while monitoring sessions. The same server serves the UI and receives events; the stream starts empty until a connected agent sends something.

### Connect Claude Code

From the Harbor checkout:

```sh
npm run hooks:preview
npm run hooks:install
```

This installs four background observers in `~/.claude/settings.json`: `SessionStart` (startup), `UserPromptSubmit`, `PermissionRequest`, and `Stop`. If `CLAUDE_CONFIG_DIR` is set, setup uses `settings.json` in that directory instead.

Open a fresh local Claude Code session to load the hooks. Complete any normal trust prompts in Claude Code. For custom labels, give your session a name with `/rename` where supported.

See the [Claude Code hook reference](https://code.claude.com/docs/en/hooks) for event behavior and client requirements.

### Connect Codex

From the Harbor checkout:

```sh
npm run hooks:codex:preview
npm run hooks:codex:install
```

This installs three background observers in `~/.codex/hooks.json`: `PermissionRequest`, `Stop`, and `UserPromptSubmit`. If `CODEX_HOME` is set, setup uses `hooks.json` in that directory instead.

Open the Codex CLI and run `/hooks`. Review and trust the three Harbor commands from the **user-level** hook file. New or changed definitions require Codex's normal trust review before they can run; installation does not grant trust or change feature flags. Then open a fresh local session in your chosen client.

See the [Codex hook reference](https://learn.chatgpt.com/docs/hooks) for hook availability, configuration, and trust controls.

### Experimental Claude Desktop observer

This is a separate, manually started prototype for macOS that reports completion from supported Claude Desktop cache records. These records use a generic `chat` classification; the observer cannot reliably distinguish Cowork tasks from ordinary chats. Events therefore use source **`claude-desktop`**.

Keep `npm run dev` running. In a second terminal in the Harbor checkout:

```sh
npm run watch:claude-desktop
```

Wait for **baseline loaded**, then send a new prompt in Claude Desktop. A newly cached response whose active assistant message has `stop_reason: end_turn` can produce **reply ready**. Existing history is ignored at startup. Renaming or rereading the same completed response does not send another event. Press **Ctrl+C** in the watcher terminal to stop it; nothing is installed in Claude settings or registered to start automatically.

The observer polls once per second, but delivery depends on when Desktop saves its cache. Live delivery has been verified for a named Desktop conversation, including a user-run minimized-window check. Coverage beyond those checks remains experimental. It does not observe prompt submission, processing, approval requests, or the instant a response becomes visible. To reject late-loaded history, it checks the message's `updated_at`, falling back to `created_at` when the update timestamp is absent. These dates do not establish completion; `end_turn` does. Starting the watcher after a response has begun can miss that response if its stored message timestamp predates the baseline.

The default source is `~/Library/Application Support/Claude/IndexedDB/https_claude.ai_0.indexeddb.leveldb`. `CLAUDE_DESKTOP_CACHE_DIR` overrides the directory. `HARBOR_PORT` overrides the loopback destination as with the hook observers. For a baseline-only check that sends no events:

```sh
npm run watch:claude-desktop -- --once
```

Compatibility is intentionally limited to inline conversation records in numbered LevelDB `.log` files, Blink serialization version 21, and supported V8 15/16 values. The reader checks fragment checksums and tolerates incomplete tails without opening the database through LevelDB or modifying it. Compacted `.ldb` files, external/compressed blobs, and unsupported values are not decoded; a warning means coverage is incomplete. Limits are 8 MiB per log, 32 MiB total, and 32 logs. Missing/corrupt logs pause reading; a detected sequence reset or gap establishes a fresh baseline without replaying history. Intermediate responses can be missed between snapshots.

**Privacy:** the cache contains conversation content. The observer decodes supported records in memory, extracts only IDs, saved names, and completion metadata, and sends the same minimal event fields as the other adapters. It does not save cache copies to disk or log/forward prompt/response text or tool arguments. It keeps only bounded completion identities in memory between scans. Receiver failures have a timeout and are not retried. The prototype uses no screenshots, Claude credentials, private network APIs, or changes to permissions.

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

| Label           | What was observed                                                |
| --------------- | ---------------------------------------------------------------- |
| **started**     | A Claude Code session started.                                   |
| **working**     | A prompt was submitted; another hook may still block processing. |
| **needs input** | An agent requested permission to use a tool.                     |
| **reply ready** | The agent finished its current response.                         |

**Reply ready means a response is available, not that the overall task is complete.** Individual tool successes and failures are intentionally excluded. The event contract also accepts `error` and `ended`, but the bundled observers do not currently emit them.

A permission request can be handled by automatic review without a human prompt. Harbor does not detect the instant of approval, denial, or cancellation, so a session can remain **needs input** until its response finishes. Approval stays in the originating agent.

The stream is a history of observations. A quiet session is not proof that it stopped or is stuck, and counts are not a complete inventory of running agents. Attention includes historical waiting/error events, even if a later event changed that session's status.

**Pause** freezes the displayed history while events continue to arrive, within the retained buffer. **Clear view** hides events in the current browser view; it does not delete receiver history. Reloading restores retained events. Restarting the development server clears them.

### Session names

Sessions are identified by **source + session ID**, so matching names do not merge sessions. Search accepts names and IDs; hovering over a name reveals its ID.

- **Claude Code:** forwards explicit custom `session_title` metadata from startup and prompt-submit hooks. Automatically generated titles are not included by this adapter.
- **Codex:** reads the matching saved `thread_name` from `session_index.jsonl` under `CODEX_HOME` or `~/.codex`. This includes custom renames and may include generated names. The file is read-only and is an internal Codex format, so compatibility may change.
- **Claude Desktop prototype:** reads the cached conversation's saved `tree.name`. It does not generate a name from message text.

Missing name metadata never blocks event delivery. A newly created session may show its ID before a name is saved; Codex names are checked once per event without waiting or retrying. Subsequent events can carry the name, and the receiver retains known names within its buffered history. Historical rows keep their earlier labels.

## Privacy and limits

The bundled observers send the source, session ID, optional session name, event type, and a fixed message. Permission messages also include the tool name. They do not forward prompt text, response text, tool arguments, transcript content, model details, or working directories. Custom session names are displayed in Harbor, so their contents are part of the monitoring data.

Events go to the local loopback receiver. The observers emit no context or approval decisions; delivery failures exit normally so an unavailable Harbor receiver does not block an agent. Events are not queued or retried while Harbor is offline.

The receiver has **no authentication** and is intended for local development. Keep it bound to `127.0.0.1`; it is not a hosted monitoring service. Hook setup applies to local clients using the configured agent home, not remote sessions, cloud environments, or other machines.

There is currently no persistence, installed background service, screen capture, dedicated Cowork hook integration, or desktop notification system. The experimental Desktop observer has the narrower coverage described above.

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

Observers default to port **5173**. `HARBOR_PORT`, when inherited by the agent process, overrides their destination port; it must match the development server. Setting it does not change Vite's listening port.

## Development

```text
agent hook → observer → POST /api/events → in-memory history → SSE → React UI
```

React and plain CSS provide the monochrome terminal interface. A small Node HTTP middleware in Vite validates events and streams them with Server-Sent Events. There is no database or state-management dependency.

| Path                                       | Purpose                                                          |
| ------------------------------------------ | ---------------------------------------------------------------- |
| [`scripts/`](scripts/)                     | Agent observers, hook installers, and isolated integration tests |
| [`server/receiver.ts`](server/receiver.ts) | Event validation, bounded history, and SSE delivery              |
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
  "sessionId": "example-session",
  "sessionName": "Fix login",
  "source": "example-agent",
  "type": "ready"
}
```

| Field         | Requirement                                                    |
| ------------- | -------------------------------------------------------------- |
| `message`     | Non-empty string, up to 4,000 characters                       |
| `sessionId`   | Non-empty string, up to 120 characters                         |
| `sessionName` | Optional non-empty string, up to 200 characters                |
| `source`      | Non-empty string, up to 60 characters                          |
| `type`        | `started`, `activity`, `waiting`, `ready`, `error`, or `ended` |

The receiver adds `id` and `receivedAt` using receiver time. `GET /api/stream` sends an initial SSE `snapshot` and subsequent `event` messages. Browser requests from other origins are rejected. See [`server/receiver.ts`](server/receiver.ts) and [`src/events.ts`](src/events.ts) for the implementation.
