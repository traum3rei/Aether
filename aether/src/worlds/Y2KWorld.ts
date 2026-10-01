import * as THREE from 'three/webgpu';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

import cosmicSpiralAsset from '../assets/y2k/cosmic spiral/cosmicspiral.obj?url';
import cosmicSpiralMaterialAsset from '../assets/y2k/cosmic spiral/cosmicspiral.mtl?url';
import type { FirstWorldParameters } from './FirstWorld';
import { defaultFirstWorldParameters } from './FirstWorld';

export class Y2KWorld {
  private readonly scene: THREE.Scene;
  private readonly parameters: FirstWorldParameters;
  private readonly group = new THREE.Group();
  private readonly importedMaterials: THREE.Material[] = [];
  private readonly nebulae: THREE.Sprite[] = [];
  private cosmicSpiral: THREE.Group | null = null;
  private readonly sun: THREE.Mesh<THREE.SphereGeometry, THREE.MeshPhysicalMaterial>;
  private readonly starField: THREE.Points;
  private readonly environment: THREE.CanvasTexture;
  private elapsed = 0;
  private cameraElapsed = 0;

  constructor(scene: THREE.Scene, parameters: Partial<FirstWorldParameters> = {}) {
    this.scene = scene;
    this.parameters = { ...defaultFirstWorldParameters, ...parameters };
    this.environment = this.createEnvironment();
    scene.environment = this.environment;

    this.group.add(new THREE.AmbientLight(0xf5c9ff, 1.6));
    const magentaLight = new THREE.PointLight(0xff37ca, 80, 14);
    magentaLight.position.set(-2.6, 1.2, 2.5);
    this.group.add(magentaLight);
    const cyanLight = new THREE.PointLight(0x30efff, 72, 14);
    cyanLight.position.set(2.6, -0.4, 2);
    this.group.add(cyanLight);
    const goldLight = new THREE.PointLight(0xffd66e, 46, 12);
    goldLight.position.set(0.2, 2.5, -2.5);
    this.group.add(goldLight);

    this.sun = new THREE.Mesh(
      new THREE.SphereGeometry(0.68, 48, 32),
      new THREE.MeshPhysicalMaterial({
        color: 0xff4ac9,
        emissive: 0xf329aa,
        emissiveIntensity: 1.2,
        metalness: 0.28,
        roughness: 0.24,
        clearcoat: 1,
        clearcoatRoughness: 0.15,
      }),
    );
    this.sun.position.set(0, 0.05, -1.15);
    this.group.add(this.sun);

    const stars = this.createStars();
    this.starField = stars;
    scene.add(stars);
    this.addNebulae();
    scene.add(this.group);
    this.setParameters(parameters);
  }

