import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { FirstWorldParameters } from './worlds/FirstWorld';
import { defaultFirstWorldParameters } from './worlds/FirstWorld';
import { isWorldId, worldNames, type WorldId } from './worlds/WorldId';
import { AetherEngine } from './engine/AetherEngine';
import { RoomClient, type RoomMessage } from './rooms/RoomClient';
import { MusicPlayer } from './MusicPlayer';

interface ParameterControlProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}

function readParameters(value: unknown): FirstWorldParameters {
  if (!value || typeof value !== 'object') return { ...defaultFirstWorldParameters };
  const candidate = value as Partial<FirstWorldParameters>;
  const merged = { ...defaultFirstWorldParameters, ...candidate };
  for (const [key, parameter] of Object.entries(merged)) {
    if (typeof parameter !== 'number' || !Number.isFinite(parameter)) {
      merged[key as keyof FirstWorldParameters] = defaultFirstWorldParameters[key as keyof FirstWorldParameters];
    }
  }
  return merged;
}

function ParameterControl({ label, value, min, max, step, onChange }: ParameterControlProps) {
  return (
    <label className="parameter-control">
      <span className="parameter-label">{label}</span>
      <span className="parameter-value">{value.toFixed(2)}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        aria-label={label}
      />
    </label>
  );
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<AetherEngine | null>(null);
  const engineReadyRef = useRef<Promise<void> | null>(null);
  const roomClientRef = useRef<RoomClient | null>(null);
  const [viewers, setViewers] = useState(1);
  const [roomElapsed, setRoomElapsed] = useState(0);
  const [panelVisible, setPanelVisible] = useState(false);
  const [moveStick, setMoveStick] = useState({ x: 0, y: 0 });
  const moveStickPointer = useRef<number | null>(null);
  const [roomStatus, setRoomStatus] = useState<'connecting' | 'live' | 'offline'>('connecting');
  const [engineError, setEngineError] = useState<string | null>(null);
  const [roomId, setRoomId] = useState(() => new URLSearchParams(window.location.search).get('room') ?? 'room-01');
  const [worldId, setWorldId] = useState<WorldId>(() => {
    const queryWorld = new URLSearchParams(window.location.search).get('world');
    return isWorldId(queryWorld)
      ? queryWorld
      : roomId === 'room-04' ? 'y2k' : roomId === 'room-05' ? 'raymarch' : 'pelagic';
  });
  const [rooms, setRooms] = useState<Record<string, FirstWorldParameters>>(() => {
    try {
      const stored = localStorage.getItem('aether.rooms.v1');
      if (!stored) return {};
      const parsed = JSON.parse(stored) as Record<string, unknown>;
      return Object.fromEntries(Object.entries(parsed).map(([id, settings]) => [id, readParameters(settings)]));
    } catch {
      return {};
    }
  });
  const [parameters, setParameters] = useState<FirstWorldParameters>(() => {
    const query = new URLSearchParams(window.location.search);
    const encoded = query.get('settings');
    if (encoded) {
      try {
        return readParameters(JSON.parse(atob(encoded)));
      } catch {
        // Fall through to this device's saved room state.
      }
    }
    const initialRoom = query.get('room') ?? 'room-01';
    return readParameters(rooms[initialRoom]);
  });
  const parametersRef = useRef(parameters);
  const worldIdRef = useRef(worldId);

  const runEngineAction = (action: (engine: AetherEngine) => Promise<void> | void) => {
    const engine = engineRef.current;
    if (!engine) return;
    void (engineReadyRef.current ?? Promise.resolve())
      .then(() => action(engine))
      .catch((error: unknown) => {
        setEngineError(error instanceof Error ? error.message : String(error));
      });
  };

  useEffect(() => {
    parametersRef.current = parameters;
  }, [parameters]);

  useEffect(() => {
    worldIdRef.current = worldId;
  }, [worldId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let active = true;
    let engine: AetherEngine;
    try {
      engine = new AetherEngine(canvas, parametersRef.current);
      engineRef.current = engine;
      engineReadyRef.current = engine.start();
      void engineReadyRef.current.catch((error: unknown) => {
        if (active) setEngineError(error instanceof Error ? error.message : String(error));
      });
    } catch (error) {
      queueMicrotask(() => {
        if (active) setEngineError(error instanceof Error ? error.message : String(error));
      });
      return () => {
        active = false;
      };
    }

    return () => {
      active = false;
      engineRef.current = null;
      engineReadyRef.current = null;
      engine.dispose();
    };
  }, []);

  useEffect(() => {
    if (roomStatus !== 'live') return;
    const timer = window.setInterval(() => setRoomElapsed((elapsed) => elapsed + 1), 1000);
    return () => window.clearInterval(timer);
  }, [roomStatus]);

  useEffect(() => {
    const client = new RoomClient();
    roomClientRef.current = client;
    const initialParameters = parametersRef.current;
    const unsubscribe = client.subscribe((message: RoomMessage) => {
      if (message.type !== 'error' && message.roomId !== roomId) return;
      if (message.type === 'state') {
        const sharedWorldId = isWorldId(message.worldId) ? message.worldId : worldIdRef.current;
        setRoomStatus('live');
        worldIdRef.current = sharedWorldId;
        setWorldId(sharedWorldId);
        const url = new URL(window.location.href);
        url.searchParams.set('world', sharedWorldId);
        window.history.replaceState(null, '', url);
        const sharedParameters = readParameters({ ...message.parameters, seed: message.seed });
        parametersRef.current = sharedParameters;
        setParameters(sharedParameters);
        setRooms((current) => {
          const updated = { ...current, [roomId]: sharedParameters };
          localStorage.setItem('aether.rooms.v1', JSON.stringify(updated));
          return updated;
        });
        runEngineAction((engine) => engine.setWorld(sharedWorldId, sharedParameters));
        const elapsed = Math.max(0, (Date.now() - message.startTime) / 1000);
        setRoomElapsed(elapsed);
        engineRef.current?.setSharedTimeline(message.startTime, elapsed);
      } else if (message.type === 'update') {
        const updates = message.parameters ?? {};
        const delay = Math.max(0, message.effectiveTime - Date.now());
        window.setTimeout(() => {
          const nextWorldId = isWorldId(message.worldId) ? message.worldId : undefined;
          if (nextWorldId) {
            worldIdRef.current = nextWorldId;
            setWorldId(nextWorldId);
            const url = new URL(window.location.href);
            url.searchParams.set('world', nextWorldId);
            window.history.replaceState(null, '', url);
          }
          setParameters((current) => {
            const next = readParameters({ ...current, ...updates });
            parametersRef.current = next;
            return next;
          });
          if (nextWorldId) {
            runEngineAction((engine) => engine.setWorld(nextWorldId, updates));
          } else {
            runEngineAction((engine) => engine.setWorldParameters(updates));
          }
        }, delay);
      } else if (message.type === 'presence') {
        setViewers(message.viewers);
      } else if (message.type === 'error') {
        setRoomStatus('offline');
        console.error(message.message);
      }
    });
    client.connect(roomId, worldIdRef.current, initialParameters);
    const handleOffline = () => setRoomStatus('offline');
    window.addEventListener('offline', handleOffline);

    return () => {
      unsubscribe();
      client.disconnect();
      roomClientRef.current = null;
      window.removeEventListener('offline', handleOffline);
    };
  }, [roomId]);

  const updateParameter = <K extends keyof FirstWorldParameters>(
    key: K,
    value: FirstWorldParameters[K],
  ) => {
    const next = { ...parameters, [key]: value };
    parametersRef.current = next;
    setParameters(next);
    setRooms((current) => {
      const updated = { ...current, [roomId]: next };
      localStorage.setItem('aether.rooms.v1', JSON.stringify(updated));
      return updated;
    });
    const update = { [key]: value };
    if (!roomClientRef.current?.sendUpdate(roomId, update)) {
      setRoomStatus('offline');
    }
    runEngineAction((engine) => engine.setWorldParameters(update));
  };

  const resetParameters = () => {
    const defaults = readParameters({ ...defaultFirstWorldParameters, seed: parameters.seed });
    parametersRef.current = defaults;
    parametersRef.current = defaults;
    setParameters(defaults);
    setRooms((current) => {
      const updated = { ...current, [roomId]: defaults };
      localStorage.setItem('aether.rooms.v1', JSON.stringify(updated));
      return updated;
    });
    if (!roomClientRef.current?.sendUpdate(roomId, defaults)) {
      setRoomStatus('offline');
    }
    runEngineAction((engine) => engine.setWorldParameters(defaults));
  };

  const switchRoom = (nextRoomId: string) => {
    setRoomId(nextRoomId);
    const nextWorldId = nextRoomId === 'room-04'
      ? 'y2k'
      : nextRoomId === 'room-05' ? 'raymarch' : worldId;
    const query = new URLSearchParams(window.location.search);
    const shared = query.get('settings');
    let nextParameters = readParameters(rooms[nextRoomId]);
    if (shared && query.get('room') === nextRoomId) {
      try {
        nextParameters = readParameters(JSON.parse(atob(shared)));
      } catch {
        nextParameters = readParameters(rooms[nextRoomId]);
      }
    }
    parametersRef.current = nextParameters;
    parametersRef.current = nextParameters;
    setParameters(nextParameters);
    if (nextWorldId !== worldId) {
      worldIdRef.current = nextWorldId;
      setWorldId(nextWorldId);
      if (!roomClientRef.current?.sendWorldUpdate(nextRoomId, nextWorldId)) {
        setRoomStatus('offline');
      }
      runEngineAction((engine) => engine.setWorld(nextWorldId, nextParameters));
    } else {
      runEngineAction((engine) => engine.setWorldParameters(nextParameters));
    }
    const url = new URL(window.location.href);
    url.searchParams.set('room', nextRoomId);
    url.searchParams.set('world', nextWorldId);
    window.history.replaceState(null, '', url);
  };

  const switchWorld = (nextWorldId: WorldId) => {
    worldIdRef.current = nextWorldId;
    setWorldId(nextWorldId);
    if (!roomClientRef.current?.sendWorldUpdate(roomId, nextWorldId)) {
      setRoomStatus('offline');
    }
    runEngineAction((engine) => engine.setWorld(nextWorldId, parametersRef.current));
    const url = new URL(window.location.href);
    url.searchParams.set('world', nextWorldId);
    window.history.replaceState(null, '', url);
  };

  const shareRoom = async () => {
    const shareUrl = new URL(window.location.href);
    shareUrl.searchParams.set('room', roomId);
    shareUrl.searchParams.set('settings', btoa(JSON.stringify(parameters)));
    try {
      await navigator.clipboard.writeText(shareUrl.toString());
    } catch {
      window.prompt('Copy this room settings link', shareUrl.toString());
    }
  };

  const updateMoveStick = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerId !== moveStickPointer.current) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const radius = bounds.width * 0.34;
    let x = (event.clientX - (bounds.left + bounds.width / 2)) / radius;
    let y = (event.clientY - (bounds.top + bounds.height / 2)) / radius;
    const distance = Math.hypot(x, y);
    if (distance > 1) {
      x /= distance;
      y /= distance;
    }
    setMoveStick({ x, y });
    engineRef.current?.setMoveInput(x, -y);
  };

  const stopMoveStick = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerId !== moveStickPointer.current) return;
    moveStickPointer.current = null;
    setMoveStick({ x: 0, y: 0 });
    engineRef.current?.setMoveInput(0, 0);
  };

  return (
    <main className="aether" data-world={worldId}>
      <canvas ref={canvasRef} />
      <MusicPlayer />
      <div className="movement-hint" aria-hidden="true">
        <span className="desktop-movement-hint">DRAG TO LOOK · WASD / ARROWS TO MOVE</span>
        <span className="touch-movement-hint">DRAG TO LOOK · JOYSTICK TO MOVE</span>
      </div>
      <div className="mobile-movement" role="group" aria-label="Movement controls">
        <button
          className="move-joystick"
          type="button"
          aria-label="Move with joystick"
          onPointerDown={(event) => {
            moveStickPointer.current = event.pointerId;
            event.currentTarget.setPointerCapture(event.pointerId);
            updateMoveStick(event);
          }}
          onPointerMove={updateMoveStick}
          onPointerUp={stopMoveStick}
          onPointerCancel={stopMoveStick}
        >
          <span className="move-joystick-thumb" style={{
            transform: `translate(${moveStick.x * 25}px, ${moveStick.y * 25}px)`,
          }} />
        </button>
      </div>

      <header className="aether-header">
        <div className="aether-mark">AETHER</div>
        <div className="world-title">
          <span className="world-index">
            WORLD {worldId === 'pelagic' ? '01' : worldId === 'styx' ? '02' : worldId === 'y2k' ? '03' : worldId === 'hydros' ? '04' : '05'} · {roomId.toUpperCase()}
          </span>
          <span className="world-name">{worldNames[worldId]}</span>
        </div>
      </header>

      <button
        className="panel-reveal"
        type="button"
        aria-expanded={panelVisible}
        aria-controls="world-controls"
        onClick={() => setPanelVisible((visible) => !visible)}
      >
        {panelVisible ? 'CLOSE' : 'STUDIO'}
      </button>

      <aside
        id="world-controls"
        className={`world-controls ${panelVisible ? 'visible' : ''}`}
        aria-label="World parameters"
        onMouseEnter={() => {
          if (window.matchMedia('(hover: hover)').matches) setPanelVisible(true);
        }}
        onMouseLeave={() => {
          if (window.matchMedia('(hover: hover)').matches) setPanelVisible(false);
        }}
        onFocus={() => setPanelVisible(true)}
      >
        <div className="control-heading">
          <label className="room-select-label">
            ROOM
            <select value={roomId} onChange={(event) => switchRoom(event.currentTarget.value)}>
              <option value="room-01">01 / ABYSS</option>
              <option value="room-02">02 / BLOOM</option>
              <option value="room-03">03 / DRIFT</option>
              <option value="room-04">04 / DREAM CIRCUIT</option>
              <option value="room-05">05 / GHOST CIRCUIT</option>
            </select>
          </label>
          <label className="room-select-label">
            WORLD
            <select value={worldId} onChange={(event) => {
              if (isWorldId(event.currentTarget.value)) switchWorld(event.currentTarget.value);
            }}>
              <option value="pelagic">01 / PELAGIC</option>
              <option value="styx">02 / STYX</option>
              <option value="y2k">03 / Y2K</option>
              <option value="hydros">04 / HYDROS</option>
              <option value="raymarch">05 / RAYMARCH</option>
            </select>
          </label>
          <div className="room-actions">
            <button className="share-room" type="button" onClick={resetParameters}>RESET</button>
            <button className="share-room" type="button" onClick={() => void shareRoom()}>SHARE</button>
            <span className={`live-indicator ${roomStatus}`} title={`${viewers} viewer${viewers === 1 ? '' : 's'} connected`}>
              {roomStatus === 'live' ? `${viewers} ONLINE · ${roomElapsed.toFixed(0)}s` : roomStatus.toUpperCase()}
            </span>
          </div>
        </div>
        <div className="parameter-grid">
        {worldId === 'pelagic' && (
          <>
            <ParameterControl
              label="Particle count"
              value={parameters.particleCount}
              min={12_000}
              max={100_000}
              step={4_000}
              onChange={(value) => updateParameter('particleCount', value)}
            />
            <ParameterControl
              label="Flow scale"
              value={parameters.flowScale}
              min={0.4}
              max={3}
              step={0.01}
              onChange={(value) => updateParameter('flowScale', value)}
            />
          </>
        )}
        <ParameterControl
          label={worldId === 'styx' ? 'Orbit speed' : worldId === 'y2k' ? 'Pulse speed' : worldId === 'hydros' ? 'Current speed' : worldId === 'raymarch' ? 'Pulse speed' : 'Flow strength'}
          value={parameters.flowStrength}
          min={0}
          max={1.5}
          step={0.01}
          onChange={(value) => updateParameter('flowStrength', value)}
        />
        {worldId === 'pelagic' && (
          <ParameterControl
            label="Confinement"
            value={parameters.confinement}
            min={0}
            max={2}
            step={0.01}
            onChange={(value) => updateParameter('confinement', value)}
          />
        )}
        <ParameterControl
          label={worldId === 'pelagic' ? 'World radius' : worldId === 'raymarch' ? 'Loop scale' : 'World scale'}
          value={parameters.radius}
          min={0.8}
          max={3}
          step={0.01}
          onChange={(value) => updateParameter('radius', value)}
        />
        <ParameterControl
          label="Time scale"
          value={parameters.timeScale}
          min={0}
          max={2}
          step={0.01}
          onChange={(value) => updateParameter('timeScale', value)}
        />
        {worldId === 'pelagic' && (
          <ParameterControl
            label="Particle sharpness"
            value={parameters.sharpness}
            min={0}
            max={1}
            step={0.01}
            onChange={(value) => updateParameter('sharpness', value)}
          />
        )}
        <ParameterControl
          label="Glow"
          value={parameters.glow}
          min={0}
          max={1}
          step={0.01}
          onChange={(value) => updateParameter('glow', value)}
        />
        {worldId === 'pelagic' && (
          <ParameterControl
            label="Particle size"
            value={parameters.particleSize}
            min={0.004}
            max={0.022}
            step={0.001}
            onChange={(value) => updateParameter('particleSize', value)}
          />
        )}
        </div>
        <p className="control-note">
          {worldId === 'pelagic'
            ? 'Seed, clock and controls are shared. Particle integration remains local, so late joins do not replay prior motion.'
            : 'World selection and controls are shared with everyone in this room. Motion is simulated locally on each device.'}
        </p>
        {engineError && <p className="engine-error" role="alert">Renderer: {engineError}</p>}
      </aside>
    </main>
  );
}