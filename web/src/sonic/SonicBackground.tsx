// web/src/sonic/SonicBackground.tsx
// 音域回响 3D 背景 — 完整实现：柱网格 + 波纹 + 流星 + 闲置波
import React, { useRef, useMemo, useEffect, useState, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { vertexShader, fragmentShader } from './shaders';
import { SONIC_THEMES, SonicTheme, matchTheme } from './themes';
import { METEOR_TRIGGER_RANGE } from '../hooks/useAudioAnalyser';
import type { AudioFeatures } from '../hooks/useAudioAnalyser';

// 零值特征（暂停时使用，确保柱子静止）
const ZERO_FEATURES: AudioFeatures = {
  subBass: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0,
  presence: 0, brilliance: 0, air: 0,
  warmth: 0.65, brightness: 0.3, sharpness: 0,
  smoothness: 0.7, density: 0, spectralCentroid: 0,
  energy: 0, beat: 0, beatStrength: 0,
};

const GRID_SIZE = 160;
const WORLD_SIZE = 400; // 继续增大铺满底部
const BAR_SPACING = WORLD_SIZE / GRID_SIZE;
const BAR_WIDTH = BAR_SPACING * 0.857;
const HALF_EXTENT = WORLD_SIZE / 2;
const MAX_RIPPLES = 10;
const MAX_METEORS = 20;
const MAX_PARTICLES = 200;

// --- Ripple 数据结构 ---
interface Ripple {
  pos: THREE.Vector2;
  time: number;
  strength: number;
  isActive: number;
  rippleType: number;
}

// --- Meteor 数据结构 ---
interface Meteor {
  active: boolean;
  x: number; y: number; z: number;
  speed: number;
  strength: number;
}

interface Particle {
  active: boolean;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; maxLife: number;
  scale: number;
}

// --- 场景组件 ---
interface SceneProps {
  getFeatures: () => AudioFeatures;
  updateFeatures: () => AudioFeatures;
  getFrequencyData: () => Uint8Array;
  themeKey: string;
  isPlaying: boolean;
  /** 降低渲染频率（3D tab 激活时释放 GPU） */
  paused?: boolean;
}

function SonicScene({ getFeatures, updateFeatures, getFrequencyData, themeKey, isPlaying, paused = false }: SceneProps) {
  const { camera, scene } = useThree();
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const meteorMeshRef = useRef<THREE.InstancedMesh>(null);
  const meteorMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const particleMeshRef = useRef<THREE.InstancedMesh>(null);

  const clockRef = useRef<THREE.Clock>(new THREE.Clock());
  const ripplesRef = useRef<Ripple[]>([]);
  const meteorsRef = useRef<Meteor[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const idleIntensityRef = useRef(0);
  const lastIdleTimeRef = useRef(0);
  const meteorCooldownRef = useRef(0);
  const clusterCenterRef = useRef<{ x: number; z: number; count: number }>({ x: 0, z: 0, count: 0 });
  const beatActiveRef = useRef(false); // 节拍边沿检测：当前是否处于节拍脉冲中

  // ★ 通过 updateFeatures 在 useFrame 中同步分析音频
  const updateFeaturesRef = useRef(updateFeatures);
  updateFeaturesRef.current = updateFeatures;
  const getFeaturesRef = useRef(getFeatures);
  getFeaturesRef.current = getFeatures;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  // 当前主题 & 目标主题（用于平滑过渡）
  const currentThemeRef = useRef<SonicTheme>(SONIC_THEMES[themeKey] || SONIC_THEMES.nocturnal);
  const targetThemeRef = useRef<SonicTheme>(SONIC_THEMES[themeKey] || SONIC_THEMES.nocturnal);

  // 初始化 ripples
  useEffect(() => {
    ripplesRef.current = Array.from({ length: MAX_RIPPLES }, () => ({
      pos: new THREE.Vector2(),
      time: -100,
      strength: 0,
      isActive: 0,
      rippleType: 0,
    }));
    meteorsRef.current = Array.from({ length: MAX_METEORS }, () => ({
      active: false, x: 0, y: -1000, z: 0, speed: 0, strength: 0,
    }));
    particlesRef.current = Array.from({ length: MAX_PARTICLES }, () => ({
      active: false, x: 0, y: -1000, z: 0, vx: 0, vy: 0, vz: 0,
      life: 0, maxLife: 1, scale: 1,
    }));
  }, []);

  // 主题切换（只更新 ref，不重建 uniforms）
  useEffect(() => {
    const theme = SONIC_THEMES[themeKey];
    if (theme) {
      targetThemeRef.current = theme;
    }
  }, [themeKey]);

  // 初始化实例矩阵
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    let index = 0;
    for (let x = 0; x < GRID_SIZE; x++) {
      for (let z = 0; z < GRID_SIZE; z++) {
        const posX = x * BAR_SPACING - HALF_EXTENT;
        const posZ = z * BAR_SPACING - HALF_EXTENT;
        matrix.makeTranslation(posX, 0.5, posZ);
        mesh.setMatrixAt(index, matrix);
        index++;
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, []);

  // 设置相机
  useEffect(() => {
    // 底部区域视角：斜上方俯视
    camera.position.set(0, 45, 70);
    camera.lookAt(0, 0, 0);
    (camera as THREE.PerspectiveCamera).fov = 60;
    (camera as THREE.PerspectiveCamera).updateProjectionMatrix();

    // 无雾，背景图完全可见
    scene.fog = null;
    scene.background = null;
  }, [camera, scene]);

  // --- 波纹触发 ---
  const triggerRipple = useCallback((x: number, z: number, strength: number, isWhite: boolean = false) => {
    const ripples = ripplesRef.current;
    // 找到最旧的槽
    let oldestIdx = 0;
    let oldestTime = Infinity;
    for (let i = 0; i < ripples.length; i++) {
      if (ripples[i].time < oldestTime) {
        oldestTime = ripples[i].time;
        oldestIdx = i;
      }
    }
    const r = ripples[oldestIdx];
    r.pos.set(x, z);
    r.time = clockRef.current.getElapsedTime();
    r.strength = Math.min(strength, 8);
    r.isActive = 1;
    r.rippleType = isWhite ? 1 : 0;
  }, []);

  // --- 流星触发 ---
  const triggerMeteor = useCallback((strength: number) => {
    const meteors = meteorsRef.current;
    let idx = -1;
    for (let i = 0; i < meteors.length; i++) {
      if (!meteors[i].active) { idx = i; break; }
    }
    if (idx < 0) return;
    const angle = Math.random() * Math.PI * 2;
    const radius = 10 + Math.random() * 35;
    const m = meteors[idx];
    m.active = true;
    m.x = Math.cos(angle) * radius;
    m.z = Math.sin(angle) * radius;
    m.y = 30 + Math.random() * 10;
    m.speed = 1 + Math.random() * 0.5 + strength * 2.5;
    m.strength = strength;
  }, []);

  // --- 粒子触发 ---
  const triggerParticles = useCallback((x: number, y: number, z: number, meteorSpeed: number) => {
    const particles = particlesRef.current;
    for (let i = 0; i < 10; i++) {
      let idx = -1;
      for (let j = 0; j < particles.length; j++) {
        if (!particles[j].active) { idx = j; break; }
      }
      if (idx < 0) break;
      const p = particles[idx];
      p.active = true;
      p.x = x; p.y = y; p.z = z;
      p.vx = (Math.random() - 0.5) * 2;
      p.vy = Math.random() * 2 + meteorSpeed * 10;
      p.vz = (Math.random() - 0.5) * 2;
      p.life = 0;
      p.maxLife = 0.5 + Math.random() * 0.5;
      p.scale = 0.2 + Math.random() * 0.6;
    }
  }, []);

  // --- 流星触发检测 ---
  const detectMeteor = useCallback((data: Uint8Array): boolean => {
    let sum = 0;
    let count = 0;
    for (let i = METEOR_TRIGGER_RANGE[0]; i <= METEOR_TRIGGER_RANGE[1] && i < data.length; i++) {
      sum += data[i];
      count++;
    }
    if (count === 0) return false;
    const avg = sum / count / 255;
    return avg > 0.4;
  }, []);

  // --- 每帧更新 ---
  useFrame(() => {
    const mat = materialRef.current;
    if (!mat) return;
    
    // 暂停时跳过计算，但保持时钟同步避免累积 delta
    if (pausedRef.current) {
      // 重置时钟，避免恢复时 delta 过大
      clockRef.current.getDelta();
      return;
    }
    
    const time = clockRef.current.getElapsedTime();
    const dt = clockRef.current.getDelta();
    const data = getFrequencyData();

    // ★ 在 useFrame 中同步分析音频并获取最新特征
    const playing = isPlayingRef.current;
    const f = playing ? updateFeaturesRef.current() : ZERO_FEATURES;

    // 主题平滑过渡（2秒过渡完成）
    const cur = currentThemeRef.current;
    const tgt = targetThemeRef.current;
    const lerpFactor = Math.min(1, 0.5 * dt);
    const lerpTheme: SonicTheme = {
      ...cur,
      baseColor1: cur.baseColor1.map((v, i) => v + (tgt.baseColor1[i] - v) * lerpFactor) as [number, number, number],
      baseColor2: cur.baseColor2.map((v, i) => v + (tgt.baseColor2[i] - v) * lerpFactor) as [number, number, number],
      coolCore: cur.coolCore.map((v, i) => v + (tgt.coolCore[i] - v) * lerpFactor) as [number, number, number],
      coolEdge: cur.coolEdge.map((v, i) => v + (tgt.coolEdge[i] - v) * lerpFactor) as [number, number, number],
      warmCore: cur.warmCore.map((v, i) => v + (tgt.warmCore[i] - v) * lerpFactor) as [number, number, number],
      warmEdge: cur.warmEdge.map((v, i) => v + (tgt.warmEdge[i] - v) * lerpFactor) as [number, number, number],
      rippleColor: cur.rippleColor.map((v, i) => v + (tgt.rippleColor[i] - v) * lerpFactor) as [number, number, number],
      peakColor: cur.peakColor.map((v, i) => v + (tgt.peakColor[i] - v) * lerpFactor) as [number, number, number],
      glowIntensity: cur.glowIntensity + (tgt.glowIntensity - cur.glowIntensity) * lerpFactor,
    };
    currentThemeRef.current = lerpTheme;

    // 无雾，不更新雾色

    // 闲置波强度（暂停时保留基础闲置波，让柱子有最低高度）
    if (!isPlayingRef.current) {
      idleIntensityRef.current = 0.3; // 暂停时保留 30% 闲置波
    } else if (f.energy < 0.02) {
      lastIdleTimeRef.current += dt;
      if (lastIdleTimeRef.current > 1.0) {
        idleIntensityRef.current = Math.min(1, idleIntensityRef.current + dt);
      }
    } else {
      lastIdleTimeRef.current = 0;
      idleIntensityRef.current = Math.max(0, idleIntensityRef.current - dt);
    }

    // 更新 shader uniforms
    mat.uniforms.uTime.value = time;
    mat.uniforms.uSubBass.value = f.subBass;
    mat.uniforms.uBass.value = f.bass;
    mat.uniforms.uLowMid.value = f.lowMid;
    mat.uniforms.uMid.value = f.mid;
    mat.uniforms.uHighMid.value = f.highMid;
    mat.uniforms.uPresence.value = f.presence;
    mat.uniforms.uBrilliance.value = f.brilliance;
    mat.uniforms.uAir.value = f.air;
    mat.uniforms.uWarmth.value = f.warmth;
    mat.uniforms.uBrightness.value = f.brightness;
    mat.uniforms.uSharpness.value = f.sharpness;
    mat.uniforms.uSmoothness.value = f.smoothness;
    mat.uniforms.uDensity.value = f.density;
    mat.uniforms.uEnergy.value = f.energy;
    mat.uniforms.uBeat.value = f.beat;
    mat.uniforms.uIdleWave.value = idleIntensityRef.current;
    mat.uniforms.uAudioIntensity.value = 1.0;
    mat.uniforms.uResponseRange.value = 1.0;
    mat.uniforms.uHalfExtent.value = HALF_EXTENT;
    mat.uniforms.uPeakEnabled.value = 1;
    mat.uniforms.uPeakIntensity.value = 1;

    // 主题颜色 uniforms
    const setUniformColor = (name: string, c: [number, number, number]) => {
      const u = mat.uniforms[name];
      if (u && u.value) {
        u.value.setRGB(c[0], c[1], c[2]);
      }
    };
    setUniformColor('uBaseColor1', lerpTheme.baseColor1);
    setUniformColor('uBaseColor2', lerpTheme.baseColor2);
    setUniformColor('uCoolCore', lerpTheme.coolCore);
    setUniformColor('uCoolEdge', lerpTheme.coolEdge);
    setUniformColor('uWarmCore', lerpTheme.warmCore);
    setUniformColor('uWarmEdge', lerpTheme.warmEdge);
    setUniformColor('uRippleColor', lerpTheme.rippleColor);
    setUniformColor('uPeakColor', lerpTheme.peakColor);
    mat.uniforms.uGlowIntensity.value = lerpTheme.glowIntensity;

    // 波纹 uniforms 更新
    for (let i = 0; i < MAX_RIPPLES; i++) {
      const r = ripplesRef.current[i];
      const u = mat.uniforms.uRipples.value[i];
      u.pos.copy(r.pos);
      u.time = r.time;
      u.strength = r.strength;
      u.isActive = r.isActive;
      u.rippleType = r.rippleType;
      // 波纹超过生命周期后自动停用
      if (r.isActive && (time - r.time) > 3.0) {
        r.isActive = 0;
      }
    }

    // 节拍驱动：增强发光强度和峰值（色彩脉冲闪现）
    const beatPulse = f.beat;
    const beatStr = f.beatStrength;
    mat.uniforms.uGlowIntensity.value = lerpTheme.glowIntensity * (1 + beatPulse * 0.8);
    mat.uniforms.uPeakIntensity.value = 1 + beatPulse * 1.5;
    // 节拍呼吸：整体音频强度随节拍微缩放
    mat.uniforms.uAudioIntensity.value = 1.0 + beatPulse * 0.15;
    mat.uniforms.uResponseRange.value = 1.0 + beatPulse * 0.1;

    // 节拍 → 触发波纹（边沿检测：仅在新节拍上升沿触发一次）
    const beatRising = beatPulse > 0.9 && !beatActiveRef.current;
    beatActiveRef.current = beatPulse > 0.5;
    if (playing && beatRising) {
      // Kick 聚类模式
      if (clusterCenterRef.current.count <= 0) {
        const angle = Math.random() * Math.PI * 2;
        const radius = 10 + Math.random() * 40;
        clusterCenterRef.current = {
          x: Math.cos(angle) * radius,
          z: Math.sin(angle) * radius,
          count: 4 + Math.floor(Math.random() * 6),
        };
      }
      const cc = clusterCenterRef.current;
      const px = cc.x + (Math.random() - 0.5) * 8;
      const pz = cc.z + (Math.random() - 0.5) * 8;
      // 波纹强度受节拍强度驱动（更强）
      triggerRipple(px, pz, Math.min(beatStr * 10 + 3, 8), false);
      cc.count--;

      // 流星检测
      meteorCooldownRef.current = Math.max(0, meteorCooldownRef.current - 1);
      if (meteorCooldownRef.current === 0 && detectMeteor(data)) {
        triggerMeteor(Math.min(f.energy * 20 + beatStr * 2, 5));
        meteorCooldownRef.current = 50;
      }
    }

    // 更新流星
    const meteorMesh = meteorMeshRef.current;
    const meteorMat = meteorMatRef.current;
    if (meteorMesh && meteorMat) {
      const warmCoreColor = new THREE.Color(lerpTheme.warmCore[0], lerpTheme.warmCore[1], lerpTheme.warmCore[2]);
      const meteorColor = warmCoreColor.lerp(new THREE.Color(1, 1, 1), 0.7);
      meteorMat.color = meteorColor;

      const mMatrix = new THREE.Matrix4();
      const mScale = new THREE.Vector3(1, 1, 1);
      const mPos = new THREE.Vector3();
      const mQuat = new THREE.Quaternion();

      for (let i = 0; i < meteorsRef.current.length; i++) {
        const m = meteorsRef.current[i];
        if (m.active) {
          m.y -= m.speed * 60 * dt;
          // 下落途中随机掉粒子
          if (Math.random() < 0.3) {
            triggerParticles(m.x, m.y, m.z, m.speed * 0.1);
          }
          if (m.y <= 0) {
            // 落地 → 白色波纹
            triggerRipple(m.x, m.z, m.strength * 1.5, true);
            triggerParticles(m.x, 0, m.z, m.speed);
            m.active = false;
            m.y = -1000;
          }
          mPos.set(m.x, m.y, m.z);
          mMatrix.compose(mPos, mQuat, mScale);
        } else {
          mMatrix.makeScale(0, 0, 0);
        }
        meteorMesh.setMatrixAt(i, mMatrix);
      }
      meteorMesh.instanceMatrix.needsUpdate = true;
    }

    // 更新粒子
    const particleMesh = particleMeshRef.current;
    if (particleMesh) {
      const pMatrix = new THREE.Matrix4();
      const pPos = new THREE.Vector3();
      const pQuat = new THREE.Quaternion();
      const pScale = new THREE.Vector3();

      for (let i = 0; i < particlesRef.current.length; i++) {
        const p = particlesRef.current[i];
        if (p.active) {
          p.life += dt;
          if (p.life >= p.maxLife) {
            p.active = false;
            pMatrix.makeScale(0, 0, 0);
          } else {
            // 重力
            p.vy -= 15 * dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.z += p.vz * dt;
            const lifeRatio = 1 - p.life / p.maxLife;
            const s = p.scale * lifeRatio;
            pScale.set(s, s, s);
            pPos.set(p.x, p.y, p.z);
            pMatrix.compose(pPos, pQuat, pScale);
          }
        } else {
          pMatrix.makeScale(0, 0, 0);
        }
        particleMesh.setMatrixAt(i, pMatrix);
      }
      particleMesh.instanceMatrix.needsUpdate = true;
    }
  });

  // Uniforms 初始化（只在组件挂载时创建一次，主题切换时通过 ref 更新）
  const uniforms = useMemo(() => {
    const theme = SONIC_THEMES['nocturnal'];
    return {
      uTime: { value: 0 },
      uSubBass: { value: 0 }, uBass: { value: 0 }, uLowMid: { value: 0 },
      uMid: { value: 0 }, uHighMid: { value: 0 }, uPresence: { value: 0 },
      uBrilliance: { value: 0 }, uAir: { value: 0 },
      uWarmth: { value: 0 }, uBrightness: { value: 0 }, uSharpness: { value: 0 },
      uSmoothness: { value: 0 }, uDensity: { value: 0 }, uSpectralCentroid: { value: 0 },
      uEnergy: { value: 0 },
      uBeat: { value: 0 },
      uIdleWave: { value: 1 }, uAudioIntensity: { value: 1 }, uResponseRange: { value: 1 },
      uHalfExtent: { value: HALF_EXTENT },
      uRipples: { value: Array.from({ length: MAX_RIPPLES }, () => ({
        pos: new THREE.Vector2(), time: -100, strength: 0, isActive: 0, rippleType: 0,
      })) },
      uBaseColor1: { value: new THREE.Color(theme.baseColor1[0], theme.baseColor1[1], theme.baseColor1[2]) },
      uBaseColor2: { value: new THREE.Color(theme.baseColor2[0], theme.baseColor2[1], theme.baseColor2[2]) },
      uCoolCore: { value: new THREE.Color(theme.coolCore[0], theme.coolCore[1], theme.coolCore[2]) },
      uCoolEdge: { value: new THREE.Color(theme.coolEdge[0], theme.coolEdge[1], theme.coolEdge[2]) },
      uWarmCore: { value: new THREE.Color(theme.warmCore[0], theme.warmCore[1], theme.warmCore[2]) },
      uWarmEdge: { value: new THREE.Color(theme.warmEdge[0], theme.warmEdge[1], theme.warmEdge[2]) },
      uRippleColor: { value: new THREE.Color(theme.rippleColor[0], theme.rippleColor[1], theme.rippleColor[2]) },
      uPeakColor: { value: new THREE.Color(theme.peakColor[0], theme.peakColor[1], theme.peakColor[2]) },
      uGlowIntensity: { value: theme.glowIntensity },
      uPeakEnabled: { value: 1 }, uPeakIntensity: { value: 1 },
    };
  }, []); // ★ 只创建一次，主题切换通过 ref 平滑过渡

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 20, 10]} intensity={1} />

      {/* 柱网格 */}
      <instancedMesh ref={meshRef} args={[undefined, undefined, GRID_SIZE * GRID_SIZE]}>
        <boxGeometry args={[BAR_WIDTH, 1, BAR_WIDTH]} />
        <shaderMaterial
          ref={materialRef}
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          uniforms={uniforms}
          transparent
        />
      </instancedMesh>

      {/* 流星 */}
      <instancedMesh ref={meteorMeshRef} args={[undefined, undefined, MAX_METEORS]} frustumCulled={false}>
        <boxGeometry args={[0.4, 1.2, 0.4]} />
        <meshBasicMaterial ref={meteorMatRef} color="#ffffff" toneMapped={false} transparent opacity={0.9} />
      </instancedMesh>

      {/* 粒子 */}
      <instancedMesh ref={particleMeshRef} args={[undefined, undefined, MAX_PARTICLES]} frustumCulled={false}>
        <boxGeometry args={[0.8, 0.8, 0.8]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} transparent opacity={0.6} />
      </instancedMesh>
    </>
  );
}

