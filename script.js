import * as THREE from 'three';
import * as CANNON from './vendor/cannon-es.js';
import { RoundedBoxGeometry } from './vendor/RoundedBoxGeometry.js';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';

/* =========================================================
   Süslü Hediyeler — 3B deneyim
   Kutu: sürükle → momentumlu dönüş
   Kapak: tutup yukarı kaldır → menüler fırlar
   Kapak: bırak → yerçekimiyle düşer, zemine/kutuya çarpar
   Kapak: kutuya geri bırak → kapanır
   ========================================================= */

const body = document.body;
const canvas = document.getElementById('scene');
const menu = document.getElementById('menu');
const menuItems = Array.from(menu.querySelectorAll('.menu__item'));
const menuLinks = Array.from(menu.querySelectorAll('.card'));
const hintMain = document.getElementById('hintMain');
const hintAlt = document.getElementById('hintAlt');
const a11yOpen = document.getElementById('a11yOpen');
const fallback = document.getElementById('fallback');
const productHud = document.getElementById('productHud');
const productTag = document.getElementById('productTag');
const productHint = document.getElementById('productHint');
const cart = document.getElementById('cart');
const cartCountEl = document.getElementById('cartCount');
const toast = document.getElementById('toast');

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

boot();

function boot() {
  try {
    startExperience();
  } catch (error) {
    console.error('Hediye kutusu başlatılamadı:', error);
    body.classList.add('no-scene');
    fallback.hidden = false;
  }
}

