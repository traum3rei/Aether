# Aether

> A digital medium for creating, performing, and experiencing living audiovisual worlds.

## Development

Install dependencies with `npm install`, then run the Vite app and WebSocket room server together:

```sh
npm run dev
```

The app is served by Vite. The room server listens on port `8787` by default and is proxied by Vite at `/ws`. Set `PORT` to change the room server port.

Rooms are in-memory and ephemeral: a room's parameter state, seed, and shared start epoch are retained while viewers are connected, then discarded when the last viewer disconnects. Parameter updates are ordered by server revisions and applied at a shared effective timestamp. Each viewer runs the world simulation locally, so exact pixel-identical motion across different GPUs is not guaranteed. Late joiners receive the same seed and parameters but do not replay the room's prior GPU integration history.

Each room also shares its selected world. Switch between **Pelagic / Field Study**, **Styx / Metalheart**, **Y2K / Dream Circuit**, **Hydros / Blue Hour**, and **SDF / Ghost Circuit** in the Studio panel; world changes and parameter updates are broadcast to everyone connected to that room. Room 04 opens in the Y2K world, and room 05 opens in Ghost Circuit, a dark, animated WebGPU raymarched passage with repeating arches and cyan-to-coral signal rails. Dream Circuit uses the cosmic spiral OBJ/MTL as a rotating halo around its central sphere. Hydros pairs a GPU-stepped shallow-water height/velocity simulation with Three.js `WaterMesh` reflections and subtle moving normal-map detail. Its spiral is partly submerged and rotates in place around a fixed pivot; there are no splash particles or seabed plane. The solver models a two-dimensional free surface, not full three-dimensional Navier–Stokes fluid. Drag the scene to look and use WASD or arrow keys to move on desktop; touch users can drag to look and use the on-screen joystick to move. The local AETHER FM player discovers `.mp3` files placed directly in `src/assets/music`.

Styx pairs the OBJ model in `src/assets/model.obj` with chrome reflections, a slow continuous camera drift and zoom, pulsing light hits, and orbiting Chao companions using the supplied model and textures in `src/assets/baby-chao`.

## Validation

```sh
npm run build
npm run lint
```
