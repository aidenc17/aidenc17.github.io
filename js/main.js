/* =========================================================
   main.js — page behaviour: typed quote, scroll reveals, year.
   ========================================================= */

(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- typed quote ----------
  const QUOTE = 'Education is what remains after one has forgotten what one has learned in school.';
  const el = document.getElementById('quoteText');
  const figure = el && el.closest('.quote');

  if (el) {
    if (reduceMotion) {
      el.textContent = QUOTE;
      figure.classList.add('done');
    } else {
      const caret = document.createElement('span');
      caret.className = 'caret';
      const text = document.createTextNode('');
      el.append(text, caret);

      let i = 0;
      const type = () => {
        text.data = QUOTE.slice(0, ++i);
        if (i < QUOTE.length) {
          const ch = QUOTE[i - 1];
          // typewriter rhythm: pause a beat on punctuation and spaces
          const delay = ch === ',' || ch === '.' ? 260 : ch === ' ' ? 70 : 28 + Math.random() * 45;
          setTimeout(type, delay);
        } else {
          figure.classList.add('done');
          setTimeout(() => caret.remove(), 2600);
        }
      };
      setTimeout(type, 1100); // start after the name has settled in
    }
  }

  // ---------- reveal entries as they scroll into view ----------
  const items = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !reduceMotion) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        // stagger siblings slightly
        const idx = Array.prototype.indexOf.call(el.parentElement.children, el);
        el.style.transitionDelay = `${idx * 80}ms`;
        el.classList.add('in');
        io.unobserve(el);
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
    items.forEach((el) => io.observe(el));
  } else {
    items.forEach((el) => el.classList.add('in'));
  }

  // ---------- dim the radar a little once you're reading ----------
  const scope = document.getElementById('radar');
  if (scope) {
    let ticking = false;
    const update = () => {
      const k = Math.min(window.scrollY / window.innerHeight, 1);
      scope.style.opacity = String(1 - k * 0.45);
      ticking = false;
    };
    window.addEventListener('scroll', () => {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();
  }

  // ---------- footer year ----------
  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();
})();
