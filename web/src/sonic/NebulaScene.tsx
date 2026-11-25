// web/src/sonic/NebulaScene.tsx
// 柔和版粒子星云 3D 场景 — 降低敏感度，更流畅自然
import React, { useRef, useEffect, useState, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { SONIC_THEMES, SONIC_THEME_KEYS, SonicTheme } from './themes';
import type { AudioFeatures } from '../hooks/useAudioAnalyser';

const PARTICLE_COUNT = 2000; // 降低粒子数提升性能

// --- 粒子星云场景 ---
interface NebulaSceneProps {
  features: AudioFeatures;
  themeKey: string;
  isPlaying: boolean;
}

function NebulaScene({ features, themeKey, isPlaying }: NebulaSceneProps) {
  const pointsRef = useRef<THREE.Points>(null);
  const positionsRef = useRef<Float32Array>(new Float32Array(PARTICLE_COUNT * 3));
  const velocitiesRef = useRef<Float32Array>(new Float32Array(PARTICLE_COUNT * 3));
  const colorsRef = useRef<Float32Array>(new Float32Array(PARTICLE_COUNT * 3));
  const basePosRef = useRef<Float32Array>(new Float32Array(PARTICLE_COUNT * 3));
  const beatActiveRef = useRef(false);
  const beatPulseRef = useRef(0);

  // 用 ref 存储最新 features
  const featuresRef = useRef(features);
  featuresRef.current = features;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  // 当前主题 & 目标主题（平滑过渡）
  const currentThemeRef = useRef<SonicTheme>(SONIC_THEMES[themeKey] || SONIC_THEMES.nocturnal);
  const targetThemeRef = useRef<SonicTheme>(SONIC_THEMES[themeKey] || SONIC_THEMES.nocturnal);

  useEffect(() => {
    const theme = SONIC_THEMES[themeKey];
    if (theme) targetThemeRef.current = theme;
  }, [themeKey]);

  // 初始化粒子位置
  useEffect(() => {
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 4 + Math.random() * 12;
      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.sin(phi) * Math.sin(theta) * 0.6; // 稍微压扁
      const z = r * Math.cos(phi);
      positionsRef.current[i * 3] = x;
      positionsRef.current[i * 3 + 1] = y;
      positionsRef.current[i * 3 + 2] = z;
      basePosRef.current[i * 3] = x;
      basePosRef.current[i * 3 + 1] = y;
      basePosRef.current[i * 3 + 2] = z;
    }
  }, []);

  // 设置相机
  const { camera, scene } = useThree();
  useEffect(() => {
    camera.position.set(0, 3, 22);
    camera.lookAt(0, 0, 0);
    (camera as THREE.PerspectiveCamera).fov = 50;
    (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
    const bgColor = new THREE.Color(
      currentThemeRef.current.baseColor1[0],
      currentThemeRef.current.baseColor1[1],
      currentThemeRef.current.baseColor1[2]
    );
    scene.fog = new THREE.Fog(bgColor.getHex(), 15, 50);
    scene.background = bgColor;
  }, [camera, scene]);

  useFrame(({ clock }) => {
    const points = pointsRef.current;
    if (!points) return;
    const t = clock.getElapsedTime();
    const f = featuresRef.current;
    const playing = isPlayingRef.current;
    const dt = clock.getDelta();

    // 主题平滑过渡
    const cur = currentThemeRef.current;
    const tgt = targetThemeRef.current;
    const lerp = Math.min(1, 2 * dt);
    const lerpTheme: SonicTheme = {
      ...cur,
      baseColor1: cur.baseColor1.map((v, i) => v + (tgt.baseColor1[i] - v) * lerp) as [number, number, number],
      baseColor2: cur.baseColor2.map((v, i) => v + (tgt.baseColor2[i] - v) * lerp) as [number, number, number],
      coolCore: cur.coolCore.map((v, i) => v + (tgt.coolCore[i] - v) * lerp) as [number, number, number],
      coolEdge: cur.coolEdge.map((v, i) => v + (tgt.coolEdge[i] - v) * lerp) as [number, number, number],
      warmCore: cur.warmCore.map((v, i) => v + (tgt.warmCore[i] - v) * lerp) as [number, number, number],
      warmEdge: cur.warmEdge.map((v, i) => v + (tgt.warmEdge[i] - v) * lerp) as [number, number, number],
      rippleColor: cur.rippleColor.map((v, i) => v + (tgt.rippleColor[i] - v) * lerp) as [number, number, number],
      peakColor: cur.peakColor.map((v, i) => v + (tgt.peakColor[i] - v) * lerp) as [number, number, number],
      glowIntensity: cur.glowIntensity + (tgt.glowIntensity - cur.glowIntensity) * lerp,
    };
    currentThemeRef.current = lerpTheme;

    // 更新场景背景色
    const bgColor = new THREE.Color(lerpTheme.baseColor1[0], lerpTheme.baseColor1[1], lerpTheme.baseColor1[2]);
    scene.background = bgColor;
    if (scene.fog) (scene.fog as THREE.Fog).color = bgColor;

    // 节拍检测（边沿触发）
    const beatRising = f.beat > 0.85 && !beatActiveRef.current;
    beatActiveRef.current = f.beat > 0.4;

    // 柔和节拍脉冲衰减
    if (beatRising) beatPulseRef.current = 0.8;
    beatPulseRef.current = Math.max(0, beatPulseRef.current - 0.03); // 更慢衰减
    const beat = beatPulseRef.current;

    const energy = playing ? f.energy * 0.6 : 0; // 降低能量敏感度
    const pos = positionsRef.current;
    const vel = velocitiesRef.current;
    const base = basePosRef.current;
    const col = colorsRef.current;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const ix = i * 3;

      // 呼吸缩放（更柔和）
      const breathScale = 1 + energy * 0.15 + beat * 0.08;
      const targetX = base[ix] * breathScale;
      const targetY = base[ix + 1] * breathScale;
      const targetZ = base[ix + 2] * breathScale;

      // 节拍爆发力（更温和）
      if (beatRising && playing) {
        const dist = Math.sqrt(base[ix] ** 2 + base[ix + 1] ** 2 + base[ix + 2] ** 2) || 1;
        const force = f.beatStrength * 0.12; // 降低爆发力
        vel[ix] += (base[ix] / dist) * force;
        vel[ix + 1] += (base[ix + 1] / dist) * force;
        vel[ix + 2] += (base[ix + 2] / dist) * force;
      }

      // 流动噪声（更缓慢）
      const flowX = Math.sin(t * 0.3 + base[ix + 2] * 0.08) * 0.02 * energy;
      const flowY = Math.cos(t * 0.2 + base[ix] * 0.08) * 0.02 * energy;
      const flowZ = Math.sin(t * 0.25 + base[ix + 1] * 0.08) * 0.02 * energy;

      // 弹簧力（更平滑）
      vel[ix] += (targetX - pos[ix]) * 0.02 + flowX;
      vel[ix + 1] += (targetY - pos[ix + 1]) * 0.02 + flowY;
      vel[ix + 2] += (targetZ - pos[ix + 2]) * 0.02 + flowZ;

      // 更高阻尼（更稳定）
      vel[ix] *= 0.95;
      vel[ix + 1] *= 0.95;
      vel[ix + 2] *= 0.95;

      pos[ix] += vel[ix];
      pos[ix + 1] += vel[ix + 1];
      pos[ix + 2] += vel[ix + 2];

      // 颜色：根据距离中心和频段
      const distFromCenter = Math.sqrt(pos[ix] ** 2 + pos[ix + 1] ** 2 + pos[ix + 2] ** 2);
      const normalizedDist = Math.min(1, distFromCenter / 15);

      // 柔和的颜色混合
      const coolColor = new THREE.Color(lerpTheme.coolCore[0], lerpTheme.coolCore[1], lerpTheme.coolCore[2]);
      const warmColor = new THREE.Color(lerpTheme.warmCore[0], lerpTheme.warmCore[1], lerpTheme.warmCore[2]);
      const peakColor = new THREE.Color(lerpTheme.peakColor[0], lerpTheme.peakColor[1], lerpTheme.peakColor[2]);

      // 基础颜色：中心冷色，边缘暖色
      const baseColor = coolColor.clone().lerp(warmColor, normalizedDist);

      // 节拍时高亮（更温和）
      const beatHighlight = beat * 0.3 * (1 - normalizedDist * 0.5);
      baseColor.lerp(peakColor, beatHighlight);

      // 频段响应（更柔和）
      const bandBoost = (f.subBass * 0.3 + f.bass * 0.2 + f.mid * 0.15) * 0.5;
      const brightness = 0.25 + energy * 0.2 + bandBoost;
      baseColor.multiplyScalar(Math.min(1, brightness));

      col[ix] = baseColor.r;
      col[ix + 1] = baseColor.g;
      col[ix + 2] = baseColor.b;
    }

    const geo = points.geometry;
    geo.attributes.position.needsUpdate = true;
    if (geo.attributes.color) geo.attributes.color.needsUpdate = true;

    // 缓慢旋转（更平滑）
    points.rotation.y = t * 0.02;
    points.rotation.x = Math.sin(t * 0.08) * 0.05;
  });

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positionsRef.current, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colorsRef.current, 3));
    return geo;
  }, []);

  return (
    <points ref={pointsRef} geometry={geometry}>
      <pointsMaterial
        size={0.12}
        vertexColors
        transparent
        opacity={0.7}
        blending={THREE.AdditiveBlending}
        sizeAttenuation
        depthWrite={false}
        toneMapped={false}
      />
    </points>
  );
}

