/** The persisted/editor/runtime interchange contract. Rendering parameters live
 * on nodes; layout, labels, and comments live in `editor` and are ignored by
 * the runtime compiler. */
export type WorldValueType = 'signal' | 'geometry' | 'material' | 'environment' | 'camera' | 'effect' | 'world';
export type WorldNodeKind =
  | 'input' | 'math' | 'clamp' | 'remap' | 'noise' | 'lfo' | 'switch' | 'compare' | 'quantize'
  | 'geometry' | 'transform' | 'deform' | 'material' | 'particles' | 'water' | 'model'
  | 'environment' | 'camera' | 'postfx' | 'render';
export type WorldNodeParameters = {
  input: { mode?: 'constant' | 'time' | 'mouseX' | 'mouseY' | 'pointer' | 'key' | 'audio' | 'bass' | 'mid' | 'highBand'; value: number; key?: string; bypass?: boolean };
  math: { operation?: string; value?: number; bypass?: boolean };
  clamp: { low?: number; high?: number; value?: number; bypass?: boolean };
  remap: { low?: number; high?: number; value?: number; bypass?: boolean };
  noise: { value?: number; bypass?: boolean };
  lfo: { value?: number; high?: number; bypass?: boolean };
  switch: { value?: number; operation?: string; bypass?: boolean };
  compare: { operation?: string; value?: number; bypass?: boolean };
  quantize: { high?: number; value?: number; bypass?: boolean };
  geometry: { shape?: string; color?: string; value?: number; bypass?: boolean };
  transform: { value?: number; low?: number; high?: number; bypass?: boolean };
  deform: { value?: number; low?: number; high?: number; bypass?: boolean };
  material: { color?: string; value?: number; low?: number; high?: number; bypass?: boolean };
  particles: { color?: string; value?: number; bypass?: boolean };
  water: { color?: string; value?: number; bypass?: boolean };
  model: { color?: string; value?: number; bypass?: boolean };
  environment: { color?: string; value?: number; bypass?: boolean };
  camera: { value?: number; position?: { x: number; y: number; z: number }; target?: { x: number; y: number; z: number }; bypass?: boolean };
  postfx: { value?: number; low?: number; high?: number; bypass?: boolean };
  render: { color?: string; value?: number; bypass?: boolean };
};
export type WorldGraphNode = { [K in WorldNodeKind]: { id: string; type: K; parameters: WorldNodeParameters[K] } }[WorldNodeKind];
export type WorldPort = { node: string; port: string };
export type WorldConnection = { id: string; from: WorldPort; to: WorldPort };
export type WorldDocument = {
  schemaVersion: 1;
  metadata: { id: string; name: string; sourceExample?: string };
  nodes: WorldGraphNode[];
  connections: WorldConnection[];
  editor: {
    positions: Record<string, { x: number; y: number }>;
    labels: Record<string, string>;
    collapsed?: Record<string, boolean>;
    comments?: Array<{ id: string; text: string; x: number; y: number }>;
  };
};

const signalKinds = new Set<WorldNodeKind>(['input', 'math', 'clamp', 'remap', 'noise', 'lfo', 'switch', 'compare', 'quantize']);
const geometryKinds = new Set<WorldNodeKind>(['geometry', 'transform', 'deform', 'particles', 'water', 'model']);
const portSchemas: Record<WorldNodeKind, { output: WorldValueType; inputs: Record<string, WorldValueType> }> = {
  input: { output: 'signal', inputs: {} }, math: { output: 'signal', inputs: { a: 'signal', b: 'signal' } },
  clamp: { output: 'signal', inputs: { value: 'signal' } }, remap: { output: 'signal', inputs: { value: 'signal' } },
  noise: { output: 'signal', inputs: { seed: 'signal' } }, lfo: { output: 'signal', inputs: {} },
  switch: { output: 'signal', inputs: { condition: 'signal', a: 'signal', b: 'signal' } },
  compare: { output: 'signal', inputs: { a: 'signal', b: 'signal' } }, quantize: { output: 'signal', inputs: { value: 'signal' } },
  geometry: { output: 'geometry', inputs: { field: 'signal' } }, transform: { output: 'geometry', inputs: { geometry: 'geometry', amount: 'signal' } },
  deform: { output: 'geometry', inputs: { geometry: 'geometry', field: 'signal', amount: 'signal' } },
  material: { output: 'material', inputs: { geometry: 'geometry', color: 'signal', roughness: 'signal' } },
  // These systems expose one primary modulation input, serialized as `value`
  // by the editor's single-port node UI.
  particles: { output: 'geometry', inputs: { value: 'signal' } }, water: { output: 'geometry', inputs: { value: 'signal' } },
  model: { output: 'geometry', inputs: { value: 'signal' } },
  environment: { output: 'environment', inputs: { density: 'signal' } }, camera: { output: 'camera', inputs: { fov: 'signal' } },
  postfx: { output: 'effect', inputs: { bloom: 'signal' } },
  render: { output: 'world', inputs: { geometry: 'geometry', material: 'material', environment: 'environment', camera: 'camera', effect: 'effect', world: 'world' } },
};

export type EditorGraphLike = {
  nodes: Array<{ id: string; kind: WorldNodeKind; x: number; y: number; label: string; [key: string]: unknown }>;
  links: Array<{ id: string; from: string; to: string; fromPort?: string; toPort?: string }>;
};

function outputPort(kind: WorldNodeKind) {
  return signalKinds.has(kind) ? 'value' : geometryKinds.has(kind) ? 'geometry' : kind === 'material' ? 'surface' : kind;
}

