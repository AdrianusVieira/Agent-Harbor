# Agent Harbor

A local command center for AI work sessions. Track Claude and Codex across apps and editors, see what’s running, and get notified when a session needs your attention.

That is the direction. The verified learning milestone is smaller: **show Claude Code session startup, submitted prompts, tool permission requests, and finished responses**. Four Claude Code hooks can be installed once at user level for local projects. A project-local Codex response-completion trial is verified in the CLI, VS Code extension, and desktop app. Automatic discovery of already-running sessions, direct approval decisions, notifications, and orchestration are not implemented yet.

**Current focus:** the project-local Codex test milestone is complete, including user-confirmed desktop approval delivery. The changes are ready for a commit checkpoint before separate user-level setup. Codex **needs input → reply ready** is confirmed with the saved session name. A real **working → reply ready** sequence is confirmed; the user deferred waiting/retrying for names that arrive later. Codex custom-name display and the follow-up rename check are confirmed. Codex reply-ready delivery is confirmed in all three local clients. Claude Code user-level hooks are installed on this machine. On 2026-10-24, the user confirmed the revised Claude Code behavior after removing per-tool events. Custom names, startup, submitted prompts, permission requests, and reply-ready delivery were verified with project-local registrations. Per-tool success and failure events have been removed to keep the stream focused on session attention and finished responses. Coding assistants should read [AGENTS.md](AGENTS.md); [CLAUDE.md](CLAUDE.md) points to the same shared guidance.

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

## Try Codex response completion

The Codex trial registers `PermissionRequest`, `Stop`, and `UserPromptSubmit` in [`.codex/hooks.json`](.codex/hooks.json). The Stop command resolves this repository's Git root and runs [`scripts/codex-reply-ready.ts`](scripts/codex-reply-ready.ts) with the local `tsx` dependency. The commands require `git` and a compatible `node` on the Codex hook process's PATH. They run in the background with five-second command timeouts and 1.5-second HTTP timeouts. No user-level Codex settings have been changed.

The observer posts source `codex`, the session ID, an optional saved session name, type `ready`, and **Codex finished its response.** It forwards no response text, prompts, working directories, transcript paths, model, or turn ID. It reads no transcript files. Delivery failure prints a fixed stderr diagnostic and exits normally; stdout stays empty, with no context or decisions. The destination is loopback port **5173**, or `HARBOR_PORT` when inherited by Codex.

