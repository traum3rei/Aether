import { useEffect, useRef, useState } from 'react';
import type { FirstWorldParameters } from './worlds/FirstWorld';

type Kind = 'ocean' | 'spiral' | 'swell' | 'splash' | 'current' | 'light' | 'atmosphere' | 'bubbles' | 'output';
type Key = 'hydrosSpiralScale' | 'hydrosRotation' | 'hydrosWaveHeight' | 'hydrosWaveScale' | 'hydrosWaveSpeed' | 'hydrosSplash' | 'hydrosCurrent' | 'hydrosFog' | 'hydrosLight' | 'hydrosBubbles';
type Node = { id: string; kind: Kind; x: number; y: number; values: Partial<Record<Key, number>> };
type Link = { id: string; from: string; to: string };
type Graph = { nodes: Node[]; links: Link[] };
type Props = { parameters: FirstWorldParameters; onChange: (values: Partial<FirstWorldParameters>) => void };

const specs: Record<Kind, { title: string; glyph: string; sub: string; keys: Key[] }> = {
  ocean: { title: 'OCEAN SURFACE', glyph: '≋', sub: 'DEEP WATER · WIND SWELL', keys: ['hydrosWaveHeight', 'hydrosWaveScale', 'hydrosWaveSpeed'] },
  spiral: { title: 'GIANT SPIRAL', glyph: '⟲', sub: 'SCALE · SLOW ROTATION', keys: ['hydrosSpiralScale', 'hydrosRotation'] },
  swell: { title: 'CROSS SWELL', glyph: '∿', sub: 'SECONDARY WAVE TRAIN', keys: ['hydrosWaveHeight', 'hydrosWaveScale', 'hydrosWaveSpeed'] },
  splash: { title: 'BODY / SPLASH', glyph: '✳', sub: 'WATER DISPLACEMENT FIELD', keys: ['hydrosSplash'] },
  current: { title: 'OCEAN CURRENT', glyph: '⇝', sub: 'HORIZONTAL FLOW FIELD', keys: ['hydrosCurrent'] },
  light: { title: 'VOLUMETRIC LIGHT', glyph: '☼', sub: 'GOD RAYS · SPIRAL LIGHT', keys: ['hydrosLight'] },
  atmosphere: { title: 'BLUE HAZE', glyph: '◌', sub: 'UNDERWATER SCATTER', keys: ['hydrosFog'] },
  bubbles: { title: 'PARTICLE WAKE', glyph: '⠿', sub: 'RISING MICRO-BUBBLES', keys: ['hydrosBubbles'] },
  output: { title: 'OCEAN OUTPUT', glyph: '◉', sub: 'LIVE UNDERWATER COMPOSITE', keys: [] },
};
const controls: Record<Key, { label: string; min: number; max: number; step: number }> = {
  hydrosSpiralScale: { label: 'Spiral scale', min: .65, max: 2.5, step: .01 },
  hydrosRotation: { label: 'Rotation speed', min: -.8, max: .8, step: .01 },
  hydrosWaveHeight: { label: 'Wave height', min: 0, max: 3.2, step: .01 },
  hydrosWaveScale: { label: 'Wave frequency', min: .25, max: 5, step: .01 },
  hydrosWaveSpeed: { label: 'Wave speed', min: 0, max: 4, step: .01 },
  hydrosSplash: { label: 'Splash energy', min: 0, max: 5, step: .01 },
  hydrosCurrent: { label: 'Current strength', min: 0, max: 4, step: .01 },
  hydrosFog: { label: 'Water clarity / haze', min: .001, max: .04, step: .001 },
  hydrosLight: { label: 'Light intensity', min: 0, max: 2, step: .01 },
  hydrosBubbles: { label: 'Bubble density', min: 0, max: 2, step: .01 },
};
const allKeys = Object.keys(controls) as Key[];
function defaults(kind: Kind, p: FirstWorldParameters): Partial<Record<Key, number>> {
  return Object.fromEntries(specs[kind].keys.map((key) => [key, p[key]])) as Partial<Record<Key, number>>;
}
function fresh(p: FirstWorldParameters): Graph {
  const layout: Array<[Kind, number, number]> = [
    ['ocean', 40, 150], ['spiral', 310, 0], ['swell', 580, 0], ['splash', 850, 0],
    ['current', 850, 265], ['light', 580, 265], ['atmosphere', 310, 310], ['bubbles', 40, 345], ['output', 40, 0],
  ];
  const nodes = layout.map(([kind, x, y]) => {
    const values = defaults(kind, p);
    if (kind === 'swell') values.hydrosWaveHeight = 0;
    return { id: kind, kind, x, y, values };
  });
  const order = ['ocean', 'spiral', 'swell', 'splash', 'current', 'light', 'atmosphere', 'bubbles', 'output'];
  const links = order.slice(0, -1).map((id, index) => ({ id: `${id}-${order[index + 1]}`, from: id, to: order[index + 1] }));
  return { nodes, links };
}
function activeNodes(nodes: Node[], links: Link[]) {
  const starts = new Set(nodes.filter((node) => node.kind === 'ocean').map((node) => node.id));
  let changed = true;
  while (changed) { changed = false; for (const edge of links) if (starts.has(edge.from) && !starts.has(edge.to)) { starts.add(edge.to); changed = true; } }
  const ends = new Set(nodes.filter((node) => node.kind === 'output').map((node) => node.id));
  changed = true;
  while (changed) { changed = false; for (const edge of links) if (ends.has(edge.to) && !ends.has(edge.from)) { ends.add(edge.from); changed = true; } }
  return nodes.filter((node) => starts.has(node.id) && ends.has(node.id));
}
function outputValues(nodes: Node[], links: Link[]): Partial<FirstWorldParameters> {
  const live = activeNodes(nodes, links);
  const result: Partial<FirstWorldParameters> = {
    hydrosSpiralScale: 1, hydrosRotation: 0, hydrosWaveHeight: 0,
    hydrosWaveScale: 1, hydrosWaveSpeed: 1, hydrosSplash: 0,
    hydrosCurrent: 0, hydrosFog: 0.009, hydrosLight: 0, hydrosBubbles: 0,
  };
  const collect = (key: Key, kinds: Kind[]) => live.filter((node) => kinds.includes(node.kind) && node.values[key] !== undefined).map((node) => Number(node.values[key]));
  const sum = (key: Key, kinds: Kind[]) => { const values = collect(key, kinds); if (values.length) result[key] = values.reduce((a, b) => a + b, 0); };
  const average = (key: Key, kinds: Kind[]) => { const values = collect(key, kinds); if (values.length) result[key] = values.reduce((a, b) => a + b, 0) / values.length; };
  const spiralSizes = collect('hydrosSpiralScale', ['spiral']);
  if (spiralSizes.length) result.hydrosSpiralScale = spiralSizes.reduce((a, b) => a * b, 1);
  sum('hydrosRotation', ['spiral']);
  sum('hydrosWaveHeight', ['ocean', 'swell']);
  average('hydrosWaveScale', ['ocean', 'swell']);
  average('hydrosWaveSpeed', ['ocean', 'swell']);
  sum('hydrosSplash', ['splash']);
  sum('hydrosCurrent', ['current']);
  sum('hydrosLight', ['light']);
  average('hydrosFog', ['atmosphere']);
  sum('hydrosBubbles', ['bubbles']);
  for (const key of allKeys) {
    if (result[key] === undefined) continue;
    const c = controls[key];
    result[key] = Math.max(c.min, Math.min(c.max, result[key]!));
  }
  return result;
}

