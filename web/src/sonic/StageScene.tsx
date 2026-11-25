// web/src/sonic/StageScene.tsx
// 沉浸舞台 · 粒子场景 + 节奏驱动电影镜头（CameraRig）— 自研实现
// 本轮打磨：柔光粒子贴图 / 节拍冲击波环 / 景深星野 / 低音星核
//          / 高光层点亮逻辑 / 平滑噪声镜头摇晃 + 滚转
import React, { useRef, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { StagePreset } from './stage-presets';
import type { AudioFeatures } from '../hooks/useAudioAnalyser';

const ZERO_FEATURES: AudioFeatures = {
  subBass: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0,
  presence: 0, brilliance: 0, air: 0,
  warmth: 0.6, brightness: 0.3, sharpness: 0,
  smoothness: 0.7, density: 0, spectralCentroid: 0,
  energy: 0, beat: 0, beatStrength: 0,
};

/** 柔光贴图：径向渐变 sprite（粒子从"方点"变"光点"的关键） */
function makeGlowTexture(size = 128): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.16)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/** 按形态生成粒子初始分布 */
function buildFormation(formation: string, count: number): Float32Array {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    if (formation === 'sphere') {
      // 球状星云：高斯分布聚在核心，外围稀疏
      const r = 3 + Math.pow(Math.random(), 1.8) * 12;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      pos[i3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i3 + 1] = r * Math.cos(phi) * 0.75;
      pos[i3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    } else if (formation === 'river') {
      // 银河盘面：扁平旋臂带
      const arm = i % 2;
      const t = Math.random();
      const r = 2 + t * 20;
      const angle = t * 4.5 + arm * Math.PI + (Math.random() - 0.5) * 0.7;
      pos[i3] = Math.cos(angle) * r + (Math.random() - 0.5) * 3;
      pos[i3 + 1] = (Math.random() - 0.5) * (1.5 + (1 - t) * 2);
      pos[i3 + 2] = Math.sin(angle) * r + (Math.random() - 0.5) * 3;
    } else if (formation === 'ring') {
      // 天体环带：环面分布
      const angle = Math.random() * Math.PI * 2;
      const r = 14 + (Math.random() - 0.5) * 5;
      pos[i3] = Math.cos(angle) * r;
      pos[i3 + 1] = (Math.random() - 0.5) * 1.2 + Math.sin(angle * 3) * 0.5;
      pos[i3 + 2] = Math.sin(angle) * r;
    } else {
      // cloud：稀疏扁平微尘
      pos[i3] = (Math.random() - 0.5) * 40;
      pos[i3 + 1] = (Math.random() - 0.5) * 12;
      pos[i3 + 2] = (Math.random() - 0.5) * 40;
    }
  }
  return pos;
}

/** 景深星野：远处球壳星点，给场景纵深 */
const STARFIELD_COUNT = 320;
function Starfield() {
  const ref = useRef<THREE.Points>(null);
  const matRef = useRef<THREE.PointsMaterial>(null);
  const glow = useMemo(() => makeGlowTexture(64), []);
  const geo = useMemo(() => {
    const pos = new Float32Array(STARFIELD_COUNT * 3);
    for (let i = 0; i < STARFIELD_COUNT; i++) {
      const r = 55 + Math.random() * 55;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.cos(phi) * 0.7;
      pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);
  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    if (ref.current) ref.current.rotation.y += dt * 0.004;
    if (matRef.current) {
      matRef.current.opacity = 0.4 + Math.sin(state.clock.elapsedTime * 0.7) * 0.08;
    }
  });
  return (
    <points ref={ref} geometry={geo} frustumCulled={false}>
      <pointsMaterial
        ref={matRef}
        map={glow}
        size={0.5}
        sizeAttenuation
        color="#BFD0F5"
        transparent
        opacity={0.4}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </points>
  );
}

