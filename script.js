// =====================================================================
//  HATA YAKALAYICI
// =====================================================================
window.addEventListener('error', e => {
  const box = document.getElementById('errbox');
  if (!box) return;
  box.style.display = 'block';
  box.textContent = '⚠ HATA: ' + e.message +
    '\nDosya: ' + (e.filename ? e.filename.split('/').pop() : '?') +
    '  Satır: ' + e.lineno;
  const l = document.getElementById('loading');
  if (l) l.classList.add('hide');
});

// =====================================================================
//  RENDERER & SAHNE
// =====================================================================
const container = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);
const canvas = renderer.domElement;

const scene = new THREE.Scene();
const BG = 0x120b12;
scene.background = new THREE.Color(BG);
scene.fog = new THREE.Fog(BG, 9, 20);

const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.1, 100);
const camTarget = new THREE.Vector3(0, 0.9, 0);
const camDir = new THREE.Vector3(0, 2.4, 7).normalize();
const camBase = new THREE.Vector3();

// =====================================================================
//  STÜDYO ORTAMI
// =====================================================================
const pmrem = new THREE.PMREMGenerator(renderer);
function buildEnvironment() {
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(
    new THREE.BoxGeometry(12, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0x221a20, side: THREE.BackSide })
  ));
  const o = new THREE.Vector3();
  const panel = (w, h, pos, intensity, color = 0xffffff) => {
    const m = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    m.color.set(color).multiplyScalar(intensity);
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
    p.position.copy(pos); p.lookAt(o); env.add(p);
  };
  panel(6, 3, new THREE.Vector3(0, 5.5, 1), 6);
  panel(3, 4, new THREE.Vector3(5.5, 2, 3), 4, 0xfff1dd);
  panel(2, 4, new THREE.Vector3(-5.5, 2, -1), 2.5, 0xffd6ea);
  panel(4, 1, new THREE.Vector3(0, 1, -5.5), 1.5);
  return pmrem.fromScene(env, 0.03).texture;
}
scene.environment = buildEnvironment();

// =====================================================================
//  IŞIKLAR
// =====================================================================
scene.add(new THREE.HemisphereLight(0xffe9f2, 0x1a0f14, 0.3));

const spot = new THREE.SpotLight(0xfff1e0, 3.2, 25, Math.PI / 7, 0.8, 1.2);
spot.position.set(2.5, 8, 4.5);
spot.target.position.set(0, 0.5, 0);
spot.castShadow = true;
spot.shadow.mapSize.set(2048, 2048);
spot.shadow.bias = -0.0004;
spot.shadow.normalBias = 0.02;
spot.shadow.camera.near = 2;
spot.shadow.camera.far = 20;
scene.add(spot, spot.target);

const rim = new THREE.DirectionalLight(0xffc4e1, 0.8);
rim.position.set(-4, 3, -5);
scene.add(rim);

const fill = new THREE.DirectionalLight(0xd9e2ff, 0.25);
fill.position.set(-5, 2, 4);
scene.add(fill);

const flashes = [0, 1, 2, 3].map(() => {
  const l = new THREE.PointLight(0xffd9a0, 0, 14, 2);
  scene.add(l);
  return l;
});
let flashIdx = 0;

