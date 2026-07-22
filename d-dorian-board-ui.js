function stopAllDrones(){ Object.keys(drones).forEach(toggleDrone); }

/* ===================== keyboard ===================== */
const keyToNote={};
STRINGS.forEach(s=>s.keys.forEach((k,i)=>{ if(!k)return; const code=/[0-9]/.test(k)?'Digit'+k:'Key'+k; keyToNote[code]=s.notes[i]; if(/[0-9]/.test(k)) keyToNote['Numpad'+k]=s.notes[i]; }));
function startHeld(code){ const note=keyToNote[code]; if(!note||held[code])return; if(state.noter&&!isMelody(note))return; held[code]=voice(freqOf(note),null,{sustain:true,level:0.15}); ringDrones(note); const el=document.getElementById('cell-'+note); if(el)el.classList.add('held'); }
function stopHeld(code){ if(!held[code])return; held[code].stop(); const el=document.getElementById('cell-'+keyToNote[code]); if(el)el.classList.remove('held'); delete held[code]; }
document.addEventListener('keydown',e=>{
  if(e.target&&e.target.tagName==='INPUT')return;
  if(keyToNote[e.code]){ e.preventDefault(); startHeld(e.code); return; }
  if(e.code==='Space'){ e.preventDefault(); if(!e.repeat) toggleDA(); }
  if(e.code==='Escape') stopAllDrones();
});
document.addEventListener('keyup',e=>{ if(keyToNote[e.code]){ e.preventDefault(); stopHeld(e.code);} });

/* ===================== transport ===================== */
let transport={id:0};
function stopTransport(){ transport.id++; const bs=document.querySelectorAll('.phrase button.playing'); bs.forEach(b=>{b.classList.remove('playing'); b.textContent='Loop';}); }
function beatSec(){ return 60/(+document.getElementById('tempo').value); }
function playPhrase(idx,btn){
  stopTransport(); const myId=++transport.id; const ph=PHRASES[idx];
  state.lastPhrase={notes:ph.notes.slice()};
  btn.classList.add('playing'); btn.textContent='Stop';
  const cr=document.getElementById('cr').checked; ensureCtx();
  const run=()=>{ if(transport.id!==myId)return; const b=beatSec();
    ph.notes.forEach((n,i)=>setTimeout(()=>{ if(transport.id===myId) pluck(n); }, i*b*1000));
    const span=ph.notes.length*b; const next=cr?span*2:span; setTimeout(run,next*1000+80);
  }; run();
}
function playNotesTuned(notes,tuning,startAt){ ensureCtx(); const b=beatSec(); notes.forEach((n,i)=>voice(freqWith(n,tuning,state.refD),ctx.currentTime+startAt+i*b,{dur:Math.min(b*1.6,1.4)})); return notes.length*b; }
function abCompare(){ stopTransport(); ensureCtx(); const notes=state.lastPhrase?state.lastPhrase.notes:['D4','E4','F4','G4','A4','B4','C5','D5']; const d1=playNotesTuned(notes,'just',0.05); playNotesTuned(notes,'equal',0.05+d1+0.6); }

