# Aether

> A digital medium for creating, performing, and experiencing living audiovisual worlds.

## Development

Install dependencies with `npm install`, then run both the Vite app and WebSocket room server:

```sh
npm run dev:all
```

The app is served by Vite. The room server listens on port `8787` by default and is proxied by Vite at `/ws`. Set `PORT` to change the room server port.

Rooms are in-memory and ephemeral: a room's parameter state, seed, and shared start epoch are retained while viewers are connected, then discarded when the last viewer disconnects. Parameter updates are ordered by server revisions and applied at a shared effective timestamp. Each viewer runs the world simulation locally, so exact pixel-identical motion across different GPUs is not guaranteed. Late joiners receive the same seed and parameters but do not replay the room's prior GPU integration history.

## Validation

```sh
npm run build
npm run lint
```
