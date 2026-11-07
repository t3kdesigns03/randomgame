// On-screen touch controls: floating analog joystick (left thumb) + JUMP / BOOST / AIR ROLL (right thumb).
// Uses pointer events so multi-touch works (drive + boost + jump at the same time).

const STICK_RADIUS = 56; // px of thumb travel for full deflection

export function createTouchControls(host, input) {
  const el = document.createElement('div');
  el.className = 'touch';
  el.innerHTML = `
    <div class="stick-zone" data-zone>
      <div class="stick-base" data-base><div class="stick-knob" data-knob></div></div>
      <div class="stick-label">DRIVE</div>
    </div>
    <div class="btns">
      <button class="tbtn roll" data-btn="roll" aria-label="Air roll / powerslide"><span>AIR<br>ROLL</span></button>
      <button class="tbtn boost" data-btn="boost" aria-label="Boost"><span>BOOST</span></button>
      <button class="tbtn jump" data-btn="jump" aria-label="Jump (tap again in the air to flip)"><span>JUMP</span></button>
    </div>`;
  host.appendChild(el);

  const zone = el.querySelector('[data-zone]');
  const base = el.querySelector('[data-base]');
  const knob = el.querySelector('[data-knob]');
  const state = { stickX: 0, stickY: 0, jump: false, boost: false, roll: false };
  let stickId = null, cx = 0, cy = 0;

  const restBase = () => {
    base.classList.remove('active');
    base.style.left = '';
    base.style.top = '';
    knob.style.transform = 'translate(-50%, -50%)';
  };

  zone.addEventListener('pointerdown', (e) => {
    if (stickId !== null) return;
    e.preventDefault();
    stickId = e.pointerId;
    try { zone.setPointerCapture(e.pointerId); } catch { /* synthetic / already released pointer */ }
    const r = zone.getBoundingClientRect();
    // floating stick: centre where the thumb lands (kept inside the zone)
    cx = Math.min(Math.max(e.clientX, r.left + STICK_RADIUS), r.right - STICK_RADIUS);
    cy = Math.min(Math.max(e.clientY, r.top + STICK_RADIUS), r.bottom - STICK_RADIUS);
    base.style.left = `${cx - r.left}px`;
    base.style.top = `${cy - r.top}px`;
    base.classList.add('active');
    move(e);
  });
  const move = (e) => {
    if (e.pointerId !== stickId) return;
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const d = Math.hypot(dx, dy);
    if (d > STICK_RADIUS) { dx *= STICK_RADIUS / d; dy *= STICK_RADIUS / d; }
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    // small dead zone, then analog
    const nx = dx / STICK_RADIUS, ny = -dy / STICK_RADIUS;
    const m = Math.hypot(nx, ny);
    const k = m < 0.08 ? 0 : (m - 0.08) / 0.92 / m;
    state.stickX = nx * k;
    state.stickY = ny * k;
    input.setTouchState(state);
  };
  const end = (e) => {
    if (e.pointerId !== stickId) return;
    stickId = null;
    state.stickX = 0; state.stickY = 0;
    input.setTouchState(state);
    restBase();
  };
  zone.addEventListener('pointermove', move);
  addEventListener('pointermove', (e) => { if (e.target !== zone) move(e); });
  zone.addEventListener('pointerup', end);
  zone.addEventListener('pointercancel', end);
  addEventListener('pointerup', end);
  addEventListener('pointercancel', end);

  const owners = { jump: new Set(), boost: new Set(), roll: new Set() };
  for (const b of el.querySelectorAll('[data-btn]')) {
    const name = b.dataset.btn;
    const set = (on, id) => {
      if (on) owners[name].add(id); else owners[name].delete(id);
      state[name] = owners[name].size > 0;
      b.classList.toggle('down', state[name]);
      input.setTouchState(state);
    };
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      set(true, e.pointerId);
      try { b.setPointerCapture(e.pointerId); } catch { /* not capturable: window listeners below still release it */ }
    });
    const release = (e) => { if (owners[name].has(e.pointerId)) set(false, e.pointerId); };
    b.addEventListener('pointerup', release);
    b.addEventListener('pointercancel', release);
    addEventListener('pointerup', release);
    addEventListener('pointercancel', release);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  return {
    el,
    show(v) { el.classList.toggle('hidden', !v); },
    reset() {
      for (const k in owners) owners[k].clear();
      Object.assign(state, { stickX: 0, stickY: 0, jump: false, boost: false, roll: false });
      for (const b of el.querySelectorAll('[data-btn]')) b.classList.remove('down');
      stickId = null; restBase();
      input.touch = { ...state };
    },
  };
}
