// 装裱和座子：地形板四周一圈浅色绫边，外面是紫檀的框和须弥座式的矮座。

import * as THREE from 'three';
import { CROP, PAL } from './config.js';
import { FB, box, T, brocadeTexture, woodTexture } from './geo.js';
import { BLOCK_BASE_Y } from './terrain.js';

export const BORDER = 620;
export const STAND_OUT = 880;
export const FLOOR_Y = BLOCK_BASE_Y - 600;

export function buildTable() {
  const group = new THREE.Group();
  const B = BLOCK_BASE_Y;
  const cx = (CROP.x0 + CROP.x1) / 2;
  const cz = (CROP.z0 + CROP.z1) / 2;
  const hx = (CROP.x1 - CROP.x0) / 2;
  const hz = (CROP.z1 - CROP.z0) / 2;

  // 绫边
  const bro = brocadeTexture(PAL.brocade, PAL.brocadeFig);
  const bw = 2 * (hx + BORDER + 4);
  const bd = 2 * (hz + BORDER + 4);
  const bgeo = new THREE.PlaneGeometry(bw, bd);
  bgeo.rotateX(-Math.PI / 2);
  const buv = bgeo.attributes.uv;
  for (let i = 0; i < buv.count; i++) buv.setXY(i, (buv.getX(i) * bw) / 300, (buv.getY(i) * bd) / 300);
  const border = new THREE.Mesh(bgeo, new THREE.MeshLambertMaterial({ map: bro }));
  border.position.set(cx, B + 0.5, cz);
  border.receiveShadow = true;
  group.add(border);

  // 紫檀框和座：一圈截面
  const prof = [
    [BORDER, B],
    [BORDER, B + 64],
    [BORDER + 34, B + 88],
    [BORDER + 250, B + 88],
    [BORDER + 284, B + 64],
    [BORDER + 284, B - 70],
    [BORDER + 224, B - 70],
    [BORDER + 224, B - 250],
    [BORDER + 330, B - 250],
    [BORDER + 356, B - 282],
    [BORDER + 356, B - 440],
    [BORDER + 322, B - 482],
  ];
  const fb = new FB();
  const sides = [
    { o: [0, 1], a: [1, 0], ho: hz, ha: hx },
    { o: [1, 0], a: [0, -1], ho: hx, ha: hz },
    { o: [0, -1], a: [-1, 0], ho: hz, ha: hx },
    { o: [-1, 0], a: [0, 1], ho: hx, ha: hz },
  ];
  let acc = 0;
  for (let i = 0; i < prof.length - 1; i++) {
    const [d0, y0] = prof[i];
    const [d1, y1] = prof[i + 1];
    const dd = d1 - d0;
    const dy = y1 - y0;
    const len = Math.hypot(dd, dy);
    const nd = -dy / len;
    const ny = dd / len;
    for (const s of sides) {
      const P = (d, y, e) => [cx + s.o[0] * (s.ho + d) + s.a[0] * e * (s.ha + d), y, cz + s.o[1] * (s.ho + d) + s.a[1] * e * (s.ha + d)];
      const L0 = 2 * (s.ha + d0);
      const L1 = 2 * (s.ha + d1);
      fb.quad(
        P(d0, y0, -1),
        P(d0, y0, 1),
        P(d1, y1, 1),
        P(d1, y1, -1),
        [s.o[0] * nd, ny, s.o[1] * nd],
        [[-L0 / 2 / 900, acc / 900], [L0 / 2 / 900, acc / 900], [L1 / 2 / 900, (acc + len) / 900], [-L1 / 2 / 900, (acc + len) / 900]],
      );
    }
    acc += len;
  }
  const wood = new THREE.MeshStandardMaterial({ color: PAL.sandal, map: woodTexture(), roughness: 0.5, metalness: 0.0, envMapIntensity: 0.55 });
  const frame = new THREE.Mesh(fb.geo(), wood);
  frame.castShadow = true;
  frame.receiveShadow = true;
  group.add(frame);

  // 框面上嵌一道黄杨木细线
  const line = new FB();
  for (const s of sides) {
    const P = (d, e) => [cx + s.o[0] * (s.ho + d) + s.a[0] * e * (s.ha + d), B + 88.8, cz + s.o[1] * (s.ho + d) + s.a[1] * e * (s.ha + d)];
    line.quad(P(BORDER + 96, -1), P(BORDER + 96, 1), P(BORDER + 124, 1), P(BORDER + 124, -1), [0, 1, 0]);
  }
  const inlay = new THREE.Mesh(line.geo(), new THREE.MeshLambertMaterial({ color: '#b3925c' }));
  inlay.receiveShadow = true;
  group.add(inlay);

  // 四只矮脚
  const feet = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const g = box(620, 120, 620);
    g.applyMatrix4(T(cx + sx * (hx + BORDER + 20), B - 600, cz + sz * (hz + BORDER + 20)));
    feet.push(g);
  }
  for (const g of feet) {
    const m = new THREE.Mesh(g, wood);
    m.castShadow = true;
    group.add(m);
  }

  // 座子落在案上的影子：一块柔和的暗影
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g2 = c.getContext('2d');
  const sw = hx + STAND_OUT;
  const sd = hz + STAND_OUT;
  const pad = 2600;
  const fw = 2 * (sw + pad);
  const fd = 2 * (sd + pad);
  const img = g2.createImageData(256, 256);
  for (let j = 0; j < 256; j++) {
    for (let i = 0; i < 256; i++) {
      const x = (i / 255 - 0.5) * fw;
      const z = (j / 255 - 0.5) * fd;
      const dx = Math.max(Math.abs(x) - sw, 0);
      const dz = Math.max(Math.abs(z) - sd, 0);
      const d = Math.hypot(dx, dz);
      const a = Math.pow(Math.max(0, 1 - d / pad), 2.4) * 0.62;
      const k = (j * 256 + i) * 4;
      img.data[k] = 46;
      img.data[k + 1] = 30;
      img.data[k + 2] = 16;
      img.data[k + 3] = Math.round(a * 255);
    }
  }
  g2.putImageData(img, 0, 0);
  const st = new THREE.CanvasTexture(c);
  st.colorSpace = THREE.SRGBColorSpace;
  const sgeo = new THREE.PlaneGeometry(fw, fd);
  sgeo.rotateX(-Math.PI / 2);
  const shadow = new THREE.Mesh(sgeo, new THREE.MeshBasicMaterial({ map: st, transparent: true, depthWrite: false }));
  shadow.position.set(cx + 500, FLOOR_Y, cz + 420);
  shadow.renderOrder = -1;
  group.add(shadow);

  return { group, wood };
}
