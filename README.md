# Agent Harbor

A local command center for AI work sessions. Track Claude and Codex across apps and editors, see what’s running, and get notified when a session needs your attention.

That is the direction. The current learning milestone is smaller: **show Claude Code session startup, submitted prompts, tool permission requests, and finished responses**. Four Claude Code hooks can be installed once at user level for local projects. Automatic discovery of already-running sessions, direct approval decisions, notifications, and orchestration are not implemented yet.

**Current focus:** user-level hooks are installed on this machine. On 2026-10-24, the user confirmed the revised Claude Code behavior after removing per-tool events. Custom names, startup, submitted prompts, permission requests, and reply-ready delivery were verified with project-local registrations. Per-tool success and failure events have been removed to keep the stream focused on session attention and finished responses. Coding assistants should read [AGENTS.md](AGENTS.md); [CLAUDE.md](CLAUDE.md) points to the same shared guidance.

## Run locally

Requires Node.js 20.19+ (or 22.12+) and npm.

```sh
npm install
npm run dev
```

Open <http://127.0.0.1:5173>. The same development server serves the React UI and receives events. The stream starts empty and fills with received session events. The UI has no sample generator or manual event-sending controls.

## What this version does

- Streams received events to the browser using Server-Sent Events (SSE).
- Filters by text or attention events (`waiting` and `error`).
- Pauses the displayed stream while continuing to receive events; resume catches up within the retained buffer.
- Derives session counts from each observed session’s most recent event. Sessions are identified by source and session ID together. “Reply ready” means a response is available, not that the overall task is complete.
- Replays the latest 500 events on browser reconnect. Events are held in memory and disappear when the dev server restarts.
- Clears the current browser view without deleting the server buffer. Reloading the page restores that buffer. Counts describe the visible history; they are not a global inventory of running agents. The attention filter shows historical attention events, including ones later followed by other events.

## Install user-level Claude Code hooks

From this checkout, run:

```sh
npm run hooks:preview
npm run hooks:install
```

The preview shows only Harbor's proposed commands and does not write files. Installation merges four registrations into `~/.claude/settings.json` (or `settings.json` under `CLAUDE_CONFIG_DIR` when set). Existing telemetry, model, plugin, permission, and unrelated hook settings are preserved. Before each actual settings change, setup writes a private backup alongside the file and prints its path; repeat installation does not add duplicate handlers or another backup when nothing changes. Invalid JSON or malformed hook groups stop setup without overwriting settings.

[`scripts/claude-hooks.ts`](scripts/claude-hooks.ts) generates the registrations. Commands contain absolute paths to the Node executable used during setup, this checkout's local `tsx` CLI, and each adapter. They work from another repository without dependencies or scripts in that repository. This initial installer targets macOS/POSIX shells. Keep this checkout and its dependencies available; rerun installation if you move it or replace the Node installation.

Each managed command ends with `# agent-harbor`, a shell comment used to identify Harbor's handlers. Setup and uninstall replace/remove only handlers with that marker, including within groups shared with other hooks. The old project-local registrations have been removed from this repository to avoid duplicate events. Hook definitions in other projects are not edited.

To remove Harbor's user-level hooks:

```sh
npm run hooks:uninstall
```

This preserves unrelated settings and hooks, makes a backup when settings change, and leaves the receiver available. Backups stay in your Claude configuration directory; they are not committed to this repo.

User-level hooks apply to local Claude Code projects, subject to Claude's normal trust and policy controls; they do not configure cloud sessions, Cowork, or other machines. Keep `npm run dev` running on port **5173**. Open a fresh Claude Code session after installation or removal so it loads the intended registrations. See the [official hook locations](https://code.claude.com/docs/en/hooks#hook-locations).

For the real check, keep Harbor resumed on **All events**, with search cleared. Open **another repository** in Claude Code, start a fresh session, assign a name with `/rename Harbor global check`, and send **Without using tools, reply only with: Global hook check complete.** Look for one startup event and one prompt/ready sequence, with the custom name on the prompt and ready events. Report whether the events arrive and whether any are duplicated. This cross-repository Claude check is pending; automated tests run all four installed commands from a temporary foreign project directory without calling Claude.

