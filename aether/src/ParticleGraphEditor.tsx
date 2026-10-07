import { useEffect, useRef, useState } from 'react';
import type { FirstWorldParameters } from './worlds/FirstWorld';
import { defaultFirstWorldParameters } from './worlds/FirstWorld';

type NodeType = 'source' | 'noise' | 'turbulence' | 'vortex' | 'attractor' | 'gravity' | 'wave' | 'boundary' | 'integrator' | 'palette' | 'render';
type Node = { id: string; type: NodeType; x: number; y: number; values: Partial<FirstWorldParameters> };
type Link = { id: string; from: string; to: string };
type Project = { nodes: Node[]; links: Link[] };
type Props = { worldId: string; parameters: FirstWorldParameters; onChange: (values: Partial<FirstWorldParameters>) => void };

const nodeInfo: Record<NodeType, { title: string; icon: string; hint: string; keys: Array<keyof FirstWorldParameters> }> = {
  source: { title: 'PARTICLE SOURCE', icon: '◉', hint: 'EMIT · DISTRIBUTION · INITIAL ENERGY', keys: ['particleShape', 'sourceSize', 'sourceSpeed', 'particleCount', 'seed'] },
  noise: { title: 'NOISE FIELD', icon: '∿', hint: '3D CURL FIELD · GPU', keys: ['flowScale', 'flowStrength'] },
  turbulence: { title: 'TURBULENCE', icon: '⟋', hint: 'FRACTAL DETAIL FORCE', keys: ['turbulenceScale', 'turbulenceStrength'] },
  vortex: { title: 'VORTEX', icon: '⟳', hint: 'ANGULAR FORCE · Z AXIS', keys: ['vortexRadius', 'vortexStrength'] },
  attractor: { title: 'ATTRACT / REPEL', icon: '⊙', hint: 'RADIAL FORCE · SIGNED', keys: ['attractorRadius', 'attractorStrength'] },
  gravity: { title: 'GRAVITY', icon: '↓', hint: 'DIRECTIONAL FORCE', keys: ['gravityStrength'] },
  wave: { title: 'WAVE OSCILLATOR', icon: '≈', hint: 'POSITION MODULATED FORCE', keys: ['waveScale', 'waveStrength'] },
  boundary: { title: 'BOUNDARY', icon: '◎', hint: 'SOFT SPHERICAL CONSTRAINT', keys: ['radius', 'confinement'] },
  integrator: { title: 'INTEGRATOR', icon: '↝', hint: 'VELOCITY · TIME STEP', keys: ['damping', 'timeScale'] },
  palette: { title: 'COLOR RAMP', icon: '◒', hint: 'PER PARTICLE PALETTE', keys: ['palette', 'paletteMix'] },
  render: { title: 'SPRITE RENDER', icon: '✳', hint: 'ADDITIVE POINT SPRITES', keys: ['particleSize', 'sharpness', 'glow'] },
};

const controlInfo: Partial<Record<keyof FirstWorldParameters, { label: string; min: number; max: number; step: number }>> = {
  particleCount: { label: 'Particle count', min: 12000, max: 1000000, step: 10000 }, seed: { label: 'Seed / reseed', min: 1, max: 1000, step: 1 }, sourceSize: { label: 'Source size', min: .2, max: 3, step: .01 }, sourceSpeed: { label: 'Initial velocity', min: 0, max: .1, step: .001 },
  flowScale: { label: 'Field scale', min: 0.2, max: 7, step: 0.01 }, flowStrength: { label: 'Field strength', min: 0, max: 4, step: 0.01 },
  turbulenceScale: { label: 'Detail scale', min: 0.2, max: 14, step: 0.01 }, turbulenceStrength: { label: 'Turbulence', min: 0, max: 5, step: 0.01 },
  vortexRadius: { label: 'Influence radius', min: 0.1, max: 6, step: 0.01 }, vortexStrength: { label: 'Spin', min: -7, max: 7, step: 0.01 },
  attractorRadius: { label: 'Influence radius', min: 0.1, max: 6, step: 0.01 }, attractorStrength: { label: 'Attract / repel', min: -8, max: 8, step: 0.01 },
  gravityStrength: { label: 'Gravity', min: -5, max: 5, step: 0.01 }, waveScale: { label: 'Wave frequency', min: 0.1, max: 12, step: 0.01 }, waveStrength: { label: 'Wave amplitude', min: 0, max: 5, step: 0.01 },
  radius: { label: 'Boundary radius', min: 0.4, max: 5, step: 0.01 }, confinement: { label: 'Boundary force', min: 0, max: 7, step: 0.01 },
  damping: { label: 'Velocity damping', min: 0.9, max: 1, step: 0.001 }, timeScale: { label: 'Simulation speed', min: 0, max: 2.5, step: 0.01 },
  palette: { label: 'Palette · 0 cyan / 4 violet', min: 0, max: 4, step: 1 }, paletteMix: { label: 'Palette blend', min: 0, max: 1, step: 0.01 },
  particleSize: { label: 'Sprite size', min: 0.004, max: 0.04, step: 0.001 }, sharpness: { label: 'Core sharpness', min: 0, max: 1, step: 0.01 }, glow: { label: 'Emission', min: 0, max: 1, step: 0.01 },
};

