// web/src/sonic/CinematicBackground.tsx
// 深空星河背景（最终定稿版）：
// 十片三层分染星云 + 双旋臂银河 + 呼吸星核 + 流星 + 微尘景深
// 全部自研，未参考任何第三方源码。
import React, { useRef, useMemo, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { AudioFeatures } from '../hooks/useAudioAnalyser';
import { getBackgroundPreset, type BackgroundPresetId } from './background-presets';
import './cinematic.css';

const ZERO_FEATURES: AudioFeatures = {
  subBass: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0,
  presence: 0, brilliance: 0, air: 0,
  warmth: 0.65, brightness: 0.3, sharpness: 0,
  smoothness: 0.7, density: 0, spectralCentroid: 0,
  energy: 0, beat: 0, beatStrength: 0,
};

// 品牌色板（音乐盒子自有：青绿→靛紫→深空蓝 + 玫粉点睛）
const PALETTE = {
  teal: new THREE.Color('#17C3B2'),
  indigo: new THREE.Color('#6366F1'),
  violet: new THREE.Color('#8B5CF6'),
  deep: new THREE.Color('#1E2A78'),
  pink: new THREE.Color('#EC649E'),
};

/** 柔光贴图：径向渐变，用于粒子/星云/光束/星核（比贴图文件省一次请求） */
function makeGlowTexture(size = 128, inner = 0.0, falloff = 1.0): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, size * inner, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25 * falloff, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.6 * falloff, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/** 流星拖尾贴图：横向亮头渐隐 + 纵向柔边 */
function makeStreakTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 32;
  const ctx = c.getContext('2d')!;
  const gx = ctx.createLinearGradient(0, 0, 256, 0);
  gx.addColorStop(0, 'rgba(255,255,255,0)');
  gx.addColorStop(0.55, 'rgba(200,228,255,0.5)');
  gx.addColorStop(0.82, 'rgba(255,255,255,1)');
  gx.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gx;
  ctx.fillRect(0, 0, 256, 32);
  ctx.globalCompositeOperation = 'destination-in';
  const gy = ctx.createLinearGradient(0, 0, 0, 32);
  gy.addColorStop(0, 'rgba(255,255,255,0)');
  gy.addColorStop(0.5, 'rgba(255,255,255,1)');
  gy.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gy;
  ctx.fillRect(0, 0, 256, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

interface SceneProps {
  getFeatures: () => AudioFeatures;
  isPlaying: boolean;
}

/* ══════════════════════════════════════════════════════
   深空星河（nebula）定稿场景
   层次：远景星海 → 三层星云 → 双旋臂银河 → 星核 → 光束
        → 微尘景深 → 流星 → 前景光珠
   ══════════════════════════════════════════════════════ */

const STAR_COUNT = 1300;
const PARTICLE_COUNT = 640;
const ARM_COUNT = 320;
const RAY_COUNT = 4;const DUST_COUNT = 1000;
const METEOR_COUNT = 3;
const ORB_COUNT = 14;

function CinematicScene({ getFeatures, isPlaying }: SceneProps) {
  const { camera } = useThree();

  const assets = useMemo(() => ({
    glow: makeGlowTexture(128),
    soft: makeGlowTexture(256, 0, 1.35),
    streak: makeStreakTexture(),
  }), []);

  // ── 远景星海（球壳分布，冷暖双色温）──
  const starGeo = useMemo(() => {
    const pos = new Float32Array(STAR_COUNT * 3);
    for (let i = 0; i < STAR_COUNT; i++) {
      const r = 90 + Math.random() * 130;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.cos(phi) * 0.6;
      pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);

  const starMatA = useRef<THREE.PointsMaterial>(null);
  const starMatB = useRef<THREE.PointsMaterial>(null);

  // ── 发光粒子流（主银河，椭球分布）──
  const particleSystem = useMemo(() => {
    const home = new Float32Array(PARTICLE_COUNT * 3);
    const pos = new Float32Array(PARTICLE_COUNT * 3);
    const vel = new Float32Array(PARTICLE_COUNT * 3);
    const seed = new Float32Array(PARTICLE_COUNT);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const r = 18 + Math.pow(Math.random(), 0.7) * 40;
      const theta = Math.random() * Math.PI * 2;
      home[i * 3] = Math.cos(theta) * r * 1.35;
      home[i * 3 + 1] = (Math.random() - 0.5) * 34;
      home[i * 3 + 2] = Math.sin(theta) * r * 0.8;
      pos[i * 3] = home[i * 3];
      pos[i * 3 + 1] = home[i * 3 + 1];
      pos[i * 3 + 2] = home[i * 3 + 2];
      seed[i] = Math.random() * Math.PI * 2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return { home, seed, geo: g, pos, vel };
  }, []);
  const particleMatRef = useRef<THREE.PointsMaterial>(null);
  const burstRef = useRef(0);
  const beatEdgeRef = useRef(false);

  // ── 第二旋臂（外环稀疏星流，玫粉微染，本轮新增）──
  const armGeo = useMemo(() => {
    const pos = new Float32Array(ARM_COUNT * 3);
    for (let i = 0; i < ARM_COUNT; i++) {
      const r = 50 + Math.random() * 30;
      const theta = Math.random() * Math.PI * 2;
      pos[i * 3] = Math.cos(theta) * r * 1.35;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 9;
      pos[i * 3 + 2] = Math.sin(theta) * r * 0.85;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);
  const armRef = useRef<THREE.Points>(null);
  const armMatRef = useRef<THREE.PointsMaterial>(null);

  // ── 前景微尘（景深层）──
  const dustGeo = useMemo(() => {
    const pos = new Float32Array(DUST_COUNT * 3);
    for (let i = 0; i < DUST_COUNT; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 140;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 60;
      pos[i * 3 + 2] = -30 + Math.random() * 60;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);
  const dustRef = useRef<THREE.Points>(null);
  const dustMatRef = useRef<THREE.PointsMaterial>(null);

  // ── 星云云团（10 片三层分染：核心青绿 / 中层靛紫 / 外沿玫粉）──
  const nebulaRef = useRef<THREE.Group>(null);
  const nebulae = useMemo(() => {
    const tiers = [
      // 核心层（0-2）：青绿/紫，亮而聚
      { color: PALETTE.teal, baseOpacity: 0.16, spread: 40, zBase: -50 },
      { color: PALETTE.violet, baseOpacity: 0.15, spread: 44, zBase: -55 },
      { color: PALETTE.teal, baseOpacity: 0.13, spread: 38, zBase: -60 },
      // 中层（3-6）：靛紫/深蓝，氛围主体
      { color: PALETTE.indigo, baseOpacity: 0.12, spread: 70, zBase: -65 },
      { color: PALETTE.violet, baseOpacity: 0.11, spread: 76, zBase: -70 },
      { color: PALETTE.deep, baseOpacity: 0.12, spread: 80, zBase: -68 },
      { color: PALETTE.indigo, baseOpacity: 0.1, spread: 72, zBase: -72 },
      // 外沿层（7-9）：玫粉微染 + 深蓝，拉开色域
      { color: PALETTE.pink, baseOpacity: 0.07, spread: 100, zBase: -75 },
      { color: PALETTE.deep, baseOpacity: 0.1, spread: 105, zBase: -78 },
      { color: PALETTE.pink, baseOpacity: 0.06, spread: 95, zBase: -80 },
    ];
    return tiers.map((t) => ({
      pos: [
        (Math.random() - 0.5) * t.spread,
        (Math.random() - 0.5) * t.spread * 0.5,
        t.zBase - Math.random() * 20,
      ] as [number, number, number],
      scale: 70 + t.spread * (0.8 + Math.random() * 0.5),
      rotSpeed: (Math.random() - 0.5) * 0.02,
      baseOpacity: t.baseOpacity,
      color: t.color,
      phase: Math.random() * Math.PI * 2,
    }));
  }, []);

  // ── 星核（银河中心呼吸发光体，本轮新增）──
  const coreRef = useRef<THREE.Mesh>(null);
  const coreHaloRef = useRef<THREE.Mesh>(null);

  // ── 光束（顶部洒落）──
  const raysRef = useRef<THREE.Group>(null);
  const rayMatRef = useRef<THREE.MeshBasicMaterial>(null);

  const camAngleRef = useRef(0);
  const beatShakeRef = useRef(0);

  const getFeaturesRef = useRef(getFeatures);
  getFeaturesRef.current = getFeatures;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  useEffect(() => {
    (camera as THREE.PerspectiveCamera).fov = 55;
    (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
  }, [camera]);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const time = state.clock.elapsedTime;
    const playing = isPlayingRef.current;
    const f = playing ? getFeaturesRef.current() : ZERO_FEATURES;
    const energy = f.energy;
    const beat = f.beat;

    // 节拍边沿检测 → 爆发冲量 + 镜头微震（幅度较上轮 +50%）
    const beatRising = beat > 0.85 && !beatEdgeRef.current;
    beatEdgeRef.current = beat > 0.5;
    if (playing && beatRising) {
      burstRef.current = Math.min(2.2, burstRef.current + 0.75 + f.beatStrength * 1.35);
      beatShakeRef.current = Math.min(1, beatShakeRef.current + f.beatStrength * 0.7);
    }
    burstRef.current = Math.max(0, burstRef.current - dt * 2.2);
    beatShakeRef.current = Math.max(0, beatShakeRef.current - dt * 3.2);
    const burst = burstRef.current;

    // 星海：双层错相闪烁 + 极缓旋转
    if (starMatA.current && starMatB.current) {
      const base = 0.55 + energy * 0.35;
      starMatA.current.opacity = Math.min(1, base + Math.sin(time * 0.9) * 0.14);
      starMatB.current.opacity = Math.min(1, base + Math.sin(time * 1.3 + 2.1) * 0.16);
    }
    starGeo.rotateY(dt * 0.004);

    // 第二旋臂：反向差速旋转，营造银河盘面流动
    if (armRef.current) {
      armRef.current.rotation.y -= dt * (0.012 + energy * 0.03);
    }
    if (armMatRef.current) {
      armMatRef.current.opacity = 0.35 + energy * 0.3 + burst * 0.15;
    }

    // 微尘：反向缓旋 + 视差呼吸
    if (dustRef.current) dustRef.current.rotation.y -= dt * 0.006;
    if (dustMatRef.current) {
      dustMatRef.current.opacity = 0.2 + energy * 0.2 + beat * 0.08;
    }

    // 粒子流：切向漂移 + 回位弹簧 + 节拍径向爆发
    const { pos, vel, home, seed, geo } = particleSystem;
    const dim = playing ? 0.85 + energy * 0.7 : 0.6;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const i3 = i * 3;
      const hx = home[i3], hy = home[i3 + 1], hz = home[i3 + 2];
      vel[i3] += (hx - pos[i3]) * 0.55 * dt;
      vel[i3 + 1] += (hy - pos[i3 + 1]) * 0.55 * dt;
      vel[i3 + 2] += (hz - pos[i3 + 2]) * 0.55 * dt;
      const s = seed[i];
      const flow = (0.5 + energy * 2.4) * (0.6 + 0.4 * Math.sin(s));
      const tx = -hz, tz = hx;
      const len = Math.sqrt(hx * hx + hz * hz) + 0.001;
      vel[i3] += (tx / len) * flow * dt * 6;
      vel[i3 + 2] += (tz / len) * flow * dt * 6;
      if (burst > 0.01) {
        const bx = pos[i3] / len, bz = pos[i3 + 2] / len;
        vel[i3] += bx * burst * 12 * dt * 60 * 0.016;
        vel[i3 + 2] += bz * burst * 12 * dt * 60 * 0.016;
        vel[i3 + 1] += Math.sin(s + time) * burst * 3;
      }
      const damp = 1 - Math.min(0.9, 1.6 * dt);
      vel[i3] *= damp; vel[i3 + 1] *= damp; vel[i3 + 2] *= damp;
      pos[i3] += vel[i3] * dt * 60 * 0.016;
      pos[i3 + 1] += vel[i3 + 1] * dt * 60 * 0.016;
      pos[i3 + 2] += vel[i3 + 2] * dt * 60 * 0.016;
    }
    geo.attributes.position.needsUpdate = true;
    if (particleMatRef.current) {
      particleMatRef.current.size = 1.25 + energy * 1.7 + burst * 0.9;
      particleMatRef.current.opacity = Math.min(0.98, dim);
    }

    // 星云：慢旋 + 能量呼吸
    if (nebulaRef.current) {
      nebulaRef.current.children.forEach((child, i) => {
        const n = nebulae[i];
        child.rotation.z += n.rotSpeed * dt * (1 + energy);
        const mat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
        mat.opacity = n.baseOpacity * (0.75 + Math.sin(time * 0.35 + n.phase) * 0.25) + energy * 0.12;
      });
    }

    // 星核：呼吸脉冲 + 节拍闪亮
    if (coreRef.current && coreHaloRef.current) {
      const breathe = 0.85 + Math.sin(time * 0.6) * 0.15;
      const coreMat = coreRef.current.material as THREE.MeshBasicMaterial;
      const haloMat = coreHaloRef.current.material as THREE.MeshBasicMaterial;
      coreMat.opacity = Math.min(1, (0.55 + energy * 0.3) * breathe + burst * 0.25);
      haloMat.opacity = Math.min(0.5, (0.2 + energy * 0.15) * breathe + burst * 0.12);
      const cs = 1 + Math.sin(time * 0.6) * 0.06 + burst * 0.1;
      coreRef.current.scale.setScalar(6 * cs);
      coreHaloRef.current.scale.set(20 * cs, 20 * cs, 1);
    }

    // 光束：旋转 + 能量脉动
    if (raysRef.current) {
      raysRef.current.rotation.z = time * 0.03 + Math.sin(time * 0.1) * 0.08;
      if (rayMatRef.current) {
        rayMatRef.current.opacity = 0.04 + energy * 0.1 + beat * 0.04;
      }
    }

    // 相机：慢轨道漂移 + 能量推拉（幅度加大）+ 节拍微震
    camAngleRef.current += dt * 0.028 * (1 + energy * 2);
    const angle = camAngleRef.current;
    const radius = 74 - energy * 13 - burst * 3.2;
    const height = 20 + Math.sin(time * 0.14) * 6;
    const shake = beatShakeRef.current;
    camera.position.set(
      Math.cos(angle) * radius + (Math.random() - 0.5) * shake * 1.2,
      height + (Math.random() - 0.5) * shake * 0.9,
      Math.sin(angle) * radius,
    );
    camera.lookAt(0, 0, -6);
  });

  return (
    <>
      {/* 远景星海（双层错相闪烁，冷暖双色温） */}
      <points geometry={starGeo} frustumCulled={false}>
        <pointsMaterial
          ref={starMatA}
          size={0.72}
          sizeAttenuation
          color="#BFD9FF"
          transparent
          opacity={0.6}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
      <points geometry={starGeo} position={[8, -5, -14]} frustumCulled={false}>
        <pointsMaterial
          ref={starMatB}
          size={0.5}
          sizeAttenuation
          color="#E6E0FF"
          transparent
          opacity={0.55}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>

      {/* 三层分染星云 */}
      <group ref={nebulaRef}>
        {nebulae.map((n, i) => (
          <mesh key={i} position={n.pos} rotation={[0, 0, Math.random() * Math.PI]} frustumCulled={false}>
            <planeGeometry args={[n.scale, n.scale * 0.72]} />
            <meshBasicMaterial
              map={assets.soft}
              color={n.color}
              transparent
              opacity={n.baseOpacity}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        ))}
      </group>

      {/* 第二旋臂（外环稀疏星流，玫粉微染） */}
      <points ref={armRef} geometry={armGeo} frustumCulled={false}>
        <pointsMaterial
          ref={armMatRef}
          map={assets.glow}
          size={0.55}
          sizeAttenuation
          color="#F0B8DC"
          transparent
          opacity={0.4}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>

      {/* 星核（银河中心呼吸发光体） */}
      <mesh ref={coreHaloRef} position={[0, 0, -8]} scale={[20, 20, 1]} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={assets.soft} color={PALETTE.indigo} transparent opacity={0.2} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh ref={coreRef} position={[0, 0, -8]} scale={[6, 6, 1]} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={assets.glow} color="#9FE8FF" transparent opacity={0.55} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>

      {/* 发光粒子银河 */}
      <points geometry={particleSystem.geo} frustumCulled={false}>
        <pointsMaterial
          ref={particleMatRef}
          map={assets.glow}
          size={1.25}
          sizeAttenuation
          color="#9FE8FF"
          transparent
          opacity={0.85}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>

      {/* 前景微尘景深层 */}
      <points ref={dustRef} geometry={dustGeo} frustumCulled={false}>
        <pointsMaterial
          ref={dustMatRef}
          size={0.26}
          sizeAttenuation
          color="#A8C4F0"
          transparent
          opacity={0.22}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>

      {/* 顶部光束 */}
      <group ref={raysRef} position={[0, 26, -30]}>
        {Array.from({ length: RAY_COUNT }).map((_, i) => (
          <mesh key={i} position={[(i - 1.5) * 26, 14, 0]} rotation={[0, 0, 0.32 + i * 0.1]} frustumCulled={false}>
            <planeGeometry args={[7 + i * 2.5, 85]} />
            <meshBasicMaterial
              ref={i === 0 ? rayMatRef : undefined}
              map={assets.soft}
              color={i % 2 ? PALETTE.teal : PALETTE.indigo}
              transparent
              opacity={0.04}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        ))}
      </group>

      {/* 周期性流星（3 条） */}
      <ShootingStars streak={assets.streak} />
      {/* 前景漂浮光珠 */}
      <FloatOrbs glow={assets.glow} />
    </>
  );
}

/** 流星拖尾：随机间隔划过，亮头渐隐尾迹 */
function ShootingStars({ streak }: { streak: THREE.Texture }) {
  const groupRef = useRef<THREE.Group>(null);
  const matsRef = useRef<THREE.MeshBasicMaterial[]>([]);
  const meteors = useMemo(() =>
    Array.from({ length: METEOR_COUNT }, (_, i) => ({
      wait: 1 + i * 2.5 + Math.random() * 4,
      p: -1, // -1 = 等待中
      sx: 0, sy: 0,
    })), []);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    if (!groupRef.current) return;
    groupRef.current.children.forEach((child, i) => {
      const m = meteors[i];
      const mat = matsRef.current[i];
      if (m.p < 0) {
        m.wait -= dt;
        if (m.wait <= 0) {
          m.p = 0;
          m.sx = -45 + Math.random() * 90;
          m.sy = 16 + Math.random() * 26;
        }
        if (mat) mat.opacity = 0;
        return;
      }
      m.p += dt / 1.3;
      if (m.p >= 1) {
        m.p = -1;
        m.wait = 3 + Math.random() * 8;
        if (mat) mat.opacity = 0;
        return;
      }
      const L = 36;
      child.position.set(m.sx + m.p * L, m.sy - m.p * L * 0.42, -22);
      child.rotation.z = Math.atan2(-0.42, 1);
      if (mat) mat.opacity = Math.sin(Math.PI * m.p) * 0.9;
    });
  });

  return (
    <group ref={groupRef}>
      {meteors.map((_, i) => (
        <mesh key={i} frustumCulled={false}>
          <planeGeometry args={[17, 0.7]} />
          <meshBasicMaterial
            ref={(mm) => { if (mm) matsRef.current[i] = mm; }}
            map={streak}
            transparent
            opacity={0}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}
    </group>
  );
}

/** 前景漂浮光珠：少量大颗，缓慢上下沉浮（不依赖音频，保持氛围恒定） */
function FloatOrbs({ glow }: { glow: THREE.Texture }) {
  const groupRef = useRef<THREE.Group>(null);
  const matsRef = useRef<THREE.MeshBasicMaterial[]>([]);
  const seeds = useMemo(() =>
    Array.from({ length: ORB_COUNT }, () => ({
      x: (Math.random() - 0.5) * 90,
      y: (Math.random() - 0.5) * 40,
      z: -10 - Math.random() * 40,
      speed: 0.2 + Math.random() * 0.5,
      phase: Math.random() * Math.PI * 2,
      scale: 1.6 + Math.random() * 2.6,
    })), []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (!groupRef.current) return;
    groupRef.current.children.forEach((child, i) => {
      const s = seeds[i];
      child.position.y = s.y + Math.sin(t * s.speed + s.phase) * 4.5;
      const mat = matsRef.current[i];
      if (mat) {
        mat.opacity = 0.24 + Math.sin(t * s.speed * 0.8 + s.phase) * 0.1;
      }
    });
  });

  return (
    <group ref={groupRef}>
      {seeds.map((s, i) => (
        <mesh key={i} position={[s.x, s.y, s.z]} scale={s.scale} frustumCulled={false}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            ref={(m) => { if (m) matsRef.current[i] = m; }}
            map={glow}
            color={i % 3 === 0 ? PALETTE.teal : i % 3 === 1 ? PALETTE.violet : PALETTE.indigo}
            transparent
            opacity={0.24}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}
    </group>
  );
}

/* ══════════════════════════════════════════════════════
   背景调度中枢
   ══════════════════════════════════════════════════════ */

interface CinematicBackgroundProps {
  getFeatures: () => AudioFeatures;
  isPlaying: boolean;
  presetId?: BackgroundPresetId;
}

export const CinematicBackground: React.FC<CinematicBackgroundProps> = ({ getFeatures, isPlaying }) => {
  const def = getBackgroundPreset('nebula');

  return (
    <div className="cinematic-background">
      <Canvas
        camera={def.camera}
        dpr={[1, 1.75]}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        frameloop="always"
        style={{ background: 'transparent' }}
      >
        <CinematicScene getFeatures={getFeatures} isPlaying={isPlaying} />
      </Canvas>
      {/* CSS 层：暗角 + 底部渐隐 + 胶片颗粒，保证前景可读性与质感 */}
      <div className="cinematic-vignette" />
      <div className="cinematic-floor-fade" />
      <div className="cinematic-grain" />
    </div>
  );
};