On 2026-10-24, six handlers were installed in the user-level settings on this machine. Comparison against the private backup verified that removing only Harbor’s handlers reproduces the original settings, including telemetry and plugins. The project-local registrations were removed. The user-level configuration was then updated to four handlers: startup, prompt submission, permission requests, and response completion. Reinstallation removes the two obsolete Harbor tool-result handlers while preserving unrelated hooks. The user confirmed the revised Claude Code behavior after this update; the repository used for that check was not specified.

## Observe Claude Code startup

The user-level `SessionStart` registration uses the `startup` matcher. When Claude Code starts a new session in this repo, it supplies JSON on stdin to [`scripts/claude-session-start.ts`](scripts/claude-session-start.ts). The adapter posts a `started` event to Harbor:

```text
Claude Code startup → adapter script → POST /api/events → existing UI
```

1. Run `npm install` if dependencies are not installed, then keep `npm run dev` running.
2. Open <http://127.0.0.1:5173> and select **All events**, clear the search, and resume the view if paused.
3. Open this folder in Claude Code and start a **new session**. Accept the normal workspace trust prompt if Claude presents one. In VS Code, make sure the Claude Code extension is using this repository as its project.
4. Look for source `claude-code`, status `started`, and message **Claude Code session started.**

The hook runs in the background, and its HTTP request has a 1.5-second timeout. It prints nothing to stdout, returns normally on invalid input or delivery failure, and does not change permission decisions or add context to Claude. A failure prints a short diagnostic to stderr. Events missed while Harbor is offline are not queued or retried.

The session ID, fixed message, and optional custom session title are forwarded; the script does not read transcript files or send the working directory, model, or prompts. Its destination is always `127.0.0.1`. The optional `HARBOR_PORT` environment variable changes the receiver port from its default `5173` (run Vite on the same port if you change it).

The startup hook ignores existing sessions, resumes, `/clear`, and compaction. Starting a session does not prove it is actively working. After user-level installation, the same commands apply to your other local repositories too; no repository-local registration is required.

