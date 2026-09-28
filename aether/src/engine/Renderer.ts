import * as THREE from 'three/webgpu';

export class AetherRenderer {
  readonly renderer: THREE.WebGPURenderer;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGPURenderer({
      canvas,
      antialias: true,
    });

    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, 2),
    );

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

  dispose() {
    this.renderer.dispose();
  }
}