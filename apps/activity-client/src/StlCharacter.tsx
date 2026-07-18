import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import type { CharacterState } from '@miq/pachinko-shared';
import modelUrl from './assets/models/tripo-character.stl?url';
import projectionTextureUrl from './assets/models/tripo-front-projection.webp';
import fallbackImage from './assets/standee-cutout.png';

export default function StlCharacter({ state }: { state: CharacterState }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || error) return;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 100);
    camera.position.set(0, 0.05, 4.1);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch {
      setError('この端末では3D表示を開始できません。');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    let disposed = false;
    const projectionTexture = new THREE.TextureLoader().load(
      projectionTextureUrl,
      undefined,
      undefined,
      () => {
        if (!disposed) setError('投影テクスチャを読み込めませんでした。');
      },
    );
    projectionTexture.flipY = true;
    projectionTexture.colorSpace = THREE.SRGBColorSpace;
    projectionTexture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 4);

    const group = new THREE.Group();
    scene.add(group);
    let mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null = null;
    new STLLoader().load(
      modelUrl,
      (geometry) => {
        if (disposed) return geometry.dispose();
        const position = geometry.getAttribute('position');
        if (!position || position.itemSize !== 3 || position.count % 3 !== 0) {
          geometry.dispose();
          setError('STLモデルの頂点データが不正です。');
          return;
        }
        const triangles = position.count / 3;
        if (!Number.isFinite(triangles) || triangles <= 0 || triangles > 50_000) {
          geometry.dispose();
          setError('STLモデルが表示上限を超えています。');
          return;
        }
        if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
        geometry.computeBoundingBox();
        const bounds = geometry.boundingBox;
        if (!bounds) {
          geometry.dispose();
          setError('STLモデルの大きさを取得できません。');
          return;
        }
        const center = bounds.getCenter(new THREE.Vector3());
        const size = bounds.getSize(new THREE.Vector3());
        const maxDimension = Math.max(size.x, size.y, size.z);
        if (![size.x, size.y, maxDimension].every((value) => Number.isFinite(value) && value > 0.000_001)) {
          geometry.dispose();
          setError('STLモデルの寸法が不正です。');
          return;
        }
        const uv = new Float32Array(position.count * 2);
        const projectionAspectCorrection = 0.972;
        for (let index = 0; index < position.count; index += 1) {
          const normalizedX = (position.getX(index) - bounds.min.x) / size.x;
          uv[index * 2] = THREE.MathUtils.clamp(0.5 + (normalizedX - 0.5) * projectionAspectCorrection, 0, 1);
          uv[index * 2 + 1] = THREE.MathUtils.clamp((position.getY(index) - bounds.min.y) / size.y, 0, 1);
        }
        geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        geometry.translate(-center.x, -center.y, -center.z);
        const material = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          map: projectionTexture,
        });
        mesh = new THREE.Mesh(geometry, material);
        mesh.scale.setScalar(2.75 / maxDimension);
        group.add(mesh);
      },
      undefined,
      () => {
        if (!disposed) setError('STLモデルを読み込めませんでした。');
      },
    );

    const resize = () => {
      const width = Math.min(Math.max(host.clientWidth, 1), 1_920);
      const height = Math.min(Math.max(host.clientHeight, 1), 1_080);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    resize();

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const clock = new THREE.Clock();
    let lastFrame = 0;
    let smoothY = 0;
    let smoothRotationY = 0;
    let smoothRotationZ = 0;
    let smoothScale = 1;
    renderer.setAnimationLoop(() => {
      if (document.hidden) return;
      const elapsed = clock.getElapsedTime();
      const phase = stateRef.current.phase;
      const fps = reducedMotion.matches ? 5 : phase === 'idle' ? 20 : 30;
      if (elapsed - lastFrame < 1 / fps) return;
      lastFrame = elapsed;
      const motion = reducedMotion.matches ? 0 : 1;
      const speed = phase === 'speaking' ? 3.4 : phase === 'listening' ? 2.1 : 1;
      const targetY = Math.sin(elapsed * speed) * (phase === 'speaking' ? 0.018 : 0.025) * motion;
      const targetRotationY = Math.sin(elapsed * 0.55) * 0.02 * motion;
      const targetRotationZ = phase === 'thinking'
        ? 0.04 * motion
        : Math.sin(elapsed * (phase === 'listening' ? 1.5 : 0.7)) * (phase === 'listening' ? 0.014 : 0.008) * motion;
      const targetScale = phase === 'speaking' ? 1 + Math.sin(elapsed * 4.2) * 0.012 * motion : 1;
      smoothY = THREE.MathUtils.lerp(smoothY, targetY, 0.12);
      smoothRotationY = THREE.MathUtils.lerp(smoothRotationY, targetRotationY, 0.12);
      smoothRotationZ = THREE.MathUtils.lerp(smoothRotationZ, targetRotationZ, 0.12);
      smoothScale = THREE.MathUtils.lerp(smoothScale, targetScale, 0.12);
      group.position.y = smoothY;
      group.rotation.y = smoothRotationY;
      group.rotation.z = smoothRotationZ;
      group.scale.setScalar(smoothScale);
      renderer.render(scene, camera);
    });
    const onContextLost = (event: Event) => {
      event.preventDefault();
      renderer.setAnimationLoop(null);
      setError('3D表示が停止したため、再読み込みしてください。');
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.setAnimationLoop(null);
      mesh?.geometry.dispose();
      mesh?.material.dispose();
      projectionTexture.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [error]);

  return (
    <main className={`stl-stage phase-${state.phase} emotion-${state.emotion}`} data-character-phase={state.phase}>
      {error ? (
        <div className="model-fallback">
          <img src={fallbackImage} alt="3D表示に失敗したため表示している仮キャラクター" />
          <p className="model-error">{error}</p>
        </div>
      ) : (
        <div ref={hostRef} className="stl-viewport" aria-label={`3D STL character is ${state.phase}`} />
      )}
    </main>
  );
}