For troubleshooting, check the hook registration in Claude Code's `/hooks` menu where available and its debug output for `Agent Harbor: session-start event not delivered`. The registration uses absolute paths to Node, this checkout's `tsx` CLI, and the adapter; those files must remain available. The user confirmed delivery from a real new Claude Code session on 2026-10-23. See the [official hooks reference](https://code.claude.com/docs/en/hooks#sessionstart).

To disable only startup monitoring, remove the Harbor handler under `SessionStart` in your user settings, preserving any other handlers, then start a fresh session. Use `npm run hooks:uninstall` to remove all Harbor handlers.

## Try the permission-request hook

The generated user-level hooks also register `PermissionRequest` for all tool names. [`scripts/claude-permission-request.ts`](scripts/claude-permission-request.ts) sends an event with the same `claude-code` source and session ID as the startup event, type `waiting`, and a message such as **Claude Code requested permission to use Bash.** The existing UI displays it as **needs input** and includes it in the Attention filter.

1. Keep `npm run dev` running and the Harbor view resumed, with no search filter.
2. Start a new Claude Code session in this repository so it loads the installed user-level hooks. Use the normal approval mode, with auto-approval disabled for the operation you are checking.
3. Ask Claude to run a harmless command such as `npm run typecheck`. When an actual tool permission prompt appears, leave it unanswered briefly and check Harbor for **needs input**. A conversational question from Claude is not a tool permission prompt.
4. Approve or deny in Claude as usual, then report whether the event appeared. If the command was already allowed and no prompt appeared, report that instead; no permission event is expected in that case.

For a repeatable check when the command is already allowed, you can use Claude's `/permissions` menu where available to add a temporary, project-local **Ask** rule for `Bash(npm run typecheck)`, start a fresh session, and remove that rule afterward. This app does not add or change permission rules for you.

The user confirmed successful permission-request delivery on 2026-10-23 and supplied a screenshot of **needs input** with the message **Claude Code requested permission to use Bash.** The check used a temporary `Bash(npm run typecheck)` Ask rule because the first attempt was already allowed. That rule was removed afterward. Future manual checks should also remove only their own test rule, preserving other local settings. The monitoring adapters themselves do not edit these settings. Ask rules take precedence over matching allow rules; see the [official permission rules reference](https://code.claude.com/docs/en/permissions#manage-permissions).

The observer runs in the background and emits no stdout or approval decision. It uses the same localhost destination, optional `HARBOR_PORT`, and 1.5-second HTTP timeout as the startup adapter. Only the session ID and tool name are forwarded in a fixed message; tool arguments, prompts, transcript paths, and suggested permission rules are excluded. Failure prints a short stderr diagnostic and exits normally.

The request event records **a permission request occurred**, not the continuing truth of "still waiting." The next finished response replaces the latest waiting status with **reply ready**. Individual tool completions and failures do not send events, so waiting can remain displayed after approval until that response finishes. Merely approving, denying, or canceling the permission dialog does not itself send a Harbor event. Hooks run asynchronously and can arrive late or out of order, especially for rapidly answered prompts; this first version does not correlate individual tool calls or reorder events.

Coverage is limited to `PermissionRequest` hooks in your installed Claude Code version. General questions, already-allowed operations, and some prompt types (including sandbox network approvals) are not covered by this hook. The event can also occur in non-interactive sessions that cannot show a prompt; this trial targets interactive sessions. See the [official PermissionRequest reference](https://code.claude.com/docs/en/hooks#permissionrequest).

To disable just this observer, remove the Harbor handler under `PermissionRequest` in your user settings, preserving other handlers, and start a fresh session.

## Keep the stream focused on responses

Harbor does not register `PostToolUse` or `PostToolUseFailure`. Completing a Bash command, or recovering from a tool error, does not mean Claude has finished responding to your prompt. Only the main response's `Stop` event emits **reply ready**.

Run `npm run hooks:install` to replace older Harbor registrations with the four current hooks, then start a fresh Claude Code session. Existing tool-result rows remain in the receiver's history; **Clear view** hides them from the current browser view. New events show startup, prompt submission, permission requests, and response completion.

## Observe a ready response

The generated user-level hooks register a background `Stop` command with no matcher. [`scripts/claude-reply-ready.ts`](scripts/claude-reply-ready.ts) sends `ready` with the existing source and session ID and the fixed message **Claude Code finished its response.** The existing UI shows **reply ready** and includes that session in **replies ready** when this is its latest received event.

This marks the end of the main agent's current response, whether that response is a result, a question, or a progress update. It does not establish that the whole task is complete, background tasks are stopped, or all work is done. Claude documents user interrupts and API errors separately from `Stop`; this adapter does not map `StopFailure`, `SubagentStop`, or `SessionEnd` to ready. Other Stop hooks may continue the conversation, and asynchronous events can arrive late or out of order. See the [official Stop reference](https://code.claude.com/docs/en/hooks#stop).

To check this in a real session:

1. Keep Harbor running, resumed, and on **All events**, with no search filter.
2. Start a fresh Claude Code session in this repo and ask: **Without using tools, reply only with: Harbor ready check.**
3. Once its response finishes, look for **reply ready** and **Claude Code finished its response.** Tell us whether it appeared. No permission prompt or temporary Ask rule is needed.

The original real-session check went directly from **started** to **reply ready** without tools. The new `UserPromptSubmit` observer below adds **working** when the prompt event arrives, including for follow-ups. These labels describe the latest observed event rather than continuous runtime truth.

On 2026-10-24, the user confirmed this check and supplied a screenshot of **started → reply ready** for the same real session, with **Claude Code finished its response.** No temporary permission rule was needed.

Only the session ID and fixed message are sent; response text, background-task details, scheduled prompts, and transcript paths are excluded. The observer prints no stdout, returns no feedback or decision that would continue Claude, and exits normally on delivery failure. It uses the same localhost destination, optional `HARBOR_PORT`, and 1.5-second HTTP timeout. To disable it, remove only the Harbor handler under `Stop` in your user settings and start a fresh session.

## Observe a submitted prompt

The generated user-level hooks register a background `UserPromptSubmit` command with no matcher. [`scripts/claude-prompt-submit.ts`](scripts/claude-prompt-submit.ts) sends `activity` with the existing source and session ID and the fixed message **Claude Code received a prompt.** The UI shows **working** and replaces a session's previous ready status when this event arrives.

Claude fires this event before processing the prompt. It can also fire for scheduled tasks, background subagent reports, and incoming session messages, so the message does not claim that you typed it. It does not prove model processing began: another hook may block the prompt afterward. Like the other asynchronous observers, delivery may be delayed or out of order; a fast response may finish before its prompt event arrives. See the [official UserPromptSubmit reference](https://code.claude.com/docs/en/hooks#userpromptsubmit).

The session ID, fixed message, and optional custom session title are sent. Prompt text, working directories, and transcript paths are excluded. The adapter emits no stdout, context, or blocking decision, exits normally on failure, and uses the same localhost destination, optional `HARBOR_PORT`, and 1.5-second HTTP timeout. To disable it, remove only the Harbor handler under `UserPromptSubmit` in your user settings and start a fresh session.

To check the follow-up transition in a real session:

1. Keep `npm run dev` running and Harbor open at <http://127.0.0.1:5173>, resumed on **All events**, with no search filter.
2. Start a fresh Claude Code session in this repository to load the installed user-level hooks. Ask: **Without using tools, reply only with: Harbor ready check.** Wait for **reply ready** in Harbor.
3. In that same Claude session, send: **Without using tools, explain Server-Sent Events in five short paragraphs.** This gives you more time to observe the intermediate status.
4. Look for **working** with **Claude Code received a prompt.**, followed by **reply ready** with **Claude Code finished its response.**, all with the same session ID. Report whether both appeared, including their order if unexpected. A fast response may require checking the event history afterward.

The configured commands have automated coverage for **ready → activity → ready**, excluded prompt content, invalid input, HTTP rejection, timeout, and an offline receiver. On 2026-10-24, the user confirmed **reply ready → working → reply ready** with a screenshot showing all three events for the same session. No temporary permission rule was needed.

## Custom session names

The UI displays the custom name supplied by Claude Code, such as **Fix login**, instead of the UUID when available. The full session ID remains available by hovering over the name, and search matches either. Identity and session counts still use source plus session ID; names can repeat and change without merging sessions.

`SessionStart` and `UserPromptSubmit` forward the optional `session_title` field as `sessionName` (non-empty, up to 200 characters). Missing or invalid titles in hook input are omitted without losing the lifecycle event. The receiver validates supplied names and carries the latest observed name forward to subsequent events for the same source and ID, including permission requests and ready responses whose hooks omit the title. Historical rows keep the name observed at that time. Names are remembered only within retained in-memory history and are lost on restart or once all events for a session are evicted.

Claude documents this field for **custom titles**, such as one assigned with `/rename` or `--name`; its automatically generated conversation title is not included. A rename reaches Harbor on the next submitted prompt carrying the new title. Unnamed sessions and versions that omit this metadata fall back to their UUID. Harbor does not read transcripts or prompt text to invent a name. See the official [SessionStart](https://code.claude.com/docs/en/hooks#sessionstart-input) and [UserPromptSubmit](https://code.claude.com/docs/en/hooks#userpromptsubmit-input) input references.

To verify in Claude Code, keep Harbor running on **All events** with the view resumed and search cleared. In a session in this repository, set a custom name with `/rename Harbor name check` where supported, then send **Without using tools, reply only with: Name check complete.** Look for **Harbor name check** on the prompt and ready events, with the same underlying ID. Rename it again and submit another prompt to check the next events use the new name. This procedure can also check a rename while preserving the underlying ID. No temporary permission rule is needed.

On 2026-10-24, the user confirmed custom name display with a screenshot showing **#test2** and **#test1**, each on **working** and **reply ready** events. The screenshot hides the UUIDs, so it confirms name delivery and retention through the ready event without independently proving a rename or two distinct sessions.

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
| `sessionName` | Optional custom display name, up to 200 characters; identity still uses source and ID |
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

The startup, prompt-submit, permission-request, and reply-ready adapters live in `scripts/`; the user-level registrations are generated by `scripts/claude-hooks.ts` and installed by `scripts/configure-claude-hooks.ts`.

## Check the project

```sh
npm run typecheck
npm test
npm run build
```

`npm run preview` previews the static production build only; the event receiver runs with `npm run dev`. Production packaging can be a later learning milestone.

Permission requests and reply ready → working → reply ready after a follow-up prompt are verified in real sessions. Custom session name display is also confirmed. The next check is a real Claude session from another repository after user-level installation.
