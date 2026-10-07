import { useEffect, useMemo, useRef, useState } from 'react';
import type { WorldId } from './worlds/WorldId';
import { deserializeWorldDocument, inferWorldPorts, isWorldDocument, serializeWorldDocument, type EditorGraphLike } from './worlds/WorldGraph';

type Kind = 'input' | 'math' | 'clamp' | 'remap' | 'noise' | 'lfo' | 'switch' | 'compare' | 'quantize' | 'geometry' | 'transform' | 'deform' | 'material' | 'particles' | 'water' | 'model' | 'environment' | 'camera' | 'postfx' | 'render';
type InputMode = 'constant' | 'time' | 'mouseX' | 'mouseY' | 'pointer' | 'key' | 'audio' | 'bass' | 'mid' | 'highBand';
type Node = { id: string; kind: Kind; x: number; y: number; label: string; mode?: InputMode; operation?: string; key?: string; value: number; low?: number; high?: number; bypass?: boolean; shape?: string; color?: string; position?: { x: number; y: number; z: number }; target?: { x: number; y: number; z: number } };
type Link = { id: string; from: string; to: string };
export type Graph = { nodes: Node[]; links: Link[] };
type Props = { worldId: WorldId; graphId?: string; title?: string; onSaveWorld?: (name: string, graph: Graph) => void };

export const graphStorageKey = (id: string) => `aether.graph.general.${id}.v3`;
const legacyGraphStorageKey = (id: string) => `aether.graph.general.${id}.v2`;
const titles: Record<Kind, string> = { input: 'Input', math: 'Math', clamp: 'Clamp', remap: 'Range Map', noise: 'Noise', lfo: 'LFO', switch: 'Switch', compare: 'Compare', quantize: 'Quantize', geometry: 'Geometry Field', transform: 'Transform', deform: 'Noise Deformation', material: 'Surface Material', particles: 'Particles', water: 'Water Surface', model: '3D Model', environment: 'Environment', camera: 'Camera', postfx: 'Post Processing', render: 'World Output' };
const createNode = (kind: Kind, x: number, y: number, id = `${kind}-${crypto.randomUUID()}`): Node => ({
  id, kind, x, y, label: kind === 'input' ? 'Value' : titles[kind], value: kind === 'input' ? 1 : kind === 'particles' ? 2200 : ['geometry','water','model','transform'].includes(kind) ? 1 : kind === 'deform' ? .2 : kind === 'material' ? .32 : kind === 'environment' ? .018 : kind === 'camera' ? 50 : kind === 'postfx' ? .55 : 0,
  low: kind === 'deform' ? .25 : .08, high: kind === 'deform' ? 3.2 : kind === 'material' ? .2 : kind === 'particles' ? 1.4 : 1, mode: kind === 'input' ? 'constant' : undefined,
  operation: kind === 'math' ? 'add' : kind === 'compare' ? 'greater' : undefined,
  position: kind === 'camera' ? { x: 0, y: 0, z: 4 } : undefined,
  target: kind === 'camera' ? { x: 0, y: 0, z: 0 } : undefined,
  shape: kind === 'geometry' ? 'icosahedron' : undefined,
  color: ['geometry','material'].includes(kind) ? '#61d5c1' : kind === 'particles' ? '#ffd477' : kind === 'water' ? '#258fc2' : kind === 'model' ? '#dc87d4' : ['render','environment'].includes(kind) ? '#020202' : undefined,
});
const outputId = (id: WorldId) => `render-${id}`;
function blankWorld(id: WorldId): Graph {
  return { nodes: [createNode('render', 520, 160, outputId(id))], links: [] };
}
function normalizeGraph(value: unknown, worldId: WorldId): Graph {
  if (isWorldDocument(value)) return normalizeGraph(deserializeWorldDocument(value), worldId);
  if (!value || typeof value !== 'object') return blankWorld(worldId);
  const graph = value as Partial<Graph>;
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.links)) return blankWorld(worldId);
  const nodes = graph.nodes as Node[];
  const output = nodes.find((node) => node.kind === 'render') ?? createNode('render', 820, 140, outputId(worldId));
  const kept = [...nodes.filter((node) => node.kind !== 'render'), { ...output, id: outputId(worldId), kind: 'render' as const }];
  const ids = new Set(kept.map((node) => node.id));
  return { nodes: kept, links: (graph.links as Link[]).filter((link) => ids.has(link.from) && ids.has(link.to)) };
}
const examples: Record<string, { title: string; build: () => Graph }> = {
  sculpture: { title: 'Abyssal noise sculpture', build: () => ({ nodes: [
    { ...createNode('geometry', 80, 130, 'example-sculpture'), label: 'Seed form', shape: 'torusKnot', value: 1.45, color: '#498caa' },
    { ...createNode('deform', 380, 150, 'example-deform'), label: 'Flowing field', value: .42, high: 4.8, low: .16 },
    { ...createNode('material', 680, 150, 'example-surface'), label: 'Deep bioluminescence', color: '#8b61d4', value: .58, high: .16 },
    { ...createNode('lfo', 380, 390, 'example-flow'), label: 'Slow current', high: .34 },
  ], links: [
    { id: 'sculpt-1', from: 'example-sculpture', to: 'example-deform' },
    { id: 'sculpt-2', from: 'example-deform', to: 'example-surface' },
    { id: 'sculpt-3', from: 'example-flow', to: 'example-deform' },
  ] }) },
  particles: { title: 'LFO driven particles', build: () => ({ nodes: [
    { ...createNode('lfo', 70, 100, 'example-lfo'), label: 'Pulse', high: 1.2 },
    { ...createNode('particles', 390, 100, 'example-particles'), label: 'Particle field', value: 2800 },
  ], links: [{ id: 'example-drive', from: 'example-lfo', to: 'example-particles' }] }) },
  water: { title: 'Animated water surface', build: () => ({ nodes: [
    { ...createNode('noise', 70, 100, 'example-noise'), label: 'Wave modulation', value: .7 },
    { ...createNode('water', 390, 100, 'example-water'), label: 'Water', value: 1.5 },
  ], links: [{ id: 'example-drive', from: 'example-noise', to: 'example-water' }] }) },
  model: { title: 'Signal scaled model', build: () => ({ nodes: [
    { ...createNode('lfo', 70, 100, 'example-lfo'), label: 'Scale pulse', high: .7 },
    { ...createNode('model', 390, 100, 'example-model'), label: 'Spiral', value: 1.3, color: '#f08bdb' },
  ], links: [{ id: 'example-drive', from: 'example-lfo', to: 'example-model' }] }) },
};

