# Aether

> A digital medium for creating, performing, and experiencing living audiovisual worlds.

## Development

Install dependencies with `npm install`, then run both the Vite app and WebSocket room server:

```sh
npm run dev:all
```

The app is served by Vite. The room server listens on port `8787` by default and is proxied by Vite at `/ws`. Set `PORT` to change the room server port.

Rooms are in-memory and ephemeral: a room's parameter state, seed, and shared start epoch are retained while viewers are connected, then discarded when the last viewer disconnects. Parameter updates are ordered by server revisions and applied at a shared effective timestamp. Each viewer runs the world simulation locally, so exact pixel-identical motion across different GPUs is not guaranteed. Late joiners receive the same seed and parameters but do not replay the room's prior GPU integration history.

Each room also shares its selected world. Switch between **Pelagic / Field Study** and **Styx / Metalheart** in the Studio panel; world changes and parameter updates are broadcast to everyone connected to that room. Styx pairs the OBJ model in `src/assets/model.obj` with chrome reflections, a slow continuous camera drift and zoom, pulsing light hits, and orbiting Chao companions using the supplied model and textures in `src/assets/baby-chao`.

## Validation

```sh
npm run build
npm run lint
```