/* ===================== microphone ===================== */
let micStream=null,analyser=null,micBuf=null,listening=false,rafId=null;
async function getMic(){ if(micStream)return micStream; micStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}}); return micStream; }
function detectPitch(buf,sr){
  let rms=0; for(let i=0;i<buf.length;i++) rms+=buf[i]*buf[i]; rms=Math.sqrt(rms/buf.length);
  if(rms<0.01) return -1;
  const SIZE=buf.length, corrs=new Array(1000); let bestOff=-1,bestCorr=0,lastCorr=1;
  for(let off=1;off<1000;off++){ let corr=0; for(let i=0;i<SIZE-off;i++) corr+=buf[i]*buf[i+off]; corr=corr/(SIZE-off); corrs[off]=corr;
    if(corr>0.9*bestCorr&&corr>lastCorr){ if(corr>bestCorr){bestCorr=corr;bestOff=off;} } lastCorr=corr; }
  if(bestOff<=0) return -1;
  const a=corrs[bestOff-1]||bestCorr, b=bestCorr, c=corrs[bestOff+1]||bestCorr;
  const denom=(a-2*b+c); const shift=denom?(a-c)/(2*denom):0;
  return sr/(bestOff+shift);
}
function nearestSimpleBeat(fp,fd){ let r=fp/fd,best=null,bestErr=1e9; for(let n=1;n<=8;n++)for(let m=1;m<=8;m++){ const e=Math.abs(r-n/m); if(e<bestErr){bestErr=e;best=[n,m];} } if(!best)return 0; return Math.abs(best[1]*fp-best[0]*fd); }
function meterLoop(){
  if(!listening)return;
  analyser.getFloatTimeDomainData(micBuf);
  const f=detectPitch(micBuf, ctx?ctx.sampleRate:44100);
  if(f>0){
    let best=null,bestC=1e9;
    DEGREES.forEach(pc=>{ [0,1,2].forEach(k=>{ const tgt=state.refD*JUST_R[pc]*Math.pow(2,k); const c=Math.abs(1200*Math.log2(f/tgt)); if(c<bestC){bestC=c;best={pc:pc,tgt:tgt};} }); });
    const dev=1200*Math.log2(f/best.tgt);
    document.getElementById('m-deg').textContent=best.pc;
    const cn=document.getElementById('m-cents'); cn.textContent=(dev>=0?'+':'')+dev.toFixed(0)+' ¢';
    cn.className='cents '+(Math.abs(dev)<4?'lock':(dev<0?'flat':'sharp'));
    document.getElementById('m-hz').textContent=f.toFixed(1)+' Hz → '+best.tgt.toFixed(1)+' Hz';
    document.getElementById('m-needle').style.left=(50+Math.max(-50,Math.min(50,dev)))+'%';
    document.getElementById('m-beatD').textContent=drones['D3']?nearestSimpleBeat(f,freqOf('D3')).toFixed(1)+' Hz':'— (drone off)';
    document.getElementById('m-beatA').textContent=drones['A3']?nearestSimpleBeat(f,freqOf('A3')).toFixed(1)+' Hz':'— (drone off)';
  } else { document.getElementById('m-hz').textContent='listening…'; }
  rafId=requestAnimationFrame(meterLoop);
}
async function toggleListen(){
  const btn=document.getElementById('listen-btn');
  if(listening){ listening=false; cancelAnimationFrame(rafId); btn.textContent='Listen: off'; btn.classList.remove('live'); document.getElementById('meter').classList.remove('show'); return; }
  try{ ensureCtx(); const stream=await getMic(); const src=ctx.createMediaStreamSource(stream); analyser=ctx.createAnalyser(); analyser.fftSize=2048; micBuf=new Float32Array(analyser.fftSize); src.connect(analyser);
    listening=true; btn.textContent='Listen: on'; btn.classList.add('live'); document.getElementById('meter').classList.add('show'); document.getElementById('m-msg').textContent=''; meterLoop();
  }catch(err){ document.getElementById('meter').classList.add('show'); document.getElementById('m-msg').textContent='Microphone unavailable — allow access in the browser to use the meter.'; }
}
async function calibrate(){
  const btn=document.getElementById('calib-btn');
  try{ ensureCtx(); const stream=await getMic(); const src=ctx.createMediaStreamSource(stream); const an=ctx.createAnalyser(); an.fftSize=2048; const buf=new Float32Array(an.fftSize); src.connect(an);
    btn.textContent='Play open D…'; const samples=[]; const t0=performance.now();
    const finish=()=>{ btn.textContent='Calibrate from mic'; if(samples.length<5){ btn.textContent='No clear pitch — retry'; setTimeout(()=>btn.textContent='Calibrate from mic',1500); return; }
      samples.sort((a,b)=>a-b); let med=samples[Math.floor(samples.length/2)]; while(med>200)med/=2; while(med<120)med*=2; setRef(med); };
    const grab=()=>{ an.getFloatTimeDomainData(buf); const f=detectPitch(buf,ctx.sampleRate); if(f>80&&f<400)samples.push(f); if(performance.now()-t0<1400) requestAnimationFrame(grab); else finish(); };
    grab();
  }catch(err){ btn.textContent='Mic unavailable'; setTimeout(()=>btn.textContent='Calibrate from mic',1500); }
}

/* ===================== reference ===================== */
function setRef(hz){ state.refD=hz; document.getElementById('ref-hz').textContent=hz.toFixed(2)+' Hz'; retuneDrones(); retuneResonators(); renderBoard(); updateSub(); renderPrintCard(); }
function trimRef(c){ setRef(state.refD*Math.pow(2,c/1200)); }

