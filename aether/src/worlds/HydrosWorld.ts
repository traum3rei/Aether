import * as THREE from 'three/webgpu';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { WaterMesh } from 'three/addons/objects/WaterMesh.js';
import {
  exp,
  Fn,
  float,
  instanceIndex,
  instancedArray,
  max,
  min,
  positionLocal,
  select,
  storage,
  uint,
  uniform,
  vec3,
  vertexIndex,
} from 'three/tsl';
import type ComputeNode from 'three/src/nodes/gpgpu/ComputeNode.js';
import type StorageBufferNode from 'three/src/nodes/accessors/StorageBufferNode.js';

import liquidSpiralAsset from '../assets/y2k/liquidspiral.obj?url';
import type { FirstWorldParameters } from './FirstWorld';
import { defaultFirstWorldParameters } from './FirstWorld';

const WATER_GRID_SIZE = 192;
const WATER_GRID_COUNT = WATER_GRID_SIZE * WATER_GRID_SIZE;
const WATER_EXTENT = 17;
const WATER_CELL_SIZE = WATER_EXTENT / (WATER_GRID_SIZE - 1);

function createInitialWaterState() {
  const state = new Float32Array(WATER_GRID_COUNT * 3);
  for (let row = 0; row < WATER_GRID_SIZE; row += 1) {
    const z = row * WATER_CELL_SIZE - WATER_EXTENT / 2;
    for (let column = 0; column < WATER_GRID_SIZE; column += 1) {
      const x = column * WATER_CELL_SIZE - WATER_EXTENT / 2;
      const broadWave = Math.sin(x * 0.2 + z * 0.13)
        * Math.cos(z * 0.17 - x * 0.1) * 0.012;
      const spiralDistance = Math.hypot(x, z + 2.7);
      const spiralRipple = Math.sin(spiralDistance * 1.8) * Math.exp(-spiralDistance * 0.18) * 0.008;
      const height = broadWave + spiralRipple;
      state[(row * WATER_GRID_SIZE + column) * 3] = height;
    }
  }
  return state;
}

export class HydrosWorld {
  private readonly scene: THREE.Scene;
  private readonly parameters: FirstWorldParameters;
  private readonly group = new THREE.Group();
  private readonly materials: THREE.MeshPhysicalMaterial[] = [];
  private readonly bubblePositions: Float32Array;
  private readonly bubbleBasePositions: Float32Array;
  private readonly bubbleGeometry: THREE.BufferGeometry;
  private readonly bubbleField: THREE.Points;
  private readonly waterGeometry: THREE.PlaneGeometry;
  private readonly waterStateA = instancedArray(createInitialWaterState(), 'vec3');
  private readonly waterStateB = instancedArray(
    new Float32Array(WATER_GRID_COUNT * 3),
    'vec3',
  );
  private readonly waterStateARead = storage(
    this.waterStateA.value,
    'vec3',
    WATER_GRID_COUNT,
  ).toReadOnly();
  private readonly waterStateBRead = storage(
    this.waterStateB.value,
    'vec3',
    WATER_GRID_COUNT,
  ).toReadOnly();
  private readonly waterStepSize = uniform(1 / 120);
  private readonly waterStepAToB: ComputeNode;
  private readonly waterStepBToA: ComputeNode;
  private readonly waterSurface: WaterMesh;
  private readonly waterNormalTexture: THREE.CanvasTexture;
  private readonly poolTileTexture: THREE.CanvasTexture;
  private readonly lightShafts: THREE.Sprite[] = [];
  private readonly spiralRig = new THREE.Group();
  private readonly environment: THREE.CanvasTexture;
  private readonly keyLight: THREE.PointLight;
  private readonly fillLight: THREE.PointLight;
  private elapsed = 0;
  private cameraElapsed = 0;