/** 节拍冲击波环：重拍瞬间从中心扩散的光环（始终朝向相机） */
const RING_COUNT = 3;
function BeatRings({ getFeatures, isPlaying, color }: {
  getFeatures: () => AudioFeatures; isPlaying: boolean; color: THREE.Color;
}) {
  const { camera } = useThree();
  const meshesRef = useRef<THREE.Mesh[]>([]);
  const rings = useRef(Array.from({ length: RING_COUNT }, () => ({
    t: 2, active: false, strength: 1,
  })));
  const edgeRef = useRef(false);
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  useFrame((_state, delta) => {
    const dt = Math.min(delta, 0.05);
    const f = isPlayingRef.current ? getFeatures() : ZERO_FEATURES;
    const rising = f.beat > 0.9 && !edgeRef.current;
    edgeRef.current = f.beat > 0.5;
    if (isPlayingRef.current && rising) {
      // 取最"旧"的环复用
      const oldest = rings.current.reduce((a, b) => (a.t > b.t ? a : b));
      oldest.t = 0;
      oldest.active = true;
      oldest.strength = 0.55 + f.beatStrength * 0.5;
    }
    rings.current.forEach((s, i) => {
      const mesh = meshesRef.current[i];
      if (!mesh) return;
      if (!s.active) { mesh.visible = false; return; }
      s.t += dt / 1.15;
      if (s.t >= 1) { s.active = false; mesh.visible = false; return; }
      mesh.visible = true;
      const ease = 1 - Math.pow(1 - s.t, 2.2); // 先快后慢扩散
      const radius = 2.5 + ease * 26;
      mesh.scale.set(radius, radius, 1);
      mesh.quaternion.copy(camera.quaternion); // 始终面向镜头
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = (1 - s.t) * 0.4 * s.strength;
    });
  });

  return (
    <>
      {Array.from({ length: RING_COUNT }).map((_, i) => (
        <mesh
          key={i}
          ref={(m) => { if (m) meshesRef.current[i] = m; }}
          visible={false}
          frustumCulled={false}
        >
          <ringGeometry args={[0.94, 1, 72]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0}
            side={THREE.DoubleSide}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </mesh>
      ))}
    </>
  );
}

interface StageParticlesProps {
  preset: StagePreset;
  getFeatures: () => AudioFeatures;
  isPlaying: boolean;
  longContent: boolean;
  densityScale: number;
}

