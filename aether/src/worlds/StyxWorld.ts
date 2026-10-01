import * as THREE from 'three/webgpu';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

import modelAsset from '../assets/model.obj?url';
import chaoModelAsset from '../assets/baby-chao/source/Baby Chao.obj?url';
import childTextureAsset from '../assets/baby-chao/textures/al_child01.png?url';
import childTextureAltAsset from '../assets/baby-chao/textures/al_child02.png?url';
import eyeTextureAsset from '../assets/baby-chao/textures/al_eye01.png?url';
import blueTextureAsset from '../assets/baby-chao/textures/Blue.png?url';
import type { FirstWorldParameters } from './FirstWorld';
import { defaultFirstWorldParameters } from './FirstWorld';

interface ChaoMotion {
  phase: number;
  radius: number;
  height: number;
  speed: number;
  scale: number;
  tilt: number;
}

export class StyxWorld {
  private readonly scene: THREE.Scene;
  private readonly parameters: FirstWorldParameters;
  private readonly group = new THREE.Group();
  private readonly rings: THREE.Mesh[] = [];
  private readonly materials: THREE.MeshStandardMaterial[] = [];
  private readonly modelMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly chao: THREE.Group[] = [];
  private readonly chaoMotion: ChaoMotion[] = [];
  private readonly chaoMaterials: THREE.MeshPhysicalMaterial[] = [];
  private readonly chaoTextures: THREE.Texture[] = [];
  private readonly starField: THREE.Points;
  private readonly chromeEnvironment: THREE.CanvasTexture;
  private readonly sweep: THREE.Mesh;
  private readonly keyLight: THREE.PointLight;
  private readonly fillLight: THREE.PointLight;
  private readonly backLight: THREE.PointLight;
  private model: THREE.Group | null = null;
  private elapsed = 0;
  private cameraElapsed = 0;