  async init(_renderer: THREE.WebGPURenderer) {
    const cosmicMaterials = await new MTLLoader().loadAsync(cosmicSpiralMaterialAsset);
    cosmicMaterials.preload();
    const cosmicSpiral = await new OBJLoader()
      .setMaterials(cosmicMaterials)
      .loadAsync(cosmicSpiralAsset);
    const bounds = new THREE.Box3().setFromObject(cosmicSpiral);
    const size = bounds.getSize(new THREE.Vector3());
    const maxDimension = Math.max(size.x, size.y, size.z);
    if (maxDimension === 0) throw new Error('The cosmic spiral has no measurable geometry.');

    const modelScale = 7.2 / maxDimension;
    cosmicSpiral.scale.setScalar(modelScale);
    cosmicSpiral.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const positions = child.geometry.getAttribute('position');
      for (let index = 0; index < positions.count; index += 1) {
        const x = positions.getX(index);
        const y = positions.getY(index);
        const z = positions.getZ(index);
        const radius = Math.hypot(x, y, z);
        if (radius > 0 && radius < 0.105) {
          const scale = 0.105 / radius;
          positions.setXYZ(index, x * scale, y * scale, z * scale);
        }
      }
      positions.needsUpdate = true;
      child.geometry.computeVertexNormals();
      for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
        this.importedMaterials.push(material);
        if (material instanceof THREE.MeshPhongMaterial) {
          material.emissive.set(material.color).multiplyScalar(0.1);
          material.shininess = 140;
        }
      }
    });
    this.cosmicSpiral = new THREE.Group();
    this.cosmicSpiral.add(cosmicSpiral);
    this.cosmicSpiral.position.set(0, 0.05, -1.15);
    this.group.add(this.cosmicSpiral);
  }

  setParameters(parameters: Partial<FirstWorldParameters>) {
    Object.assign(this.parameters, parameters);
    this.group.scale.setScalar(0.82 + THREE.MathUtils.clamp(this.parameters.radius, 0.8, 3) * 0.1);
  }

  getParameters(): Readonly<FirstWorldParameters> {
    return this.parameters;
  }

  setElapsedSeconds(elapsedSeconds: number) {
    this.elapsed = Math.max(0, elapsedSeconds);
    this.cameraElapsed = this.elapsed;
  }

  update(_renderer: THREE.WebGPURenderer, deltaSeconds: number, camera?: THREE.PerspectiveCamera) {
    this.elapsed += deltaSeconds * this.parameters.timeScale;
    this.cameraElapsed += deltaSeconds * this.parameters.timeScale;
    const t = this.elapsed;
    const pulse = 0.5 + Math.sin(t * 1.2) * 0.5;
    const speed = 0.5 + THREE.MathUtils.clamp(this.parameters.flowStrength, 0, 1.5) * 0.5;

    this.group.rotation.y = Math.sin(t * 0.13) * 0.12;
    this.group.rotation.x = Math.sin(t * 0.19) * 0.07;
    this.sun.rotation.y = t * 0.12;
    this.sun.scale.setScalar(1 + pulse * 0.035);

    if (this.cosmicSpiral) {
      this.cosmicSpiral.rotation.y = t * speed * 0.11;
      this.cosmicSpiral.rotation.x = Math.sin(t * 0.12) * 0.018;
    }
    this.nebulae.forEach((nebula, index) => {
      nebula.position.x = Math.sin(t * (0.018 + index * 0.004) + index * 2.1) * (1.2 + index * 0.4);
      nebula.position.y = Math.cos(t * (0.014 + index * 0.003) + index) * 0.55;
      nebula.material.rotation = Math.sin(t * 0.012 + index) * 0.08;
    });

    if (camera) {
      const cameraTime = this.cameraElapsed;
      camera.position.set(
        Math.sin(cameraTime * 0.12) * 0.75,
        Math.sin(cameraTime * 0.08) * 0.38,
        5.4 + Math.sin(cameraTime * 0.07) * 0.3 - pulse * 0.12,
      );
      camera.lookAt(Math.sin(cameraTime * 0.05) * 0.12, 0, 0);
      camera.rotation.z = Math.sin(cameraTime * 0.06) * 0.025;
      camera.fov = 55 + Math.sin(cameraTime * 0.09) * 2;
      camera.updateProjectionMatrix();
    }

    this.starField.rotation.y = t * 0.018;
    this.starField.rotation.z = Math.sin(t * 0.08) * 0.025;
  }

  dispose() {
    this.group.removeFromParent();
    this.starField.removeFromParent();
    this.nebulae.forEach((nebula) => {
      nebula.removeFromParent();
      nebula.material.map?.dispose();
      nebula.material.dispose();
    });
    const geometries = new Set<THREE.BufferGeometry>();
    this.group.traverse((object) => {
      if (object instanceof THREE.Mesh) geometries.add(object.geometry);
    });
    geometries.forEach((geometry) => geometry.dispose());
    this.importedMaterials.forEach((material) => material.dispose());
    if (this.scene.environment === this.environment) this.scene.environment = null;
    this.environment.dispose();
    this.starField.geometry.dispose();
    const starMaterial = this.starField.material;
    if (starMaterial instanceof THREE.Material) starMaterial.dispose();
    this.sun.geometry.dispose();
    this.sun.material.dispose();
  }

  private createEnvironment() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to create the Y2K reflection environment.');
    const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#ff43c8');
    gradient.addColorStop(0.32, '#3ce8ff');
    gradient.addColorStop(0.52, '#09051d');
    gradient.addColorStop(0.68, '#f4a6ff');
    gradient.addColorStop(1, '#1b0d4a');
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < 12; index += 1) {
      context.fillStyle = index % 2 === 0 ? 'rgba(255,255,255,0.92)' : 'rgba(255,52,195,0.86)';
      context.fillRect(index * 48 - 6, 0, 12, canvas.height);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private createStars() {
    const positions = new Float32Array(620 * 3);
    for (let index = 0; index < 620; index += 1) {
      const angle = index * 2.399963;
      const radius = 2.5 + ((index * 37) % 100) / 28;
      positions[index * 3] = Math.cos(angle) * radius;
      positions[index * 3 + 1] = Math.sin(angle * 1.7) * 3;
      positions[index * 3 + 2] = Math.sin(angle) * radius - 1.5;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0xf0c9ff,
      size: 0.016,
      transparent: true,
      opacity: 0.82,
      sizeAttenuation: true,
    });
    return new THREE.Points(geometry, material);
  }

  private createNebulaTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to create a nebula cloud texture.');

    const colors = ['rgba(239,62,206,', 'rgba(77,105,255,', 'rgba(56,224,255,'];
    for (let index = 0; index < 34; index += 1) {
      const x = 100 + ((index * 173) % 312);
      const y = 90 + ((index * 97) % 330);
      const radius = 24 + ((index * 43) % 100);
      const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
      const color = colors[index % colors.length];
      gradient.addColorStop(0, `${color}${0.11 + (index % 4) * 0.025})`);
      gradient.addColorStop(0.45, `${color}0.045)`);
      gradient.addColorStop(1, `${color}0)`);
      context.fillStyle = gradient;
      context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private addNebulae() {
    const layers = [
      { x: -1.4, y: 0.25, z: -4.1, width: 9.2, height: 5.7, color: 0xff9be9, opacity: 0.42 },
      { x: 1.5, y: -0.55, z: -3.6, width: 7.5, height: 5.4, color: 0x718aff, opacity: 0.38 },
      { x: -0.1, y: 0.8, z: -5.2, width: 8.6, height: 5.1, color: 0x7ff4ff, opacity: 0.24 },
    ];
    layers.forEach((layer, index) => {
      const material = new THREE.SpriteMaterial({
        map: this.createNebulaTexture(),
        color: layer.color,
        transparent: true,
        opacity: layer.opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const nebula = new THREE.Sprite(material);
      nebula.position.set(layer.x, layer.y, layer.z);
      nebula.scale.set(layer.width, layer.height, 1);
      nebula.material.rotation = index * 0.8;
      this.nebulae.push(nebula);
      this.scene.add(nebula);
    });
  }
}
