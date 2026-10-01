import * as THREE from 'three/webgpu';
import {
  Fn,
  float,
  hash,
  instanceIndex,
  instancedArray,
  mix,
  pow,
  sin,
  uv,
  vec3,
  uniform,
} from 'three/tsl';


export interface FirstWorldParameters {
  particleCount: number;
  flowScale: number;
  flowStrength: number;
  damping: number;
  confinement: number;
  radius: number;
  timeScale: number;
  sharpness: number;
  glow: number;
  particleSize: number;
  seed: number;
}

export const defaultFirstWorldParameters: FirstWorldParameters = {
  particleCount: 100_000,
  flowScale: 1.35,
  flowStrength: 0.42,
  damping: 0.985,
  confinement: 1.1,
  radius: 1.75,
  timeScale: 1,
  sharpness: 0.35,
  glow: 0.34,
  particleSize: 0.016,
  seed: 1,
};

export class FirstWorld {
  private readonly particles: THREE.Sprite;
  private readonly material: THREE.SpriteNodeMaterial;
  private readonly positions;
  private readonly velocities;
  private readonly computeInit;
  private readonly computeUpdate;
  private readonly parameters: FirstWorldParameters;

  private readonly flowScale = uniform(defaultFirstWorldParameters.flowScale);
  private readonly flowStrength = uniform(defaultFirstWorldParameters.flowStrength);
  private readonly damping = uniform(defaultFirstWorldParameters.damping);
  private readonly confinement = uniform(defaultFirstWorldParameters.confinement);
  private readonly radius = uniform(defaultFirstWorldParameters.radius);
  private readonly timeScale = uniform(defaultFirstWorldParameters.timeScale);
  private readonly frameDelta = uniform(1 / 60);
  private readonly sharpness = uniform(defaultFirstWorldParameters.sharpness);
  private readonly glow = uniform(defaultFirstWorldParameters.glow);
  private readonly particleSize = uniform(defaultFirstWorldParameters.particleSize);

