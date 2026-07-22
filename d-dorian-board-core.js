/* ===================== tuning model ===================== */
const FRAC={D:'1/1',E:'9/8',F:'6/5',G:'4/3',A:'3/2',B:'5/3',C:'9/5',Bb:'8/5','F#':'5/4','G#':'45/32','C#':'15/8'};
const JUST_R={D:1,E:9/8,F:6/5,G:4/3,A:3/2,B:5/3,C:9/5,Bb:8/5,'F#':5/4,'G#':45/32,'C#':15/8};
const ET_SEMI={D:0,E:2,F:3,G:5,A:7,B:9,C:10,Bb:8,'F#':4,'G#':6,'C#':11};
const cents=r=>1200*Math.log2(r);
const NOTE={
  D3:['D',0],E3:['E',0],F3:['F',0],G3:['G',0],A3:['A',0],Bb3:['Bb',0],B3:['B',0],C4:['C',0],'C#4':['C#',0],D4:['D',1],
  E4:['E',1],F4:['F',1],'F#4':['F#',1],G4:['G',1],'G#4':['G#',1],A4:['A',1],B4:['B',1],C5:['C',1],D5:['D',2],E5:['E',2]
};
const DEGREES=['D','E','F','G','A','B','C'];

const state={
  view:'board', tuning:'just', noter:false,
  refD:146.83,
  customCents:Object.fromEntries(DEGREES.map(d=>[d,+cents(JUST_R[d]).toFixed(1)])),
  lastPhrase:null, lastMelodyFreq:null
};

function ratioFromD(pc,tuning){
  tuning=tuning||state.tuning;
  if(tuning==='equal') return Math.pow(2,ET_SEMI[pc]/12);
  if(tuning==='custom') return DEGREES.includes(pc)?Math.pow(2,state.customCents[pc]/1200):JUST_R[pc];
  return JUST_R[pc];
}
function freqWith(note,tuning,refD){ const [pc,k]=NOTE[note]; return refD*ratioFromD(pc,tuning)*Math.pow(2,k); }
const freqOf=note=>freqWith(note,state.tuning,state.refD);
const deviationCents=pc=>cents(ratioFromD(pc)/JUST_R[pc]);

/* ===================== board data ===================== */
const FRETS=['0','1','2','3','4','5','6','6½','7','8','9','10','11'];
const STRINGS=[
  {name:'Bass',open:'D',notes:['D3','E3','F3','G3','A3','B3','C4','C#4','D4','E4','F4','G4','A4'],keys:['A','S','D','F','G','H','J',null,'K',null,null,null,null]},
  {name:'Middle',open:'A',notes:['A3','B3','C4','D4','E4','F4','G4','G#4','A4','B4','C5','D5','E5'],keys:['Q','W','E','R','T','Y','U',null,'I',null,null,null,null]},
  {name:'Melody',open:'G',notes:['G3','A3','Bb3','C4','D4','E4','F4','F#4','G4','A4','B4','C5','D5'],keys:[null,null,null,null,'1','2','3',null,'4','5','6','7','8']}
];
const MELODY=STRINGS[2];

const TRIADS=[
  {rom:'i',name:'Dm',notes:['D3','A3','F4'],hold:'A + Q + 3',cls:'tonic'},
  {rom:'ii',name:'Em',notes:['E3','B3','G4'],hold:'S + W + 4',cls:''},
  {rom:'III',name:'F',notes:['F3','A3','C5'],hold:'D + Q + 7',cls:'jade'},
  {rom:'IV',name:'G',notes:['G3','B3','D4'],hold:'F + W + 1',cls:''},
  {rom:'v',name:'Am',notes:['A3','C4','E4'],hold:'G + E + 2',cls:''},
  {rom:'vi°',name:'Bdim',notes:['B3','D4','F4'],hold:'H + R + 3',cls:'jade'},
  {rom:'VII',name:'C',notes:['C4','E4','G4'],hold:'J + T + 4',cls:''}
];
const CHORDS=Object.fromEntries(TRIADS.map(t=>[t.name,t.notes]));
const SEQUENCES=[
  {label:'Dm → G → Dm',chords:['Dm','G','Dm']},
  {label:'Dm → F → G → Dm',chords:['Dm','F','G','Dm']},
  {label:'Dm → C → G → Dm',chords:['Dm','C','G','Dm']},
  {label:'Dorian scale 1–8',scale:['D4','E4','F4','G4','A4','B4','C5','D5']}
];
const PHRASES=[
  {label:'Settling',character:'a plain fall to the tonic',notes:['A4','B4','A4','G4','F4','E4','D4']},
  {label:'The leaning sixth',character:'rests on B, the Dorian colour, then descends',notes:['D4','F4','A4','B4','A4','F4','D4']},
  {label:'Pivot on the fifth',character:'circles the drone\u2019s fifth',notes:['A4','G4','A4','B4','A4','F4','G4','A4']},
  {label:'Drone breath',character:'the tonic triad, slow',notes:['D4','F4','A4','D5','A4','F4','D4']}
];