  constructor(scene: THREE.Scene, parameters: Partial<FirstWorldParameters> = {}) {
    this.scene = scene;
    this.parameters = { ...defaultFirstWorldParameters, ...parameters };

    this.environment = this.createEnvironment();
    scene.environment = this.environment;
    this.group.add(new THREE.AmbientLight(0x73dcff, 1.2));
    this.keyLight = new THREE.PointLight(0x12c9ff, 92, 13);
    this.keyLight.position.set(-2.2, 1.3, 2.5);
    this.group.add(this.keyLight);
    this.fillLight = new THREE.PointLight(0x4773ff, 70, 12);
    this.fillLight.position.set(2.2, -0.5, -1.5);
    this.group.add(this.fillLight);
    this.waterGeometry = new THREE.PlaneGeometry(
      WATER_EXTENT,
      WATER_EXTENT,
      WATER_GRID_SIZE - 1,
      WATER_GRID_SIZE - 1,
    );
    this.waterStepAToB = this.createWaterStep(this.waterStateARead, this.waterStateB);
    this.waterStepBToA = this.createWaterStep(this.waterStateBRead, this.waterStateA);
    this.waterNormalTexture = this.createWaterNormals();
    this.waterNormalTexture.wrapS = THREE.RepeatWrapping;
    this.waterNormalTexture.wrapT = THREE.RepeatWrapping;
    this.poolTileTexture = this.createPoolTileTexture();
    this.poolTileTexture.wrapS = THREE.RepeatWrapping;
    this.poolTileTexture.wrapT = THREE.RepeatWrapping;
    this.waterSurface = new WaterMesh(this.waterGeometry, {
      waterNormals: this.waterNormalTexture,
      alpha: 0.64,
      size: 42,
      sunColor: 0xa4f1ff,
      sunDirection: new THREE.Vector3(-0.35, 0.86, 0.37).normalize(),
      waterColor: 0x07344c,
      distortionScale: 0.22,
      resolutionScale: 0.75,
    });
    this.waterSurface.material.positionNode = Fn(() => {
      const position = positionLocal.toVar();
      position.z.addAssign(this.waterStateARead.element(vertexIndex).x);
      return position;
    })();
    this.waterSurface.material.normalNode = Fn(() => {
      const column = vertexIndex.mod(uint(WATER_GRID_SIZE));
      const row = vertexIndex.div(uint(WATER_GRID_SIZE));
      const left = select(column.equal(uint(0)), uint(0), column.sub(uint(1)));
      const right = select(
        column.equal(uint(WATER_GRID_SIZE - 1)),
        uint(WATER_GRID_SIZE - 1),
        column.add(uint(1)),
      );
      const above = select(row.equal(uint(0)), uint(0), row.sub(uint(1)));
      const below = select(
        row.equal(uint(WATER_GRID_SIZE - 1)),
        uint(WATER_GRID_SIZE - 1),
        row.add(uint(1)),
      );
      const heightLeft = this.waterStateARead.element(row.mul(uint(WATER_GRID_SIZE)).add(left)).x;
      const heightRight = this.waterStateARead.element(row.mul(uint(WATER_GRID_SIZE)).add(right)).x;
      const heightAbove = this.waterStateARead.element(above.mul(uint(WATER_GRID_SIZE)).add(column)).x;
      const heightBelow = this.waterStateARead.element(below.mul(uint(WATER_GRID_SIZE)).add(column)).x;
      const inverseSpacing = 1 / (2 * WATER_CELL_SIZE);

      return vec3(
        heightLeft.sub(heightRight).mul(inverseSpacing),
        heightAbove.sub(heightBelow).mul(inverseSpacing),
        1,
      ).normalize();
    })();
    this.waterSurface.rotation.x = -Math.PI / 2;
    this.waterSurface.position.y = -0.82;
    this.group.add(this.waterSurface);
    this.addPoolShell();
    this.addReef();

    for (let index = 0; index < 7; index += 1) {
      const shaft = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.createLightShaftTexture(),
          color: index % 2 === 0 ? 0x39dcff : 0x3989ff,
          transparent: true,
          opacity: 0.16,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      shaft.position.set((index - 3) * 1.4, 0.8, -2 - (index % 3) * 1.1);
      shaft.scale.set(1.2 + (index % 3) * 0.4, 5.6, 1);
      shaft.material.rotation = (index - 3) * 0.035;
      this.lightShafts.push(shaft);
      this.group.add(shaft);
    }

    const bubbleCount = 620;
    this.bubblePositions = new Float32Array(bubbleCount * 3);
    for (let index = 0; index < bubbleCount; index += 1) {
      const angle = index * 2.399963;
      const radius = 1.5 + ((index * 37) % 100) / 34;
      this.bubblePositions[index * 3] = Math.cos(angle) * radius;
      this.bubblePositions[index * 3 + 1] = -3.75 + ((index * 71) % 100) / 36;
      this.bubblePositions[index * 3 + 2] = Math.sin(angle) * radius - 1.2;
    }
    this.bubbleBasePositions = this.bubblePositions.slice();
    this.bubbleGeometry = new THREE.BufferGeometry();
    this.bubbleGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.bubblePositions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.bubbleField = new THREE.Points(
      this.bubbleGeometry,
      new THREE.PointsMaterial({
        color: 0x8cf6ff,
        size: 0.052,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    scene.add(this.bubbleField);
    scene.add(this.group);
    this.setParameters(parameters);
  }

  async init(_renderer: THREE.WebGPURenderer) {
    const spiral = await new OBJLoader().loadAsync(liquidSpiralAsset);
    const bounds = new THREE.Box3().setFromObject(spiral);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const maxDimension = Math.max(size.x, size.y, size.z);
    if (maxDimension === 0) throw new Error('The Hydros spiral has no measurable geometry.');

    const scale = 7.8 / maxDimension;
    spiral.position.copy(center)
      .multiplyScalar(-scale)
      .applyAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    spiral.scale.setScalar(scale);
    spiral.rotation.z = Math.PI / 2;
    spiral.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.geometry.computeVertexNormals();
      const material = this.createMaterial(0x278ba2, 0x07536a, 0.32, 0.2);
      material.emissiveIntensity = 0.42;
      material.clearcoat = 1;
      material.clearcoatRoughness = 0.13;
      child.material = material;
    });
    this.spiralRig.add(spiral);
    this.spiralRig.position.set(0, -0.42, -4.2);
    this.group.add(this.spiralRig);
    this.spiralRig.scale.setScalar(0.92);
  }

  setParameters(parameters: Partial<FirstWorldParameters>) {
    Object.assign(this.parameters, parameters);
    const glow = THREE.MathUtils.clamp(this.parameters.glow, 0, 1);
    this.materials.forEach((material) => {
      material.emissiveIntensity = 0.35 + glow * 1.15;
    });
    this.group.scale.setScalar(0.9 + THREE.MathUtils.clamp(this.parameters.radius, 0.8, 3) * 0.07);
  }

  getParameters(): Readonly<FirstWorldParameters> {
    return this.parameters;
  }

  setElapsedSeconds(elapsedSeconds: number) {
    this.elapsed = Math.max(0, elapsedSeconds);
    this.cameraElapsed = this.elapsed;
  }

  update(renderer: THREE.WebGPURenderer, deltaSeconds: number, camera?: THREE.PerspectiveCamera) {
    this.elapsed += deltaSeconds * this.parameters.timeScale;
    this.cameraElapsed += deltaSeconds * this.parameters.timeScale;
    const t = this.elapsed;
    const flow = 0.45 + THREE.MathUtils.clamp(this.parameters.flowStrength, 0, 1.5) * 0.7;
    const pulse = 0.5 + Math.sin(t * 0.8) * 0.5;

    this.spiralRig.rotation.y = t * flow * 0.22;
    this.keyLight.intensity = 76 + pulse * 32;
    this.fillLight.intensity = 54 + (1 - pulse) * 26;
    this.lightShafts.forEach((shaft, index) => {
      shaft.material.rotation = Math.sin(t * 0.12 + index) * 0.025 + (index - 3) * 0.035;
      shaft.material.opacity = 0.035 + pulse * 0.035;
    });

    this.waterStepSize.value = Math.min(
      Math.max(0, deltaSeconds * this.parameters.timeScale),
      0.025,
    ) * 0.5;
    renderer.compute(this.waterStepAToB);
    renderer.compute(this.waterStepBToA);

    const positions = this.bubbleGeometry.getAttribute('position') as THREE.BufferAttribute;
    for (let index = 0; index < this.bubblePositions.length / 3; index += 1) {
      const baseY = -3.75 + ((index * 71) % 100) / 36;
      positions.setY(index, ((baseY + t * (0.08 + (index % 5) * 0.012) + 3.75) % 2.85) - 3.75);
      positions.setX(index, this.bubbleBasePositions[index * 3] + Math.sin(t * 0.35 + index) * 0.025);
    }
    positions.needsUpdate = true;

    if (camera) {
      const cameraTime = this.cameraElapsed;
      camera.position.set(
        Math.sin(cameraTime * 0.08) * 0.62,
        -0.4 + Math.sin(cameraTime * 0.065) * 0.045,
        3.5 + Math.sin(cameraTime * 0.05) * 0.22,
      );
      camera.lookAt(
        Math.sin(cameraTime * 0.08 + 0.7) * 0.35,
        -1.85 + Math.sin(cameraTime * 0.11) * 0.06,
        -5.2,
      );
      camera.rotation.z = Math.sin(cameraTime * 0.045) * 0.028;
      camera.fov = 68 + Math.sin(cameraTime * 0.07) * 2;
      camera.updateProjectionMatrix();
    }
  }

  dispose() {
    this.group.removeFromParent();
    this.bubbleField.removeFromParent();
    const geometries = new Set<THREE.BufferGeometry>();
    this.group.traverse((object) => {
      if (object instanceof THREE.Mesh) geometries.add(object.geometry);
    });
    geometries.forEach((geometry) => geometry.dispose());
    this.materials.forEach((material) => material.dispose());
    this.bubbleGeometry.dispose();
    const bubbleMaterial = this.bubbleField.material;
    if (bubbleMaterial instanceof THREE.Material) bubbleMaterial.dispose();
    this.waterSurface.geometry.dispose();
    this.waterSurface.material.dispose();
    this.waterNormalTexture.dispose();
    this.lightShafts.forEach((shaft) => {
      shaft.material.map?.dispose();
      shaft.material.dispose();
    });
    if (this.scene.environment === this.environment) {
      this.environment.dispose();
      this.scene.environment = null;
    }
    this.poolTileTexture.dispose();
  }

  private createMaterial(color: number, emissive: number, metalness: number, roughness: number) {
    const material = new THREE.MeshPhysicalMaterial({
      color,
      emissive,
      emissiveIntensity: 0.35 + THREE.MathUtils.clamp(this.parameters.glow, 0, 1) * 1.15,
      metalness,
      roughness,
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide,
    });
    this.materials.push(material);
    return material;
  }

  private createWaterStep(
    source: StorageBufferNode<'vec3'>,
    target: StorageBufferNode<'vec3'>,
  ) {
    return Fn(() => {
      const column = instanceIndex.mod(uint(WATER_GRID_SIZE));
      const row = instanceIndex.div(uint(WATER_GRID_SIZE));
      const leftColumn = select(column.equal(uint(0)), uint(0), column.sub(uint(1)));
      const rightColumn = select(
        column.equal(uint(WATER_GRID_SIZE - 1)),
        uint(WATER_GRID_SIZE - 1),
        column.add(uint(1)),
      );
      const upperRow = select(row.equal(uint(0)), uint(0), row.sub(uint(1)));
      const lowerRow = select(
        row.equal(uint(WATER_GRID_SIZE - 1)),
        uint(WATER_GRID_SIZE - 1),
        row.add(uint(1)),
      );
      const center = source.element(instanceIndex);
      const left = source.element(row.mul(uint(WATER_GRID_SIZE)).add(leftColumn));
      const right = source.element(row.mul(uint(WATER_GRID_SIZE)).add(rightColumn));
      const upper = source.element(upperRow.mul(uint(WATER_GRID_SIZE)).add(column));
      const lower = source.element(lowerRow.mul(uint(WATER_GRID_SIZE)).add(column));
      const waterDepth = float(1.15);
      const gravity = float(9.81);
      const spacing = float(WATER_CELL_SIZE);
      const dt = this.waterStepSize;
      const surfaceLeft = waterDepth.add(center.x.add(left.x).mul(0.5));
      const surfaceRight = waterDepth.add(center.x.add(right.x).mul(0.5));
      const surfaceUpper = waterDepth.add(center.x.add(upper.x).mul(0.5));
      const surfaceLower = waterDepth.add(center.x.add(lower.x).mul(0.5));
      const fluxLeft = surfaceLeft.mul(center.y.add(left.y).mul(0.5));
      const fluxRight = surfaceRight.mul(center.y.add(right.y).mul(0.5));
      const fluxUpper = surfaceUpper.mul(center.z.add(upper.z).mul(0.5));
      const fluxLower = surfaceLower.mul(center.z.add(lower.z).mul(0.5));
      const divergence = fluxRight.sub(fluxLeft).add(fluxLower.sub(fluxUpper))
        .div(spacing.mul(2));
      const pressureX = right.x.sub(left.x).div(spacing.mul(2)).mul(gravity);
      const pressureZ = lower.x.sub(upper.x).div(spacing.mul(2)).mul(gravity);
      const laplacianX = left.y.add(right.y).add(upper.y).add(lower.y)
        .sub(center.y.mul(4))
        .div(spacing.mul(spacing));
      const laplacianZ = left.z.add(right.z).add(upper.z).add(lower.z)
        .sub(center.z.mul(4))
        .div(spacing.mul(spacing));
      const drag = exp(dt.mul(-0.65));
      const velocityX = center.y
        .sub(pressureX.mul(dt))
        .add(laplacianX.mul(dt).mul(0.008))
        .mul(drag);
      const velocityZ = center.z
        .sub(pressureZ.mul(dt))
        .add(laplacianZ.mul(dt).mul(0.008))
        .mul(drag);
      const boundedVelocityX = max(min(velocityX, float(0.18)), float(-0.18));
      const boundedVelocityZ = max(min(velocityZ, float(0.18)), float(-0.18));
      const nextVelocityX = select(
        column.equal(0),
        float(0),
        select(column.equal(WATER_GRID_SIZE - 1), float(0), boundedVelocityX),
      );
      const nextVelocityZ = select(
        row.equal(0),
        float(0),
        select(row.equal(WATER_GRID_SIZE - 1), float(0), boundedVelocityZ),
      );
      const nextHeight = max(
        min(center.x.sub(divergence.mul(dt)), float(0.045)),
        float(-0.045),
      );
      target.element(instanceIndex).assign(vec3(
        nextHeight,
        nextVelocityX,
        nextVelocityZ,
      ));
    })().compute(WATER_GRID_COUNT);
  }

  private addPoolShell() {
    const tileMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x7899a0,
      map: this.poolTileTexture,
      roughness: 0.32,
      metalness: 0.12,
      clearcoat: 0.32,
      clearcoatRoughness: 0.28,
      side: THREE.DoubleSide,
    });
    this.materials.push(tileMaterial);

