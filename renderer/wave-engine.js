/* Original XMB surface renderer. Sony/RetroArch shader code is not copied.
 * Three tapering translucent surfaces cross and fold across the screen. */
const FRAME_MS = 1000 / 60;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const ease = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const now = () => globalThis.performance?.now?.() ?? Date.now();
const defaults = { waveStyle: 'ps3', waveSpeed: 1, waveOpacity: 0.85, waveEnabled: true };

// Each fold is a bounded surface. Varying its width and phase makes the faces
// cross, unlike drawing several blurred lines along a single centre curve.
export function sampleWaveSurface(u, v, time, layer = 0, style = 'ps3', energy = 0) {
  const psp = style === 'psp' ? 1 : 0, t = time, phase = layer * .97;
  const centre = -.18 + Math.sin(u*2.05-t*.30+.3+phase)*.18
    + Math.sin(u*3.8+t*.16+phase*1.6)*.047;
  const taper = .5+.5*Math.sin(u*2.25-t*.26+phase*2.3);
  const width = (.022+(.09-layer*.016+psp*.035)*taper)*(1+energy*.35);
  const fold = v*width+(1-v*v)*.025*Math.sin(u*2.6-t*.21+phase);
  return { x:u*1.14, y:centre+fold, z:v*.12+layer*.05 };
}
const VERTEX = `
precision highp float;
attribute vec2 a_uv;
uniform float u_time, u_layer, u_psp, u_energy, u_pull;
varying vec2 v_uv;
varying float v_light;
void main() {
  float x=a_uv.x, v=a_uv.y, t=u_time, phase=u_layer*.97;
  float centre=-.18+sin(x*2.05-t*.30+.3+phase)*.18
    +sin(x*3.8+t*.16+phase*1.6)*.047;
  float taper=.5+.5*sin(x*2.25-t*.26+phase*2.3);
  float width=(.022+(.09-u_layer*.016+u_psp*.035)*taper)*(1.+u_energy*.35);
  float fold=v*width+(1.-v*v)*.025*sin(x*2.6-t*.21+phase);
  float y=centre+fold;
  gl_Position=vec4(x*1.14*(1.+u_pull*.18),y*(1.-u_pull*.9)-u_pull*.11,0.,1.);
  v_uv=a_uv; v_light=sin(x*2.25-t*.26+phase*2.3);
}`;
const FRAGMENT = `
precision highp float;
uniform float u_time, u_opacity, u_layer, u_psp, u_energy;
varying vec2 v_uv;
varying float v_light;
void main(){
  float across=(v_uv.y+1.)*.5;
  float facing=mix(across,1.-across,step(.5,u_layer)*step(u_layer,1.5));
  float edgeFade=1.-smoothstep(.985,1.,abs(v_uv.y));
  float face=.008+.19*pow(facing,3.8);
  float lip=.045*pow(facing,36.);
  float light=.32+.68*pow(.5+.5*cos(v_uv.x*2.6-u_time*.25+u_layer*1.8),2.);
  float a=(face+lip)*edgeFade*light*u_opacity*(1.+u_energy*.25);
  vec3 colour=mix(vec3(.63,.67,.78),vec3(.89,.92,1.),.42+.2*v_light+.08*u_psp);
  gl_FragColor=vec4(colour,a);
}`;
function createMesh(columns=192,rows=48){
  const vertices=new Float32Array((columns+1)*(rows+1)*2), indices=new Uint16Array(columns*rows*6);
  let at=0;
  for(let row=0;row<=rows;row++)for(let col=0;col<=columns;col++){vertices[at++]=-1.2+col/columns*2.4;vertices[at++]=-1+row/rows*2;}
  at=0;
  for(let row=0;row<rows;row++)for(let col=0;col<columns;col++){
    const a=row*(columns+1)+col;
    indices[at++]=a;indices[at++]=a+columns+1;indices[at++]=a+1;
    indices[at++]=a+1;indices[at++]=a+columns+1;indices[at++]=a+columns+2;
  }
  return{vertices,indices};
}
function compile(gl,type,source){
  const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);
  if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){const error=gl.getShaderInfoLog(shader);gl.deleteShader(shader);throw new Error(error);}
  return shader;
}
function makeSurface(canvas){
  const surface={canvas,context:null,renderer:'unavailable',width:1,height:1,dpr:1,dirty:true};
  if(!canvas)return surface;
  let gl;
  try{
    gl=canvas.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:true,powerPreference:'low-power'});
    if(!gl?.createShader)gl=null;
    if(gl){
      const program=gl.createProgram(),vs=compile(gl,gl.VERTEX_SHADER,VERTEX),fs=compile(gl,gl.FRAGMENT_SHADER,FRAGMENT);
      gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));
      gl.useProgram(program);
      const mesh=createMesh(),vertexBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,vertexBuffer);gl.bufferData(gl.ARRAY_BUFFER,mesh.vertices,gl.STATIC_DRAW);
      const location=gl.getAttribLocation(program,'a_uv');gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,2,gl.FLOAT,false,0,0);
      const indexBuffer=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,indexBuffer);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,mesh.indices,gl.STATIC_DRAW);
      gl.enable(gl.BLEND);gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
      const uniforms={};for(const name of ['time','layer','psp','energy','pull','opacity'])uniforms[name]=gl.getUniformLocation(program,`u_${name}`);
      Object.assign(surface,{context:gl,renderer:'webgl',program,uniforms,indexCount:mesh.indices.length});
      canvas.addEventListener?.('webglcontextlost',event=>{event.preventDefault();surface.lost=true;});
      canvas.addEventListener?.('webglcontextrestored',()=>{Object.assign(surface,makeSurface(canvas),{lost:false,dirty:true});});
      return surface;
    }
  }catch(error){
    surface.webglError=String(error?.message||error);
    // Once a canvas has a WebGL context it cannot obtain a 2D context. Keep
    // the DOM ID/style but replace that element to make fallback effective.
    if(gl&&canvas.cloneNode&&canvas.replaceWith){const replacement=canvas.cloneNode(false);canvas.replaceWith(replacement);canvas=replacement;surface.canvas=canvas;}
  }
  try{surface.context=canvas.getContext('2d',{alpha:true});}catch{}
  if(surface.context)surface.renderer='canvas2d';return surface;
}
function resize(surface){
  const rect=surface.canvas?.getBoundingClientRect?.();
  const width=Math.max(1,rect?.width||surface.canvas?.clientWidth||globalThis.innerWidth||1),height=Math.max(1,rect?.height||surface.canvas?.clientHeight||globalThis.innerHeight||1);
  const dpr=clamp(Number(globalThis.devicePixelRatio)||1,1,2);
  if(surface.width!==width||surface.height!==height||surface.dpr!==dpr||surface.dirty){
    Object.assign(surface,{width,height,dpr,dirty:false});surface.canvas.width=Math.round(width*dpr);surface.canvas.height=Math.round(height*dpr);
    if(surface.renderer==='webgl')surface.context.viewport(0,0,surface.canvas.width,surface.canvas.height);
  }
}
function clear(surface){
  const ctx=surface.context;if(!ctx||surface.lost)return;
  if(surface.renderer==='webgl'){ctx.clearColor(0,0,0,0);ctx.clear(ctx.COLOR_BUFFER_BIT);}
  else{ctx.setTransform?.(surface.dpr,0,0,surface.dpr,0,0);ctx.clearRect(0,0,surface.width,surface.height);}
}
function canvasDraw(surface,t,settings,energy,pull,alpha){
  const ctx=surface.context;ctx.save?.();
  const point=(u,v,layer)=>{const p=sampleWaveSurface(u,v,t,layer,settings.waveStyle,energy);return[(p.x*(1+pull*.18)+1)*surface.width/2,(1-(p.y*(1-pull*.9)-pull*.11))*surface.height/2];};
  const trace=(v,layer,reverse=false)=>{for(let n=0;n<=160;n++){const i=reverse?160-n:n,[x,y]=point(-1.2+i/160*2.4,v,layer);if(!reverse&&n===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}};
  for(let layer=2;layer>=0;layer--){
    for(let strip=0;strip<96;strip++){
      const v=-1+strip/48, mid=v+1/96;
      const across=(mid+1)*.5, facing=layer===1?1-across:across;
      const edge=1-ease((Math.abs(mid)-.985)/.015);
      const a=(.008+.19*facing**3.8+.045*facing**36)*edge*alpha*(1+energy*.25);
      // A screen-space gradient gives the software renderer the same travelling
      // highlights as WebGL without drawing/stroking bright thread paths.
      const highlight=ctx.createLinearGradient(0,0,surface.width,0);
      for(let stop=0;stop<=12;stop++){
        const u=-1.2+stop/12*2.4;
        const light=.32+.68*(.5+.5*Math.cos(u*2.6-t*.25+layer*1.8))**2;
        highlight.addColorStop(stop/12,`rgba(201,211,239,${a*light})`);
      }
      ctx.fillStyle=highlight;
      ctx.beginPath();trace(v,layer);trace(v+1/48,layer,true);ctx.closePath();ctx.fill();
    }
  }
  ctx.restore?.();
}
function draw(surface,t,settings,energy,pull,alpha){
  if(surface.lost)return;clear(surface);if(!settings.waveEnabled||alpha<=0)return;
  if(surface.renderer!=='webgl')return canvasDraw(surface,t,settings,energy,pull,alpha);
  const gl=surface.context,u=surface.uniforms;gl.useProgram(surface.program);
  gl.uniform1f(u.time,t);gl.uniform1f(u.psp,settings.waveStyle==='psp'?1:0);gl.uniform1f(u.energy,energy);gl.uniform1f(u.pull,pull);gl.uniform1f(u.opacity,alpha);
  for(let layer=2;layer>=0;layer--){gl.uniform1f(u.layer,layer);gl.drawElements(gl.TRIANGLES,surface.indexCount,gl.UNSIGNED_SHORT,0);}
}
export function createWaveScene({idleCanvas=null,bootCanvas=null}={}){
  const idle=makeSurface(idleCanvas),boot=makeSurface(bootCanvas),settings={...defaults};
  const status={running:false,bootActive:Boolean(boot.context),idleFrames:0,bootFrames:0,totalFrames:0,startedAt:0,lastFrameAt:0,lastFrameTime:0,lastError:null,settings:{...settings},transition:{mode:'idle',progress:1,alpha:defaults.waveOpacity,pull:0},motionTime:0,
    idle:{available:Boolean(idle.context),renderer:idle.renderer,webglError:idle.webglError||null,frames:0,width:0,height:0,dpr:1},
    boot:{available:Boolean(boot.context),renderer:boot.renderer,webglError:boot.webglError||null,active:Boolean(boot.context),frames:0,width:0,height:0,dpr:1}};
  let elapsed=0,motion=0,lastDraw=-Infinity,mode='idle',transitionAt=0,lastEnergy=0;
  const request=callback=>typeof globalThis.requestAnimationFrame==='function'?globalThis.requestAnimationFrame(callback):(()=>{const timer=setTimeout(()=>callback(now()),FRAME_MS);timer?.unref?.();return timer;})();
  function render(timestamp){
    if(!status.running)return;const stamp=Number.isFinite(timestamp)?timestamp:now();
    if(stamp-lastDraw>=FRAME_MS*.8){
      const delta=Number.isFinite(lastDraw)?clamp(stamp-lastDraw,1,1000)/1000:1/60;elapsed+=delta;motion+=delta*settings.waveSpeed;lastDraw=stamp;
      const progress=ease((elapsed-transitionAt)/(mode==='exit'?.75:.65));let pull=0,alpha=settings.waveOpacity,energy=0;
      if(mode==='launch'||mode==='exit'){pull=progress;alpha*=1-progress;energy=progress;}
      if(mode==='return'){pull=1-progress;alpha*=progress;energy=1-progress;}
      Object.assign(status.transition,{mode,progress,alpha,pull});status.motionTime=motion;
      lastEnergy+=(energy-lastEnergy)*Math.min(1,delta*7);
      try{
        for(const[surface,target,isBoot]of[[idle,status.idle,false],[boot,status.boot,true]]){
          if(!surface.context||(isBoot&&!status.bootActive))continue;if(surface.dirty||status.totalFrames%60===0)resize(surface);
          const bootOpen=ease(elapsed/1.25);
          draw(surface,motion+(isBoot?.48*ease(elapsed/2.2):0),settings,isBoot?(1-ease(elapsed/3))*.7:lastEnergy,isBoot?(1-bootOpen)*.8:pull,isBoot?settings.waveOpacity*Math.min(1,elapsed/.45)*1.2:alpha);
          target.frames++;target.width=surface.width;target.height=surface.height;target.dpr=surface.dpr;if(isBoot)status.bootFrames++;else status.idleFrames++;
        }
        status.totalFrames++;status.lastFrameAt=Date.now();status.lastFrameTime=stamp;status.lastError=null;
      }catch(error){status.lastError=String(error?.message||error);}
    }
    request(render);
  }
  function start(){
    if(status.running)return status;status.running=true;status.startedAt=Date.now();lastDraw=-Infinity;
    for(const surface of[idle,boot])if(surface.canvas&&typeof globalThis.ResizeObserver==='function'){surface.observer=new globalThis.ResizeObserver(()=>{surface.dirty=true;});surface.observer.observe(surface.canvas);}
    request(render);return status;
  }
  function configure(value={}){
    if(value.waveStyle==='ps3'||value.waveStyle==='psp')settings.waveStyle=value.waveStyle;
    if(Number.isFinite(Number(value.waveSpeed)))settings.waveSpeed=clamp(Number(value.waveSpeed),.25,2.5);
    if(Number.isFinite(Number(value.waveOpacity)))settings.waveOpacity=clamp(Number(value.waveOpacity),0,1);
    if(typeof value.waveEnabled==='boolean')settings.waveEnabled=value.waveEnabled;Object.assign(status.settings,settings);return status;
  }
  function stopBoot(){status.bootActive=false;status.boot.active=false;clear(boot);if(boot.canvas?.dataset)boot.canvas.dataset.waveStopped='true';return status;}
  function transition(next='idle'){mode=['launch','return','exit'].includes(next)?next:'idle';transitionAt=elapsed;return status;}
  function stop(){status.running=false;idle.observer?.disconnect?.();boot.observer?.disconnect?.();}
  return{start,stopBoot,configure,transition,stop,status};
}