function classOf(note){ const pc=note.replace(/\d+$/,''); if(pc==='D'||pc==='A')return 'ground'; if(pc==='F'||pc==='B')return 'signature'; if(pc==='E'||pc==='G'||pc==='C')return 'mode'; return 'ghost'; }

/* ===================== audio ===================== */
let ctx,resonBus,resonators=[];
const drones={},held={};
function ensureCtx(){
  if(ctx){ if(ctx.state==='suspended') ctx.resume(); return; }
  ctx=new (window.AudioContext||window.webkitAudioContext)();
  resonBus=ctx.createGain(); resonBus.gain.value=0.6;
  ['D3','A3','D4','A4'].forEach(n=>{ const bp=ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=freqOf(n); bp.Q.value=55; const g=ctx.createGain(); g.gain.value=0.45; resonBus.connect(bp); bp.connect(g); g.connect(ctx.destination); resonators.push({note:n,filter:bp}); });
}
function retuneResonators(){ resonators.forEach(r=>{ if(ctx) r.filter.frequency.setTargetAtTime(freqOf(r.note),ctx.currentTime,.02); }); }

function voice(freq,when,opts){
  opts=opts||{}; const sustain=!!opts.sustain, dur=opts.dur||1.6, level=opts.level||0.26, glideFrom=opts.glideFrom||null, glide=opts.glide||0.12;
  ensureCtx();
  const t0=(when==null)?ctx.currentTime:when;
  const amp=ctx.createGain(), lp=ctx.createBiquadFilter(); lp.type='lowpass';
  lp.frequency.setValueAtTime(Math.min(freq*8,6500),t0);
  if(!sustain) lp.frequency.exponentialRampToValueAtTime(Math.max(freq*2.2,700),t0+dur*0.6);
  const partials=[[1,1],[2,0.5],[3,0.3],[4,0.16],[5,0.09]];
  const oscs=partials.map(p=>{ const mult=p[0],a=p[1]; const o=ctx.createOscillator(); o.type=mult===1?'triangle':'sine';
    if(glideFrom){ o.frequency.setValueAtTime(glideFrom*mult,t0); o.frequency.exponentialRampToValueAtTime(freq*mult,t0+glide); } else o.frequency.value=freq*mult;
    const g=ctx.createGain(); g.gain.value=a; o.connect(g).connect(lp); return o; });
  lp.connect(amp); amp.connect(ctx.destination); amp.connect(resonBus);
  amp.gain.setValueAtTime(0.0001,t0); amp.gain.exponentialRampToValueAtTime(level,t0+0.008);
  oscs.forEach(o=>o.start(t0));
  if(!sustain){ amp.gain.exponentialRampToValueAtTime(0.0001,t0+dur); oscs.forEach(o=>o.stop(t0+dur+0.05)); return null; }
  return { stop(){ const n=ctx.currentTime; amp.gain.cancelScheduledValues(n); amp.gain.setValueAtTime(Math.max(amp.gain.value,0.0001),n); amp.gain.exponentialRampToValueAtTime(0.0001,n+0.12); oscs.forEach(o=>{try{o.stop(n+0.16)}catch(e){}}); } };
}