function startExperience() {
  /* ---------- ölçüler ---------- */

  const FLOOR_Y = -1.55;
  const BOX_W = 3.28;
  const BOX_H = 2.15;
  const BOX_D = 3.06;
  const BOX_TOP = FLOOR_Y + BOX_H; // 0.60
  const WALL = 0.16;
  const BOTTOM = 0.18;

  const LID_W = 3.48;
  const LID_H = 0.56;
  const LID_D = 3.26;
  const LID_Y = BOX_TOP + LID_H / 2; // 0.88

  const OPEN_LIFT = 0.6;
  const OPEN_SIDE = 0.95;
  const SNAP_DISTANCE = 0.7;
  const FOV = 34;
  const HOME = new THREE.Vector3(0, LID_Y, 0);
  const LID_MASS = 1.7;
  const GRAVITY = -14.5;
  const UP = new THREE.Vector3(0, 1, 0);

  /* ---------- durum ---------- */

  menu.inert = true;

  let opened = false;
  let lidState = 'closed'; // closed | held | free | snapping | program
  let autoSpin = !REDUCED_MOTION;
  let spinVelocity = 0;
  let lastEventTime = 0;
  let mode = null; // 'rotate' | 'lid'
  let activePointerId = null;

  let openProgress = 0;
  let introProgress = REDUCED_MOTION ? 1 : 0;
  let ringT = 1;
  let burstTime = 1;
  let snap = null;
  let programTween = null;

  // Ürün sahnesi: balonlu peluş ayı
  let product = null;
  let productState = 'hidden'; // hidden | entering | floating | falling | landed
  let productEnteredAt = 0;
  let productStartY = 5.2;
  let productHoverY = 0.12;
  let productRestY = -0.9;
  let productScale = 0.7;
  let productX = 0;
  let productZ = 2.55;
  let productVy = 0;
  let productSpin = 0;
  let productBounces = 0;
  let productBaseX = 0;
  let productBaseY = 0.12;
  let productMoved = false;
  const productDragOffset = new THREE.Vector2();
  const productDragBounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  const productDragPlane = new THREE.Plane();
  const productDragPoint = new THREE.Vector3();
  const productDragNdc = new THREE.Vector2();
  let balloonPopped = false;
  let productAdded = false;
  let lastBalloonTap = 0;
  let productTagDismissed = false;
  let popT = 1;
  let landingT = 1;
  let cartCount = 0;
  let toastTimer = 0;
  let cameraZoom = 1;
  let productView = 0;

  const holdQuatTarget = new THREE.Quaternion();
  const lidVelocity = new THREE.Vector3();
  const heldLastPosition = new THREE.Vector3();
  let lastLidMoveTime = 0;
  let restTimer = 0;

  const clock = new THREE.Clock();
  const pointer = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  const dragPlane = new THREE.Plane();
  const planeHit = new THREE.Vector3();
  const lidDragOrigin = new THREE.Vector3();
  const lidDragStart = new THREE.Vector3();
  const lastMove = { x: 0, y: 0 };
  const cameraDir = new THREE.Vector3();
  const projected = new THREE.Vector3();
  const lidWorld = new THREE.Vector3();
  const lidUp = new THREE.Vector3();

  const framing = {
    closedDist: 8.2,
    openDist: 9.8,
    openTargetY: 0.45,
  };

  /* ---------- renderer / sahne ---------- */

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    FOV,
    window.innerWidth / window.innerHeight,
    0.1,
    100
  );

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new RoomEnvironment();
  const envTexture = pmrem.fromScene(envScene, 0.04).texture;
  scene.environment = envTexture;
  pmrem.dispose();
  if (envScene.dispose) envScene.dispose();

  const worldGroup = new THREE.Group();
  scene.add(worldGroup);

  const baseRoot = new THREE.Group();
  const lidGroup = new THREE.Group();
  const lidVisual = new THREE.Group();
  worldGroup.add(baseRoot, lidGroup);
  lidGroup.add(lidVisual);
  baseRoot.rotation.y = -0.38;
  lidGroup.rotation.y = baseRoot.rotation.y;
  lidGroup.position.copy(HOME);

  /* ---------- doku yardımcıları ---------- */

  function radialTexture(size, stops) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2
    );
    for (const [offset, color] of stops) g.addColorStop(offset, color);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
    return tex;
  }

  const sparkTexture = radialTexture(64, [
    [0, 'rgba(255, 245, 220, 1)'],
    [0.22, 'rgba(255, 215, 160, 0.9)'],
    [0.6, 'rgba(255, 170, 120, 0.25)'],
    [1, 'rgba(255, 150, 100, 0)'],
  ]);

  const glowTexture = radialTexture(256, [
    [0, 'rgba(255, 235, 206, 0.95)'],
    [0.22, 'rgba(255, 192, 120, 0.52)'],
    [0.55, 'rgba(255, 120, 76, 0.14)'],
    [1, 'rgba(255, 100, 60, 0)'],
  ]);

  const shadowTexture = radialTexture(256, [
    [0, 'rgba(0, 0, 0, 0.62)'],
    [0.32, 'rgba(0, 0, 0, 0.42)'],
    [0.64, 'rgba(0, 0, 0, 0.13)'],
    [1, 'rgba(0, 0, 0, 0)'],
  ]);

  /* ---------- malzemeler ---------- */

  const lacquer = new THREE.MeshPhysicalMaterial({
    color: 0x981633,
    roughness: 0.3,
    metalness: 0.16,
    clearcoat: 1,
    clearcoatRoughness: 0.2,
    sheen: 0.45,
    sheenColor: new THREE.Color(0xff7893),
    sheenRoughness: 0.6,
    envMapIntensity: 0.85,
  });

  const gold = new THREE.MeshPhysicalMaterial({
    color: 0xd7b276,
    roughness: 0.3,
    metalness: 0.62,
    clearcoat: 0.55,
    clearcoatRoughness: 0.25,
    envMapIntensity: 1.25,
    side: THREE.DoubleSide,
    sheen: 0.35,
    sheenColor: new THREE.Color(0xffeccd),
    sheenRoughness: 0.5,
  });

  const bronze = new THREE.MeshStandardMaterial({
    color: 0x8f6a3b,
    metalness: 0.78,
    roughness: 0.35,
    envMapIntensity: 1.1,
  });

  const darkInterior = new THREE.MeshStandardMaterial({
    color: 0x140408,
    roughness: 0.86,
    metalness: 0.05,
  });

  const lidUnderside = new THREE.MeshStandardMaterial({
    color: 0x220811,
    roughness: 0.86,
    metalness: 0.12,
    envMapIntensity: 0.5,
  });

  /* ---------- yardımcılar ---------- */

  function roundedBox(w, h, d, radius, material) {
    const mesh = new THREE.Mesh(
      new RoundedBoxGeometry(w, h, d, 5, radius),
      material
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  function ribbonMesh(points, width, normal, closed, taper, material = gold) {
    const pts = points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    const curve = new THREE.CatmullRomCurve3(pts, closed, 'catmullrom', 0.42);
    const segments = Math.max(64, Math.round(curve.getLength() * 70));
    const positions = [];
    const uvs = [];
    const indices = [];
    const side = new THREE.Vector3();
    const tangent = new THREE.Vector3();

    for (let i = 0; i <= segments; i += 1) {
      const t = i / segments;
      const point = curve.getPointAt(t);
      curve.getTangentAt(t, tangent).normalize();
      side.crossVectors(tangent, normal).normalize();
      const taperFactor =
        1 - taper * Math.abs(closed ? Math.sin(Math.PI * t) : t * 2 - 1);
      const half = (width * taperFactor) / 2;

      positions.push(
        point.x - side.x * half,
        point.y - side.y * half,
        point.z - side.z * half,
        point.x + side.x * half,
        point.y + side.y * half,
        point.z + side.z * half
      );
      uvs.push(0, t, 1, t);

      if (i < segments) {
        const a = i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3)
    );
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  /* ---------- ışıklar ---------- */

  const hemi = new THREE.HemisphereLight(0xffe8d2, 0x190a12, 0.6);
  scene.add(hemi);

  const keyLight = new THREE.DirectionalLight(0xfff1dd, 2.7);
  keyLight.position.set(4.5, 7, 5.5);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.left = -6;
  keyLight.shadow.camera.right = 6;
  keyLight.shadow.camera.top = 6;
  keyLight.shadow.camera.bottom = -6;
  keyLight.shadow.camera.near = 1;
  keyLight.shadow.camera.far = 25;
  keyLight.shadow.bias = -0.00035;
  keyLight.shadow.normalBias = 0.018;
  keyLight.shadow.radius = 5;
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0xff4b78, 2.1);
  rimLight.position.set(-5.5, 4, -5);
  scene.add(rimLight);

  const fillLight = new THREE.DirectionalLight(0x97b2ff, 0.7);
  fillLight.position.set(-4.5, 2.5, 6);
  scene.add(fillLight);

  const innerLight = new THREE.PointLight(0xffb26b, 0, 5, 2);
  innerLight.position.set(0, BOX_TOP - 0.4, 0);
  baseRoot.add(innerLight);

  /* ---------- zemin ---------- */

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.ShadowMaterial({ opacity: 0.28 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_Y + 0.002;
  floor.receiveShadow = true;
  scene.add(floor);

  const contactShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 6),
    new THREE.MeshBasicMaterial({
      map: shadowTexture,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      toneMapped: false,
    })
  );
  contactShadow.rotation.x = -Math.PI / 2;
  contactShadow.position.set(0, FLOOR_Y + 0.004, 0);
  scene.add(contactShadow);

  /* ---------- taban ---------- */

  // Alt taban
  const bottom = roundedBox(BOX_W, BOTTOM, BOX_D, 0.07, lacquer);
  bottom.position.y = FLOOR_Y + BOTTOM / 2;
  baseRoot.add(bottom);

  // Duvarlar: içi boş, yuvarlatılmış dikdörtgen halka
  function drawRoundedRect(path, w, d, radius) {
    const x = -w / 2;
    const y = -d / 2;
    path.moveTo(x + radius, y);
    path.lineTo(x + w - radius, y);
    path.quadraticCurveTo(x + w, y, x + w, y + radius);
    path.lineTo(x + w, y + d - radius);
    path.quadraticCurveTo(x + w, y + d, x + w - radius, y + d);
    path.lineTo(x + radius, y + d);
    path.quadraticCurveTo(x, y + d, x, y + d - radius);
    path.lineTo(x, y + radius);
    path.quadraticCurveTo(x, y, x + radius, y);
    path.closePath();
  }

  const wallShape = new THREE.Shape();
  drawRoundedRect(wallShape, BOX_W - 0.02, BOX_D - 0.02, 0.13);

  const wallHole = new THREE.Path();
  drawRoundedRect(wallHole, BOX_W - WALL * 2, BOX_D - WALL * 2, 0.08);
  wallShape.holes.push(wallHole);

  const wallBevel = 0.02;
  const wallHeight = BOX_TOP - (FLOOR_Y + BOTTOM);
  const wallGeometry = new THREE.ExtrudeGeometry(wallShape, {
    depth: wallHeight - wallBevel * 2,
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: wallBevel,
    bevelThickness: wallBevel,
    curveSegments: 16,
    steps: 1,
  });
  wallGeometry.rotateX(-Math.PI / 2);

  const baseWalls = new THREE.Mesh(wallGeometry, lacquer);
  baseWalls.position.y = FLOOR_Y + BOTTOM + wallBevel;
  baseWalls.castShadow = true;
  baseWalls.receiveShadow = true;
  baseRoot.add(baseWalls);

  // Kutunun içi: koyu iç yüzeyler
  const innerOpeningW = BOX_W - WALL * 2;
  const innerOpeningD = BOX_D - WALL * 2;
  const innerDepth = 1.88;
  const innerBottomY = BOX_TOP - 0.02 - innerDepth;
  // ExtrudeGeometry'nin pahı deliği yaklaşık bevelSize kadar genişletiyor;
  // astarın kırmızı duvarın önüne geçmesi için biraz daha içeri alıyoruz.
  const linerInset = 0.055;

  const linerFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(innerOpeningW + 0.08, innerOpeningD + 0.08),
    darkInterior
  );
  linerFloor.rotation.x = -Math.PI / 2;
  linerFloor.position.y = innerBottomY;
  linerFloor.receiveShadow = true;
  baseRoot.add(linerFloor);

  function addLinerWall(width, x, z, rotationY) {
    const wall = new THREE.Mesh(
      new THREE.PlaneGeometry(width, innerDepth),
      darkInterior
    );
    wall.position.set(x, innerBottomY + innerDepth / 2, z);
    wall.rotation.y = rotationY;
    wall.receiveShadow = true;
    baseRoot.add(wall);
  }

  addLinerWall(
    innerOpeningW + 0.12,
    0,
    -innerOpeningD / 2 + linerInset,
    0
  );
  addLinerWall(
    innerOpeningW + 0.12,
    0,
    innerOpeningD / 2 - linerInset,
    Math.PI
  );
  addLinerWall(
    innerOpeningD + 0.12,
    -innerOpeningW / 2 + linerInset,
    0,
    Math.PI / 2
  );
  addLinerWall(
    innerOpeningD + 0.12,
    innerOpeningW / 2 - linerInset,
    0,
    -Math.PI / 2
  );

  // Ağzın ince altın çerçevesi
  const rimBar = 0.03;
  const rimDepth = 0.03;

  function addRimBar(w, d, x, z) {
    const bar = new THREE.Mesh(
      new RoundedBoxGeometry(w, rimDepth, d, 2, 0.01),
      bronze
    );
    bar.position.set(x, BOX_TOP + 0.012, z);
    bar.castShadow = true;
    bar.receiveShadow = true;
    baseRoot.add(bar);
  }

  addRimBar(innerOpeningW + 0.02, rimBar, 0, innerOpeningD / 2 - 0.005);
  addRimBar(innerOpeningW + 0.02, rimBar, 0, -(innerOpeningD / 2 - 0.005));
  addRimBar(rimBar, innerOpeningD + 0.02, innerOpeningW / 2 - 0.005, 0);
  addRimBar(rimBar, innerOpeningD + 0.02, -(innerOpeningW / 2 - 0.005), 0);

  // Taban kurdeleleri (dört yüz)
  const bandW = 0.42;
  const bandT = 0.024;
  const baseBandY = FLOOR_Y + BOX_H / 2 - 0.01;

  function addBaseBand(w, h, d, x, y, z) {
    const mesh = new THREE.Mesh(
      new RoundedBoxGeometry(w, h, d, 2, 0.012),
      gold
    );
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    baseRoot.add(mesh);
  }

  addBaseBand(bandW, BOX_H - 0.015, bandT, 0, baseBandY, BOX_D / 2 + 0.016);
  addBaseBand(bandW, BOX_H - 0.015, bandT, 0, baseBandY, -(BOX_D / 2 + 0.016));
  addBaseBand(bandT, BOX_H - 0.015, bandW, BOX_W / 2 + 0.016, baseBandY, 0);
  addBaseBand(bandT, BOX_H - 0.015, bandW, -(BOX_W / 2 + 0.016), baseBandY, 0);

  /* ---------- marka yazısı ---------- */

  // Ön yüzde altın varak görünümlü "Süslü Hediyeler" etiketi
  const brandCanvas = document.createElement('canvas');
  brandCanvas.width = 1600;
  brandCanvas.height = 420;
  const brandContext = brandCanvas.getContext('2d');
  const brandTexture = new THREE.CanvasTexture(brandCanvas);
  brandTexture.colorSpace = THREE.SRGBColorSpace;
  brandTexture.anisotropy = Math.min(
    renderer.capabilities.getMaxAnisotropy(),
    8
  );

  function paintBrand() {
    const w = brandCanvas.width;
    const h = brandCanvas.height;
    const cx = w / 2;
    const cy = h / 2 + 4;

    brandContext.clearRect(0, 0, w, h);
    brandContext.save();
    brandContext.textAlign = 'center';
    brandContext.textBaseline = 'middle';
    brandContext.font =
      '600 172px "Fraunces", "Playfair Display", Georgia, serif';
    if ('letterSpacing' in brandContext) {
      brandContext.letterSpacing = '5px';
    }

    const text = 'Süslü Hediyeler';
    const metrics = brandContext.measureText(text);
    const half = metrics.width / 2;

    const gradient = brandContext.createLinearGradient(
      0,
      cy - 86,
      0,
      cy + 86
    );
    gradient.addColorStop(0, '#fffaf0');
    gradient.addColorStop(0.3, '#ffe9c0');
    gradient.addColorStop(0.5, '#e5ba7b');
    gradient.addColorStop(0.66, '#fff1cd');
    gradient.addColorStop(1, '#dcae68');

    brandContext.fillStyle = gradient;
    brandContext.shadowColor = 'rgba(38, 0, 10, 0.62)';
    brandContext.shadowBlur = 9;
    brandContext.shadowOffsetY = 3;
    brandContext.fillText(text, cx, cy);
    brandContext.shadowColor = 'transparent';
    brandContext.shadowBlur = 0;
    brandContext.shadowOffsetY = 0;

    brandContext.strokeStyle = 'rgba(255, 241, 205, 0.9)';
    brandContext.lineWidth = 6;
    const lineY = cy + 90;
    const lineHalf = Math.min(300, half * 0.72);
    brandContext.beginPath();
    brandContext.moveTo(cx - lineHalf, lineY);
    brandContext.lineTo(cx - 22, lineY);
    brandContext.moveTo(cx + 22, lineY);
    brandContext.lineTo(cx + lineHalf, lineY);
    brandContext.stroke();

    brandContext.fillStyle = 'rgba(255, 241, 205, 0.95)';
    brandContext.beginPath();
    brandContext.moveTo(cx, lineY - 11);
    brandContext.lineTo(cx + 11, lineY);
    brandContext.lineTo(cx, lineY + 11);
    brandContext.lineTo(cx - 11, lineY);
    brandContext.closePath();
    brandContext.fill();
    brandContext.restore();
    brandTexture.needsUpdate = true;
  }

  paintBrand();

  const brandLabel = new THREE.Mesh(
    new THREE.PlaneGeometry(1.33, 0.349),
    new THREE.MeshBasicMaterial({
      map: brandTexture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    })
  );
  brandLabel.position.set(0.92, -0.47, BOX_D / 2 + 0.04);
  brandLabel.renderOrder = 3;
  baseRoot.add(brandLabel);

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(paintBrand).catch(() => {});
  }


  // İçeriden yükselen sıcak parıltı
  const glowMaterial = new THREE.SpriteMaterial({
    map: glowTexture,
    color: 0xffc88c,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const mouthGlow = new THREE.Sprite(glowMaterial);
  mouthGlow.position.set(0, BOX_TOP - 0.5, 0);
  mouthGlow.scale.setScalar(2.1);
  baseRoot.add(mouthGlow);

  const innerGlowMaterial = new THREE.MeshBasicMaterial({
    map: glowTexture,
    color: 0xffb778,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  const innerGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(innerOpeningW * 0.9, innerOpeningD * 0.9),
    innerGlowMaterial
  );
  innerGlow.rotation.x = -Math.PI / 2;
  innerGlow.position.y = innerBottomY + 0.02;
  baseRoot.add(innerGlow);

  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0xffd9a1,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.53, 72), ringMaterial);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = BOX_TOP + 0.03;
  ring.visible = false;
  baseRoot.add(ring);

  /* ---------- kapak ---------- */

  const lidBase = roundedBox(LID_W, LID_H, LID_D, 0.12, lacquer);
  lidVisual.add(lidBase);

  const underPanel = new THREE.Mesh(
    new THREE.PlaneGeometry(LID_W - 0.26, LID_D - 0.26),
    lidUnderside
  );
  underPanel.rotation.x = Math.PI / 2;
  underPanel.position.y = -LID_H / 2 - 0.001;
  lidVisual.add(underPanel);

  // Kapak yan kurdeleleri
  const lidBandY = 0;
  function addLidBand(w, h, d, x, y, z) {
    const mesh = new THREE.Mesh(
      new RoundedBoxGeometry(w, h, d, 2, 0.01),
      gold
    );
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    lidVisual.add(mesh);
  }

  addLidBand(bandW, LID_H + 0.02, bandT, 0, lidBandY, LID_D / 2 + 0.014);
  addLidBand(bandW, LID_H + 0.02, bandT, 0, lidBandY, -(LID_D / 2 + 0.014));
  addLidBand(bandT, LID_H + 0.02, bandW, LID_W / 2 + 0.014, lidBandY, 0);
  addLidBand(bandT, LID_H + 0.02, bandW, -(LID_W / 2 + 0.014), lidBandY, 0);

  // Kapak üstü kurdeleleri
  addLidBand(bandW, 0.022, LID_D + 0.06, 0, LID_H / 2 + 0.013, 0);
  addLidBand(LID_W + 0.06, 0.022, bandW, 0, LID_H / 2 + 0.014, 0);

  /* ---------- fiyonk ---------- */

  const bow = new THREE.Group();
  bow.position.set(0, LID_H / 2 + 0.04, 0);
  lidVisual.add(bow);

  const loopPoints = [
    [0.0, 0.02, 0.0],
    [-0.22, 0.28, 0.1],
    [-0.55, 0.4, 0.15],
    [-0.82, 0.28, 0.07],
    [-0.86, 0.04, 0.0],
    [-0.6, -0.1, -0.03],
    [-0.24, -0.05, 0.01],
  ];

  const mirroredLoopPoints = loopPoints.map(([x, y, z]) => [-x, y, z]);

  const loopNormal = new THREE.Vector3(0, 0, 1);
  const loopLeftGeometry = ribbonGeometryFromPoints(
    loopPoints,
    0.245,
    loopNormal,
    true,
    0.34
  );
  const loopRightGeometry = ribbonGeometryFromPoints(
    mirroredLoopPoints,
    0.245,
    loopNormal,
    true,
    0.34
  );

  const bigLeft = new THREE.Mesh(loopLeftGeometry, gold);
  const bigRight = new THREE.Mesh(loopRightGeometry, gold);
  bigLeft.castShadow = bigRight.castShadow = true;
  bow.add(bigLeft, bigRight);

  const backLeft = new THREE.Mesh(loopLeftGeometry, gold);
  const backRight = new THREE.Mesh(loopRightGeometry, gold);
  backLeft.position.set(0.02, 0.05, -0.03);
  backRight.position.set(-0.02, 0.05, -0.03);
  backLeft.rotation.y = -0.92;
  backRight.rotation.y = 0.92;
  backLeft.scale.setScalar(0.68);
  backRight.scale.setScalar(0.68);
  backLeft.castShadow = backRight.castShadow = true;
  bow.add(backLeft, backRight);

  // Kurdele kuyrukları
  const tailUp = new THREE.Vector3(0, 1, 0);
  const tailLeft = ribbonMesh(
    [
      [0.0, 0.025, 0.02],
      [-0.13, 0.012, 0.18],
      [-0.26, 0.002, 0.38],
      [-0.34, -0.005, 0.58],
    ],
    0.165,
    tailUp,
    false,
    0.45
  );
  const tailRight = ribbonMesh(
    [
      [0.0, 0.025, 0.02],
      [0.13, 0.012, 0.18],
      [0.26, 0.002, 0.38],
      [0.34, -0.005, 0.58],
    ],
    0.165,
    tailUp,
    false,
    0.45
  );
  bow.add(tailLeft, tailRight);

  const knot = roundedBox(0.31, 0.2, 0.27, 0.075, gold);
  knot.position.set(0, 0.03, 0.01);
  knot.rotation.z = 0.06;
  bow.add(knot);

  function ribbonGeometryFromPoints(points, width, normal, closed, taper) {
    const mesh = ribbonMesh(points, width, normal, closed, taper);
    return mesh.geometry;
  }

  /* ---------- fizik ---------- */

  const world = new CANNON.World({
    gravity: new CANNON.Vec3(0, GRAVITY, 0),
  });
  const cannonUp = new CANNON.Vec3(0, 1, 0);
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = true;
  world.defaultContactMaterial.contactEquationStiffness = 1e8;
  world.defaultContactMaterial.contactEquationRelaxation = 4;

  const floorPhysMaterial = new CANNON.Material('floor');
  const boxPhysMaterial = new CANNON.Material('box');
  const lidPhysMaterial = new CANNON.Material('lid');

  world.addContactMaterial(
    new CANNON.ContactMaterial(lidPhysMaterial, floorPhysMaterial, {
      friction: 0.52,
      restitution: 0.18,
      contactEquationStiffness: 1e8,
      contactEquationRelaxation: 4,
    })
  );
  world.addContactMaterial(
    new CANNON.ContactMaterial(lidPhysMaterial, boxPhysMaterial, {
      friction: 0.4,
      restitution: 0.08,
      contactEquationStiffness: 1e8,
      contactEquationRelaxation: 4,
    })
  );

  // Zemin: sonsuz düzlem
  const floorBody = new CANNON.Body({
    mass: 0,
    material: floorPhysMaterial,
    shape: new CANNON.Plane(),
  });
  floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  floorBody.position.set(0, FLOOR_Y, 0);
  world.addBody(floorBody);

  // Kutu gövdesi: kapak içinden geçemesin diye katı bir kutu.
  // Kapak kutudan büyük olduğu için pratikte hep ağzın üstünde durur.
  const boxBody = new CANNON.Body({
    mass: 0,
    material: boxPhysMaterial,
  });
  boxBody.addShape(
    new CANNON.Box(new CANNON.Vec3(BOX_W / 2, BOX_H / 2, BOX_D / 2))
  );
  boxBody.position.set(0, FLOOR_Y + BOX_H / 2, 0);
  boxBody.quaternion.setFromEuler(0, baseRoot.rotation.y, 0);
  world.addBody(boxBody);

  // Kapak: gerçek yerçekimi, dönme ve çarpışma
  const lidBody = new CANNON.Body({
    mass: LID_MASS,
    material: lidPhysMaterial,
    linearDamping: 0.09,
    angularDamping: 0.28,
    allowSleep: true,
    sleepSpeedLimit: 0.1,
    sleepTimeLimit: 0.55,
  });
  lidBody.addShape(
    new CANNON.Box(
      new CANNON.Vec3(LID_W / 2 - 0.01, LID_H / 2, LID_D / 2 - 0.01)
    )
  );
  // Fiyonkun zemine/kutuya girmesini engelleyen yaklaşık çarpışma gövdesi
  lidBody.addShape(
    new CANNON.Box(new CANNON.Vec3(0.62, 0.28, 0.5)),
    new CANNON.Vec3(0, LID_H / 2 + 0.28, 0)
  );
  lidBody.position.set(HOME.x, HOME.y, HOME.z);
  lidBody.quaternion.setFromEuler(0, baseRoot.rotation.y, 0);
  world.addBody(lidBody);

  function setLidKinematic() {
    lidBody.type = CANNON.Body.KINEMATIC;
    lidBody.mass = 0;
    lidBody.updateMassProperties();
    lidBody.velocity.setZero();
    lidBody.angularVelocity.setZero();
    lidBody.allowSleep = false;
    lidBody.aabbNeedsUpdate = true;
    lidBody.wakeUp();
  }

  function setLidDynamic() {
    lidBody.type = CANNON.Body.DYNAMIC;
    lidBody.mass = LID_MASS;
    lidBody.updateMassProperties();
    lidBody.allowSleep = true;
    lidBody.sleepState = CANNON.Body.AWAKE;
    lidBody.aabbNeedsUpdate = true;
    lidBody.wakeUp();
  }

  function syncLidVisual() {
    lidGroup.position.set(
      lidBody.position.x,
      lidBody.position.y,
      lidBody.position.z
    );
    lidGroup.quaternion.set(
      lidBody.quaternion.x,
      lidBody.quaternion.y,
      lidBody.quaternion.z,
      lidBody.quaternion.w
    );
  }

  function setLidYaw(yaw) {
    lidBody.quaternion.setFromAxisAngle(cannonUp, yaw);
    lidGroup.quaternion.set(
      lidBody.quaternion.x,
      lidBody.quaternion.y,
      lidBody.quaternion.z,
      lidBody.quaternion.w
    );
  }

  setLidKinematic();
  syncLidVisual();

  /* ---------- parçacıklar ---------- */

  const dustCount = REDUCED_MOTION ? 36 : 96;
  const dustPositions = new Float32Array(dustCount * 3);
  const dustData = [];

  for (let i = 0; i < dustCount; i += 1) {
    const x = (Math.random() - 0.5) * 9;
    const y = FLOOR_Y + Math.random() * 4.8;
    const z = (Math.random() - 0.5) * 7;
    dustPositions[i * 3] = x;
    dustPositions[i * 3 + 1] = y;
    dustPositions[i * 3 + 2] = z;
    dustData.push({
      speed: 0.035 + Math.random() * 0.09,
      phase: Math.random() * Math.PI * 2,
      sway: 0.02 + Math.random() * 0.05,
    });
  }

  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute(
    'position',
    new THREE.BufferAttribute(dustPositions, 3)
  );

  const dustMaterial = new THREE.PointsMaterial({
    map: sparkTexture,
    color: 0xffd9a6,
    size: 0.065,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.7,
    alphaTest: 0.01,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });

  const dust = new THREE.Points(dustGeometry, dustMaterial);
  scene.add(dust);

  // Açılış anındaki altın toz patlaması
  const burstCount = 72;
  const burstPositions = new Float32Array(burstCount * 3);
  const burstVelocities = [];

  for (let i = 0; i < burstCount; i += 1) {
    burstPositions[i * 3] = 0;
    burstPositions[i * 3 + 1] = BOX_TOP + 0.2;
    burstPositions[i * 3 + 2] = 0;
    burstVelocities.push(new THREE.Vector3());
  }

  const burstGeometry = new THREE.BufferGeometry();
  burstGeometry.setAttribute(
    'position',
    new THREE.BufferAttribute(burstPositions, 3)
  );

  const burstMaterial = new THREE.PointsMaterial({
    map: sparkTexture,
    color: 0xffd7a2,
    size: 0.11,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    alphaTest: 0.01,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });

  const burst = new THREE.Points(burstGeometry, burstMaterial);
  burst.visible = false;
  scene.add(burst);

  /* ---------- kapak seçim listesi ---------- */

  const lidPickables = [];
  lidGroup.traverse((object) => {
    if (object.isMesh) lidPickables.push(object);
  });

  /* ---------- balonlu peluş ayı ---------- */

  const productRoot = new THREE.Group();
  productRoot.visible = false;
  scene.add(productRoot);

  const plushMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x95613f,
    roughness: 0.92,
    metalness: 0,
    sheen: 0.42,
    sheenColor: new THREE.Color(0xffd9b5),
    sheenRoughness: 0.85,
    envMapIntensity: 0.45,
  });

  const plushLightMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xd8ad82,
    roughness: 0.94,
    metalness: 0,
    sheen: 0.3,
    sheenColor: new THREE.Color(0xfff0dc),
    sheenRoughness: 0.9,
    envMapIntensity: 0.4,
  });

  const plushDarkMaterial = new THREE.MeshStandardMaterial({
    color: 0x3d2117,
    roughness: 0.52,
    metalness: 0.05,
  });

  const eyeMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x120907,
    roughness: 0.12,
    metalness: 0.05,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.4,
  });

  const balloonMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xa51f42,
    roughness: 0.16,
    metalness: 0.08,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    sheen: 0.3,
    sheenColor: new THREE.Color(0xffc7d4),
    sheenRoughness: 0.55,
    envMapIntensity: 1.25,
  });

  const stringMaterial = new THREE.MeshStandardMaterial({
    color: 0xe8cc99,
    roughness: 0.5,
    metalness: 0.35,
  });

  const bearRig = new THREE.Group();
  productRoot.add(bearRig);

  const unitSphere = new THREE.SphereGeometry(1, 32, 24);

  function addPlushPart(
    geometry,
    material,
    x,
    y,
    z,
    sx = 1,
    sy = 1,
    sz = 1,
    parent = bearRig
  ) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  // Gövde ve karın
  addPlushPart(unitSphere, plushMaterial, 0, 0, 0, 0.57, 0.64, 0.45);
  addPlushPart(
    unitSphere,
    plushLightMaterial,
    0,
    -0.07,
    0.37,
    0.33,
    0.41,
    0.12
  );

  // Kafa
  addPlushPart(unitSphere, plushMaterial, 0, 0.78, 0.02, 0.46, 0.41, 0.41);
  addPlushPart(unitSphere, plushMaterial, -0.34, 1.09, -0.01, 0.17, 0.17, 0.15);
  addPlushPart(unitSphere, plushMaterial, 0.34, 1.09, -0.01, 0.17, 0.17, 0.15);
  addPlushPart(
    unitSphere,
    plushLightMaterial,
    -0.34,
    1.1,
    0.09,
    0.1,
    0.1,
    0.075
  );
  addPlushPart(
    unitSphere,
    plushLightMaterial,
    0.34,
    1.1,
    0.09,
    0.1,
    0.1,
    0.075
  );

  // Burun ve ağız
  addPlushPart(
    unitSphere,
    plushLightMaterial,
    0,
    0.69,
    0.39,
    0.22,
    0.16,
    0.14
  );
  addPlushPart(unitSphere, plushDarkMaterial, 0, 0.72, 0.52, 0.075, 0.055, 0.045);

  // Gözler
  addPlushPart(unitSphere, eyeMaterial, -0.16, 0.85, 0.4, 0.045, 0.052, 0.036);
  addPlushPart(unitSphere, eyeMaterial, 0.16, 0.85, 0.4, 0.045, 0.052, 0.036);
  addPlushPart(
    unitSphere,
    new THREE.MeshBasicMaterial({ color: 0xfff7e8 }),
    -0.174,
    0.87,
    0.432,
    0.012,
    0.014,
    0.01
  );
  addPlushPart(
    unitSphere,
    new THREE.MeshBasicMaterial({ color: 0xfff7e8 }),
    0.146,
    0.87,
    0.432,
    0.012,
    0.014,
    0.01
  );

  // Kollar ve patiler
  const armGeometry = new THREE.CapsuleGeometry(0.145, 0.34, 6, 12);
  const leftArm = addPlushPart(
    armGeometry,
    plushMaterial,
    -0.56,
    0.08,
    0.02,
    1,
    1,
    1
  );
  leftArm.rotation.z = -0.38;
  const rightArm = addPlushPart(
    armGeometry,
    plushMaterial,
    0.56,
    0.08,
    0.02,
    1,
    1,
    1
  );
  rightArm.rotation.z = 0.38;
  addPlushPart(
    unitSphere,
    plushLightMaterial,
    -0.69,
    -0.22,
    0.08,
    0.15,
    0.13,
    0.16
  );
  addPlushPart(
    unitSphere,
    plushLightMaterial,
    0.69,
    -0.22,
    0.08,
    0.15,
    0.13,
    0.16
  );

  // Bacaklar ve ayaklar
  const legGeometry = new THREE.CapsuleGeometry(0.17, 0.25, 6, 12);
  const leftLeg = addPlushPart(
    legGeometry,
    plushMaterial,
    -0.28,
    -0.47,
    0.03,
    1,
    1,
    1
  );
  leftLeg.rotation.z = 0.06;
  const rightLeg = addPlushPart(
    legGeometry,
    plushMaterial,
    0.28,
    -0.47,
    0.03,
    1,
    1,
    1
  );
  rightLeg.rotation.z = -0.06;
  addPlushPart(
    unitSphere,
    plushLightMaterial,
    -0.3,
    -0.72,
    0.18,
    0.2,
    0.125,
    0.24
  );
  addPlushPart(
    unitSphere,
    plushLightMaterial,
    0.3,
    -0.72,
    0.18,
    0.2,
    0.125,
    0.24
  );

  // Kuyruk
  addPlushPart(unitSphere, plushMaterial, 0, -0.16, -0.42, 0.15, 0.15, 0.12);

  const bearPickables = [];
  bearRig.traverse((object) => {
    if (object.isMesh) bearPickables.push(object);
  });

  // Balon ve ip
  const balloonGroup = new THREE.Group();
  productRoot.add(balloonGroup);

  const balloonMesh = addPlushPart(
    unitSphere,
    balloonMaterial,
    0,
    2.0,
    0.02,
    0.46,
    0.53,
    0.44,
    balloonGroup
  );
  balloonMesh.userData.isBalloon = true;

  const balloonKnot = addPlushPart(
    new THREE.CylinderGeometry(0.045, 0.075, 0.1, 12),
    stringMaterial,
    0,
    1.44,
    0.02,
    1,
    1,
    1,
    balloonGroup
  );
  balloonKnot.userData.isBalloon = true;

  const stringCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 1.4, 0.02),
    new THREE.Vector3(0.12, 1.05, 0.08),
    new THREE.Vector3(0.38, 0.62, 0.12),
    new THREE.Vector3(0.6, 0.2, 0.09),
  ]);
  const stringMesh = new THREE.Mesh(
    new THREE.TubeGeometry(stringCurve, 28, 0.012, 6, false),
    stringMaterial
  );
  stringMesh.castShadow = true;
  balloonGroup.add(stringMesh);

  const balloonHighlight = addPlushPart(
    unitSphere,
    new THREE.MeshBasicMaterial({
      color: 0xfff0e0,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
    }),
    0.14,
    2.2,
    0.38,
    0.12,
    0.2,
    0.035,
    balloonGroup
  );
  balloonHighlight.renderOrder = 2;

  // Balon patlama parçacıkları
  const popCount = REDUCED_MOTION ? 14 : 46;
  const popPositions = new Float32Array(popCount * 3);
  const popVelocities = [];

  for (let i = 0; i < popCount; i += 1) {
    popPositions[i * 3] = 0;
    popPositions[i * 3 + 1] = 0;
    popPositions[i * 3 + 2] = 0;
    popVelocities.push(new THREE.Vector3());
  }

  const popGeometry = new THREE.BufferGeometry();
  popGeometry.setAttribute(
    'position',
    new THREE.BufferAttribute(popPositions, 3)
  );

  const popMaterial = new THREE.PointsMaterial({
    map: sparkTexture,
    color: 0xff6b88,
    size: 0.09,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    alphaTest: 0.01,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });

  const popPoints = new THREE.Points(popGeometry, popMaterial);
  popPoints.visible = false;
  scene.add(popPoints);

  const popRingMaterial = new THREE.MeshBasicMaterial({
    color: 0xffd7a2,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const popRing = new THREE.Mesh(
    new THREE.RingGeometry(0.22, 0.3, 48),
    popRingMaterial
  );
  popRing.visible = false;
  popRing.renderOrder = 3;
  scene.add(popRing);

  const landingRingMaterial = new THREE.MeshBasicMaterial({
    color: 0xffd7a2,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const landingRing = new THREE.Mesh(
    new THREE.RingGeometry(0.24, 0.34, 48),
    landingRingMaterial
  );
  landingRing.rotation.x = -Math.PI / 2;
  landingRing.position.y = FLOOR_Y + 0.008;
  landingRing.visible = false;
  scene.add(landingRing);

  const productAnchor = new THREE.Vector3();

  product = {
    root: productRoot,
    bear: bearRig,
    balloon: balloonGroup,
    balloonMesh,
    balloonKnot,
    pickables: [balloonMesh, balloonKnot],
    bearPickables,
    popPoints,
    popVelocities,
    popRing,
    landingRing,
    anchor: productAnchor,
  };

  /* ---------- ürün kontrolleri ---------- */

  function layoutProduct() {
    const aspect = window.innerWidth / window.innerHeight;
    const portrait = aspect < 0.8;
    const scale = portrait ? 1.0 : window.innerWidth < 1100 ? 0.66 : 0.7;

    productScale = scale;
    productX = 0;
    productZ = portrait ? 4.4 : 1.95;
    productHoverY = portrait ? 0.55 : 0.12;
    productRestY = FLOOR_Y + 0.85 * scale;

    productRoot.scale.setScalar(scale);

    if (productState !== 'hidden') {
      lidGroup.visible = !portrait;
    }

    if (productState === 'hidden') {
      productBaseX = productX;
      productBaseY = productHoverY;
      productRoot.position.set(productX, productStartY, productZ);
    } else {
      if (!productMoved) {
        productBaseX = productX;
        productBaseY = productHoverY;
      }

      productRoot.position.x = productBaseX;
      productRoot.position.z = productZ;

      if (productState === 'floating' || productState === 'entering') {
        productRoot.position.y = productBaseY;
      } else if (productState === 'landed') {
        productRoot.position.y = productRestY;
      }
    }
  }

  function setProductHint(main, alt) {
    hintMain.textContent = main;
    hintAlt.textContent = alt;
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.classList.remove('is-visible');
    }, 2800);
  }

  function startProduct() {
    if (!opened) return;

    closeMenuOnly();

    // Dikey ekranda kapak ürünün önüne park ediyor; ürün sahnesinde
    // ayının önünü kapatmaması için kapağı geçici olarak saklıyoruz.
    if (window.innerWidth / window.innerHeight < 0.8) {
      lidGroup.visible = false;
    }

    productState = 'entering';
    productEnteredAt = performance.now();
    balloonPopped = false;
    productAdded = false;
    productTagDismissed = false;
    productVy = 0;
    productSpin = 0;
    productBounces = 0;
    productBaseX = productX;
    productBaseY = productHoverY;
    productMoved = false;
    popT = 1;
    landingT = 1;
    lastBalloonTap = 0;

    productRoot.visible = true;
    productRoot.position.set(productX, productStartY, productZ);
    productRoot.rotation.set(0, 0, 0);
    product.bear.scale.set(1, 1, 1);
    product.balloon.visible = true;
    product.balloonMesh.visible = true;
    product.balloonKnot.visible = true;
    product.popPoints.visible = false;
    product.popRing.visible = false;
    product.landingRing.visible = false;
    productTag.classList.remove('is-added');
    productTag.classList.remove('is-popping');
    productTag.classList.remove('is-visible');
    productHint.textContent = 'Balona 2 kez tıkla';
    productHud.setAttribute('aria-hidden', 'false');
    body.classList.add('product-mode');

    setProductHint('Balona 2 kez tıkla', 'peluş ayı · 100 TL');
    showToast('Peluş Ayı yukarıdan geliyor · 100 TL');
    canvas.focus({ preventScroll: true });
  }

  function popBalloon() {
    if (!product || balloonPopped) return;
    if (productState !== 'entering' && productState !== 'floating') return;

    balloonPopped = true;
    productState = 'falling';
    productVy = -0.15;
    productSpin = (Math.random() - 0.5) * 1.8;
    productBounces = 0;

    product.balloon.visible = false;
    product.balloonMesh.visible = false;
    product.balloonKnot.visible = false;

    const balloonWorld = new THREE.Vector3();
    product.balloonMesh.getWorldPosition(balloonWorld);

    popT = 0;
    product.popPoints.visible = true;
    product.popPoints.position.copy(balloonWorld);
    popMaterial.opacity = 1;
    const popPositions = product.popPoints.geometry.attributes.position.array;
    for (let i = 0; i < popCount; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * 0.28;
      popPositions[i * 3] = Math.cos(angle) * radius;
      popPositions[i * 3 + 1] = (Math.random() - 0.35) * 0.28;
      popPositions[i * 3 + 2] = Math.sin(angle) * radius;
      product.popVelocities[i].set(
        Math.cos(angle) * (0.8 + Math.random() * 2.2),
        0.5 + Math.random() * 2.4,
        Math.sin(angle) * (0.8 + Math.random() * 2.2)
      );
    }
    product.popPoints.geometry.attributes.position.needsUpdate = true;

    product.popRing.visible = true;
    product.popRing.position.copy(balloonWorld);
    product.popRing.scale.setScalar(0.55);
    product.popRing.lookAt(camera.position);
    popRingMaterial.opacity = 0.55;

    productTag.classList.add('is-popping');
    productHint.textContent = 'Balon patladı!';
    setProductHint('Balon patladı', 'ayı sepete ekleniyor');
    showToast('Balon patladı · Peluş Ayı düşüyor');
  }

  function addToCart() {
    if (!product || productAdded) return;
    productAdded = true;
    cartCount += 1;

    cartCountEl.textContent = String(cartCount);
    cart.setAttribute('aria-hidden', 'false');
    cart.setAttribute(
      'aria-label',
      `Sepet, ${cartCount} ürün, toplam ${cartCount * 100} TL`
    );
    body.classList.add('has-cart');
    cart.classList.remove('is-bumped');
    void cart.offsetWidth;
    cart.classList.add('is-bumped');

    productHint.textContent = 'Sepete eklendi ✓';
    productTag.classList.add('is-added');
    productTag.classList.add('is-visible');
    setProductHint('Sepete eklendi', 'Peluş Ayı · 100 TL');
    showToast(`Peluş Ayı sepete eklendi · 100 TL`);
  }

  function triggerLandingPuff() {
    landingT = 0;
    product.landingRing.visible = true;
    product.landingRing.position.set(
      productRoot.position.x,
      FLOOR_Y + 0.008,
      productRoot.position.z
    );
    product.landingRing.scale.setScalar(0.7);
    landingRingMaterial.opacity = 0.7;
  }

  function updateProductEffects(dt) {
    if (popT < 1) {
      popT = Math.min(1, popT + dt / 0.9);
      const positions = product.popPoints.geometry.attributes.position.array;

      for (let i = 0; i < popCount; i += 1) {
        const velocity = product.popVelocities[i];
        positions[i * 3] += velocity.x * dt;
        positions[i * 3 + 1] += velocity.y * dt;
        positions[i * 3 + 2] += velocity.z * dt;
        velocity.y -= 2.1 * dt;
        velocity.multiplyScalar(0.988);
      }

      product.popPoints.geometry.attributes.position.needsUpdate = true;
      popMaterial.opacity = Math.max(0, 1 - popT);
      if (popT >= 1) product.popPoints.visible = false;
    }

    if (product.popRing.visible) {
      const ringT = Math.min(1, popT);
      product.popRing.scale.setScalar(0.55 + ringT * 1.25);
      popRingMaterial.opacity = Math.max(0, 0.55 * (1 - ringT));
      if (ringT >= 1) product.popRing.visible = false;
    }

    if (landingT < 1) {
      landingT = Math.min(1, landingT + dt / 0.7);
      product.landingRing.scale.setScalar(0.7 + landingT * 4.6);
      landingRingMaterial.opacity = Math.max(0, 0.7 * (1 - landingT));
      if (landingT >= 1) product.landingRing.visible = false;
    }
  }

  function updateProductTag() {
    if (
      !product ||
      productState === 'hidden' ||
      productTagDismissed
    ) {
      productTag.classList.remove('is-visible');
      return;
    }

    product.root.updateMatrixWorld(true);
    product.bear.getWorldPosition(product.anchor);
    product.anchor.project(camera);

    if (product.anchor.z > 1) {
      productTag.classList.remove('is-visible');
      return;
    }

    const sx = (product.anchor.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-product.anchor.y * 0.5 + 0.5) * window.innerHeight;
    const compact = window.innerWidth < 700;
    const offset = compact
      ? Math.min(112, window.innerWidth * 0.27)
      : 220;
    const verticalOffset = window.innerWidth < 900 ? -38 : -4;

    const tagWidth = productTag.offsetWidth || (compact ? 148 : 190);
    const tagHeight = productTag.offsetHeight || 92;
    const minY = tagHeight / 2 + 18;
    const maxY = window.innerHeight - tagHeight / 2 - 76;
    const minX = tagWidth / 2 + 14;
    const maxX = window.innerWidth - tagWidth / 2 - 14;
    const rightCenter = sx + offset;
    const leftCenter = sx - offset;
    const rightFits = rightCenter <= maxX;
    const leftFits = leftCenter >= minX;

    let tagX;
    if (rightFits) {
      tagX = rightCenter;
    } else if (leftFits) {
      tagX = leftCenter;
    } else {
      tagX = sx < window.innerWidth / 2 ? rightCenter : leftCenter;
    }

    const x = THREE.MathUtils.clamp(tagX, minX, maxX);
    const y = THREE.MathUtils.clamp(sy + verticalOffset, minY, maxY);

    productTag.style.transform = `translate3d(${x.toFixed(
      1
    )}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`;
    productTag.classList.add('is-visible');
  }

  function updateProduct(dt, elapsed) {
    if (!product || productState === 'hidden') return;

    let idleTurn = 0;

    if (productState === 'entering') {
      const duration = REDUCED_MOTION ? 240 : 1450;
      const t = Math.min(1, (performance.now() - productEnteredAt) / duration);
      const e = easeOutCubic(t);
      productRoot.position.x = productBaseX + Math.sin(t * Math.PI) * 0.1;
      productRoot.position.z = productZ;
      productRoot.position.y = THREE.MathUtils.lerp(
        productStartY,
        productBaseY,
        e
      );
      idleTurn = 0.18 * (1 - e);
      productRoot.rotation.z = Math.sin(t * Math.PI * 2) * 0.018 * (1 - e);

      if (t >= 1) {
        productState = 'floating';
        productRoot.position.x = productBaseX;
        productRoot.rotation.z = 0;
      }
    } else if (productState === 'floating') {
      const bob =
        REDUCED_MOTION || productMoved
          ? 0
          : Math.sin(elapsed * 1.55) * 0.045;
      const sway = REDUCED_MOTION ? 0 : Math.sin(elapsed * 0.82) * 0.02;
      idleTurn = REDUCED_MOTION ? 0 : Math.sin(elapsed * 0.5) * 0.07;
      productRoot.position.x = productBaseX;
      productRoot.position.z = productZ;
      productRoot.position.y = productBaseY + bob;
      productRoot.rotation.z = sway;
    } else if (productState === 'falling') {
      productVy += GRAVITY * dt;
      productRoot.position.x = productBaseX;
      productRoot.position.z = productZ;
      productRoot.position.y += productVy * dt;
      productRoot.rotation.z += productSpin * dt;
      productSpin *= Math.exp(-dt * 0.7);

      if (productRoot.position.y <= productRestY) {
        productRoot.position.y = productRestY;

        if (productBounces === 0 && Math.abs(productVy) > 1.4) {
          productBounces += 1;
          productVy = -productVy * 0.3;
          product.bear.scale.set(1.13, 0.86, 1.13);
          triggerLandingPuff();
        } else {
          productVy = 0;
          productSpin = 0;
          productState = 'landed';
          productRoot.rotation.z = 0;
          product.bear.scale.set(1.1, 0.9, 1.1);
          addToCart();
        }
      }
    } else if (productState === 'landed') {
      productRoot.position.x = productBaseX;
      productRoot.position.z = productZ;
      productRoot.position.y = productRestY;
      productRoot.rotation.z *= Math.exp(-dt * 8);
    }

    productRoot.rotation.y = idleTurn;
    productRoot.rotation.x = 0;

    // Patlama sonrası hafif esneme geri toparlanır.
    const recovery = 1 - Math.exp(-dt * 11);
    product.bear.scale.x += (1 - product.bear.scale.x) * recovery;
    product.bear.scale.y += (1 - product.bear.scale.y) * recovery;
    product.bear.scale.z += (1 - product.bear.scale.z) * recovery;

    updateProductEffects(dt);
    updateProductTag();
  }

  function dismissProduct() {
    if (!product) return;
    productState = 'hidden';
    productRoot.visible = false;
    product.balloon.visible = false;
    product.popPoints.visible = false;
    product.popRing.visible = false;
    product.landingRing.visible = false;
    lidGroup.visible = true;
    productTag.classList.remove('is-visible');
    productTag.classList.remove('is-popping');
    productTag.classList.remove('is-added');
    productTagDismissed = true;
    productHud.setAttribute('aria-hidden', 'true');
    body.classList.remove('product-mode');
  }

  /* ---------- kamera çerçeveleme ---------- */

  function updateFraming() {
    const aspect = window.innerWidth / window.innerHeight;
    const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const portrait = aspect < 0.8;

    const closedWidthFraction = portrait ? 0.82 : 0.43;
    const openWidthFraction = portrait ? 0.58 : 0.31;
    const byWidth = (fraction) =>
      LID_W / fraction / (2 * tan * aspect);

    framing.closedDist = Math.max(8.2, byWidth(closedWidthFraction));
    framing.openDist = Math.max(9.8, byWidth(openWidthFraction));
    framing.openTargetY = portrait ? 0.4 : 0.45;
  }

  updateFraming();
  layoutMenu();
  layoutProduct();

  /* ---------- menü düzeni ---------- */

  function layoutMenu() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const mobile = vw <= 860;

    if (!mobile) {
      const gap = Math.max(10, Math.min(16, vw * 0.012));
      const sideMargin = Math.max(18, vw * 0.02);
      const cardW = Math.min(
        272,
        Math.max(150, (vw - sideMargin * 2 - gap * 4) / 5)
      );
      const step = cardW + gap;
      const total = step * (menuItems.length - 1);
      const centerY = vh * 0.225;
      const rotations = [-7, -3.2, 0, 3.2, 7];
      const lifts = [28, 9, 0, 9, 28];

      menuItems.forEach((item, i) => {
        item.style.setProperty('--tx', `${(-total / 2 + step * i).toFixed(1)}px`);
        item.style.setProperty(
          '--ty',
          `${(centerY - vh / 2 + (lifts[i] ?? 4)).toFixed(1)}px`
        );
        item.style.setProperty('--rot', `${rotations[i] ?? 0}deg`);
        item.style.setProperty('--d', `${70 + i * 70}ms`);
      });
      menu.style.setProperty('--card-w', `${cardW.toFixed(1)}px`);
    } else {
      const cardW = Math.min(340, vw - 54);
      const stepY = 76;
      const centerY = Math.max(178, vh * 0.25);
      const xOffsets = [-8, 6, -4, 5, -7];
      const rotations = [-1.6, 1.2, 0, -1.1, 1.5];

      menuItems.forEach((item, i) => {
        item.style.setProperty(
          '--tx',
          `${xOffsets[i] ?? 0}px`
        );
        item.style.setProperty(
          '--ty',
          `${(centerY - vh / 2 + (i - (menuItems.length - 1) / 2) * stepY).toFixed(1)}px`
        );
        item.style.setProperty('--rot', `${rotations[i] ?? 0}deg`);
        item.style.setProperty('--d', `${60 + i * 58}ms`);
      });
      menu.style.setProperty('--card-w', `${cardW.toFixed(1)}px`);
    }
  }

  function mouthScreenOrigin() {
    const point = new THREE.Vector3(0, BOX_TOP + 0.16, 0);
    baseRoot.localToWorld(point);
    point.project(camera);
    return {
      x: (point.x * 0.5 + 0.5) * window.innerWidth,
      y: (-point.y * 0.5 + 0.5) * window.innerHeight,
    };
  }

  function setMenuOrigin() {
    const origin = mouthScreenOrigin();
    menu.style.setProperty(
      '--ox',
      `${(origin.x - window.innerWidth / 2).toFixed(1)}px`
    );
    menu.style.setProperty(
      '--oy',
      `${(origin.y - window.innerHeight / 2).toFixed(1)}px`
    );
  }

  /* ---------- menü aç / kapa ---------- */

  function setOpened(next, options = {}) {
    if (opened === next) return;
    opened = next;

    if (next) {
      autoSpin = false;
      layoutMenu();
      setMenuOrigin();

      menu.classList.add('is-open');
      menu.removeAttribute('aria-hidden');
      menu.inert = false;
      menuLinks.forEach((link) => {
        link.tabIndex = 0;
      });
      body.classList.add('box-open');

      hintMain.textContent = 'Kapağı kutuya geri sürükle';
      hintAlt.textContent = 'kapatmak için';

      triggerMouthFx();

      if (options.focusMenu) {
        window.setTimeout(
          () => {
            menuLinks[0]?.focus({ preventScroll: true });
          },
          REDUCED_MOTION ? 250 : 900
        );
      }
    } else {
      menu.classList.remove('is-open');
      menu.setAttribute('aria-hidden', 'true');
      menu.inert = true;
      menuLinks.forEach((link) => {
        link.tabIndex = -1;
      });
      body.classList.remove('box-open');

      hintMain.textContent = 'Sürükle & döndür';
      hintAlt.textContent = 'Kapağı yukarı kaldır';

      if (menu.contains(document.activeElement)) {
        a11yOpen.focus({ preventScroll: true });
      }
    }
  }

  function closeMenuOnly() {
    menu.classList.remove('is-open');
    menu.setAttribute('aria-hidden', 'true');
    menu.inert = true;
    menuLinks.forEach((link) => {
      link.tabIndex = -1;
    });
  }

  function triggerMouthFx() {
    ringT = 0;
    ring.visible = true;

    burstTime = 0;
    burst.visible = true;
    burstMaterial.opacity = 1;

    const positions = burst.geometry.attributes.position.array;
    for (let i = 0; i < burstCount; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * 0.72;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = BOX_TOP + 0.25 + Math.random() * 0.2;
      positions[i * 3 + 2] = Math.sin(angle) * radius;

      const speed = 0.6 + Math.random() * 1.8;
      const spread = Math.random() * Math.PI * 2;
      burstVelocities[i].set(
        Math.cos(spread) * speed * 0.62,
        0.9 + Math.random() * 2.1,
        Math.sin(spread) * speed * 0.62
      );
    }
    burst.geometry.attributes.position.needsUpdate = true;
  }

  /* ---------- sürükleme ---------- */

  function updatePointer(event) {
    pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
  }

  function hitLid(event) {
    if (!lidGroup.visible) return false;
    updatePointer(event);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(lidPickables, false);
    return hits.length > 0;
  }

  function hitBalloon(event) {
    if (!product || balloonPopped || !product.balloon.visible) return false;
    updatePointer(event);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(product.pickables, false);
    return hits.length > 0;
  }

  function hitBear(event) {
    if (
      !product ||
      (productState !== 'entering' && productState !== 'floating')
    ) {
      return false;
    }
    updatePointer(event);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(product.bearPickables, false);
    return hits.length > 0;
  }

  function productBearScreen() {
    productRoot.updateMatrixWorld(true);
    const point = new THREE.Vector3();
    product.bear.getWorldPosition(point);
    point.project(camera);
    return {
      x: (point.x * 0.5 + 0.5) * window.innerWidth,
      y: (-point.y * 0.5 + 0.5) * window.innerHeight,
    };
  }

  function computeProductDragBounds() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const bearPoint = new THREE.Vector3();
    const balloonPoint = new THREE.Vector3();
    const restPoint = new THREE.Vector3();

    product.bear.getWorldPosition(bearPoint);
    product.balloonMesh.getWorldPosition(balloonPoint);
    bearPoint.project(camera);
    balloonPoint.project(camera);
    restPoint.set(productBaseX, productRestY, productZ).project(camera);

    const bearY = (-bearPoint.y * 0.5 + 0.5) * vh;
    const balloonY = (-balloonPoint.y * 0.5 + 0.5) * vh;
    const restY = (-restPoint.y * 0.5 + 0.5) * vh;

    const marginX = vw < 700 ? 82 : vw < 900 ? 160 : 125;
    const minY = Math.max(120, bearY - balloonY + 78);
    let maxY = Math.min(vh - 90, restY - 18);
    if (maxY < minY + 40) maxY = minY + 40;

    productDragBounds.minX = marginX;
    productDragBounds.maxX = vw - marginX;
    productDragBounds.minY = minY;
    productDragBounds.maxY = maxY;
  }

  function beginBearDrag(event) {
    const screen = productBearScreen();
    productDragOffset.set(
      screen.x - event.clientX,
      screen.y - event.clientY
    );
    computeProductDragBounds();
    productDragPlane.setFromNormalAndCoplanarPoint(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 0, productZ)
    );
  }

  function moveProductToScreen(clientX, clientY) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const x = THREE.MathUtils.clamp(
      clientX,
      productDragBounds.minX,
      productDragBounds.maxX
    );
    const y = THREE.MathUtils.clamp(
      clientY,
      productDragBounds.minY,
      productDragBounds.maxY
    );

    productDragNdc.set((x / vw) * 2 - 1, -(y / vh) * 2 + 1);
    raycaster.setFromCamera(productDragNdc, camera);

    if (raycaster.ray.intersectPlane(productDragPlane, productDragPoint)) {
      productBaseX = productDragPoint.x;
      productBaseY = productDragPoint.y;
      productRoot.position.x = productBaseX;
      productRoot.position.y = productBaseY;
      productRoot.position.z = productZ;
    }
  }

  function setRayFromPointer(event) {
    updatePointer(event);
    raycaster.setFromCamera(pointer, camera);
  }

  function clampLidToScreen(position) {
    projected.copy(position).project(camera);
    if (projected.z > 1) return position;

    const nx = THREE.MathUtils.clamp(projected.x, -0.86, 0.86);
    const ny = THREE.MathUtils.clamp(projected.y, -0.86, 0.86);

    if (nx !== projected.x || ny !== projected.y) {
      projected.x = nx;
      projected.y = ny;
      position.copy(projected.unproject(camera));
    }
    return position;
  }

  function onPointerDown(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (snap || programTween) return;

    autoSpin = false;
    spinVelocity = 0;
    lastEventTime = performance.now();
    activePointerId = event.pointerId;

    if (hitBalloon(event)) {
      mode = 'balloon';
      lastMove.x = event.clientX;
      lastMove.y = event.clientY;
      canvas.classList.add('is-grabbing');
      canvas.classList.remove('is-over-lid');
      canvas.classList.remove('is-over-balloon');

      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        /* pointer capture desteklenmiyorsa sorun değil */
      }

      if (event.cancelable) event.preventDefault();
      return;
    }

    if (hitBear(event)) {
      mode = 'bear';
      beginBearDrag(event);
      canvas.classList.add('is-grabbing');
      canvas.classList.remove('is-over-lid');
      canvas.classList.remove('is-over-balloon');
      canvas.classList.remove('is-over-bear');

      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        /* pointer capture desteklenmiyorsa sorun değil */
      }

      if (event.cancelable) event.preventDefault();
      return;
    }

    if (hitLid(event)) {
      mode = 'lid';
      lidState = 'held';

      setLidKinematic();
      lidBody.velocity.setZero();
      lidBody.angularVelocity.setZero();

      camera.getWorldDirection(cameraDir);
      dragPlane.setFromNormalAndCoplanarPoint(cameraDir, lidGroup.position);

      if (raycaster.ray.intersectPlane(dragPlane, planeHit)) {
        lidDragOrigin.copy(planeHit);
        lidDragStart.copy(lidGroup.position);
      }

      heldLastPosition.copy(lidGroup.position);
      lidVelocity.set(0, 0, 0);
      lastLidMoveTime = performance.now();

      // Kapak elde tutulurken yavaşça kutuya hizalanır.
      holdQuatTarget.setFromAxisAngle(UP, baseRoot.rotation.y);

      lastMove.x = event.clientX;
      lastMove.y = event.clientY;
    } else {
      mode = 'rotate';
      lastMove.x = event.clientX;
      lastMove.y = event.clientY;
    }

    canvas.classList.add('is-grabbing');
    canvas.classList.remove('is-over-lid');

    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      /* pointer capture desteklenmiyorsa sorun değil */
    }

    if (event.cancelable) event.preventDefault();
  }

  function onPointerMove(event) {
    if (!mode) {
      if (event.pointerType !== 'touch') {
        const overBalloon = hitBalloon(event);
        const overBear = !overBalloon && hitBear(event);
        canvas.classList.toggle('is-over-balloon', overBalloon);
        canvas.classList.toggle('is-over-bear', overBear);
        canvas.classList.toggle(
          'is-over-lid',
          !overBalloon && !overBear && hitLid(event)
        );
      }
      return;
    }

    if (event.pointerId !== activePointerId) return;

    if (mode === 'balloon') {
      if (event.cancelable) event.preventDefault();
      return;
    }

    if (mode === 'bear') {
      moveProductToScreen(
        event.clientX + productDragOffset.x,
        event.clientY + productDragOffset.y
      );
      productMoved = true;

      if (event.cancelable) event.preventDefault();
      return;
    }

    if (mode === 'rotate') {
      const now = performance.now();
      const moveDt = Math.max(0.008, (now - lastEventTime) / 1000);
      lastEventTime = now;

      const dx = event.clientX - lastMove.x;
      lastMove.x = event.clientX;
      lastMove.y = event.clientY;

      baseRoot.rotation.y += dx * 0.0072;
      spinVelocity = THREE.MathUtils.clamp(
        (dx * 0.0072) / moveDt,
        -4.2,
        4.2
      );

      if (event.cancelable) event.preventDefault();
      return;
    }

    // Kapak sürükleme
    if (lidState !== 'held') return;
    setRayFromPointer(event);
    if (!raycaster.ray.intersectPlane(dragPlane, planeHit)) return;

    const next = planeHit
      .clone()
      .sub(lidDragOrigin)
      .add(lidDragStart);

    clampLidToScreen(next);

    next.x = THREE.MathUtils.clamp(next.x, -4.6, 4.6);
    next.z = THREE.MathUtils.clamp(next.z, -3.2, 3.2);

    // Kapağın altı zemine girmesin.
    const floorMin = FLOOR_Y + LID_H / 2 + 0.035;
    next.y = Math.max(next.y, floorMin);

    // Kutu ağzının üstündeyken kapağın içine gömülmesini engelle.
    const cosYaw = Math.cos(baseRoot.rotation.y);
    const sinYaw = Math.sin(baseRoot.rotation.y);
    const localX = next.x * cosYaw - next.z * sinYaw;
    const localZ = next.x * sinYaw + next.z * cosYaw;
    const overMouth =
      Math.abs(localX) < BOX_W / 2 + 0.16 &&
      Math.abs(localZ) < BOX_D / 2 + 0.16;

    if (overMouth) {
      next.y = Math.max(next.y, LID_Y + 0.025);
    }

    next.y = Math.min(next.y, 5.6);

    const now = performance.now();
    const moveDt = Math.max(0.008, (now - lastLidMoveTime) / 1000);
    lidVelocity.copy(next).sub(heldLastPosition).divideScalar(moveDt);
    if (lidVelocity.length() > 7.5) lidVelocity.setLength(7.5);
    heldLastPosition.copy(next);
    lastLidMoveTime = now;

    lidBody.position.set(next.x, next.y, next.z);
    lidGroup.position.copy(next);

    const lift = next.y - LID_Y;
    const currentSide = Math.hypot(next.x, next.z);

    if (!opened && (lift > OPEN_LIFT || currentSide > OPEN_SIDE)) {
      setOpened(true);
    }

    if (event.cancelable) event.preventDefault();
  }

  function onPointerUp(event) {
    if (!mode) return;
    if (event.pointerId !== activePointerId) return;

    if (mode === 'balloon') {
      if (hitBalloon(event)) {
        const now = performance.now();
        if (now - lastBalloonTap < 430) {
          lastBalloonTap = 0;
          popBalloon();
        } else {
          lastBalloonTap = now;
        }
      }
      mode = null;
      activePointerId = null;
      canvas.classList.remove('is-grabbing');
      canvas.classList.remove('is-over-balloon');
      return;
    }

    if (mode === 'bear') {
      mode = null;
      activePointerId = null;
      canvas.classList.remove('is-grabbing');

      if (event.pointerType !== 'touch') {
        const overBalloon = hitBalloon(event);
        const overBear = !overBalloon && hitBear(event);
        canvas.classList.toggle('is-over-balloon', overBalloon);
        canvas.classList.toggle('is-over-bear', overBear);
        canvas.classList.toggle('is-over-lid', !overBalloon && !overBear && hitLid(event));
      }
      return;
    }

    if (mode === 'rotate' && performance.now() - lastEventTime > 150) {
      // Kullanıcı döndürmeyi bırakıp beklediyse fırlatma momenti kalmasın.
      spinVelocity = 0;
    }
    if (mode === 'lid') finishLidDrag(event);
    mode = null;
    activePointerId = null;
    canvas.classList.remove('is-grabbing');
    if (event.pointerType !== 'touch') {
      const overBalloon = hitBalloon(event);
      const overBear = !overBalloon && hitBear(event);
      canvas.classList.toggle('is-over-balloon', overBalloon);
      canvas.classList.toggle('is-over-bear', overBear);
      canvas.classList.toggle(
        'is-over-lid',
        !overBalloon && !overBear && hitLid(event)
      );
    }
  }

  function finishLidDrag(event) {
    if (lidState !== 'held') return;

    const distance = lidGroup.position.distanceTo(HOME);
    const horizontalDistance = Math.hypot(
      lidGroup.position.x,
      lidGroup.position.z
    );

    if (!opened) {
      if (distance < 0.08) {
        resetLidClosed();
      } else {
        startClosingSnap();
      }
      return;
    }

    // Kutu ağzının ekrandaki noktasına yakın bırakıldıysa kapağı çek.
    const mouth = mouthScreenOrigin();
    const mouthDistance = event
      ? Math.hypot(event.clientX - mouth.x, event.clientY - mouth.y)
      : Infinity;
    const pointerNearMouth =
      mouthDistance <
      Math.min(
        150,
        Math.max(64, Math.min(window.innerWidth, window.innerHeight) * 0.18)
      );
    const pointerVeryNearMouth =
      mouthDistance <
      Math.max(70, Math.min(130, Math.min(window.innerWidth, window.innerHeight) * 0.12));

    const lowEnough = lidGroup.position.y < LID_Y + 0.5;
    const nearBox = horizontalDistance < 2.6;

    if (
      distance < SNAP_DISTANCE ||
      pointerVeryNearMouth ||
      (pointerNearMouth && lowEnough && nearBox)
    ) {
      startClosingSnap();
      return;
    }

    releaseLid();
  }

  function startLidParkDrop() {
    lidState = 'program';
    setLidKinematic();
    lidVelocity.set(0, 0, 0);
    restTimer = 0;

    const from = lidGroup.position.clone();
    const fromQ = lidGroup.quaternion.clone();
    const target = new THREE.Vector3(0.2, 2.15, 4.15);
    const control = from.clone().lerp(target, 0.5);
    control.y = Math.max(from.y, target.y) + 0.6;

    const toQ = new THREE.Quaternion().setFromAxisAngle(
      UP,
      baseRoot.rotation.y - 0.15
    );

    programTween = {
      start: performance.now(),
      duration: REDUCED_MOTION ? 180 : 430,
      from,
      control,
      to: target,
      fromQ,
      toQ,
      releaseX: 0.05,
      releaseZ: 0.15,
      releaseSpin: 0,
    };
  }

  function releaseLid() {
    const cosYaw = Math.cos(baseRoot.rotation.y);
    const sinYaw = Math.sin(baseRoot.rotation.y);
    const localX =
      lidGroup.position.x * cosYaw - lidGroup.position.z * sinYaw;
    const localZ =
      lidGroup.position.x * sinYaw + lidGroup.position.z * cosYaw;
    const overMouth =
      Math.abs(localX) < BOX_W / 2 + 0.18 &&
      Math.abs(localZ) < BOX_D / 2 + 0.18;
    const portrait = window.innerWidth / window.innerHeight < 0.8;

    // Portrede kapak kutunun önüne, görünür bir yere bırakılır.
    if (overMouth && portrait && lidGroup.position.y > LID_Y + 0.12) {
      startLidParkDrop();
      return;
    }

    setLidDynamic();
    lidBody.position.set(
      lidGroup.position.x,
      lidGroup.position.y,
      lidGroup.position.z
    );
    lidBody.quaternion.set(
      lidGroup.quaternion.x,
      lidGroup.quaternion.y,
      lidGroup.quaternion.z,
      lidGroup.quaternion.w
    );

    const vx = THREE.MathUtils.clamp(lidVelocity.x, -6, 6);
    const vy = THREE.MathUtils.clamp(lidVelocity.y, -4, 2.2);
    const vz = THREE.MathUtils.clamp(lidVelocity.z, -6, 6);

    let throwX = vx;
    let throwZ = vz;
    let throwY = vy;

    // Ağız üstünde bırakılan kapak kutuya geri düşüp menüyü kapatmasın:
    // hafifçe yana savrulur, sonra yerçekimi devralır.
    if (overMouth && lidGroup.position.y > LID_Y + 0.12) {
      const dir =
        Math.abs(lidGroup.position.x) > 0.12
          ? Math.sign(lidGroup.position.x)
          : -1;
      throwX = THREE.MathUtils.clamp(throwX + dir * 2.8, -6, 6);
      throwY = Math.max(throwY, 1.0);
      throwZ += (Math.random() - 0.5) * 0.6;
    }

    lidBody.velocity.set(throwX, throwY, throwZ);

    const tumble = THREE.MathUtils.clamp(
      (Math.hypot(throwX, throwY, throwZ) - 0.2) * 0.55,
      0,
      1
    );
    if (tumble > 0.01) {
      lidBody.angularVelocity.set(
        -throwZ * 0.52 + (Math.random() - 0.5) * 0.5,
        (Math.random() - 0.5) * 0.75,
        throwX * 0.52 + (Math.random() - 0.5) * 0.5
      );
    } else {
      lidBody.angularVelocity.setZero();
    }

    lidVelocity.set(0, 0, 0);
    lidState = 'free';
    restTimer = 0;
    syncLidVisual();
  }

  function resetLidClosed() {
    setOpened(false);
    lidState = 'closed';
    snap = null;
    setLidKinematic();
    lidBody.position.set(HOME.x, HOME.y, HOME.z);
    setLidYaw(baseRoot.rotation.y);
    syncLidVisual();
  }

  /* ---------- kapanma animasyonları ---------- */

  function startClosingSnap() {
    if (productState !== 'hidden') dismissProduct();
    setOpened(false);
    lidState = 'snapping';
    programTween = null;
    setLidKinematic();
    lidVelocity.set(0, 0, 0);

    const from = lidGroup.position.clone();
    const fromQ = lidGroup.quaternion.clone();
    const to = HOME.clone();
    const toQ = new THREE.Quaternion().setFromAxisAngle(
      UP,
      baseRoot.rotation.y
    );
    const distance = from.distanceTo(to);

    if (distance < 0.06) {
      resetLidClosed();
      return;
    }

    const control = from.clone().lerp(to, 0.5);
    control.y =
      Math.max(from.y, to.y) + Math.min(2.2, 0.7 + distance * 0.35);

    snap = {
      start: performance.now(),
      duration: REDUCED_MOTION ? 180 : Math.min(980, 480 + distance * 80),
      from,
      control,
      to,
      fromQ,
      toQ,
    };
  }

  function openProgrammatically() {
    if (opened || snap || programTween) return;

    setOpened(true, { focusMenu: true });
    a11yOpen.blur();
    setLidKinematic();
    lidState = 'program';

    const aspect = window.innerWidth / window.innerHeight;
    const portrait = aspect < 0.8;
    const from = lidGroup.position.clone();
    const fromQ = lidGroup.quaternion.clone();
    const target = portrait
      ? new THREE.Vector3(0.2, 2.15, 4.15)
      : new THREE.Vector3(-2.75, 2.0, -0.45);
    const toQ = new THREE.Quaternion().setFromAxisAngle(
      UP,
      baseRoot.rotation.y - 0.28
    );
    const control = from.clone().lerp(target, 0.5);
    control.y = Math.max(from.y, target.y) + 1.0;

    if (REDUCED_MOTION) {
      const rest = new THREE.Vector3(
        portrait ? 0.2 : -2.85,
        FLOOR_Y + LID_H / 2 + 0.002,
        portrait ? 4.15 : -0.45
      );
      lidBody.position.set(rest.x, rest.y, rest.z);
      setLidYaw(baseRoot.rotation.y - 0.28);
      setLidDynamic();
      lidState = 'free';
      syncLidVisual();
      return;
    }

    programTween = {
      start: performance.now(),
      duration: 680,
      from,
      control,
      to: target,
      fromQ,
      toQ,
      releaseX: portrait ? 0.2 : -0.45,
      releaseZ: portrait ? 0.15 : -0.08,
      releaseSpin: 0.14,
    };
  }

  function closeProgrammatically() {
    if (!opened) return;
    if (mode === 'lid') {
      mode = null;
      activePointerId = null;
      canvas.classList.remove('is-grabbing');
    }
    startClosingSnap();
    a11yOpen.focus({ preventScroll: true });
  }

  /* ---------- olaylar ---------- */

  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove, { passive: false });
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);

  canvas.addEventListener('pointerleave', () => {
    if (!mode) {
      canvas.classList.remove('is-over-lid');
      canvas.classList.remove('is-over-balloon');
      canvas.classList.remove('is-over-bear');
    }
  });

  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const delta = THREE.MathUtils.clamp(event.deltaY, -70, 70);
      cameraZoom = THREE.MathUtils.clamp(
        cameraZoom + delta * 0.0011,
        0.8,
        1.24
      );
    },
    { passive: false }
  );

  menuLinks.forEach((link) => {
    link.addEventListener('click', (event) => {
      if (link.dataset.product === 'bear') {
        event.preventDefault();
        startProduct();
      }
    });
  });

  cart.addEventListener('click', () => {
    if (cartCount === 0) return;
    showToast(
      `Sepetinde ${cartCount} adet Peluş Ayı var · ${cartCount * 100} TL`
    );
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && opened) {
      event.preventDefault();
      closeProgrammatically();
      return;
    }

    if (
      (event.key === 'Enter' || event.key === ' ') &&
      !balloonPopped &&
      (productState === 'entering' || productState === 'floating') &&
      (document.activeElement === canvas || document.activeElement === body)
    ) {
      event.preventDefault();
      popBalloon();
    }
  });

  a11yOpen.addEventListener('click', () => {
    openProgrammatically();
  });

  window.addEventListener('resize', () => {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    updateFraming();
    layoutMenu();
    layoutProduct();
    if (!opened) setMenuOrigin();
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) clock.getDelta();
  });

  /* ---------- animasyon döngüsü ---------- */

  let firstFrame = true;

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    const elapsed = clock.elapsedTime;

    openProgress += ((opened ? 1 : 0) - openProgress) *
      (1 - Math.exp(-dt * 4.6));

    if (introProgress < 1) {
      introProgress = Math.min(1, introProgress + dt / 1.5);
      const introEase = easeOutCubic(introProgress);
      worldGroup.scale.setScalar(0.9 + 0.1 * introEase);
      worldGroup.position.y = -0.16 * (1 - introEase);
    }

    // Kamera: açılırken biraz geri çekilip kutuyu aşağı kaydırır.
    // Ürün geldiğinde zemin ve ayı görünsün diye kadraj hafifçe aşağı/geri alınır.
    const productViewTarget = productState === 'hidden' ? 0 : 1;
    productView +=
      (productViewTarget - productView) * (1 - Math.exp(-dt * 3.2));

    const frameEase = smoothstep(openProgress);
    const baseTargetY = THREE.MathUtils.lerp(
      -0.08,
      framing.openTargetY,
      frameEase
    );
    const targetY = THREE.MathUtils.lerp(baseTargetY, 0.04, productView);
    const baseDistance =
      THREE.MathUtils.lerp(framing.closedDist, framing.openDist, frameEase) +
      (1 - easeOutCubic(introProgress)) * 0.65;
    const distance = (baseDistance + productView * 1.35) * cameraZoom;

    camera.position.set(0, targetY + distance * 0.3, distance * 0.955);
    camera.lookAt(0, targetY, 0);

    // Kutunun kendi kendine yavaş dönüşü
    if (autoSpin && !REDUCED_MOTION && mode === null && !opened) {
      baseRoot.rotation.y += dt * 0.055;
    }

    // Serbest bırakılan kutunun momentumu sürtünmeyle azalır.
    if (spinVelocity !== 0 && mode !== 'rotate') {
      baseRoot.rotation.y += spinVelocity * dt;
      spinVelocity *= Math.exp(-dt * 1.9);
      if (Math.abs(spinVelocity) < 0.012) spinVelocity = 0;
    }

    // Kutunun fizik gövdesini görsel dönüşle eşle.
    boxBody.quaternion.setFromAxisAngle(cannonUp, baseRoot.rotation.y);
    boxBody.aabbNeedsUpdate = true;

    // Kapak durumları
    if (lidState === 'closed') {
      lidBody.position.set(HOME.x, HOME.y, HOME.z);
      setLidYaw(baseRoot.rotation.y);
      syncLidVisual();
    } else if (lidState === 'held') {
      // Tutulan kapak yavaşça kutuya hizalanır (ters/yan yatmışsa doğrulur).
      const heldQ = new THREE.Quaternion(
        lidBody.quaternion.x,
        lidBody.quaternion.y,
        lidBody.quaternion.z,
        lidBody.quaternion.w
      );
      heldQ.slerp(holdQuatTarget, 1 - Math.exp(-dt * 12));
      lidBody.quaternion.set(heldQ.x, heldQ.y, heldQ.z, heldQ.w);
      lidGroup.quaternion.copy(heldQ);
    } else if (lidState === 'free') {
      world.step(1 / 60, dt, 4);
      syncLidVisual();

      lidUp.set(0, 1, 0).applyQuaternion(lidGroup.quaternion);
      const linearSpeed = lidBody.velocity.lengthSquared();
      const angularSpeed = lidBody.angularVelocity.lengthSquared();

      if (linearSpeed < 0.02 && angularSpeed < 0.07) {
        restTimer += dt;
      } else {
        restTimer = 0;
      }

      // Kutu ağzına yakın, düzgün şekilde oturduysa kendiliğinden kapan.
      if (opened && restTimer > 0.42) {
        const distance = lidGroup.position.distanceTo(HOME);
        if (distance < 0.9 && lidUp.y > 0.82) {
          startClosingSnap();
        }
      }
    } else if (lidState === 'snapping' && snap) {
      const t = Math.min(
        1,
        (performance.now() - snap.start) / snap.duration
      );
      const e = easeInOutCubic(t);
      const inv = 1 - e;

      lidGroup.position.set(
        inv * inv * snap.from.x +
          2 * inv * e * snap.control.x +
          e * e * snap.to.x,
        inv * inv * snap.from.y +
          2 * inv * e * snap.control.y +
          e * e * snap.to.y,
        inv * inv * snap.from.z +
          2 * inv * e * snap.control.z +
          e * e * snap.to.z
      );
      lidGroup.quaternion.copy(snap.fromQ).slerp(snap.toQ, e);

      lidBody.position.set(
        lidGroup.position.x,
        lidGroup.position.y,
        lidGroup.position.z
      );
      lidBody.quaternion.set(
        lidGroup.quaternion.x,
        lidGroup.quaternion.y,
        lidGroup.quaternion.z,
        lidGroup.quaternion.w
      );

      if (t >= 1) {
        lidState = 'closed';
        snap = null;
        restTimer = 0;
        lidBody.position.set(HOME.x, HOME.y, HOME.z);
        setLidYaw(baseRoot.rotation.y);
        syncLidVisual();
      }
    } else if (lidState === 'program' && programTween) {
      const t = Math.min(
        1,
        (performance.now() - programTween.start) / programTween.duration
      );
      const e = easeInOutCubic(t);
      const inv = 1 - e;

      lidGroup.position.set(
        inv * inv * programTween.from.x +
          2 * inv * e * programTween.control.x +
          e * e * programTween.to.x,
        inv * inv * programTween.from.y +
          2 * inv * e * programTween.control.y +
          e * e * programTween.to.y,
        inv * inv * programTween.from.z +
          2 * inv * e * programTween.control.z +
          e * e * programTween.to.z
      );
      lidGroup.quaternion
        .copy(programTween.fromQ)
        .slerp(programTween.toQ, e);

      lidBody.position.set(
        lidGroup.position.x,
        lidGroup.position.y,
        lidGroup.position.z
      );
      lidBody.quaternion.set(
        lidGroup.quaternion.x,
        lidGroup.quaternion.y,
        lidGroup.quaternion.z,
        lidGroup.quaternion.w
      );

      if (t >= 1) {
        const releaseX = programTween.releaseX;
        const releaseZ = programTween.releaseZ;
        const releaseSpin = programTween.releaseSpin || 0;
        programTween = null;
        setLidDynamic();
        lidBody.velocity.set(releaseX, 0.25, releaseZ);
        if (releaseSpin > 0) {
          lidBody.angularVelocity.set(
            releaseSpin,
            releaseSpin * 0.8,
            releaseX > 0 ? -releaseSpin * 1.6 : releaseSpin * 1.6
          );
        } else {
          lidBody.angularVelocity.setZero();
        }
        lidState = 'free';
        restTimer = 0;
        syncLidVisual();
      }
    }

    // Ağızdan yükselen ışık
    innerLight.intensity = openProgress * 13;
    innerGlowMaterial.opacity = openProgress * 0.72;
    glowMaterial.opacity = openProgress * 0.5;
    mouthGlow.scale.setScalar(1.9 + openProgress * 0.8);

    if (ringT < 1) {
      ringT += dt / 0.9;
      const ringEase = easeOutCubic(Math.min(ringT, 1));
      ring.scale.setScalar(1 + ringEase * 4.2);
      ringMaterial.opacity = Math.max(0, 0.62 * (1 - ringT));
      ring.rotation.z += dt * 0.3;
      if (ringT >= 1) {
        ring.visible = false;
        ringMaterial.opacity = 0;
      }
    }

    if (burstTime < 1) {
      burstTime += dt / 1.7;
      const positions = burst.geometry.attributes.position.array;

      for (let i = 0; i < burstCount; i += 1) {
        const velocity = burstVelocities[i];
        positions[i * 3] += velocity.x * dt;
        positions[i * 3 + 1] += velocity.y * dt;
        positions[i * 3 + 2] += velocity.z * dt;
        velocity.y -= 1.15 * dt;
        velocity.multiplyScalar(0.992);
      }

      burst.geometry.attributes.position.needsUpdate = true;
      burstMaterial.opacity = Math.max(0, 1 - burstTime);
      if (burstTime >= 1) burst.visible = false;
    }

    if (!REDUCED_MOTION) {
      const positions = dustGeometry.attributes.position.array;
      for (let i = 0; i < dustCount; i += 1) {
        const data = dustData[i];
        positions[i * 3 + 1] += data.speed * dt;
        positions[i * 3] +=
          Math.sin(elapsed * 0.28 + data.phase) * data.sway * dt;
        positions[i * 3 + 2] +=
          Math.cos(elapsed * 0.22 + data.phase) * data.sway * dt;

        if (positions[i * 3 + 1] > FLOOR_Y + 4.9) {
          positions[i * 3 + 1] = FLOOR_Y - 0.1;
          positions[i * 3] = (Math.random() - 0.5) * 9;
          positions[i * 3 + 2] = (Math.random() - 0.5) * 7;
        }
      }
      dustGeometry.attributes.position.needsUpdate = true;
    }

    updateProduct(dt, elapsed);

    renderer.render(scene, camera);

    if (firstFrame) {
      firstFrame = false;
      window.requestAnimationFrame(() => {
        body.classList.add('is-ready');
      });
    }
  });

  // İlk kare için menü başlangıç noktası (kapalıyken görünmez)
  window.requestAnimationFrame(() => {
    setMenuOrigin();
  });
}

/* ---------- küçük yardımcılar ---------- */

function smoothstep(value) {
  const x = Math.min(1, Math.max(0, value));
  return x * x * (3 - 2 * x);
}

function easeOutCubic(value) {
  const x = Math.min(1, Math.max(0, value));
  return 1 - Math.pow(1 - x, 3);
}

function easeInOutCubic(value) {
  const x = Math.min(1, Math.max(0, value));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}
