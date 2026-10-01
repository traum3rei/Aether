import * as THREE from 'three/webgpu';

import { AetherRenderer } from './Renderer';
import { FirstWorld, type FirstWorldParameters } from '../worlds/FirstWorld';

export class AetherEngine {
  private readonly renderer: AetherRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private world: FirstWorld;
  private previousFrameTime = 0;
  private disposed = false;

  private sharedElapsed = 0;

  constructor(canvas: HTMLCanvasElement, parameters: Partial<FirstWorldParameters> = {}) {
    this.renderer =
      new AetherRenderer(canvas);

    this.scene =
      new THREE.Scene();

    this.scene.background =
      new THREE.Color(0x020202);

    this.camera =
      new THREE.PerspectiveCamera(
        50,
        window.innerWidth /
          window.innerHeight,
        0.1,
        100,
      );

    this.camera.position.set(
      0,
      0,
      4,
    );

    this.world =
      new FirstWorld(
        this.scene,
        parameters,
      );

    window.addEventListener(
      'resize',
      this.handleResize,
    );
  }

  async start() {
    await this.renderer.init();
    if (this.disposed) return;

    const gpu =
      this.renderer.renderer;

    /*
     * Initialize the GPU state once.
     */

    await this.world.init(gpu);
    gpu.setAnimationLoop((time) => {
      const deltaSeconds = this.previousFrameTime === 0
        ? 1 / 60
        : Math.min((time - this.previousFrameTime) / 1000, 0.05);
      this.previousFrameTime = time;
      this.sharedElapsed += deltaSeconds;

      this.world.update(gpu, Math.min(deltaSeconds, 1 / 30));

      /*
       * Render
       */

      gpu.render(
        this.scene,
        this.camera,
      );
    });
  }

  private handleResize = () => {
    const width =
      window.innerWidth;

    const height =
      window.innerHeight;

    this.camera.aspect =
      width / height;

    this.camera.updateProjectionMatrix();

    this.renderer.resize(
      width,
      height,
    );
  };

  setSharedTimeline(_startTime: number, elapsedSeconds = 0) {
    this.sharedElapsed = Math.max(0, elapsedSeconds);
    this.previousFrameTime = 0;
  }

  getSharedElapsed() {
    return this.sharedElapsed;
  }

  async setWorldParameters(parameters: Parameters<FirstWorld['setParameters']>[0]) {
    if (parameters.seed !== undefined && parameters.seed !== this.world.getParameters().seed) {
      const previousWorld = this.world;
      const nextParameters = { ...previousWorld.getParameters(), ...parameters };
      const nextWorld = new FirstWorld(this.scene, nextParameters);
      await nextWorld.init(this.renderer.renderer);
      if (this.disposed) {
        nextWorld.dispose();
        return;
      }
      this.world = nextWorld;
      previousWorld.dispose();
      return;
    }

    if (parameters.particleCount !== undefined && parameters.particleCount !== this.world.getParameters().particleCount) {
      const previousWorld = this.world;
      const nextParameters = { ...previousWorld.getParameters(), ...parameters };
      const nextWorld = new FirstWorld(this.scene, nextParameters);
      await nextWorld.init(this.renderer.renderer);
      if (this.disposed) {
        nextWorld.dispose();
        return;
      }
      this.world = nextWorld;
      previousWorld.dispose();
      return;
    }

    this.world.setParameters(parameters);
  }

  dispose() {

    this.disposed = true;
    window.removeEventListener(
      'resize',
      this.handleResize,
    );

    this.renderer.renderer
      .setAnimationLoop(null);

    this.world.dispose();

    this.renderer.dispose();
  }
}
