// web/src/sonic/shaders.ts
// 音域回响 GLSL 着色器 — 从原始背景文件提取重写

export const vertexShader = /* glsl */ `
uniform float uTime;
uniform float uIdleWave;
uniform float uAudioIntensity;
uniform float uResponseRange;
uniform float uHalfExtent;

uniform float uSubBass;
uniform float uBass;
uniform float uLowMid;
uniform float uMid;
uniform float uHighMid;
uniform float uPresence;
uniform float uBrilliance;
uniform float uAir;

uniform float uWarmth;
uniform float uBrightness;
uniform float uSharpness;
uniform float uSmoothness;
uniform float uDensity;
uniform float uEnergy;
uniform float uBeat;

struct Ripple {
  vec2 pos;
  float time;
  float strength;
  float isActive;
  float rippleType;
};
uniform Ripple uRipples[10];

varying vec2 vUv;
varying float vElevation;
varying float vDistance;
varying vec2 vRippleAnim;
varying vec3 vNormal;
varying float vRelativeY;
varying vec2 vInstancePos;
varying float vPeakIntensity;

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                     -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v -   i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz; x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
                   + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m*m; m = m*m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float random(vec2 st) {
  return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
}

float easeLift(float raw, float maxHeight) {
  float x = clamp(raw, 0.0, 1.0);
  // 更平滑的缓动：三次方曲线，无过冲
  float eased = x * x * (3.0 - 2.0 * x);
  return eased * maxHeight;
}

float flowLift(float raw, float maxHeight) {
  float x = clamp(raw, 0.0, 1.0);
  float eased = pow(x, 0.85);
  float breathe = sin(x * 3.14159) * 0.08;
  return (eased + breathe) * maxHeight;
}

void main() {
  vUv = uv;
  vNormal = normal;

  vec4 instancePos = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec2 pos2D = instancePos.xz;
  vInstancePos = pos2D;

  float centerDist = length(pos2D);
  vDistance = centerDist;

  float rnd = random(pos2D);

  // 全范围律动（所有柱子都有响应）
  float globalFalloff = smoothstep(uHalfExtent * 0.95, uHalfExtent * 0.2, centerDist);

  // 闲置背景 + 有机噪声
  vec2 movingPos = pos2D * 0.05 + vec2(uTime * 0.1, uTime * 0.05);
  float baseNoise = (snoise(movingPos) + 1.0) * 0.5;
  float wave = sin(pos2D.x * 0.15 + pos2D.y * 0.1 - uTime * 0.6) * 0.5 + 0.5;
  float idleElevation = mix(baseNoise, wave, uSmoothness * 0.5 + 0.2) * 0.8 * globalFalloff;

  // 波浪传播：从中心向外扩散，缓慢柔和传播
  float waveDist = centerDist;
  float bassWave = sin(waveDist * 0.12 - uTime * 2.0) * 0.5 + 0.5;
  float beatWave = sin(waveDist * 0.15 - uTime * 3.0 + uBeat * 6.28) * 0.5 + 0.5;

  // 频段位移
  float range = uResponseRange;

  float subRegion = smoothstep(uHalfExtent * 0.60 * range, 0.0, centerDist);
  float subLift = easeLift(uSubBass, 7.0) * subRegion * (0.7 + bassWave * 0.3);
  vPeakIntensity = clamp(subLift / 7.0, 0.0, 1.0);

  float bassNoise = snoise(pos2D * 0.1 - vec2(0.0, uTime * 0.2));
  float bassRegion = smoothstep(uHalfExtent * 0.72 * range, uHalfExtent * 0.06 * range, centerDist + bassNoise * 5.0);
  float bassRnd = smoothstep(0.0, 1.0, rnd + uDensity * 0.5);
  float bassLift = easeLift(uBass, 6.0) * bassRegion * bassRnd * (0.6 + beatWave * 0.4);

  float lowMidNoise = snoise(pos2D * 0.05 + vec2(uTime * 0.1, 0.0));
  float lowMidLift = flowLift(uLowMid, 4.0) * (lowMidNoise * 0.5 + 0.5) * (0.7 + bassWave * 0.3);

  float riverFlow = sin(pos2D.x * 0.2 + pos2D.y * 0.2 + snoise(pos2D * 0.1) * 2.0 - uTime * 2.0);
  float midLift = flowLift(uMid, 5.0) * max(0.0, riverFlow) * (0.6 + beatWave * 0.4);

  float highMidRegion = smoothstep(uHalfExtent * 0.12 * range, uHalfExtent * 0.84 * range, centerDist);
  float highMidLift = 0.0;
  if (fract(rnd * 13.3) > 0.8) {
    float hmRaw = easeLift(uHighMid, 3.5);
    highMidLift = hmRaw * highMidRegion * fract(rnd * 7.7) * (0.5 + beatWave * 0.5);
  }

  float audioElevation = (subLift + bassLift + lowMidLift + midLift + highMidLift) * uAudioIntensity * 1.5;

  // 波浪传播叠加：让整个底部有流动感
  audioElevation += bassWave * uBass * 2.0 * globalFalloff;
  audioElevation += beatWave * uBeat * 3.0 * globalFalloff;

  if (rnd > 0.99) {
    float energyRaw = clamp(uEnergy, 0.0, 1.0);
    float energyBounce = 1.0 - pow(1.0 - energyRaw, 1.5);
    energyBounce += sin(energyRaw * 6.283 * 2.0) * exp(-energyRaw * 5.0) * 0.2;
    audioElevation += energyBounce * 10.0 * uAudioIntensity;
  }

  audioElevation *= globalFalloff;

  // 环境噪声
  float hillNoise = snoise(pos2D * 0.08 + vec2(uTime * 0.12, 0.0));
  float hillNoise2 = snoise(pos2D * 0.06 + vec2(0.0, uTime * 0.08));
  float rippleNoise = snoise(pos2D * 0.15 + vec2(uTime * 0.2, uTime * 0.15));
  float textureNoise = snoise(pos2D * 0.4 + uTime * 0.3) * 0.3;

  float baseUndulation = hillNoise * 0.6 + hillNoise2 * 0.4;
  baseUndulation = baseUndulation * 0.5 + 0.5;
  float rippleUndulation = rippleNoise * 0.3 + 0.5;
  float blockVariation = (rnd - 0.5) * 0.15;
  float combinedWave = baseUndulation * 0.5 + rippleUndulation * 0.35 + textureNoise + blockVariation;
  combinedWave = smoothstep(0.1, 0.9, combinedWave);

  float idleBlockWave = combinedWave * uIdleWave * 1.5 * globalFalloff;

  float elevation = idleElevation + audioElevation + idleBlockWave;

  // 波纹
  float rippleElevation = 0.0;
  float rippleIntensityNormal = 0.0;
  float rippleIntensityWhite = 0.0;
  float speed = 14.0;
  float width = 5.0;

  for(int i = 0; i < 10; i++) {
    if(uRipples[i].isActive > 0.0) {
      float dist = length(pos2D - uRipples[i].pos);
      float timeSince = uTime - uRipples[i].time;

      float curSpeed = speed;
      float curWidth = width;
      float curFadeDist = 22.0;
      float elevationScale = 3.0;

      if (uRipples[i].rippleType > 0.5) {
        curSpeed = 18.0;
        curWidth = 2.5;
        curFadeDist = 18.0;
        elevationScale = 1.8;
      }

      float waveRadius = timeSince * curSpeed;
      float d = dist - waveRadius;
      float rippleWave = exp(-d*d / curWidth);
      float fade = exp(-waveRadius / curFadeDist);
      float strengthCurve = clamp(uRipples[i].strength * 0.4, 0.0, 1.0);
      float rPulse = rippleWave * fade * strengthCurve;

      rippleElevation += rPulse * elevationScale;
      if (uRipples[i].rippleType > 0.5) {
        rippleIntensityWhite += rPulse;
      } else {
        rippleIntensityNormal += rPulse;
      }
    }
  }

  elevation += rippleElevation;
  vRippleAnim = vec2(
    clamp(sqrt(rippleIntensityNormal), 0.0, 1.0),
    clamp(sqrt(rippleIntensityWhite), 0.0, 1.0)
  );
  vElevation = elevation;

  float yPos = position.y + 0.5;
  vRelativeY = yPos;

  float totalHeight = 1.0 + elevation;
  vec3 pos = position;
  pos.y = -0.5 + yPos * totalHeight;

  vec4 worldPosition = instanceMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

export const fragmentShader = /* glsl */ `
uniform float uTime;
uniform float uPresence;
uniform float uBrilliance;
uniform float uAir;
uniform float uWarmth;
uniform float uBrightness;
uniform float uSharpness;