// --- 主组件 ---
interface SonicBackgroundProps {
  getFeatures: () => AudioFeatures;
  updateFeatures: () => AudioFeatures;
  getFrequencyData: () => Uint8Array;
  isPlaying: boolean;
  /** 降低渲染频率（3D tab 激活时释放 GPU） */
  paused?: boolean;
}

export const SonicBackground: React.FC<SonicBackgroundProps> = ({ getFeatures, updateFeatures, getFrequencyData, isPlaying, paused = false }) => {
  const [themeKey, setThemeKey] = useState('nocturnal');
  const lastThemeRef = useRef<string>('nocturnal');
  const themeCheckTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const getFeaturesRef = useRef(getFeatures);
  getFeaturesRef.current = getFeatures;

  // 智能匹配主题：每 8 秒检测一次音频特征，平滑切换主题
  useEffect(() => {
    themeCheckTimerRef.current = setInterval(() => {
      const f = getFeaturesRef.current();
      if (!f || f.energy < 0.01) return; // 暂停或无声不切换

      const matched = matchTheme({
        warmth: f.warmth,
        brightness: f.brightness,
        energy: f.energy,
      });

      // 只在匹配度变化较大时切换（避免频繁跳转）
      if (matched !== lastThemeRef.current) {
        lastThemeRef.current = matched;
        setThemeKey(matched);
      }
    }, 8000); // 8秒检测一次

    return () => {
      if (themeCheckTimerRef.current) clearInterval(themeCheckTimerRef.current);
    };
  }, []);

  return (
    <div className="sonic-background">
      <Canvas
        camera={{ fov: 60, position: [0, 45, 70], near: 0.1, far: 300 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        frameloop="always"
        style={{ background: 'transparent' }}
      >
        <SonicScene
          getFeatures={getFeatures}
          updateFeatures={updateFeatures}
          getFrequencyData={getFrequencyData}
          themeKey={themeKey}
          isPlaying={isPlaying}
          paused={paused}
        />
      </Canvas>
      {/* 主题指示器 + 能量调试（定时器更新，不依赖 props 渲染） */}
      <ThemeIndicator themeKey={themeKey} getFeatures={getFeatures} />
    </div>
  );
};

const ThemeIndicator: React.FC<{ themeKey: string; getFeatures: () => AudioFeatures }> = ({ themeKey, getFeatures }) => {
  const [display, setDisplay] = useState({ energy: 0, beat: 0 });
  useEffect(() => {
    const timer = setInterval(() => {
      const f = getFeatures();
      setDisplay({ energy: f.energy, beat: f.beat });
    }, 500);
    return () => clearInterval(timer);
  }, [getFeatures]);
  return (
    <div className="sonic-theme-indicator">
      {SONIC_THEMES[themeKey]?.label} | E:{(display.energy * 100).toFixed(0)} B:{(display.beat * 100).toFixed(0)}
    </div>
  );
};
