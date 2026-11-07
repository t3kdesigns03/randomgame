// Three.js view of the simulation. Low-poly, no shadows, no post-processing: neon lines + additive
// glow sprites keep it cheap on phones. Physics is Z-up in uu; Three is Y-up in metres:
//   three = (x, z, -y) / 100
import * as THREE from 'three';
import * as K from '../physics/constants.js';
import { len } from '../physics/vec.js';

const S = 1 / 100;
const tv = (v, out = new THREE.Vector3()) => out.set(v.x * S, v.z * S, -v.y * S);

const COLORS = {
  bg: 0x04060f,
  grid: new THREE.Color(0x1b6fff),
  gridHot: new THREE.Color(0x22e4ff),
  player: 0x22d3ee,
  playerBody: 0x0b5f86,
  bot: 0xff3d9a,
  botBody: 0x7a1450,
  net: 0xfff27a,
  ball: 0xffffff,
  boost: 0xffa630,
};

// ---------------------------------------------------------------- textures
function glowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, inner);
  grd.addColorStop(0.25, inner.replace(/[\d.]+\)$/, '0.55)'));
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------- arena
/** 1D coordinates across an axis of half-extent A with rounded edges of radius R. */
function axisCoords(A, R, step) {
  const pts = [];
  const arc = 6;
  for (let k = 0; k < arc; k++) pts.push(-A + R * (1 - Math.cos((k / arc) * Math.PI / 2)) * 0.999);
  const inner = A - R;
  const n = Math.max(1, Math.round((2 * inner) / step));
  for (let k = 0; k <= n; k++) pts.push(-inner + (2 * inner * k) / n);
  for (let k = arc - 1; k >= 0; k--) pts.push(A - R * (1 - Math.cos((k / arc) * Math.PI / 2)) * 0.999);
  return pts;
}

