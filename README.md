# Agent Harbor

A local command center for AI work sessions. Track Claude and Codex across apps and editors, see what’s running, and get notified when a session needs your attention.

That is the direction. The current learning milestone is smaller: **show Claude Code session startup, tool permission requests, tool results, and finished responses**. Five project-local hooks are implemented. Automatic discovery of already-running sessions, direct approval decisions, prompt-start detection, notifications, and orchestration are not implemented yet.

**Current focus:** startup, permission requests, successful tool results, and reply-ready delivery are verified with real sessions. Choose the next small increment together. Failure and interruption paths have automated coverage only. Coding assistants should read [AGENTS.md](AGENTS.md); [CLAUDE.md](CLAUDE.md) points to the same shared guidance.

## Run locally

Requires Node.js 20.19+ (or 22.12+) and npm.

```sh
npm install
npm run dev
```

Open <http://127.0.0.1:5173>. The same development server serves the React UI and receives events. Click **Send sample events** to try the full path with clearly labeled demo traffic, or send your own:

```sh
curl -X POST http://127.0.0.1:5173/api/events \
  -H 'Content-Type: application/json' \
  -d '{"source":"manual","sessionId":"first-session","type":"waiting","message":"Ready for your input."}'
```

## What this version does

- Streams received events to the browser using Server-Sent Events (SSE).
- Filters by text or attention events (`waiting` and `error`).
- Pauses the displayed stream while continuing to receive events; resume catches up within the retained buffer.
- Derives session counts from each observed session’s most recent event. Sessions are identified by source and session ID together. “Reply ready” means a response is available, not that the overall task is complete.
- Replays the latest 500 events on browser reconnect. Events are held in memory and disappear when the dev server restarts.
- Clears the current browser view without deleting the server buffer. Reloading the page restores that buffer. Counts describe the visible history; they are not a global inventory of running agents. The attention filter shows historical attention events, including ones later followed by other events.

## Try the Claude Code hook

This is a project-local experiment. [`.claude/settings.json`](.claude/settings.json) registers a command hook for `SessionStart` with the `startup` matcher. When Claude Code starts a new session in this repo, it supplies JSON on stdin to [`scripts/claude-session-start.ts`](scripts/claude-session-start.ts). The adapter posts a `started` event to Harbor:

```text
Claude Code startup → adapter script → POST /api/events → existing UI
```

1. Run `npm install` if dependencies are not installed, then keep `npm run dev` running.
2. Open <http://127.0.0.1:5173> and select **All events**, clear the search, and resume the view if paused.
3. Open this folder in Claude Code and start a **new session**. Accept the normal workspace trust prompt if Claude presents one. In VS Code, make sure the Claude Code extension is using this repository as its project.
4. Look for source `claude-code`, status `started`, and message **Claude Code session started.**

The hook runs in the background, and its HTTP request has a 1.5-second timeout. It prints nothing to stdout, returns normally on invalid input or delivery failure, and does not change permission decisions or add context to Claude. A failure prints a short diagnostic to stderr. Events missed while Harbor is offline are not queued or retried.

Only the session ID and a fixed message are forwarded; the script does not read transcript files or send the working directory, model, or prompts. Its destination is always `127.0.0.1`. The optional `HARBOR_PORT` environment variable changes the receiver port from its default `5173` (run Vite on the same port if you change it).

The startup hook ignores existing sessions, resumes, `/clear`, and compaction. Starting a session does not prove it is actively working. These project hooks do not configure your other repositories or change `~/.claude/settings.json`.

