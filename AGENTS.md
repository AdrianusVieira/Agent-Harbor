# Agent Harbor — working instructions

## Purpose and current focus

Agent Harbor is a personal learning project: a local monitor for AI work sessions across apps and editors, especially sessions waiting for the user's attention.

The current focus is **reviewing and refining the first UI draft with the user**. A basic development receiver already exists, but automatic agent discovery, integrations, notifications, and orchestration do not.

Read [README.md](README.md) for setup, the event contract, and current limitations. Inspect the actual code before assuming a feature exists.

## Work with the user

- Move one small, understandable step at a time. Keep changes within the current request.
- Explain the purpose of a change in plain language and make the result easy to inspect.
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

- Clearly label sample data. Never present demo traffic as connected agents.
- Distinguish observed events from inferred session state. A quiet stream does not prove a session has stopped or is stuck.
- A response being ready does not prove the overall task is complete.
- Counts reflect received, retained history; do not present them as a complete inventory of running sessions.
- Keep the development receiver bound to loopback. Do not capture screens, install hooks, or collect session content as an incidental part of UI work.

## Repository map

- `src/App.tsx`: event terminal and browser controls.
- `src/events.ts`: shared event types and display labels.
- `src/styles.css`: design tokens and responsive layout.
- `server/receiver.ts`: development event validation, history, and SSE delivery.
- `server/receiver.test.ts`: receiver integration tests.
- `vite.config.ts`: development receiver wiring.

## Editing and validation

- Prefer alphabetical order within logical groups where order has no behavioral meaning, including independent state declarations, refs, named imports, and object properties. Preserve initialization dependencies, execution order, React hook rules, CSS cascade, and intentional display or event order.
- Inspect Git status first. Preserve the user's staged work and unrelated changes; do not stage, commit, reset, or discard them unless requested.
- Keep documentation consistent when behavior or setup changes.
- Run `npm run build` for application changes. Run `npm test` when receiver behavior or the event contract changes.
- Inspect the rendered UI for visual changes. State any verification limits accurately.
- For documentation-only changes, check the edited text and links; application tests are unnecessary.
- Report what changed, how it was checked, and any relevant unfinished work. Do not claim unverified features or checks.