function buildArenaGeometry() {
  const AX = K.ARENA_HALF_X, AY = K.ARENA_HALF_Y, AZ = K.ARENA_HEIGHT / 2, R = K.ARENA_CORNER_RADIUS;
  const xs = axisCoords(AX, R, 400), ys = axisCoords(AY, R, 400), zs = axisCoords(AZ, R, 400);
  const pos = [], nrm = [], idx = [];
  const inner = [AX - R, AY - R, AZ - R];
  const push = (x, y, z) => {
    // project the box point onto the rounded box (physics frame, centre at arena middle)
    const p = [x, y, z];
    const q = p.map((v, i) => Math.max(-inner[i], Math.min(inner[i], v)));
    const d = p.map((v, i) => v - q[i]);
    const dl = Math.hypot(d[0], d[1], d[2]) || 1;
    const o = q.map((v, i) => v + (d[i] / dl) * R);
    pos.push(o[0] * S, (o[2] + AZ) * S, -o[1] * S);
    nrm.push(-d[0] / dl, -d[2] / dl, d[1] / dl); // inward normal in three space
  };
  const face = (U, V, map) => {
    const start = pos.length / 3;
    for (const v of V) for (const u of U) push(...map(u, v));
    const w = U.length;
    for (let j = 0; j < V.length - 1; j++) {
      for (let i = 0; i < w - 1; i++) {
        const a = start + j * w + i, b = a + 1, c = a + w, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
  };
  face(xs, ys, (u, v) => [u, v, -AZ]);  // floor
  face(xs, ys, (u, v) => [u, v, AZ]);   // ceiling
  face(xs, zs, (u, v) => [u, -AY, v]);  // south wall
  face(xs, zs, (u, v) => [u, AY, v]);   // north wall
  face(ys, zs, (u, v) => [-AX, u, v]);  // west wall
  face(ys, zs, (u, v) => [AX, u, v]);   // east wall
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

function arenaMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: {
      uGrid: { value: COLORS.grid },
      uHot: { value: COLORS.gridHot },
      uBg: { value: new THREE.Color(COLORS.bg) },
      uCam: { value: new THREE.Vector3() },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec3 vW; varying vec3 vN;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz; vN = normal;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uGrid; uniform vec3 uHot; uniform vec3 uBg; uniform vec3 uCam; uniform float uTime;
      varying vec3 vW; varying vec3 vN;
      float gridLine(float coord, float spacing, float width) {
        float f = abs(fract(coord / spacing - 0.5) - 0.5) * spacing;
        float w = fwidth(coord) * 1.2 + width;
        return 1.0 - smoothstep(width, w, f);
      }
      void main() {
        vec3 n = abs(normalize(vN));
        float g = 0.0;
        g = max(g, gridLine(vW.x, 5.12, 0.012) * (1.0 - n.x));
        g = max(g, gridLine(vW.y, 5.12, 0.012) * (1.0 - n.y));
        g = max(g, gridLine(vW.z, 5.12, 0.012) * (1.0 - n.z));
        float fine = 0.0;
        fine = max(fine, gridLine(vW.x, 1.28, 0.004) * (1.0 - n.x));
        fine = max(fine, gridLine(vW.z, 1.28, 0.004) * (1.0 - n.z));
        fine *= n.y; // fine grid only on floor/ceiling
        float height = clamp(vW.y / 20.0, 0.0, 1.0);
        vec3 lineCol = mix(uGrid, uHot, height);
        float dist = length(vW - uCam);
        float fade = exp(-dist * 0.018);
        vec3 col = uBg + lineCol * (g * 0.95 + fine * 0.18) * (0.35 + 0.65 * fade);
        // faint glow toward the top of the walls
        col += uHot * 0.06 * height * (1.0 - n.y);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

// ---------------------------------------------------------------- court + net
function rectLines(x0, y0, x1, y1, w, color, opacity = 1) {
  // four thin quads on the floor (physics coords, y0<y1)
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: false });
  const seg = (ax, ay, bx, by) => {
    const lx = Math.abs(bx - ax) + w, ly = Math.abs(by - ay) + w;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(lx * S, ly * S), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(((ax + bx) / 2) * S, 0.012, (-(ay + by) / 2) * S);
    group.add(m);
  };
  seg(x0, y0, x1, y0); seg(x0, y1, x1, y1); seg(x0, y0, x0, y1); seg(x1, y0, x1, y1);
  return group;
}

function buildCourt(scene) {
  const CX = K.COURT_HALF_X, CY = K.COURT_HALF_Y;
  // tinted court halves (in/out readability)
  for (const [side, color] of [[-1, COLORS.player], [1, COLORS.bot]]) {
    const fill = new THREE.Mesh(
      new THREE.PlaneGeometry(2 * CX * S, CY * S),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.07, depthWrite: false }),
    );
    fill.rotation.x = -Math.PI / 2;
    fill.position.set(0, 0.008, (-side * CY / 2) * S);
    scene.add(fill);
    const y0 = side < 0 ? -CY : 0, y1 = side < 0 ? 0 : CY;
    scene.add(rectLines(-CX, y0, CX, y1, 20, color, 0.85));
    // centre service line
    scene.add(rectLines(-6, y0, 6, y1, 12, color, 0.35));
  }
}

function netTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 3;
  g.strokeRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set((2 * K.ARENA_HALF_X) / 120, K.NET_HEIGHT / 120);
  return t;
}

