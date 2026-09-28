import * as THREE from 'three/webgpu';
import { AetherRenderer } from './Renderer';
import { FirstWorld } from '../worlds/FirstWorld';

export class AetherEngine {
  private readonly renderer: AetherRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;

  private readonly world: FirstWorld;
  private readonly clock = new THREE.Clock();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new AetherRenderer(canvas);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020202);

    this.camera = new THREE.PerspectiveCamera(
      50,
      window.innerWidth / window.innerHeight,
      0.1,
      100,
    );

    this.camera.position.set(0, 0, 4);

    this.world = new FirstWorld(this.scene);

    window.addEventListener('resize', this.handleResize);
  }

  async start() {
    await this.renderer.init();

    this.renderer.renderer.setAnimationLoop(() => {
      const elapsed = this.clock.getElapsedTime();

      this.world.update(elapsed);

      this.renderer.renderer.render(
        this.scene,
        this.camera,
      );
    });
  }

  private handleResize = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.renderer.resize(width, height);
  };

  dispose() {
    window.removeEventListener(
      'resize',
      this.handleResize,
    );

    this.renderer.renderer.setAnimationLoop(null);
    this.world.dispose();
    this.renderer.dispose();
  }
}