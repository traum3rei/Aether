import { useEffect, useRef } from 'react';
import {AetherEngine} from './engine/AetherEngine';

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new AetherEngine(canvas);

    void engine.start();

    return () => {
      engine.dispose();
    };
  }, []);

  return (
    <main className="aether">
      <canvas ref={canvasRef} />

      <div className="aether-mark">
        AETHER
      </div>
    </main>
  );
}