function buildNet(scene) {
  const w = 2 * K.ARENA_HALF_X, h = K.NET_HEIGHT;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w * S, h * S),
    new THREE.MeshBasicMaterial({ map: netTexture(), color: 0xbdf6ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
  );
  mesh.position.set(0, (h / 2) * S, 0);
  scene.add(mesh);
  const top = new THREE.Mesh(
    new THREE.BoxGeometry(w * S, 0.1, 0.1),
    new THREE.MeshBasicMaterial({ color: COLORS.net }),
  );
  top.position.set(0, h * S, 0);
  scene.add(top);
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(w * S, 0.9),
    new THREE.MeshBasicMaterial({ color: COLORS.net, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  glow.position.set(0, h * S, 0);
  scene.add(glow);
}

// ---------------------------------------------------------------- ribbon trail
class Ribbon {
  constructor(scene, n, width, color, opacity = 0.8) {
    this.n = n; this.width = width;
    this.pts = [];
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 2 * 3);
    this.alpha = new Float32Array(n * 2);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('a', new THREE.BufferAttribute(this.alpha, 1));
    const idx = [];
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity } },
      vertexShader: `attribute float a; varying float vA; void main(){ vA = a; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying float vA; void main(){ gl_FragColor = vec4(uColor * vA * uOpacity, 1.0); }`,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
  push(p, on) {
    this.pts.unshift({ p: p.clone(), on });
    if (this.pts.length > this.n) this.pts.pop();
  }
  clear() { this.pts.length = 0; }
  update(camPos, widthScale = 1) {
    const P = this.pts, n = this.n;
    const tmp = new THREE.Vector3(), side = new THREE.Vector3(), view = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const a = P[Math.min(i, P.length - 1)];
      if (!a) { this.alpha[i * 2] = this.alpha[i * 2 + 1] = 0; continue; }
      const b = P[Math.min(i + 1, P.length - 1)] || a;
      tmp.subVectors(a.p, b.p);
      if (tmp.lengthSq() < 1e-8) tmp.set(0, 0, 1);
      view.subVectors(camPos, a.p);
      side.crossVectors(tmp, view).normalize();
      const fade = (1 - i / (n - 1)) * (a.on ? 1 : 0) * (i < P.length ? 1 : 0);
      const w = this.width * widthScale * (0.35 + 0.65 * (1 - i / n));
      this.pos.set([a.p.x + side.x * w, a.p.y + side.y * w, a.p.z + side.z * w], i * 6);
      this.pos.set([a.p.x - side.x * w, a.p.y - side.y * w, a.p.z - side.z * w], i * 6 + 3);
      this.alpha[i * 2] = this.alpha[i * 2 + 1] = fade;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.a.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- car
function buildCar(team) {
  const color = team < 0 ? COLORS.player : COLORS.bot;
  const body = team < 0 ? COLORS.playerBody : COLORS.botBody;
  const g = new THREE.Group();
  const L = K.CAR_HITBOX.x * S, W = K.CAR_HITBOX.y * S, H = K.CAR_HITBOX.z * S;
  const ox = K.CAR_HITBOX_OFFSET.x * S, oz = K.CAR_HITBOX_OFFSET.z * S;
  const bodyMat = new THREE.MeshLambertMaterial({ color: body, emissive: body, emissiveIntensity: 0.35 });
  const edgeMat = new THREE.LineBasicMaterial({ color });
  const addBox = (lx, ly, lz, x, y, z, mat = bodyMat, edges = true) => {
    const geo = new THREE.BoxGeometry(lx, ly, lz);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    g.add(m);
    if (edges) {
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat);
      e.position.copy(m.position);
      g.add(e);
    }
    return m;
  };
  // local mesh frame: x forward, y up, z right
  // low wedge-ish body: chassis sits down between the wheels (origin is 17 uu above the floor)
  addBox(L, 0.2, W, ox, 0.06, 0);                                       // chassis
  addBox(L * 0.34, 0.07, W * 0.92, ox + L * 0.3, 0.19, 0);             // hood
  addBox(L * 0.42, 0.15, W * 0.74, ox - L * 0.12, 0.23, 0);            // cabin
  addBox(L * 0.1, 0.035, W * 1.06, ox - L * 0.48, 0.3, 0);             // rear wing
  // nose stripe
  addBox(L * 0.3, 0.01, W * 0.16, ox + L * 0.3, 0.228, 0, new THREE.MeshBasicMaterial({ color }), false);
  // wheels
  const wheelGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.13, 10);
  wheelGeo.rotateX(Math.PI / 2);
  const wheelMat = new THREE.MeshBasicMaterial({ color: 0x0a0d18 });
  const rimMat = new THREE.LineBasicMaterial({ color });
  for (const [x, z] of [[0.5, 0.43], [0.5, -0.43], [-0.32, 0.43], [-0.32, -0.43]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.position.set(x, -0.02, z);
    g.add(w);
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(wheelGeo, 30), rimMat);
    e.position.copy(w.position);
    g.add(e);
  }
  // boost flame (cone pointing backwards)
  const flameGeo = new THREE.ConeGeometry(0.13, 0.7, 8, 1, true);
  flameGeo.rotateZ(Math.PI / 2);
  flameGeo.translate(-0.35, 0, 0);
  const flame = new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial({ color: COLORS.boost, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  flame.position.set(ox - L / 2, 0.08, 0);
  g.add(flame);
  const flameCore = new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
  flameCore.scale.set(0.6, 0.5, 0.5);
  flameCore.position.copy(flame.position);
  g.add(flameCore);
  // underglow
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.scale.set(2.6, 2.6, 1);
  glow.position.set(ox, 0, 0);
  g.add(glow);
  return { group: g, flame, flameCore, color };
}

// ---------------------------------------------------------------- view
export class GameView {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setClearColor(COLORS.bg);
    this.maxDpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = this.maxDpr;
    this.renderer.setPixelRatio(this.dpr);
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(COLORS.bg, 40, 120);
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 400);
    this.ballCam = false;
    this.fovKick = 0;

    this.scene.add(new THREE.HemisphereLight(0x9fdcff, 0x220a30, 1.4));

    this.arenaMat = arenaMaterial();
    this.scene.add(new THREE.Mesh(buildArenaGeometry(), this.arenaMat));
    buildCourt(this.scene);
    buildNet(this.scene);

    // ball
    const ballGeo = new THREE.IcosahedronGeometry(K.BALL_RADIUS * S, 1);
    this.ball = new THREE.Group();
    this.ball.add(new THREE.Mesh(ballGeo, new THREE.MeshBasicMaterial({ color: 0xdff9ff })));
    this.ball.add(new THREE.LineSegments(new THREE.EdgesGeometry(ballGeo), new THREE.LineBasicMaterial({ color: 0x22d3ee })));
    const ballGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x9ff3ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    ballGlow.scale.set(5.2, 5.2, 1);
    this.ballGlow = ballGlow;
    this.scene.add(this.ball, ballGlow);
    this.ballTrail = new Ribbon(this.scene, 26, 0.55, 0x7ff6ff, 0.55);
    // floor marker under the ball (depth cue)
    this.ballMarker = new THREE.Mesh(
      new THREE.RingGeometry(0.75, 0.95, 28),
      new THREE.MeshBasicMaterial({ color: 0x9ff3ff, transparent: true, opacity: 0.6, depthWrite: false }),
    );
    this.ballMarker.rotation.x = -Math.PI / 2;
    this.scene.add(this.ballMarker);

    // cars
    this.cars = [buildCar(-1), buildCar(1)];
    this.carTrails = [];
    for (const c of this.cars) {
      this.scene.add(c.group);
      this.carTrails.push(new Ribbon(this.scene, 22, 0.3, c.color, 0.7));
    }
    this.superTrails = [new Ribbon(this.scene, 30, 0.42, 0xffffff, 0.5), new Ribbon(this.scene, 30, 0.42, 0xffffff, 0.5)];

    // boost pads
    this.pads = [];
    this.padTex = glowTexture('rgba(255,180,60,1)', 'rgba(255,120,0,0)');
    this.padsBuilt = false;

    this.tmpV = new THREE.Vector3();
    this.camPos = new THREE.Vector3(0, 3, -30);
    this.camLook = new THREE.Vector3();
    this.camFwd = new THREE.Vector3(0, 0, -1);
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  buildPads(pads) {
    for (const p of pads) {
      const r = (p.big ? K.BOOST_PAD_BIG_RADIUS * 0.7 : K.BOOST_PAD_SMALL_RADIUS * 0.6) * S;
      const grp = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.RingGeometry(r * 0.75, r, p.big ? 24 : 14), new THREE.MeshBasicMaterial({ color: COLORS.boost, transparent: true, opacity: 0.9, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      const disc = new THREE.Mesh(new THREE.CircleGeometry(r * 0.75, p.big ? 24 : 14), new THREE.MeshBasicMaterial({ color: COLORS.boost, transparent: true, opacity: 0.25, depthWrite: false }));
      disc.rotation.x = -Math.PI / 2;
      grp.add(ring, disc);
      let orb = null;
      if (p.big) {
        orb = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.padTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        orb.scale.set(2.4, 2.4, 1);
        orb.position.y = 0.9;
        grp.add(orb);
      }
      grp.position.set(p.x * S, 0.015, -p.y * S);
      this.scene.add(grp);
      this.pads.push({ grp, ring, disc, orb });
    }
    this.padsBuilt = true;
  }

  resize() {
    const w = this.renderer.domElement.clientWidth || innerWidth;
    const h = this.renderer.domElement.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.baseFov = this.vFovForHorizontal(w / h);
    this.camera.updateProjectionMatrix();
  }

  /** Keep a ~100 degree horizontal view on wide phones, but never below 62 degrees vertical. */
  vFovForHorizontal(aspect) {
    const h = (100 * Math.PI) / 180;
    const v = 2 * Math.atan(Math.tan(h / 2) / aspect) * (180 / Math.PI);
    return Math.max(62, Math.min(80, v));
  }

  setPixelRatio(r) {
    this.dpr = r;
    this.renderer.setPixelRatio(r);
    this.resize();
  }

  resetTrails() {
    this.ballTrail.clear();
    for (const t of this.carTrails) t.clear();
    for (const t of this.superTrails) t.clear();
  }

  render(game, dt, time) {
    const w = game.world;
    if (!this.padsBuilt) this.buildPads(w.pads);

    // ball
    const ball = w.ball;
    tv(ball.pos, this.ball.position);
    this.ball.rotation.x += ball.ang.x * dt;
    this.ball.rotation.y += ball.ang.z * dt;
    this.ball.rotation.z += -ball.ang.y * dt;
    this.ballGlow.position.copy(this.ball.position);
    const bspeed = len(ball.vel);
    this.ballGlow.material.opacity = 0.55 + Math.min(0.4, bspeed / 6000);
    this.ballTrail.push(this.ball.position, bspeed > 300);
    this.ballMarker.position.set(ball.pos.x * S, 0.02, -ball.pos.y * S);
    const hgt = Math.max(0, ball.pos.z - K.BALL_RADIUS);
    this.ballMarker.material.opacity = Math.max(0.12, 0.7 - hgt / 2200);
    const ms = 1 + Math.min(1.2, hgt / 1500);
    this.ballMarker.scale.set(ms, ms, ms);

    // cars
    const m = new THREE.Matrix4();
    const f = new THREE.Vector3(), u = new THREE.Vector3(), r = new THREE.Vector3();
    w.cars.forEach((car, i) => {
      const v = this.cars[i];
      tv(car.R.f, f); tv(car.R.u, u);
      r.crossVectors(f, u); // mesh z = right
      m.makeBasis(f, u, r);
      v.group.quaternion.setFromRotationMatrix(m);
      tv(car.pos, v.group.position);
      const flick = 0.75 + Math.random() * 0.5;
      const on = car.boosting;
      v.flame.visible = v.flameCore.visible = on;
      if (on) { v.flame.scale.set(flick, 1, 1); v.flameCore.scale.set(0.6 * flick, 0.5, 0.5); }
      // trail from the rear of the car
      const rear = this.tmpV.copy(f).multiplyScalar(-0.5).add(v.group.position).addScaledVector(u, 0.25);
      this.carTrails[i].push(rear, on);
      this.superTrails[i].push(rear, car.supersonic);
    });

    // pads
    w.pads.forEach((p, i) => {
      const v = this.pads[i];
      const active = p.timer <= 0;
      v.ring.material.opacity = active ? 0.9 : 0.15;
      v.disc.material.opacity = active ? 0.25 + 0.1 * Math.sin(time * 4 + i) : 0.03;
      if (v.orb) { v.orb.visible = active; v.orb.position.y = 0.9 + 0.12 * Math.sin(time * 3 + i); }
    });

    this.updateCamera(game, dt);
    this.arenaMat.uniforms.uCam.value.copy(this.camera.position);
    this.arenaMat.uniforms.uTime.value = time;
    this.ballTrail.update(this.camera.position);
    this.carTrails.forEach((t) => t.update(this.camera.position));
    this.superTrails.forEach((t) => t.update(this.camera.position));
    this.renderer.render(this.scene, this.camera);
  }

  updateCamera(game, dt) {
    const car = game.world.cars[0];
    const carP = tv(car.pos, new THREE.Vector3());
    const ballP = tv(game.world.ball.pos, new THREE.Vector3());
    const dist = 3.4, height = 1.45; // ~RL default cam (distance 270-340 uu, height 100-145 uu)
    let desiredFwd;
    if (this.ballCam) {
      desiredFwd = new THREE.Vector3().subVectors(ballP, carP);
      desiredFwd.y = 0;
    } else {
      // car cam: follow the car's heading (flattened); while airborne, follow it more loosely
      desiredFwd = tv(car.R.f, new THREE.Vector3());
      desiredFwd.y = 0;
      if (!car.onGround || car.groundN.z < 0.7) {
        const vel = tv(car.vel, new THREE.Vector3()); vel.y = 0;
        if (vel.lengthSq() > 0.5) desiredFwd.lerp(vel.normalize(), 0.5);
      }
    }
    if (desiredFwd.lengthSq() < 1e-4) desiredFwd.copy(this.camFwd);
    desiredFwd.normalize();
    const k = 1 - Math.exp(-dt * (this.ballCam ? 7 : 9));
    this.camFwd.lerp(desiredFwd, k).normalize();
    const target = carP.clone().addScaledVector(this.camFwd, -dist);
    target.y = Math.max(carP.y, 0.2) + height;
    this.camPos.lerp(target, 1 - Math.exp(-dt * 14));
    // keep the camera inside the arena
    this.camPos.x = Math.max(-K.ARENA_HALF_X * S + 0.6, Math.min(K.ARENA_HALF_X * S - 0.6, this.camPos.x));
    this.camPos.z = Math.max(-K.ARENA_HALF_Y * S + 0.6, Math.min(K.ARENA_HALF_Y * S - 0.6, this.camPos.z));
    this.camPos.y = Math.min(K.ARENA_HEIGHT * S - 0.5, Math.max(0.4, this.camPos.y));
    this.camera.position.copy(this.camPos);
    const look = this.ballCam
      ? ballP.clone().lerp(carP, 0.15)
      : carP.clone().addScaledVector(this.camFwd, 2.2).add(new THREE.Vector3(0, 0.55, 0));
    this.camLook.lerp(look, 1 - Math.exp(-dt * 16));
    this.camera.lookAt(this.camLook);
    const kick = car.supersonic ? 7 : 0;
    this.fovKick += (kick - this.fovKick) * (1 - Math.exp(-dt * 5));
    const fov = this.baseFov + this.fovKick;
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
  }
}
