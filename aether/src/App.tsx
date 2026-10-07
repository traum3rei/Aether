import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { FirstWorldParameters } from './worlds/FirstWorld';
import { defaultFirstWorldParameters } from './worlds/FirstWorld';
import { isWorldId, worldNames, type WorldId } from './worlds/WorldId';
import { AetherEngine } from './engine/AetherEngine';
import { RoomClient, type RoomMessage } from './rooms/RoomClient';
import { MusicPlayer } from './MusicPlayer';
import { GeneralGraphEditor, graphStorageKey } from './GeneralGraphEditor';
import type { Graph } from './GeneralGraphEditor';
import { compileWorldDocument, isWorldDocument, serializeWorldDocument, type EditorGraphLike, type WorldDocument } from './worlds/WorldGraph';

type ExperienceMode = 'gallery' | 'studio' | 'live';
type CustomWorld = { id: string; name: string; baseWorldId?: WorldId };

function readCustomWorlds(): CustomWorld[] {
  try {
    const saved = localStorage.getItem('aether.custom-worlds.v1');
    const parsed = saved ? JSON.parse(saved) as unknown : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is CustomWorld => Boolean(entry && typeof entry.id === 'string' && entry.id.startsWith('custom-') && typeof entry.name === 'string' && (entry.baseWorldId === undefined || isWorldId(entry.baseWorldId))));
  } catch { return []; }
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

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<AetherEngine | null>(null);
  const engineReadyRef = useRef<Promise<void> | null>(null);
  const roomClientRef = useRef<RoomClient | null>(null);
  const [viewers, setViewers] = useState(1);
  const [roomElapsed, setRoomElapsed] = useState(0);
  const [panelVisible, setPanelVisible] = useState(false);
  const [experienceMode, setExperienceMode] = useState<ExperienceMode>('gallery');
  const [activeGraphId, setActiveGraphId] = useState<string | null>(null);
  const [customWorlds, setCustomWorlds] = useState<CustomWorld[]>(readCustomWorlds);
  const [moveStick, setMoveStick] = useState({ x: 0, y: 0 });
  const moveStickPointer = useRef<number | null>(null);
  const [roomStatus, setRoomStatus] = useState<'connecting' | 'live' | 'offline'>('connecting');
  const [engineError, setEngineError] = useState<string | null>(null);
  const [roomId] = useState(() => new URLSearchParams(window.location.search).get('room') ?? 'room-01');
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
    const receiveGraph = (graphWorldId: WorldId, graph: unknown, remote: boolean, graphId = graphWorldId, activate = true) => {
      if (!graph || typeof graph !== 'object') return;
      let document: WorldDocument;
      let runtimeGraph: ReturnType<typeof compileWorldDocument>;
      try {
        document = isWorldDocument(graph)
          ? graph
          : serializeWorldDocument(graph as EditorGraphLike, graphId, worldNames[graphWorldId]);
        runtimeGraph = compileWorldDocument(document);
        localStorage.setItem(graphStorageKey(graphId), JSON.stringify(document));
      } catch (error) {
        setEngineError(error instanceof Error ? error.message : String(error));
        return;
      }
      const customWorld = graphId.startsWith('custom-') ? readCustomWorlds().find((world) => world.id === graphId) : undefined;
      if (activate) runEngineAction((engine) => engine.setRenderGraph(runtimeGraph as import('./engine/GraphRenderer').RenderGraph, !customWorld?.baseWorldId));
      if (!remote && graphId === graphWorldId) client.sendGraphUpdate(roomId, graphWorldId, document);
    };
    const onGraph = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.fromRoom) return;
      if (!isWorldId(detail?.worldId) || !detail.graph) return;
      const graphId = typeof detail.graphId === 'string' ? detail.graphId : detail.worldId;
      receiveGraph(detail.worldId, detail.graph, Boolean(detail.remote), graphId);
    };
    window.addEventListener('aether:graph', onGraph);
    const onInputs = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.inputs) runEngineAction((engine) => engine.setRenderInputs(detail.inputs));
    };
    window.addEventListener('aether:render-inputs', onInputs);
    const initialParameters = parametersRef.current;
    const unsubscribe = client.subscribe((message: RoomMessage) => {
      if (message.type !== 'error' && message.roomId !== roomId) return;
      if (message.type === 'state') {
        if (message.graphs?.[message.worldId]) {
          receiveGraph(message.worldId, message.graphs[message.worldId], true, message.worldId, false);
          window.dispatchEvent(new CustomEvent('aether:graph', { detail: { fromRoom: true, remote: true, worldId: message.worldId, graphId: message.worldId, graph: message.graphs[message.worldId] } }));
        }
        const sharedWorldId = isWorldId(message.worldId) ? message.worldId : worldIdRef.current;
        setActiveGraphId(null);
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
        if (message.graph && isWorldId(message.graph.worldId)) {
          receiveGraph(message.graph.worldId, message.graph.value, true, message.graph.worldId, false);
          window.dispatchEvent(new CustomEvent('aether:graph', { detail: { fromRoom: true, remote: true, worldId: message.graph.worldId, graphId: message.graph.worldId, graph: message.graph.value } }));
        }
        const updates = message.parameters ?? {};
        const delay = Math.max(0, message.effectiveTime - Date.now());
        window.setTimeout(() => {
          const nextWorldId = isWorldId(message.worldId) ? message.worldId : undefined;
          if (nextWorldId) {
            setActiveGraphId(null);
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
      window.removeEventListener('aether:graph', onGraph);
      window.removeEventListener('aether:render-inputs', onInputs);
      client.disconnect();
      roomClientRef.current = null;
      window.removeEventListener('offline', handleOffline);
    };
  }, [roomId]);

  const switchWorld = (nextWorldId: WorldId) => {
    setActiveGraphId(null);
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

  const createCustomWorld = () => {
    const world = { id: `custom-${crypto.randomUUID()}`, name: 'Untitled world' };
    setCustomWorlds((current) => {
      const next = [...current, world];
      localStorage.setItem('aether.custom-worlds.v1', JSON.stringify(next));
      return next;
    });
    setActiveGraphId(world.id);
    setExperienceMode('studio');
    setPanelVisible(true);
  };

  const openCustomWorld = (world: CustomWorld) => {
    setActiveGraphId(world.id);
    setExperienceMode('gallery');
    setPanelVisible(false);
    try {
      const graph = localStorage.getItem(graphStorageKey(world.id));
      if (graph && world.baseWorldId) {
        worldIdRef.current = world.baseWorldId;
        setWorldId(world.baseWorldId);
        runEngineAction(async (engine) => {
          await engine.setWorld(world.baseWorldId!, parametersRef.current);
          await engine.setRenderGraph(JSON.parse(graph), false);
        });
      } else if (graph) {
        window.dispatchEvent(new CustomEvent('aether:graph', { detail: { worldId, graphId: world.id, graph: JSON.parse(graph) } }));
      }
    } catch { /* A missing graph opens as an empty network in Studio. */ }
  };

  const saveCustomWorld = (name: string, graph: Graph) => {
    const id = activeGraphId?.startsWith('custom-') ? activeGraphId : `custom-${crypto.randomUUID()}`;
    const document = serializeWorldDocument(graph as unknown as EditorGraphLike, id, name);
    localStorage.setItem(graphStorageKey(id), JSON.stringify(document));
    const baseWorldId = customWorlds.find((world) => world.id === id)?.baseWorldId ?? (activeGraphId ? undefined : worldId);
    setCustomWorlds((current) => {
      const existing = current.some((world) => world.id === id);
      const next = existing
        ? current.map((world) => world.id === id ? { ...world, name, baseWorldId } : world)
        : [...current, { id, name, baseWorldId }];
      localStorage.setItem('aether.custom-worlds.v1', JSON.stringify(next));
      return next;
    });
    setActiveGraphId(id);
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
    <main className="aether" data-world={worldId} data-mode={experienceMode}>
      <canvas ref={canvasRef} />
      <MusicPlayer onExpandedChange={(expanded) => {
        if (expanded) setPanelVisible(false);
      }} />
      <div className="movement-hint" aria-hidden="true">
        <span className="desktop-movement-hint">DRAG TO LOOK · WASD / ARROWS TO MOVE · R TO RETURN</span>
        <span className="touch-movement-hint">DRAG TO LOOK · JOYSTICK TO MOVE</span>
      </div>
      <div className="mobile-movement" role="group" aria-label="Movement controls">
        <button
          className="return-view"
          type="button"
          aria-label="Return to starting view"
          onClick={() => engineRef.current?.returnToStartView()}
        >
          RETURN
        </button>
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
            {activeGraphId?.startsWith('custom-') ? 'CREATED WORLD' : `WORLD ${worldId === 'pelagic' ? '01' : worldId === 'styx' ? '02' : worldId === 'y2k' ? '03' : worldId === 'hydros' ? '04' : '05'} · ${roomId.toUpperCase()}`}
          </span>
          <span className="world-name">{customWorlds.find((world) => world.id === activeGraphId)?.name ?? worldNames[worldId]}</span>
        </div>
        <nav className="experience-switch" aria-label="Experience">
          <button type="button" className={experienceMode === 'gallery' ? 'active' : ''} onClick={() => { setExperienceMode('gallery'); setPanelVisible(false); if (!activeGraphId) runEngineAction((engine) => engine.setWorld(worldIdRef.current, parametersRef.current)); }}>GALLERY</button>
          <button type="button" className={experienceMode === 'studio' ? 'active' : ''} onClick={() => { setExperienceMode('studio'); setPanelVisible(true); }}>STUDIO</button>
          <button type="button" className={experienceMode === 'live' ? 'active' : ''} onClick={() => { setExperienceMode('live'); setPanelVisible(false); }}>LIVE</button>
          {experienceMode === 'gallery' && !activeGraphId && <button type="button" onClick={() => void shareRoom()}>SHARE</button>}
        </nav>
        <div className={`room-presence ${activeGraphId ? '' : roomStatus}`}>{activeGraphId ? 'SAVED ON THIS DEVICE' : roomStatus === 'live' ? `${viewers} HERE · ${Math.floor(roomElapsed / 60)}:${String(Math.floor(roomElapsed % 60)).padStart(2, '0')}` : 'LOCAL WORLD'}</div>
      </header>

      {experienceMode === 'live' && <button className="live-return" type="button" onClick={() => { setExperienceMode('gallery'); if (!activeGraphId) runEngineAction((engine) => engine.setWorld(worldIdRef.current, parametersRef.current)); }}>EXIT LIVE</button>}

      {experienceMode !== 'live' && <nav className="gallery-worlds" aria-label="Worlds">
        {(Object.keys(worldNames) as WorldId[]).map((id, index) => (
          <button key={id} type="button" className={id === worldId ? 'active' : ''} onClick={() => switchWorld(id)} aria-current={id === worldId ? 'page' : undefined}>
            <span>{String(index + 1).padStart(2, '0')}</span>{worldNames[id]}
          </button>
        ))}
        {customWorlds.map((world, index) => <button key={world.id} type="button" className={activeGraphId === world.id ? 'active' : ''} aria-current={activeGraphId === world.id ? 'page' : undefined} onClick={() => openCustomWorld(world)}>
          <span>C{String(index + 1).padStart(2, '0')}</span>{world.name}
        </button>)}
        {experienceMode === 'gallery' && <button type="button" className="create-world-button" onClick={createCustomWorld}><span>＋</span>CREATE WORLD</button>}
      </nav>}

      {experienceMode === 'studio' && <button
        className="panel-reveal"
        type="button"
        aria-expanded={panelVisible}
        aria-controls="world-controls"
        onClick={() => setPanelVisible((visible) => !visible)}
      >
        {panelVisible ? 'HIDE STUDIO' : 'SHAPE WORLD'}
      </button>}

      {experienceMode === 'studio' && panelVisible && <GeneralGraphEditor
        key={activeGraphId ?? worldId}
        worldId={worldId}
        graphId={activeGraphId ?? worldId}
        title={customWorlds.find((world) => world.id === activeGraphId)?.name ?? worldNames[worldId]}
        onSaveWorld={saveCustomWorld}
      />}
      {engineError && <div className="engine-error renderer-error" role="alert">Renderer · {engineError}</div>}
    </main>
  );
}