// --- 主组件 ---
interface NebulaBackgroundProps {
  features: AudioFeatures;
  isPlaying: boolean;
}

export const NebulaBackground: React.FC<NebulaBackgroundProps> = ({ features, isPlaying }) => {
  const [themeKey, setThemeKey] = useState('nocturnal');
  const themeIndexRef = useRef(0);
  const cycleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 主题自动轮询
  useEffect(() => {
    cycleTimerRef.current = setInterval(() => {
      themeIndexRef.current = (themeIndexRef.current + 1) % SONIC_THEME_KEYS.length;
      setThemeKey(SONIC_THEME_KEYS[themeIndexRef.current]);
    }, 60000);
    return () => {
      if (cycleTimerRef.current) clearInterval(cycleTimerRef.current);
    };
  }, []);

  return (
    <div className="sonic-background">
      <Canvas
        camera={{ fov: 50, position: [0, 3, 22], near: 0.1, far: 100 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: false }}
      >
        <ambientLight intensity={0.2} />
        <directionalLight position={[5, 10, 5]} intensity={0.3} />
        <NebulaScene features={features} themeKey={themeKey} isPlaying={isPlaying} />
      </Canvas>
      <div className="sonic-theme-indicator">
        {SONIC_THEMES[themeKey]?.label} | E:{(features.energy * 100).toFixed(0)} B:{(features.beat * 100).toFixed(0)}
      </div>
    </div>
  );
};