export function GeneralGraphEditor({ worldId, graphId = worldId, title = worldId, onSaveWorld }: Props) {
  const [graph, setGraph] = useState<Graph>(() => {
    try {
      const stored = localStorage.getItem(graphStorageKey(graphId)) ?? localStorage.getItem(legacyGraphStorageKey(graphId));
      if (stored) return normalizeGraph(JSON.parse(stored), worldId);
    } catch { /* Use the starter network. */ }
    return blankWorld(worldId);
  });
  const latestGraph = useRef(graph);
  latestGraph.current = graph;
  const [selected, setSelected] = useState('');
  const [pendingWire, setPendingWire] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [preset, setPreset] = useState('');
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState(title);
  const [zoom, setZoom] = useState(.54);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [inputs, setInputs] = useState({ x: .5, y: .5, pointer: 0, keys: [] as string[] });
  const drag = useRef<{ id: string; x: number; y: number } | null>(null);
  const panStart = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const current = graph.nodes.find((node) => node.id === selected);
  const visualCurrent = current && ['geometry','transform','deform','material','particles','water','model'].includes(current.kind) ? current : null;
  const connected = useMemo(() => new Set(graph.links.map((edge) => edge.from)), [graph.links]);

  const documentFor = (value: Graph) => serializeWorldDocument(value as unknown as EditorGraphLike, graphId, title);
  const emitGraph = (value: Graph, remote = false) => window.dispatchEvent(new CustomEvent('aether:graph', { detail: { remote, worldId, graphId, graph: documentFor(value) } }));
  useEffect(() => { localStorage.setItem(graphStorageKey(graphId), JSON.stringify(documentFor(graph))); }, [graph, graphId, title]);
  useEffect(() => { const initialGraph = latestGraph.current; const timer = window.setTimeout(() => emitGraph(initialGraph), 0); return () => window.clearTimeout(timer); }, [graphId, worldId]);
  useEffect(() => { window.dispatchEvent(new CustomEvent('aether:render-inputs', { detail: { worldId, inputs } })); }, [worldId, inputs]);
  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (drag.current) {
        const d = drag.current;
        setGraph((value) => ({ ...value, nodes: value.nodes.map((node) => node.id === d.id ? { ...node, x: Math.max(0, d.x + (event.clientX - pan.x) / zoom), y: Math.max(0, d.y + (event.clientY - pan.y) / zoom) } : node) }));
      } else if (panStart.current) {
        const p = panStart.current;
        setPan({ x: p.px + event.clientX - p.x, y: p.py + event.clientY - p.y });
      }
    };
    const end = () => {
      if (drag.current) emitGraph(latestGraph.current);
      drag.current = null; panStart.current = null;
    };
    const pointer = (event: PointerEvent) => setInputs((v) => ({ ...v, x: Math.max(0, Math.min(1, event.clientX / innerWidth)), y: Math.max(0, Math.min(1, event.clientY / innerHeight)) }));
    const down = () => setInputs((v) => ({ ...v, pointer: 1 }));
    const up = () => setInputs((v) => ({ ...v, pointer: 0 }));
    const keydown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)) return;
      setInputs((v) => v.keys.includes(event.key.toLowerCase()) ? v : ({ ...v, keys: [...v.keys, event.key.toLowerCase()] }));
    };
    const keyup = (event: KeyboardEvent) => setInputs((v) => ({ ...v, pointer: 0, keys: v.keys.filter((key) => key !== event.key.toLowerCase()) }));
    window.addEventListener('pointermove', move); window.addEventListener('pointermove', pointer); window.addEventListener('pointerup', end); window.addEventListener('pointerdown', down); window.addEventListener('pointerup', up); window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointermove', pointer); window.removeEventListener('pointerup', end); window.removeEventListener('pointerdown', down); window.removeEventListener('pointerup', up); window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); };
  }, [pan, zoom]);
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!detail?.remote || detail.worldId !== worldId || detail.graphId !== graphId || !detail.graph) return;
      const restored = normalizeGraph(detail.graph, worldId);
      setGraph(restored); setPendingWire(null);
    };
    window.addEventListener('aether:graph', receive);
    return () => window.removeEventListener('aether:graph', receive);
  }, [graphId, worldId]);

  const commit = (next: Graph) => { setGraph(next); emitGraph(next); };
  const add = (kind: Kind) => {
    if (kind === 'render') return;
    const count = graph.nodes.filter((node) => node.kind !== 'render').length;
    const node = createNode(kind, 90 + (count % 3) * 300, 60 + Math.floor(count / 3) * 180);
    const output = graph.nodes.find((entry) => entry.kind === 'render');
    const renderable = ['geometry','particles','water','model','environment','camera','postfx'].includes(kind);
    commit({ ...graph, nodes: [...graph.nodes, node], links: renderable && output ? [...graph.links, { id: crypto.randomUUID(), from: node.id, to: output.id }] : graph.links });
    setSelected(node.id); setMenuOpen(false);
  };
  const connect = (from: string, to: string) => {
    if (from === to || graph.links.some((edge) => edge.from === from && edge.to === to)) return;
    const source = graph.nodes.find((node) => node.id === from);
    const destination = graph.nodes.find((node) => node.id === to);
    if (!source || !destination || !inferWorldPorts(source.kind, destination.kind)) return;
    const pending = [to]; const seen = new Set<string>();
    while (pending.length) { const id = pending.pop()!; if (id === from) return; if (seen.has(id)) continue; seen.add(id); graph.links.filter((edge) => edge.from === id).forEach((edge) => pending.push(edge.to)); }
    commit({ ...graph, links: [...graph.links, { id: crypto.randomUUID(), from, to }] }); setPendingWire(null);
  };
  const edit = (id: string, values: Partial<Node>) => commit({ ...graph, nodes: graph.nodes.map((node) => node.id === id ? { ...node, ...values } : node) });
  const remove = (id: string) => {
    if (graph.nodes.find((node) => node.id === id)?.kind === 'render') return;
    commit({ nodes: graph.nodes.filter((node) => node.id !== id), links: graph.links.filter((edge) => edge.from !== id && edge.to !== id) }); setSelected('');
  };
  const loadExample = (id: string) => {
    const sample = examples[id]?.build(); if (!sample) return;
    const prefixes = ['example-'];
    const nodes = graph.nodes.filter((node) => !prefixes.some((prefix) => node.id.startsWith(prefix)));
    const links = graph.links.filter((edge) => nodes.some((node) => node.id === edge.from) && nodes.some((node) => node.id === edge.to));
    const offset = Math.max(0, ...nodes.map((node) => node.x)) + 360;
    const sampleNodes = sample.nodes.map((node) => ({ ...node, x: node.x + offset }));
    const output = nodes.find((node) => node.kind === 'render');
    const materialOutputs = sampleNodes.filter((node) => node.kind === 'material');
    const renderTargets = materialOutputs.length ? materialOutputs : sampleNodes.filter((node) => ['geometry','particles','water','model'].includes(node.kind));
    const renderLinks = output ? renderTargets.map((node) => ({ id: crypto.randomUUID(), from: node.id, to: output.id })) : [];
    commit({ nodes: [...nodes, ...sampleNodes], links: [...links, ...sample.links, ...renderLinks] });
    setSelected(sampleNodes[0]?.id ?? ''); setPan({ x: -offset * zoom + 100, y: 0 }); setPreset('');
  };

  return <div className="graph-shell general-graph-shell">
    <div className="graph-toolbar">
      <div className="network-name"><span className="network-dot"/> {title.toUpperCase()} <small>/ {graph.nodes.length} NODES · ONE RENDER OUTPUT</small></div>
      <div className="graph-toolbar-actions">
        {onSaveWorld && <button type="button" onClick={() => { setSaveName(title); setSaveOpen(true); }}>{graphId.startsWith('custom-') ? 'SAVE WORLD' : 'SAVE AS WORLD'}</button>}
        <label className="graph-example"><span>STARTING GRAPHS</span><select value={preset} onChange={(event) => { setPreset(event.currentTarget.value); if (event.currentTarget.value) loadExample(event.currentTarget.value); }}><option value="">Choose a starting point…</option>{Object.entries(examples).map(([id, example]) => <option key={id} value={id}>{example.title}</option>)}</select></label>
        <button type="button" onClick={() => { setPan({ x: 0, y: 0 }); setZoom(.54); }}>HOME</button><button type="button" onClick={() => setZoom((v) => Math.max(.35, v - .1))}>−</button><span>{Math.round(zoom * 100)}%</span><button type="button" onClick={() => setZoom((v) => Math.min(1.5, v + .1))}>＋</button>
        <div className="add-node-wrap"><button className="add-node-button" type="button" onClick={() => setMenuOpen((v) => !v)}>＋ ADD OPERATOR</button>{menuOpen && <div className="operator-menu">
          <div className="operator-menu-heading">INPUTS</div><button type="button" onClick={() => add('input')}>◉ VALUE / TIME / POINTER / KEY</button>
          <div className="operator-menu-heading">SIGNALS</div>{(['math','clamp','remap','noise','lfo','switch','compare','quantize'] as Kind[]).map((kind) => <button type="button" key={kind} onClick={() => add(kind)}>∑ {titles[kind].toUpperCase()}</button>)}
          <div className="operator-menu-heading">WORLD SYSTEMS</div>{(['geometry','transform','deform','material','particles','water','model','environment','camera','postfx'] as Kind[]).map((kind) => <button type="button" key={kind} onClick={() => add(kind)}>◇ {titles[kind].toUpperCase()}</button>)}
        </div>}</div>
      </div>
    </div>
    <div className="graph-canvas" onPointerDown={(event) => { if ((event.target as HTMLElement).closest('.td-node')) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); panStart.current = { x: event.clientX, y: event.clientY, px: pan.x, py: pan.y }; }}>
      <div className="canvas-dots"/><div className="graph-stage" style={{ transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})` }}>
        <svg className="graph-connections">{graph.links.map((edge) => { const from = graph.nodes.find((node) => node.id === edge.from); const to = graph.nodes.find((node) => node.id === edge.to); if (!from || !to) return null; const x1 = from.x + 236; const y1 = from.y + 70; const x2 = to.x; const y2 = to.y + 70; return <g key={edge.id} className="connection active" onClick={() => commit({ ...graph, links: graph.links.filter((link) => link.id !== edge.id) })}><path d={`M ${x1} ${y1} C ${x1 + 80} ${y1},${x2 - 80} ${y2},${x2} ${y2}`}/></g>; })}</svg>
        {graph.nodes.map((node) => {
          const visual = ['geometry','transform','deform','material','particles','water','model'].includes(node.kind);
          const hasInput = !['input','render'].includes(node.kind);
          const hasOutput = node.kind !== 'render';
          return <article key={node.id} className={`td-node ${node.kind === 'input' ? 'td-noise' : node.kind === 'math' ? 'td-vortex' : 'td-render'} ${node.kind === 'render' ? 'render-output-node' : ''} ${selected === node.id ? 'selected' : ''} ${node.bypass ? 'bypassed' : ''}`} style={{ left: node.x, top: node.y }} onPointerDown={(event) => { if ((event.target as HTMLElement).closest('button')) return; event.stopPropagation(); drag.current = { id: node.id, x: node.x - (event.clientX - pan.x) / zoom, y: node.y - (event.clientY - pan.y) / zoom }; setSelected(node.id); }}>
            <header className="td-node-header"><span className="td-node-icon">{node.kind === 'render' ? '▶' : node.kind === 'input' ? '◉' : visual ? '◇' : node.kind === 'math' ? '∑' : 'ƒ'}</span><b>{node.label}</b>{node.kind !== 'render' && <><button type="button" onClick={() => edit(node.id, { bypass: !node.bypass })} title="Bypass operator">{node.bypass ? '▶' : 'Ⅱ'}</button><button type="button" onClick={() => remove(node.id)} aria-label="Delete node">×</button></>}</header>
            <div className="td-node-subtitle">{node.kind === 'render' ? 'FINAL IMAGE · ONLY CONNECTED BRANCHES' : node.kind === 'input' ? node.mode?.toUpperCase() : titles[node.kind].toUpperCase()}</div>
            {node.kind === 'input' && <div className="ray-node-readout"><span>{node.mode === 'constant' ? 'VALUE' : node.mode?.toUpperCase()}</span><b>{node.mode === 'constant' ? node.value.toFixed(2) : 'LIVE'}</b></div>}
            {visual && <div className="ray-node-readout"><span>{node.kind === 'particles' ? 'POINTS' : node.kind === 'water' ? 'WAVES' : node.kind === 'geometry' ? node.shape?.toUpperCase() : 'ASSET'}</span><b>{node.kind === 'particles' ? Math.round(node.value).toLocaleString() : node.value.toFixed(2)}</b></div>}
            {hasInput && <button className={`td-port in-port ${graph.links.some((edge) => edge.to === node.id) ? 'wired' : ''}`} type="button" aria-label="Connect input" onClick={(event) => { event.stopPropagation(); if (pendingWire) connect(pendingWire, node.id); }}/ >}
            {hasOutput && <button className={`td-port out-port ${connected.has(node.id) ? 'wired' : ''} ${pendingWire === node.id ? 'armed' : ''}`} type="button" aria-label="Start wire" onClick={(event) => { event.stopPropagation(); setPendingWire(node.id); }}/ >}
          </article>;
        })}
      </div><div className="canvas-instructions">DRAG NODES · WIRE SIGNALS AND RENDERABLES INTO THE OUTPUT · DISCONNECTED BRANCHES DO NOT RENDER</div>
    </div>
    <div className="node-inspector"><div className="inspector-title"><div><span>OPERATOR PARAMETERS · RENDER OUTPUT</span><b>{current?.label ?? 'SELECT AN OPERATOR'}</b></div>{current && current.kind !== 'render' && <button type="button" onClick={() => remove(current.id)}>DELETE</button>}</div>
      <div className="inspector-params">
        {current?.kind === 'input' && <><label className="node-parameter"><span>Input source</span><select value={current.mode} onChange={(event) => edit(current.id, { mode: event.currentTarget.value as InputMode })}>{[['constant','Constant'],['time','Time'],['mouseX','Pointer X'],['mouseY','Pointer Y'],['pointer','Pointer down'],['key','Keyboard key'],['audio','Audio amplitude'],['bass','Audio bass'],['mid','Audio mids'],['highBand','Audio highs']].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>{current.mode === 'constant' && <label className="node-parameter"><span>Value</span><output>{current.value.toFixed(2)}</output><input type="range" min="-5" max="5" step=".01" value={current.value} onChange={(event) => edit(current.id, { value: Number(event.currentTarget.value) })}/></label>}{current.mode === 'key' && <label className="node-parameter"><span>Key</span><input value={current.key ?? ' '} maxLength={1} onChange={(event) => edit(current.id, { key: event.currentTarget.value.toLowerCase() })}/></label>}</>}
        {current?.kind === 'math' && <><label className="node-parameter"><span>Operation</span><select value={current.operation} onChange={(event) => edit(current.id, { operation: event.currentTarget.value })}>{['add','multiply','subtract','divide','power','average','min','max','abs','sin','cos','clamp01'].map((value) => <option key={value}>{value}</option>)}</select></label></>}
        {(current?.kind === 'clamp' || current?.kind === 'remap') && <><label className="node-parameter"><span>Low</span><input type="number" value={current.low} step=".01" onChange={(event) => edit(current.id, { low: Number(event.currentTarget.value) })}/></label><label className="node-parameter"><span>High</span><input type="number" value={current.high} step=".01" onChange={(event) => edit(current.id, { high: Number(event.currentTarget.value) })}/></label></>}
        {(current?.kind === 'lfo' || current?.kind === 'quantize') && <label className="node-parameter"><span>{current.kind === 'lfo' ? 'Frequency' : 'Step'}</span><input type="number" min=".001" value={current.high} step=".05" onChange={(event) => edit(current.id, { high: Number(event.currentTarget.value) })}/></label>}
        {current?.kind === 'compare' && <label className="node-parameter"><span>Comparison</span><select value={current.operation} onChange={(event) => edit(current.id, { operation: event.currentTarget.value })}>{['greater','less','equal'].map((value) => <option key={value}>{value}</option>)}</select></label>}
        {current?.kind === 'render' && <label className="node-parameter"><span>Background</span><input type="color" value={current.color ?? '#020202'} onChange={(event) => edit(current.id, { color: event.currentTarget.value })}/></label>}
        {current?.kind === 'environment' && <><label className="node-parameter"><span>Atmosphere color</span><input type="color" value={current.color ?? '#020202'} onChange={(event) => edit(current.id, { color: event.currentTarget.value })}/></label><label className="node-parameter"><span>Fog density</span><input type="range" min="0" max="0.12" step="0.001" value={current.value} onChange={(event) => edit(current.id, { value: Number(event.currentTarget.value) })}/></label></>}
        {current?.kind === 'camera' && <><label className="node-parameter"><span>Field of view</span><input type="range" min="25" max="100" step="1" value={current.value} onChange={(event) => edit(current.id, { value: Number(event.currentTarget.value) })}/></label>{(['x','y','z'] as const).map((axis) => <label className="node-parameter" key={axis}><span>Position {axis.toUpperCase()}</span><input type="number" step="0.1" value={current.position?.[axis] ?? 0} onChange={(event) => edit(current.id, { position: { ...current.position!, [axis]: Number(event.currentTarget.value) } })}/></label>)}</>}
        {current?.kind === 'postfx' && <><label className="node-parameter"><span>Bloom strength</span><input type="range" min="0" max="2" step="0.01" value={current.value} onChange={(event) => edit(current.id, { value: Number(event.currentTarget.value) })}/></label><label className="node-parameter"><span>Bloom threshold</span><input type="range" min="0" max="1" step="0.01" value={current.low ?? .75} onChange={(event) => edit(current.id, { low: Number(event.currentTarget.value) })}/></label><label className="node-parameter"><span>Vignette</span><input type="range" min="0" max="1" step="0.01" value={current.high ?? 0} onChange={(event) => edit(current.id, { high: Number(event.currentTarget.value) })}/></label></>}
        {visualCurrent && <><label className="node-parameter"><span>Display name</span><input value={visualCurrent.label} onChange={(event) => edit(visualCurrent.id, { label: event.currentTarget.value })}/></label>{['geometry','material','particles','water','model'].includes(visualCurrent.kind) && <label className="node-parameter"><span>Color</span><input type="color" value={visualCurrent.color ?? '#61d5c1'} onChange={(event) => edit(visualCurrent.id, { color: event.currentTarget.value })}/></label>}{visualCurrent.kind === 'geometry' && <label className="node-parameter"><span>Generator</span><select value={visualCurrent.shape} onChange={(event) => edit(visualCurrent.id, { shape: event.currentTarget.value })}>{['icosahedron','sphere','box','torus','torusKnot','octahedron','dodecahedron','cone','cylinder','capsule','plane'].map((shape) => <option key={shape} value={shape}>{shape === 'torusKnot' ? 'Torus knot' : shape}</option>)}</select></label>}<label className="node-parameter"><span>{visualCurrent.kind === 'particles' ? 'Point count' : visualCurrent.kind === 'deform' ? 'Displacement' : visualCurrent.kind === 'material' ? 'Emission' : visualCurrent.kind === 'water' ? 'Wave amount' : 'Scale'}</span><output>{visualCurrent.value.toFixed(visualCurrent.kind === 'particles' ? 0 : 2)}</output><input type="range" min={visualCurrent.kind === 'particles' ? 100 : visualCurrent.kind === 'deform' ? 0 : .1} max={visualCurrent.kind === 'particles' ? 30000 : visualCurrent.kind === 'deform' ? 1.5 : 5} step={visualCurrent.kind === 'particles' ? 100 : .05} value={visualCurrent.value} onChange={(event) => edit(visualCurrent.id, { value: Number(event.currentTarget.value) })}/></label>{['deform','transform','material'].includes(visualCurrent.kind) && <><label className="node-parameter"><span>{visualCurrent.kind === 'deform' ? 'Field frequency' : visualCurrent.kind === 'material' ? 'Roughness' : 'Rotation speed'}</span><input type="range" min="0.02" max={visualCurrent.kind === 'deform' ? '10' : '1'} step="0.02" value={visualCurrent.high ?? .2} onChange={(event) => edit(visualCurrent.id, { high: Number(event.currentTarget.value) })}/></label><label className="node-parameter"><span>Flow rate</span><input type="range" min="0" max="2" step="0.02" value={visualCurrent.low ?? .08} onChange={(event) => edit(visualCurrent.id, { low: Number(event.currentTarget.value) })}/></label></>}</>}
        {!current && <p>Render Output is the sole viewport output. Add a renderable node or load an example. Nothing outside a connected path to this node appears in the preview.</p>}
      </div>
    </div>
    {saveOpen && <div className="world-save-backdrop"><form className="world-save-dialog" onSubmit={(event) => { event.preventDefault(); if (saveName.trim()) { onSaveWorld?.(saveName.trim(), latestGraph.current); setSaveOpen(false); } }}>
      <span>SAVE A NEW WORLD</span>
      <label>WORLD NAME<input autoFocus value={saveName} maxLength={48} onChange={(event) => setSaveName(event.currentTarget.value)} /></label>
      <div><button type="button" onClick={() => setSaveOpen(false)}>CANCEL</button><button type="submit" disabled={!saveName.trim()}>SAVE TO GALLERY</button></div>
    </form></div>}
  </div>;
}