    const addTiledPlane = (
      width: number,
      height: number,
      position: THREE.Vector3,
      rotation: THREE.Euler,
    ) => {
      const geometry = new THREE.PlaneGeometry(width, height, 1, 1);
      const uvAttribute = geometry.getAttribute('uv');
      for (let index = 0; index < uvAttribute.count; index += 1) {
        uvAttribute.setXY(
          index,
          uvAttribute.getX(index) * width / 0.9,
          uvAttribute.getY(index) * height / 0.9,
        );
      }
      uvAttribute.needsUpdate = true;
      const mesh = new THREE.Mesh(geometry, tileMaterial);
      mesh.position.copy(position);
      mesh.rotation.copy(rotation);
      this.group.add(mesh);
    };

    const bottom = -4.55;
    const wallTop = -0.35;
    const wallHeight = wallTop - bottom;
    addTiledPlane(17, 17, new THREE.Vector3(0, bottom, -1.8), new THREE.Euler(-Math.PI / 2, 0, 0));
    addTiledPlane(17, wallHeight, new THREE.Vector3(-8.5, (wallTop + bottom) / 2, -1.8), new THREE.Euler(0, Math.PI / 2, 0));
    addTiledPlane(17, wallHeight, new THREE.Vector3(8.5, (wallTop + bottom) / 2, -1.8), new THREE.Euler(0, -Math.PI / 2, 0));
    addTiledPlane(17, wallHeight, new THREE.Vector3(0, (wallTop + bottom) / 2, -9.3), new THREE.Euler(0, 0, 0));
  }

  private createPoolTileTexture() {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to create the Hydros pool tile texture.');

    const tile = context.createLinearGradient(0, 0, size, size);
    tile.addColorStop(0, '#496f7a');
    tile.addColorStop(0.5, '#345866');
    tile.addColorStop(1, '#244653');
    context.fillStyle = tile;
    context.fillRect(0, 0, size, size);
    context.fillStyle = 'rgba(178, 228, 232, 0.32)';
    context.fillRect(0, 0, size, 3);
    context.fillRect(0, 0, 3, size);
    context.fillStyle = 'rgba(5, 26, 37, 0.72)';
    context.fillRect(0, size - 4, size, 4);
    context.fillRect(size - 4, 0, 4, size);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private createWaterNormals() {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to create the Hydros water normal map.');
    const image = context.createImageData(size, size);
    const lattice = (x: number, y: number, cells: number) => {
      const wrappedX = ((x % cells) + cells) % cells;
      const wrappedY = ((y % cells) + cells) % cells;
      const value = Math.sin(wrappedX * 127.1 + wrappedY * 311.7) * 43758.5453;
      return value - Math.floor(value);
    };
    const noise = (u: number, v: number, cells: number) => {
      const x = u * cells;
      const y = v * cells;
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const blendX = (x - x0) ** 2 * (3 - 2 * (x - x0));
      const blendY = (y - y0) ** 2 * (3 - 2 * (y - y0));
      const top = THREE.MathUtils.lerp(
        lattice(x0, y0, cells),
        lattice(x0 + 1, y0, cells),
        blendX,
      );
      const bottom = THREE.MathUtils.lerp(
        lattice(x0, y0 + 1, cells),
        lattice(x0 + 1, y0 + 1, cells),
        blendX,
      );
      return THREE.MathUtils.lerp(top, bottom, blendY);
    };
    const heightAt = (u: number, v: number) => (
      noise(u, v, 20) * 0.62
      + noise(u, v, 40) * 0.38
    );
    const offset = 1 / size;
    for (let y = 0; y < size; y += 1) {
      const v = y / size;
      for (let x = 0; x < size; x += 1) {
        const u = x / size;
        const slopeX = (heightAt(u + offset, v) - heightAt(u - offset, v)) * size * 0.003;
        const slopeY = (heightAt(u, v + offset) - heightAt(u, v - offset)) * size * 0.003;
        const normalLength = Math.hypot(slopeX, slopeY, 1);
        const index = (y * size + x) * 4;
        image.data[index] = Math.round(((-slopeX / normalLength) * 0.5 + 0.5) * 255);
        image.data[index + 1] = Math.round(((-slopeY / normalLength) * 0.5 + 0.5) * 255);
        image.data[index + 2] = Math.round(((1 / normalLength) * 0.5 + 0.5) * 255);
        image.data[index + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
    return new THREE.CanvasTexture(canvas);
  }

  private createEnvironment() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to create the Hydros reflection environment.');
    const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#c6f7ff');
    gradient.addColorStop(0.24, '#438bb0');
    gradient.addColorStop(0.5, '#103a63');
    gradient.addColorStop(0.78, '#0b4563');
    gradient.addColorStop(1, '#06182e');
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    const sun = context.createRadialGradient(370, 38, 2, 370, 38, 74);
    sun.addColorStop(0, 'rgba(255,255,238,1)');
    sun.addColorStop(0.08, 'rgba(255,245,207,0.9)');
    sun.addColorStop(1, 'rgba(255,230,174,0)');
    context.fillStyle = sun;
    context.fillRect(290, 0, 160, 130);
    const texture = new THREE.CanvasTexture(canvas);
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private addReef() {
    const reefMaterial = this.createMaterial(0x123f58, 0x092c47, 0.08, 0.76);
    reefMaterial.emissiveIntensity = 0.18;
    const coralMaterial = this.createMaterial(0x167f96, 0x075b83, 0.18, 0.38);
    coralMaterial.emissiveIntensity = 0.24;

    for (let clusterIndex = 0; clusterIndex < 10; clusterIndex += 1) {
      const side = clusterIndex % 2 === 0 ? -1 : 1;
      const x = side * (3.5 + ((clusterIndex * 13) % 24) / 10);
      const z = -5.8 + ((clusterIndex * 17) % 70) / 10;
      const cluster = new THREE.Group();
      cluster.position.set(x, -3.7, z);

      for (let branchIndex = 0; branchIndex < 5; branchIndex += 1) {
        const height = 0.65 + ((clusterIndex * 19 + branchIndex * 31) % 100) / 65;
        const stem = new THREE.Mesh(
          new THREE.CylinderGeometry(0.018, 0.11 + (branchIndex % 3) * 0.025, height, 7, 1),
          branchIndex % 3 === 0 ? coralMaterial : reefMaterial,
        );
        const angle = branchIndex * 2.399 + clusterIndex;
        stem.position.set(
          Math.cos(angle) * 0.2,
          height * 0.48,
          Math.sin(angle) * 0.2,
        );
        stem.rotation.z = Math.cos(angle) * 0.22;
        stem.rotation.x = Math.sin(angle) * 0.2;
        cluster.add(stem);

        const tip = new THREE.Mesh(
          new THREE.IcosahedronGeometry(0.075, 1),
          coralMaterial,
        );
        tip.position.set(
          stem.position.x + Math.cos(angle) * 0.08,
          height * 0.92,
          stem.position.z + Math.sin(angle) * 0.08,
        );
        cluster.add(tip);
      }

      const rock = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.34 + (clusterIndex % 3) * 0.08, 1),
        reefMaterial,
      );
      rock.scale.set(1.4, 0.62, 1);
      rock.position.y = 0.12;
      cluster.add(rock);
      this.group.add(cluster);
    }
  }

  private createLightShaftTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 512;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to create the Hydros light shafts.');
    const horizontal = context.createLinearGradient(0, 0, canvas.width, 0);
    horizontal.addColorStop(0, 'rgba(255,255,255,0)');
    horizontal.addColorStop(0.5, 'rgba(255,255,255,0.38)');
    horizontal.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = horizontal;
    context.fillRect(0, 0, canvas.width, canvas.height);

    const vertical = context.createLinearGradient(0, 0, 0, canvas.height);
    vertical.addColorStop(0, 'rgba(255,255,255,0)');
    vertical.addColorStop(0.2, 'rgba(255,255,255,0.5)');
    vertical.addColorStop(0.75, 'rgba(255,255,255,0.26)');
    vertical.addColorStop(1, 'rgba(255,255,255,0)');
    context.globalCompositeOperation = 'destination-in';
    context.fillStyle = vertical;
    context.fillRect(0, 0, canvas.width, canvas.height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }
}