function StageParticles({ preset, getFeatures, isPlaying, longContent, densityScale }: StageParticlesProps) {
  const count = Math.max(120, Math.floor(preset.particleCount * densityScale));
  const matRef = useRef<THREE.PointsMaterial>(null);
  const peakMatRef = useRef<THREE.PointsMaterial>(null);
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const presetRef = useRef(preset);
  presetRef.current = preset;
  const longRef = useRef(longContent);
  longRef.current = longContent;
  const beatEdgeRef = useRef(false);
  const glow = useMemo(() => makeGlowTexture(128), []);
  const peakColor = useMemo(() => new THREE.Color(...preset.peakColor), [preset]);

  const { positionAttr, geometry, peakGeometry, basePos, velocities, positions } = useMemo(() => {
    const positions = buildFormation(preset.formation, count);
    const basePos = positions.slice();
    const velocities = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const cA = new THREE.Color(...preset.colorA);
    const cB = new THREE.Color(...preset.colorB);
    const tmp = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const mix = (i * 0.618033) % 1; // 黄金比例取混色，分布均匀
      tmp.copy(cA).lerp(cB, mix);
      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    }
    // 主/高光两层共享同一 position attribute：一次更新，两层同步
    const positionAttr = new THREE.BufferAttribute(positions, 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', positionAttr);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const peakGeometry = new THREE.BufferGeometry();
    peakGeometry.setAttribute('position', positionAttr);
    return { basePos, velocities, positionAttr, geometry, peakGeometry, positions };
  }, [preset, count]);

  useMemo(() => () => { geometry.dispose(); peakGeometry.dispose(); }, [geometry, peakGeometry]);

  useFrame((state, rawDelta) => {
    const mat = matRef.current;
    const peakMat = peakMatRef.current;
    if (!mat || !peakMat) return;
    const dt = Math.min(rawDelta, 0.05);
    const p = presetRef.current;
    const f = isPlayingRef.current ? getFeatures() : ZERO_FEATURES;
    const lc = longRef.current ? 0.5 : 1;
    const time = state.clock.elapsedTime;

    // 节拍上升沿 → 爆发冲量
    const beatRising = f.beat > 0.9 && !beatEdgeRef.current;
    beatEdgeRef.current = f.beat > 0.5;

    const burst = p.burst * lc * (f.beatStrength || 0.6);
    const turb = p.turbulence * (0.4 + f.energy * 1.2);
    const swirl = p.swirl * (0.4 + f.energy) * lc;
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      // 环绕流场：绕 Y 轴角速度（半径越外越慢，模拟差速旋转）
      const x = positions[i3], z = positions[i3 + 2];
      const r2 = x * x + z * z + 1;
      const angVel = (swirl * 6) / Math.sqrt(r2);
      const cosA = Math.cos(angVel * dt), sinA = Math.sin(angVel * dt);
      let nx = x * cosA - z * sinA;
      let nz = x * sinA + z * cosA;

      // 湍流：低频正弦扰动
      const t1 = Math.sin(time * 0.7 + i3 * 0.37) * turb * dt;
      const t2 = Math.cos(time * 0.5 + i3 * 0.61) * turb * dt;
      let ny = positions[i3 + 1] + t1 * 1.4;
      nx += t2; nz += t1;

      // 节拍爆发：径向冲量（隔一迸一，爆发感更强且不全屏闪烁）
      if (beatRising && i % 2 === 0) {
        const inv = 1 / Math.sqrt(r2);
        velocities[i3] += nx * inv * burst * 18;
        velocities[i3 + 2] += nz * inv * burst * 18;
        velocities[i3 + 1] += (Math.random() - 0.3) * burst * 6;
      }
      // 回归基点（弹簧）+ 漂移
      const returnRate = Math.min(1, (1.4 - p.drift * 0.5) * dt);
      nx += (basePos[i3] + Math.sin(time * 0.2 + i3 * 0.11) * p.drift * 2.5 - positions[i3]) * returnRate + velocities[i3] * dt;
      ny += (basePos[i3 + 1] - positions[i3 + 1]) * returnRate + velocities[i3 + 1] * dt;
      nz += (basePos[i3 + 2] + Math.cos(time * 0.17 + i3 * 0.13) * p.drift * 2.5 - positions[i3 + 2]) * returnRate + velocities[i3 + 2] * dt;
      // 速度衰减
      velocities[i3] *= 0.94; velocities[i3 + 1] *= 0.94; velocities[i3 + 2] *= 0.94;

      positions[i3] = nx; positions[i3 + 1] = ny; positions[i3 + 2] = nz;
    }
    positionAttr.needsUpdate = true;

    // 材质：能量驱动透明度，节拍闪现
    const baseOpacity = (0.45 + f.energy * 0.85) * p.glow;
    mat.opacity = Math.min(1, baseOpacity);
    mat.size = p.particleSize * (1 + f.beat * 0.3);
    // 高光层：常亮微光 + 节拍点亮 + 缓慢闪烁（像舞台追光不是爆闪）
    peakMat.opacity = Math.min(0.85, 0.1 + f.beat * 0.7 + Math.sin(time * 6.3) * 0.04);
    peakMat.size = p.particleSize * (1.9 + f.beat * 0.9);
  });

  return (
    <>
      <points geometry={geometry} frustumCulled={false}>
        <pointsMaterial
          ref={matRef}
          map={glow}
          vertexColors
          transparent
          opacity={0.6}
          size={preset.particleSize}
          sizeAttenuation
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </points>
      {/* 节拍高光层：peakColor 追光，与主层共享位置 */}
      <points geometry={peakGeometry} frustumCulled={false}>
        <pointsMaterial
          ref={peakMatRef}
          map={glow}
          color={peakColor}
          transparent
          opacity={0}
          size={preset.particleSize * 1.9}
          sizeAttenuation
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </points>
    </>
  );
}

