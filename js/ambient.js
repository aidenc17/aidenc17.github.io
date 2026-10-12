/* =========================================================
   ambient.js — optional radar-room ambience, generated live
   with the Web Audio API (no audio files to host).

   - a low equipment hum with a little air noise
   - a faint tick each time the sweep paints a contact
   - a sonar-style ping (with echo) when you click
   ========================================================= */

(() => {
  const btn = document.getElementById('soundToggle');
  if (!btn) return;

  let ac = null;
  let master = null;
  let echo = null;
  let on = false;
  let lastTick = 0;

  function build() {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    master = ac.createGain();
    master.gain.value = 0;
    master.connect(ac.destination);

    // Echo bus for pings
    echo = ac.createDelay(1.5);
    echo.delayTime.value = 0.42;
    const fb = ac.createGain();
    fb.gain.value = 0.35;
    const echoFilter = ac.createBiquadFilter();
    echoFilter.type = 'lowpass';
    echoFilter.frequency.value = 1800;
    echo.connect(echoFilter).connect(fb).connect(echo);
    echoFilter.connect(master);

    // Hum: two slightly detuned low sines
    const hum = ac.createGain();
    hum.gain.value = 0.06;
    for (const f of [55, 55.6, 110.3]) {
      const o = ac.createOscillator();
      o.frequency.value = f;
      const g = ac.createGain();
      g.gain.value = f > 100 ? 0.25 : 0.5;
      o.connect(g).connect(hum);
      o.start();
    }
    hum.connect(master);

    // air: quiet filtered noise
    const len = ac.sampleRate * 3;
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < len; i++) {
      lastOut = (lastOut + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      data[i] = lastOut * 3.5;
    }
    const noise = ac.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    const ng = ac.createGain();
    ng.gain.value = 0.12;
    noise.connect(lp).connect(ng).connect(master);
    noise.start();
  }

  function tone(freq, dur, peak, toEcho) {
    const t = ac.currentTime;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    if (toEcho) g.connect(echo);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  function ping() {
    if (!on || !ac) return;
    tone(1180, 1.1, 0.16, true);
    tone(2360, 0.4, 0.03, false);
  }

  function tick() {
    if (!on || !ac) return;
    const now = ac.currentTime;
    if (now - lastTick < 0.08) return; // don't machine-gun when many paint at once
    lastTick = now;
    tone(1650 + Math.random() * 200, 0.05, 0.025, false);
  }

  function setOn(next) {
    on = next;
    if (!ac) build();
    if (ac.state === 'suspended') ac.resume();
    master.gain.cancelScheduledValues(ac.currentTime);
    master.gain.setTargetAtTime(on ? 0.6 : 0, ac.currentTime, 0.3);
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', on ? 'Turn ambient sound off' : 'Turn ambient sound on');
  }

  btn.addEventListener('click', () => setOn(!on));
  window.addEventListener('radar:ping', ping);
  window.addEventListener('radar:paint', tick);
})();
