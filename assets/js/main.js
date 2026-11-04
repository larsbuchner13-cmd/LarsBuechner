(() => {
  'use strict';
  const scenes = [...document.querySelectorAll('section[data-scene]')];
  const chapterLinks = [...document.querySelectorAll('.chapter-nav a')];
  const header = document.querySelector('.site-header');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let pending = false, current = -1;
  function render() {
    pending = false;
    const marker = scrollY + innerHeight*.45;
    let index = 0;
    scenes.forEach((scene,i) => { if(scene.offsetTop <= marker) index=i; });
    if(index!==current) {
      current=index;
      document.body.dataset.chapter=String(index);
      chapterLinks.forEach((link,i) => {
        link.classList.toggle('active',i===index);
        if(i===index)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');
      });
      const navTarget=index>=2&&index<=4?'#projekte':`#${scenes[index].id}`;
      document.querySelectorAll('.site-header nav a').forEach(link => {
        if(link.getAttribute('href')===navTarget)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');
      });
    }
    const stops=scenes.map((scene,i) => i===0?0:scene.offsetTop-innerHeight*.36);
    let from=0;
    stops.forEach((stop,i)=>{if(scrollY>=stop)from=i;});
    const next=Math.min(scenes.length-1,from+1);
    const fraction=next===from?0:Math.min(1,Math.max(0,(scrollY-stops[from])/(stops[next]-stops[from])));
    const progress=from+fraction;
    const heroShift=Math.min(1,scrollY/Math.max(1,scenes[0].offsetHeight-innerHeight*.6));
    dispatchEvent(new CustomEvent('portfolio:scene',{detail:{progress,heroShift}}));
    header.classList.toggle('scrolled',scrollY>40);
    const total=document.documentElement.scrollHeight-innerHeight;
    document.documentElement.style.setProperty('--progress',total>0?Math.min(1,scrollY/total):0);
  }
  function schedule(){if(!pending){pending=true;requestAnimationFrame(render);}}
  if('IntersectionObserver' in window){
    const observer=new IntersectionObserver(entries=>{
      entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('in-view');observer.unobserve(entry.target);}});
    },{threshold:.08});
    document.querySelectorAll('.scene:not(.hero)>.content').forEach(item=>observer.observe(item));
    document.body.classList.add('reveal-ready');
  }
  addEventListener('scroll',schedule,{passive:true});
  addEventListener('resize',schedule,{passive:true});
  addEventListener('pageshow',schedule);
  document.fonts?.ready.then(schedule);
  reduced.addEventListener('change',schedule);
  schedule();
})();
