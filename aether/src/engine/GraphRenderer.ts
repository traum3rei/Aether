import * as THREE from 'three/webgpu';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import modelAsset from '../assets/y2k/cosmic spiral/cosmicspiral.obj?url';
import type { PostProcessingSettings } from './Renderer';

export type GraphRenderNode = {
  id: string;
  kind: string;
  shape?: string;
  color?: string;
  value?: number;
  label?: string;
  mode?: string;
  operation?: string;
  key?: string;
  bypass?: boolean;
  low?: number;
  high?: number;
  position?: { x: number; y: number; z: number };
  target?: { x: number; y: number; z: number };
};
export type GraphRenderLink = { id?: string; from: string; to: string; fromPort?: string; toPort?: string };
export type RenderGraph = { nodes: GraphRenderNode[]; links: GraphRenderLink[] };
export type AudioLevels = { amplitude: number; bass: number; mid: number; high: number };
export type RenderInputs = { x: number; y: number; pointer: number; keys: string[]; audio?: AudioLevels };

/** Builds the preview exclusively from renderable nodes upstream of Render Output. */
export class GraphRenderer {
  private readonly scene: THREE.Scene;
  private readonly root = new THREE.Group();
  private readonly updaters: Array<(time: number) => void> = [];
  private generation = 0;
  private graph: RenderGraph | null = null;
  private signature = '';
  private originalBackground: THREE.Scene['background'] | null = null;
  private inputs: RenderInputs = { x: .5, y: .5, pointer: 0, keys: [] };
  private readonly camera: THREE.PerspectiveCamera;
  private readonly onPostProcessing: (settings: PostProcessingSettings) => void;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, onPostProcessing: (settings: PostProcessingSettings) => void) {
    this.scene = scene;
    this.camera = camera;
    this.onPostProcessing = onPostProcessing;
    this.scene.add(this.root);
  }

  async setGraph(graph: RenderGraph, preserveBackground = false) {
    const signature = JSON.stringify({
      preserveBackground,
      nodes: graph.nodes,
      links: graph.links,
    });
    this.graph = graph;
    if (signature === this.signature) return;
    if (this.signature === '') this.originalBackground = this.scene.background;
    this.signature = signature;
    const generation = ++this.generation;
    this.clear();
    if (!preserveBackground) {
      this.root.add(new THREE.AmbientLight(0xc6e5ed, 1.05));
      const key = new THREE.PointLight(0x8ad8d0, 58, 24);
      key.position.set(-4, 5, 5);
      this.root.add(key);
      const fill = new THREE.PointLight(0xf4a6db, 42, 20);
      fill.position.set(4, -1, 3);
      this.root.add(fill);
    }
    const output = graph.nodes.find((node) => node.kind === 'render');
    if (!output) { if (!preserveBackground) this.scene.background = new THREE.Color(0x020202); return; }
    const incoming = new Map<string, GraphRenderLink[]>();
    for (const link of graph.links) incoming.set(link.to, [...(incoming.get(link.to) ?? []), link]);
    const reachable = new Set<string>();
    const pending = [output.id];
    while (pending.length) {
      const id = pending.pop()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      pending.push(...(incoming.get(id) ?? []).map((link) => link.from));
    }
    const sources = graph.nodes.filter((node) => reachable.has(node.id) && !node.bypass && ['geometry', 'particles', 'water', 'model'].includes(node.kind));
    if (!preserveBackground) this.scene.background = new THREE.Color(output.color ?? '#020202');
    const environment = graph.nodes.find((node) => reachable.has(node.id) && node.kind === 'environment');
    if (environment) {
      const environmentColor = environment.color ?? output.color ?? '#020202';
      this.scene.background = new THREE.Color(environmentColor);
      const density = THREE.MathUtils.clamp(environment.value ?? 0, 0, 0.2);
      this.scene.fog = density > 0 ? new THREE.FogExp2(environmentColor, density) : null;
    } else if (!preserveBackground) {
      this.scene.fog = null;
    }
    const cameraNode = graph.nodes.find((node) => reachable.has(node.id) && node.kind === 'camera');
    if (cameraNode) {
      this.camera.position.set(cameraNode.position?.x ?? 0, cameraNode.position?.y ?? 0, cameraNode.position?.z ?? 4);
      this.camera.lookAt(cameraNode.target?.x ?? 0, cameraNode.target?.y ?? 0, cameraNode.target?.z ?? 0);
      this.camera.fov = THREE.MathUtils.clamp(cameraNode.value ?? 50, 20, 110);
      this.camera.updateProjectionMatrix();
    }
    const postNode = graph.nodes.find((node) => reachable.has(node.id) && node.kind === 'postfx');
    this.onPostProcessing({ bloom: THREE.MathUtils.clamp(postNode?.value ?? 0, 0, 2), threshold: THREE.MathUtils.clamp(postNode?.low ?? 0.75, 0, 1), vignette: THREE.MathUtils.clamp(postNode?.high ?? 0, 0, 1) });
    for (let index = 0; index < sources.length; index += 1) {
      if (generation !== this.generation) return;
      const node = sources[index];
      const x = ((index % 3) - 1) * 2.4;
      const y = Math.floor(index / 3) * 1.8;
      const hasModulation = (incoming.get(node.id)?.length ?? 0) > 0;
      const signal = hasModulation ? this.readSignal(node.id, 0) : 1;
      if (node.kind === 'geometry') this.addGeometry(node, x, y, signal, this.geometryPipeline(node.id, output.id));
      else if (node.kind === 'particles') this.addParticles(node, x, y);
      else if (node.kind === 'water') this.addWater(node, x, y);
      else if (node.kind === 'model') await this.addModel(node, x, y, generation, signal);
    }
  }

  update(time: number) {
    for (const update of this.updaters) update(time);
  }

  setInputs(inputs: RenderInputs) {
    this.inputs = inputs;
  }

  setAudioLevels(audio: AudioLevels) {
    this.inputs = { ...this.inputs, audio };
  }

  clearGraph() {
    if (!this.graph && this.signature === '') return;
    this.generation += 1;
    this.signature = '';
    this.graph = null;
    this.clear();
    this.scene.background = this.originalBackground ?? new THREE.Color(0x020202);
    this.scene.fog = null;
    this.onPostProcessing({ bloom: 0, threshold: 0.75, vignette: 0 });
    this.originalBackground = null;
  }

  private readSignal(targetId: string, time: number): number {
    const graph = this.graph;
    if (!graph) return 0;
    const incoming = new Map<string, GraphRenderLink[]>();
    for (const edge of graph.links) incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge]);
    const cache = new Map<string, number>(); const active = new Set<string>();
    const evaluate = (id: string): number => {
      if (cache.has(id)) return cache.get(id)!;
      if (active.has(id)) return 0;
      const node = graph.nodes.find((entry) => entry.id === id);
      if (!node) return 0;
      active.add(id);
      const edges = [...(incoming.get(id) ?? [])].sort((a, b) => (a.toPort ?? '').localeCompare(b.toPort ?? ''));
      const values = edges.map((edge) => evaluate(edge.from));
      let value = node.value ?? 0;
      if (node.bypass) value = values.length ? values.reduce((a, b) => a + b, 0) : value;
      else if (node.kind === 'input' && node.mode === 'time') value = (Math.sin(time) + 1) / 2;
      else if (node.kind === 'input' && node.mode === 'mouseX') value = this.inputs.x;
      else if (node.kind === 'input' && node.mode === 'mouseY') value = this.inputs.y;
      else if (node.kind === 'input' && node.mode === 'pointer') value = this.inputs.pointer;
      else if (node.kind === 'input' && node.mode === 'audio') value = this.inputs.audio?.amplitude ?? 0;
      else if (node.kind === 'input' && node.mode === 'bass') value = this.inputs.audio?.bass ?? 0;
      else if (node.kind === 'input' && node.mode === 'mid') value = this.inputs.audio?.mid ?? 0;
      else if (node.kind === 'input' && node.mode === 'highBand') value = this.inputs.audio?.high ?? 0;
      else if (node.kind === 'input' && node.mode === 'key') value = this.inputs.keys.includes(node.key ?? '') ? 1 : 0;
      else if (node.kind === 'math' && values.length) {
        value = node.operation === 'multiply' ? values.reduce((a, b) => a * b, 1)
          : node.operation === 'subtract' ? values.slice(1).reduce((a, b) => a - b, values[0])
            : node.operation === 'divide' ? values.slice(1).reduce((a, b) => a / (b || 1), values[0])
              : node.operation === 'average' ? values.reduce((a, b) => a + b, 0) / values.length
                : node.operation === 'min' ? Math.min(...values)
                  : node.operation === 'max' ? Math.max(...values)
                    : node.operation === 'power' ? Math.pow(values[0], values[1] ?? 1)
                      : node.operation === 'abs' ? Math.abs(values[0])
                        : node.operation === 'sin' ? Math.sin(values[0])
                          : node.operation === 'cos' ? Math.cos(values[0])
                            : node.operation === 'clamp01' ? THREE.MathUtils.clamp(values[0], 0, 1)
                              : values.reduce((a, b) => a + b, 0);
      } else if (node.kind === 'lfo') value = (Math.sin(time * (node.high ?? 1) + (node.value ?? 0)) + 1) / 2;
      else if (node.kind === 'noise') { const seed = (values[0] ?? time) * 127.1 + (node.value ?? 0) * 311.7; const raw = Math.sin(seed) * 43758.5453; value = raw - Math.floor(raw); }
      else if (node.kind === 'clamp' && values.length) value = THREE.MathUtils.clamp(values[0], node.low ?? 0, node.high ?? 1);
      else if (node.kind === 'remap' && values.length) value = (node.low ?? 0) + values[0] * ((node.high ?? 1) - (node.low ?? 0));
      else if (node.kind === 'quantize' && values.length) value = Math.round(values[0] / Math.max(.0001, node.high ?? .1)) * Math.max(.0001, node.high ?? .1);
      else if (node.kind === 'compare' && values.length > 1) value = node.operation === 'less' ? Number(values[0] < values[1]) : node.operation === 'equal' ? Number(Math.abs(values[0] - values[1]) < .0001) : Number(values[0] > values[1]);
      else if (node.kind === 'switch' && values.length) value = values[0] > 0 ? (values[1] ?? node.value ?? 0) : (values[2] ?? 0);
      else if (['transform', 'deform'].includes(node.kind) && values.length) value = values[values.length - 1];
      else if (values.length && ['geometry','particles','water','model'].includes(node.kind)) value = values[0];
      active.delete(id); cache.set(id, value); return value;
    };
    return evaluate(targetId);
  }

  private findNode(id: string) {
    return this.graph?.nodes.find((node) => node.id === id);
  }

  /** The connected operators between a generator and output form its render
   * pipeline. This is the first executable system chain, rather than treating
   * every node as a decorative object in a gallery scene. */
  private geometryPipeline(sourceId: string, outputId: string) {
    const graph = this.graph;
    if (!graph) return [] as GraphRenderNode[];
    const outgoing = new Map<string, string[]>();
    for (const edge of graph.links) outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
    const reachable = new Set<string>();
    const pending = [sourceId];
    while (pending.length) {
      const id = pending.pop()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      pending.push(...(outgoing.get(id) ?? []));
    }
    if (!reachable.has(outputId)) return [];
    return graph.nodes.filter((node) => reachable.has(node.id) && node.id !== sourceId && node.id !== outputId);
  }

  dispose() {
    this.generation += 1;
    this.signature = '';
    this.clear();
    this.scene.remove(this.root);
    this.scene.background = this.originalBackground ?? new THREE.Color(0x020202);
    this.originalBackground = null;
  }

  private clear() {
    this.updaters.length = 0;
    this.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Points)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => material.dispose());
    });
    this.root.clear();
  }

  private addGeometry(node: GraphRenderNode, x: number, y: number, signal: number, pipeline: GraphRenderNode[]) {
    const shape = node.shape ?? 'sphere';
    const geometry = shape === 'box' ? new THREE.BoxGeometry(1.4, 1.4, 1.4)
      : shape === 'torus' ? new THREE.TorusGeometry(.78, .22, 24, 100)
        : shape === 'torusKnot' ? new THREE.TorusKnotGeometry(.65, .22, 160, 20)
          : shape === 'icosahedron' ? new THREE.IcosahedronGeometry(.9, 2)
            : shape === 'octahedron' ? new THREE.OctahedronGeometry(.95, 1)
              : shape === 'dodecahedron' ? new THREE.DodecahedronGeometry(.9, 1)
                : shape === 'cone' ? new THREE.ConeGeometry(.8, 1.6, 48)
                  : shape === 'cylinder' ? new THREE.CylinderGeometry(.55, .8, 1.5, 48, 1, true)
                    : shape === 'capsule' ? new THREE.CapsuleGeometry(.48, .72, 8, 24)
        : shape === 'plane' ? new THREE.PlaneGeometry(2.6, 2.6, 1, 1)
          : new THREE.SphereGeometry(.9, 48, 32);
    const materialNode = pipeline.find((operator) => operator.kind === 'material');
    const deformNode = pipeline.find((operator) => operator.kind === 'deform');
    const transformNode = pipeline.find((operator) => operator.kind === 'transform');
    const surfaceColor = materialNode?.color ?? node.color ?? '#61d5c1';
    const material = new THREE.MeshPhysicalMaterial({
      color: surfaceColor,
      emissive: surfaceColor,
      emissiveIntensity: materialNode?.value ?? 0.32,
      metalness: 0.62,
      roughness: materialNode?.high ?? 0.2,
      clearcoat: 0.82,
      side: ['plane', 'cylinder'].includes(shape) ? THREE.DoubleSide : THREE.FrontSide,
    });
    const basePositions = (geometry.getAttribute('position') as THREE.BufferAttribute).array.slice();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.setScalar(THREE.MathUtils.clamp(node.value ?? 1, .1, 5) * (transformNode?.value ?? 1) * (.55 + signal * 0.9));
    // One generator is a world-sized composition. Multiple generators form a
    // loose constellation instead of a spreadsheet-like grid.
    const phase = Number(node.id.replace(/\D/g, '').slice(-3)) || 0;
    mesh.position.set(x * .22, y * .22, 0);
    if (shape === 'plane') mesh.rotation.x = -Math.PI / 3;
    this.root.add(mesh);
    this.updaters.push((time) => {
      mesh.rotation.y = time * (0.08 + (transformNode?.high ?? .2)) + phase * .01;
      mesh.rotation.x = Math.sin(time * .12 + phase) * (transformNode?.low ?? .08);
      const modulation = this.readSignal(node.id, time);
      const current = this.findNode(node.id);
      mesh.scale.setScalar(THREE.MathUtils.clamp(current?.value ?? 1, .1, 5) * (transformNode?.value ?? 1) * (.55 + modulation * 0.9));
      if (deformNode) {
        const attribute = geometry.getAttribute('position') as THREE.BufferAttribute;
        const strength = deformNode.value ?? .18;
        const frequency = Math.max(.1, deformNode.high ?? 3.2);
        const flow = time * (deformNode.low ?? .25);
        const control = this.readSignal(deformNode.id, time);
        for (let index = 0; index < attribute.count; index += 1) {
          const px = basePositions[index * 3]; const py = basePositions[index * 3 + 1]; const pz = basePositions[index * 3 + 2];
          const wave = Math.sin(px * frequency + flow) * Math.cos(py * frequency * .73 - flow) * Math.sin(pz * frequency * .61 + flow * .7);
          const radius = Math.hypot(px, py, pz) || 1;
          const amount = wave * strength * (.65 + control * .7);
          attribute.setXYZ(index, px + px / radius * amount, py + py / radius * amount, pz + pz / radius * amount);
        }
        attribute.needsUpdate = true;
        geometry.computeVertexNormals();
      }
    });
  }

  private addParticles(node: GraphRenderNode, x: number, y: number) {
    const count = Math.round(THREE.MathUtils.clamp(node.value ?? 3000, 100, 30000));
    const positions = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = (Math.random() - .5) * 2.8;
      positions[i * 3 + 1] = (Math.random() - .5) * 2.8;
      positions[i * 3 + 2] = (Math.random() - .5) * 2.8;
      phases[i] = Math.random() * Math.PI * 2;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({ color: node.color ?? '#ffd56b', size: .035, sizeAttenuation: true }));
    points.position.set(x, y, 0);
    this.root.add(points);
    this.updaters.push((time) => {
      const attribute = geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < count; i += 1) attribute.setY(i, positions[i * 3 + 1] + Math.sin(time + phases[i]) * .08);
      attribute.needsUpdate = true;
      const signal = this.readSignal(node.id, time);
      points.scale.setScalar(.55 + THREE.MathUtils.clamp(signal, 0, 1) * 0.9);
    });
  }

  private addWater(node: GraphRenderNode, x: number, y: number) {
    const geometry = new THREE.PlaneGeometry(3.2, 3.2, 48, 48);
    const material = new THREE.MeshPhysicalMaterial({ color: node.color ?? '#168db5', emissive: node.color ?? '#168db5', emissiveIntensity: .22, metalness: .38, roughness: .16, transparent: true, opacity: .82, side: THREE.DoubleSide, clearcoat: 1 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2.7;
    mesh.position.set(x, y - .2, -.2);
    this.root.add(mesh);
    const base = geometry.getAttribute('position').array.slice();
    this.updaters.push((time) => {
      const attribute = geometry.getAttribute('position') as THREE.BufferAttribute;
      const current = this.findNode(node.id);
      const modulation = this.readSignal(node.id, time);
      for (let i = 0; i < attribute.count; i += 1) {
        const px = base[i * 3]; const py = base[i * 3 + 1];
        attribute.setZ(i, (Math.sin(px * 2.1 + time) * .08 + Math.cos(py * 1.7 - time * .7) * .06) * (current?.value ?? 1) * (.55 + THREE.MathUtils.clamp(modulation, 0, 1) * 0.9));
      }
      attribute.needsUpdate = true;
      geometry.computeVertexNormals();
    });
  }

  private async addModel(node: GraphRenderNode, x: number, y: number, generation: number, signal: number) {
    const model = await new OBJLoader().loadAsync(modelAsset);
    if (generation !== this.generation) {
      model.traverse((child) => { if (child instanceof THREE.Mesh) child.geometry.dispose(); });
      return;
    }
    model.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.material = new THREE.MeshPhysicalMaterial({ color: node.color ?? '#ed85de', metalness: .58, roughness: .22, emissive: node.color ?? '#ed85de', emissiveIntensity: .28, clearcoat: .85 });
      child.geometry.computeVertexNormals();
    });
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    const baseScale = 1.6 / Math.max(size.x, size.y, size.z, .001);
    model.scale.setScalar(baseScale * THREE.MathUtils.clamp(node.value ?? 1, .1, 5) * (.55 + signal * 0.9));
    model.position.set(x, y, 0);
    this.root.add(model);
    this.updaters.push((time) => { model.rotation.y = time * .12; const current = this.findNode(node.id); model.scale.setScalar(baseScale * THREE.MathUtils.clamp(current?.value ?? 1, .1, 5) * (.55 + THREE.MathUtils.clamp(this.readSignal(node.id, time), 0, 1) * 0.9)); });
  }
}
