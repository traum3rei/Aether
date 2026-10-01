import * as THREE from 'three/webgpu';

export class AetherRenderer {
  readonly renderer: THREE.WebGPURenderer;
  private resolutionScale = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGPURenderer({
      canvas,
      antialias: false,
    });

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25) * this.resolutionScale);

    this.renderer.setSize(
      window.innerWidth,
      window.innerHeight,
    );
  }

  async init() {
    await this.renderer.init();
  }

  resize(width: number, height: number) {
    this.renderer.setSize(width, height);
  }

  setResolutionScale(scale: number) {
    this.resolutionScale = THREE.MathUtils.clamp(scale, 0.5, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25) * this.resolutionScale);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  dispose() {
    this.renderer.dispose();
  }
}