Codex requires review and trust of new or changed hook definitions. Project-local hooks also require a trusted project. See the [official hook locations and trust flow](https://learn.chatgpt.com/docs/hooks#review-and-trust-hooks). For the first real desktop check:

1. Keep `npm run dev` running. Open <http://127.0.0.1:5173>, select **All events**, clear search, and resume the view.
2. In a terminal in this repository, run `codex`, then `/hooks`. Review and trust this project's Harbor `PermissionRequest`, `Stop`, and `UserPromptSubmit` commands if they need review. This uses Codex's normal trust flow; do not bypass hook trust. Close that CLI session after the review.
3. In the desktop app, start a **new chat from the Agent Harbor project**, choose **Local** with the existing checkout, and confirm the folder is `/Users/4089dtidigital/Developer/Agent-Harbor`. A general new chat can use a separate folder under `Documents/Codex`, which has no project-local Harbor hook. Send: **Without using tools, reply only with: Harbor desktop check complete.**
4. After the response finishes, look for source **codex**, status **reply ready**, and **Codex finished its response.** Report whether it appears, whether there are duplicates, and any hook-review warning. If review cannot be completed, report what `/hooks` shows before proceeding.

If `codex` is not on the terminal's PATH, the bundled executable verified on this machine can be launched from the project terminal with:

```sh
"/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex"
```

The CLI review prepares the hook; it does not prove desktop delivery. Desktop and VS Code delivery remain separate checks. On 2026-10-24, the user completed the CLI response check and supplied a screenshot showing one `codex` event, **reply ready**, and **Codex finished its response.**, for session `01a16f9e-da7d-7102-bcd6-ce043f700b99`. That check first confirmed CLI delivery; subsequent client checks are recorded below. Do not mark either desktop or VS Code verified from an automated adapter test or a CLI-only response.

The first desktop attempt produced no Harbor event. The app's chat listing identified **Reply with Harbor check status** as a local Codex chat with no project and working directory `/Users/4089dtidigital/Documents/Codex/2026-10-24/without-using-tools-reply-only-with`. That directory is outside this hook's project-local scope. The next attempt used the Agent Harbor checkout; no adapter change or user-level installation was made for this finding.

The user then confirmed delivery from the **VS Code extension**, while a desktop retry still produced no event. Metadata confirms both retries used this checkout. The project is trusted, the saved Harbor hook is enabled with a trusted hash, and runtime diagnostics report hooks enabled in all three clients. The desktop uses a separate long-running backend. Stale configuration is a hypothesis; the inspected logs did not establish a hook execution error or a root cause. The user was asked to finish active desktop work, fully quit the app with **Cmd+Q**, reopen it, and repeat the no-tools prompt from a fresh **Local** chat in **Agent Harbor**, keeping Harbor running. On 2026-10-24, the user reported **Worked** after that restart check. Desktop reply-ready delivery is now confirmed too. No adapter or hook-definition change was needed for the successful retry; the result is consistent with stale runtime configuration without establishing the earlier root cause. If another client misses events after setup, a full client restart is a useful troubleshooting check after finishing active work.

This trial has no Codex startup integration. The UI displays the saved name when available, otherwise the session ID. `Stop` means a response stopped, not that the whole task is complete; another Stop hook can continue it. The adapter ignores tool completions, subagent stops, session-end events, and interrupts. Async delivery can be delayed or arrive out of order, and missed events are not queued. See the [official Stop reference](https://learn.chatgpt.com/docs/hooks#stop).

Automated tests exercise the actual configured commands from a repository subdirectory against an isolated receiver and temporary Codex name index. They check ready → activity → ready, saved names and renames, excluded private fields, ignored unrelated events, invalid input and ports, HTTP rejection, timeout, and an offline receiver. They make no model calls and send no synthetic traffic to the user's Harbor instance. Real reply-ready delivery is confirmed in CLI, VS Code, and desktop; real custom-name display and the follow-up rename check are also confirmed. Real prompt-submission delivery is confirmed, including a case where its name was unavailable until after the working event. Real permission-request delivery followed by reply ready is confirmed with the saved name; the user also confirmed that the desktop approval check was already completed. Startup and user-level setup for Codex remain future increments.

To disable this trial, remove only the Harbor handlers under `PermissionRequest`, `Stop`, and `UserPromptSubmit` from `.codex/hooks.json`, preserving unrelated hooks, then start a fresh session. After real checks, user-level installation can be a separate step; do not keep both project and user Harbor registrations active.

## Codex session names

Harbor uses the name saved in Codex, including a name you set with **Rename**. You do not configure it separately in Harbor. The [documented hook inputs](https://learn.chatgpt.com/docs/hooks#common-input-fields) do not include a title. Codex exposes a saved name through its [app-server metadata API](https://learn.chatgpt.com/docs/app-server#read-a-stored-thread-without-resuming); this small local trial instead reads its existing name index, without starting an app-server connection for each response.

[`scripts/codex-session-name.ts`](scripts/codex-session-name.ts) reads `session_index.jsonl` under `CODEX_HOME`, or `~/.codex` when unset. It matches the hook's session ID exactly and takes the last complete matching `thread_name` record, so later saved renames replace older names on subsequent events. It sends only that matching name; other sessions' names and index timestamps are excluded. The metadata is never modified, and no transcript or prompt content is read to determine a label. The index has no flag distinguishing generated names from manual names; Harbor uses Codex's saved name, including custom renames.

This index is an **internal Codex file format**, observed on this machine rather than a documented integration contract. The lookup is optional: missing files, unmatched IDs, malformed records, non-file inputs, and indexes larger than **1 MiB** do not prevent event delivery. Names must be non-empty strings of at most 200 characters. A partial line is ignored. If no name is available, new sessions display their ID; the receiver can retain a previously observed name within its existing in-memory history. Fork naming and remote clients using another Codex home are not verified. A new or renamed title reaches Harbor on the next prompt or ready event; historical rows keep their earlier labels.

For the real check, keep Harbor running, resumed on **All events**, with search cleared. In an existing Codex session **in this checkout**, set a custom name with its **Rename** action (or `/rename Harbor name check` in the CLI), then send **Without using tools, reply only with: Harbor name check complete.** Report whether the new ready event displays the exact name you set. Rename the same session again and send another short response to check that the next event uses the new name while the underlying ID stays the same. The hook command did not change for this addition.

On 2026-10-24, all **15 automated tests** and the build passed. A separate read-only lookup resolved a known real CLI check session's existing saved name without submitting an event. The user then confirmed custom-name display with a screenshot showing **codex**, **Test section**, **reply ready**, and **Codex finished its response.** After being asked to rename that same session again, the user reported **Worked well** and supplied a screenshot showing a new ready event named **Test section bomb**, alongside an earlier event named **Explore a session monitoring tool**. The follow-up rename check is user-confirmed. The client used was not specified and the IDs are hidden, so the screenshots do not independently establish identity across those rows or name delivery in every client.

## Observe a submitted Codex prompt

The project-local `UserPromptSubmit` handler runs [`scripts/codex-prompt-submit.ts`](scripts/codex-prompt-submit.ts). It sends source `codex`, the session ID, an optional saved name, type `activity`, and **Codex received a prompt.** The existing UI displays **working**. A follow-up prompt can replace the session's previous **reply ready** status, and the subsequent Stop event returns it to ready.

This observes a prompt about to be submitted; it does not prove model processing began, and another hook may still block the prompt. See the [official UserPromptSubmit reference](https://learn.chatgpt.com/docs/hooks#userpromptsubmit). The command runs asynchronously, emits no stdout, context, or decisions, and exits normally on invalid input or delivery failure. Prompt text, model, working directory, transcript path, and turn ID are excluded. It uses the same saved-name lookup, loopback receiver, optional `HARBOR_PORT`, and 1.5-second HTTP timeout as Stop. Missing name metadata does not prevent activity delivery. Events are not queued or retried, and a very fast response or delayed hook can produce late or out-of-order events; labels describe received observations rather than continuous runtime truth.

For the first real check:

1. Keep Harbor running at <http://127.0.0.1:5173>, resumed on **All events**, with search cleared.
2. From the Agent Harbor project terminal, launch the bundled CLI using the full command above. Open `/hooks`, review and trust the new Harbor **UserPromptSubmit** handler, then close that CLI session. Installation is still project-local; no global Codex configuration is added.
3. In the **VS Code Codex extension**, start a fresh session in this checkout. Give it a recognizable name if desired. Send **Without using tools, explain Server-Sent Events in five short paragraphs.**
4. Look for **working** with **Codex received a prompt.**, followed by **reply ready** with **Codex finished its response.**, under the same session name/ID. Send a follow-up to check the transition repeats. Report whether both appear and their order; if the response is fast, inspect the event history.

To check the desktop afterward, finish active work before fully quitting/reopening the desktop app and starting a fresh **Local** chat in **Agent Harbor**. A desktop restart previously resolved missing Stop delivery; do not restart the app while other work is active. Do not infer real prompt delivery in every client from one client's result.

On 2026-10-24, all **16 tests** and the build passed. The isolated integration test checks an intermediate activity snapshot, a full ready → activity → ready sequence with a saved name, prompt privacy, unnamed fallback, ignored unrelated events, invalid inputs/ports, HTTP rejection, timeout, and offline delivery failure. The user then confirmed a real **working → reply ready** sequence with a screenshot. The working row displayed its UUID, while ready displayed **Explain Server-Sent Events**. A read-only check of the receiver history confirmed both events belong to the same session: activity arrived at **18:12:06.113** local time, and ready at **18:12:13.504**. The name-index record carries timestamp **18:12:06.747**, about **634 ms after** activity receipt. The observer awaits the file lookup but checks only once; it does not wait for a missing name to appear. This is consistent with Codex saving the name after the initial lookup. A short retry window was proposed, but the user chose to move forward without it. The lookup remains a single read, so an initial working event can use the ID before a name is saved. The working/ready check does not independently verify every client or a follow-up ready → working → ready sequence.

## Observe a Codex approval request

The project-local `PermissionRequest` handler runs [`scripts/codex-permission-request.ts`](scripts/codex-permission-request.ts) for every tool name (`.*` is a regex matcher). It sends source `codex`, the session ID, an optional saved name, type `waiting`, and a message such as **Codex requested permission to use Bash.** Harbor displays **needs input** and includes it in Attention. The observer is asynchronous and never approves, denies, changes permissions, or returns context to Codex. Stdout stays empty; invalid input, unavailable names, and delivery failures do not block Codex. It uses the existing loopback destination, `HARBOR_PORT`, five-second command timeout, and 1.5-second HTTP timeout.

Only the tool name enters the fixed message. Tool arguments, approval descriptions, permission suggestions, prompts, model, working directory, transcript paths, and turn IDs are excluded. Coverage follows the installed client's [PermissionRequest event](https://learn.chatgpt.com/docs/hooks#permissionrequest), such as shell escalations and managed-network approvals. Already-allowed commands and general questions do not establish this event. Automatic review can resolve requests without asking the user; the event records that an approval request occurred, not a continuing guarantee of manual input being needed. Async events may be delayed or out of order. After approval, waiting can remain until Stop sends ready; the observer does not detect approval, denial, cancellation, or individual tool completion.

For the first real check:

1. Keep Harbor running, resumed on **All events**, with search cleared.
2. From the project terminal, launch the bundled CLI using the full command above. In `/hooks`, review and trust the new Harbor **PermissionRequest** handler, then close that CLI session.
3. Open a fresh **VS Code Codex** session in this checkout. For this check, use **Ask for approval** in the permissions control below the composer. Note your previous mode so you can restore it afterward. [Official permission modes](https://learn.chatgpt.com/docs/permission-modes) explain manual and automatic review.
4. Send: **Run `curl --head --max-time 10 https://example.com` from the terminal. If the sandbox blocks network access, request approval to retry. Do not change any files.**
5. If an actual approval prompt appears, leave it unanswered briefly and look for **needs input** and the permission-request message in Harbor. Then answer in Codex as usual and check for **reply ready** after its response finishes. Report whether the request and ready events appeared. If no approval prompt appears, report that rather than assuming a missing hook event.
6. Restore your previous permission mode if you changed it. The test creates no permission rules or project test files, and the adapter never edits client settings.

Desktop approval delivery was checked separately and subsequently confirmed by the user; finish active work before restarting a client when future registration changes require it. On 2026-10-24, all **17 tests** and the build passed. Automated checks use isolated metadata and receiver history for **activity → waiting → ready**, Bash/apply_patch/MCP tool names, excluded private data, unnamed fallback, invalid inputs/ports, HTTP rejection, timeout, and offline delivery. On 2026-10-24, following the VS Code check instructions, the user confirmed the result with a screenshot showing **Check example.com connectivity**, **needs input**, and **Codex requested permission to use Bash.** at 18:39:31, followed by **reply ready** and **Codex finished its response.** at 18:39:35 local time. The name is preserved on both rows. The screenshot does not expose IDs or identify the client; desktop approval delivery was subsequently confirmed directly by the user. Restoration of any temporary permission-mode change has not been confirmed.

On a later no-modal check, the user clarified that the client was **VS Code**, not desktop. The test session's recorded turn context used `on-request` with reviewer `auto_review`, and an automatic Guardian review was recorded. Automatic review explains why the request continued without asking the user. To inspect a manual prompt, select **Ask for approval** in the specific VS Code chat's permission control and repeat the check above. An on-request approval policy alone does not imply human review. Harbor currently reports requests handled by automatic review too; its **needs input** label does not prove a human response is required. No permission settings or adapter behavior were changed during this diagnosis.

The next VS Code retry used reviewer **user**, confirmed from the recorded turn context, and the user supplied a screenshot of **needs input** at **18:47:59** under **Check example.com connectivity**. This confirms named permission-event delivery in manual review mode. The screenshot does not show the later ready event for that retry. The user was asked to answer normally in Codex and restore the previous permission mode if changed for testing.

On 2026-10-24, after being asked for the remaining desktop approval check, the user explicitly confirmed **Already tested that**. Desktop approval delivery is now user-confirmed and the current project-local Codex test milestone is complete. No further manual test is outstanding for this checkpoint. User-level Codex setup remains a separate future step.

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

Claude Code permission requests and reply ready → working → reply ready after a follow-up prompt are verified in real sessions. Custom session name display is also confirmed. Codex reply-ready delivery is also confirmed in CLI, VS Code, and desktop using the project-local trial above. A specifically identified cross-repository Claude check after user-level installation is still pending.
