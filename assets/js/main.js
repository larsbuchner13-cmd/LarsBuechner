(() => {
  'use strict';
  const scenes = [...document.querySelectorAll('[data-scene]')];
  const backgrounds = [...document.querySelectorAll('.backdrop')];
  const chapterLinks = [...document.querySelectorAll('.chapter-nav a')];
  const header = document.querySelector('.site-header');
  const toggle = document.querySelector('.motion-toggle');
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const desktop = window.matchMedia('(min-width: 721px) and (pointer: fine)');
  const depthLayers = [...document.querySelectorAll('.depth')];
  let motionEnabled = !preference.matches;
  try { const saved = localStorage.getItem('lars-motion'); if (saved !== null && !preference.matches) motionEnabled = saved === 'on'; } catch {}
  let current = -1, framePending = false, pointerX = 0, pointerY = 0;
  function updateMotion() {
    document.body.classList.toggle('motion-off', !motionEnabled);
    document.body.classList.toggle('motion-on', motionEnabled);
    toggle.setAttribute('aria-pressed', String(motionEnabled));
    toggle.querySelector('.motion-state').textContent = motionEnabled ? 'an' : 'aus';
    toggle.setAttribute('aria-label', `3D-Bewegung ${motionEnabled ? 'ausschalten' : 'einschalten'}`);
    if (!motionEnabled) {
      document.documentElement.style.setProperty('--bg-x', '0px');
      document.documentElement.style.setProperty('--bg-y', '0px');
      depthLayers.forEach(layer => { layer.style.setProperty('--rx', '0deg'); layer.style.setProperty('--ry', '0deg'); });
    }
    schedule();
  }
  toggle.addEventListener('click', () => { motionEnabled = !motionEnabled; try { localStorage.setItem('lars-motion', motionEnabled ? 'on' : 'off'); } catch {} updateMotion(); });
  preference.addEventListener('change', event => { motionEnabled = !event.matches; updateMotion(); });
  function render() {
    framePending = false;
    const marker = window.innerHeight * .47;
    let next = 0;
    scenes.forEach((scene, index) => { if (scene.getBoundingClientRect().top <= marker) next = index; });
    if (next !== current) {
      current = next;
      backgrounds.forEach((bg, index) => bg.classList.toggle('active', index === next));
      chapterLinks.forEach((link, index) => { link.classList.toggle('active', index === next); if (index === next) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current'); });
      const navTarget = next >= 2 && next <= 4 ? '#projekte' : `#${scenes[next].id}`;
      document.querySelectorAll('.site-header nav a').forEach(link => { if (link.getAttribute('href') === navTarget) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current'); });
    }
    header.classList.toggle('scrolled', window.scrollY > 30);
    const total = document.documentElement.scrollHeight - window.innerHeight;
    document.documentElement.style.setProperty('--progress', total > 0 ? Math.min(1, Math.max(0, window.scrollY / total)) : 0);
    if (motionEnabled && desktop.matches) {
      const offset = scenes[current].getBoundingClientRect().top / window.innerHeight;
      document.documentElement.style.setProperty('--bg-x', `${pointerX * -10}px`);
      document.documentElement.style.setProperty('--bg-y', `${offset * -22 + pointerY * -7}px`);
      depthLayers.forEach(layer => { layer.style.setProperty('--rx', `${pointerY * -3}deg`); layer.style.setProperty('--ry', `${pointerX * 5}deg`); });
    }
  }
  function schedule() { if (!framePending) { framePending = true; requestAnimationFrame(render); } }
  window.addEventListener('scroll', schedule, {passive:true});
  window.addEventListener('resize', schedule, {passive:true});
  window.addEventListener('pointermove', event => { if (!motionEnabled || !desktop.matches) return; pointerX = (event.clientX / window.innerWidth - .5) * 2; pointerY = (event.clientY / window.innerHeight - .5) * 2; schedule(); }, {passive:true});
  document.documentElement.addEventListener('pointerleave', () => { pointerX = 0; pointerY = 0; schedule(); });
  window.addEventListener('pageshow', schedule);
  updateMotion();
})();