For troubleshooting, check the hook registration in Claude Code's `/hooks` menu where available and its debug output for `Agent Harbor: session-start event not delivered`. The registration uses the installed project-local `tsx` binary, so Node.js and this repo's npm dependencies must be available to the Claude process. The user confirmed delivery from a real new Claude Code session on 2026-10-23. See the [official hooks reference](https://code.claude.com/docs/en/hooks#sessionstart).

To disable this trial, remove its `SessionStart` entry from `.claude/settings.json` and start a fresh session.

## Try the permission-request hook

[`.claude/settings.json`](.claude/settings.json) also registers `PermissionRequest` for all tool names. [`scripts/claude-permission-request.ts`](scripts/claude-permission-request.ts) sends an event with the same `claude-code` source and session ID as the startup event, type `waiting`, and a message such as **Claude Code requested permission to use Bash.** The existing UI displays it as **needs input** and includes it in the Attention filter.

1. Keep `npm run dev` running and the Harbor view resumed, with no search filter.
2. Start a new Claude Code session in this repository so it loads the updated project hooks. Use the normal approval mode, with auto-approval disabled for the operation you are checking.
3. Ask Claude to run a harmless command such as `npm run typecheck`. When an actual tool permission prompt appears, leave it unanswered briefly and check Harbor for **needs input**. A conversational question from Claude is not a tool permission prompt.
4. Approve or deny in Claude as usual, then report whether the event appeared. If the command was already allowed and no prompt appeared, report that instead; no permission event is expected in that case.

For a repeatable check when the command is already allowed, you can use Claude's `/permissions` menu where available to add a temporary, project-local **Ask** rule for `Bash(npm run typecheck)`, start a fresh session, and remove that rule afterward. This app does not add or change permission rules for you.

The user confirmed successful permission-request delivery on 2026-10-23 and supplied a screenshot of **needs input** with the message **Claude Code requested permission to use Bash.** The check used a temporary `Bash(npm run typecheck)` Ask rule because the first attempt was already allowed. That rule was removed afterward. Future manual checks should also remove only their own test rule, preserving other local settings. The monitoring adapters themselves do not edit these settings. Ask rules take precedence over matching allow rules; see the [official permission rules reference](https://code.claude.com/docs/en/permissions#manage-permissions).

The observer runs in the background and emits no stdout or approval decision. It uses the same localhost destination, optional `HARBOR_PORT`, and 1.5-second HTTP timeout as the startup adapter. Only the session ID and tool name are forwarded in a fixed message; tool arguments, prompts, transcript paths, and suggested permission rules are excluded. Failure prints a short stderr diagnostic and exits normally.

The request event records **a permission request occurred**, not the continuing truth of "still waiting." A later tool-result event can replace the latest waiting status, as described below. Merely approving, denying, or canceling the permission dialog does not itself send a Harbor event. Hooks run asynchronously and can arrive late or out of order, especially for rapidly answered prompts; this first version does not correlate individual tool calls or reorder events.

Coverage is limited to `PermissionRequest` hooks in your installed Claude Code version. General questions, already-allowed operations, and some prompt types (including sandbox network approvals) are not covered by this hook. The event can also occur in non-interactive sessions that cannot show a prompt; this trial targets interactive sessions. See the [official PermissionRequest reference](https://code.claude.com/docs/en/hooks#permissionrequest).

To disable just this observer, remove the `PermissionRequest` entry from `.claude/settings.json` and start a fresh session.

## Observe progress after permission

[`scripts/claude-tool-result.ts`](scripts/claude-tool-result.ts) handles two project-local registrations:

| Claude hook          | Harbor type / UI label   | What it actually establishes                                  |
| -------------------- | ------------------------ | ------------------------------------------------------------- |
| `PostToolUse`        | `activity` / **working** | A tool finished successfully; session activity was observed   |
| `PostToolUseFailure` | `error` / **error**      | A tool failed, or was interrupted when `is_interrupt` is true |

Both use the existing `claude-code` source and session ID, so a newly received result replaces the session's latest waiting status in the summary. A successful result can reduce the **need attention** count; an error still counts as needing attention. The Attention filter is historical and continues to show earlier waiting rows. Switch to **All events** to see successful progress rows.

These hooks run **after execution**, including for already-allowed tools. Harbor will still show waiting while an approved long-running tool executes, until a result arrives. The **working** label means observed activity; it does not prove the tool is still running or the overall task is complete. The separate `Stop` observer below detects when the main response finishes.

Manual denial and cancellation of a permission dialog are not reported by these result hooks, so waiting can remain in those cases until another event arrives. If Claude subsequently finishes a response, `Stop` can mark that response ready; it does not report the permission decision. `PermissionDenied` is documented for auto-mode denials, not manual denials, and is not wired here. Interrupting an executing tool can produce a failure event; that differs from canceling its permission dialog. See the official [PostToolUse](https://code.claude.com/docs/en/hooks#posttooluse), [PostToolUseFailure](https://code.claude.com/docs/en/hooks#posttoolusefailure), and [PermissionDenied](https://code.claude.com/docs/en/hooks#permissiondenied) references.

To repeat the real-session check, keep Harbor resumed on **All events**, start a new Claude Code session in this repository, and ask it to run exactly `npm run typecheck`. If the command is already allowed, temporarily add a project-local Ask rule as described above. Leave the actual permission prompt open until Harbor displays **needs input**, then approve **once** and wait for the command to finish. Look for **working** with **Claude Code finished using Bash.**, or an **error** if the tool failed. Remove only the temporary Ask rule afterward, preserving other settings.

On 2026-10-24, the user confirmed the successful transition and supplied a screenshot showing **needs input** followed by **working**, with **Claude Code finished using Bash.**, for the same real session. The temporary Ask rule was removed after that check. Failure and interruption mappings are covered by automated tests, but have not been confirmed by the user in real sessions.

The adapter forwards only the session ID and tool name in a fixed message. Tool arguments, tool outputs, error details, and transcript paths stay out of Harbor. It emits no stdout or decisions, uses the same localhost destination and 1.5-second HTTP timeout, and tolerates delivery failure. To disable these observers, remove the `PostToolUse` and `PostToolUseFailure` entries and start a fresh session.

## Observe a ready response

[`.claude/settings.json`](.claude/settings.json) registers a background `Stop` command with no matcher. [`scripts/claude-reply-ready.ts`](scripts/claude-reply-ready.ts) sends `ready` with the existing source and session ID and the fixed message **Claude Code finished its response.** The existing UI shows **reply ready** and includes that session in **replies ready** when this is its latest received event.

This marks the end of the main agent's current response, whether that response is a result, a question, or a progress update. It does not establish that the whole task is complete, background tasks are stopped, or all work is done. Claude documents user interrupts and API errors separately from `Stop`; this adapter does not map `StopFailure`, `SubagentStop`, or `SessionEnd` to ready. Other Stop hooks may continue the conversation, and asynchronous events can arrive late or out of order. See the [official Stop reference](https://code.claude.com/docs/en/hooks#stop).

To check this in a real session:

1. Keep Harbor running, resumed, and on **All events**, with no search filter.
2. Start a fresh Claude Code session in this repo and ask: **Without using tools, reply only with: Harbor ready check.**
3. Once its response finishes, look for **reply ready** and **Claude Code finished its response.** Tell us whether it appeared. No permission prompt or temporary Ask rule is needed.

Responses requiring no tools can go directly from **started** to **reply ready**. Starting a follow-up prompt does not yet clear ready: `UserPromptSubmit` is not wired, so a later tool result or response-ending event is the next update. These labels describe the latest observed event rather than continuous runtime truth.

On 2026-10-24, the user confirmed this check and supplied a screenshot of **started → reply ready** for the same real session, with **Claude Code finished its response.** No temporary permission rule was needed.

Only the session ID and fixed message are sent; response text, background-task details, scheduled prompts, and transcript paths are excluded. The observer prints no stdout, returns no feedback or decision that would continue Claude, and exits normally on delivery failure. It uses the same localhost destination, optional `HARBOR_PORT`, and 1.5-second HTTP timeout. To disable it, remove the `Stop` entry and start a fresh session.

## Startup timing findings — 2026-10-23

The user observed approximately eight seconds before a startup event appeared, then approximately three seconds on a later run. Three isolated synthetic probes measured 584–824 ms from launching the configured command to receiver acceptance, with 50–73 ms HTTP round trips and approximately 1–3 ms from acceptance to SSE delivery.

A real hook trace measured 624 ms from the adapter's Node process starting to receiver acceptance. Node startup and script loading took 532 ms, waiting for input took 10 ms, and the HTTP round trip took 87 ms. These intervals overlap and should not be added to the 624 ms total.

The remaining observed delay was not isolated. Variable machine load or Claude startup is plausible, but unconfirmed; Claude's hook scheduling and actual browser rendering were not measured. The user accepted the delay, so no performance changes were made. Temporary tracing, its probe command, and generated logs were removed after the investigation. These measurements are observations from this machine, not performance guarantees.

## Event contract

`POST /api/events` accepts a JSON object:

| Field       | Meaning                                                                   |
| ----------- | ------------------------------------------------------------------------- |
| `source`    | Sender label, up to 60 characters, e.g. `manual` or a future adapter name |
| `sessionId` | Sender’s session identifier, up to 120 characters                         |
| `type`      | `started`, `activity`, `waiting`, `ready`, `error`, or `ended`            |
| `message`   | Display text, up to 4,000 characters                                      |

The receiver validates the input and adds `id` and `receivedAt` (receiver time). `GET /api/stream` sends an initial `snapshot` event and then individual `event` messages. It is a development-only, loopback receiver without authentication. It rejects browser requests from other origins and requires JSON for event submissions. Keep it bound to `127.0.0.1`; do not expose the development server to the network.

## Small on purpose

React + TypeScript + Vite, with a small Node HTTP middleware for the local receiver. No database or state library. The monochrome palette and compact geometry follow the sibling Mute and Cousin projects; the harbor symbol and terminal layout belong to Agent Harbor.

```text
sender → POST /api/events → in-memory buffer → SSE → React event stream
```

- `src/App.tsx` — terminal view and browser controls
- `src/events.ts` — shared event types and display labels
- `src/styles.css` — monochrome design tokens and layout
- `server/receiver.ts` — input validation, bounded history, live delivery
- `vite.config.ts` — mounts the receiver in the development server

The startup, permission-request, tool-result, and reply-ready adapters live in `scripts/`; Claude's project-local registrations live in `.claude/`.

## Check the project

```sh
npm run typecheck
npm test
npm run build
```

`npm run preview` previews the static production build only; the event receiver runs with `npm run dev`. Production packaging can be a later learning milestone.

Permission request → successful tool result and finished response → reply ready are verified in real sessions. Choose further lifecycle coverage together.
