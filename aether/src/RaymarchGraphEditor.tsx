import { useEffect, useRef, useState } from 'react';
import type { FirstWorldParameters } from './worlds/FirstWorld';

type Kind = 'camera' | 'geometry' | 'orbit' | 'warp' | 'tracer' | 'palette' | 'output';
type Node = { id: string; kind: Kind; x: number; y: number; values: Partial<FirstWorldParameters> };
type Link = { id: string; from: string; to: string };
type Graph = { nodes: Node[]; links: Link[] };
type Props = { parameters: FirstWorldParameters; onChange: (values: Partial<FirstWorldParameters>) => void };

const specs: Record<Kind, { title: string; glyph: string; sub: string; params: Array<keyof FirstWorldParameters> }> = {
  camera: { title: 'VIEW / CAMERA', glyph: '◉', sub: 'PERSPECTIVE · DEPTH', params: ['raymarchZoom', 'raymarchDepth'] },
  geometry: { title: 'SDF CLUSTER', glyph: '⟡', sub: 'EDITABLE PROCEDURAL OBJECT', params: ['raymarchShape', 'raymarchScale', 'raymarchSpread'] },
  orbit: { title: 'ORBIT DRIVER', glyph: '⟳', sub: 'ANIMATED CLUSTER MOTION', params: ['raymarchSpeed', 'raymarchOrbit'] },
  warp: { title: 'SPACE WARP', glyph: '∿', sub: 'TWIST / DEFORM', params: ['raymarchTwist'] },
  tracer: { title: 'RAY TRACER', glyph: '⌁', sub: 'MARCH QUALITY · ETCHING', params: ['raymarchDetail', 'raymarchFilament'] },
  palette: { title: 'LIGHT / PALETTE', glyph: '◒', sub: 'CHROMA · EMISSION', params: ['raymarchPalette', 'raymarchGlow'] },
  output: { title: 'FINAL OUTPUT', glyph: '✳', sub: 'FULLSCREEN SDF COMPOSITE', params: [] },
};
const settings: Record<keyof FirstWorldParameters, { label: string; min: number; max: number; step: number }> = {
  particleCount: { label: 'Particle count', min: 12000, max: 1000000, step: 10000 }, particleShape: { label: 'Particle form', min: 0, max: 4, step: 1 }, sourceSize: { label: 'Source size', min: .2, max: 3, step: .01 }, sourceSpeed: { label: 'Initial velocity', min: 0, max: .1, step: .001 }, flowScale: { label: 'Flow scale', min: .2, max: 5, step: .01 }, flowStrength: { label: 'Flow strength', min: 0, max: 3, step: .01 },
  turbulenceScale: { label: 'Turbulence scale', min: .2, max: 10, step: .01 }, turbulenceStrength: { label: 'Turbulence', min: 0, max: 3, step: .01 }, vortexRadius: { label: 'Vortex radius', min: .1, max: 5, step: .01 }, vortexStrength: { label: 'Vortex strength', min: -4, max: 4, step: .01 }, attractorRadius: { label: 'Attractor radius', min: .1, max: 5, step: .01 }, attractorStrength: { label: 'Attractor force', min: -5, max: 5, step: .01 }, gravityStrength: { label: 'Gravity', min: -3, max: 3, step: .01 }, waveScale: { label: 'Wave scale', min: .1, max: 8, step: .01 }, waveStrength: { label: 'Wave force', min: 0, max: 3, step: .01 }, damping: { label: 'Damping', min: .9, max: 1, step: .001 }, confinement: { label: 'Boundary force', min: 0, max: 4, step: .01 }, radius: { label: 'World radius', min: .4, max: 4, step: .01 }, timeScale: { label: 'Time scale', min: 0, max: 2.5, step: .01 }, sharpness: { label: 'Sharpness', min: 0, max: 1, step: .01 }, glow: { label: 'Glow', min: 0, max: 1, step: .01 }, particleSize: { label: 'Particle size', min: .004, max: .04, step: .001 }, palette: { label: 'Palette', min: 0, max: 4, step: 1 }, paletteMix: { label: 'Palette mix', min: 0, max: 1, step: .01 }, seed: { label: 'Seed', min: 1, max: 1000, step: 1 },
  raymarchScale: { label: 'SDF scale', min: .5, max: 3.5, step: .01 }, raymarchShape: { label: 'Object form', min: 0, max: 3, step: 1 }, raymarchSpeed: { label: 'Animation speed', min: 0, max: 3.5, step: .01 }, raymarchOrbit: { label: 'Orbit amplitude', min: 0, max: 4, step: .01 }, raymarchTwist: { label: 'Twist amount', min: 0, max: 4, step: .01 }, raymarchFilament: { label: 'Filament density', min: .2, max: 3.5, step: .01 }, raymarchDetail: { label: 'March detail', min: .5, max: 3, step: .01 }, raymarchPalette: { label: 'Palette · 0 cyan / 4 acid', min: 0, max: 4, step: 1 }, raymarchGlow: { label: 'Emission / bloom', min: 0, max: 4, step: .01 }, raymarchDepth: { label: 'Ray depth', min: 6, max: 24, step: .1 }, raymarchZoom: { label: 'Lens zoom', min: .5, max: 3.5, step: .01 }, raymarchSpread: { label: 'Cluster spread', min: .4, max: 3, step: .01 },
  hydrosSpiralScale: { label: 'Spiral scale', min: .65, max: 1.8, step: .01 }, hydrosRotation: { label: 'Rotation', min: -.8, max: .8, step: .01 }, hydrosWaveHeight: { label: 'Wave height', min: 0, max: 1.8, step: .01 }, hydrosWaveScale: { label: 'Wave scale', min: .25, max: 3.5, step: .01 }, hydrosWaveSpeed: { label: 'Wave speed', min: 0, max: 2.5, step: .01 }, hydrosSplash: { label: 'Splash strength', min: 0, max: 3, step: .01 }, hydrosCurrent: { label: 'Current', min: 0, max: 2.5, step: .01 }, hydrosFog: { label: 'Fog', min: .001, max: .04, step: .001 }, hydrosLight: { label: 'Light', min: 0, max: 2, step: .01 }, hydrosBubbles: { label: 'Bubbles', min: 0, max: 2, step: .01 },
  y2kModelScale: { label: 'Model scale', min: .5, max: 3.5, step: .01 }, y2kMaterialColor: { label: 'Surface palette', min: 0, max: 5, step: 1 }, y2kTintMix: { label: 'Palette blend', min: 0, max: 1, step: .01 }, y2kMetalness: { label: 'Metalness', min: 0, max: 1, step: .01 }, y2kRoughness: { label: 'Roughness', min: .02, max: 1, step: .01 }, y2kClearcoat: { label: 'Clearcoat', min: 0, max: 1, step: .01 }, y2kIridescence: { label: 'Iridescence', min: 0, max: 1, step: .01 }, y2kTransmission: { label: 'Transmission', min: 0, max: .8, step: .01 }, y2kEmission: { label: 'Model emission', min: 0, max: 8, step: .01 }, y2kEmissionColor: { label: 'Emission color', min: 0, max: 4, step: 1 }, y2kEmissionPulse: { label: 'Pulse amount', min: 0, max: 1, step: .01 }, y2kBloom: { label: 'Bloom strength', min: 0, max: 4, step: .01 }, y2kGlowScale: { label: 'Halo spread', min: .35, max: 3, step: .01 }, y2kStarSize: { label: 'Star size', min: .004, max: .08, step: .001 }, y2kTwinkle: { label: 'Twinkle', min: 0, max: 1, step: .01 }, y2kNebulaScale: { label: 'Cloud scale', min: .4, max: 3, step: .01 }, y2kNebulaSpeed: { label: 'Cloud drift', min: 0, max: 4, step: .01 }, y2kSunScale: { label: 'Sun scale', min: .35, max: 3, step: .01 }, y2kBackdrop: { label: 'Backdrop palette', min: 0, max: 4, step: 1 }, y2kReflection: { label: 'Chrome reflections', min: 0, max: 3, step: .01 }, y2kRotationSpeed: { label: 'Spin speed', min: 0, max: 3, step: .01 }, y2kOrbit: { label: 'Orbit amount', min: 0, max: 2, step: .01 }, y2kNebula: { label: 'Nebula density', min: 0, max: 3, step: .01 }, y2kStars: { label: 'Star intensity', min: 0, max: 3, step: .01 }, y2kSunEmission: { label: 'Sun emission', min: 0, max: 8, step: .01 }, y2kLight: { label: 'Light intensity', min: 0, max: 3, step: .01 }, y2kFov: { label: 'Camera FOV', min: 40, max: 90, step: 1 },
  styxModelScale: { label: 'Styx model scale', min: .5, max: 3, step: .01 }, styxMetalness: { label: 'Chrome metalness', min: 0, max: 1, step: .01 }, styxRoughness: { label: 'Chrome roughness', min: .015, max: .65, step: .005 }, styxReflection: { label: 'Chrome reflections', min: 0, max: 5, step: .01 }, styxChromeTint: { label: 'Chrome tint', min: 0, max: 4, step: 1 }, styxRingScale: { label: 'Ring scale', min: .45, max: 2.8, step: .01 }, styxRingSpeed: { label: 'Ring speed', min: 0, max: 4, step: .01 }, styxRingEnergy: { label: 'Ring energy', min: 0, max: 3, step: .01 }, styxChaoCount: { label: 'Swarm count', min: 0, max: 14, step: 1 }, styxChaoScale: { label: 'Chao scale', min: .25, max: 3, step: .01 }, styxChaoOrbit: { label: 'Swarm orbit', min: .1, max: 3, step: .01 }, styxChaoSpeed: { label: 'Swarm speed', min: 0, max: 4, step: .01 }, styxStars: { label: 'Star opacity', min: 0, max: 3, step: .01 }, styxStarSize: { label: 'Star size', min: .004, max: .08, step: .001 }, styxLight: { label: 'Light rig', min: 0, max: 3, step: .01 }, styxPulse: { label: 'Pulse energy', min: 0, max: 2, step: .01 }, styxBloom: { label: 'Bloom strength', min: 0, max: 4, step: .01 }, styxGlowScale: { label: 'Halo spread', min: .35, max: 3, step: .01 }, styxCameraMotion: { label: 'Camera motion', min: 0, max: 2, step: .01 }, styxCameraSpeed: { label: 'Camera speed', min: 0, max: 4, step: .01 }, styxCameraDistance: { label: 'Camera distance', min: 2, max: 7.5, step: .01 }, styxCameraAim: { label: 'Camera aim height', min: -1.5, max: 1.5, step: .01 }, styxCameraFov: { label: 'Camera FOV', min: 35, max: 85, step: 1 }, styxBackdrop: { label: 'Backdrop palette', min: 0, max: 4, step: 1 },
};