/* ===================== rendering ===================== */
function renderBoard(){
  document.getElementById('fret-head').innerHTML='<th class="open"></th>'+FRETS.map(f=>`<th class="fret${f==='6½'?' half':''}">${f}</th>`).join('');
  document.getElementById('board-body').innerHTML=STRINGS.map(s=>{
    const cells=s.notes.map((note,i)=>{
      const pc=note.replace(/\d+$/,''),cls=classOf(note),key=s.keys[i];
      let devHtml='<div class="dv"></div>';
      if(state.tuning!=='just'&&DEGREES.indexOf(pc)>=0){ const dev=deviationCents(pc); devHtml=`<div class="dv ${dev<0?'flat':'sharp'}">${dev>=0?'+':''}${dev.toFixed(0)}¢</div>`; }
      const disabled=(state.noter&&!isMelody(note))?' disabled':'';
      return `<td class="cell ${cls}${disabled}" id="cell-${note}" onclick="pluck('${note}')"><div class="nm">${pc}</div><div class="fr">${FRAC[pc]}</div>${devHtml}<div class="kc">${key||''}</div></td>`;
    }).join('');
    return `<tr><th class="open">${s.name} · ${s.open}</th>${cells}</tr>`;
  }).join('');
}
function renderStatic(){
  document.getElementById('chord-grid').innerHTML=TRIADS.map(t=>`<div class="chord-card ${t.cls}" onclick='chord(${JSON.stringify(t.notes)})'><div class="rom">${t.rom}</div><div class="name">${t.name}</div><div class="pitches">${t.notes.map(n=>n.replace(/\d+$/,'')).join(' · ')}</div><div class="hold">hold ${t.hold}</div></div>`).join('');
  document.getElementById('seq').innerHTML=SEQUENCES.map((q,i)=>`<button onclick="runSeq(${i})">${q.label}</button>`).join('');
  document.getElementById('phrase-list').innerHTML=PHRASES.map((p,i)=>`<div class="phrase"><div class="pl">${p.label}</div><div class="pc">${p.character}</div><div class="deg-seq">${p.notes.map(n=>n.replace(/\d+$/,'')).join(' ')}</div><button onclick="onPhrase(${i},this)">Loop</button></div>`).join('');
  document.getElementById('editor').innerHTML=DEGREES.map(d=>`<div class="deg"><div class="dn">${d}</div><input type="number" step="1" value="${state.customCents[d]}" oninput="setCustom('${d}',this.value)"><div class="unit">¢ from D</div><div class="unit" style="color:var(--ghost)">just ${cents(JUST_R[d]).toFixed(0)}</div></div>`).join('');
  document.getElementById('foot').innerHTML='Fixed just pitches can\u2019t make every chord pure — the price of intonation without a tempering grid. Dm (10:12:15), F and G (4:5:6) lock against the drone, but ii (Em) inherits a Pythagorean third of 32/27 and beats: the wolf is the unsynthesised remainder, left audible rather than smoothed away.';
}
function renderPrintCard(){
  const head='<th>String</th>'+FRETS.map(f=>`<th>${f}</th>`).join('');
  const rows=STRINGS.map(s=>'<tr><td class="s">'+s.name+' · '+s.open+'</td>'+s.notes.map(n=>{ const pc=n.replace(/\d+$/,''); const g=(pc==='D'||pc==='A')?' class="g"':''; return `<td${g}>${pc}<br>${FRAC[pc]}</td>`; }).join('')+'</tr>').join('');
  const tn={just:'just intonation',equal:'equal temperament',custom:'custom'}[state.tuning];
  document.getElementById('print-card').innerHTML=`<h3>D Dorian — fret &amp; ratio card</h3><div class="pmeta">tuning D A G · ${tn} · open D = ${state.refD.toFixed(2)} Hz · ${new Date().toLocaleDateString()}</div><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table><div class="pnote">Ratios are the just interval above the D drone (1/1). Bold = drone tones (D, A). The 6½ fret and B♭ lie outside D Dorian.</div>`;
}
function updateSub(){ const tn={just:'just intonation to the D drone',equal:'equal temperament',custom:'custom tuning'}[state.tuning]; document.getElementById('subline').textContent=`tuning D A G · ${tn} · 1/1 = ${state.refD.toFixed(2)} Hz`; }

/* ===================== handlers ===================== */
function onPhrase(i,btn){ if(btn.classList.contains('playing')) stopTransport(); else playPhrase(i,btn); }
function runSeq(i){ ensureCtx(); const q=SEQUENCES[i]; if(q.scale){ state.lastPhrase={notes:q.scale.slice()}; q.scale.forEach((n,j)=>setTimeout(()=>pluck(n),j*270)); } else { q.chords.forEach((name,j)=>chord(CHORDS[name],j*1.05)); } }
function setCustom(d,v){ state.customCents[d]=parseFloat(v)||0; retuneDrones(); retuneResonators(); renderBoard(); }
function toggleNoter(){ state.noter=!state.noter; document.body.classList.toggle('noter',state.noter); const b=document.getElementById('noter-btn'); b.textContent='Noter: '+(state.noter?'on':'off'); b.classList.toggle('live',state.noter); state.lastMelodyFreq=null; renderBoard(); }

document.getElementById('seg-view').addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b)return; state.view=b.dataset.v; document.querySelectorAll('#seg-view button').forEach(x=>x.classList.toggle('sel',x===b)); document.body.classList.toggle('playalong',state.view==='playalong'); });
document.getElementById('seg-tuning').addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b)return; state.tuning=b.dataset.t; document.querySelectorAll('#seg-tuning button').forEach(x=>x.classList.toggle('sel',x===b)); document.getElementById('editor').classList.toggle('show',state.tuning==='custom'); retuneDrones(); retuneResonators(); renderBoard(); updateSub(); renderPrintCard(); });
document.getElementById('tempo').addEventListener('input',e=>document.getElementById('tempo-val').textContent=e.target.value);
['D3','A3'].forEach(note=>{ const el=document.getElementById('drone-'+note); el.addEventListener('click',()=>toggleDrone(note)); el.addEventListener('keydown',e=>{ if(e.code==='Enter'||e.code==='Space'){ e.preventDefault(); toggleDrone(note);} }); });

renderBoard(); renderStatic(); renderPrintCard(); updateSub();
