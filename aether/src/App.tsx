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

type NodeType = 'source' | 'noise' | 'force' | 'integrate' | 'render';
type GraphNode = { id: string; title: string; type: NodeType; x: number; y: number; values: Partial<FirstWorldParameters> };
type GraphLink = { id: string; from: string; to: string };
type WorldProjectGraph = { nodes: GraphNode[]; links: GraphLink[] };

function createWorldGraph(parameters: FirstWorldParameters): WorldProjectGraph {
  return {
    nodes: [
      { id: 'source', title: 'PARTICLE SOURCE', type: 'source', x: 55, y: 130, values: { particleCount: parameters.particleCount, radius: parameters.radius, seed: parameters.seed } },
      { id: 'noise', title: 'NOISE FIELD', type: 'noise', x: 335, y: 65, values: { flowScale: parameters.flowScale, flowStrength: parameters.flowStrength } },
      { id: 'force', title: 'RADIAL FORCE', type: 'force', x: 615, y: 65, values: { confinement: parameters.confinement } },
      { id: 'integrate', title: 'INTEGRATOR', type: 'integrate', x: 615, y: 340, values: { damping: parameters.damping, timeScale: parameters.timeScale } },
      { id: 'render', title: 'PARTICLE RENDER', type: 'render', x: 895, y: 205, values: { particleSize: parameters.particleSize, sharpness: parameters.sharpness, glow: parameters.glow } },
    ],
    links: [
      { id: 'source-noise', from: 'source', to: 'noise' }, { id: 'noise-force', from: 'noise', to: 'force' },
      { id: 'force-integrate', from: 'force', to: 'integrate' }, { id: 'integrate-render', from: 'integrate', to: 'render' },
    ],
  };
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<AetherEngine | null>(null);
  const engineReadyRef = useRef<Promise<void> | null>(null);
  const roomClientRef = useRef<RoomClient | null>(null);
  const [viewers, setViewers] = useState(1);
  const [roomElapsed, setRoomElapsed] = useState(0);
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
  const [selectedNode, setSelectedNode] = useState('noise');
  const [nodeMenuOpen, setNodeMenuOpen] = useState(false);
  const [graphProjects, setGraphProjects] = useState<Record<string, WorldProjectGraph>>(() => {
    try {
      const stored = localStorage.getItem('aether.world-projects.v1');
      return stored ? JSON.parse(stored) as Record<string, WorldProjectGraph> : {};
    } catch { return {}; }
  });
  const graphNodes = graphProjects[worldId]?.nodes ?? createWorldGraph(parameters).nodes;
  const graphLinks = graphProjects[worldId]?.links ?? createWorldGraph(parameters).links;
  const setGraphNodes = (update: GraphNode[] | ((nodes: GraphNode[]) => GraphNode[])) => {
    setGraphProjects((projects) => {
      const projectId = worldIdRef.current;
      const current = projects[projectId] ?? createWorldGraph(parametersRef.current);
      const nodes = typeof update === 'function' ? update(current.nodes) : update;
      return { ...projects, [projectId]: { ...current, nodes } };
    });
  };
  const setGraphLinks = (update: GraphLink[] | ((links: GraphLink[]) => GraphLink[])) => {
    setGraphProjects((projects) => {
      const projectId = worldIdRef.current;
      const current = projects[projectId] ?? createWorldGraph(parametersRef.current);
      const links = typeof update === 'function' ? update(current.links) : update;
      return { ...projects, [projectId]: { ...current, links } };
    });
  };
  useEffect(() => { localStorage.setItem('aether.world-projects.v1', JSON.stringify(graphProjects)); }, [graphProjects]);
  const [pendingOutput, setPendingOutput] = useState<string | null>(null);
  const draggingNode = useRef<{ id: string; x: number; y: number } | null>(null);

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
    setGraphNodes((nodes) => nodes.map((node) => ({ ...node, values: Object.fromEntries(graphParameterKeys[node.type].map((key) => [key, defaultFirstWorldParameters[key]])) })));
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

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = draggingNode.current;
      if (!drag) return;
      setGraphNodes((nodes) => nodes.map((node) => node.id === drag.id
        ? { ...node, x: Math.max(12, drag.x + event.clientX), y: Math.max(70, drag.y + event.clientY) }
        : node));
    };
    const end = () => { draggingNode.current = null; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); };
  }, []);

  const addGraphNode = (type: NodeType) => {
    const title = type === 'noise' ? 'NOISE FIELD' : type === 'force' ? 'RADIAL FORCE' : type === 'integrate' ? 'INTEGRATOR' : type === 'source' ? 'PARTICLE SOURCE' : 'PARTICLE RENDER';
    const id = `${type}-${Date.now()}`;
    setGraphNodes((nodes) => [...nodes, { id, title, type, x: 160 + Math.random() * 260, y: 140 + Math.random() * 250, values: { ...parameters } }]);
    setSelectedNode(id);
    setNodeMenuOpen(false);
  };

  const graphParameterKeys: Record<NodeType, Array<keyof FirstWorldParameters>> = {
    source: ['particleCount', 'radius', 'seed'], noise: ['flowScale', 'flowStrength'],
    force: ['confinement'], integrate: ['damping', 'timeScale'], render: ['particleSize', 'sharpness', 'glow'],
  };
  const activeGraphNodes = (nodes: GraphNode[], links: GraphLink[]) => {
    const reached = new Set<string>(nodes.filter((node) => node.type === 'source').map((node) => node.id));
    let changed = true;
    while (changed) {
      changed = false;
      for (const link of links) if (reached.has(link.from) && !reached.has(link.to)) { reached.add(link.to); changed = true; }
    }
    const outputs = new Set<string>(nodes.filter((node) => node.type === 'render').map((node) => node.id));
    changed = true;
    while (changed) {
      changed = false;
      for (const link of links) if (outputs.has(link.to) && !outputs.has(link.from)) { outputs.add(link.from); changed = true; }
    }
    return nodes.filter((node) => reached.has(node.id) && outputs.has(node.id));
  };
  const graphOutput = (nodes: GraphNode[], links: GraphLink[]) => {
    const active = activeGraphNodes(nodes, links);
    const next: Partial<FirstWorldParameters> = { flowStrength: 0, confinement: 0, timeScale: 1, glow: 0 };
    for (const node of active) for (const parameter of graphParameterKeys[node.type]) if (node.values[parameter] !== undefined) next[parameter] = node.values[parameter];
    if (!active.some((node) => node.type === 'noise')) next.flowStrength = 0;
    if (!active.some((node) => node.type === 'force')) next.confinement = 0;
    if (!active.some((node) => node.type === 'integrate')) next.timeScale = 0;
    if (!active.some((node) => node.type === 'render')) next.glow = 0;
    return next;
  };
  const applyGraph = (nodes: GraphNode[], links: GraphLink[]) => {
    const output = graphOutput(nodes, links);
    runEngineAction((engine) => engine.setWorldParameters(output));
  };
  const updateNodeParameter = (nodeId: string, key: keyof FirstWorldParameters, value: number) => {
    const nodes = graphNodes.map((node) => node.id === nodeId ? { ...node, values: { ...node.values, [key]: value } } : node);
    setGraphNodes(nodes);
    const next = graphOutput(nodes, graphLinks);
    const merged = readParameters({ ...parameters, ...next });
    parametersRef.current = merged;
    setParameters(merged);
    setRooms((current) => { const updated = { ...current, [roomId]: merged }; localStorage.setItem('aether.rooms.v1', JSON.stringify(updated)); return updated; });
    if (!roomClientRef.current?.sendUpdate(roomId, next)) setRoomStatus('offline');
    runEngineAction((engine) => engine.setWorldParameters(next));
  };
  const connectGraphNodes = (from: string, to: string) => {
    const source = graphNodes.find((node) => node.id === from);
    const target = graphNodes.find((node) => node.id === to);
    if (!source || !target || from === to || target.type === 'source' || source.type === 'render') return;
    const order: NodeType[] = ['source', 'noise', 'force', 'integrate', 'render'];
    if (order.indexOf(source.type) >= order.indexOf(target.type)) return;
    const links = [...graphLinks.filter((link) => link.to !== to), { id: `${from}-${to}-${Date.now()}`, from, to }];
    setGraphLinks(links);
    setPendingOutput(null);
    applyGraph(graphNodes, links);
  };
  const disconnectGraphLink = (linkId: string) => {
    const links = graphLinks.filter((link) => link.id !== linkId);
    setGraphLinks(links);
    applyGraph(graphNodes, links);
  };
  const removeGraphNode = (nodeId: string) => {
    const nodes = graphNodes.filter((node) => node.id !== nodeId);
    const links = graphLinks.filter((link) => link.from !== nodeId && link.to !== nodeId);
    setGraphNodes(nodes);
    setGraphLinks(links);
    if (selectedNode === nodeId) setSelectedNode('');
    applyGraph(nodes, links);
  };

  return (
    <main className="aether node-studio" data-world={worldId}>
      <section className="editor-pane" aria-label="Node editor">
        <header className="studio-topbar">
          <div className="studio-brand"><span className="brand-glyph">A</span><span>AETHER <i>/</i> STUDIO</span></div>
          <div className="project-crumb"><span>PROJECT</span><b>{worldNames[worldId].toUpperCase()}</b><small>·</small><span>{roomId.toUpperCase()}</span></div>
          <div className="topbar-actions">
            <span className={`project-status ${roomStatus}`}><i />{roomStatus === 'live' ? 'SYNCED' : 'LOCAL'}</span>
            <button type="button" onClick={resetParameters}>RESET</button>
            <button type="button" onClick={() => void shareRoom()}>SHARE</button>
          </div>
        </header>
        <div className="workspace-heading">
          <div><span className="eyebrow">WORLD PROJECT / {worldId === 'pelagic' ? '01' : worldId === 'styx' ? '02' : worldId === 'y2k' ? '03' : worldId === 'hydros' ? '04' : '05'}</span><h1>{worldNames[worldId]}</h1></div>
          <div className="room-picker"><span>PROJECT</span><select value={worldId} onChange={(event) => { if (isWorldId(event.currentTarget.value)) switchWorld(event.currentTarget.value); }} aria-label="Open world project"><option value="pelagic">01 / PELAGIC</option><option value="styx">02 / STYX</option><option value="y2k">03 / Y2K</option><option value="hydros">04 / HYDROS</option><option value="raymarch">05 / RAYMARCH</option></select><label>ROOM <select value={roomId} onChange={(event) => switchRoom(event.currentTarget.value)}><option value="room-01">01 / ABYSS</option><option value="room-02">02 / BLOOM</option><option value="room-03">03 / DRIFT</option><option value="room-04">04 / DREAM CIRCUIT</option><option value="room-05">05 / GHOST CIRCUIT</option></select></label></div>
        </div>
        <div className="graph-toolbar"><div className="graph-tabs"><button className="active" type="button">NETWORK <span>{graphNodes.length.toString().padStart(2, '0')}</span></button></div><div className="graph-actions"><span>● {activeGraphNodes(graphNodes, graphLinks).length} ACTIVE</span><button type="button" onClick={() => setNodeMenuOpen((open) => !open)}>＋ ADD NODE</button>{nodeMenuOpen && <div className="node-add-menu">{(['source','noise','force','integrate','render'] as const).map((type) => <button type="button" key={type} onClick={() => addGraphNode(type)}>＋ {type.toUpperCase()}</button>)}</div>}</div></div>
        <div className="graph-viewport" onPointerDown={(event) => { if (event.target === event.currentTarget) setSelectedNode(''); }}>
          <div className="graph-grid" />
          <svg className="graph-wires">{graphLinks.map((link) => { const from = graphNodes.find((node) => node.id === link.from); const to = graphNodes.find((node) => node.id === link.to); if (!from || !to) return null; const active = activeGraphNodes(graphNodes, graphLinks).some((node) => node.id === from.id) && activeGraphNodes(graphNodes, graphLinks).some((node) => node.id === to.id); return <path className={active ? '' : 'inactive'} key={link.id} d={`M ${from.x + 226} ${from.y + 56} C ${from.x + 285} ${from.y + 56}, ${to.x - 55} ${to.y + 56}, ${to.x} ${to.y + 56}`} onClick={() => disconnectGraphLink(link.id)} />; })}</svg>
          {graphNodes.map((node) => <article key={node.id} className={`graph-node node-${node.type} ${selectedNode === node.id ? 'selected' : ''} ${activeGraphNodes(graphNodes, graphLinks).some((item) => item.id === node.id) ? '' : 'bypassed'}`} style={{ left: node.x, top: node.y }} onPointerDown={(event) => { if ((event.target as HTMLElement).closest('button,input,select')) return; draggingNode.current = { id: node.id, x: node.x - event.clientX, y: node.y - event.clientY }; setSelectedNode(node.id); }} onClick={() => setSelectedNode(node.id)}>
            <div className="node-titlebar"><span className="node-icon">{node.type === 'source' ? '◉' : node.type === 'noise' ? '∿' : node.type === 'force' ? '⊙' : node.type === 'integrate' ? '↝' : '◌'}</span><span>{node.title}</span><button aria-label={`Remove ${node.title} node`} type="button" onClick={() => removeGraphNode(node.id)}>×</button></div>
            <div className="node-subtitle">{node.type === 'source' ? 'INITIAL DISTRIBUTION' : node.type === 'noise' ? 'GPU VECTOR FIELD' : node.type === 'force' ? 'RADIAL CONSTRAINT' : node.type === 'integrate' ? 'VELOCITY INTEGRATION' : 'ADDITIVE SPRITES'}</div>
            {node.type !== 'source' && <button className={`node-port input-port ${graphLinks.some((link) => link.to === node.id) ? 'connected' : ''}`} type="button" aria-label={`Connect input on ${node.title}`} title={pendingOutput ? 'Connect from selected output' : 'Select an output port first'} onClick={(event) => { event.stopPropagation(); if (pendingOutput) connectGraphNodes(pendingOutput, node.id); }} />}
            {node.type === 'source' && <div className="node-port-row"><span className="port-label">COUNT</span><b>{Number(node.values.particleCount ?? parameters.particleCount).toLocaleString()}</b><span className="port-label">RADIUS {Number(node.values.radius ?? parameters.radius).toFixed(2)}</span></div>}
            {node.type === 'noise' && <div className="node-port-row"><span className="port-label">SCALE</span><b>{Number(node.values.flowScale ?? parameters.flowScale).toFixed(2)}</b><span className="port-label">GAIN {Number(node.values.flowStrength ?? parameters.flowStrength).toFixed(2)}</span></div>}
            {node.type === 'force' && <div className="node-port-row"><span className="port-label">CONFINEMENT</span><b>{Number(node.values.confinement ?? parameters.confinement).toFixed(2)}</b></div>}
            {node.type === 'integrate' && <div className="node-port-row"><span className="port-label">DAMPING</span><b>{Number(node.values.damping ?? parameters.damping).toFixed(3)}</b><span className="port-label">TIME {Number(node.values.timeScale ?? parameters.timeScale).toFixed(2)}</span></div>}
            {node.type === 'render' && <div className="node-port-row"><span className="port-label">SIZE</span><b>{Number(node.values.particleSize ?? parameters.particleSize).toFixed(3)}</b><span className="port-label">GLOW {Number(node.values.glow ?? parameters.glow).toFixed(2)}</span></div>}
            {node.type !== 'render' && <button className={`node-port output-port ${pendingOutput === node.id ? 'armed' : ''} ${graphLinks.some((link) => link.from === node.id) ? 'connected' : ''}`} type="button" aria-label={`Start connection from ${node.title}`} title="Click, then choose a downstream input" onClick={(event) => { event.stopPropagation(); setPendingOutput(node.id); }} />}
          </article>)}
          <div className="graph-zoom">CLICK OUTPUT → INPUT <span>·</span> CLICK WIRE TO REMOVE</div><div className="graph-hint">DRAG NODES <span>·</span> SELECT NODE TO EDIT</div>
        </div>
        {selectedNode && <aside className="inspector"><div className="inspector-head"><div><span className="eyebrow">NODE INSPECTOR</span><h2>{graphNodes.find((node) => node.id === selectedNode)?.title ?? 'NODE'}</h2></div><button type="button" aria-label="Close node inspector" onClick={() => setSelectedNode('')}>×</button></div>
          <div className="inspector-controls">{(() => { const node = graphNodes.find((item) => item.id === selectedNode); if (!node) return <p>Select a node to inspect its settings.</p>; const control = (key: keyof FirstWorldParameters, label: string, min: number, max: number, step: number) => <ParameterControl key={key} label={label} value={Number(node.values[key] ?? parameters[key])} min={min} max={max} step={step} onChange={(value) => updateNodeParameter(node.id, key, value)} />; return node.type === 'source' ? <>{control('particleCount','Particle count',12000,100000,4000)}{control('radius','Distribution radius',0.8,3,0.01)}{control('seed','Seed',1,1000,1)}</> : node.type === 'noise' ? <>{control('flowScale','Field scale',0.4,3,0.01)}{control('flowStrength','Field strength',0,1.5,0.01)}</> : node.type === 'force' ? control('confinement','Radial confinement',0,2,0.01) : node.type === 'integrate' ? <>{control('damping','Velocity damping',0.9,1,0.001)}{control('timeScale','Time scale',0,2,0.01)}</> : <>{control('particleSize','Particle size',0.004,0.022,0.001)}{control('sharpness','Sprite sharpness',0,1,0.01)}{control('glow','Glow',0,1,0.01)}</>; })()}</div>
          <p className="inspector-foot">Changes update the live project immediately.</p>
        </aside>}
        <div className="graph-statusbar"><span>● {graphNodes.length} NODES</span><span>WEBGPU <i>·</i> {parameters.particleCount.toLocaleString()} PARTICLES</span><span>{roomStatus === 'live' ? `${viewers} VIEWERS · ${roomElapsed.toFixed(0)}s` : 'LOCAL PROJECT'}</span></div>
      </section>
      <section className="preview-pane" aria-label="Live world preview">
        <div className="preview-head"><span><i className="preview-live-dot" />VIEWPORT</span><span>REALTIME <b>↗</b></span></div>
        <div className="preview-canvas"><canvas ref={canvasRef} /><div className="preview-world-label"><span>WORLD 01</span><b>{worldNames[worldId].toUpperCase()}</b></div><div className="preview-help">DRAG TO LOOK <i>·</i> WASD TO MOVE</div><button className="preview-return" type="button" onClick={() => engineRef.current?.returnToStartView()}>RESET VIEW</button>
          <div className="mobile-movement"><button className="return-view" type="button" onClick={() => engineRef.current?.returnToStartView()}>RETURN</button><button className="move-joystick" type="button" aria-label="Move with joystick" onPointerDown={(event) => { moveStickPointer.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); updateMoveStick(event); }} onPointerMove={updateMoveStick} onPointerUp={stopMoveStick} onPointerCancel={stopMoveStick}><span className="move-joystick-thumb" style={{ transform: `translate(${moveStick.x * 25}px, ${moveStick.y * 25}px)` }} /></button></div>
        </div>
        <div className="preview-footer"><span>SIMULATION</span><strong>{worldNames[worldId].toUpperCase()} FIELD</strong><span>SEED {parameters.seed}</span></div>
      </section>
      <MusicPlayer onExpandedChange={() => {}} />
      {engineError && <div className="studio-error" role="alert">Renderer: {engineError}</div>}
    </main>
  );
}
