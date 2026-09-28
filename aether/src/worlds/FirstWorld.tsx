import * as THREE from 'three/webgpu';

export class FirstWorld {
  private readonly particles: THREE.Points;
  private readonly positions: Float32Array;

  constructor(scene: THREE.Scene) {
    const count = 20_000;

    this.positions = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;

      const radius = Math.pow(Math.random(), 0.5) * 1.5;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(
        2 * Math.random() - 1,
      );

      this.positions[i3] =
        Math.sin(phi) *
        Math.cos(theta) *
        radius;

      this.positions[i3 + 1] =
        Math.sin(phi) *
        Math.sin(theta) *
        radius;

      this.positions[i3 + 2] =
        Math.cos(phi) *
        radius;
    }

    const geometry = new THREE.BufferGeometry();

    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(
        this.positions,
        3,
      ),
    );

    const material = new THREE.PointsNodeMaterial({
      color: 0xffffff,
      size: 0.025,
      sizeAttenuation: true,
    });

    this.particles = new THREE.Points(
      geometry,
      material,
    );

    scene.add(this.particles);
  }

  update(time: number) {
  const position = this.particles.geometry.getAttribute('position');

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);

    const angle =
      Math.sin(y * 2.0 + time * 0.5) +
      Math.cos(z * 2.0 + time * 0.3);

    const forceX = Math.cos(angle) * 0.002;
    const forceY = Math.sin(angle) * 0.002;
    const forceZ =
      Math.sin(x * 2.0 + time * 0.4) * 0.002;

    position.setXYZ(
      i,
      x + forceX,
      y + forceY,
      z + forceZ,
    );
  }

  position.needsUpdate = true;
}

  dispose() {
    this.particles.geometry.dispose();
    const material = this.particles.material;

if (Array.isArray(material)) {
  material.forEach((m) => m.dispose());
} else {
  material.dispose();
}
  }
}