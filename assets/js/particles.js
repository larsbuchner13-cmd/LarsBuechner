/* Original procedural 3D artwork. No third-party images, models or libraries. */
(() => {
  'use strict';
  const canvas = document.querySelector('#particle-world');
  if (!canvas) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const small = matchMedia('(max-width: 720px)');
  let gl;
  try { gl = canvas.getContext('webgl', {alpha:true, antialias:false, depth:false, powerPreference:'low-power'}); } catch {}
  if (!gl) { document.body.classList.add('canvas-unavailable'); return; }
  const vertex = `
    attribute vec3 aFrom;
    attribute vec3 aTo;
    attribute vec3 aMeta;
    uniform float uMix, uTime, uAngle, uScale, uAspect, uPixelRatio;
    uniform vec2 uOffset, uPointer;
    varying float vAlpha, vWhite;
    void main() {
      vec3 p = mix(aFrom, aTo, uMix);
      float yaw = uTime * 0.085 + uAngle + uPointer.x * 0.12;
      float pitch = -0.15 + uPointer.y * 0.08;
      p.xz = mat2(cos(yaw), -sin(yaw), sin(yaw), cos(yaw)) * p.xz;
      p.yz = mat2(cos(pitch), -sin(pitch), sin(pitch), cos(pitch)) * p.yz;
      float camera = 4.0 - p.z * 0.65;
      float perspective = 3.2 / camera;
      gl_Position = vec4(p.x * uScale * perspective / uAspect + uOffset.x,
                         p.y * uScale * perspective + uOffset.y, 0.0, 1.0);
      gl_PointSize = min(5.0 * uPixelRatio, aMeta.x * uPixelRatio * perspective);
      float pulse = 0.88 + 0.12 * sin(uTime * 0.7 + aMeta.z);
      vAlpha = aMeta.y * (0.36 + 0.50 * smoothstep(-1.0, 1.0, p.z)) * pulse;
      vWhite = step(0.985, aMeta.y);
    }
  `;
  const fragment = `
    precision mediump float;
    varying float vAlpha, vWhite;
    void main() {
      float d = length(gl_PointCoord - vec2(0.5));
      if (d > 0.5) discard;
      float glow = exp(-d * d * 14.0);
      vec3 green = mix(vec3(0.05, 0.84, 0.57), vec3(0.72, 1.0, 0.90), vWhite);
      gl_FragColor = vec4(green, glow * vAlpha * 1.85);
    }
  `;
  let program, buffers, locations, count, shapes, metadata;
  let sceneProgress = 0, heroShift = 0, pointerX = 0, pointerY = 0;
  let fromIndex = -1, toIndex = -1, frame = 0, lastFrame = 0, elapsed = 0, lastTime = 0;
  let contextLost = false, dirty = true;
  let seed = 91827;
  function random() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
  function shader(type, source) {
    const item = gl.createShader(type);
    gl.shaderSource(item, source); gl.compileShader(item);
    if (!gl.getShaderParameter(item, gl.COMPILE_STATUS)) { gl.deleteShader(item); throw new Error('Shader compile failed'); }
    return item;
  }
  function prepareShapes() {
    count = small.matches ? 7800 : 24500;
    shapes = Array.from({length:7}, () => new Float32Array(count * 3));
    metadata = new Float32Array(count * 3);
    seed = 91827;
    for (let i = 0; i < count; i++) {
      const u = i / count, a = random() * Math.PI * 2, b = random() * Math.PI * 2;
      const jitter = () => (random() - .5) * .065;
      const y = 1 - 2 * u, ring = Math.sqrt(Math.max(0, 1 - y*y));
      const golden = i * 2.399963229728653;
      const shell = i % 7 === 0;
      const r = shell ? 1.15 : 1 + (random() - .5) * .025;
      const sphere = shell ? [1.18*Math.cos(a), .33*Math.sin(a), 1.18*Math.sin(a)] : [Math.cos(golden) * ring * r, y * r, Math.sin(golden) * ring * r];
      // A connected sphere, a woven torus, a process helix, a planning grid,
      // two interlocking orbits, a rising path, and a converging knot.
      const torusR = .76 + .25 * Math.cos(b);
      const torus = [torusR*Math.cos(a), .30*Math.sin(b), torusR*Math.sin(a)];
      const strand = i % 2 ? 0 : Math.PI;
      const helixT = u * Math.PI * 6 + strand;
      const helix = [.65*Math.cos(helixT)+jitter(), (u-.5)*2.5, .65*Math.sin(helixT)+jitter()];
      const gx = (i % 100) / 99, gz = Math.floor(i/100) / Math.ceil(count/100);
      const grid = [(gx-.5)*2.5, .22*Math.sin(gx*8+gz*5) + ((i%3)-1)*.22, (gz-.5)*2.5];
      const orbitR = .86 + .035*Math.cos(b);
      const orbit = i % 2 ? [orbitR*Math.cos(a), .66*Math.sin(a), .38*Math.sin(a)+.035*Math.sin(b)] : [.38*Math.sin(a)+.035*Math.sin(b), .66*Math.sin(a), orbitR*Math.cos(a)];
      const pathT = u*Math.PI*7;
      const pathR = .25 + .65*u;
      const path = [pathR*Math.cos(pathT)+jitter(), (u-.5)*2.4, pathR*Math.sin(pathT)+jitter()];
      const knotT = a;
      const knotR = .72+.22*Math.cos(3*knotT);
      const knot = [knotR*Math.cos(2*knotT)+.055*Math.cos(b), .48*Math.sin(3*knotT)+.055*Math.sin(b), knotR*Math.sin(2*knotT)];
      [sphere,torus,helix,grid,orbit,path,knot].forEach((position,index) => shapes[index].set(position,i*3));
      metadata[i*3] = shell ? 1.3 + random() : 1.7 + random()*1.9;
      const bands = .55 + .45 * Math.sin(golden*.23 + y*9) * Math.cos(y*7 + golden*.11);
      metadata[i*3+1] = random() > .987 ? 1 : .45 + .50*bands;
      metadata[i*3+2] = random()*Math.PI*2;
    }
  }
  function initialize() {
    try {
      const vs = shader(gl.VERTEX_SHADER,vertex), fs = shader(gl.FRAGMENT_SHADER,fragment);
      program = gl.createProgram(); gl.attachShader(program,vs); gl.attachShader(program,fs); gl.linkProgram(program);
      gl.deleteShader(vs); gl.deleteShader(fs);
      if (!gl.getProgramParameter(program,gl.LINK_STATUS)) throw new Error('Program link failed');
      gl.useProgram(program);
      buffers = ['aFrom','aTo','aMeta'].map(name => {
        const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
        const location = gl.getAttribLocation(program,name);
        gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location,3,gl.FLOAT,false,0,0);
        return buffer;
      });
      locations = {};
      ['uMix','uTime','uAngle','uScale','uAspect','uPixelRatio','uOffset','uPointer'].forEach(name => locations[name]=gl.getUniformLocation(program,name));
      prepareShapes();
      gl.bindBuffer(gl.ARRAY_BUFFER,buffers[2]); gl.bufferData(gl.ARRAY_BUFFER,metadata,gl.STATIC_DRAW);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA,gl.ONE); gl.disable(gl.DEPTH_TEST);
      fromIndex = toIndex = -1;
      canvas.dataset.renderer = 'webgl';
      document.body.classList.add('canvas-ready');
      resize();
      return true;
    } catch {
      document.body.classList.remove('canvas-ready');
      document.body.classList.add('canvas-unavailable');
      return false;
    }
  }
  function resize() {
    const pixelRatio = Math.min(devicePixelRatio || 1, small.matches ? 1.4 : 1.75);
    canvas.width = Math.round(innerWidth*pixelRatio); canvas.height = Math.round(innerHeight*pixelRatio);
    gl.viewport(0,0,canvas.width,canvas.height);
    gl.uniform1f(locations.uAspect,innerWidth/innerHeight);
    gl.uniform1f(locations.uPixelRatio,pixelRatio);
    dirty = true; requestDraw();
  }
  function smooth(t) { return t*t*(3-2*t); }
  function draw(now) {
    frame = 0;
    if (contextLost || document.hidden) return;
    const moving = !reduced.matches;
    const interval = small.matches ? 1000/30 : 1000/50;
    if (moving && now-lastFrame < interval) { requestDraw(); return; }
    if (lastTime) elapsed += Math.min(.08,(now-lastTime)/1000);
    lastTime = now; lastFrame = now;
    const progress = Math.min(6,Math.max(0,sceneProgress));
    const from = Math.floor(progress), to = Math.min(6,from+1);
    let mix = smooth(progress-from);
    if (reduced.matches) mix = mix < .5 ? 0 : 1;
    if (from !== fromIndex || to !== toIndex) {
      gl.bindBuffer(gl.ARRAY_BUFFER,buffers[0]); gl.bufferData(gl.ARRAY_BUFFER,shapes[from],gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER,buffers[1]); gl.bufferData(gl.ARRAY_BUFFER,shapes[to],gl.STATIC_DRAW);
      fromIndex = from; toIndex = to;
    }
    const shift = smooth(Math.min(1,progress));
    const contact = smooth(Math.max(0,progress-5));
    const mobile = small.matches;
    const x = mobile ? 0 : .58*shift*(1-contact);
    const y = mobile ? -.60*(1-shift) - .08*shift : (-.80+.56*heroShift)*(1-shift) + .05*shift;
    const scale = mobile ? Math.min(.95,innerWidth/innerHeight*1.14)*(1-.12*shift) : 1.02 + .15*heroShift - .10*shift;
    gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(locations.uMix,mix);
    gl.uniform1f(locations.uTime,moving?elapsed:0);
    gl.uniform1f(locations.uAngle,progress*.37);
    gl.uniform1f(locations.uScale,scale);
    gl.uniform2f(locations.uOffset,x,y);
    gl.uniform2f(locations.uPointer,moving?pointerX:0,moving?pointerY:0);
    gl.drawArrays(gl.POINTS,0,count);
    canvas.dataset.form=String(from);
    dirty = false;
    if (moving) requestDraw();
  }
  function requestDraw() { if (!frame && !contextLost && !document.hidden) frame=requestAnimationFrame(draw); }
  canvas.addEventListener('webglcontextlost',event => { event.preventDefault(); contextLost=true; cancelAnimationFrame(frame); frame=0; document.body.classList.remove('canvas-ready'); });
  canvas.addEventListener('webglcontextrestored',() => { contextLost=false; if(initialize()) requestDraw(); });
  window.addEventListener('portfolio:scene',event => { sceneProgress=event.detail.progress;heroShift=event.detail.heroShift;dirty=true;requestDraw(); });
  window.addEventListener('pointermove',event => { if(small.matches || reduced.matches)return;pointerX=event.clientX/innerWidth-.5;pointerY=event.clientY/innerHeight-.5; },{passive:true});
  window.addEventListener('resize',() => { if(!contextLost)resize(); },{passive:true});
  document.addEventListener('visibilitychange',() => { lastTime=0;if(!document.hidden)requestDraw(); });
  reduced.addEventListener('change',() => { lastTime=0;dirty=true;requestDraw(); });
  if(initialize()) requestDraw();
})();
