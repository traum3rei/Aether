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

    this.renderer.setSize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, false);
  }

  async init() {
    await this.renderer.init();
  }

  resize(width: number, height: number) {
    this.renderer.setSize(width, height, false);
  }

  setResolutionScale(scale: number) {
    this.resolutionScale = THREE.MathUtils.clamp(scale, 0.5, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25) * this.resolutionScale);
    this.renderer.setSize(this.renderer.domElement.clientWidth || window.innerWidth, this.renderer.domElement.clientHeight || window.innerHeight, false);
  }

  dispose() {
    this.renderer.dispose();
  }
}
