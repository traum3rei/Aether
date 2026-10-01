import * as THREE from 'three/webgpu';

import { AetherRenderer } from './Renderer';
import { FirstWorld, type FirstWorldParameters } from '../worlds/FirstWorld';
import type { WorldId } from '../worlds/WorldId';

type AetherWorld = FirstWorld | import('../worlds/StyxWorld').StyxWorld;

export class AetherEngine {
  private readonly renderer: AetherRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private world: AetherWorld;
  private worldId: WorldId = 'pelagic';
  private worldOperations = Promise.resolve();
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

      this.world.update(gpu, Math.min(deltaSeconds, 1 / 30), this.camera);

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
    if ('setElapsedSeconds' in this.world && typeof this.world.setElapsedSeconds === 'function') {
      this.world.setElapsedSeconds(this.sharedElapsed);
    }
  }

  getSharedElapsed() {
    return this.sharedElapsed;
  }

  async setWorldParameters(parameters: Parameters<FirstWorld['setParameters']>[0]) {
    return this.enqueueWorldOperation(() => this.applyWorldParameters(parameters));
  }

  async setWorld(worldId: WorldId, parameters: Partial<FirstWorldParameters> = {}) {
    return this.enqueueWorldOperation(async () => {
      if (this.disposed) return;
      if (worldId === this.worldId) {
        await this.applyWorldParameters(parameters);
        return;
      }

      const nextWorld = await this.createWorld(worldId, {
        ...this.world.getParameters(),
        ...parameters,
      });
      if ('setElapsedSeconds' in nextWorld && typeof nextWorld.setElapsedSeconds === 'function') {
        nextWorld.setElapsedSeconds(this.sharedElapsed);
      }
      try {
        await nextWorld.init(this.renderer.renderer);
      } catch (error) {
        nextWorld.dispose();
        throw error;
      }
      if (this.disposed) {
        nextWorld.dispose();
        return;
      }

      const previousWorld = this.world;
      this.world = nextWorld;
      this.worldId = worldId;
      this.scene.background = new THREE.Color(worldId === 'styx' ? 0x10071e : 0x020202);
      previousWorld.dispose();
    });
  }

  private async applyWorldParameters(parameters: Partial<FirstWorldParameters>) {
    if (this.disposed) return;
    const needsRecreation = this.world instanceof FirstWorld && (
      (parameters.seed !== undefined && parameters.seed !== this.world.getParameters().seed) ||
      (parameters.particleCount !== undefined && parameters.particleCount !== this.world.getParameters().particleCount)
    );
    if (needsRecreation) {
      const previousWorld = this.world;
      const nextParameters = { ...previousWorld.getParameters(), ...parameters };
      const nextWorld = await this.createWorld(this.worldId, nextParameters);
      try {
        await nextWorld.init(this.renderer.renderer);
      } catch (error) {
        nextWorld.dispose();
        throw error;
      }
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

  private enqueueWorldOperation(operation: () => Promise<void>) {
    const result = this.worldOperations.then(operation);
    this.worldOperations = result.then(() => undefined, () => undefined);
    return result;
  }

  private async createWorld(worldId: WorldId, parameters: Partial<FirstWorldParameters>): Promise<AetherWorld> {
    if (worldId === 'styx') {
      const { StyxWorld } = await import('../worlds/StyxWorld');
      return new StyxWorld(this.scene, parameters);
    }
    return new FirstWorld(this.scene, parameters);
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