function nodeDefaults(type: NodeType, p: FirstWorldParameters): Partial<FirstWorldParameters> {
  switch (type) {
    case 'source': return { particleShape: p.particleShape, sourceSize: p.sourceSize, sourceSpeed: p.sourceSpeed, particleCount: p.particleCount, seed: p.seed };
    case 'noise': return { flowScale: p.flowScale, flowStrength: p.flowStrength };
    case 'turbulence': return { turbulenceScale: p.turbulenceScale, turbulenceStrength: 0.65 };
    case 'vortex': return { vortexRadius: 1.8, vortexStrength: 0.8 };
    case 'attractor': return { attractorRadius: 1.25, attractorStrength: 0.55 };
    case 'gravity': return { gravityStrength: 0.35 };
    case 'wave': return { waveScale: p.waveScale, waveStrength: 0.6 };
    case 'boundary': return { radius: p.radius, confinement: p.confinement };
    case 'integrator': return { damping: p.damping, timeScale: p.timeScale };
    case 'palette': return { palette: p.palette, paletteMix: p.paletteMix };
    case 'render': return { particleSize: p.particleSize, sharpness: p.sharpness, glow: p.glow };
  }
}

function initialProject(p: FirstWorldParameters): Project {
  const types: NodeType[] = ['source', 'noise', 'turbulence', 'vortex', 'attractor', 'gravity', 'wave', 'boundary', 'integrator', 'palette', 'render'];
  const positions: Record<NodeType, [number, number]> = {
    source: [40, 180], noise: [320, 0], turbulence: [600, 0], vortex: [880, 0], attractor: [880, 180],
    gravity: [600, 180], wave: [320, 180], boundary: [40, 360], integrator: [320, 360], palette: [600, 360], render: [880, 360],
  };
  const nodes = types.map((type) => ({ id: type, type, x: positions[type][0], y: positions[type][1], values: nodeDefaults(type, p) }));
  const links = nodes.slice(0, -1).map((node, index) => ({ id: `${node.id}-${nodes[index + 1].id}`, from: node.id, to: nodes[index + 1].id }));
  return { nodes, links };
}

function reachable(nodes: Node[], links: Link[]) {
  const forward = new Set(nodes.filter((node) => node.type === 'source').map((node) => node.id));
  let changed = true;
  while (changed) { changed = false; for (const link of links) if (forward.has(link.from) && !forward.has(link.to)) { forward.add(link.to); changed = true; } }
  const backward = new Set(nodes.filter((node) => node.type === 'render').map((node) => node.id));
  changed = true;
  while (changed) { changed = false; for (const link of links) if (backward.has(link.to) && !backward.has(link.from)) { backward.add(link.from); changed = true; } }
  return nodes.filter((node) => forward.has(node.id) && backward.has(node.id));
}