// =====================================================================
//  ZEMİN
// =====================================================================
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 60),
  new THREE.MeshStandardMaterial({ color: 0x1c1219, roughness: 0.82, envMapIntensity: 0.4 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// =====================================================================
//  YUMUŞAK KENARLI (ROUNDED) KUTU GEOMETRİSİ
// =====================================================================
function roundedBoxGeometry(w, h, d, r, seg) {
  seg = seg || 4;
  r = Math.min(r, w / 2, h / 2, d / 2);
  const geo = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
  const pos = geo.attributes.position;
  const hw = Math.max(w / 2 - r, 0.0001);
  const hh = Math.max(h / 2 - r, 0.0001);
  const hd = Math.max(d / 2 - r, 0.0001);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const cx = THREE.MathUtils.clamp(v.x, -hw, hw);
    const cy = THREE.MathUtils.clamp(v.y, -hh, hh);
    const cz = THREE.MathUtils.clamp(v.z, -hd, hd);
    const dx = v.x - cx, dy = v.y - cy, dz = v.z - cz;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len > 1e-6) {
      const s = r / len;
      v.set(cx + dx * s, cy + dy * s, cz + dz * s);
    } else {
      v.set(cx, cy, cz);
    }
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

// =====================================================================
//  DOKULAR
// =====================================================================
function canvasTex(size, draw, srgb = true, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  if (srgb) t.encoding = THREE.sRGBEncoding;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const paperTex = canvasTex(512, (g, s) => {
  g.fillStyle = '#8a1c43';
  g.fillRect(0, 0, s, s);
  g.fillStyle = 'rgba(255,255,255,0.05)';
  const step = 32;
  for (let y = 0; y <= s; y += step) {
    for (let x = 0; x <= s; x += step) {
      const ox = (y / step) % 2 ? step / 2 : 0;
      g.beginPath();
      g.moveTo(x + ox, y - 6); g.lineTo(x + ox + 6, y);
      g.lineTo(x + ox, y + 6); g.lineTo(x + ox - 6, y);
      g.fill();
    }
  }
  const img = g.getImageData(0, 0, s, s);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 14;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}, true, 2);

const grainTex = canvasTex(256, (g, s) => {
  const img = g.createImageData(s, s);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 128 + (Math.random() - 0.5) * 90;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}, false, 4);

const satinTex = canvasTex(256, (g, s) => {
  for (let x = 0; x < s; x++) {
    const v = Math.floor(128 + (Math.random() - 0.5) * 60);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(x, 0, 1, s);
  }
}, false);

const softTex = canvasTex(64, (g, s) => {
  const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,0.8)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, s, s);
}, false);

const candleTex = canvasTex(128, (g, s) => {
  g.fillStyle = '#b5173f';
  g.fillRect(0, 0, s, s);
  g.fillStyle = '#e3c27e';
  for (let y = 0; y < s; y += 22) g.fillRect(0, y, s, 10);
}, true, 1);

const tagTex = canvasTex(512, (g, s) => {
  roundRectPath(g, 14, 14, s - 28, s - 28, 46);
  g.fillStyle = '#f6eee1';
  g.fill();
  g.lineWidth = 7;
  g.strokeStyle = '#d9b46a';
  roundRectPath(g, 14, 14, s - 28, s - 28, 46);
  g.stroke();
  g.fillStyle = '#8a1c43';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'italic 600 56px Georgia, serif';
  g.fillText('Süslü', s / 2, s / 2 - 40);
  g.fillText('Hediyeliklerim', s / 2, s / 2 + 36);
}, true, 1);

const shadowBlobTex = canvasTex(256, (g, s) => {
  const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, 'rgba(0,0,0,0.55)');
  gr.addColorStop(0.55, 'rgba(0,0,0,0.22)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, s, s);
}, false);

const furTex = canvasTex(128, (g, s) => {
  g.fillStyle = '#ffd7e0';
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(255,255,255,${Math.random() * 0.18})`;
    const x = Math.random() * s, y = Math.random() * s;
    g.beginPath(); g.arc(x, y, Math.random() * 1.6, 0, Math.PI * 2); g.fill();
  }
}, true, 1);

// =====================================================================
//  MALZEMELER
// =====================================================================
const paperMat = new THREE.MeshPhysicalMaterial({
  map: paperTex, bumpMap: grainTex, bumpScale: 0.003,
  roughness: 0.58, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.45
});
const liningMat = new THREE.MeshStandardMaterial({
  color: 0xf3e9d8, roughness: 0.95, bumpMap: grainTex, bumpScale: 0.002
});
const edgeMat = new THREE.MeshStandardMaterial({ color: 0xe6d9c3, roughness: 0.9 });
const ribbonMat = new THREE.MeshPhysicalMaterial({
  color: 0xd9b46a, metalness: 0.55, roughness: 0.3,
  clearcoat: 0.5, clearcoatRoughness: 0.2,
  bumpMap: satinTex, bumpScale: 0.002, side: THREE.DoubleSide
});
const candleMat = new THREE.MeshStandardMaterial({ map: candleTex, roughness: 0.5, metalness: 0.1 });
const fuseMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 0.9 });
const tagMat = new THREE.MeshStandardMaterial({ map: tagTex, roughness: 0.6, metalness: 0 });
const tagEdgeMat = new THREE.MeshStandardMaterial({ color: 0xd9b46a, roughness: 0.5, metalness: 0.3 });

const furMat = new THREE.MeshStandardMaterial({ map: furTex, roughness: 0.92, metalness: 0 });
const eyeMat = new THREE.MeshStandardMaterial({ color: 0x2a1a2a, roughness: 0.3, metalness: 0.1 });
const cheekMat = new THREE.MeshStandardMaterial({ color: 0xff95a8, roughness: 1, transparent: true, opacity: 0.55 });
const mouthMat = new THREE.MeshStandardMaterial({ color: 0x5a2a3a, roughness: 0.6 });
const stringMat = new THREE.MeshStandardMaterial({ color: 0xcfa864, roughness: 0.7 });

// =====================================================================
//  FİZİK DÜNYASI (Cannon.js)
// =====================================================================
const world = new CANNON.World();
world.gravity.set(0, -9.82, 0);
world.broadphase = new CANNON.NaiveBroadphase();
world.solver.iterations = 20;
world.allowSleep = false;
world.defaultContactMaterial.friction = 0.35;
world.defaultContactMaterial.restitution = 0.18;

function staticPlane(axis, angle) {
  const b = new CANNON.Body({ mass: 0 });
  b.addShape(new CANNON.Plane());
  b.quaternion.setFromAxisAngle(axis, angle);
  world.addBody(b);
  return b;
}
const AX = new CANNON.Vec3(1, 0, 0), AY = new CANNON.Vec3(0, 1, 0);
staticPlane(AX, -Math.PI / 2);
const wallL = staticPlane(AY, Math.PI / 2);
const wallR = staticPlane(AY, -Math.PI / 2);
const wallB = staticPlane(AY, 0);
const wallF = staticPlane(AY, Math.PI);
const ceil  = staticPlane(AX, Math.PI / 2);
const bounds = { x: 3, y: 3, zf: 2.2, zb: -2.6 };

function layout() {
  const aspect = innerWidth / innerHeight;
  camera.aspect = aspect;
  const halfTan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const dist = Math.max(7.6, 2.5 / (halfTan * aspect));
  camBase.copy(camTarget).addScaledVector(camDir, dist);
  camera.position.copy(camBase);
  camera.lookAt(camTarget);
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);

  const halfH = halfTan * dist, halfW = halfH * aspect;
  bounds.x = halfW * 0.88;
  bounds.y = camTarget.y + halfH * 0.8;
  wallL.position.set(-bounds.x, 0, 0);
  wallR.position.set(bounds.x, 0, 0);
  wallB.position.set(0, 0, bounds.zb);
  wallF.position.set(0, 0, bounds.zf);
  ceil.position.set(0, bounds.y, 0);
}
layout();
addEventListener('resize', layout);

// =====================================================================
//  KUTU ÖLÇÜLERİ
// =====================================================================
const W = 1.6, D = 1.6, H = 1.0, T = 0.04;
const LW = W + 0.1, LD = D + 0.1, SH = 0.3, LT = 0.045, ST = 0.03;
const RW = 0.16;

function faceMats(inner, edge) {
  const m = Array(6).fill(paperMat);
  m[inner] = liningMat;
  if (edge !== undefined) m[edge] = edgeMat;
  return m;
}
function part(group, body, hx, hy, hz, x, y, z, mats) {
  const r = Math.min(hx, hy, hz) * 0.55;
  const geo = roundedBoxGeometry(hx * 2, hy * 2, hz * 2, Math.max(r, 0.006), 4);
  const mesh = new THREE.Mesh(geo, mats);
  mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
  body.addShape(new CANNON.Box(new CANNON.Vec3(hx, hy, hz)), new CANNON.Vec3(x, y, z));
}
function deco(group, w, h, d, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), ribbonMat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  group.add(m);
}
function makeContactShadow(size) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ map: shadowBlobTex, transparent: true, depthWrite: false, opacity: 0.6 })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.003;
  scene.add(m);
  return m;
}

// =====================================================================
//  KUTU
// =====================================================================
const boxGroup = new THREE.Group();
scene.add(boxGroup);
const boxBody = new CANNON.Body({ mass: 4, linearDamping: 0.05, angularDamping: 0.12 });

part(boxGroup, boxBody, W / 2, T / 2, D / 2, 0, -H / 2 + T / 2, 0, faceMats(2));
part(boxGroup, boxBody, T / 2, H / 2, D / 2, -W / 2 + T / 2, 0, 0, faceMats(0, 2));
part(boxGroup, boxBody, T / 2, H / 2, D / 2,  W / 2 - T / 2, 0, 0, faceMats(1, 2));
part(boxGroup, boxBody, W / 2 - T, H / 2, T / 2, 0, 0,  D / 2 - T / 2, faceMats(5, 2));
part(boxGroup, boxBody, W / 2 - T, H / 2, T / 2, 0, 0, -D / 2 + T / 2, faceMats(4, 2));

boxBody.position.set(0, H / 2, 0);
world.addBody(boxBody);

deco(boxGroup, RW, H, 0.006, 0, 0,  D / 2 + 0.004);
deco(boxGroup, RW, H, 0.006, 0, 0, -D / 2 - 0.004);
deco(boxGroup, 0.006, H, RW, -W / 2 - 0.004, 0, 0);
deco(boxGroup, 0.006, H, RW,  W / 2 + 0.004, 0, 0);

const innerLight = new THREE.PointLight(0xffe2b8, 0, 1.5, 2);
innerLight.position.set(0, 0.1, 0);
boxGroup.add(innerLight);

const boxShadowBlob = makeContactShadow(2.3);

// =====================================================================
//  KAPAK
// =====================================================================
const lidGroup = new THREE.Group();
scene.add(lidGroup);
const lidBody = new CANNON.Body({ mass: 0.7, linearDamping: 0.05, angularDamping: 0.12 });

part(lidGroup, lidBody, LW / 2, LT / 2, LD / 2, 0, SH / 2 - LT / 2, 0, faceMats(3));
part(lidGroup, lidBody, ST / 2, SH / 2, LD / 2, -LW / 2 + ST / 2, 0, 0, faceMats(0, 3));
part(lidGroup, lidBody, ST / 2, SH / 2, LD / 2,  LW / 2 - ST / 2, 0, 0, faceMats(1, 3));
part(lidGroup, lidBody, LW / 2 - ST, SH / 2, ST / 2, 0, 0,  LD / 2 - ST / 2, faceMats(5, 3));
part(lidGroup, lidBody, LW / 2 - ST, SH / 2, ST / 2, 0, 0, -LD / 2 + ST / 2, faceMats(4, 3));

lidBody.position.set(0, H - SH / 2 + LT + 0.003, 0);
world.addBody(lidBody);

const TOP = SH / 2;
deco(lidGroup, LW + 0.006, 0.006, RW, 0, TOP + 0.003, 0);
deco(lidGroup, RW, 0.007, LD + 0.006, 0, TOP + 0.0035, 0);
deco(lidGroup, RW, SH, 0.006, 0, 0,  LD / 2 + 0.003);
deco(lidGroup, RW, SH, 0.006, 0, 0, -LD / 2 - 0.003);
deco(lidGroup, 0.006, SH, RW, -LW / 2 - 0.003, 0, 0);
deco(lidGroup, 0.006, SH, RW,  LW / 2 + 0.003, 0, 0);

const tagGeo = new THREE.BoxGeometry(0.52, 0.02, 0.34);
const tagMats = [tagEdgeMat, tagEdgeMat, tagMat, tagEdgeMat, tagEdgeMat, tagEdgeMat];
const tag = new THREE.Mesh(tagGeo, tagMats);
tag.position.set(0.5, TOP + 0.013, -0.46);
tag.rotation.y = -0.12;
tag.castShadow = tag.receiveShadow = true;
lidGroup.add(tag);

const lidShadowBlob = makeContactShadow(1.7);

// =====================================================================
//  3D FİYONK
// =====================================================================
function ribbonGeo(pts, width) {
  const s = new THREE.Shape(), w = width / 2, t = 0.006;
  s.moveTo(-t, -w); s.lineTo(t, -w); s.lineTo(t, w); s.lineTo(-t, w); s.lineTo(-t, -w);
  const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p[0], p[1], p[2])));
  return new THREE.ExtrudeGeometry(s, { steps: 120, bevelEnabled: false, extrudePath: curve });
}

const bow = new THREE.Group();
const loopGeo = ribbonGeo([
  [0, 0.02, 0], [0.07, 0.11, 0], [0.2, 0.2, 0], [0.35, 0.18, 0],
  [0.42, 0.09, 0], [0.36, 0.02, 0], [0.18, 0.015, 0], [0.03, 0.02, 0]
], 0.14);

[[0, 1, 0.25], [Math.PI, 1, 0.25], [Math.PI / 2, 0.82, 0.45], [-Math.PI / 2, 0.82, 0.45]]
  .forEach(([ry, sc, tilt]) => {
    const pivot = new THREE.Group();
    pivot.rotation.y = ry;
    const m = new THREE.Mesh(loopGeo, ribbonMat);
    m.rotation.z = tilt;
    m.scale.setScalar(sc);
    m.castShadow = true;
    pivot.add(m);
    bow.add(pivot);
  });

const tailGeo = ribbonGeo([
  [0, 0.012, 0], [0.12, 0.009, 0.05], [0.3, 0.007, 0.12], [0.5, 0.007, 0.16], [0.62, 0.007, 0.17]
], 0.12);
[0.6, Math.PI + 0.4].forEach(ry => {
  const m = new THREE.Mesh(tailGeo, ribbonMat);
  m.rotation.y = ry;
  m.castShadow = true;
  bow.add(m);
});

const knot0 = new THREE.Mesh(new THREE.SphereGeometry(0.07, 24, 16), ribbonMat);
knot0.scale.set(1.1, 0.75, 1.3);
knot0.position.y = 0.04;
knot0.castShadow = true;
bow.add(knot0);

bow.position.y = TOP + 0.007;
lidGroup.add(bow);

// =====================================================================
//  HAVADA SÜZÜLEN TOZ
// =====================================================================
const DUST = 220;
const dustPos = new Float32Array(DUST * 3);
const dustSeed = [];
for (let i = 0; i < DUST; i++) {
  dustPos[i * 3] = (Math.random() - 0.5) * 8;
  dustPos[i * 3 + 1] = Math.random() * 4;
  dustPos[i * 3 + 2] = (Math.random() - 0.5) * 4;
  dustSeed.push(Math.random() * 100);
}
const dustGeo = new THREE.BufferGeometry();
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
scene.add(new THREE.Points(dustGeo, new THREE.PointsMaterial({
  size: 0.03, map: softTex, color: 0xffe8d0, transparent: true, opacity: 0.35,
  depthWrite: false, blending: THREE.AdditiveBlending
})));

// =====================================================================
//  PARÇACIK SİSTEMİ (havai fişek)
// =====================================================================
class Sparks {
  constructor(max, size) {
    this.max = max; this.p = [];
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.geo.setDrawRange(0, 0);
    const mat = new THREE.PointsMaterial({
      size, map: softTex, vertexColors: true, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending
    });
    const pts = new THREE.Points(this.geo, mat);
    pts.frustumCulled = false;
    scene.add(pts);
  }
  add(x, y, z, vx, vy, vz, c, life, drag = 1, grav = -3, twinkle = false) {
    if (this.p.length >= this.max) return;
    this.p.push({ x, y, z, vx, vy, vz, r: c.r, g: c.g, b: c.b, life, age: 0, drag, grav, twinkle });
  }
  update(dt) {
    const P = this.p;
    for (let i = P.length - 1; i >= 0; i--) {
      const q = P[i];
      q.age += dt;
      if (q.age >= q.life) { P[i] = P[P.length - 1]; P.pop(); continue; }
      const k = Math.max(0, 1 - q.drag * dt);
      q.vx *= k; q.vy *= k; q.vz *= k;
      q.vy += q.grav * dt;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
    }
    for (let i = 0; i < P.length; i++) {
      const q = P[i];
      let a = 1 - q.age / q.life; a *= a;
      if (q.twinkle && Math.random() < 0.35) a *= 0.15;
      this.pos[i * 3] = q.x; this.pos[i * 3 + 1] = q.y; this.pos[i * 3 + 2] = q.z;
      this.col[i * 3] = q.r * a; this.col[i * 3 + 1] = q.g * a; this.col[i * 3 + 2] = q.b * a;
    }
    this.geo.setDrawRange(0, P.length);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}
const sparks = new Sparks(6000, 0.09);

const WARM = new THREE.Color().setRGB(1.6, 1.0, 0.45);
const HOT = new THREE.Color().setRGB(2.0, 1.8, 1.5);
const WHITE = new THREE.Color().setRGB(1.6, 1.5, 1.3);
const palettes = [
  [0xf3cf7a, 0xfff2d6], [0xff5fa8, 0xffd1e6],
  [0xf3cf7a, 0xff5fa8], [0xc9a0ff, 0xfff2d6]
].map(a => a.map(c => new THREE.Color(c)));

const rockets = [];
function launchRocket(from, to, palette, onBurst) {
  const g = 9;
  const h = Math.max(to.y - from.y, 0.5);
  const vy = Math.sqrt(2 * g * h);
  const tt = vy / g;
  rockets.push({
    p: from.clone(),
    v: new THREE.Vector3((to.x - from.x) / tt, vy, (to.z - from.z) / tt),
    g, t: 0, tt, palette, onBurst
  });
}

function burst(p, pal) {
  for (let i = 0; i < 220; i++) {
    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    const sp = 2.6 + Math.random() * 0.6;
    const c = Math.random() < 0.15 ? WHITE : pal[Math.random() < 0.6 ? 0 : 1];
    sparks.add(p.x, p.y, p.z, s * Math.cos(th) * sp, u * sp, s * Math.sin(th) * sp,
      c, 1.3 + Math.random() * 0.9, 1.6, -2.2, Math.random() < 0.5);
  }
  for (let i = 0; i < 30; i++) {
    sparks.add(p.x, p.y, p.z, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6,
      (Math.random() - 0.5) * 0.6, HOT, 0.25, 3, 0);
  }
  const l = flashes[flashIdx++ % flashes.length];
  l.position.copy(p);
  l.color.copy(pal[0]);
  l.intensity = 7;
}

function updateRockets(dt) {
  for (let i = rockets.length - 1; i >= 0; i--) {
    const r = rockets[i];
    r.t += dt;
    r.v.y -= r.g * dt;
    r.p.addScaledVector(r.v, dt);
    for (let k = 0; k < 4; k++) {
      sparks.add(r.p.x + (Math.random() - 0.5) * 0.02, r.p.y, r.p.z,
        (Math.random() - 0.5) * 0.4, -0.5 - Math.random() * 0.6, (Math.random() - 0.5) * 0.4,
        WARM, 0.35 + Math.random() * 0.3, 2, -1.5, true);
    }
    sparks.add(r.p.x, r.p.y, r.p.z, 0, 0, 0, HOT, 0.06, 0, 0);
    if (r.t >= r.tt) {
      burst(r.p, r.palette);
      if (r.onBurst) r.onBurst(r.p.clone());
      rockets.splice(i, 1);
    }
  }
}

// =====================================================================
//  DOM REFERANSLARI
// =====================================================================
const menuEl = document.getElementById('menu');
const menuItems = [...menuEl.querySelectorAll('.balloon-item')];
const priceTagEl = document.getElementById('priceTag');

// =====================================================================
//  KAPAK/KUTU YARDIMCILARI
// =====================================================================
function getOpening() {
  return boxGroup.localToWorld(new THREE.Vector3(0, H / 2 - 0.1, 0));
}
function lidOffBox() {
  const rel = lidBody.position.vsub(boxBody.position);
  const l = boxBody.quaternion.inverse().vmult(rel);
  return Math.abs(l.x) > W * 0.55 || Math.abs(l.z) > D * 0.55 || l.y > H / 2 + 0.55;
}
function isOutsideBox(pos) {
  const rel = pos.vsub(boxBody.position);
  const l = boxBody.quaternion.inverse().vmult(rel);
  const m = 0.03;
  return Math.abs(l.x) > W / 2 - m || Math.abs(l.z) > D / 2 - m ||
         l.y < -H / 2 - m || l.y > H / 2 + m;
}

function flyMenuItem(el, pos) {
  const v = pos.clone().project(camera);
  const sx = (v.x + 1) / 2 * innerWidth;
  const sy = (1 - v.y) / 2 * innerHeight;
  const r = el.getBoundingClientRect();
  const dx = sx - (r.left + r.width / 2);
  const dy = sy - (r.top + r.height / 2);
  const anim = el.animate([
    { transform: `translate(${dx}px,${dy}px) scale(.2)`, opacity: 0, filter: 'blur(8px)' },
    { transform: `translate(${dx}px,${dy}px) scale(1.15)`, opacity: 1, filter: 'blur(0px)', offset: 0.22 },
    { transform: `translate(${dx}px,${dy}px) scale(1)`, opacity: 1, filter: 'blur(0px)', offset: 0.42 },
    { transform: 'translate(0px,0px) scale(1)', opacity: 1, filter: 'blur(0px)' }
  ], { duration: 1700, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' });

  el.classList.add('lit');
  anim.onfinish = () => {
    anim.cancel();
    el.classList.add('landed');
  };
}

let opened = false;
let escapedCount = 0;

function onLidOpen() {
  opened = true;
  const o = getOpening();
  for (let i = 0; i < 90; i++) {
    sparks.add(o.x + (Math.random() - 0.5) * W * 0.6, o.y, o.z + (Math.random() - 0.5) * D * 0.6,
      (Math.random() - 0.5) * 0.25, 0.5 + Math.random() * 0.9, (Math.random() - 0.5) * 0.25,
      WARM, 1.0 + Math.random() * 0.6, 0.9, 0.3, true);
  }
}

// =====================================================================
//  TORPİL / MUM SİSTEMİ
// =====================================================================
class Candle {
  constructor(index, startPos) {
    this.index = index;
    this.state = 'inside';
    this.settleTimer = 0;
    this.burnTimer = 0;
    this.burnDuration = 1.1 + Math.random() * 0.6;

    const group = new THREE.Group();
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.22, 16), candleMat);
    stick.castShadow = stick.receiveShadow = true;
    group.add(stick);
    const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.008, 0.07, 8), fuseMat);
    fuse.position.y = 0.145;
    fuse.castShadow = true;
    group.add(fuse);
    this.mesh = group;
    scene.add(group);

    this.cbody = new CANNON.Body({ mass: 0.12, linearDamping: 0.4, angularDamping: 0.6 });
    this.cbody.addShape(new CANNON.Box(new CANNON.Vec3(0.055, 0.11, 0.055)));
    this.cbody.position.copy(startPos);
    this.cbody.angularFactor = new CANNON.Vec3(0, 1, 0);
    world.addBody(this.cbody);

    this.light = new THREE.PointLight(0xffb35c, 0, 1.6, 2);
    scene.add(this.light);
  }

  sync() {
    this.mesh.position.copy(this.cbody.position);
    this.mesh.quaternion.copy(this.cbody.quaternion);
  }

  topWorldPos() {
    return new THREE.Vector3(this.mesh.position.x, this.mesh.position.y + 0.19, this.mesh.position.z);
  }

  update(dt) {
    if (this.state === 'done') return;
    this.sync();

    if (this.state === 'inside' || this.state === 'falling') {
      if (isOutsideBox(this.cbody.position)) {
        this.state = 'falling';
        const v = this.cbody.velocity.length();
        const av = this.cbody.angularVelocity.length();
        if (v < 0.15 && av < 0.4) {
          this.settleTimer += dt;
          if (this.settleTimer > 0.35) {
            this.state = 'burning';
            this.burnTimer = 0;
            escapedCount++;
          }
        } else {
          this.settleTimer = 0;
        }
      }
    } else if (this.state === 'burning') {
      this.burnTimer += dt;
      const top = this.topWorldPos();
      this.light.position.copy(top);
      this.light.intensity = 1.1 + Math.sin(this.burnTimer * 40) * 0.25 + Math.random() * 0.15;
      for (let k = 0; k < 2; k++) {
        sparks.add(top.x + (Math.random() - 0.5) * 0.015, top.y, top.z + (Math.random() - 0.5) * 0.015,
          (Math.random() - 0.5) * 0.15, 0.5 + Math.random() * 0.4, (Math.random() - 0.5) * 0.15,
          WARM, 0.35 + Math.random() * 0.2, 2.2, 0.3, true);
      }
      if (this.burnTimer >= this.burnDuration) this.launch();
    }
  }

  launch() {
    this.state = 'done';
    this.light.intensity = 0;
    const from = this.topWorldPos();
    world.removeBody(this.cbody);
    scene.remove(this.mesh);

    if (!menuEl.classList.contains('show')) menuEl.classList.add('show');

    const el = menuItems[this.index];
    const n = menuItems.length;
    const spreadX = Math.min(bounds.x * 0.8, 2.6);
    const to = new THREE.Vector3(
      n > 1 ? -spreadX + 2 * spreadX * (this.index / (n - 1)) : 0,
      bounds.y - 0.65 + (this.index % 2 === 0 ? 0.05 : -0.08),
      -0.4
    );
    launchRocket(from, to, palettes[this.index % palettes.length], p => flyMenuItem(el, p));
  }
}

const candles = menuItems.map((el, i) => {
  const ang = (i / menuItems.length) * Math.PI * 2 + 0.4;
  const r = 0.32;
  const startPos = new CANNON.Vec3(Math.cos(ang) * r, 0.22, Math.sin(ang) * r);
  return new Candle(i, startPos);
});

// =====================================================================
//  3D ÜRÜN GÖSTERİSİ — Amigurumi bebek + balon (gerçek fizik, oynanabilir)
// =====================================================================
function buildAmigurumi() {
  const g = new THREE.Group();

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.22, 32, 24), furMat);
  body.scale.set(1, 1.15, 1);
  body.castShadow = body.receiveShadow = true;
  g.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 32, 24), furMat);
  head.position.y = 0.3;
  head.castShadow = head.receiveShadow = true;
  g.add(head);

  [-1, 1].forEach(side => {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.07, 20, 16), furMat);
    ear.position.set(side * 0.1, 0.44, -0.02);
    ear.scale.set(0.7, 1.3, 0.6);
    ear.rotation.z = side * 0.35;
    ear.castShadow = true;
    g.add(ear);

    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.018, 12, 10), eyeMat);
    eye.position.set(side * 0.06, 0.31, 0.145);
    g.add(eye);

    const cheek = new THREE.Mesh(new THREE.CircleGeometry(0.03, 16), cheekMat);
    cheek.position.set(side * 0.1, 0.27, 0.14);
    cheek.lookAt(cheek.position.clone().add(new THREE.Vector3(0, 0, 1)));
    g.add(cheek);

    const arm = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), furMat);
    arm.position.set(side * 0.22, 0.05, 0);
    arm.scale.set(0.8, 1.3, 0.8);
    arm.castShadow = true;
    g.add(arm);

    const leg = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), furMat);
    leg.position.set(side * 0.1, -0.26, 0.05);
    leg.scale.set(0.9, 0.8, 1);
    leg.castShadow = true;
    g.add(leg);
  });

  const mouthCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.025, 0.25, 0.155),
    new THREE.Vector3(0, 0.24, 0.16),
    new THREE.Vector3(0.025, 0.25, 0.155)
  ]);
  const mouth = new THREE.Mesh(new THREE.TubeGeometry(mouthCurve, 12, 0.004, 6, false), mouthMat);
  g.add(mouth);

  const bellyTag = new THREE.Mesh(new THREE.CircleGeometry(0.035, 20), new THREE.MeshStandardMaterial({ color: 0xfff6df, roughness: 0.6 }));
  bellyTag.position.set(0, 0, 0.215);
  g.add(bellyTag);

  return g;
}

function buildBalloon() {
  const g = new THREE.Group();
  const bMat = ribbonMat.clone();
  bMat.color.set(0xe85a7a);
  bMat.metalness = 0.1;
  bMat.roughness = 0.15;
  bMat.clearcoat = 0.6;

  const balloon = new THREE.Mesh(new THREE.SphereGeometry(0.19, 28, 22), bMat);
  balloon.scale.set(1, 1.15, 1);
  balloon.castShadow = true;
  g.add(balloon);

  const knot = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.045, 12), bMat);
  knot.position.y = -0.21;
  knot.rotation.x = Math.PI;
  g.add(knot);

  return g;
}

function makeRod() {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 1, 6), stringMat);
  scene.add(m);
  return m;
}
function placeRod(mesh, a, b) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = Math.max(dir.length(), 0.001);
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.scale.set(1, len, 1);
  const axis = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(axis, dir.clone().normalize());
  mesh.quaternion.copy(q);
}

let productDemo = null;

function spawnProduct() {
  if (productDemo) { destroyProduct(); return; }

  const dollGroup = buildAmigurumi();
  const balloonGroup = buildBalloon();
  scene.add(dollGroup, balloonGroup);

  const startX = 0.85, startZ = 0.55;
  const topY = bounds.y + 1.4;
  const restY = camTarget.y + 0.3;
  const ropeLen = 0.8;

  const dollBody = new CANNON.Body({ mass: 0.5, linearDamping: 0.5, angularDamping: 0.7 });
  dollBody.addShape(new CANNON.Sphere(0.22));
  dollBody.position.set(startX, topY - ropeLen, startZ);
  world.addBody(dollBody);

  const balloonBody = new CANNON.Body({ mass: 0.05, linearDamping: 0.6, angularDamping: 0.8 });
  balloonBody.addShape(new CANNON.Sphere(0.19));
  balloonBody.position.set(startX, topY, startZ);
  world.addBody(balloonBody);

  const rope = new CANNON.DistanceConstraint(balloonBody, dollBody, ropeLen, 60);
  world.addConstraint(rope);

  const rod = makeRod();

  dollGroup.userData.body = dollBody;
  balloonGroup.userData.body = balloonBody;
  grabbables.push(dollGroup, balloonGroup);

  productDemo = {
    dollGroup, balloonGroup, dollBody, balloonBody, rope, rod,
    entering: true, t: 0, duration: 1.5,
    from: new THREE.Vector3(startX, topY - ropeLen, startZ),
    to: new THREE.Vector3(startX, restY, startZ),
    settled: false
  };
}

function destroyProduct() {
  if (!productDemo) return;
  const d = productDemo;
  world.removeConstraint(d.rope);
  world.removeBody(d.dollBody);
  world.removeBody(d.balloonBody);
  scene.remove(d.dollGroup, d.balloonGroup, d.rod);
  const i1 = grabbables.indexOf(d.dollGroup); if (i1 >= 0) grabbables.splice(i1, 1);
  const i2 = grabbables.indexOf(d.balloonGroup); if (i2 >= 0) grabbables.splice(i2, 1);
  priceTagEl.classList.remove('show');
  productDemo = null;
}

function updateProduct(dt) {
  if (!productDemo) return;
  const d = productDemo;

  if (d.entering) {
    d.t += dt;
    const k = Math.min(d.t / d.duration, 1);
    const ease = 1 - Math.pow(1 - k, 3);
    const dollPos = d.from.clone().lerp(d.to, ease);
    d.dollBody.position.set(dollPos.x, dollPos.y, dollPos.z);
    d.dollBody.velocity.set(0, 0, 0);
    d.balloonBody.position.set(dollPos.x, dollPos.y + 0.8, dollPos.z);
    d.balloonBody.velocity.set(0, 0, 0);
    if (k >= 1) d.entering = false;
  } else {
    const g = 9.82;
    const lift = (d.balloonBody.mass + d.dollBody.mass * 0.92) * g;
    d.balloonBody.applyForce(new CANNON.Vec3(0, lift, 0), d.balloonBody.position);

    if (!d.settled && d.dollBody.velocity.length() < 0.25) d.settled = true;
  }

  d.dollGroup.position.copy(d.dollBody.position);
  d.dollGroup.quaternion.copy(d.dollBody.quaternion);
  d.balloonGroup.position.copy(d.balloonBody.position);
  d.balloonGroup.quaternion.copy(d.balloonBody.quaternion);

  const ballBottom = d.balloonGroup.position.clone();
  ballBottom.y -= 0.19;
  const dollTop = d.dollGroup.position.clone();
  dollTop.y += 0.24;
  placeRod(d.rod, dollTop, ballBottom);

  if (d.settled) {
    const p = d.dollGroup.position.clone();
    p.x += 0.34; p.y += 0.05;
    const proj = p.project(camera);
    const sx = (proj.x + 1) / 2 * innerWidth;
    const sy = (1 - proj.y) / 2 * innerHeight;
    priceTagEl.style.left = sx + 'px';
    priceTagEl.style.top = sy + 'px';
    priceTagEl.classList.add('show');
  } else {
    priceTagEl.classList.remove('show');
  }
}

const productsLink = menuItems.find(item => item.querySelector('a[href="#products"]'));
if (productsLink) {
  productsLink.addEventListener('click', e => {
    e.preventDefault();
    spawnProduct();
  });
}

// =====================================================================
//  ETKİLEŞİM (3D) — kutu, kapak, bebek, balon hepsi tutulup sürüklenebilir
// =====================================================================
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
boxGroup.userData.body = boxBody;
lidGroup.userData.body = lidBody;
const grabbables = [boxGroup, lidGroup];

const jointBody = new CANNON.Body({ mass: 0 });
jointBody.addShape(new CANNON.Sphere(0.05));
jointBody.collisionFilterGroup = 0;
jointBody.collisionFilterMask = 0;
world.addBody(jointBody);

let constraint = null, grabbed = null;
const dragPlane = new THREE.Plane();
const hitTmp = new THREE.Vector3();

function setNDC(e) {
  ndc.x = (e.clientX / innerWidth) * 2 - 1;
  ndc.y = -(e.clientY / innerHeight) * 2 + 1;
}
function pick() {
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(grabbables, true);
  if (!hits.length) return null;
  let o = hits[0].object;
  while (o && !o.userData.body) o = o.parent;
  return o ? { body: o.userData.body, point: hits[0].point } : null;
}

canvas.addEventListener('pointerdown', e => {
  setNDC(e);
  const h = pick();
  if (!h) return;
  canvas.setPointerCapture(e.pointerId);
  grabbed = h.body;

  const n = new THREE.Vector3();
  camera.getWorldDirection(n).negate();
  dragPlane.setFromNormalAndCoplanarPoint(n, h.point);

  const p = new CANNON.Vec3(h.point.x, h.point.y, h.point.z);
  const pivot = grabbed.quaternion.inverse().vmult(p.vsub(grabbed.position));
  jointBody.position.copy(p);
  constraint = new CANNON.PointToPointConstraint(grabbed, pivot, jointBody, new CANNON.Vec3(0, 0, 0), grabbed.mass * 40 || 40);
  world.addConstraint(constraint);

  grabbed.angularDamping = 0.55;
  grabbed.linearDamping = 0.25;
  canvas.style.cursor = 'grabbing';
});

canvas.addEventListener('pointermove', e => {
  setNDC(e);
  if (constraint) {
    raycaster.setFromCamera(ndc, camera);
    if (raycaster.ray.intersectPlane(dragPlane, hitTmp)) {
      jointBody.position.set(
        THREE.MathUtils.clamp(hitTmp.x, -bounds.x + 0.2, bounds.x - 0.2),
        THREE.MathUtils.clamp(hitTmp.y, 0.05, bounds.y - 0.1),
        THREE.MathUtils.clamp(hitTmp.z, bounds.zb + 0.2, bounds.zf - 0.2)
      );
    }
  } else {
    const h = pick();
    canvas.style.cursor = h ? 'grab' : 'default';
  }
});

function release() {
  if (!constraint) return;
  world.removeConstraint(constraint);
  constraint = null;
  grabbed.angularDamping = 0.12;
  grabbed.linearDamping = 0.05;
  grabbed = null;
  canvas.style.cursor = 'grab';
}
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);

canvas.addEventListener('wheel', e => {
  if (!grabbed) return;
  e.preventDefault();
  grabbed.angularVelocity.y += -e.deltaY * 0.004;
}, { passive: false });

// =====================================================================
//  ANA DÖNGÜ
// =====================================================================
function sync(group, body) {
  group.position.copy(body.position);
  group.quaternion.copy(body.quaternion);
}
function rescue(body, y) {
  if (body.position.y < -1) {
    body.position.set(0, y, 0);
    body.velocity.set(0, 0, 0);
    body.angularVelocity.set(0, 0, 0);
  }
}
function placeContactShadow(blob, body, restY) {
  blob.position.x = body.position.x;
  blob.position.z = body.position.z;
  const lift = Math.max(0, body.position.y - restY);
  const k = 1 / (1 + lift * 1.6);
  blob.scale.setScalar(THREE.MathUtils.clamp(k, 0.35, 1.15));
  blob.material.opacity = THREE.MathUtils.clamp(k * 0.6, 0.1, 0.6);
}

let nextNudge = 0;
const clock = new THREE.Clock();
function tick() {
  const dt = Math.min(clock.getDelta(), 1 / 30);
  const t = clock.elapsedTime;

  world.step(1 / 120, dt, 8);
  rescue(boxBody, 1); rescue(lidBody, 2);
  sync(boxGroup, boxBody);
  sync(lidGroup, lidBody);
  placeContactShadow(boxShadowBlob, boxBody, H / 2);
  placeContactShadow(lidShadowBlob, lidBody, H - SH / 2 + LT + 0.003);

  if (!opened && lidOffBox()) onLidOpen();
  if (opened) innerLight.intensity += (1.6 - innerLight.intensity) * dt * 2;

  candles.forEach(c => c.update(dt));
  updateProduct(dt);

  if (opened && escapedCount < candles.length && !grabbed && t > nextNudge) {
    boxBody.angularVelocity.set((Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 1.6);
    nextNudge = t + 4;
  }

  updateRockets(dt);
  sparks.update(dt);
  flashes.forEach(l => { l.intensity *= Math.exp(-dt * 6); });

  for (let i = 0; i < DUST; i++) {
    dustPos[i * 3 + 1] += Math.sin(t * 0.3 + dustSeed[i]) * 0.0015;
    dustPos[i * 3] += Math.cos(t * 0.2 + dustSeed[i]) * 0.001;
  }
  dustGeo.attributes.position.needsUpdate = true;

  if (!constraint) {
    camera.position.x += (camBase.x + ndc.x * 0.35 - camera.position.x) * dt * 2;
    camera.position.y += (camBase.y + ndc.y * 0.15 - camera.position.y) * dt * 2;
    camera.lookAt(camTarget);
  }

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();

setTimeout(() => document.getElementById('loading').classList.add('hide'), 700);
