/* Original WebGL artwork: a rotating rectangular glass panel, built from geometry. */
(() => {
  'use strict';
  const canvas = document.querySelector('#rectangle-world');
  if (!canvas) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const small = matchMedia('(max-width: 720px)');
  let gl;
  try {
    gl = canvas.getContext('webgl', {alpha:true, antialias:true, depth:true, powerPreference:'low-power'});
  } catch {}
  if (!gl) { document.body.classList.add('canvas-unavailable'); return; }

  const vertexSource = `
    attribute vec3 aPosition;
    attribute vec3 aNormal;
    attribute vec2 aUV;
    uniform float uTime, uProgress, uScale, uAspect, uPixelRatio, uPass;
    uniform vec2 uOffset, uPointer;
    varying vec3 vNormal;
    varying vec2 vUV;
    varying float vDepth;
    vec3 turn(vec3 p) {
      float yaw = 0.52 + uTime * 0.23 + uProgress * 0.82 + uPointer.x * 0.15;
      float pitch = -0.24 + uTime * 0.17 + uProgress * 0.36 + uPointer.y * 0.10;
      float roll = -0.13 + sin(uTime * 0.13) * 0.20 + uProgress * 0.16;
      p.xz = mat2(cos(yaw), -sin(yaw), sin(yaw), cos(yaw)) * p.xz;
      p.yz = mat2(cos(pitch), -sin(pitch), sin(pitch), cos(pitch)) * p.yz;
      p.xy = mat2(cos(roll), -sin(roll), sin(roll), cos(roll)) * p.xy;
      return p;
    }
    void main() {
      vec3 p = turn(aPosition);
      float perspective = 3.2 / (4.0 - p.z * 0.65);
      gl_Position = vec4(p.x * uScale * perspective / uAspect + uOffset.x,
                         p.y * uScale * perspective + uOffset.y, -p.z * 0.20, 1.0);
      gl_PointSize = 5.5 * uPixelRatio;
      vNormal = uPass < 0.5 ? turn(aNormal) : vec3(0.0, 0.0, 1.0);
      vUV = aUV;
      vDepth = clamp((p.z + 1.6) / 3.2, 0.0, 1.0);
    }
  `;
  const fragmentSource = `
    precision mediump float;
    uniform float uTime, uPass;
    varying vec3 vNormal;
    varying vec2 vUV;
    varying float vDepth;
    void main() {
      vec3 blue = vec3(0.42, 0.68, 0.98);
      if (uPass > 1.5) {
        float d = length(gl_PointCoord - vec2(0.5));
        if (d > 0.5) discard;
        gl_FragColor = vec4(vec3(0.74, 0.86, 1.0), exp(-d*d*16.0) * 0.90);
        return;
      }
      if (uPass > 0.5) {
        gl_FragColor = vec4(blue, 0.28 + vDepth * 0.54);
        return;
      }
      vec3 n = normalize(vNormal);
      float light = max(0.0, dot(n, normalize(vec3(-0.4, 0.8, 1.0))));
      float fresnel = pow(1.0 - abs(n.z), 2.0);
      vec2 edgeDistance = min(vUV, 1.0 - vUV);
      float edge = 1.0 - smoothstep(0.004, 0.018, min(edgeDistance.x, edgeDistance.y));
      vec2 gridCell = fract(vUV * vec2(16.0, 10.0));
      vec2 gridDistance = min(gridCell, 1.0 - gridCell);
      float grid = 1.0 - smoothstep(0.012, 0.045, min(gridDistance.x, gridDistance.y));
      float sheen = pow(max(0.0, 1.0 - abs(vUV.y - (0.5 + 0.45*sin(uTime*0.28))) * 4.0), 3.0);
      vec3 tint = mix(vec3(0.055, 0.13, 0.25), blue, 0.18 + light*0.28 + fresnel*0.20);
      tint = mix(tint, vec3(0.66, 0.82, 1.0), edge * 0.72);
      float alpha = 0.10 + light*0.07 + fresnel*0.10 + grid*0.14 + sheen*0.035 + edge*0.45;
      gl_FragColor = vec4(tint, min(0.85, alpha));
    }
  `;

  let program, locations, surface, outline, corners;
  let frame = 0, lastFrame = 0, lastTime = 0, elapsed = 0, contextLost = false;
  let sceneProgress = 0, heroShift = 0, pointerX = 0, pointerY = 0;
  const half = [1.28, 0.79, 0.12];
  function shader(type, source) {
    const item = gl.createShader(type);
    gl.shaderSource(item, source); gl.compileShader(item);
    if (!gl.getShaderParameter(item, gl.COMPILE_STATUS)) {
      gl.deleteShader(item); throw new Error('Rectangle shader failed to compile');
    }
    return item;
  }
  function geometry() {
    const [w,h,d] = half;
    const points = [[-w,-h,-d],[w,-h,-d],[w,h,-d],[-w,h,-d],[-w,-h,d],[w,-h,d],[w,h,d],[-w,h,d]];
    const faces = [
      {indices:[4,5,6,7],normal:[0,0,1]},
      {indices:[1,0,3,2],normal:[0,0,-1]},
      {indices:[5,1,2,6],normal:[1,0,0]},
      {indices:[0,4,7,3],normal:[-1,0,0]},
      {indices:[7,6,2,3],normal:[0,1,0]},
      {indices:[0,1,5,4],normal:[0,-1,0]}
    ];
    const uv = [[0,0],[1,0],[1,1],[0,1]], triangles = [];
    faces.forEach(face => {
      [0,1,2,0,2,3].forEach(i => triangles.push(...points[face.indices[i]], ...face.normal, ...uv[i]));
    });
    const lines = [];
    [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]].forEach(pair => {
      pair.forEach(i => lines.push(...points[i],0,0,0,0,0));
    });
    return {triangles,lines,points:points.flatMap(p => [...p,0,0,0,0,0])};
  }
  function buffer(data) {
    const handle = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,handle);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.STATIC_DRAW);
    return {handle,count:data.length/8};
  }
  function bind(mesh) {
    gl.bindBuffer(gl.ARRAY_BUFFER,mesh.handle);
    gl.vertexAttribPointer(locations.aPosition,3,gl.FLOAT,false,32,0);
    gl.vertexAttribPointer(locations.aNormal,3,gl.FLOAT,false,32,12);
    gl.vertexAttribPointer(locations.aUV,2,gl.FLOAT,false,32,24);
  }
  function initialize() {
    try {
      const vs = shader(gl.VERTEX_SHADER,vertexSource), fs = shader(gl.FRAGMENT_SHADER,fragmentSource);
      program = gl.createProgram(); gl.attachShader(program,vs); gl.attachShader(program,fs); gl.linkProgram(program);
      gl.deleteShader(vs); gl.deleteShader(fs);
      if (!gl.getProgramParameter(program,gl.LINK_STATUS)) throw new Error('Rectangle program failed to link');
      gl.useProgram(program);
      locations = {};
      ['aPosition','aNormal','aUV'].forEach(name => {
        locations[name] = gl.getAttribLocation(program,name); gl.enableVertexAttribArray(locations[name]);
      });
      ['uTime','uProgress','uScale','uAspect','uPixelRatio','uOffset','uPointer','uPass'].forEach(name => {
        locations[name] = gl.getUniformLocation(program,name);
      });
      const shape = geometry();
      surface = buffer(shape.triangles); outline = buffer(shape.lines); corners = buffer(shape.points);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
      canvas.dataset.renderer = 'webgl'; canvas.dataset.geometry = 'rectangle';
      document.body.classList.remove('canvas-unavailable'); document.body.classList.add('canvas-ready');
      resize(); return true;
    } catch {
      document.body.classList.remove('canvas-ready'); document.body.classList.add('canvas-unavailable'); return false;
    }
  }
  function resize() {
    const ratio = Math.min(devicePixelRatio || 1, small.matches ? 1.4 : 1.75);
    canvas.width = Math.round(innerWidth*ratio); canvas.height = Math.round(innerHeight*ratio);
    gl.viewport(0,0,canvas.width,canvas.height);
    gl.uniform1f(locations.uAspect,innerWidth/innerHeight); gl.uniform1f(locations.uPixelRatio,ratio);
    requestDraw();
  }
  function smooth(t) { return t*t*(3-2*t); }
  function draw(now) {
    frame = 0;
    if (contextLost || document.hidden) return;
    const moving = !reduced.matches;
    if (moving && now-lastFrame < (small.matches ? 1000/30 : 1000/40)) { requestDraw(); return; }
    if (lastTime) elapsed += Math.min(0.08,(now-lastTime)/1000);
    lastTime = now; lastFrame = now;
    const progress = Math.min(6,Math.max(0,sceneProgress));
    const shift = smooth(Math.min(1,progress)), contact = smooth(Math.max(0,progress-5));
    const mobile = small.matches;
    const x = mobile ? 0 : 0.48*shift*(1-contact);
    const y = mobile ? -0.60*(1-shift)-0.08*shift : (-0.80+0.56*heroShift)*(1-shift)+0.05*shift;
    // Fit the complete panel, including its depth, on a narrow screen.
    const scale = mobile ? Math.min(0.85,innerWidth/innerHeight*0.85) : 0.89+0.10*heroShift-0.08*shift;
    gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    gl.uniform1f(locations.uTime,moving?elapsed:0);
    gl.uniform1f(locations.uProgress,reduced.matches?Math.round(progress):progress);
    gl.uniform1f(locations.uScale,scale); gl.uniform2f(locations.uOffset,x,y);
    gl.uniform2f(locations.uPointer,moving?pointerX:0,moving?pointerY:0);
    gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
    gl.depthMask(true); gl.uniform1f(locations.uPass,0); bind(surface); gl.drawArrays(gl.TRIANGLES,0,surface.count);
    gl.disable(gl.CULL_FACE); gl.depthMask(false);
    gl.uniform1f(locations.uPass,1); bind(outline); gl.drawArrays(gl.LINES,0,outline.count);
    gl.uniform1f(locations.uPass,2); bind(corners); gl.drawArrays(gl.POINTS,0,corners.count);
    gl.depthMask(true);
    if (moving) requestDraw();
  }
  function requestDraw() {
    if (!frame && !contextLost && !document.hidden) frame = requestAnimationFrame(draw);
  }
  canvas.addEventListener('webglcontextlost',event => {
    event.preventDefault(); contextLost=true; cancelAnimationFrame(frame); frame=0;
    document.body.classList.remove('canvas-ready');
  });
  canvas.addEventListener('webglcontextrestored',() => { contextLost=false; if(initialize())requestDraw(); });
  addEventListener('portfolio:scene',event => { sceneProgress=event.detail.progress; heroShift=event.detail.heroShift; requestDraw(); });
  addEventListener('pointermove',event => {
    if (small.matches || reduced.matches) return;
    pointerX=event.clientX/innerWidth-0.5; pointerY=event.clientY/innerHeight-0.5;
  },{passive:true});
  addEventListener('resize',() => { if(!contextLost)resize(); },{passive:true});
  document.addEventListener('visibilitychange',() => { lastTime=0; if(!document.hidden)requestDraw(); });
  reduced.addEventListener('change',() => { lastTime=0; requestDraw(); });
  if(initialize())requestDraw();
})();