  constructor(
    scene: THREE.Scene,
    parameters: Partial<FirstWorldParameters> = {},
  ) {
    this.scene = scene;
    this.parameters = {
      ...defaultFirstWorldParameters,
      ...parameters,
    };

    this.chromeEnvironment = this.createChromeEnvironment();
    scene.environment = this.chromeEnvironment;
    this.group.add(new THREE.AmbientLight(0xc4aaff, 1.2));
    this.keyLight = new THREE.PointLight(0xff4fd8, 48, 12);
    this.keyLight.position.set(-2, 1.5, 2);
    this.group.add(this.keyLight);
    this.fillLight = new THREE.PointLight(0x43dcff, 38, 12);
    this.fillLight.position.set(2, -0.4, 2);
    this.group.add(this.fillLight);
    this.backLight = new THREE.PointLight(0xffffff, 35, 10);
    this.backLight.position.set(0, 2, -2);
    this.group.add(this.backLight);

    const haloMaterial = this.createMaterial(0xf9e7ff, 0xec28bd, 0.08, 0.3);
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.84, 0.018, 12, 180), haloMaterial);
    halo.rotation.x = Math.PI * 0.24;
    this.rings.push(halo);
    this.group.add(halo);

    const orbitMaterial = this.createMaterial(0xc8ffff, 0x16c9ed, 0.1, 0.3);
    const orbit = new THREE.Mesh(new THREE.TorusGeometry(1.12, 0.012, 10, 180), orbitMaterial);
    orbit.rotation.set(Math.PI * 0.65, Math.PI * 0.18, Math.PI * 0.1);
    this.rings.push(orbit);
    this.group.add(orbit);

    const orbit2 = new THREE.Mesh(
      new THREE.TorusGeometry(1.34, 0.008, 8, 180),
      this.createMaterial(0xffffff, 0x8145ff, 0.14, 0.28),
    );
    orbit2.rotation.set(Math.PI * 0.32, Math.PI * 0.52, 0);
    this.rings.push(orbit2);
    this.group.add(orbit2);

    this.sweep = new THREE.Mesh(
      new THREE.TorusGeometry(1.58, 0.006, 6, 220),
      this.createMaterial(0xf4f4ff, 0xc34dff, 0.22, 0.24),
    );
    this.sweep.rotation.set(Math.PI * 0.08, Math.PI * 0.28, 0);
    this.group.add(this.sweep);

    const stars = this.createStars();
    this.starField = stars;
    scene.add(stars);

    scene.add(this.group);
    this.setParameters(parameters);
  }

  setParameters(parameters: Partial<FirstWorldParameters>) {
    Object.assign(this.parameters, parameters);
    const glow = THREE.MathUtils.clamp(this.parameters.glow, 0, 1);
    this.materials.forEach((material) => {
      material.emissiveIntensity = 0.12 + glow * 0.62;
    });
    this.group.scale.setScalar(0.88 + THREE.MathUtils.clamp(this.parameters.radius, 0.8, 3) * 0.08);
  }

  getParameters(): Readonly<FirstWorldParameters> {
    return this.parameters;
  }

  async init(_renderer: THREE.WebGPURenderer) {
    const object = await new OBJLoader().loadAsync(modelAsset);
    const bounds = new THREE.Box3().setFromObject(object);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const maxDimension = Math.max(size.x, size.y, size.z);
    if (maxDimension === 0) throw new Error('The Styx OBJ model has no measurable geometry.');

    object.position.sub(center);
    const modelScale = 3.4 / maxDimension;
    object.scale.setScalar(modelScale);
    object.userData.baseScale = modelScale;
    object.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const chromeMaterial = new THREE.MeshStandardMaterial({
        color: 0xe9efff,
        metalness: 1,
        roughness: 0.055,
        envMap: this.chromeEnvironment,
        envMapIntensity: 2.6,
      });
      this.modelMaterials.push(chromeMaterial);
      child.material = chromeMaterial;
      child.geometry.computeVertexNormals();
    });
    object.position.y = 0.08;
    object.scale.setScalar(modelScale * 0.001);
    this.model = object;
    this.group.add(object);

    const [chaoObject, childTexture, childTextureAlt, eyeTexture, blueTexture] = await Promise.all([
      new OBJLoader().loadAsync(chaoModelAsset),
      this.loadChaoTexture(childTextureAsset),
      this.loadChaoTexture(childTextureAltAsset),
      this.loadChaoTexture(eyeTextureAsset),
      this.loadChaoTexture(blueTextureAsset),
    ]);
    this.chaoTextures.push(childTexture, childTextureAlt, eyeTexture, blueTexture);

    const chaoBounds = new THREE.Box3().setFromObject(chaoObject);
    const chaoSize = chaoBounds.getSize(new THREE.Vector3());
    const chaoCenter = chaoBounds.getCenter(new THREE.Vector3());
    const chaoMaxDimension = Math.max(chaoSize.x, chaoSize.y, chaoSize.z);
    if (chaoMaxDimension === 0) throw new Error('The Chao OBJ model has no measurable geometry.');

    chaoObject.position.sub(chaoCenter);
    chaoObject.scale.setScalar(1.25 / chaoMaxDimension);
    chaoObject.traverse((child) => {
      if (!(child instanceof THREE.Mesh) || !Array.isArray(child.material)) return;
      child.material = child.material.map((sourceMaterial) => {
        const materialName = sourceMaterial.name.toLowerCase();
        const texture = materialName.includes('eye')
          ? eyeTexture
          : materialName.includes('head_3') || materialName.includes('wings') || materialName.includes('horn')
            ? blueTexture
            : materialName.includes('body_2') || materialName.includes('foot') || materialName.includes('tail_2')
              ? childTextureAlt
              : materialName.includes('mouth')
                ? null
                : childTexture;
        const material = new THREE.MeshPhysicalMaterial({
          color: texture ? 0xffffff : materialName.includes('mouth') ? 0x291630 : 0xfff6ff,
          map: texture,
          metalness: 0.04,
          roughness: materialName.includes('eye') ? 0.16 : 0.34,
          clearcoat: materialName.includes('eye') ? 0.8 : 0.52,
          clearcoatRoughness: 0.18,
        });
        this.chaoMaterials.push(material);
        return material;
      });
      child.geometry.computeVertexNormals();
    });

    for (let index = 0; index < 14; index += 1) {
      const chao = new THREE.Group();
      chao.add(chaoObject.clone(true));
      chao.visible = false;
      this.chao.push(chao);
      this.chaoMotion.push({
        phase: (index / 14) * Math.PI * 2,
        radius: 2.25 + ((index * 23) % 100) / 45,
        height: ((index * 37) % 100) / 40 - 1.15,
        speed: 0.08 + ((index * 19) % 100) / 480,
        scale: 0.12 + ((index * 17) % 100) / 600,
        tilt: ((index * 31) % 100) / 100 - 0.5,
      });
      this.group.add(chao);
    }
  }

  setElapsedSeconds(elapsedSeconds: number) {
    this.elapsed = Math.max(0, elapsedSeconds);
    this.cameraElapsed = this.elapsed;
  }

  update(_renderer: THREE.WebGPURenderer, deltaSeconds: number, camera?: THREE.PerspectiveCamera) {
    this.elapsed += deltaSeconds * this.parameters.timeScale;
    this.cameraElapsed += deltaSeconds * this.parameters.timeScale;
    const t = this.elapsed;
    const orbitSpeed = 0.72 + THREE.MathUtils.clamp(this.parameters.flowStrength, 0, 1.5) * 1.15;
    const hit = 0.5 + Math.sin(t * 0.42 - Math.PI / 2) * 0.5;
    this.group.rotation.y = this.elapsed * orbitSpeed;
    this.group.rotation.x = Math.sin(t * 0.72) * 0.12;
    this.group.rotation.z = Math.sin(t * 0.43) * 0.08;
    this.rings[0].rotation.z = t * orbitSpeed * 1.3;
    this.rings[1].rotation.z = -t * orbitSpeed * 0.9;
    this.rings[2].rotation.y = t * orbitSpeed * 0.65;
    this.sweep.rotation.z = -t * orbitSpeed * 0.48;
    this.sweep.rotation.x = Math.sin(t * 0.52) * 0.2;
    this.sweep.scale.setScalar(1 + Math.sin(t * 1.3) * 0.055);

    const intro = THREE.MathUtils.smoothstep(t, 0.08, 1.55);
    this.keyLight.intensity = 48 + hit * 72;
    this.fillLight.intensity = 38 + hit * 44;
    this.backLight.intensity = 35 + hit * 90;
    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.setHSL(0.76 + Math.sin(t * 0.16) * 0.025, 0.68, 0.032 + hit * 0.035);
    }
    if (this.model) {
      const pop = 1 + hit * 0.055 + Math.sin(t * 0.72) * 0.018;
      const reveal = intro * pop;
      this.model.scale.setScalar(this.model.userData.baseScale * reveal);
      this.model.rotation.z = Math.sin(t * 1.05) * 0.16 + hit * 0.12;
      this.model.rotation.y = Math.sin(t * 0.64) * 0.35 + t * 0.18;
      this.model.rotation.x = Math.cos(t * 0.78) * 0.14;
      this.model.position.y = 0.08 + Math.sin(t * 2.1) * 0.11 + hit * 0.18;
    }

    this.chao.forEach((chao, index) => {
      const motion = this.chaoMotion[index];
      const reveal = THREE.MathUtils.smoothstep(t, 0.12 + index * 0.16, 0.7 + index * 0.16);
      chao.visible = reveal > 0.01;
      const angle = motion.phase + t * motion.speed * (1 + hit * 0.15);
      const radius = motion.radius + Math.sin(t * 1.3 + motion.phase) * 0.2;
      chao.position.set(
        Math.cos(angle) * radius,
        motion.height + Math.sin(t * 1.7 + motion.phase) * 0.22 + hit * 0.18,
        Math.sin(angle) * radius * 0.74,
      );
      chao.rotation.set(
        Math.sin(t * 1.15 + motion.phase) * 0.18,
        -angle + Math.PI / 2,
        Math.sin(t * 0.86 + motion.phase) * 0.2 + motion.tilt,
      );
      chao.scale.setScalar(motion.scale * reveal * (1 + hit * 0.14));
    });

    if (camera) {
      const cameraTime = this.cameraElapsed;
      const sweepX = Math.sin(cameraTime * 0.13) * 0.95
        + Math.sin(cameraTime * 0.055) * 0.42;
      const sweepY = Math.sin(cameraTime * 0.09) * 0.48
        + Math.cos(cameraTime * 0.04) * 0.18;
      const sweepZ = 3.65
        + Math.sin(cameraTime * 0.07) * 0.48
        + Math.sin(cameraTime * 0.035) * 0.22
        - hit * 0.12;
      camera.position.set(sweepX, sweepY, sweepZ);
      camera.lookAt(
        Math.sin(cameraTime * 0.045) * 0.3,
        Math.sin(cameraTime * 0.065) * 0.18,
        0,
      );
      camera.rotation.z = Math.sin(cameraTime * 0.055) * 0.035;
      camera.fov = 49 + Math.sin(cameraTime * 0.075) * 4 + Math.sin(cameraTime * 0.038) * 2;
      camera.updateProjectionMatrix();
    }
    this.starField.rotation.y = t * 0.026;
    this.starField.rotation.x = Math.sin(t * 0.12) * 0.04;
  }

  dispose() {
    this.group.removeFromParent();
    this.starField.removeFromParent();
    const geometries = new Set<THREE.BufferGeometry>();
    this.group.traverse((object) => {
      if (object instanceof THREE.Mesh) geometries.add(object.geometry);
    });
    geometries.forEach((geometry) => geometry.dispose());
    this.materials.forEach((material) => material.dispose());
    this.modelMaterials.forEach((material) => material.dispose());
    this.chaoMaterials.forEach((material) => material.dispose());
    this.chaoTextures.forEach((texture) => texture.dispose());
    if (this.scene.environment === this.chromeEnvironment) this.scene.environment = null;
    this.chromeEnvironment.dispose();
    this.starField.geometry.dispose();
    const starMaterial = this.starField.material;
    if (starMaterial instanceof THREE.Material) starMaterial.dispose();
  }

  private createMaterial(
    color: number,
    emissive: number,
    metalness: number,
    roughness: number,
  ) {
    const material = new THREE.MeshStandardMaterial({
      color,
      emissive,
      emissiveIntensity: 0.12 + THREE.MathUtils.clamp(this.parameters.glow, 0, 1) * 0.62,
      metalness,
      roughness,
      envMap: this.chromeEnvironment,
      envMapIntensity: 1.7,
    });
    this.materials.push(material);
    return material;
  }

  private createStars() {
    const positions = new Float32Array(420 * 3);
    for (let index = 0; index < 420; index += 1) {
      const angle = index * 2.399963;
      const radius = 2.1 + ((index * 37) % 100) / 34;
      positions[index * 3] = Math.cos(angle) * radius;
      positions[index * 3 + 1] = Math.sin(angle * 1.7) * 2.6;
      positions[index * 3 + 2] = Math.sin(angle) * radius - 1.5;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0xc8c6ff,
      size: 0.018,
      transparent: true,
      opacity: 0.76,
      sizeAttenuation: true,
    });
    return new THREE.Points(geometry, material);
  }

  private createChromeEnvironment() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to create the Styx chrome environment.');
    const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#b4cfff');
    gradient.addColorStop(0.22, '#19243c');
    gradient.addColorStop(0.36, '#f8f5ff');
    gradient.addColorStop(0.46, '#9f37ff');
    gradient.addColorStop(0.54, '#111727');
    gradient.addColorStop(0.7, '#e8fbff');
    gradient.addColorStop(1, '#251033');
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < 18; index += 1) {
      const x = (index / 18) * canvas.width;
      const width = index % 3 === 0 ? 18 : 5;
      const reflection = context.createLinearGradient(x, 0, x + width, 0);
      reflection.addColorStop(0, 'rgba(255,255,255,0)');
      reflection.addColorStop(0.5, index % 2 === 0 ? 'rgba(255,255,255,0.95)' : 'rgba(104,239,255,0.8)');
      reflection.addColorStop(1, 'rgba(255,255,255,0)');
      context.fillStyle = reflection;
      context.fillRect(x, 0, width, canvas.height);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private async loadChaoTexture(url: string) {
    const texture = await new THREE.TextureLoader().loadAsync(url);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  }
}
