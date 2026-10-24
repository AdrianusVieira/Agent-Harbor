# Agent Harbor — working instructions

## Purpose and current focus

Agent Harbor is a personal learning project: a local monitor for AI work sessions across apps and editors, especially sessions waiting for the user's attention.

The original project-local Claude Code startup, permission-request, and reply-ready hooks are verified with real sessions. On 2026-10-24, the user confirmed **needs input → working** and **started → reply ready**, supplying screenshots of both transitions. `Stop` emits `ready` when a response finishes, not when the overall task is proven complete. The `UserPromptSubmit` observer emits `activity` when a prompt is submitted. On 2026-10-24, the user also confirmed **reply ready → working → reply ready** for the same real session with a screenshot. Per-tool success, failure, and interruption observers have since been removed at the user’s request; monitor response completion with `Stop` instead. The observers do not detect the instant of approval, manual denial, or permission-dialog cancellation. Startup timing investigation is complete; see README.md. Custom session names are forwarded from startup and prompt-submit hook payloads and retained by source and session ID within receiver history. On 2026-10-24, the user confirmed name display with a screenshot showing `#test1` and `#test2` on both working and reply-ready events. The screenshot does not expose the underlying IDs, so it does not independently establish whether these are two sessions or a rename. User-level hook setup exists in `scripts/configure-claude-hooks.ts`. On 2026-10-24, six handlers were installed in the user’s Claude settings; comparison with the private backup verified all original settings were preserved. The legacy project-local registrations were removed. The user-level configuration was then updated to four handlers, with automated migration coverage removing the old tool-result handlers while preserving unrelated hooks. All four installed command shapes have automated foreign-directory coverage. On 2026-10-24, the user confirmed the revised Claude Code behavior after removing per-tool events; the repository used for that check was not specified. Keep the verified increment small and choose further work with the user. Automatic discovery, other integrations, notifications, and orchestration do not exist yet.

Read [README.md](README.md) for setup, the event contract, and current limitations. Inspect the actual code before assuming a feature exists.

The temporary `Bash(npm run typecheck)` Ask rule was removed after the successful request-to-result check. Preserve other local settings during future test cleanup. The app's monitoring adapters must never edit permission settings.

## Work with the user

- Move one small, understandable step at a time. Keep changes within the current request.
- Explain the purpose of a change in plain language and make the result easy to inspect.
- Whenever progress needs user input or action, state the exact action, where to do it, why it is needed, and what result to report. Repeat any outstanding request clearly in the final response; do not leave it implied by a suggested next step or only in a tool prompt. Say explicitly when work is waiting on the user. Retrieve information through available tools instead of asking the user to collect it when possible.
- For visual work, show the UI early. Pause for feedback before advancing to the next feature or milestone.
- Do not turn a UI discussion into backend work, integration setup, deployment, or a broad scaffold unless requested.
- Complete routine details within the requested step without repeated permission questions.
- Favor clear, direct code that the user can learn from. Introduce abstractions and dependencies only when there is a concrete need.

## Stack and design

- React, TypeScript, and Vite; npm with the committed `package-lock.json`.
- Plain CSS with shared design tokens. Keep the interface minimal and terminal-like.
- The monochrome appearance follows the sibling Mute and Cousin projects: near-black surfaces, slate borders, off-white text, and compact spacing.
- Use monospace text for event data, readable contrast, keyboard access, visible focus states, and reduced-motion support.
- Do not modify sibling projects while using them as references.

## Monitoring semantics

- Keep the monitoring UI free of sample generators and manual event-sending controls. Start with an empty stream when the receiver has no history. Keep synthetic test traffic isolated from the user’s receiver.
- Distinguish observed events from inferred session state. A quiet stream does not prove a session has stopped or is stuck.
- A response being ready does not prove the overall task is complete. Do not emit per-tool completion or failure events; the user wants response-level completion. Permission requests remain visible, and their latest status can stay waiting after approval until the response finishes.
- Use the custom session name for display when available, and source plus session ID for identity. Names can change or repeat. Only forward explicit `session_title` metadata; do not derive names from prompt or transcript content.
- Prompt monitoring forwards no prompt text and emits no context or blocking decision. A submitted prompt does not prove model processing has started; another hook may still block it.
- Stop monitoring must emit no feedback, blocking decisions, or nonzero exit codes that could continue Claude. Do not forward response text, background-task data, or scheduled prompts.
- Counts reflect received, retained history; do not present them as a complete inventory of running sessions.
- Keep the development receiver bound to loopback. Do not capture screens, install hooks, or collect session content as an incidental part of UI work.
- User-level setup is an explicit configuration operation, separate from observers. Preserve unrelated settings and hooks. Only commands ending in ` # agent-harbor` belong to setup/uninstall. Do not re-add project-local Harbor registrations alongside the user-level hooks. Keep setup tests isolated from real user settings.
- Permission monitoring is observational: emit no approval decisions, do not modify permission settings, and do not forward tool arguments or permission suggestions. Keep user approval in Claude Code.

## Repository map

- `scripts/claude-hooks.ts`: generates absolute user-level hook commands and preserves unrelated settings when merging/removing Harbor handlers.
- `scripts/claude-permission-request.test.ts`: permission observer delivery, privacy, and failure tests.
- `scripts/claude-permission-request.ts`: translates tool permission requests into Harbor `waiting` events.
- `scripts/claude-prompt-submit.test.ts`: ready-to-activity sequence, prompt privacy, and non-blocking failure tests.
- `scripts/claude-prompt-submit.ts`: reports submitted prompts as observed session activity.
- `scripts/claude-reply-ready.test.ts`: activity-to-ready sequence, response privacy, and non-blocking failure tests.
- `scripts/claude-reply-ready.ts`: reports the main agent's `Stop` event as a ready response.
- `scripts/claude-session-start.ts`: reads Claude hook input and sends one Harbor event to localhost.
- `scripts/claude-session-start.test.ts`: configured hook command and receiver integration tests.
- `scripts/configure-claude-hooks.test.ts`: settings preservation, repeat installation, uninstall, invalid input, and foreign-project command tests.
- `scripts/configure-claude-hooks.ts`: preview/install/uninstall CLI with private backups and atomic settings replacement.
- `server/receiver.test.ts`: receiver integration tests.
- `server/receiver.ts`: development event validation, history, and SSE delivery.
- `src/App.tsx`: event terminal and browser controls.
- `src/events.ts`: shared event types and display labels.
- `src/styles.css`: design tokens and responsive layout.
- `vite.config.ts`: development receiver wiring.

## Editing and validation

- Prefer alphabetical order within logical groups where order has no behavioral meaning, including independent state declarations, refs, named imports, and object properties. Preserve initialization dependencies, execution order, React hook rules, CSS cascade, and intentional display or event order.
- Inspect Git status first. Preserve the user's staged work and unrelated changes; do not stage, commit, reset, or discard them unless requested.
- Keep documentation consistent when behavior or setup changes.
- Run `npm run build` for application changes. Run `npm test` when adapter, hook configuration, receiver behavior, or the event contract changes.
- Inspect the rendered UI for visual changes. State any verification limits accurately.
- For documentation-only changes, check the edited text and links; application tests are unnecessary.
- Report what changed, how it was checked, and any relevant unfinished work. Do not claim unverified features or checks.
