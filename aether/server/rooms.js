import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';

const rooms = new Map();
const port = Number(process.env.PORT ?? 8787);
const server = createServer();
const websocketServer = new WebSocketServer({ server, path: '/ws' });
const allowedParameters = new Set([
  'particleCount', 'flowScale', 'flowStrength', 'damping', 'confinement',
  'radius', 'timeScale', 'sharpness', 'glow', 'particleSize',
]);
const allowedWorlds = new Set(['pelagic', 'styx', 'y2k', 'hydros']);

function send(socket, message) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

websocketServer.on('connection', (socket) => {
  let roomId = null;

  socket.on('message', (payload) => {
    let message;
    try {
      message = JSON.parse(payload.toString());
    } catch {
      send(socket, { type: 'error', message: 'Invalid JSON message.' });
      return;
    }

    if (message.type === 'join') {
      if (typeof message.roomId !== 'string' || !/^[\w-]{1,48}$/.test(message.roomId)) {
        send(socket, { type: 'error', message: 'Invalid room ID.' });
        return;
      }

      if (roomId) rooms.get(roomId)?.clients.delete(socket);
      roomId = message.roomId;
      let room = rooms.get(roomId);
      if (!room) {
        const parameters = typeof message.parameters === 'object' && message.parameters !== null
          ? message.parameters
          : {};
        room = {
          parameters,
          worldId: allowedWorlds.has(message.worldId) ? message.worldId : 'pelagic',
          revision: 0,
          seed: randomSeed(),
          startTime: Date.now(),
          clients: new Set(),
        };
        rooms.set(roomId, room);
      }
      room.clients.add(socket);
      send(socket, {
        type: 'state',
        roomId,
        worldId: room.worldId,
        parameters: room.parameters,
        revision: room.revision,
        seed: room.seed,
        startTime: room.startTime,
      });
      broadcast(roomId, { type: 'presence', roomId, viewers: room.clients.size });
      return;
    }

    if (message.type === 'update' && roomId && message.roomId === roomId) {
      const room = rooms.get(roomId);
      if (!room) return;

      const safeUpdates = {};
      if (typeof message.parameters === 'object' && message.parameters !== null) {
        for (const [key, value] of Object.entries(message.parameters)) {
          if (allowedParameters.has(key) && typeof value === 'number' && Number.isFinite(value)) {
            safeUpdates[key] = value;
          }
        }
      }

      const nextWorldId = allowedWorlds.has(message.worldId) ? message.worldId : undefined;
      if (Object.keys(safeUpdates).length === 0 && nextWorldId === undefined) return;

      room.parameters = { ...room.parameters, ...safeUpdates };
      if (nextWorldId !== undefined) room.worldId = nextWorldId;
      room.revision += 1;
      const effectiveTime = Date.now() + 150;
      broadcast(roomId, {
        type: 'update',
        roomId,
        ...(Object.keys(safeUpdates).length > 0 ? { parameters: safeUpdates } : {}),
        ...(nextWorldId !== undefined ? { worldId: nextWorldId } : {}),
        revision: room.revision,
        effectiveTime,
      });
    }
  });

  socket.on('close', () => {
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    room.clients.delete(socket);
    broadcast(roomId, { type: 'presence', roomId, viewers: room.clients.size });
    if (room.clients.size === 0) rooms.delete(roomId);
  });
});

function randomSeed() {
  return Math.floor(Math.random() * 2_147_483_647);
}

function broadcast(roomId, message) {
  const room = rooms.get(roomId);
  if (!room) return;
  for (const client of room.clients) send(client, message);
}

server.listen(port, '0.0.0.0', () => {
  console.log(`Aether room server listening on :${port}`);
});
