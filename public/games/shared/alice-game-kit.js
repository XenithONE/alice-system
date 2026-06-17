(function(){
  'use strict';
  if(window.AliceGameKit) return;

  const PROGRESS_KEYS=[
    'alice_bonus_the_eidolon',
    'alice_bonus_rift_courier',
    'alice_bonus_iwbtg',
    'alice_bonus_locker_hunt',
    'alice_bonus_signal_runner',
    'alice_bonus_constellation',
    'alice_bonus_dragons_keep'
  ];
  const reduceMotion=(()=>{try{return matchMedia('(prefers-reduced-motion: reduce)').matches;}catch(e){return false;}})();
  const lowPower=reduceMotion || innerWidth<700 || ((navigator.hardwareConcurrency||4)<=4);
  const instances=[];
  let styleReady=false, storageHooked=false, fxReady=false, fxCanvas=null, fxCtx=null, fxLast=0, fxRaf=0;
  const motes=[], particles=[];

  function readKey(key){
    try{return localStorage.getItem(key);}catch(e){return null;}
  }
  function progressCount(){
    let n=0;
    for(const key of PROGRESS_KEYS) if(readKey(key)==='1') n++;
    return n;
  }
  function injectStyle(){
    if(styleReady) return;
    styleReady=true;
    const style=document.createElement('style');
    style.textContent=`
      .alice-kit-fx{position:fixed;inset:0;z-index:3;pointer-events:none;mix-blend-mode:screen}
      .alice-game-kit{position:fixed;right:12px;top:58px;z-index:7;min-width:188px;max-width:238px;
        pointer-events:none;border:1px solid rgba(51,231,200,.22);border-radius:8px;
        background:linear-gradient(135deg,rgba(3,7,13,.68),rgba(15,10,28,.54));backdrop-filter:blur(12px);
        box-shadow:0 18px 48px rgba(0,0,0,.34),0 0 28px rgba(51,231,200,.08);
        color:#e7f5f3;font-family:ui-monospace,"Cascadia Code",Consolas,monospace;
        letter-spacing:.08em;text-transform:uppercase;overflow:hidden}
      .alice-game-kit:before{content:"";position:absolute;inset:0;border-radius:8px;pointer-events:none;
        background:linear-gradient(90deg,rgba(51,231,200,.18),rgba(123,77,255,.08),rgba(255,79,135,.12));
        opacity:.7}
      .alice-game-kit.complete{border-color:rgba(255,209,102,.55);box-shadow:0 18px 48px rgba(0,0,0,.34),0 0 34px rgba(255,209,102,.2)}
      .alice-kit-inner{position:relative;padding:10px 11px 9px}
      .alice-kit-head{display:flex;align-items:center;justify-content:space-between;gap:9px;font-size:10px;color:rgba(231,245,243,.62)}
      .alice-kit-title{margin-top:6px;font-size:12px;line-height:1.25;color:#33e7c8;text-shadow:0 0 12px rgba(51,231,200,.35)}
      .alice-kit-mission{margin-top:5px;font-size:10px;line-height:1.35;color:rgba(231,245,243,.68);text-transform:none;letter-spacing:.04em}
      .alice-kit-sync{white-space:nowrap;color:#ffd166}
      .alice-kit-metrics{display:grid;grid-template-columns:1fr;gap:3px;margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.08)}
      .alice-kit-metric{display:flex;justify-content:space-between;gap:10px;font-size:10px;color:rgba(231,245,243,.58)}
      .alice-kit-metric b{font-weight:800;color:#e7f5f3}
      .alice-kit-toast{position:fixed;left:50%;bottom:24px;z-index:18;transform:translate(-50%,18px);
        pointer-events:none;opacity:0;max-width:min(520px,calc(100vw - 30px));border:1px solid rgba(51,231,200,.32);
        border-radius:8px;background:rgba(3,7,13,.86);backdrop-filter:blur(14px);padding:11px 15px;
        color:#e7f5f3;font-family:ui-monospace,"Cascadia Code",Consolas,monospace;font-size:12px;letter-spacing:.1em;
        box-shadow:0 16px 46px rgba(0,0,0,.42),0 0 28px rgba(51,231,200,.14);transition:opacity .2s,transform .2s}
      .alice-kit-toast.show{opacity:1;transform:translate(-50%,0)}
      .alice-kit-toast.complete{border-color:rgba(255,209,102,.5);color:#ffd166}
      @media(max-width:760px){
        .alice-game-kit{top:auto;right:8px;bottom:8px;min-width:158px;max-width:calc(100vw - 16px);opacity:.78}
        .alice-kit-inner{padding:8px 9px}.alice-kit-title{font-size:11px}.alice-kit-mission{display:none}.alice-kit-metrics{display:none}
        .alice-kit-toast{bottom:74px;font-size:11px}
      }
      @media(prefers-reduced-motion:reduce){.alice-kit-toast{transition:none}}
    `;
    document.head.appendChild(style);
  }
  function hookStorage(){
    if(storageHooked) return;
    storageHooked=true;
    try{
      const raw=Storage.prototype.setItem;
      Storage.prototype.setItem=function(key,value){
        const out=raw.apply(this,arguments);
        try{window.dispatchEvent(new CustomEvent('alice:storage-set',{detail:{key:String(key),value:String(value)}}));}catch(e){}
        return out;
      };
    }catch(e){}
  }
  function setupFx(){
    if(fxReady || reduceMotion) return;
    fxReady=true;
    fxCanvas=document.createElement('canvas');
    fxCanvas.className='alice-kit-fx';
    fxCanvas.setAttribute('aria-hidden','true');
    fxCtx=fxCanvas.getContext('2d',{alpha:true});
    document.body.appendChild(fxCanvas);
    resizeFx();
    const count=lowPower?28:74;
    for(let i=0;i<count;i++){
      motes.push({
        x:Math.random()*innerWidth,
        y:Math.random()*innerHeight,
        vx:(Math.random()-.5)*(lowPower?5:10),
        vy:(Math.random()*.4+.12)*(lowPower?10:18),
        r:Math.random()*1.7+.35,
        a:Math.random()*.38+.08,
        p:Math.random()*6.283
      });
    }
    addEventListener('resize',resizeFx,{passive:true});
    fxRaf=requestAnimationFrame(drawFx);
  }
  function resizeFx(){
    if(!fxCanvas) return;
    const dpr=Math.min(2,devicePixelRatio||1);
    fxCanvas.width=Math.max(2,Math.floor(innerWidth*dpr));
    fxCanvas.height=Math.max(2,Math.floor(innerHeight*dpr));
    fxCanvas.style.width=innerWidth+'px';
    fxCanvas.style.height=innerHeight+'px';
    fxCtx.setTransform(dpr,0,0,dpr,0,0);
  }
  function emit(x,y,n,color,kind){
    setupFx();
    if(!fxCtx || reduceMotion) return;
    const cx=Number.isFinite(x)?x:innerWidth*(.45+Math.random()*.1);
    const cy=Number.isFinite(y)?y:innerHeight*(.42+Math.random()*.14);
    const amount=Math.min(lowPower?42:96,Math.max(1,n||18));
    for(let i=0;i<amount;i++){
      const a=Math.random()*6.283;
      const sp=(kind==='streak'?220:90)+Math.random()*(kind==='streak'?520:330);
      particles.push({
        x:cx,y:cy,
        vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,
        life:0,max:.46+Math.random()*.65,
        r:1.1+Math.random()*4.2,
        rot:Math.random()*6.283,spin:(Math.random()-.5)*7,
        color:color||'#33e7c8',
        kind:kind||'spark'
      });
    }
    while(particles.length>(lowPower?260:620)) particles.shift();
  }
  function drawFx(now){
    fxRaf=requestAnimationFrame(drawFx);
    if(!fxCtx) return;
    const dt=Math.min(.04,fxLast?(now-fxLast)/1000:.016); fxLast=now;
    fxCtx.clearRect(0,0,innerWidth,innerHeight);
    fxCtx.save();
    fxCtx.globalCompositeOperation='lighter';
    for(const m of motes){
      m.p+=dt;
      m.x+=m.vx*dt+Math.sin(m.p)*dt*4;
      m.y+=m.vy*dt;
      if(m.y>innerHeight+8){m.y=-8;m.x=Math.random()*innerWidth;}
      if(m.x<-8)m.x=innerWidth+8; else if(m.x>innerWidth+8)m.x=-8;
      fxCtx.globalAlpha=m.a*(.65+.35*Math.sin(m.p*1.7));
      fxCtx.fillStyle='#9fefff';
      fxCtx.beginPath();fxCtx.arc(m.x,m.y,m.r,0,6.283);fxCtx.fill();
    }
    for(let i=particles.length-1;i>=0;i--){
      const p=particles[i];
      p.life+=dt;
      const k=1-p.life/p.max;
      if(k<=0){particles.splice(i,1);continue;}
      p.x+=p.vx*dt; p.y+=p.vy*dt; p.vx*=Math.pow(.07,dt); p.vy*=Math.pow(.07,dt); p.rot+=p.spin*dt;
      fxCtx.globalAlpha=Math.max(0,k);
      fxCtx.strokeStyle=p.color; fxCtx.fillStyle=p.color; fxCtx.shadowBlur=16*k; fxCtx.shadowColor=p.color;
      if(p.kind==='ring'){
        fxCtx.lineWidth=1.4+2*k;
        fxCtx.beginPath();fxCtx.arc(p.x,p.y,p.r*(2.5-k)*8,0,6.283);fxCtx.stroke();
      }else if(p.kind==='streak'){
        fxCtx.lineWidth=1.2+2*k;
        fxCtx.beginPath();fxCtx.moveTo(p.x,p.y);fxCtx.lineTo(p.x-p.vx*.035,p.y-p.vy*.035);fxCtx.stroke();
      }else{
        fxCtx.save();fxCtx.translate(p.x,p.y);fxCtx.rotate(p.rot);
        const r=p.r*(.5+k);
        fxCtx.beginPath();fxCtx.moveTo(0,-r*1.5);fxCtx.lineTo(r,0);fxCtx.lineTo(0,r*1.5);fxCtx.lineTo(-r,0);fxCtx.closePath();fxCtx.fill();
        fxCtx.restore();
      }
      fxCtx.shadowBlur=0;
    }
    fxCtx.restore();
  }

  class Kit{
    constructor(opts){
      this.opts=Object.assign({id:'unknown',title:document.title||'AlicE Game',bonusKey:null,accent:'#33e7c8',mission:'Find the hidden signal.'},opts||{});
      this.metrics=new Map();
      this.done=this.opts.bonusKey ? readKey(this.opts.bonusKey)==='1' : false;
      this.toastEl=null;
      this.root=document.createElement('div');
      this.root.className='alice-game-kit'+(this.done?' complete':'');
      this.root.innerHTML=[
        '<div class="alice-kit-inner">',
          '<div class="alice-kit-head"><span>ALICE GAME OS</span><span class="alice-kit-sync"></span></div>',
          '<div class="alice-kit-title"></div>',
          '<div class="alice-kit-mission"></div>',
          '<div class="alice-kit-metrics"></div>',
        '</div>'
      ].join('');
      this.root.querySelector('.alice-kit-title').textContent=this.opts.title;
      this.root.querySelector('.alice-kit-mission').textContent=this.done?'Signal fragment archived.':this.opts.mission;
      document.body.appendChild(this.root);
      this.renderProgress();
      if(this.done) this.setMetric('STATUS','CLEAR');
    }
    renderProgress(){
      const el=this.root.querySelector('.alice-kit-sync');
      if(el) el.textContent='SYNC '+progressCount()+'/'+PROGRESS_KEYS.length;
    }
    mission(text){
      if(!text) return;
      const el=this.root.querySelector('.alice-kit-mission');
      if(el) el.textContent=text;
    }
    setMetric(label,value){
      if(!label) return;
      this.metrics.set(String(label).toUpperCase(),String(value));
      const wrap=this.root.querySelector('.alice-kit-metrics');
      if(!wrap) return;
      wrap.textContent='';
      Array.from(this.metrics.entries()).slice(-3).forEach(([k,v])=>{
        const row=document.createElement('div');
        row.className='alice-kit-metric';
        row.innerHTML='<span></span><b></b>';
        row.firstChild.textContent=k;
        row.lastChild.textContent=v;
        wrap.appendChild(row);
      });
    }
    toast(text,kind){
      if(!text) return;
      if(!this.toastEl){
        this.toastEl=document.createElement('div');
        this.toastEl.className='alice-kit-toast';
        document.body.appendChild(this.toastEl);
      }
      this.toastEl.textContent=text;
      this.toastEl.className='alice-kit-toast show'+(kind==='complete'?' complete':'');
      clearTimeout(this.toastTimer);
      this.toastTimer=setTimeout(()=>{if(this.toastEl)this.toastEl.classList.remove('show');},2400);
    }
    spark(x,y,n,color,kind){
      emit(x,y,n,color||this.opts.accent,kind);
    }
    complete(text){
      if(this.done) return;
      this.done=true;
      this.root.classList.add('complete');
      this.root.querySelector('.alice-kit-mission').textContent='Signal fragment archived.';
      this.setMetric('STATUS','CLEAR');
      this.toast(text||'SIGNAL FRAGMENT ARCHIVED','complete');
      emit(innerWidth/2,innerHeight/2,80,'#ffd166','ring');
      emit(innerWidth/2,innerHeight/2,60,this.opts.accent,'streak');
      this.renderProgress();
    }
  }

  function install(opts){
    injectStyle();
    hookStorage();
    setupFx();
    const kit=new Kit(opts||{});
    instances.push(kit);
    return kit;
  }

  window.addEventListener('alice:storage-set',e=>{
    const key=e.detail&&e.detail.key;
    for(const inst of instances){
      if(key===inst.opts.bonusKey && e.detail.value==='1') inst.complete(inst.opts.title+' clear signal archived.');
      else if(PROGRESS_KEYS.includes(key)) inst.renderProgress();
    }
  });

  window.AliceGameKit={
    install,
    spark:(x,y,n,color,kind)=>emit(x,y,n,color,kind),
    toast:(text,kind)=>instances[0]&&instances[0].toast(text,kind),
    complete:(text)=>instances[0]&&instances[0].complete(text)
  };
})();
