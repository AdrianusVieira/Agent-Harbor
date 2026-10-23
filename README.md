# Agent Harbor

A local command center for AI work sessions. Track Claude and Codex across apps and editors, see what’s running, and get notified when a session needs your attention.

That is the direction. This first learning milestone is smaller: **receive an event and see it arrive in a terminal-style UI**. Automatic agent discovery, agent hooks, notifications, and orchestration are not implemented yet.

**Current focus:** review the UI draft together, one small step at a time, before advancing to integrations. Coding assistants should read [AGENTS.md](AGENTS.md); [CLAUDE.md](CLAUDE.md) points to the same shared guidance.

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

## Check the project

```sh
npm run typecheck
npm test
npm run build
```

`npm run preview` previews the static production build only; the event receiver runs with `npm run dev`. Production packaging can be a later learning milestone.

After the UI review, a possible next milestone is to connect one real agent lifecycle event and confirm what it reliably tells us. We will choose that step together.