/** 节奏驱动电影镜头：环绕 + 能量推拉 + 呼吸 + 平滑节拍摇晃/滚转/FOV 冲击 */
function CameraRig({ preset, getFeatures, isPlaying, longContent }: {
  preset: StagePreset; getFeatures: () => AudioFeatures; isPlaying: boolean; longContent: boolean;
}) {
  const { camera } = useThree();
  const angleRef = useRef(0);
  const fovRef = useRef(preset.camera.fov);
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const presetRef = useRef(preset);
  presetRef.current = preset;
  const longRef = useRef(longContent);
  longRef.current = longContent;

  useFrame((state, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05);
    const p = presetRef.current;
    const f = isPlayingRef.current ? getFeatures() : ZERO_FEATURES;
    const lc = longRef.current ? 0.5 : 1;
    const time = state.clock.elapsedTime;

    // 环绕：能量越高转越快
    angleRef.current += p.camera.orbitSpeed * (0.5 + f.energy * 1.6) * lc * dt;
    const angle = angleRef.current;

    // 推拉：半径随能量与低音呼吸（低音下潜感）
    const bassPush = Math.max(f.bass, f.subBass * 0.7);
    const dolly = 1 - (f.energy * 0.3 + bassPush * 0.18 + 0.5 * (1 + Math.sin(time * p.camera.dollySpeed)) * 0.5) * p.camera.dollyAmp * lc;
    const r = p.camera.radius * dolly;

    // 平滑节拍摇晃：多频正弦叠加替代逐帧随机（毛躁→电影感手持）
    const shake = (f.beat * f.beat) * p.camera.shakeAmp * lc;
    const sx = (Math.sin(time * 31.7) * 0.45 + Math.sin(time * 47.3 + 1.7) * 0.3) * shake;
    const sy = (Math.sin(time * 37.1 + 0.9) * 0.45 + Math.sin(time * 53.9) * 0.3) * shake;

    camera.position.set(
      Math.cos(angle) * r + sx,
      p.camera.lift + Math.sin(time * 0.8) * p.camera.breatheAmp * (0.5 + f.energy) + sy,
      Math.sin(angle) * r + sx,
    );
    // 注视点随能量轻微游移，构图更有机
    camera.lookAt(Math.sin(time * 0.23) * 1.5, Math.sin(time * 0.31) * 1.2, 0);
    // 镜头滚转：缓慢倾斜 + 节拍轻晃
    camera.rotation.z += Math.sin(time * 0.11) * 0.022 * (1 + f.energy) + Math.sin(time * 41.3) * shake * 0.012;

    // 节拍 FOV 冲击（急推感，平滑收敛）
    const cam = camera as THREE.PerspectiveCamera;
    fovRef.current += ((p.camera.fov - f.beat * 6) - fovRef.current) * Math.min(1, dt * 10);
    if (Math.abs(cam.fov - fovRef.current) > 0.01) {
      cam.fov = fovRef.current;
      cam.updateProjectionMatrix();
    }
  });
  return null;
}

interface StageSceneProps {
  preset: StagePreset;
  getFeatures: () => AudioFeatures;
  isPlaying: boolean;
  longContent: boolean;
  densityScale: number;
}

export const StageScene: React.FC<StageSceneProps> = ({ preset, getFeatures, isPlaying, longContent, densityScale }) => {
  const peakColor = useMemo(() => new THREE.Color(...preset.peakColor), [preset]);
  // 背景色由容器 CSS 渐变呈现，Canvas 保持透明叠加
  return (
    <Canvas
      camera={{ fov: preset.camera.fov, position: [0, preset.camera.lift, preset.camera.radius], near: 0.1, far: 200 }}
      dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      style={{ background: 'transparent', position: 'absolute', inset: 0 }}
    >
      <Starfield />
      <CameraRig preset={preset} getFeatures={getFeatures} isPlaying={isPlaying} longContent={longContent} />
      <StageParticles preset={preset} getFeatures={getFeatures} isPlaying={isPlaying} longContent={longContent} densityScale={densityScale} />
      <BeatRings getFeatures={getFeatures} isPlaying={isPlaying} color={peakColor} />
    </Canvas>
  );
};
