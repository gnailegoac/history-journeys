// 出图的最后一步，只有一趟：按远近做一点虚化（盘的近边和远边发软），再压亮部、转成屏幕颜色。
import * as THREE from 'three';

export function makePost(renderer) {
  const size = new THREE.Vector2();
  renderer.getDrawingBufferSize(size);
  const target = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    samples: 4,
    depthBuffer: true,
    depthTexture: new THREE.DepthTexture(size.x, size.y),
  });
  // 带逐级缩小的副本：虚化时每个取样点读的是一小片的平均，颗粒就没有了，取样点也可以少
  target.texture.generateMipmaps = true;
  target.texture.minFilter = THREE.LinearMipmapLinearFilter;
  target.texture.magFilter = THREE.LinearFilter;

  const uniforms = {
    tColor: { value: target.texture },
    tDepth: { value: target.depthTexture },
    uPx: { value: new THREE.Vector2(1 / size.x, 1 / size.y) },
    uNear: { value: 1 },
    uFar: { value: 1000 },
    uFocus: { value: 100 },
    uDead: { value: 10 },
    uRange: { value: 50 },
    uMaxBlur: { value: 5 },
    uVignette: { value: 0.16 },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform sampler2D tColor;
      uniform sampler2D tDepth;
      uniform vec2 uPx;
      uniform float uNear;
      uniform float uFar;
      uniform float uFocus;
      uniform float uDead;
      uniform float uRange;
      uniform float uMaxBlur;
      uniform float uVignette;
      uniform vec2 uCenter;
      float viewZ(vec2 uv) {
        float z = texture2D(tDepth, uv).x;
        return uNear * uFar / (uFar - z * (uFar - uNear));
      }
      float coc(float d) {
        return clamp((abs(d - uFocus) - uDead) / uRange, 0.0, 1.0);
      }
      void main() {
        float d = viewZ(vUv);
        float r = coc(d) * uMaxBlur;
        vec3 col = textureLod(tColor, vUv, 0.0).rgb;
        if (r > 0.5) {
          // 每个取样点管圆盘的十四分之一，就读那么大一片的平均
          float lod = clamp(log2(max(r * 0.5, 1.0)), 0.0, 3.0);
          vec3 acc = textureLod(tColor, vUv, lod).rgb;
          float wsum = 1.0;
          float rot = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) * 6.2831853;
          for (int i = 0; i < 14; i++) {
            float fi = float(i) + 0.5;
            float rr = sqrt(fi / 14.0) * r;
            float th = fi * 2.39996323 + rot;
            vec2 suv = vUv + vec2(cos(th), sin(th)) * rr * uPx;
            float sd = viewZ(suv);
            float sr = coc(sd) * uMaxBlur;
            float w = sd >= d ? 1.0 : clamp(sr - rr + 1.0, 0.0, 1.0);
            acc += textureLod(tColor, suv, lod).rgb * w;
            wsum += w;
          }
          col = acc / wsum;
        }
        vec2 q = (vUv - uCenter) * vec2(1.0, uPx.x / uPx.y);
        col *= 1.0 - uVignette * smoothstep(0.22, 0.95, length(q) * 1.15);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        // 一点点抖动，免得大片浅色出现色带
        float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
        gl_FragColor.rgb += (n - 0.5) / 255.0;
      }`,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const postScene = new THREE.Scene();
  postScene.add(quad);
  const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  return {
    target,
    uniforms,
    setSize() {
      renderer.getDrawingBufferSize(size);
      target.setSize(size.x, size.y);
      uniforms.uPx.value.set(1 / size.x, 1 / size.y);
    },
    render(scene, camera) {
      uniforms.uNear.value = camera.near;
      uniforms.uFar.value = camera.far;
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(postScene, postCam);
    },
  };
}