const SIMPLE=[[1,1,1.0],[2,1,0.92],[3,2,0.8],[4,3,0.68],[5,4,0.55],[6,5,0.5],[5,3,0.46],[8,5,0.4],[9,5,0.28],[9,8,0.22],[16,9,0.22]];
function consonance(ratio){ let r=ratio; while(r>=2)r/=2; while(r<1)r*=2; let best=0; for(const x of SIMPLE){ if(Math.abs(1200*Math.log2(r/(x[0]/x[1])))<16) best=Math.max(best,x[2]); } return best; }
function ringDrones(note){ const f=freqOf(note); glow('drone-D3',consonance(f/freqOf('D3'))); glow('drone-A3',consonance(f/freqOf('A3'))); }
function glow(id,w){ const el=document.getElementById(id); if(!el||w<=0)return; el.style.setProperty('--lit',w.toFixed(2)); clearTimeout(el._t); el._t=setTimeout(()=>{ el.style.setProperty('--lit',el.classList.contains('on')?'0.12':'0'); },460); }

/* ===================== actions ===================== */
function isMelody(note){ return MELODY.notes.indexOf(note)>=0; }
function pluck(note){
  let opts={};
  if(state.noter && isMelody(note) && state.lastMelodyFreq){ opts={glideFrom:state.lastMelodyFreq,glide:0.14}; showPath(note); }
  voice(freqOf(note),null,opts);
  if(isMelody(note)) state.lastMelodyFreq=freqOf(note);
  ringDrones(note); flash('cell-'+note);
}
function flash(id){ const el=document.getElementById(id); if(!el)return; el.classList.add('flash'); setTimeout(()=>el.classList.remove('flash'),150); }
function showPath(target){
  if(state.lastMelodyFreq==null)return;
  const tIdx=MELODY.notes.indexOf(target);
  let lIdx=MELODY.notes.findIndex(n=>Math.abs(freqOf(n)-state.lastMelodyFreq)<0.5);
  if(lIdx<0||tIdx<0)return;
  const a=Math.min(lIdx,tIdx), b=Math.max(lIdx,tIdx);
  for(let i=a;i<=b;i++){ const el=document.getElementById('cell-'+MELODY.notes[i]); if(el){ el.classList.add('path'); setTimeout(()=>el.classList.remove('path'),160);} }
}
function chord(notes,when){ when=when||0; ensureCtx(); notes.forEach((n,i)=>voice(freqOf(n),ctx.currentTime+when+i*0.02,{dur:1.9})); notes.forEach(ringDrones); }

/* ===================== drones ===================== */
function toggleDrone(note){
  ensureCtx(); const el=document.getElementById('drone-'+note);
  if(drones[note]){ drones[note].stop(); delete drones[note]; el.classList.remove('on'); el.setAttribute('aria-pressed','false'); el.style.setProperty('--lit','0'); return; }
  const o1=ctx.createOscillator(),o2=ctx.createOscillator(),g=ctx.createGain(),lp=ctx.createBiquadFilter();
  o1.type='sawtooth'; o2.type='triangle'; o1.frequency.value=freqOf(note); o2.frequency.value=freqOf(note)*2; o2.detune.value=1.5;
  lp.type='lowpass'; lp.frequency.value=950;
  g.gain.setValueAtTime(0.0001,ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.06,ctx.currentTime+0.1);
  o1.connect(lp); o2.connect(lp); lp.connect(g).connect(ctx.destination); o1.start(); o2.start();
  drones[note]={o1:o1,o2:o2,base:note,stop(){ const n=ctx.currentTime; g.gain.exponentialRampToValueAtTime(0.0001,n+0.12); setTimeout(()=>{try{o1.stop();o2.stop()}catch(e){}},160);}};
  el.classList.add('on'); el.setAttribute('aria-pressed','true'); el.style.setProperty('--lit','0.12');
}
function retuneDrones(){ Object.keys(drones).forEach(k=>{ const d=drones[k]; if(ctx){ d.o1.frequency.setTargetAtTime(freqOf(d.base),ctx.currentTime,.02); d.o2.frequency.setTargetAtTime(freqOf(d.base)*2,ctx.currentTime,.02);} }); }
function toggleDA(){ const on=drones['D3']&&drones['A3']; if(on) stopAllDrones(); else { if(!drones['D3'])toggleDrone('D3'); if(!drones['A3'])toggleDrone('A3'); } }