function evaluate(nodes: Node[], links: Link[]): Partial<FirstWorldParameters> {
  const active = reachable(nodes, links);
  const result: Partial<FirstWorldParameters> = { flowStrength: 0, turbulenceStrength: 0, vortexStrength: 0, attractorStrength: 0, gravityStrength: 0, waveStrength: 0, confinement: 0, timeScale: 0, glow: 0, paletteMix: 0.72 };
  const add = (key: keyof FirstWorldParameters, value: number) => { result[key] = Number(result[key] ?? 0) + value; };
  for (const node of active) {
    const values = node.values;
    if (node.type === 'source') { result.particleCount = values.particleCount; result.seed = values.seed; result.particleShape = values.particleShape; result.sourceSize = values.sourceSize; result.sourceSpeed = values.sourceSpeed; }
    if (node.type === 'noise') { result.flowScale = values.flowScale; add('flowStrength', Number(values.flowStrength ?? 0)); }
    if (node.type === 'turbulence') { result.turbulenceScale = values.turbulenceScale; add('turbulenceStrength', Number(values.turbulenceStrength ?? 0)); }
    if (node.type === 'vortex') { result.vortexRadius = values.vortexRadius; add('vortexStrength', Number(values.vortexStrength ?? 0)); }
    if (node.type === 'attractor') { result.attractorRadius = values.attractorRadius; add('attractorStrength', Number(values.attractorStrength ?? 0)); }
    if (node.type === 'gravity') add('gravityStrength', Number(values.gravityStrength ?? 0));
    if (node.type === 'wave') { result.waveScale = values.waveScale; add('waveStrength', Number(values.waveStrength ?? 0)); }
    if (node.type === 'boundary') { result.radius = values.radius; add('confinement', Number(values.confinement ?? 0)); }
    if (node.type === 'integrator') { result.damping = values.damping; result.timeScale = values.timeScale; }
    if (node.type === 'palette') { result.palette = values.palette; result.paletteMix = values.paletteMix; }
    if (node.type === 'render') { result.particleSize = values.particleSize; result.sharpness = values.sharpness; result.glow = values.glow; }
  }
  return result;
}