function inputPort(from: WorldNodeKind, to: WorldNodeKind, index = 0) {
  if (to === 'render') return portSchemas[from].output;
  if (to === 'transform' || to === 'deform') return geometryKinds.has(from) ? 'geometry' : from === 'input' ? 'amount' : 'field';
  if (to === 'material') return geometryKinds.has(from) ? 'geometry' : 'color';
  if (to === 'environment') return 'density';
  if (to === 'camera') return 'fov';
  if (to === 'postfx') return 'bloom';
  if (to === 'switch') return ['condition', 'a', 'b'][Math.min(index, 2)];
  if (to === 'math' || to === 'compare') return index === 0 ? 'a' : 'b';
  return 'value';
}

export function inferWorldPorts(from: WorldNodeKind, to: WorldNodeKind, index = 0): { fromPort: string; toPort: string } | null {
  const source = portSchemas[from]; const target = portSchemas[to];
  if (!source || !target) return null;
  const toPort = inputPort(from, to, index);
  if (source.output !== target.inputs[toPort]) return null;
  return { fromPort: outputPort(from), toPort };
}

export function validateWorldDocument(document: WorldDocument): string[] {
  const errors: string[] = [];
  if (document.schemaVersion !== 1) errors.push(`Unsupported world schema version: ${document.schemaVersion}`);
  const nodes = new Map(document.nodes.map((node) => [node.id, node]));
  const adjacency = new Map<string, string[]>();
  for (const connection of document.connections) {
    const from = nodes.get(connection.from.node);
    const to = nodes.get(connection.to.node);
    if (!from || !to) { errors.push(`Connection ${connection.id} references a missing node`); continue; }
    const sourceType = portSchemas[from.type];
    const targetType = portSchemas[to.type];
    const targetPort = targetType.inputs[connection.to.port];
    if (connection.from.port !== outputPort(from.type) || !targetPort || sourceType.output !== targetPort) errors.push(`Invalid connection ${from.type}.${connection.from.port} → ${to.type}.${connection.to.port}`);
    adjacency.set(from.id, [...(adjacency.get(from.id) ?? []), to.id]);
  }
  const active = new Set<string>(); const done = new Set<string>();
  const visit = (id: string) => {
    if (active.has(id)) { errors.push(`Cycle detected at ${id}`); return; }
    if (done.has(id)) return;
    active.add(id); (adjacency.get(id) ?? []).forEach(visit); active.delete(id); done.add(id);
  };
  document.nodes.forEach((node) => visit(node.id));
  return [...new Set(errors)];
}

/** An explicit compiler boundary keeps execution data independent of editor layout. */
export type RuntimeWorld = { nodes: Array<Record<string, unknown> & { id: string; kind: WorldNodeKind }>; links: Array<{ id: string; from: string; to: string; fromPort: string; toPort: string }> };
export function compileWorldDocument(document: WorldDocument): RuntimeWorld {
  const errors = validateWorldDocument(document);
  if (errors.length) throw new Error(`Invalid world graph: ${errors.join('; ')}`);
  const nodes = document.nodes.map((node) => ({ ...node.parameters, id: node.id, kind: node.type }));
  const links = document.connections.map((edge) => ({ id: edge.id, from: edge.from.node, to: edge.to.node, fromPort: edge.from.port, toPort: edge.to.port }));
  return { nodes, links };
}

export function serializeWorldDocument(graph: EditorGraphLike, id: string, name: string, sourceExample?: string): WorldDocument {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const nodes = graph.nodes.map((node) => {
    const { id: _id, kind, x: _x, y: _y, label: _label, ...parameters } = node;
    return { id: node.id, type: kind, parameters };
  }) as WorldGraphNode[];
  const usedInputs = new Map<string, number>();
  const connections = graph.links.map((edge) => {
    const fromNode = byId.get(edge.from); const toNode = byId.get(edge.to);
    const fromKind = fromNode?.kind ?? 'input'; const toKind = toNode?.kind ?? 'render';
    const inputIndex = usedInputs.get(edge.to) ?? 0;
    usedInputs.set(edge.to, inputIndex + 1);
    return { id: edge.id, from: { node: edge.from, port: edge.fromPort ?? outputPort(fromKind) }, to: { node: edge.to, port: edge.toPort ?? inputPort(fromKind, toKind, inputIndex) } };
  });
  const document: WorldDocument = {
    schemaVersion: 1,
    metadata: { id, name, ...(sourceExample ? { sourceExample } : {}) },
    nodes,
    connections,
    editor: { positions: Object.fromEntries(graph.nodes.map((node) => [node.id, { x: node.x, y: node.y }])), labels: Object.fromEntries(graph.nodes.map((node) => [node.id, node.label])) },
  };
  return document;
}

export function deserializeWorldDocument(document: WorldDocument): EditorGraphLike {
  const runtime = compileWorldDocument(document);
  return {
    nodes: runtime.nodes.map((node) => ({ ...node, id: node.id, kind: node.kind, x: document.editor.positions[node.id]?.x ?? 0, y: document.editor.positions[node.id]?.y ?? 0, label: document.editor.labels[node.id] ?? node.kind })) as EditorGraphLike['nodes'],
    links: document.connections.map((edge) => ({ id: edge.id, from: edge.from.node, to: edge.to.node, fromPort: edge.from.port, toPort: edge.to.port })),
  };
}

export function isWorldDocument(value: unknown): value is WorldDocument {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<WorldDocument>;
  return candidate.schemaVersion === 1 && Boolean(candidate.metadata) && Array.isArray(candidate.nodes) && Array.isArray(candidate.connections) && Boolean(candidate.editor);
}
