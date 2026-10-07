import * as THREE from 'three/webgpu';
import { float, pass, smoothstep, uv } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import type Node from 'three/src/nodes/core/Node.js';

export type PostProcessingSettings = { bloom: number; threshold: number; vignette: number };

export class AetherRenderer {
  readonly renderer: THREE.WebGPURenderer;
  private resolutionScale = 1;
  private pipeline: THREE.RenderPipeline | null = null;
  private pipelineKey = '';
  private postSettings: PostProcessingSettings = { bloom: 0, threshold: 0.75, vignette: 0 };

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

  setPostProcessing(settings: PostProcessingSettings) {
    this.postSettings = settings;
    const nextKey = JSON.stringify(settings);
    if (nextKey !== this.pipelineKey) {
      this.pipeline?.dispose();
      this.pipeline = null;
      this.pipelineKey = nextKey;
    }
  }

  render(scene: THREE.Scene, camera: THREE.Camera) {
    if (this.postSettings.bloom > 0 || this.postSettings.vignette > 0) {
      if (!this.pipeline) {
        const sceneColor = pass(scene, camera).getTextureNode('output');
        let output: Node<'vec4'> = sceneColor;
        if (this.postSettings.bloom > 0) output = output.add(bloom(sceneColor, this.postSettings.bloom, 0.35, this.postSettings.threshold));
        if (this.postSettings.vignette > 0) {
          const edge = uv().sub(0.5).length().mul(1.55);
          const vignette = smoothstep(0.55, 1.05, edge).mul(this.postSettings.vignette);
          output = output.mul(float(1).sub(vignette));
        }
        this.pipeline = new THREE.RenderPipeline(this.renderer, output);
      }
      this.pipeline.render();
      return;
    }
    this.renderer.render(scene, camera);
  }

  setResolutionScale(scale: number) {
    this.resolutionScale = THREE.MathUtils.clamp(scale, 0.5, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25) * this.resolutionScale);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  dispose() {
    this.pipeline?.dispose();
    this.pipeline = null;
    this.pipelineKey = '';
    this.renderer.dispose();
  }
}