export function HydrosGraphEditor({ parameters, onChange }: Props) {
  const storageKey = 'aether.graph.hydros.v1';
  const [graph, setGraph] = useState<Graph>(() => {
    try { const value = localStorage.getItem(storageKey); if (value) return JSON.parse(value) as Graph; } catch { /* Start with the ocean network. */ }
    return fresh(parameters);
  });
  const [selected, setSelected] = useState('ocean');
  const [pending, setPending] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [zoom, setZoom] = useState(.72);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ id: string; x: number; y: number } | null>(null);
  const panStart = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
  useEffect(() => { localStorage.setItem(storageKey, JSON.stringify(graph)); }, [graph]);
  useEffect(() => { onChange(outputValues(graph.nodes, graph.links)); window.dispatchEvent(new CustomEvent('aether:graph', { detail: { worldId: 'hydros', graph } })); }, []);
  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (drag.current) { const d = drag.current; setGraph((g) => ({ ...g, nodes: g.nodes.map((node) => node.id === d.id ? { ...node, x: d.x + (event.clientX - pan.x) / zoom, y: d.y + (event.clientY - pan.y) / zoom } : node) })); }
      else if (panStart.current) { const p = panStart.current; setPan({ x: p.originX + event.clientX - p.x, y: p.originY + event.clientY - p.y }); }
    };
    const end = () => { drag.current = null; panStart.current = null; };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); };
  }, [zoom, pan]);
  const commit = (next: Graph) => { setGraph(next); onChange(outputValues(next.nodes, next.links)); window.dispatchEvent(new CustomEvent('aether:graph', { detail: { worldId: 'hydros', graph: next } })); };
  useEffect(() => { const receive = (event: Event) => { const detail = (event as CustomEvent).detail; if (detail?.remote && detail.worldId === 'hydros' && detail.graph?.nodes && detail.graph?.links) { setGraph(detail.graph as typeof graph); onChange(outputValues(detail.graph.nodes, detail.graph.links)); } }; window.addEventListener('aether:graph', receive); return () => window.removeEventListener('aether:graph', receive); }, [onChange]);
  const resetGraph = () => { setSelected('ocean'); setPending(null); setPan({ x: 0, y: 0 }); setZoom(.72); setMenuOpen(false); commit(fresh(parameters)); };
  const add = (kind: Kind) => {
    if (kind === 'ocean' && graph.nodes.some((node) => node.kind === kind) || kind === 'output' && graph.nodes.some((node) => node.kind === kind)) { setMenuOpen(false); return; }
    const origin = graph.nodes.find((node) => node.id === selected && node.kind !== 'output');
    const id = `${kind}-${Date.now()}`;
    const values = defaults(kind, parameters);
    if (kind === 'spiral') { values.hydrosSpiralScale = 1; values.hydrosRotation = 0; }
    if (kind === 'swell') values.hydrosWaveHeight = 0;
    if (kind === 'splash') values.hydrosSplash = 0;
    if (kind === 'current') values.hydrosCurrent = 0;
    if (kind === 'light') values.hydrosLight = 0;
    if (kind === 'bubbles') values.hydrosBubbles = 0;
    const node: Node = { id, kind, x: origin ? origin.x + 70 : 200, y: origin ? origin.y + 195 : 180, values };
    const outgoing = origin ? graph.links.filter((edge) => edge.from === origin.id) : [];
    const links = origin ? [...graph.links.filter((edge) => edge.from !== origin.id), { id: `${origin.id}-${id}`, from: origin.id, to: id }, ...outgoing.map((edge) => ({ id: `${id}-${edge.to}`, from: id, to: edge.to }))] : graph.links;
    setSelected(id); setMenuOpen(false); commit({ nodes: [...graph.nodes, node], links });
  };
  const connect = (from: string, to: string) => {
    if (from === to || graph.nodes.find((node) => node.kind === 'output' && node.id === from) || graph.nodes.find((node) => node.kind === 'ocean' && node.id === to)) return;
    const queue = [to]; const seen = new Set<string>();
    while (queue.length) { const id = queue.pop()!; if (id === from) return; if (seen.has(id)) continue; seen.add(id); graph.links.filter((edge) => edge.from === id).forEach((edge) => queue.push(edge.to)); }
    setPending(null); commit({ ...graph, links: [...graph.links, { id: `${from}-${to}-${Date.now()}`, from, to }] });
  };
  const remove = (id: string) => { setSelected(''); commit({ nodes: graph.nodes.filter((node) => node.id !== id), links: graph.links.filter((edge) => edge.from !== id && edge.to !== id) }); };
  const setValue = (id: string, key: Key, value: number) => commit({ ...graph, nodes: graph.nodes.map((node) => node.id === id ? { ...node, values: { ...node.values, [key]: value } } : node) });
  const live = activeNodes(graph.nodes, graph.links);
  const current = graph.nodes.find((node) => node.id === selected);
  const value = (node: Node, key: Key) => Number(node.values[key] ?? parameters[key]);
  return <div className="graph-shell hydros-graph-shell">
    <div className="graph-toolbar"><div className="network-name"><span className="hydros-network-dot" /> ABYSSAL SPIRAL / OCEAN LAB <small>/ {live.length} LIVE NODES</small></div><div className="graph-toolbar-actions"><button type="button" title="Restore the default ocean node tree" onClick={resetGraph}>RESET TREE</button><button type="button" onClick={() => setPan({ x: 0, y: 0 })}>HOME</button><button type="button" onClick={() => setZoom((z) => Math.max(.4, z - .1))}>−</button><span>{Math.round(zoom * 100)}%</span><button type="button" onClick={() => setZoom((z) => Math.min(1.3, z + .1))}>＋</button><div className="add-node-wrap"><button className="add-node-button" type="button" onClick={() => setMenuOpen((open) => !open)}>＋ ADD NODE</button>{menuOpen && <div className="operator-menu">{(Object.keys(specs) as Kind[]).filter((kind) => kind !== 'ocean').map((kind) => <button key={kind} type="button" onClick={() => add(kind)}><span>{specs[kind].glyph}</span>{specs[kind].title}</button>)}</div>}</div></div></div>
    <div className="graph-canvas hydros-graph-canvas" onPointerDown={(event) => { if (event.target === event.currentTarget) panStart.current = { x: event.clientX, y: event.clientY, originX: pan.x, originY: pan.y }; }}><div className="canvas-dots" /><div className="graph-stage hydros-graph-stage" style={{ transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})` }}>
      <svg className="graph-connections">{graph.links.map((edge) => { const from = graph.nodes.find((node) => node.id === edge.from); const to = graph.nodes.find((node) => node.id === edge.to); if (!from || !to) return null; const active = live.some((node) => node.id === from.id) && live.some((node) => node.id === to.id); return <g key={edge.id} className={`connection ${active ? 'active hydro-active' : ''}`} onClick={() => commit({ ...graph, links: graph.links.filter((item) => item.id !== edge.id) })}><path d={`M ${from.x + 236} ${from.y + 92} C ${from.x + 320} ${from.y + 92},${to.x - 90} ${to.y + 92},${to.x} ${to.y + 92}`} /><circle cx={(from.x + to.x + 236) / 2} cy={(from.y + to.y + 184) / 2} r="7" /><text x={(from.x + to.x + 236) / 2} y={(from.y + to.y + 184) / 2 + 3}>×</text></g>; })}</svg>
      {graph.nodes.map((node) => <article key={node.id} className={`td-node hydro-node td-${node.kind} ${current?.id === node.id ? 'selected' : ''} ${live.some((item) => item.id === node.id) ? '' : 'bypassed'}`} style={{ left: node.x, top: node.y }} onPointerDown={(event) => { if ((event.target as HTMLElement).closest('button')) return; event.stopPropagation(); drag.current = { id: node.id, x: node.x - (event.clientX - pan.x) / zoom, y: node.y - (event.clientY - pan.y) / zoom }; setSelected(node.id); }}><header className="td-node-header"><span className="td-node-icon">{specs[node.kind].glyph}</span><b>{specs[node.kind].title}</b>{node.kind !== 'ocean' && node.kind !== 'output' && <button type="button" onClick={() => remove(node.id)} aria-label="Delete node">×</button>}</header><div className="td-node-subtitle">{specs[node.kind].sub}</div>{node.kind !== 'ocean' && <button className={`td-port in-port ${graph.links.some((edge) => edge.to === node.id) ? 'wired' : ''}`} type="button" aria-label="Connect input" onClick={(event) => { event.stopPropagation(); if (pending) connect(pending, node.id); }} />}{specs[node.kind].keys.slice(0, 2).map((key) => <div className="ray-node-readout" key={key}><span>{controls[key].label}</span><b>{value(node, key).toFixed(2)}</b></div>)}{node.kind !== 'output' && <button className={`td-port out-port ${pending === node.id ? 'armed' : ''} ${graph.links.some((edge) => edge.from === node.id) ? 'wired' : ''}`} type="button" aria-label="Start wire" onClick={(event) => { event.stopPropagation(); setPending(node.id); }} />}</article>)}
    </div><div className="canvas-instructions">INSERT OCEAN OPERATORS <i>·</i> CONNECT / BYPASS <i>·</i> MOVE: WASD · FLY: Q / E</div></div>
    <div className="node-inspector hydro-inspector"><div className="inspector-title"><div><span>NODE PARAMETERS</span><b>{current ? specs[current.kind].title : 'SELECT A NODE'}</b></div>{current && current.kind !== 'ocean' && current.kind !== 'output' && <button type="button" onClick={() => remove(current.id)}>DELETE NODE</button>}</div><div className="inspector-params">{current && specs[current.kind].keys.length ? specs[current.kind].keys.map((key) => { const control = controls[key]; return <label className="node-parameter" key={key}><span>{control.label}</span><output>{value(current, key).toFixed(3)}</output><input type="range" min={control.min} max={control.max} step={control.step} value={value(current, key)} onChange={(event) => setValue(current.id, key, Number(event.currentTarget.value))} /></label>; }) : <p>The ocean graph controls the giant spiral, moving swells, splash field, currents, underwater light, haze and bubble wake.</p>}</div></div>
  </div>;
}
