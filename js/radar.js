/* =========================================================
   radar.js — a full-page radar scope.

   - a sweep rotates around the center of the screen.
   - contacts move around the page but are only "painted" when
     the sweep passes them; the paint fades like old phosphor,
     leaving a short trail of past positions.
   - bring the cursor near a contact and it locks: brackets,
     a readout, and a range/bearing line. get closer and it
     jinks away (and pops a few flares).
   ========================================================= */

(() => {
  const CONFIG = {
    contactsPerPixel: 1 / 120000,
    minContacts: 6,
    maxContacts: 14,
    sweepPeriod: 6000,     // ms per revolution
    sweepTrail: 0.9,       // radians of afterglow behind the beam
    lockRadius: 220,       // px — cursor distance to get a lock
    evadeRadius: 140,      // px — cursor distance that makes them jink
    ringSpacing: 130,
    hudCoords: '39.83N 084.05W',
  };

  const INK = '233,228,216';
  const RED = 'rgba(255,60,60,0.8)';
  const CYAN = 'rgba(60,220,255,0.8)';
  const FONT = '"Courier Prime", "Courier New", monospace';

  const canvas = document.getElementById('radar');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const motion = reduceMotion ? 0.4 : 1;

  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const norm = (a) => ((a % TAU) + TAU) % TAU;          // 0..TAU
  const wrap = (a) => norm(a + Math.PI) - Math.PI;      // -PI..PI
  const pad = (n, w) => String(Math.round(n)).padStart(w, '0');

  let W = 0, H = 0, DPR = 1, cx = 0, cy = 0, maxR = 0;
  const scope = document.createElement('canvas'); // static rings/ticks, redrawn on resize
  const sctx = scope.getContext('2d');

  const pointer = { x: -9999, y: -9999 };
  const contacts = [];
  const flares = [];
  const pings = [];
  let sweep = -Math.PI / 2; // start pointing north
  let lockTarget = null;
  let nextId = Math.floor(rand(11, 80));

  // ---------- contacts ----------
  class Contact {
    constructor(fromEdge) {
      this.id = 'TRK ' + pad(nextId++ % 1000, 3);
      this.kind = Math.random() < 0.8 ? 'air' : 'surface';
      this.base = this.kind === 'air' ? rand(0.28, 0.6) : rand(0.1, 0.2);
      this.speed = this.base;
      this.alt = this.kind === 'air' ? 'FL' + pad(Math.round(rand(12, 39)) * 10, 3) : 'SFC';
      this.turn = 0;
      this.evade = 0;
      this.breakSide = 1;
      this.lastFlare = 0;
      this.lock = 0;      // 0..1, eases in/out
      this.trail = [];    // painted positions, newest first
      this.place(fromEdge);
    }

    place(fromEdge) {
      if (fromEdge) {
        const side = Math.floor(Math.random() * 4);
        const m = 40;
        if (side === 0) { this.x = rand(0, W); this.y = -m; }
        if (side === 1) { this.x = W + m; this.y = rand(0, H); }
        if (side === 2) { this.x = rand(0, W); this.y = H + m; }
        if (side === 3) { this.x = -m; this.y = rand(0, H); }
        // aim somewhere across the middle of the screen
        this.heading = Math.atan2(rand(H * 0.2, H * 0.8) - this.y, rand(W * 0.2, W * 0.8) - this.x);
      } else {
        this.x = rand(W * 0.05, W * 0.95);
        this.y = rand(H * 0.05, H * 0.95);
        this.heading = rand(0, TAU);
      }
      this.trail.length = 0;
    }

    update(dt, now) {
      // gentle wandering course changes
      this.turn = clamp(this.turn + rand(-0.0015, 0.0015) * dt, -0.004, 0.004);
      let desired = this.heading + this.turn * 8;
      let turnRate = 0.008;

      // jink away from the cursor
      const dx = this.x - pointer.x, dy = this.y - pointer.y;
      const d = Math.hypot(dx, dy);
      if (d < CONFIG.evadeRadius) {
        const k = 1 - d / CONFIG.evadeRadius;
        if (this.evade < 0.2) {
          // pick a break direction based on which side the threat is on
          const cross = Math.cos(this.heading) * dy - Math.sin(this.heading) * dx;
          this.breakSide = cross > 0 ? 1 : -1;
        }
        this.evade = Math.max(this.evade, k);
        desired = Math.atan2(dy, dx) + this.breakSide * 0.5;
        turnRate = 0.03 + k * 0.08;
        if (this.kind === 'air' && k > 0.35 && now - this.lastFlare > 1400 && !reduceMotion) {
          this.dropFlares();
          this.lastFlare = now;
        }
      }

      this.heading += clamp(wrap(desired - this.heading), -turnRate * dt, turnRate * dt);
      const target = this.base * (1 + this.evade * 4.5);
      this.speed += (target - this.speed) * 0.05 * dt;
      this.evade *= Math.pow(0.985, dt);

      this.x += Math.cos(this.heading) * this.speed * dt * motion;
      this.y += Math.sin(this.heading) * this.speed * dt * motion;

      // if the contact leaves the scope, bring in a new one from an edge.
      const m = 80;
      if (this.x < -m || this.x > W + m || this.y < -m || this.y > H + m) {
        this.id = 'TRK ' + pad(nextId++ % 1000, 3);
        this.place(true);
      }

      //lok-on easing (only the nearest contact in range is locked; set in frame())
      this.lock += ((this === lockTarget ? 1 : 0) - this.lock) * 0.12 * dt;
    }

    paint(now) {
      this.trail.unshift({ x: this.x, y: this.y, h: this.heading, s: this.speed, t: now });
      if (this.trail.length > 5) this.trail.pop();
      window.dispatchEvent(new CustomEvent('radar:paint'));
    }

    dropFlares() {
      const back = this.heading + Math.PI;
      for (let i = 0; i < 4; i++) {
        const a = back + rand(-0.7, 0.7);
        const s = rand(0.4, 1.1);
        flares.push({ x: this.x, y: this.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, r: rand(1, 1.8) });
      }
    }
  }

  // ---------- drawing ----------
  function drawScope() {
    scope.width = Math.round(W * DPR);
    scope.height = Math.round(H * DPR);
    sctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    sctx.clearRect(0, 0, W, H);

    //range rings
    sctx.strokeStyle = `rgba(${INK},0.05)`;
    sctx.lineWidth = 1;
    for (let r = CONFIG.ringSpacing; r < maxR; r += CONFIG.ringSpacing) {
      sctx.beginPath();
      sctx.arc(cx, cy, r, 0, TAU);
      sctx.stroke();
    }

    // crosshairs, darker
    sctx.strokeStyle = `rgba(${INK},0.045)`;
    sctx.beginPath();
    sctx.moveTo(cx, 0); sctx.lineTo(cx, H);
    sctx.moveTo(0, cy); sctx.lineTo(W, cy);
    sctx.stroke();

    // diagonals, fainter
    sctx.strokeStyle = `rgba(${INK},0.022)`;
    sctx.beginPath();
    for (const a of [Math.PI / 4, (3 * Math.PI) / 4]) {
      sctx.moveTo(cx - Math.cos(a) * maxR, cy - Math.sin(a) * maxR);
      sctx.lineTo(cx + Math.cos(a) * maxR, cy + Math.sin(a) * maxR);
    }
    sctx.stroke();

    // bearing ticks + labels on the main ring
    const R0 = Math.min(W, H) * 0.46;
    sctx.font = `10px ${FONT}`;
    sctx.textAlign = 'center';
    sctx.textBaseline = 'middle';
    for (let deg = 0; deg < 360; deg += 5) {
      const a = (deg - 90) * (Math.PI / 180); // 000 = north, clockwise
      const major = deg % 30 === 0;
      const len = major ? 10 : deg % 10 === 0 ? 5 : 3;
      sctx.strokeStyle = `rgba(${INK},${major ? 0.16 : 0.08})`;
      sctx.beginPath();
      sctx.moveTo(cx + Math.cos(a) * R0, cy + Math.sin(a) * R0);
      sctx.lineTo(cx + Math.cos(a) * (R0 - len), cy + Math.sin(a) * (R0 - len));
      sctx.stroke();
      if (major) {
        sctx.fillStyle = `rgba(${INK},0.16)`;
        sctx.fillText(pad(deg, 3), cx + Math.cos(a) * (R0 + 14), cy + Math.sin(a) * (R0 + 14));
      }
    }
    sctx.strokeStyle = `rgba(${INK},0.07)`;
    sctx.beginPath();
    sctx.arc(cx, cy, R0, 0, TAU);
    sctx.stroke();
  }

  const hasConic = typeof ctx.createConicGradient === 'function';

  function drawSweep() {
    const start = sweep - CONFIG.sweepTrail;
    if (hasConic) {
      const g = ctx.createConicGradient(start, cx, cy);
      const end = CONFIG.sweepTrail / TAU;
      g.addColorStop(0, `rgba(${INK},0)`);
      g.addColorStop(end * 0.7, `rgba(${INK},0.035)`);
      g.addColorStop(end, `rgba(${INK},0.11)`);
      g.addColorStop(Math.min(1, end + 0.0005), `rgba(${INK},0)`);
      g.addColorStop(1, `rgba(${INK},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    } else {
      const steps = 24;
      for (let i = 0; i < steps; i++) {
        const a0 = start + (CONFIG.sweepTrail * i) / steps;
        ctx.fillStyle = `rgba(${INK},${0.11 * Math.pow((i + 1) / steps, 2)})`;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, maxR, a0, a0 + CONFIG.sweepTrail / steps + 0.01);
        ctx.closePath();
        ctx.fill();
      }
    }
    // heading edge
    ctx.strokeStyle = `rgba(${INK},0.28)`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(sweep) * maxR, cy + Math.sin(sweep) * maxR);
    ctx.stroke();
  }

  function blip(x, y, alpha, size, kind) {
    const glow = ctx.createRadialGradient(x, y, 0, x, y, size * 5);
    glow.addColorStop(0, `rgba(${INK},${0.35 * alpha})`);
    glow.addColorStop(1, `rgba(${INK},0)`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, size * 5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = `rgba(${INK},${alpha})`;
    if (kind === 'surface') {
      ctx.fillRect(x - size, y - size, size * 2, size * 2);
    } else {
      ctx.beginPath();
      ctx.arc(x, y, size, 0, TAU);
      ctx.fill();
    }
  }

  function drawPainted(c, now) {
    for (let i = c.trail.length - 1; i >= 0; i--) {
      const p = c.trail[i];
      const age = (now - p.t) / CONFIG.sweepPeriod; // 0 → just painted, 1 → one rev ago
      const fade = Math.pow(clamp(1 - age / (i === 0 ? 1.05 : 1.6), 0, 1), 1.6);
      const a = fade * (i === 0 ? 1 : 0.45 / i) * (1 - c.lock * 0.7);
      if (a < 0.01) continue;
      blip(p.x, p.y, a, i === 0 ? 2.3 : 1.4, c.kind);

      if (i === 0) {
        // velocity leader line
        if (c.kind === 'air') {
          const L = 8 + p.s * 22;
          ctx.strokeStyle = `rgba(${INK},${a * 0.6})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + Math.cos(p.h) * L, p.y + Math.sin(p.h) * L);
          ctx.stroke();
        }
        ctx.font = `10px ${FONT}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = `rgba(${INK},${a * 0.5})`;
        ctx.fillText(c.id, p.x + 9, p.y - 7);
      }
    }
  }

  function drawLocked(c, now) {
    const a = c.lock;
    if (a < 0.02) return;
    const x = c.x, y = c.y;

    // live blip with the red/cyan split used in the headings
    ctx.globalAlpha = a;
    ctx.fillStyle = RED;  ctx.beginPath(); ctx.arc(x - 1.2, y, 2.6, 0, TAU); ctx.fill();
    ctx.fillStyle = CYAN; ctx.beginPath(); ctx.arc(x + 1.2, y, 2.6, 0, TAU); ctx.fill();
    blip(x, y, 1, 2.4, c.kind);

    //leader line
    const L = 10 + c.speed * 22;
    ctx.strokeStyle = `rgba(${INK},0.7)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(c.heading) * L, y + Math.sin(c.heading) * L);
    ctx.stroke();

    // corner brackets that close in as the lock settles
    const s = 12 + (1 - a) * 14;
    const k = 5;
    ctx.strokeStyle = `rgba(${INK},0.85)`;
    ctx.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      ctx.moveTo(x + sx * s, y + sy * (s - k));
      ctx.lineTo(x + sx * s, y + sy * s);
      ctx.lineTo(x + sx * (s - k), y + sy * s);
    }
    ctx.stroke();

    // readout
    const hdg = pad(norm(c.heading + Math.PI / 2) * (180 / Math.PI), 3);
    const lines = [c.id, `${c.alt}  HDG ${hdg}`, `SPD ${pad(c.base * 800 + c.evade * 180, 3)}KT`];
    const evading = c.evade > 0.25;
    ctx.font = `10px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const tx = x + s + 8, ty = y - s + 4;
    lines.forEach((t, i) => {
      ctx.fillStyle = `rgba(${INK},${i === 0 ? 0.9 : 0.55})`;
      ctx.fillText(t, tx, ty + i * 12);
    });
    if (evading && Math.floor(now / 220) % 2 === 0) {
      ctx.fillStyle = RED;
      ctx.fillText('EVADING', tx, ty + lines.length * 12);
    }
    ctx.globalAlpha = 1;
  }

  function drawLockLine(c) {
    if (!c || c.lock < 0.3) return;
    const dx = c.x - pointer.x, dy = c.y - pointer.y;
    const rng = Math.hypot(dx, dy);
    const brg = pad(norm(Math.atan2(dy, dx) + Math.PI / 2) * (180 / Math.PI), 3);
    ctx.globalAlpha = c.lock;
    ctx.strokeStyle = `rgba(${INK},0.3)`;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(pointer.x, pointer.y);
    ctx.lineTo(c.x, c.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = `10px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = `rgba(${INK},0.45)`;
    ctx.fillText(`RNG ${pad(rng, 3)}  BRG ${brg}`, (pointer.x + c.x) / 2, (pointer.y + c.y) / 2 - 8);
    ctx.globalAlpha = 1;
  }

  function drawFlares(dt) {
    for (let i = flares.length - 1; i >= 0; i--) {
      const f = flares[i];
      f.x += f.vx * dt; f.y += f.vy * dt;
      f.vx *= 0.97; f.vy *= 0.97;
      f.life -= 0.014 * dt;
      if (f.life <= 0) { flares.splice(i, 1); continue; }
      blip(f.x, f.y, f.life * 0.9, f.r, 'air');
    }
  }

  function drawPings(dt, now) {
    for (let i = pings.length - 1; i >= 0; i--) {
      const p = pings[i];
      const prev = p.r;
      p.r += 7 * dt;
      p.life = 1 - p.r / p.max;
      if (p.life <= 0) { pings.splice(i, 1); continue; }
      ctx.strokeStyle = `rgba(${INK},${0.3 * p.life})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.stroke();
      ctx.strokeStyle = `rgba(${INK},${0.12 * p.life})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0, p.r - 14), 0, TAU); ctx.stroke();
      // reveal anything the pulse front passes over
      for (const c of contacts) {
        const d = Math.hypot(c.x - p.x, c.y - p.y);
        if (d >= prev && d < p.r) c.paint(now);
      }
    }
  }

  function drawHud(locked) {
    if (W < 860) return;
    ctx.font = `10px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = `rgba(${INK},0.22)`;
    const brg = pad(norm(sweep + Math.PI / 2) * (180 / Math.PI), 3);
    ctx.fillText(`SWP ${brg}  ·  ${contacts.length} CONTACTS  ·  ${CONFIG.hudCoords}`, 24, H - 24);
    if (locked && locked.lock > 0.5) {
      ctx.fillStyle = `rgba(${INK},0.4)`;
      ctx.fillText(`TRACKING ${locked.id}`, 24, H - 40);
    } else {
      ctx.fillText('CLICK TO PING', 24, H - 40);
    }
  }

  // ----------loop---------
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    cx = W / 2;
    cy = H / 2;
    maxR = Math.hypot(W, H);
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawScope();

    const target = clamp(Math.round(W * H * CONFIG.contactsPerPixel), CONFIG.minContacts, CONFIG.maxContacts);
    while (contacts.length < target) contacts.push(new Contact(false));
    while (contacts.length > target) contacts.pop();
  }

  let last = performance.now();

  function frame(now) {
    const dt = clamp((now - last) / 16.667, 0.1, 3);
    const elapsed = now - last;
    last = now;

    // advance the sweep and paint anything it crossed
    // pick the single nearest contact within lock range
    lockTarget = null;
    let best = CONFIG.lockRadius;
    for (const c of contacts) {
      const d = Math.hypot(c.x - pointer.x, c.y - pointer.y);
      if (d < best) { best = d; lockTarget = c; }
    }

    const prevSweep = sweep;
    const step = (TAU * elapsed * motion) / CONFIG.sweepPeriod;
    sweep = norm(sweep + step);
    for (const c of contacts) {
      c.update(dt, now);
      const rel = norm(Math.atan2(c.y - cy, c.x - cx) - prevSweep);
      if (rel <= step) c.paint(now);
    }

    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(scope, 0, 0, W, H);
    drawSweep();
    drawPings(dt, now);
    drawFlares(dt);
    for (const c of contacts) drawPainted(c, now);

    // only the nearest lock gets the range line
    let nearest = null, nd = Infinity;
    for (const c of contacts) {
      drawLocked(c, now);
      const d = Math.hypot(c.x - pointer.x, c.y - pointer.y);
      if (c.lock > 0.3 && d < nd) { nd = d; nearest = c; }
    }
    drawLockLine(nearest);
    drawHud(nearest);

    requestAnimationFrame(frame);
  }

  // ---------- input ----------
  const clearPointer = () => { pointer.x = -9999; pointer.y = -9999; };

  window.addEventListener('pointermove', (e) => { pointer.x = e.clientX; pointer.y = e.clientY; }, { passive: true });
  window.addEventListener('pointerdown', (e) => {
    pointer.x = e.clientX; pointer.y = e.clientY;
    if (e.target.closest('a, button')) return; // don't ping when clicking links
    ping(e.clientX, e.clientY);
  }, { passive: true });
  window.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') setTimeout(clearPointer, 400); });
  document.addEventListener('mouseleave', clearPointer);
  window.addEventListener('blur', clearPointer);

  function ping(x, y) {
    pings.push({ x, y, r: 0, max: Math.max(W, H) * 0.75, life: 1 });
    // contacts near the ping scatter
    for (const c of contacts) {
      const d = Math.hypot(c.x - x, c.y - y);
      if (d < 260) {
        const k = 1 - d / 260;
        c.evade = Math.max(c.evade, k);
        c.heading = Math.atan2(c.y - y, c.x - x);
      }
    }
    window.dispatchEvent(new CustomEvent('radar:ping', { detail: { x, y } }));
  }

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 120);
  });

  // labels use the page font; redraw the scope once it has loaded
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(drawScope);

  resize();
  requestAnimationFrame((t) => { last = t; frame(t); });

  window.Radar = { ping };
})();