uniform vec3 uBaseColor1;
uniform vec3 uBaseColor2;
uniform vec3 uCoolCore;
uniform vec3 uCoolEdge;
uniform vec3 uWarmCore;
uniform vec3 uWarmEdge;
uniform vec3 uRippleColor;
uniform vec3 uPeakColor;
uniform float uGlowIntensity;
uniform float uPeakEnabled;
uniform float uPeakIntensity;

varying vec2 vUv;
varying float vElevation;
varying float vDistance;
varying vec2 vRippleAnim;
varying vec3 vNormal;
varying float vRelativeY;
varying vec2 vInstancePos;
varying float vPeakIntensity;

float random(vec2 st) {
  return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
}

void main() {
  bool isTop = vNormal.y > 0.5;
  float distFromTop = 1.0 - vRelativeY;

  float rnd = random(vInstancePos);
  float centerDist = length(vInstancePos);
  float normElevation = clamp(vElevation / 8.0, 0.0, 1.0);

  vec3 cBase1 = uBaseColor1;
  vec3 cBase2 = uBaseColor2;

  float warmBlend = smoothstep(0.0, 1.0, uWarmth * 1.5 + (0.5 - centerDist/80.0));
  vec3 zoneCore = mix(uCoolCore, uWarmCore, warmBlend);
  vec3 zoneEdge = mix(uCoolEdge, uWarmEdge, warmBlend);

  vec3 targetGlow = mix(zoneCore, zoneEdge, fract(rnd * 11.0));

  float distFade = 1.0 - smoothstep(40.0, 75.0, centerDist);
  targetGlow = mix(targetGlow, vec3(0.4, 0.8, 1.0), uBrightness * 0.6);

  vec3 currentGlow = mix(cBase2, targetGlow, normElevation) * uGlowIntensity * distFade;

  float normalBlend = vRippleAnim.x * vRippleAnim.x;
  float whiteBlend = vRippleAnim.y * vRippleAnim.y;
  currentGlow = mix(currentGlow, uRippleColor, normalBlend * 0.85);
  currentGlow = mix(currentGlow, vec3(1.0), whiteBlend * 0.9);

  float peakBlend = pow(vPeakIntensity, 0.85) * uPeakEnabled * uPeakIntensity;
  currentGlow = mix(currentGlow, uPeakColor, clamp(peakBlend, 0.0, 1.0) * 0.7);

  vec3 bodyColor = mix(cBase1, cBase2, vRelativeY * distFade);
  vec3 finalColor;

  if (isTop) {
    float topIntensity = smoothstep(0.0, 0.4, normElevation);
    topIntensity += clamp(peakBlend * 0.4, 0.0, 1.0);

    float twinkleDistFalloff = smoothstep(60.0, 30.0, centerDist);
    float twinkleMultiplier = mix(twinkleDistFalloff, 1.0, smoothstep(0.01, 0.1, normElevation));

    bool isSparkleTarget = fract(rnd * 31.0) > 0.95;
    if (isSparkleTarget && normElevation < 0.1) {
      topIntensity += uAir * 2.0 * twinkleMultiplier;
    }

    finalColor = mix(cBase2, currentGlow, topIntensity);

    float edgeX = smoothstep(0.05, 0.01, vUv.x) + smoothstep(0.95, 0.99, vUv.x);
    float edgeY = smoothstep(0.05, 0.01, vUv.y) + smoothstep(0.95, 0.99, vUv.y);
    float edge = min(edgeX + edgeY, 1.0);
    finalColor += currentGlow * edge * 0.8 * (topIntensity + 0.3);

    float flashChance = smoothstep(0.5, 1.0, uPresence);
    if (fract(rnd * 53.0) > 0.985 - flashChance * 0.05) {
      float flashSync = sin(uTime * 8.0 + rnd * 50.0) * 0.5 + 0.5;
      finalColor += mix(vec3(1.0), vec3(0.5, 1.0, 1.0), rnd) * flashSync * uPresence * (1.0 + uSharpness * 1.5) * twinkleMultiplier;
    }

    float brilliancePhase = sin(uTime * 1.5 + rnd * 30.0) * 0.5 + 0.5;
    if (edge > 0.6 && fract(rnd * 89.0) > 0.992 && brilliancePhase > 0.7) {
      finalColor += vec3(1.0) * uBrilliance * 2.0 * twinkleMultiplier * brilliancePhase;
    }
  } else {
    float verticalFalloff = mix(1.0, 3.0, uSharpness);
    float sideGlow = smoothstep(0.5 / verticalFalloff, 0.0, distFromTop) * normElevation;
    if (normElevation < 0.02) sideGlow = 0.0;

    vec3 sideGlowColor = mix(currentGlow, uPeakColor, clamp(peakBlend * 0.4, 0.0, 1.0));
    finalColor = mix(bodyColor, sideGlowColor, sideGlow * 1.5);

    float rimGlow = smoothstep(0.03, 0.0, distFromTop) * normElevation;
    finalColor += mix(currentGlow, uPeakColor, clamp(peakBlend * 0.35, 0.0, 1.0)) * rimGlow;
  }

  finalColor = mix(finalColor, uPeakColor, clamp(peakBlend * 0.15, 0.0, 1.0));
  finalColor += uRippleColor * normalBlend * 0.4;
  finalColor += vec3(1.0) * whiteBlend * 0.7;

  // 颜色渐变融入背景：全方位柔和过渡
  // 底部柔和渐隐（范围更宽，过渡更自然）
  float bottomFade = smoothstep(0.0, 0.4, vRelativeY);
  // 顶部柔和渐隐
  float topFade = 1.0 - smoothstep(0.6, 1.0, vRelativeY);
  // 低高度柔和渐隐
  float heightFade = smoothstep(0.01, 0.15, vElevation);
  // 边缘柔和渐隐
  float edgeFade = smoothstep(180.0, 80.0, vDistance);

  float alpha = bottomFade * topFade * heightFade * edgeFade * 1.2 + 0.4;

  gl_FragColor = vec4(finalColor, alpha);
}
`;
