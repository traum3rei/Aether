import * as THREE from 'three/webgpu';

import { AetherRenderer } from './Renderer';
import { FirstWorld, type FirstWorldParameters } from '../worlds/FirstWorld';
import type { WorldId } from '../worlds/WorldId';

const MAX_NAVIGATION_DISTANCE = 8;

type AetherWorld =
  | FirstWorld
  | import('../worlds/StyxWorld').StyxWorld
  | import('../worlds/Y2KWorld').Y2KWorld
  | import('../worlds/HydrosWorld').HydrosWorld
  | import('../worlds/RaymarchWorld').RaymarchWorld;

export class AetherEngine {
  private readonly renderer: AetherRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private world: AetherWorld;
  private worldId: WorldId = 'pelagic';
  private worldOperations = Promise.resolve();
  private previousFrameTime = 0;
  private disposed = false;
  private navigationActive = false;
  private navigationYaw = 0;
  private navigationPitch = 0;
  private navigationStartPosition: THREE.Vector3 | null = null;
  private navigationStartYaw = 0;
  private navigationStartPitch = 0;
  private moveSide = 0;
  private moveForward = 0;
  private readonly pressedKeys = new Set<string>();
  private activePointerId: number | null = null;
  private pointerX = 0;
  private pointerY = 0;

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

    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('pointermove', this.handlePointerMove);
    canvas.addEventListener('pointerup', this.handlePointerEnd);
    canvas.addEventListener('pointercancel', this.handlePointerEnd);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);

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

      this.world.update(
        gpu,
        Math.min(deltaSeconds, 1 / 30),
        this.navigationActive && this.worldId !== 'raymarch' ? undefined : this.camera,
      );
      if (this.navigationActive) this.updateNavigation(deltaSeconds);

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
    const bounds = this.renderer.renderer.domElement.getBoundingClientRect();
    const width = bounds.width || window.innerWidth;
    const height = bounds.height || window.innerHeight;

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
      this.resetNavigation();

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
      this.renderer.setResolutionScale(worldId === 'raymarch' ? 0.5 : 1);
      this.scene.background = new THREE.Color(
        worldId === 'styx' ? 0x10071e
          : worldId === 'y2k' ? 0x09051d
            : worldId === 'hydros' ? 0x03152e
              : worldId === 'raymarch' ? 0x080817
              : 0x020202,
      );
      this.scene.fog = worldId === 'hydros'
        ? new THREE.FogExp2(0x03152e, 0.045)
        : null;
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

  setMoveInput(side: number, forward: number) {
    this.moveSide = THREE.MathUtils.clamp(side, -1, 1);
    this.moveForward = THREE.MathUtils.clamp(forward, -1, 1);
    if (this.moveSide !== 0 || this.moveForward !== 0) this.enableNavigation();
  }

  private handleKeyDown = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLElement && event.target.isContentEditable) return;
    if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes((event.target as HTMLElement | null)?.tagName ?? '')) return;
    if (event.code === 'KeyR') {
      event.preventDefault();
      this.returnToStartView();
      return;
    }
    if (!['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'].includes(event.code)) return;
    event.preventDefault();
    this.pressedKeys.add(event.code);
    this.enableNavigation();
  };

  private handleKeyUp = (event: KeyboardEvent) => {
    this.pressedKeys.delete(event.code);
  };

  private handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    this.activePointerId = event.pointerId;
    this.pointerX = event.clientX;
    this.pointerY = event.clientY;
    if (event.currentTarget instanceof HTMLCanvasElement) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    this.enableNavigation();
  };

  private handlePointerMove = (event: PointerEvent) => {
    if (event.pointerId !== this.activePointerId) return;
    const deltaX = event.clientX - this.pointerX;
    const deltaY = event.clientY - this.pointerY;
    this.pointerX = event.clientX;
    this.pointerY = event.clientY;
    this.navigationYaw -= deltaX * 0.004;
    this.navigationPitch = THREE.MathUtils.clamp(
      this.navigationPitch - deltaY * 0.004,
      -1.35,
      1.35,
    );
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.navigationPitch, this.navigationYaw, 0);
  };

  private handlePointerEnd = (event: PointerEvent) => {
    if (event.pointerId === this.activePointerId) this.activePointerId = null;
  };

  private handleBlur = () => {
    this.pressedKeys.clear();
    this.activePointerId = null;
  };

  private enableNavigation() {
    if (this.navigationActive) return;
    this.camera.updateMatrixWorld();
    const direction = this.camera.getWorldDirection(new THREE.Vector3());
    this.navigationYaw = Math.atan2(-direction.x, -direction.z);
    this.navigationPitch = Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1));
    this.navigationStartPosition = this.camera.position.clone();
    this.navigationStartYaw = this.navigationYaw;
    this.navigationStartPitch = this.navigationPitch;
    this.navigationActive = true;
  }

  returnToStartView() {
    this.enableNavigation();
    if (!this.navigationStartPosition) return;
    this.moveSide = 0;
    this.moveForward = 0;
    this.pressedKeys.clear();
    this.activePointerId = null;
    this.camera.position.copy(this.navigationStartPosition);
    this.navigationYaw = this.navigationStartYaw;
    this.navigationPitch = this.navigationStartPitch;
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.navigationPitch, this.navigationYaw, 0);
  }

  private updateNavigation(deltaSeconds: number) {
    const side = this.moveSide
      + Number(this.pressedKeys.has('KeyD') || this.pressedKeys.has('ArrowRight'))
      - Number(this.pressedKeys.has('KeyA') || this.pressedKeys.has('ArrowLeft'));
    const forward = this.moveForward
      + Number(this.pressedKeys.has('KeyW') || this.pressedKeys.has('ArrowUp'))
      - Number(this.pressedKeys.has('KeyS') || this.pressedKeys.has('ArrowDown'));
    const movement = new THREE.Vector2(side, forward);
    if (movement.lengthSq() > 1) movement.normalize();
    const distance = 2.8 * deltaSeconds;
    const forwardDirection = this.camera.getWorldDirection(new THREE.Vector3());
    forwardDirection.y = 0;
    forwardDirection.normalize();
    const rightDirection = new THREE.Vector3()
      .crossVectors(forwardDirection, new THREE.Vector3(0, 1, 0));
    const nextPosition = this.camera.position.clone()
      .addScaledVector(rightDirection, movement.x * distance)
      .addScaledVector(forwardDirection, movement.y * distance);
    if (this.navigationStartPosition) {
      const offsetX = nextPosition.x - this.navigationStartPosition.x;
      const offsetZ = nextPosition.z - this.navigationStartPosition.z;
      const offsetLength = Math.hypot(offsetX, offsetZ);
      if (offsetLength > MAX_NAVIGATION_DISTANCE) {
        const scale = MAX_NAVIGATION_DISTANCE / offsetLength;
        nextPosition.x = this.navigationStartPosition.x + offsetX * scale;
        nextPosition.z = this.navigationStartPosition.z + offsetZ * scale;
      }
    }
    this.camera.position.copy(nextPosition);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.navigationPitch, this.navigationYaw, 0);
  }

  private resetNavigation() {
    this.navigationActive = false;
    this.navigationStartPosition = null;
    this.moveSide = 0;
    this.moveForward = 0;
    this.pressedKeys.clear();
    this.activePointerId = null;
  }

  private async createWorld(worldId: WorldId, parameters: Partial<FirstWorldParameters>): Promise<AetherWorld> {
    if (worldId === 'styx') {
      const { StyxWorld } = await import('../worlds/StyxWorld');
      return new StyxWorld(this.scene, parameters);
    }
    if (worldId === 'y2k') {
      const { Y2KWorld } = await import('../worlds/Y2KWorld');
      return new Y2KWorld(this.scene, parameters);
    }
    if (worldId === 'hydros') {
      const { HydrosWorld } = await import('../worlds/HydrosWorld');
      return new HydrosWorld(this.scene, parameters);
    }
    if (worldId === 'raymarch') {
      const { RaymarchWorld } = await import('../worlds/RaymarchWorld');
      return new RaymarchWorld(this.scene, parameters);
    }
    return new FirstWorld(this.scene, parameters);
  }

  dispose() {

    this.disposed = true;
    const canvas = this.renderer.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.handlePointerDown);
    canvas.removeEventListener('pointermove', this.handlePointerMove);
    canvas.removeEventListener('pointerup', this.handlePointerEnd);
    canvas.removeEventListener('pointercancel', this.handlePointerEnd);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
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
