import * as THREE from 'three/webgpu';
import {
  Fn,
  If,
  Loop,
  abs,
  atan,
  cos,
  exp,
  float,
  max,
  min,
  mix,
  normalize,
  pow,
  select,
  sin,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';

import type { FirstWorldParameters } from './FirstWorld';
import { defaultFirstWorldParameters } from './FirstWorld';

function rotateX(point: Node<'vec3'>, angle: Node<'float'>) {
  return vec3(
    point.x,
    point.y.mul(angle.cos()).sub(point.z.mul(angle.sin())),
    point.y.mul(angle.sin()).add(point.z.mul(angle.cos())),
  );
}

function rotateY(point: Node<'vec3'>, angle: Node<'float'>) {
  return vec3(
    point.x.mul(angle.cos()).add(point.z.mul(angle.sin())),
    point.y,
    point.z.mul(angle.cos()).sub(point.x.mul(angle.sin())),
  );
}

function loopBundle(point: Node<'vec3'>, motionTime: Node<'float'>, phase: number) {
  const distance = float(100).toVar();
  Loop({ start: 0, end: 10, type: 'int' }, ({ i }) => {
    const index = float(i);
    const angle = index.mul(2.399).add(phase);
    const orbit = index.mul(0.036).add(0.08);
    const center = vec3(
      angle.cos().mul(orbit),
      angle.sin().mul(orbit).mul(0.82),
      sin(index.mul(1.73).add(phase)).mul(0.2),
    );
    const ringPoint = point.sub(center);
    const tiltX = sin(index.mul(2.13).add(phase)).mul(0.88);
    const tiltY = angle.mul(0.73).add(phase).cos().mul(0.95);
    const rotatingPoint = rotateY(
      rotateX(ringPoint, tiltX),
      tiltY.add(motionTime.mul(0.09).mul(select(index.mod(2).lessThan(0.5), 1, -1))),
    );
    const ringRadius = vec2(rotatingPoint.x, rotatingPoint.y).length();
    const ringPhase = atan(rotatingPoint.z, ringRadius.sub(index.mul(0.018).add(0.19)));
    const braidOffset = sin(ringPhase.mul(13).add(index.mul(1.7)).add(motionTime.mul(0.24))).mul(0.012);
    const majorRadius = index.mul(0.018).add(0.19)
      .add(sin(ringPhase.mul(2).add(motionTime.mul(0.24)).add(phase)).mul(0.018))
      .add(sin(ringPhase.mul(3).sub(phase)).mul(0.009))
      .add(braidOffset)
      .mul(1.32);
    const filamentWidth = sin(index.mul(4.1).add(phase)).mul(0.002).add(0.007);
    const torus = vec2(
      ringRadius.sub(majorRadius),
      rotatingPoint.z,
    ).length().sub(filamentWidth);
    distance.assign(min(distance, torus));
  });
  return distance;
}

function sceneDistance(point: Node<'vec3'>, time: Node<'float'>) {
  const distance = float(100).toVar();
  const firstCenter = vec3(
    float(-1.05).add(sin(time.mul(0.21).add(0.4)).mul(0.32)),
    float(0.78).add(sin(time.mul(0.16).add(1.1)).mul(0.24)),
    float(-4.1).add(sin(time.mul(0.14).add(0.3)).mul(1.05)),
  );
  const firstPoint = point.sub(firstCenter);
  const firstBound = firstPoint.length().sub(1.15);
  If(firstBound.lessThan(distance), () => {
    distance.assign(min(distance, loopBundle(firstPoint, time.mul(0.82).add(0.4), 0.3)));
  });

  const secondCenter = vec3(
    float(0.96).add(cos(time.mul(0.17).add(2.2)).mul(0.38)),
    float(-0.82).add(cos(time.mul(0.23).add(1.7)).mul(0.31)),
    float(-4.9).add(cos(time.mul(0.12).add(2)).mul(1.2)),
  );
  const secondPoint = point.sub(secondCenter);
  const secondBound = secondPoint.length().sub(1.15);
  If(secondBound.lessThan(distance), () => {
    distance.assign(min(distance, loopBundle(secondPoint, time.mul(1.13).add(2.2), 1.7)));
  });

  const thirdCenter = vec3(
    float(-0.12).add(sin(time.mul(0.29).add(3.4)).mul(0.42)),
    float(-0.08).add(cos(time.mul(0.19).add(3.4)).mul(0.34)),
    float(-6.4).add(sin(time.mul(0.18).add(4.2)).mul(1.5)),
  );
  const thirdPoint = point.sub(thirdCenter);
  const thirdBound = thirdPoint.length().sub(1.15);
  If(thirdBound.lessThan(distance), () => {
    distance.assign(min(distance, loopBundle(thirdPoint, time.mul(0.67).add(4.2), 3.4)));
  });
  return distance;
}

export class RaymarchWorld {
  private readonly scene: THREE.Scene;
  private readonly parameters: FirstWorldParameters;
  private readonly plane: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicNodeMaterial>;
  private readonly time = uniform(0);
  private readonly fieldScale = uniform(1);
  private readonly glow = uniform(0.34);
  private readonly marchSpeed = uniform(0.42);
  private readonly aspect = uniform(1);
  private elapsed = 0;

  constructor(scene: THREE.Scene, parameters: Partial<FirstWorldParameters> = {}) {
    this.scene = scene;
    this.parameters = { ...defaultFirstWorldParameters, ...parameters };

    const material = new THREE.MeshBasicNodeMaterial();
    material.fragmentNode = Fn(() => {
      const screen = uv().mul(2).sub(1);
      screen.x.mulAssign(this.aspect);
      const rayOrigin = vec3(0, 0, 0);
      const rayDirection = normalize(vec3(screen.x, screen.y, -1.72));
      const travel = float(0).toVar();
      const hitFlag = float(0).toVar();
      const hitDistance = float(0).toVar();
      const hitSurfaceDistance = float(0).toVar();
      const hitPoint = vec3(0).toVar();
      const wideHalo = float(0).toVar();
      const tightHalo = float(0).toVar();

      Loop({ start: 0, end: 56, type: 'int' }, () => {
        If(hitFlag.lessThan(0.5).and(travel.lessThan(14)), () => {
          const point = rayOrigin.add(rayDirection.mul(travel));
          const distance = sceneDistance(point.mul(this.fieldScale), this.time)
            .div(this.fieldScale);
          const haloDepth = exp(travel.mul(-0.12));
          wideHalo.assign(max(wideHalo, exp(distance.max(0).mul(-5)).mul(haloDepth)));
          tightHalo.assign(max(tightHalo, exp(distance.max(0).mul(-13)).mul(haloDepth)));
          const hit = distance.lessThan(0.004);
          hitPoint.assign(select(hit, point, hitPoint));
          hitDistance.assign(select(hit, travel, hitDistance));
          hitSurfaceDistance.assign(select(hit, distance, hitSurfaceDistance));
          hitFlag.assign(max(hitFlag, select(hit, 1, 0)));
          travel.addAssign(select(hit, 0, distance.max(0.002).mul(0.82)));
        });
      });

      const warmLight = vec3(1, 0.88, 0.72);
      const background = vec3(0.0008, 0.001, 0.002);
      const surfaceColor = background.toVar();
      If(hitFlag.greaterThan(0.5), () => {
        const epsilon = float(0.003);
        const normal = normalize(vec3(
          sceneDistance(hitPoint.add(vec3(epsilon, 0, 0)).mul(this.fieldScale), this.time)
            .sub(sceneDistance(hitPoint.sub(vec3(epsilon, 0, 0)).mul(this.fieldScale), this.time)),
          sceneDistance(hitPoint.add(vec3(0, epsilon, 0)).mul(this.fieldScale), this.time)
            .sub(sceneDistance(hitPoint.sub(vec3(0, epsilon, 0)).mul(this.fieldScale), this.time)),
          sceneDistance(hitPoint.add(vec3(0, 0, epsilon)).mul(this.fieldScale), this.time)
            .sub(sceneDistance(hitPoint.sub(vec3(0, 0, epsilon)).mul(this.fieldScale), this.time)),
        ));

        const surfacePoint = hitPoint.mul(this.fieldScale);
        const angle = atan(surfacePoint.y, surfacePoint.x);
        const etched = pow(
          float(1).sub(abs(sin(surfacePoint.x.mul(112).add(surfacePoint.y.mul(73)).add(surfacePoint.z.mul(31))))),
          20,
        );
        const dotted = pow(float(1).sub(abs(sin(angle.mul(112).add(surfacePoint.z.mul(87))))), 14);
        const specular = pow(max(normal.dot(normalize(vec3(-0.42, 0.68, 0.55))), 0), 26);
        const silverLight = vec3(0.62, 0.8, 0.92);
        const filamentTint = smoothstep(-0.3, 0.55, sin(angle.mul(2.7).add(surfacePoint.z.mul(0.8)).add(this.time.mul(0.13))));
        const filamentColor = mix(silverLight, warmLight, filamentTint);
        const wireLines = mix(
          vec3(0.008, 0.01, 0.014),
          filamentColor.mul(0.82),
          etched.mul(0.72).add(dotted.mul(0.42)),
        );
        const surface = wireLines
          .add(filamentColor.mul(specular.mul(0.9)))
          .add(filamentColor.mul(this.glow).mul(0.14));
        const edgeGlow = exp(abs(hitSurfaceDistance.mul(this.fieldScale)).mul(-70));
        const lit = surface
          .add(filamentColor.mul(edgeGlow.mul(float(0.75).add(this.glow.mul(2.2)))))
          .add(warmLight.mul(wideHalo.mul(float(0.2).add(this.glow.mul(0.5)))))
          .add(warmLight.mul(tightHalo.mul(float(0.55).add(this.glow.mul(1.4)))));
        const fog = exp(hitDistance.mul(-0.09));
        surfaceColor.assign(mix(background, lit, fog));
      });
      const finalColor = surfaceColor
        .add(warmLight.mul(wideHalo.mul(float(0.12).add(this.glow.mul(0.25)))))
        .add(warmLight.mul(tightHalo.mul(float(0.16).add(this.glow.mul(0.35)))));
      const vignette = float(1).sub(smoothstep(0.74, 1.55, screen.length()));
      return vec4(finalColor.mul(vignette), 1);
    })();

    this.plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    this.plane.frustumCulled = false;
    this.scene.add(this.plane);
    this.setParameters(parameters);
  }

  async init(_renderer: THREE.WebGPURenderer) {}

  setParameters(parameters: Partial<FirstWorldParameters>) {
    Object.assign(this.parameters, parameters);
    this.fieldScale.value = 1.4 / THREE.MathUtils.clamp(this.parameters.radius, 0.8, 3);
    this.glow.value = THREE.MathUtils.clamp(this.parameters.glow, 0, 1);
    this.marchSpeed.value = 0.2 + THREE.MathUtils.clamp(this.parameters.flowStrength, 0, 1.5);
  }

  getParameters(): Readonly<FirstWorldParameters> {
    return this.parameters;
  }

  setElapsedSeconds(elapsedSeconds: number) {
    this.elapsed = Math.max(0, elapsedSeconds);
    this.time.value = this.elapsed;
  }

  update(_renderer: THREE.WebGPURenderer, deltaSeconds: number, camera?: THREE.PerspectiveCamera) {
    this.elapsed += deltaSeconds * this.parameters.timeScale * this.marchSpeed.value;
    this.time.value = this.elapsed;
    this.aspect.value = window.innerWidth / window.innerHeight;
    if (!camera) return;

    const distance = 1;
    const viewSize = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const direction = camera.getWorldDirection(new THREE.Vector3());
    this.plane.position.copy(camera.position).addScaledVector(direction, distance);
    this.plane.quaternion.copy(camera.quaternion);
    this.plane.scale.set(viewSize * camera.aspect, viewSize, 1);
  }

  dispose() {
    this.scene.remove(this.plane);
    this.plane.geometry.dispose();
    this.plane.material.dispose();
  }
}
