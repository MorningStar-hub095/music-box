// web/src/sonic/VisualizerDemo.tsx
// 可视化样式演示页：4 种 3D 动画样式 + 模拟音频驱动
import React, { useRef, useEffect, useState, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// ============================================================
// 模拟音频数据生成器
// ============================================================
function useSimulatedFeatures() {
  const [features, setFeatures] = useState({
    subBass: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0,
    presence: 0, brilliance: 0, air: 0, energy: 0, beat: 0, beatStrength: 0,
  });
  const timeRef = useRef(0);
  const beatPulseRef = useRef(0);
  const beatCooldownRef = useRef(0);
  const smoothedRef = useRef({ subBass: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0, presence: 0, brilliance: 0, air: 0 });

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      timeRef.current += 0.016;
      const t = timeRef.current;
      // 模拟 BPM 120
      const beatPhase = (t * 2) % 1;
      const beatRaw = Math.exp(-beatPhase * 6);

      // 节拍触发
      if (beatPhase < 0.04 && beatCooldownRef.current <= 0) {
        beatPulseRef.current = 1;
        beatCooldownRef.current = 28;
      }
      if (beatCooldownRef.current > 0) beatCooldownRef.current--;
      beatPulseRef.current = Math.max(0, beatPulseRef.current - 0.06);

      const target = {
        subBass: beatRaw * 0.7 + Math.sin(t * 0.5) * 0.05,
        bass: beatRaw * 0.5 + Math.sin(t * 0.8) * 0.08,
        lowMid: Math.sin(t * 1.2) * 0.2 + 0.15,
        mid: Math.sin(t * 1.8) * 0.15 + 0.1,
        highMid: Math.sin(t * 2.5) * 0.12 + Math.random() * 0.08,
        presence: Math.random() * 0.12 + Math.sin(t * 3) * 0.05,
        brilliance: Math.random() * 0.08,
        air: Math.random() * 0.05,
      };

      const sm = smoothedRef.current;
      const alpha = 0.35;
      const result = {
        subBass: sm.subBass + (Math.max(0, target.subBass) - sm.subBass) * alpha,
        bass: sm.bass + (Math.max(0, target.bass) - sm.bass) * alpha,
        lowMid: sm.lowMid + (Math.max(0, target.lowMid) - sm.lowMid) * alpha,
        mid: sm.mid + (Math.max(0, target.mid) - sm.mid) * alpha,
        highMid: sm.highMid + (Math.max(0, target.highMid) - sm.highMid) * alpha,
        presence: sm.presence + (Math.max(0, target.presence) - sm.presence) * alpha,
        brilliance: sm.brilliance + (Math.max(0, target.brilliance) - sm.brilliance) * alpha,
        air: sm.air + (Math.max(0, target.air) - sm.air) * alpha,
      };
      smoothedRef.current = result;

      const energy = (result.subBass + result.bass + result.lowMid + result.mid + result.highMid + result.presence + result.brilliance + result.air) / 8;

      setFeatures({ ...result, energy, beat: beatPulseRef.current, beatStrength: beatPulseRef.current });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return features;
}

type SimFeatures = ReturnType<typeof useSimulatedFeatures>;

// ============================================================
// 样式 1：环形辐射 — 柱子围成圆形向外辐射
// ============================================================
function RadialBars({ features }: { features: SimFeatures }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const BAR_COUNT = 128;
  const RADIUS = 12;

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < BAR_COUNT; i++) {
      const angle = (i / BAR_COUNT) * Math.PI * 2;
      matrix.makeRotationY(angle).setPosition(Math.cos(angle) * RADIUS, 0, Math.sin(angle) * RADIUS);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, []);

  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const t = clock.getElapsedTime();
    const beat = features.beat;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    for (let i = 0; i < BAR_COUNT; i++) {
      const angle = (i / BAR_COUNT) * Math.PI * 2;
      // 频段映射：前 1/4 低频，中间中频，后 1/4 高频
      let band = 0;
      const r = i / BAR_COUNT;
      if (r < 0.25) band = features.subBass * 0.5 + features.bass * 0.5;
      else if (r < 0.5) band = features.lowMid * 0.5 + features.mid * 0.5;
      else if (r < 0.75) band = features.highMid * 0.5 + features.presence * 0.5;
      else band = features.brilliance * 0.5 + features.air * 0.5;

      const height = 0.5 + band * 30 + Math.sin(t * 2 + i * 0.1) * 0.5;
      const scale = 1 + beat * 0.3;
      dummy.position.set(Math.cos(angle) * RADIUS * scale, height / 2, Math.sin(angle) * RADIUS * scale);
      dummy.rotation.y = -angle;
      dummy.scale.set(1, height, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      // 颜色：低频暖色，高频冷色
      const hue = 0.6 - r * 0.4; // 0.6(蓝) → 0.2(橙)
      const lightness = 0.3 + band * 0.5 + beat * 0.2;
      color.setHSL(hue, 0.8, lightness);
      mesh.setColorAt(i, color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <group rotation={[-0.3, 0, 0]}>
      <instancedMesh ref={meshRef} args={[undefined, undefined, BAR_COUNT]}>
        <boxGeometry args={[0.3, 1, 0.3]} />
        <meshStandardMaterial emissiveIntensity={0.8} emissive={'#4488ff'} toneMapped={false} />
      </instancedMesh>
      {/* 中心光球 */}
      <mesh position={[0, 2, 0]}>
        <sphereGeometry args={[1 + features.beat * 0.5, 32, 32]} />
        <meshBasicMaterial color={new THREE.Color().setHSL(0.55, 0.8, 0.4 + features.beat * 0.3)} toneMapped={false} transparent opacity={0.8} />
      </mesh>
      <pointLight position={[0, 5, 0]} intensity={2 + features.beat * 3} color={'#66aaff'} distance={30} />
    </group>
  );
}

// ============================================================
// 样式 2：波形示波器 — 3D 流动波形带
// ============================================================
function WaveformRibbon({ features }: { features: SimFeatures }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const geoRef = useRef<THREE.PlaneGeometry>(null);
  const SEGMENTS = 200;

  useFrame(({ clock }) => {
    const geo = geoRef.current;
    if (!geo) return;
    const t = clock.getElapsedTime();
    const beat = features.beat;
    const pos = geo.attributes.position;

    for (let i = 0; i <= SEGMENTS; i++) {
      const x = (i / SEGMENTS - 0.5) * 40;
      // 多层波形叠加
      const wave1 = Math.sin(x * 0.3 + t * 2) * (features.bass * 3 + 0.5);
      const wave2 = Math.sin(x * 0.5 + t * 3) * (features.mid * 2 + 0.3);
      const wave3 = Math.sin(x * 0.8 + t * 4) * (features.highMid * 1.5);
      const y = wave1 + wave2 + wave3 + beat * Math.sin(x * 0.2) * 2;
      pos.setY(i, y);
      pos.setZ(i, Math.cos(x * 0.2 + t) * features.presence * 2);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();

    // 旋转
    if (meshRef.current) {
      meshRef.current.rotation.z = Math.sin(t * 0.2) * 0.1;
    }
  });

  return (
    <group rotation={[-0.4, 0, 0]} position={[0, 0, 0]}>
      <mesh ref={meshRef}>
        <planeGeometry ref={geoRef} args={[40, 0.8, SEGMENTS, 1]} />
        <meshStandardMaterial
          color={'#3366cc'}
          emissive={'#4488ff'}
          emissiveIntensity={0.6 + features.beat * 0.8}
          side={THREE.DoubleSide}
          transparent
          opacity={0.7}
          toneMapped={false}
        />
      </mesh>
      {/* 镜像下方波形 */}
      <mesh position={[0, -3, 0]} scale={[1, -1, 1]}>
        <planeGeometry args={[40, 0.8, SEGMENTS, 1]} />
        <meshBasicMaterial color={'#2255aa'} side={THREE.DoubleSide} transparent opacity={0.25} toneMapped={false} />
      </mesh>
      <pointLight position={[0, 5, 5]} intensity={1.5 + features.beat * 2} color={'#88ccff'} distance={40} />
    </group>
  );
}

// ============================================================
// 样式 3：粒子星云 — 大量粒子随节拍爆发流动
// ============================================================
function ParticleNebula({ features }: { features: SimFeatures }) {
  const pointsRef = useRef<THREE.Points>(null);
  const COUNT = 3000;
  const positionsRef = useRef<Float32Array>(new Float32Array(COUNT * 3));
  const velocitiesRef = useRef<Float32Array>(new Float32Array(COUNT * 3));
  const colorsRef = useRef<Float32Array>(new Float32Array(COUNT * 3));
  const basePosRef = useRef<Float32Array>(new Float32Array(COUNT * 3));

  useEffect(() => {
    for (let i = 0; i < COUNT; i++) {
      // 球形分布
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 5 + Math.random() * 15;
      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.sin(phi) * Math.sin(theta);
      const z = r * Math.cos(phi);
      positionsRef.current[i * 3] = x;
      positionsRef.current[i * 3 + 1] = y;
      positionsRef.current[i * 3 + 2] = z;
      basePosRef.current[i * 3] = x;
      basePosRef.current[i * 3 + 1] = y;
      basePosRef.current[i * 3 + 2] = z;
      velocitiesRef.current[i * 3] = 0;
      velocitiesRef.current[i * 3 + 1] = 0;
      velocitiesRef.current[i * 3 + 2] = 0;
    }
  }, []);

  useFrame(({ clock }) => {
    const points = pointsRef.current;
    if (!points) return;
    const t = clock.getElapsedTime();
    const beat = features.beat;
    const beatStr = features.beatStrength;
    const energy = features.energy;

    const pos = positionsRef.current;
    const vel = velocitiesRef.current;
    const base = basePosRef.current;
    const col = colorsRef.current;
    const color = new THREE.Color();

    for (let i = 0; i < COUNT; i++) {
      const ix = i * 3;
      // 基础位置 + 呼吸缩放
      const breathScale = 1 + energy * 0.3 + beat * 0.15;
      const targetX = base[ix] * breathScale;
      const targetY = base[ix + 1] * breathScale;
      const targetZ = base[ix + 2] * breathScale;

      // 节拍爆发力
      if (beat > 0.85) {
        const distSq = base[ix] ** 2 + base[ix + 1] ** 2 + base[ix + 2] ** 2;
        const dist = Math.sqrt(distSq) || 1;
        const force = beatStr * 0.3;
        vel[ix] += (base[ix] / dist) * force;
        vel[ix + 1] += (base[ix + 1] / dist) * force;
        vel[ix + 2] += (base[ix + 2] / dist) * force;
      }

      // 流动噪声
      const flowX = Math.sin(t * 0.5 + base[ix + 2] * 0.1) * 0.05 * energy;
      const flowY = Math.cos(t * 0.3 + base[ix] * 0.1) * 0.05 * energy;
      const flowZ = Math.sin(t * 0.4 + base[ix + 1] * 0.1) * 0.05 * energy;

      // 弹簧力回到基础位置
      vel[ix] += (targetX - pos[ix]) * 0.03 + flowX;
      vel[ix + 1] += (targetY - pos[ix + 1]) * 0.03 + flowY;
      vel[ix + 2] += (targetZ - pos[ix + 2]) * 0.03 + flowZ;

      // 阻尼
      vel[ix] *= 0.92;
      vel[ix + 1] *= 0.92;
      vel[ix + 2] *= 0.92;

      pos[ix] += vel[ix];
      pos[ix + 1] += vel[ix + 1];
      pos[ix + 2] += vel[ix + 2];

      // 颜色：距中心远近 + 频段
      const distFromCenter = Math.sqrt(pos[ix] ** 2 + pos[ix + 1] ** 2 + pos[ix + 2] ** 2);
      const hue = 0.55 + (distFromCenter / 25) * 0.15 + beat * 0.1;
      const lightness = 0.3 + energy * 0.4 + beat * 0.2;
      color.setHSL(hue, 0.7, lightness);
      col[ix] = color.r;
      col[ix + 1] = color.g;
      col[ix + 2] = color.b;
    }

    const geo = points.geometry;
    geo.attributes.position.needsUpdate = true;
    if (geo.attributes.color) geo.attributes.color.needsUpdate = true;

    // 缓慢旋转
    points.rotation.y = t * 0.05;
    points.rotation.x = Math.sin(t * 0.1) * 0.1;
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
        size={0.15}
        vertexColors
        transparent
        opacity={0.8}
        blending={THREE.AdditiveBlending}
        sizeAttenuation
        depthWrite={false}
        toneMapped={false}
      />
    </points>
  );
}

// ============================================================
// 样式 4：液态水面 — 网格曲面随音乐波纹起伏
// ============================================================
function LiquidSurface({ features }: { features: SimFeatures }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const geoRef = useRef<THREE.PlaneGeometry>(null);
  const SEG = 80;

  useFrame(({ clock }) => {
    const geo = geoRef.current;
    if (!geo) return;
    const t = clock.getElapsedTime();
    const beat = features.beat;
    const pos = geo.attributes.position;

    for (let i = 0; i <= SEG; i++) {
      for (let j = 0; j <= SEG; j++) {
        const idx = i * (SEG + 1) + j;
        const x = pos.getX(idx);
        const y = pos.getY(idx);
        const dist = Math.sqrt(x * x + y * y);

        // 多层波纹
        const ripple1 = Math.sin(dist * 0.3 - t * 2) * (features.bass * 2 + 0.3);
        const ripple2 = Math.sin(dist * 0.5 - t * 3) * (features.mid * 1.5);
        const ripple3 = Math.cos(x * 0.2 + t) * Math.cos(y * 0.2 + t * 1.3) * (features.highMid * 1);
        // 节拍冲击波
        const beatWave = Math.sin(dist * 0.4 - t * 5) * beat * 2 * Math.exp(-dist * 0.05);
        // 中心凸起
        const centerBump = features.subBass * 3 * Math.exp(-dist * 0.1);

        pos.setZ(idx, ripple1 + ripple2 + ripple3 + beatWave + centerBump);
      }
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();

    // 颜色变化
    if (meshRef.current) {
      const mat = meshRef.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 0.3 + features.energy * 0.5 + beat * 0.5;
    }
  });

  return (
    <group rotation={[-0.5, 0, 0]} position={[0, -2, 0]}>
      <mesh ref={meshRef}>
        <planeGeometry ref={geoRef} args={[40, 40, SEG, SEG]} />
        <meshStandardMaterial
          color={'#1a3366'}
          emissive={'#3377cc'}
          emissiveIntensity={0.4}
          metalness={0.3}
          roughness={0.4}
          side={THREE.DoubleSide}
          wireframe={false}
        />
      </mesh>
      {/* 线框叠层 */}
      <mesh position={[0, 0.1, 0]}>
        <planeGeometry args={[40, 40, SEG, SEG]} />
        <meshBasicMaterial color={'#88ccff'} wireframe transparent opacity={0.08} />
      </mesh>
      <pointLight position={[0, 10, 5]} intensity={1 + features.beat * 2} color={'#4499ff'} distance={40} />
    </group>
  );
}

// ============================================================
// 主组件：样式切换器
// ============================================================
const STYLES = [
  { key: 'radial', label: '环形辐射' },
  { key: 'waveform', label: '波形示波器' },
  { key: 'particles', label: '粒子星云' },
  { key: 'liquid', label: '液态水面' },
] as const;

interface VisualizerDemoProps {
  onClose: () => void;
}

export const VisualizerDemo: React.FC<VisualizerDemoProps> = ({ onClose }) => {
  const [style, setStyle] = useState<string>('particles');
  const features = useSimulatedFeatures();

  return (
    <div className="visualizer-demo" style={{
      position: 'fixed', inset: 0, zIndex: 9999, background: '#010206',
    }}>
      <Canvas
        camera={{ fov: 50, position: [0, 5, 30], near: 0.1, far: 200 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: false }}
      >
        <color attach="background" args={['#010206']} />
        <fog attach="fog" args={['#010206', 25, 70]} />
        <ambientLight intensity={0.3} />
        <directionalLight position={[10, 20, 10]} intensity={0.5} />

        {style === 'radial' && <RadialBars features={features} />}
        {style === 'waveform' && <WaveformRibbon features={features} />}
        {style === 'particles' && <ParticleNebula features={features} />}
        {style === 'liquid' && <LiquidSurface features={features} />}
      </Canvas>

      {/* 顶部样式切换器 */}
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, display: 'flex',
        justifyContent: 'center', gap: '8px', padding: '16px',
        background: 'linear-gradient(to bottom, rgba(0,0,0,0.6), transparent)',
        zIndex: 10,
      }}>
        {STYLES.map(s => (
          <button
            key={s.key}
            onClick={() => setStyle(s.key)}
            style={{
              padding: '8px 20px', borderRadius: '20px', border: 'none', cursor: 'pointer',
              fontSize: '14px', fontWeight: 500, transition: 'all 0.3s',
              background: style === s.key ? 'rgba(100,160,255,0.8)' : 'rgba(255,255,255,0.1)',
              color: style === s.key ? '#fff' : 'rgba(255,255,255,0.6)',
              backdropFilter: 'blur(8px)',
            }}
          >
            {s.label}
          </button>
        ))}
        <button
          onClick={onClose}
          style={{
            marginLeft: '16px', padding: '8px 20px', borderRadius: '20px', border: 'none',
            cursor: 'pointer', fontSize: '14px', background: 'rgba(255,80,80,0.3)',
            color: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(8px)',
          }}
        >
          退出演示
        </button>
      </div>

      {/* 底部信息 */}
      <div style={{
        position: 'fixed', bottom: '16px', left: 0, right: 0, textAlign: 'center',
        color: 'rgba(255,255,255,0.4)', fontSize: '12px', zIndex: 10,
      }}>
        当前样式：{STYLES.find(s => s.key === style)?.label} | 模拟 BPM 120 | 能量: {(features.energy * 100).toFixed(0)}% | 节拍: {(features.beat * 100).toFixed(0)}%
      </div>
    </div>
  );
};
