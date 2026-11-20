
varying vec3 vWPos;
uniform sampler2D uH;
uniform float uLevel;
uniform float uDatum;
uniform float uEx;
uniform vec2 uDry;
uniform vec4 uCrop;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uShallowCalm;
uniform vec3 uDeepCalm;
uniform vec3 uFoam;
uniform vec3 uRapids;
uniform vec2 uRapidsDir;
uniform float uTime;
uniform float uFlood;
uniform float uDense;
uniform vec2 uRipRot;
uniform float uPx;
float whash(vec2 p){ p = fract(p * vec2(127.1, 311.7)); p += dot(p, p + 34.5); return fract(p.x * p.y); }
float wnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(whash(i), whash(i + vec2(1.0, 0.0)), u.x), mix(whash(i + vec2(0.0, 1.0)), whash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// 一组水纹：东西向的细波线，断断续续
float rippleOct(vec2 p, float s){
  float w = p.y / s + 0.26 * sin(p.x / (s * 2.6) + 1.1 * sin(p.y / (s * 5.1)) + uTime) + 0.07 * sin(p.x / (s * 0.95) + p.y / (s * 3.0));
  float f = abs(fract(w) - 0.5) * 2.0;
  // 线的粗细也按页面上的像素算（uPx 是一个页面像素合几个画布像素）：像素比高的屏幕上线一样粗，只是更清楚
  float fw = fwidth(w) * 2.0 * uPx;
  float line = 1.0 - smoothstep(0.04, 0.05 + fw, f);
  float seg = sin(p.x / (s * 2.1) + floor(w) * 2.4) + 0.5 * sin(p.x / (s * 0.83) + floor(w) * 5.1);
  return line * smoothstep(0.15, 0.7, seg);
}
// 水纹的疏密跟着镜头远近变：屏幕上总是差不多一样密
float ripples(vec2 p0){
  // 水纹顺着画面横着走：镜头从东边看过来时把它转九十度
  vec2 p = vec2(uRipRot.x * p0.x - uRipRot.y * p0.y, uRipRot.y * p0.x + uRipRot.x * p0.y);
  // 一个页面像素（不是画布像素）合地上多少米：同一个画面在像素比 1、1.5、2 的屏幕上，水纹落在同样的地方
  float px = max(fwidth(p.x), fwidth(p.y)) * uPx;
  float target = max(px * 8.0, 4.0);
  float l = log2(target / 4.0);
  float l0 = floor(l);
  float fr = l - l0;
  float s0 = 4.0 * exp2(l0);
  float a = rippleOct(p, s0);
  float b = rippleOct(p + 37.0, s0 * 2.0);
  float clump = smoothstep(uDense, uDense + 0.22, wnoise(p / (target * 20.0) + 3.1));
  return mix(a, b, smoothstep(0.0, 1.0, fr)) * clump;
}

//// ---- 上面是声明和水纹的函数，下面是换掉 map_fragment 的正文 ----

        vec2 huv = clamp((vWPos.xz - uCrop.xy) * uCrop.zw, 0.0, 1.0);
        vec4 hTex = texture2D(uH, huv);
        float ground = hTex.r + uDatum;
        // 水漫不进去的地方：uDry.x 是平时的水位。主水面（uDry.y 是 0）在水位高过平时以后不画这些地方；
        // dry 那一片（uDry.y 是 1）反过来，只画这些地方。
        float dryHere = step(0.5, hTex.g);
        // 窄的水道（壕）：水位在平时上下才算，水漫开以后和别处一样
        float narrow = hTex.b * (1.0 - smoothstep(uDry.x + 0.3, uDry.x + 1.2, uLevel));
        float noWater = uDry.y > 0.5 ? 1.0 - dryHere : dryHere * step(uDry.x + 0.01, uLevel);
        if (noWater > 0.5) discard;
        float depth = uLevel - ground;
        float a = smoothstep(-0.05, 0.5, depth);
        if (a < 0.004) discard;
        float surfY = (uLevel - uDatum) * uEx;
        float isSide = step(vWPos.y, surfY - 0.05);
        if (vWPos.y < (ground - uDatum) * uEx) discard;
        float dk = 1.0 - exp(-max(depth, 0.0) * 0.42);
        // 平时的河用深一点的花青，大水是一大片淡的
        vec3 wc = mix(mix(uShallowCalm, uShallow, uFlood), mix(uDeepCalm, uDeep, uFlood), dk);
        float fringe = (1.0 - smoothstep(0.15, 1.25, depth)) * (1.0 - 0.75 * narrow);
        wc = mix(wc, uFoam, fringe * 0.62);
        float rp = ripples(vWPos.xz) * (1.0 - isSide) * (1.0 - narrow);
        // 急滩：乱石滩上白浪多
        vec2 fdir = uRapidsDir;
        vec2 rd = vWPos.xz - uRapids.xy;
        float rap = uRapids.z > 0.0 ? 1.0 - smoothstep(0.45, 1.0, length(vec2(dot(rd, vec2(fdir.y, -fdir.x)) * 1.5, dot(rd, fdir))) / uRapids.z) : 0.0;
        float px = max(fwidth(vWPos.x), fwidth(vWPos.z)) * uPx;
        vec2 rq = vec2(dot(vWPos.xz, vec2(fdir.y, -fdir.x)) / 11.0, dot(vWPos.xz, fdir) / 58.0);
        // 白浪比平常的水纹宽、白：乱石中间一道一道的，看得出水在这里是急的；镜头远了连成淡淡的一片白
        float blur = smoothstep(7.0, 18.0, px);
        float streak = smoothstep(0.38, 0.6, wnoise(rq)) * (1.0 - blur);
        float white = rap * (streak * 0.95 + 0.45 * blur) * (1.0 - isSide) * (1.0 - uFlood);
        wc = mix(wc, uFoam, max(rp * (0.66 - 0.25 * fringe), white * 0.86));
        float sheen = pow(1.0 - abs(dot(normalize(vViewPosition), normalize(vNormal))), 4.0) * (1.0 - isSide);
        wc = mix(wc, uFoam, sheen * 0.22);
        wc = mix(wc, uDeep * 0.9, isSide * 0.5);
        diffuseColor.rgb = wc;
        diffuseColor.a = a * mix(0.8, 0.95, dk);
        