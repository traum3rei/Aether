import type { FirstWorldParameters } from '../worlds/FirstWorld';
import type { WorldId } from '../worlds/WorldId';

export type RoomMessage =
  | { type: 'join'; roomId: string; worldId: WorldId; parameters?: FirstWorldParameters }
  | { type: 'state'; roomId: string; worldId: WorldId; parameters: FirstWorldParameters; revision: number; seed: number; startTime: number }
  | { type: 'update'; roomId: string; worldId?: WorldId; parameters?: Partial<FirstWorldParameters>; revision: number; effectiveTime: number }
  | { type: 'presence'; roomId: string; viewers: number }
  | { type: 'error'; message: string };

export class RoomClient {
  private socket: WebSocket | null = null;
  private readonly listeners = new Set<(message: RoomMessage) => void>();

  connect(roomId: string, worldId: WorldId, parameters: FirstWorldParameters) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
    this.socket = socket;
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ type: 'join', roomId, worldId, parameters } satisfies RoomMessage));
    });
    socket.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(String(event.data)) as RoomMessage;
        this.listeners.forEach((listener) => listener(message));
      } catch {
        console.warn('Room server sent an invalid message.');
      }
    });
    socket.addEventListener('error', () => {
      this.listeners.forEach((listener) => listener({ type: 'error', message: 'Room server connection failed.' }));
    });
    socket.addEventListener('close', () => {
      this.listeners.forEach((listener) => listener({ type: 'error', message: 'Room server connection closed.' }));
    });
  }

  sendUpdate(roomId: string, parameters: Partial<FirstWorldParameters>) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify({ type: 'update', roomId, parameters }));
    return true;
  }

  sendWorldUpdate(roomId: string, worldId: WorldId) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify({ type: 'update', roomId, worldId }));
    return true;
  }

  subscribe(listener: (message: RoomMessage) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  disconnect() {
    this.socket?.close();
    this.socket = null;
    this.listeners.clear();
  }
}