function defaults(kind: Kind, p: FirstWorldParameters): Partial<FirstWorldParameters> {
  switch (kind) {
    case 'camera': return { raymarchZoom: p.raymarchZoom, raymarchDepth: p.raymarchDepth };
    case 'geometry': return { raymarchShape: p.raymarchShape, raymarchScale: p.raymarchScale, raymarchSpread: p.raymarchSpread };
    case 'orbit': return { raymarchSpeed: p.raymarchSpeed, raymarchOrbit: p.raymarchOrbit };
    case 'warp': return { raymarchTwist: p.raymarchTwist };
    case 'tracer': return { raymarchDetail: p.raymarchDetail, raymarchFilament: p.raymarchFilament };
    case 'palette': return { raymarchPalette: p.raymarchPalette, raymarchGlow: p.raymarchGlow };
    case 'output': return {};
  }
}
function fresh(p: FirstWorldParameters): Graph {
  const layout: Array<[Kind, number, number]> = [['camera', 35, 155], ['geometry', 325, 0], ['orbit', 615, 0], ['warp', 905, 0], ['tracer', 905, 305], ['palette', 615, 305], ['output', 325, 305]];
  const nodes = layout.map(([kind, x, y]) => ({ id: kind, kind, x, y, values: defaults(kind, p) }));
  const links = nodes.slice(0, -1).map((node, index) => ({ id: `${node.id}-${nodes[index + 1].id}`, from: node.id, to: nodes[index + 1].id }));
  return { nodes, links };
}
function activeNodes(nodes: Node[], links: Link[]) {
  const fromCamera = new Set(nodes.filter((node) => node.kind === 'camera').map((node) => node.id));
  let changed = true;
  while (changed) { changed = false; for (const edge of links) if (fromCamera.has(edge.from) && !fromCamera.has(edge.to)) { fromCamera.add(edge.to); changed = true; } }
  const intoOutput = new Set(nodes.filter((node) => node.kind === 'output').map((node) => node.id));
  changed = true;
  while (changed) { changed = false; for (const edge of links) if (intoOutput.has(edge.to) && !intoOutput.has(edge.from)) { intoOutput.add(edge.from); changed = true; } }
  return nodes.filter((node) => fromCamera.has(node.id) && intoOutput.has(node.id));
}
function outputValues(nodes: Node[], links: Link[]) {
  const active = activeNodes(nodes, links);
  const values: Partial<FirstWorldParameters> = { raymarchScale: 1, raymarchShape: 0, raymarchSpeed: 0, raymarchOrbit: 0, raymarchTwist: 0, raymarchFilament: 1, raymarchDetail: 1, raymarchPalette: 0, raymarchGlow: 0, raymarchDepth: 14, raymarchZoom: 1, raymarchSpread: 1 };
  const geometries = active.filter((node) => node.kind === 'geometry');
  const orbits = active.filter((node) => node.kind === 'orbit');
  const warps = active.filter((node) => node.kind === 'warp');
  const tracers = active.filter((node) => node.kind === 'tracer');
  const palettes = active.filter((node) => node.kind === 'palette');
  if (geometries.length) {
    values.raymarchScale = geometries.reduce((total, node) => total * Number(node.values.raymarchScale ?? 1), 1);
    values.raymarchSpread = geometries.reduce((total, node) => total * Number(node.values.raymarchSpread ?? 1), 1);
    values.raymarchShape = geometries.reduce((total, node) => total + Number(node.values.raymarchShape ?? 0), 0) / geometries.length;
  }
  if (orbits.length) {
    values.raymarchSpeed = orbits.reduce((total, node) => total + Number(node.values.raymarchSpeed ?? 0), 0);
    values.raymarchOrbit = orbits.reduce((total, node) => total + Number(node.values.raymarchOrbit ?? 0), 0);
  }
  if (warps.length) values.raymarchTwist = warps.reduce((total, node) => total + Number(node.values.raymarchTwist ?? 0), 0);
  if (tracers.length) {
    values.raymarchFilament = tracers.reduce((total, node) => total * Number(node.values.raymarchFilament ?? 1), 1);
    values.raymarchDetail = tracers.reduce((total, node) => total * Number(node.values.raymarchDetail ?? 1), 1);
  }
  if (palettes.length) {
    const palette = palettes[palettes.length - 1];
    values.raymarchPalette = palette.values.raymarchPalette;
    values.raymarchGlow = palettes.reduce((total, node) => total + Number(node.values.raymarchGlow ?? 0), 0);
  }
  for (const node of active) if (node.kind === 'camera') { values.raymarchDepth = node.values.raymarchDepth; values.raymarchZoom = node.values.raymarchZoom; }
  return values;
}