export function ParticleGraphEditor({ worldId, parameters, onChange }: Props) {
  const storageKey = `aether.graph.${worldId}.v2`;
  const [project, setProject] = useState<Project>(() => {
    try { const saved = localStorage.getItem(storageKey); if (saved) return JSON.parse(saved) as Project; } catch { /* Start with a fresh project. */ }
    return initialProject(parameters);
  });
  const [selected, setSelected] = useState('noise');
  const [pendingOutput, setPendingOutput] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(0.72);
  const drag = useRef<{ id: string; x: number; y: number } | null>(null);
  const panning = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  useEffect(() => { localStorage.setItem(storageKey, JSON.stringify(project)); }, [storageKey, project]);
  useEffect(() => { onChange(evaluate(project.nodes, project.links)); window.dispatchEvent(new CustomEvent('aether:graph', { detail: { worldId, graph: project } })); }, []);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (drag.current) {
        const d = drag.current;
        setProject((current) => ({ ...current, nodes: current.nodes.map((node) => node.id === d.id ? { ...node, x: Math.max(10, d.x + ((event.clientX - pan.x) / zoom)), y: Math.max(10, d.y + ((event.clientY - pan.y) / zoom)) } : node) }));
      } else if (panning.current) {
        const p = panning.current;
        setPan({ x: p.panX + event.clientX - p.x, y: p.panY + event.clientY - p.y });
      }
    };
    const end = () => { drag.current = null; panning.current = null; };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); };
  }, [zoom, pan]);

  const commit = (next: Project) => { setProject(next); onChange(evaluate(next.nodes, next.links)); window.dispatchEvent(new CustomEvent('aether:graph', { detail: { worldId, graph: next } })); };
  useEffect(() => { const receive = (event: Event) => { const detail = (event as CustomEvent).detail; if (detail?.remote && detail.worldId === worldId && detail.graph?.nodes && detail.graph?.links) { setProject(detail.graph as typeof project); onChange(evaluate(detail.graph.nodes, detail.graph.links)); } }; window.addEventListener('aether:graph', receive); return () => window.removeEventListener('aether:graph', receive); }, [onChange]);
  const addNode = (type: NodeType) => {
    if ((type === 'source' && project.nodes.some((node) => node.type === 'source')) || (type === 'render' && project.nodes.some((node) => node.type === 'render'))) { setMenuOpen(false); return; }
    const id = `${type}-${Date.now()}`;
    const origin = project.nodes.find((node) => node.id === selected && node.type !== 'render');
    const outgoing = origin ? project.links.filter((link) => link.from === origin.id) : [];
    const inserted = { id, type, x: origin ? origin.x + 80 : 150 + Math.random() * 430, y: origin ? origin.y + 210 : 120 + Math.random() * 360, values: nodeDefaults(type, parameters) };
    let links = project.links;
    if (origin) {
      links = [...project.links.filter((link) => link.from !== origin.id), { id: `${origin.id}-${id}`, from: origin.id, to: id }, ...outgoing.map((link) => ({ ...link, id: `${id}-${link.to}`, from: id }))];
    }
    setSelected(id); setMenuOpen(false); commit({ nodes: [...project.nodes, inserted], links });
  };
  const connect = (from: string, to: string) => {
    if (from === to || project.nodes.find((node) => node.id === to)?.type === 'source' || project.nodes.find((node) => node.id === from)?.type === 'render') return;
    const queue = [to]; const seen = new Set<string>();
    while (queue.length) { const current = queue.pop()!; if (current === from) return; if (seen.has(current)) continue; seen.add(current); project.links.filter((link) => link.from === current).forEach((link) => queue.push(link.to)); }
    const nextLinks = [...project.links, { id: `${from}-${to}-${Date.now()}`, from, to }];
    setPendingOutput(null); commit({ ...project, links: nextLinks });
  };
  const updateValue = (nodeId: string, key: keyof FirstWorldParameters, value: number) => {
    const nodes = project.nodes.map((node) => node.id === nodeId ? { ...node, values: { ...node.values, [key]: value } } : node);
    commit({ ...project, nodes });
  };
  const active = reachable(project.nodes, project.links);
  const removeNode = (id: string) => {
    const next = { nodes: project.nodes.filter((node) => node.id !== id), links: project.links.filter((link) => link.from !== id && link.to !== id) };
    setSelected(''); commit(next);
  };
  const inspectorNode = project.nodes.find((node) => node.id === selected);
  const displayValue = (node: Node, key: keyof FirstWorldParameters) => Number(node.values[key] ?? parameters[key]);

  return <div className="graph-shell">
    <div className="graph-toolbar"><div className="network-name"><span className="network-dot" /> PARTICLE NETWORK <small>/ {active.length} ACTIVE</small></div><div className="graph-toolbar-actions"><button type="button" title="Restore the default particle node tree" onClick={() => { setSelected('noise'); setPendingOutput(null); setPan({ x: 0, y: 0 }); setZoom(.72); setMenuOpen(false); commit(initialProject(defaultFirstWorldParameters)); }}>RESET TREE</button><button type="button" onClick={() => setPan({ x: 0, y: 0 })}>HOME</button><button type="button" onClick={() => setZoom((value) => Math.max(0.4, value - 0.1))}>−</button><span>{Math.round(zoom * 100)}%</span><button type="button" onClick={() => setZoom((value) => Math.min(1.3, value + 0.1))}>＋</button><div className="add-node-wrap"><button className="add-node-button" type="button" onClick={() => setMenuOpen((value) => !value)}>＋ ADD OPERATOR</button>{menuOpen && <div className="operator-menu">{(Object.keys(nodeInfo) as NodeType[]).map((type) => <button type="button" key={type} onClick={() => addNode(type)}><span>{nodeInfo[type].icon}</span>{nodeInfo[type].title}</button>)}</div>}</div></div></div>
    <div className="graph-canvas" onPointerDown={(event) => { if (event.target === event.currentTarget || (event.target as HTMLElement).classList.contains('canvas-dots')) { panning.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y }; } }}>
      <div className="canvas-dots" />
      <div className="graph-stage" style={{ transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})` }}>
        <svg className="graph-connections">{project.links.map((link) => { const from = project.nodes.find((node) => node.id === link.from); const to = project.nodes.find((node) => node.id === link.to); if (!from || !to) return null; const activeLink = active.some((node) => node.id === from.id && active.some((target) => target.id === to.id)); return <g key={link.id} className={`connection ${activeLink ? 'active' : ''}`} onClick={() => commit({ ...project, links: project.links.filter((item) => item.id !== link.id) })}><path d={`M ${from.x + 236} ${from.y + 92} C ${from.x + 330} ${from.y + 92}, ${to.x - 90} ${to.y + 92}, ${to.x} ${to.y + 92}`} /><circle cx={(from.x + to.x + 236) / 2} cy={(from.y + to.y + 184) / 2} r="7" /><text x={(from.x + to.x + 236) / 2} y={(from.y + to.y + 184) / 2 + 3}>×</text></g>; })}</svg>
        {project.nodes.map((node) => {
          const info = nodeInfo[node.type];
          return <article key={node.id} className={`td-node td-${node.type} ${selected === node.id ? 'selected' : ''} ${active.some((item) => item.id === node.id) ? '' : 'bypassed'}`} style={{ left: node.x, top: node.y }} onPointerDown={(event) => { if ((event.target as HTMLElement).closest('button')) return; event.stopPropagation(); drag.current = { id: node.id, x: node.x - (event.clientX - pan.x) / zoom, y: node.y - (event.clientY - pan.y) / zoom }; setSelected(node.id); }}>
            <header className="td-node-header"><span className="td-node-icon">{info.icon}</span><b>{info.title}</b><button type="button" aria-label={`Delete ${info.title}`} onClick={() => removeNode(node.id)}>×</button></header><div className="td-node-subtitle">{info.hint}</div>
            {node.type !== 'source' && <button type="button" className={`td-port in-port ${project.links.some((link) => link.to === node.id) ? 'wired' : ''}`} aria-label="Connect input" onClick={(event) => { event.stopPropagation(); if (pendingOutput) connect(pendingOutput, node.id); }} />}
            <div className="td-node-values">{info.keys.slice(0, 2).map((key) => <div key={key}><span>{controlInfo[key]?.label ?? key}</span><b>{displayValue(node, key).toFixed(key === 'particleCount' ? 0 : 2)}</b></div>)}</div>
            {node.type !== 'render' && <button type="button" className={`td-port out-port ${pendingOutput === node.id ? 'armed' : ''} ${project.links.some((link) => link.from === node.id) ? 'wired' : ''}`} aria-label="Start wire" title="Choose this output, then click an input" onClick={(event) => { event.stopPropagation(); setPendingOutput(node.id); }} />}
          </article>;
        })}
      </div>
      <div className="canvas-instructions">DRAG OPERATORS TO ARRANGE <i>·</i> DRAG EMPTY CANVAS TO PAN <i>·</i> OUTPUT → INPUT TO CONNECT <i>·</i> CLICK WIRE TO DELETE</div>
    </div>
    <div className="node-inspector"><div className="inspector-title"><div><span>PARAMETER EDITOR</span><b>{inspectorNode ? nodeInfo[inspectorNode.type].title : 'SELECT AN OPERATOR'}</b></div>{inspectorNode && <button type="button" onClick={() => removeNode(inspectorNode.id)}>DELETE NODE</button>}</div>
      <div className="inspector-params">{inspectorNode ? nodeInfo[inspectorNode.type].keys.map((key) => { const setting = controlInfo[key]; if (key === 'particleShape') return <label className="node-parameter" key={key}><span>Particle form</span><select value={displayValue(inspectorNode, key)} onChange={(event) => updateValue(inspectorNode.id, key, Number(event.currentTarget.value))}><option value={0}>Braided cloud</option><option value={1}>Sphere</option><option value={2}>Helix</option><option value={3}>Disc</option><option value={4}>Twin rings</option></select></label>; return setting ? <label className="node-parameter" key={key}><span>{setting.label}</span><output>{displayValue(inspectorNode, key).toFixed(key === 'particleCount' ? 0 : key === 'damping' ? 3 : 2)}</output><input type="range" min={setting.min} max={setting.max} step={setting.step} value={displayValue(inspectorNode, key)} onChange={(event) => updateValue(inspectorNode.id, key, Number(event.currentTarget.value))} /></label> : null; }) : <p>Choose a node to edit its parameters. Only connected nodes between source and render affect the simulation.</p>}</div>
    </div>
  </div>;
}