  constructor(
    scene: THREE.Scene,
    parameters: Partial<FirstWorldParameters> = {},
  ) {
    this.parameters = {
      ...defaultFirstWorldParameters,
      ...parameters,
    };
    this.flowScale.value = this.parameters.flowScale;
    this.flowStrength.value = this.parameters.flowStrength;
    this.damping.value = this.parameters.damping;
    this.confinement.value = this.parameters.confinement;
    this.radius.value = this.parameters.radius;
    this.timeScale.value = this.parameters.timeScale;
    this.sharpness.value = this.parameters.sharpness;
    this.glow.value = this.parameters.glow;
    this.particleSize.value = this.parameters.particleSize;

    const count = this.parameters.particleCount;
    this.positions = instancedArray(count, 'vec3');
    this.velocities = instancedArray(count, 'vec3');

    this.computeInit = Fn(() => {
      const position = this.positions.element(instanceIndex);
      const velocity = this.velocities.element(instanceIndex);

      // Integer hashes stay stable for large instance indices; sin(i * k) does not.
      const seedOffset = Math.imul(this.parameters.seed, 104729) >>> 0;
      const seed = hash(instanceIndex.add(seedOffset)).toVar();
      const seed2 = hash(instanceIndex.add(seedOffset + 1)).toVar();
      const seed3 = hash(instanceIndex.add(seedOffset + 2)).toVar();
      const seed4 = hash(instanceIndex.add(seedOffset + 3)).toVar();

      const angle = seed.mul(Math.PI * 2).add(seed2.mul(0.72));
      const majorRadius = mix(float(0.42), float(1.22), seed2.pow(0.7));
      const tubeRadius = mix(float(0.025), float(0.27), seed4.pow(1.7));
      const radial = majorRadius.add(tubeRadius.mul(seed4.mul(2).sub(1)));
      const height = seed2.sub(0.5).mul(0.55).add(sin(angle.mul(3)).mul(0.12));
      const tendrilAngle = angle.mul(5).add(seed.mul(18));
      const tendrilRadius = seed4.pow(2).mul(0.62);
      const tendrilWeight = seed3.sub(0.72).max(0).mul(3.57).min(1);

      const x = mix(
        radial.mul(angle.cos()),
        majorRadius.mul(angle.cos()).add(tendrilRadius.mul(tendrilAngle.cos())),
        tendrilWeight,
      );
      const y = mix(
        radial.mul(angle.sin()),
        majorRadius.mul(angle.sin()).add(tendrilRadius.mul(tendrilAngle.sin())),
        tendrilWeight,
      );
      const z = mix(height, tendrilRadius.mul(tendrilAngle.mul(2).sin()).add(height), tendrilWeight);

      position.assign(vec3(x, y, z));

      velocity.assign(vec3(
        seed.sub(0.5).mul(0.015),
        seed2.sub(0.5).mul(0.015),
        seed3.sub(0.5).mul(0.015),
      ));
    })().compute(count);

    this.computeUpdate = Fn(() => {
      const position = this.positions.element(instanceIndex);
      const velocity = this.velocities.element(instanceIndex);
      const p = position.toVar();
      const v = velocity.toVar();
      const dt = this.frameDelta.mul(this.timeScale).min(0.05);
      const flowPosition = p.mul(this.flowScale);
      const flow = vec3(
        sin(flowPosition.y.add(flowPosition.z.mul(0.7))),
        sin(flowPosition.z.add(flowPosition.x.mul(0.7))),
        sin(flowPosition.x.add(flowPosition.y.mul(0.7))),
      );

      v.addAssign(flow.mul(this.flowStrength).mul(dt));

      // A soft radial field keeps the matter gathered without imposing a shell.
      const distance = p.length().max(0.001);
      const boundary = distance.sub(this.radius).max(0.0);
      const inwardForce = p.div(distance).mul(boundary).mul(this.confinement);
      const gentleCohesion = p.mul(0.045);
      v.subAssign(inwardForce.add(gentleCohesion).mul(dt));

      // Exponential damping makes the response stable across frame rates.
      v.mulAssign(pow(this.damping, dt.mul(60)));
      p.addAssign(v.mul(dt));

      position.assign(p);

      velocity.assign(v);
    })().compute(count);

    this.material = new THREE.SpriteNodeMaterial({
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.material.positionNode = this.positions.toAttribute();
    this.material.sizeAttenuation = true;

    const index = float(instanceIndex);
    const random = sin(index.mul(12.9898)).mul(43758.5453).fract();
    const random2 = sin(index.mul(78.233)).mul(43758.5453).fract();
    const sizeVariation = mix(float(0.55), float(1.7), pow(random, 2.5));
    this.material.scaleNode = this.particleSize.mul(sizeVariation);
    const deep = vec3(0.3, 0.52, 0.76);
    const bright = vec3(1.0, 0.88, 0.68);
    const particleColor = mix(deep, bright, pow(random2, 2.2));
    const sharpTint = mix(particleColor.mul(0.72), particleColor, this.sharpness);
    this.material.colorNode = sharpTint;

    const particleUV = uv().sub(0.5).mul(2);
    const radial = particleUV.length();
    const core = float(1).sub(radial).max(0);
    const softHalo = pow(core, mix(float(1.15), float(4), this.sharpness));
    const compactCore = pow(core, 9);
    const softProfile = softHalo.mul(0.68).add(compactCore.mul(0.72));
    this.material.opacityNode = softProfile.mul(this.glow);

    this.material.opacityNode = softProfile.mul(this.glow);

    this.particles = new THREE.Sprite(this.material);
    this.particles.count = count;
    this.particles.frustumCulled = false;

    scene.add(this.particles);
  }

  setParameters(parameters: Partial<FirstWorldParameters>) {
    Object.assign(this.parameters, parameters);
    if (parameters.flowScale !== undefined) this.flowScale.value = parameters.flowScale;
    if (parameters.flowStrength !== undefined) this.flowStrength.value = parameters.flowStrength;
    if (parameters.damping !== undefined) this.damping.value = parameters.damping;
    if (parameters.confinement !== undefined) this.confinement.value = parameters.confinement;
    if (parameters.radius !== undefined) this.radius.value = parameters.radius;
    if (parameters.timeScale !== undefined) this.timeScale.value = parameters.timeScale;
    if (parameters.sharpness !== undefined) this.sharpness.value = parameters.sharpness;
    if (parameters.glow !== undefined) this.glow.value = parameters.glow;
    if (parameters.particleSize !== undefined) this.particleSize.value = parameters.particleSize;
  }

  getParameters(): Readonly<FirstWorldParameters> {
    return this.parameters;
  }

  async init(renderer: THREE.WebGPURenderer) {
    await renderer.computeAsync(this.computeInit);
  }

  update(renderer: THREE.WebGPURenderer, deltaSeconds: number, _camera?: THREE.PerspectiveCamera) {
    this.frameDelta.value = Math.min(Math.max(deltaSeconds, 0), 0.05);
    renderer.compute(this.computeUpdate);
  }


  dispose() {
    this.particles.removeFromParent();
    this.material.dispose();
  }
}