export function RaymarchGraphEditor({ parameters, onChange }: Props) {
  const storageKey = 'aether.graph.raymarch.v1';
  const [graph, setGraph] = useState<Graph>(() => {
    try { const saved = localStorage.getItem(storageKey); if (saved) return JSON.parse(saved) as Graph; } catch { /* Start with the default graph. */ }
    return fresh(parameters);
  });
  const [selected, setSelected] = useState('geometry');
  const [pending, setPending] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [zoom, setZoom] = useState(.72);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ id: string; x: number; y: number } | null>(null);
  const panStart = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
  useEffect(() => { localStorage.setItem(storageKey, JSON.stringify(graph)); }, [graph]);
  useEffect(() => { onChange(outputValues(graph.nodes, graph.links)); window.dispatchEvent(new CustomEvent('aether:graph', { detail: { worldId: 'raymarch', graph } })); }, []);
  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (drag.current) { const d = drag.current; setGraph((current) => ({ ...current, nodes: current.nodes.map((node) => node.id === d.id ? { ...node, x: d.x + (event.clientX - pan.x) / zoom, y: d.y + (event.clientY - pan.y) / zoom } : node) })); }
      else if (panStart.current) { const p = panStart.current; setPan({ x: p.originX + event.clientX - p.x, y: p.originY + event.clientY - p.y }); }
    };
    const end = () => { drag.current = null; panStart.current = null; };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); };
  }, [zoom, pan]);
  const commit = (next: Graph) => { setGraph(next); onChange(outputValues(next.nodes, next.links)); window.dispatchEvent(new CustomEvent('aether:graph', { detail: { worldId: 'raymarch', graph: next } })); };
  useEffect(() => { const receive = (event: Event) => { const detail = (event as CustomEvent).detail; if (detail?.remote && detail.worldId === 'raymarch' && detail.graph?.nodes && detail.graph?.links) { setGraph(detail.graph as typeof graph); onChange(outputValues(detail.graph.nodes, detail.graph.links)); } }; window.addEventListener('aether:graph', receive); return () => window.removeEventListener('aether:graph', receive); }, [onChange]);
  const resetGraph = () => { setSelected('geometry'); setPending(null); setPan({ x: 0, y: 0 }); setZoom(.72); setMenuOpen(false); commit(fresh(parameters)); };
  const add = (kind: Kind) => {
    if (kind === 'camera' && graph.nodes.some((node) => node.kind === 'camera') || kind === 'output' && graph.nodes.some((node) => node.kind === 'output')) { setMenuOpen(false); return; }
    const id = `${kind}-${Date.now()}`; const origin = graph.nodes.find((node) => node.id === selected && node.kind !== 'output');
    const outgoing = origin ? graph.links.filter((link) => link.from === origin.id) : [];
    const nodeDefaults = defaults(kind, parameters);
    if (kind === 'geometry') Object.assign(nodeDefaults, { raymarchShape: 0, raymarchScale: 1, raymarchSpread: 1 });
    if (kind === 'orbit') Object.assign(nodeDefaults, { raymarchSpeed: 0, raymarchOrbit: 0 });
    if (kind === 'warp') nodeDefaults.raymarchTwist = 0;
    if (kind === 'tracer') Object.assign(nodeDefaults, { raymarchFilament: 1, raymarchDetail: 1 });
    if (kind === 'palette') nodeDefaults.raymarchGlow = 0;
    const node: Node = { id, kind, x: origin ? origin.x + 70 : 200, y: origin ? origin.y + 195 : 180, values: nodeDefaults };
    const links = origin ? [...graph.links.filter((link) => link.from !== origin.id), { id: `${origin.id}-${id}`, from: origin.id, to: id }, ...outgoing.map((edge) => ({ id: `${id}-${edge.to}`, from: id, to: edge.to }))] : graph.links;
    setSelected(id); setMenuOpen(false); commit({ nodes: [...graph.nodes, node], links });
  };
  const connect = (from: string, to: string) => {
    if (from === to || graph.nodes.find((node) => node.id === to)?.kind === 'camera' || graph.nodes.find((node) => node.id === from)?.kind === 'output') return;
    const queue = [to]; const seen = new Set<string>();
    while (queue.length) { const id = queue.pop()!; if (id === from) return; if (seen.has(id)) continue; seen.add(id); graph.links.filter((link) => link.from === id).forEach((link) => queue.push(link.to)); }
    setPending(null); commit({ ...graph, links: [...graph.links, { id: `${from}-${to}-${Date.now()}`, from, to }] });
  };
  const remove = (id: string) => { setSelected(''); commit({ nodes: graph.nodes.filter((node) => node.id !== id), links: graph.links.filter((link) => link.from !== id && link.to !== id) }); };
  const setValue = (id: string, key: keyof FirstWorldParameters, value: number) => commit({ ...graph, nodes: graph.nodes.map((node) => node.id === id ? { ...node, values: { ...node.values, [key]: value } } : node) });
  const live = activeNodes(graph.nodes, graph.links); const current = graph.nodes.find((node) => node.id === selected);
  const value = (node: Node, key: keyof FirstWorldParameters) => Number(node.values[key] ?? parameters[key]);
  return <div className="graph-shell ray-graph-shell">
    <div className="graph-toolbar"><div className="network-name"><span className="ray-network-dot" /> SDF / FILAMENT LAB <small>/ {live.length} LIVE NODES</small></div><div className="graph-toolbar-actions"><button type="button" title="Restore the default raymarch node tree" onClick={resetGraph}>RESET TREE</button><button type="button" onClick={() => setPan({ x: 0, y: 0 })}>HOME</button><button type="button" onClick={() => setZoom((z) => Math.max(.4, z - .1))}>−</button><span>{Math.round(zoom * 100)}%</span><button type="button" onClick={() => setZoom((z) => Math.min(1.3, z + .1))}>＋</button><div className="add-node-wrap"><button className="add-node-button" type="button" onClick={() => setMenuOpen((open) => !open)}>＋ ADD NODE</button>{menuOpen && <div className="operator-menu">{(Object.keys(specs) as Kind[]).map((kind) => <button key={kind} type="button" onClick={() => add(kind)}><span>{specs[kind].glyph}</span>{specs[kind].title}</button>)}</div>}</div></div></div>
    <div className="graph-canvas ray-canvas" onPointerDown={(event) => { if (event.target === event.currentTarget) panStart.current = { x: event.clientX, y: event.clientY, originX: pan.x, originY: pan.y }; }}><div className="canvas-dots" /><div className="graph-stage ray-graph-stage" style={{ transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})` }}>
      <svg className="graph-connections">{graph.links.map((link) => { const from = graph.nodes.find((node) => node.id === link.from); const to = graph.nodes.find((node) => node.id === link.to); if (!from || !to) return null; const isLive = live.some((node) => node.id === from.id) && live.some((node) => node.id === to.id); return <g key={link.id} className={`connection ${isLive ? 'active ray-active' : ''}`} onClick={() => commit({ ...graph, links: graph.links.filter((item) => item.id !== link.id) })}><path d={`M ${from.x + 236} ${from.y + 92} C ${from.x + 320} ${from.y + 92},${to.x - 90} ${to.y + 92},${to.x} ${to.y + 92}`} /><circle cx={(from.x + to.x + 236) / 2} cy={(from.y + to.y + 184) / 2} r="7" /><text x={(from.x + to.x + 236) / 2} y={(from.y + to.y + 184) / 2 + 3}>×</text></g>; })}</svg>
      {graph.nodes.map((node) => <article key={node.id} className={`td-node ray-node td-${node.kind} ${current?.id === node.id ? 'selected' : ''} ${live.some((item) => item.id === node.id) ? '' : 'bypassed'}`} style={{ left: node.x, top: node.y }} onPointerDown={(event) => { if ((event.target as HTMLElement).closest('button')) return; event.stopPropagation(); drag.current = { id: node.id, x: node.x - (event.clientX - pan.x) / zoom, y: node.y - (event.clientY - pan.y) / zoom }; setSelected(node.id); }}><header className="td-node-header"><span className="td-node-icon">{specs[node.kind].glyph}</span><b>{specs[node.kind].title}</b><button type="button" onClick={() => remove(node.id)} aria-label="Delete node">×</button></header><div className="td-node-subtitle">{specs[node.kind].sub}</div>{node.kind !== 'camera' && <button className={`td-port in-port ${graph.links.some((edge) => edge.to === node.id) ? 'wired' : ''}`} type="button" aria-label="Connect input" onClick={(event) => { event.stopPropagation(); if (pending) connect(pending, node.id); }} />}{specs[node.kind].params.slice(0, 2).map((key) => <div className="ray-node-readout" key={key}><span>{settings[key].label}</span><b>{value(node, key).toFixed(2)}</b></div>)}{node.kind !== 'output' && <button className={`td-port out-port ${pending === node.id ? 'armed' : ''} ${graph.links.some((edge) => edge.from === node.id) ? 'wired' : ''}`} type="button" aria-label="Start wire" onClick={(event) => { event.stopPropagation(); setPending(node.id); }} />}</article>)}
    </div><div className="canvas-instructions">SELECT / INSERT NODES <i>·</i> CONNECT PORTS <i>·</i> CAMERA: DRAG TO LOOK, WASD TO FLY</div></div>
    <div className="node-inspector ray-inspector"><div className="inspector-title"><div><span>NODE PARAMETERS</span><b>{current ? specs[current.kind].title : 'SELECT A NODE'}</b></div>{current && current.kind !== 'camera' && current.kind !== 'output' && <button type="button" onClick={() => remove(current.id)}>DELETE NODE</button>}</div><div className="inspector-params">{current && specs[current.kind].params.length ? specs[current.kind].params.map((key) => { const setting = settings[key]; if (key === 'raymarchShape') return <label className="node-parameter" key={key}><span>Cluster object</span><select value={value(current, key)} onChange={(event) => setValue(current.id, key, Number(event.currentTarget.value))}><option value={0}>Braided torus</option><option value={1}>Orb swarm</option><option value={2}>Etched rings</option><option value={3}>Crystal shards</option></select></label>; return <label className="node-parameter" key={key}><span>{setting.label}</span><output>{value(current, key).toFixed(2)}</output><input type="range" min={setting.min} max={setting.max} step={setting.step} value={value(current, key)} onChange={(event) => setValue(current.id, key, Number(event.currentTarget.value))} /></label>; }) : <p>Connect camera through the raymarch operators to the final output. This project has independent controls and a freely movable view.</p>}</div></div>
  </div>;
}
