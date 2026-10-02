'use strict';
/* =====================================================================
   Фитнес-трекер — все данные хранятся локально (localStorage)
   ===================================================================== */

const DB_KEY  = 'fitness_v4';
const OLD_KEY = 'fitness_v3';
const DAY = 864e5;

/* Высота приложения. В режиме «с экрана Домой» iOS при прозрачной строке состояния
   считает высоту страницы без неё, и нижнее меню оказывается приподнятым.
   Поэтому там берём реальную высоту экрана, в остальных случаях — видимую область. */
function fitApp(){
  let h;
  if(window.navigator.standalone){
    const portrait = window.innerWidth <= window.innerHeight;
    h = portrait ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
  } else {
    h = window.innerHeight;
  }
  document.documentElement.style.setProperty('--app-h', h+'px');
}
fitApp();
window.addEventListener('resize', fitApp);
window.addEventListener('orientationchange', ()=>setTimeout(fitApp, 300));

const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

const WD = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

/* ================== УТИЛИТЫ ================== */
function pad(n){ return String(n).padStart(2,'0'); }
function esc(s){
  return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function cleanName(s){ return String(s==null?'':s).replace(/\s+/g,' ').trim(); }
function normKey(s){ return cleanName(s).toLowerCase().replace(/ё/g,'е'); }
function round(n,d=2){ const k=Math.pow(10,d); return Math.round(n*k)/k; }
// число из строки ("82,5", "1 000", 80) → число или null (пусто/0/мусор → null)
function num(v){
  if(v===null||v===undefined) return null;
  if(typeof v==='number') return isFinite(v)&&v!==0 ? round(v,3) : null;
  const s = String(v).replace(/[\s\u00a0\u202f]/g,'').replace(',','.');
  if(!s) return null;
  const f = parseFloat(s);
  return isFinite(f)&&f!==0 ? round(f,3) : null;
}
function inVal(v){ return v==null ? '' : String(v).replace('.',','); }
const minIn  = sec => sec ? inVal(round(sec/60,2)) : '';          // сек → поле «мин»
const minOut = v => { const m=num(v); return m ? Math.round(m*60) : null; };   // поле «мин» → сек
function fmtNum(n){
  if(n==null||n===''||!isFinite(n)) return '';
  return round(+n,2).toLocaleString('ru-RU',{maximumFractionDigits:2});
}
function fmtTon(kg){
  if(!kg) return '';
  return kg>=10000 ? fmtNum(round(kg/1000,1))+' т' : fmtNum(round(kg,1))+' кг';
}
function fmtClock(totalSec){
  const s=Math.max(0,Math.floor(totalSec));
  const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), ss=s%60;
  return h>0 ? `${pad(h)}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`;
}
function fmtDur(sec){
  sec=Math.round(sec||0);
  if(sec<60) return sec+' сек';
  const m=Math.floor(sec/60), s=sec%60;
  if(m<60) return s>0 ? `${m} мин ${s} сек` : `${m} мин`;
  const h=Math.floor(m/60), mm=m%60;
  return mm>0 ? `${h} ч ${mm} мин` : `${h} ч`;
}
function plural(n,one,few,many){
  const a=Math.abs(n)%100, b=a%10;
  if(a>10&&a<20) return many;
  if(b>1&&b<5) return few;
  if(b===1) return one;
  return many;
}
function dayKey(ms){ const d=new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function fmtDate(ms){ const d=new Date(ms); return `${pad(d.getDate())}.${pad(d.getMonth()+1)}.${d.getFullYear()}`; }
function fmtDM(ms){ const d=new Date(ms); return `${pad(d.getDate())}.${pad(d.getMonth()+1)}`; }
function fmtTime(ms){ const d=new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function relDay(ms){
  const k=dayKey(ms);
  if(k===dayKey(Date.now())) return 'сегодня';
  if(k===dayKey(Date.now()-DAY)) return 'вчера';
  const d=new Date(ms);
  return `${WD[d.getDay()]} ${fmtDM(ms)}${d.getFullYear()!==new Date().getFullYear()?'.'+d.getFullYear():''}`;
}
function toInputDT(ms){
  const d=new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromInputDT(s){
  const m=String(s||'').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return m ? new Date(+m[1],+m[2]-1,+m[3],+m[4],+m[5]).getTime() : null;
}

/* ================== ХРАНИЛИЩЕ ==================
   exercises: {id, name}
   records:   {id, exId, wId, ts, reps, sets, weight, time, notes}   — одна запись = одно упражнение (N повт × M подходов × вес)
   workouts:  {id, start, end, timed, rest}                          — timed=true, если длительность замерена таймером
   active:    {wId, restEnd, restTotal}                              — идущая тренировка и таймер отдыха
*/
function emptyDB(){
  return {
    v:4, exercises:[], records:[], workouts:[],
    seq:{ex:0, rec:0, w:0},
    active:{wId:null, restEnd:null, restTotal:0},
    lastExport:0
  };
}

let DB = load();

function load(){
  let d=null, raw=null;
  try{ raw=localStorage.getItem(DB_KEY); }catch(e){}
  if(raw){
    try{ d=JSON.parse(raw); }
    catch(e){ try{ localStorage.setItem(DB_KEY+'_broken_'+Date.now(), raw); }catch(_){} }
  }
  if(!d){
    try{
      const old=localStorage.getItem(OLD_KEY);
      if(old) d=migrateV3(JSON.parse(old));
    }catch(e){ console.error(e); }
  }
  return normalize(d || emptyDB());
}

function normalize(d){
  const base=emptyDB();
  const out={
    v:4,
    exercises: (Array.isArray(d.exercises)?d.exercises:[])
      .filter(e=>e && e.name!=null && cleanName(e.name))
      .map(e=>({id:+e.id, name:cleanName(e.name)})),
    records: (Array.isArray(d.records)?d.records:[])
      .filter(r=>r && r.ts)
      .map(r=>({id:+r.id, exId:+r.exId, wId:r.wId!=null?+r.wId:null, ts:+r.ts,
        reps:num(r.reps), sets:num(r.sets), weight:num(r.weight), time:num(r.time),
        notes:r.notes?String(r.notes):''})),
    workouts: (Array.isArray(d.workouts)?d.workouts:[])
      .filter(w=>w && w.start)
      .map(w=>({id:+w.id, start:+w.start, end:w.end?+w.end:null, timed:!!w.timed, rest:Math.max(0,+w.rest||0)})),
    seq: Object.assign({}, base.seq, d.seq||{}),
    active: Object.assign({}, base.active, d.active||{}),
    lastExport: +d.lastExport || 0
  };
  const maxId = arr => arr.reduce((m,x)=>Math.max(m, x.id||0), 0);
  out.seq.ex  = Math.max(+out.seq.ex||0,  maxId(out.exercises));
  out.seq.rec = Math.max(+out.seq.rec||0, maxId(out.records));
  out.seq.w   = Math.max(+out.seq.w||0,   maxId(out.workouts));
  if(out.active.wId && !out.workouts.some(w=>w.id===+out.active.wId)) out.active.wId=null;
  if(out.active.wId) out.active.wId=+out.active.wId;
  if(!out.active.wId){ out.active.restEnd=null; out.active.restTotal=0; }
  out.workouts.forEach(w=>{
    if(w.id===out.active.wId){ w.end=null; w.timed=true; }
    else if(w.timed && !w.end) w.timed=false;
  });
  return out;
}

// перенос данных из прошлой версии (fitness_v3: логи по одной метрике)
function migrateV3(o){
  const d=emptyDB();
  (o.exercises||[]).forEach(e=>{ if(e && e.name!=null) d.exercises.push({id:+e.id, name:String(e.name)}); });
  (o.workouts||[]).forEach(w=>{
    if(!w || !w.startMs) return;
    d.workouts.push({id:+w.id, start:+w.startMs, end:w.endMs?+w.endMs:null, timed:!!w.endMs, rest:+w.restSeconds||0});
  });
  const groups=new Map();
  (o.logs||[]).forEach(l=>{
    if(!l || !l.ts) return;
    const k=l.exId+'|'+l.ts;
    if(!groups.has(k)) groups.set(k,{exId:+l.exId, ts:l.ts, wId:l.workoutId?+l.workoutId:null, m:{}});
    groups.get(k).m[l.metric]=l.value;
  });
  let rid=0;
  groups.forEach(g=>{
    const ts=parseLocalTs(g.ts);
    if(!ts) return;
    d.records.push({id:++rid, exId:g.exId, wId:g.wId, ts,
      reps:num(g.m['Количество']), sets:num(g.m['Подходы']), weight:num(g.m['Вес']), time:num(g.m['Время']),
      notes:g.m['Заметки']?String(g.m['Заметки']):''});
  });
  if(o.activeWorkout && o.activeWorkout.id){
    const w=d.workouts.find(x=>x.id===+o.activeWorkout.id);
    if(w){ d.active.wId=w.id; w.rest=+o.activeWorkout.restSeconds||w.rest; }
  }
  return d;
}
function parseLocalTs(s){
  const m=String(s).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  return m ? new Date(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+(m[6]||0)).getTime() : null;
}

function save(){
  try{ localStorage.setItem(DB_KEY, JSON.stringify(DB)); return true; }
  catch(e){ console.error(e); toast('Не удалось сохранить данные — память недоступна или переполнена', null, null, 4000, 'alert'); return false; }
}
function nid(k){ DB.seq[k]=(+DB.seq[k]||0)+1; return DB.seq[k]; }

/* ================== МОДЕЛЬ ================== */
function exById(id){ return DB.exercises.find(e=>e.id===id); }
function exByName(name){ const n=normKey(name); return n ? DB.exercises.find(e=>normKey(e.name)===n) : undefined; }
function getOrCreateEx(name){
  let e=exByName(name);
  if(!e){ e={id:nid('ex'), name:cleanName(name)}; DB.exercises.push(e); }
  return e;
}
function wById(id){ return DB.workouts.find(w=>w.id===id); }
function isActive(w){ return !!w && DB.active.wId===w.id; }
function activeW(){ return DB.active.wId ? wById(DB.active.wId) : null; }
function recsOfW(wId){ return DB.records.filter(r=>r.wId===wId).sort((a,b)=>a.ts-b.ts); }
function ton(r){ return (r.weight && r.reps) ? r.weight*r.reps*(r.sets||1) : 0; }
function wDur(w){
  if(!w) return 0;
  if(isActive(w)) return Math.max(0,(Date.now()-w.start)/1000);
  return (w.timed && w.end) ? Math.max(0,(w.end-w.start)/1000) : 0;
}
function sortedWorkouts(){
  return DB.workouts.filter(w=>isActive(w) || DB.records.some(r=>r.wId===w.id)).sort((a,b)=>a.start-b.start);
}
function workoutNumber(id){ return sortedWorkouts().findIndex(w=>w.id===id)+1; }
function lastRecOf(exId){
  let best=null;
  DB.records.forEach(r=>{ if(r.exId===exId && (!best || r.ts>best.ts)) best=r; });
  return best;
}
function exMeta(){
  const m=new Map();
  DB.records.forEach(r=>{
    let x=m.get(r.exId);
    if(!x){ x={count:0,last:0,maxW:0}; m.set(r.exId,x); }
    x.count++;
    if(r.ts>x.last) x.last=r.ts;
    if(r.weight && r.weight>x.maxW) x.maxW=r.weight;
  });
  return m;
}

// подобрать тренировку для записи, сделанной без запущенного таймера
function workoutFor(ts){
  const dk=dayKey(ts);
  const same=DB.workouts.filter(w=>!isActive(w) && dayKey(w.start)===dk);
  let w=same.find(x=>x.timed && x.end && ts>=x.start-30*60000 && ts<=x.end+30*60000);
  if(!w) w=same.filter(x=>!x.timed)
    .find(x=>DB.records.some(r=>r.wId===x.id && Math.abs(r.ts-ts)<3*3600e3));
  if(!w){ w={id:nid('w'), start:ts, end:null, timed:false, rest:0}; DB.workouts.push(w); }
  return w.id;
}
// убрать пустые тренировки, у «незамеренных» начало = первая запись
function cleanupWorkouts(){
  const first=new Map();
  DB.records.forEach(r=>{ const m=first.get(r.wId); first.set(r.wId, m===undefined ? r.ts : Math.min(m,r.ts)); });
  DB.workouts=DB.workouts.filter(w=>isActive(w) || first.has(w.id));
  DB.workouts.forEach(w=>{ if(!w.timed && first.has(w.id)) w.start=first.get(w.id); });
}
function fixOrphans(){
  const exIds=new Set(DB.exercises.map(e=>e.id));
  const lost=new Map();
  DB.records.forEach(r=>{
    if(exIds.has(r.exId)) return;
    if(!lost.has(r.exId)){
      const e={id:nid('ex'), name:'Без названия '+(lost.size+1)};
      DB.exercises.push(e); lost.set(r.exId,e.id);
    }
    r.exId=lost.get(r.exId);
  });
  const wIds=new Set(DB.workouts.map(w=>w.id));
  DB.records.slice().sort((a,b)=>a.ts-b.ts).forEach(r=>{
    if(r.wId==null || !wIds.has(r.wId)){ r.wId=workoutFor(r.ts); wIds.add(r.wId); }
  });
}

function describe(r){
  const p=[];
  if(r.weight) p.push(fmtNum(r.weight)+' кг');
  if(r.reps && r.sets) p.push(`${fmtNum(r.reps)} повт × ${fmtNum(r.sets)} подх`);
  else if(r.reps) p.push(fmtNum(r.reps)+' повт');
  else if(r.sets) p.push(fmtNum(r.sets)+' подх');
  if(r.time) p.push(fmtDur(r.time));
  return p.join(' · ');
}
function rxs(r){
  if(r.reps && r.sets) return `${fmtNum(r.reps)}×${fmtNum(r.sets)}`;
  if(r.reps) return fmtNum(r.reps);
  if(r.sets) return '—×'+fmtNum(r.sets);
  return '—';
}

/* ================== UI: иконки, сообщения, диалоги, модалка ================== */
function I(name, cls){ return `<svg class="i ic-${name}${cls?' '+cls:''}" aria-hidden="true"><use href="#i-${name}"></use></svg>`; }
let toastTimer=null;
function toast(msg, actLabel, actFn, ms, icon){
  const el=$('#toast');
  el.innerHTML=(icon?I(icon,'toast-ico'):'')+`<span>${esc(msg)}</span>`+(actLabel?`<button class="toast-btn">${esc(actLabel)}</button>`:'');
  el.classList.add('show');
  if(actLabel) el.querySelector('.toast-btn').onclick=()=>{ hideToast(); actFn(); };
  clearTimeout(toastTimer);
  toastTimer=setTimeout(hideToast, ms || (actLabel?4500:2600));
}
function hideToast(){ $('#toast').classList.remove('show'); }

// замена confirm()/alert(): во встроенных браузерах iOS-приложений они часто не работают
function ask(html, okLabel, danger, cancelLabel){
  if(cancelLabel===undefined) cancelLabel='Отмена';
  return new Promise(res=>{
    const dlg=$('#dialog');
    dlg.innerHTML=`<div class="dialog-box">
      <div class="dialog-text">${html}</div>
      <div class="dialog-btns">
        ${cancelLabel!==null?`<button class="btn ghost" data-r="0">${esc(cancelLabel)}</button>`:''}
        <button class="btn${danger?' danger':''}" data-r="1">${esc(okLabel||'OK')}</button>
      </div></div>`;
    dlg.classList.add('show');
    dlg.onclick=e=>{
      const b=e.target.closest('[data-r]');
      if(!b && e.target!==dlg) return;
      e.stopPropagation();
      dlg.classList.remove('show'); dlg.onclick=null; dlg.innerHTML='';
      res(b ? b.dataset.r==='1' : false);
    };
  });
}

let editReturnW=null;
function openModal(html){
  const sh=$('#modalSheet');
  sh.innerHTML=html;
  $('#modal').classList.add('show');
  sh.scrollTop=0;
}
function closeModal(){
  $('#modal').classList.remove('show');
  $('#modalSheet').innerHTML='';
  editReturnW=null;
}
$('#modal').addEventListener('click', e=>{ if(e.target.id==='modal') closeModal(); });

/* ================== НАВИГАЦИЯ ================== */
let curView='record';
function showView(v){
  $$('.view').forEach(x=>x.classList.add('hidden'));
  $('#view-'+v).classList.remove('hidden');
  const tab = v==='history' ? 'ex' : v;
  $$('.nav button').forEach(b=>b.classList.toggle('active', b.dataset.tab===tab));
  curView=v;
  $('#scroller').scrollTop=0;
}
function go(tab){ showView(tab); refresh(); }
function refresh(){
  if(curView==='record') renderRecord();
  else if(curView==='ex') renderExList();
  else if(curView==='history') renderHistory();
  else if(curView==='stats') renderStats();
}

/* ================== ЭКРАН «ЗАПИСЬ» ================== */
const exInput=$('#exInput');
const exSuggest=$('#exSuggest');
const NUM_FIELDS=['mReps','mSets','mWeight','mTime'];

function renderRecord(){
  renderWorkoutBar();
  renderLastHint();
  renderToday();
}

function renderSuggest(){
  const q=normKey(exInput.value);
  const meta=exMeta();
  let list=DB.exercises.slice();
  if(q) list=list.filter(e=>normKey(e.name).includes(q));
  list.sort((a,b)=>{
    if(q){
      const as=normKey(a.name).startsWith(q), bs=normKey(b.name).startsWith(q);
      if(as!==bs) return as?-1:1;
    }
    return ((meta.get(b.id)||{}).last||0)-((meta.get(a.id)||{}).last||0) || a.name.localeCompare(b.name,'ru');
  });
  list=list.slice(0,8);
  let html=list.map(e=>{
    const x=meta.get(e.id);
    return `<div class="suggest-item" data-exid="${e.id}"><span>${esc(e.name)}</span><span class="hint">${x?x.count+' зап.':'нет записей'}</span></div>`;
  }).join('');
  if(q && !exByName(exInput.value)){
    html+=`<div class="suggest-item create" data-create="1"><span>${I('plus')} Новое: «${esc(cleanName(exInput.value))}»</span></div>`;
  }
  if(!html){ hideSuggest(); return; }
  exSuggest.innerHTML=html;
  exSuggest.classList.add('show');
}
function hideSuggest(){ exSuggest.classList.remove('show'); }

exInput.addEventListener('input', ()=>{ renderSuggest(); renderLastHint(); });
exInput.addEventListener('focus', renderSuggest);
exInput.addEventListener('blur', ()=>setTimeout(hideSuggest,250));
exInput.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); hideSuggest(); exInput.blur(); } });
exSuggest.addEventListener('mousedown', e=>e.preventDefault());
exSuggest.addEventListener('click', e=>{
  const it=e.target.closest('.suggest-item');
  if(!it) return;
  if(it.dataset.create) exInput.value=cleanName(exInput.value);
  else { const ex=exById(+it.dataset.exid); if(ex) exInput.value=ex.name; }
  hideSuggest();
  exInput.blur();
  renderLastHint();
});

function formEmpty(){ return NUM_FIELDS.every(id=>!$('#'+id).value.trim()); }
function setVal(id,v){ $('#'+id).value=inVal(v); }
function fillFromLast(){
  const ex=exByName(exInput.value);
  const r=ex && lastRecOf(ex.id);
  if(!r) return;
  setVal('mReps',r.reps); setVal('mSets',r.sets); setVal('mWeight',r.weight); $('#mTime').value=minIn(r.time);
}
function clearForm(withName){
  NUM_FIELDS.forEach(id=>$('#'+id).value='');
  $('#mNotes').value='';
  if(withName){ exInput.value=''; renderLastHint(); }
}
/* ---- пределы ввода ---- */
const LIMITS={ reps:10000, sets:10000, weight:100000, time:6000, rest:600 };   // time и rest — в минутах
const FIELD_MAX={ mReps:LIMITS.reps, mSets:LIMITS.sets, mWeight:LIMITS.weight, mTime:LIMITS.time,
                  eReps:LIMITS.reps, eSets:LIMITS.sets, eWeight:LIMITS.weight, eTime:LIMITS.time };
const LIMIT_TEXT={ reps:'повторения — до 10 000', sets:'подходы — до 10 000', weight:'вес — до 100 000 кг', time:'время — до 6 000 мин' };

function markBad(inp, bad){
  if(!inp) return;
  inp.classList.toggle('bad', bad);
  const st=inp.closest('.stepper'); if(st) st.classList.toggle('bad', bad);
}
// значение поля вне пределов: отрицательное, больше максимума или не число
function fieldBad(inp, max){
  const raw=String(inp.value||'').replace(/[\s\u00a0\u202f]/g,'').replace(',','.');
  if(!raw) return false;
  const v=Number(raw);
  return !isFinite(v) || v<0 || v>max;
}
// проверяет поля [id, ключ лимита]; подсвечивает плохие; true — всё в порядке
function checkLimits(list){
  const bad=[];
  list.forEach(([id,key])=>{
    const inp=$('#'+id); if(!inp) return;
    const b=fieldBad(inp, LIMITS[key]);
    markBad(inp, b);
    if(b) bad.push(key);
  });
  if(bad.length){
    toast('Проверьте поля: '+bad.map(k=>LIMIT_TEXT[k]).join(', '), null, null, 4500, 'alert');
    const first=$('#'+list.find(([id,key])=>bad.includes(key))[0]);
    if(first) first.focus();
    return false;
  }
  return true;
}
document.addEventListener('input', e=>{ if(e.target.classList && e.target.classList.contains('bad')) markBad(e.target,false); });

function stepInput(id, d){
  const inp=$('#'+id); if(!inp) return;
  let v=round((num(inp.value)||0)+d,3);
  if(v<0) v=0;
  const max=FIELD_MAX[id];
  if(max && v>max) v=max;
  inp.value=v ? inVal(v) : '';
  markBad(inp,false);
}

function renderLastHint(){
  const box=$('#lastHint');
  const ex=exByName(exInput.value);
  const r=ex && lastRecOf(ex.id);
  if(!r){ box.innerHTML=''; return; }
  const maxW=DB.records.reduce((m,x)=>x.exId===ex.id && x.weight>m ? x.weight : m, 0);
  box.innerHTML=`<div class="hint-card">
    <div>
      <div class="muted">Прошлый раз · ${relDay(r.ts)} ${fmtTime(r.ts)}</div>
      <div class="hint-val">${esc(describe(r))||'—'}</div>
      ${maxW?`<div class="muted">Рекорд: ${fmtNum(maxW)} кг</div>`:''}
    </div>
    <button class="btn ghost sm" data-act="fill-last">Подставить</button>
  </div>`;
}

function recRow(r, fromW){
  const ex=exById(r.exId);
  return `<div class="rec-row" data-act="rec-edit" data-id="${r.id}"${fromW?` data-w="${fromW}"`:''}>
    <div class="rec-main">
      <div class="rec-name">${esc(ex?ex.name:'?')}</div>
      <div class="rec-desc">${esc(describe(r))}${r.notes?` <span class="note">«${esc(r.notes)}»</span>`:''}</div>
    </div>
    <div class="rec-side">${fmtTime(r.ts)}</div>
  </div>`;
}

function renderToday(){
  const box=$('#todayList');
  const tk=dayKey(Date.now());
  const recs=DB.records.filter(r=>dayKey(r.ts)===tk).sort((a,b)=>b.ts-a.ts);
  if(!recs.length){ box.innerHTML=''; return; }
  const total=recs.reduce((a,r)=>a+ton(r),0);
  box.innerHTML=`<div class="section-head"><span>Сегодня</span>
      <span class="muted">${recs.length} ${plural(recs.length,'запись','записи','записей')}${total?' · '+fmtTon(total):''}</span></div>
    <div class="card list-card">${recs.map(r=>recRow(r)).join('')}</div>`;
}

let saveGuard=0;
function saveRecord(){
  if(Date.now()-saveGuard<700) return;
  const name=cleanName(exInput.value);
  if(!name){ toast('Введите название упражнения'); exInput.focus(); return; }
  if(!checkLimits([['mReps','reps'],['mSets','sets'],['mWeight','weight'],['mTime','time']])) return;
  const reps=num($('#mReps').value), sets=num($('#mSets').value),
        weight=num($('#mWeight').value), time=minOut($('#mTime').value),
        notes=$('#mNotes').value.trim();
  if(!reps && !sets && !weight && !time && !notes){ toast('Заполните хотя бы одно поле'); return; }
  saveGuard=Date.now();

  let ex=exByName(name), createdEx=false;
  if(!ex){ ex={id:nid('ex'), name}; DB.exercises.push(ex); createdEx=true; }
  exInput.value=ex.name;

  const ts=Date.now();
  const wId=DB.active.wId || workoutFor(ts);
  const rec={id:nid('rec'), exId:ex.id, wId, ts, reps, sets, weight, time, notes};
  DB.records.push(rec);
  save();

  $('#mNotes').value='';
  if(document.activeElement && document.activeElement.blur) document.activeElement.blur();
  try{ navigator.vibrate && navigator.vibrate(30); }catch(e){}
  renderRecord();

  toast('Сохранено', 'Отменить', ()=>{
    DB.records=DB.records.filter(r=>r.id!==rec.id);
    if(createdEx && !DB.records.some(r=>r.exId===ex.id)) DB.exercises=DB.exercises.filter(e=>e.id!==ex.id);
    cleanupWorkouts(); save(); refresh();
    toast('Запись отменена');
  }, null, 'check');
}

/* ================== ТАЙМЕР ТРЕНИРОВКИ ================== */
let wInterval=null, stopBusy=false;

function onTimerBtn(){
  if(DB.active.wId){ $('#scroller').scrollTo({top:0,behavior:'smooth'}); toast('Тренировка уже идёт'); return; }
  startWorkout(false);
}
function startWorkout(silent){
  if(DB.active.wId) return;
  const w={id:nid('w'), start:Date.now(), end:null, timed:true, rest:0};
  DB.workouts.push(w);
  DB.active.wId=w.id;
  save();
  renderWorkoutBar();
  if(!silent) toast('Тренировка началась', null, null, null, 'play');
}
async function stopWorkout(){
  if(!DB.active.wId || stopBusy) return;
  stopBusy=true;
  const ok=await ask('Завершить тренировку?','Завершить');
  stopBusy=false;
  if(!ok || !DB.active.wId) return;
  if(DB.active.restEnd) cancelRest();
  const w=activeW();
  DB.active.wId=null;
  let had=false;
  if(w){ w.end=Date.now(); w.timed=true; had=DB.records.some(r=>r.wId===w.id); }
  cleanupWorkouts(); save();
  renderWorkoutBar(); refresh();
  toast(had ? `Тренировка завершена · ${fmtDur((w.end-w.start)/1000)}` : 'Пустая тренировка не сохранена', null, null, null, had?'flag':null);
}
function renderWorkoutBar(){
  const w=activeW(), bar=$('#timerBar'), btn=$('#btnTimer');
  if(!w){
    bar.classList.add('hidden'); btn.classList.remove('on');
    clearInterval(wInterval); wInterval=null;
    return;
  }
  bar.classList.remove('hidden'); btn.classList.add('on');
  tickWorkout();
  if(!wInterval) wInterval=setInterval(tickWorkout,1000);
}
function tickWorkout(){
  const w=activeW();
  if(!w){ renderWorkoutBar(); return; }
  $('#workoutTime').textContent=fmtClock((Date.now()-w.start)/1000);
  const n=DB.records.reduce((a,r)=>a+(r.wId===w.id?1:0),0);
  const parts=[`${n} ${plural(n,'запись','записи','записей')}`];
  if(w.rest) parts.push('отдых '+fmtDur(w.rest));
  $('#workoutSub').textContent=parts.join(' · ');
}

/* ================== ТАЙМЕР ОТДЫХА ================== */
let rInterval=null;

function startRest(sec){
  unlockAudio();
  if(DB.active.restEnd) cancelRest();
  if(!DB.active.wId) startWorkout(true);
  DB.active.restEnd=Date.now()+sec*1000;
  DB.active.restTotal=sec;
  save();
  showRest();
  requestWake();
}
function showRest(){
  $('#restBlock').classList.remove('hidden');
  clearInterval(rInterval);
  tickRest();
  rInterval=setInterval(tickRest,250);
}
function hideRest(){
  clearInterval(rInterval); rInterval=null;
  $('#restBlock').classList.add('hidden');
  $('#restProgress').style.width='0%';
  releaseWake();
}
function tickRest(){
  const end=DB.active.restEnd;
  if(!end){ hideRest(); return; }
  const leftMs=end-Date.now();
  if(leftMs<=0){ finishRest(leftMs>-15000); return; }
  $('#restTime').textContent=fmtClock(Math.ceil(leftMs/1000));
  const total=(DB.active.restTotal||1)*1000;
  $('#restProgress').style.width=Math.max(0,Math.min(100,(1-leftMs/total)*100))+'%';
}
function finishRest(notify){
  const w=activeW();
  if(w) w.rest=(w.rest||0)+(DB.active.restTotal||0);
  DB.active.restEnd=null; DB.active.restTotal=0;
  save(); hideRest(); renderWorkoutBar();
  if(notify) signalRestEnd();
}
// досрочная отмена — засчитываем фактически прошедшее время
function cancelRest(){
  const end=DB.active.restEnd;
  if(!end) return;
  const passed=Math.round((DB.active.restTotal||0)-Math.max(0,end-Date.now())/1000);
  const w=activeW();
  if(w && passed>0) w.rest=(w.rest||0)+passed;
  DB.active.restEnd=null; DB.active.restTotal=0;
  save(); hideRest(); renderWorkoutBar();
}
function addRest(sec){
  if(!DB.active.restEnd) return;
  DB.active.restEnd+=sec*1000;
  DB.active.restTotal+=sec;
  save(); tickRest();
}
function openCustomRest(){
  openModal(`<h2>Своё время отдыха</h2>
    <div class="grid2">
      <div><label for="crMin">Минуты</label><input id="crMin" inputmode="numeric" placeholder="0" data-enter="rest-custom-start"></div>
      <div><label for="crSec">Секунды</label><input id="crSec" inputmode="numeric" placeholder="0" data-enter="rest-custom-start"></div>
    </div>
    <div class="grid2" style="margin-top:16px">
      <button class="btn ghost" data-act="close-modal">Отмена</button>
      <button class="btn" data-act="rest-custom-start">Старт</button>
    </div>`);
  $('#crMin').focus();
}
function customRestStart(){
  const mi=$('#crMin'), si=$('#crSec');
  const rd=inp=>{ const t=String(inp.value||'').trim(); return t==='' ? 0 : (/^\d+$/.test(t) ? parseInt(t,10) : NaN); };
  const m=rd(mi), s=rd(si);
  const total=m*60+s;
  const badM=!isFinite(m), badS=!isFinite(s);
  const over=!badM && !badS && total>LIMITS.rest*60;
  markBad(mi, badM||over); markBad(si, badS||over);
  if(badM||badS){ toast('Введите целое число минут и секунд', null, null, 3500, 'alert'); return; }
  if(over){ toast('Отдых — не больше 600 мин', null, null, 3500, 'alert'); return; }
  if(total<=0){ toast('Введите время'); return; }
  closeModal();
  startRest(total);
}

/* ---- звук / вибрация / экран ---- */
let AC=null;
function unlockAudio(){
  try{
    if(!AC){ const C=window.AudioContext||window.webkitAudioContext; if(!C) return; AC=new C(); }
    if(AC.state==='suspended') AC.resume();
    const b=AC.createBuffer(1,1,22050), s=AC.createBufferSource();
    s.buffer=b; s.connect(AC.destination); s.start(0);
  }catch(e){}
}
document.addEventListener('touchend', unlockAudio, {once:true, passive:true});
function beep(){
  try{
    if(!AC) unlockAudio();
    if(!AC) return;
    if(AC.state==='suspended') AC.resume();
    const t0=AC.currentTime+0.05;
    [0,0.3,0.6].forEach(dt=>{
      const o=AC.createOscillator(), g=AC.createGain();
      o.type='sine'; o.frequency.value=880;
      g.gain.setValueAtTime(0.0001,t0+dt);
      g.gain.exponentialRampToValueAtTime(0.3,t0+dt+0.02);
      g.gain.exponentialRampToValueAtTime(0.0001,t0+dt+0.22);
      o.connect(g); g.connect(AC.destination);
      o.start(t0+dt); o.stop(t0+dt+0.25);
    });
  }catch(e){}
}
function signalRestEnd(){
  beep();
  try{ navigator.vibrate && navigator.vibrate([200,100,200]); }catch(e){}
  try{
    if(document.hidden && window.Notification && Notification.permission==='granted')
      new Notification('Отдых окончен',{body:'Пора к следующему подходу'});
  }catch(e){}
  toast('Отдых окончен — к следующему подходу', null, null, 5000, 'bell');
  document.body.classList.remove('flash'); void document.body.offsetWidth; document.body.classList.add('flash');
}
let wakeLock=null;
async function requestWake(){
  try{
    if(!wakeLock && 'wakeLock' in navigator && DB.active.restEnd && !document.hidden){
      wakeLock=await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release',()=>{ wakeLock=null; });
    }
  }catch(e){ wakeLock=null; }
}
function releaseWake(){ try{ if(wakeLock) wakeLock.release(); }catch(e){} wakeLock=null; }

/* ================== РЕДАКТИРОВАНИЕ ЗАПИСИ ================== */
function openRecEdit(id, fromW){
  const r=DB.records.find(x=>x.id===id);
  if(!r) return;
  const opts=DB.exercises.slice().sort((a,b)=>a.name.localeCompare(b.name,'ru'))
    .map(e=>`<option value="${e.id}"${e.id===r.exId?' selected':''}>${esc(e.name)}</option>`).join('');
  openModal(`<div class="sheet-head"><h2>Запись</h2><button class="icon-btn" data-act="rec-cancel" aria-label="Закрыть">${I('x')}</button></div>
    <label for="eEx">Упражнение</label>
    <select id="eEx">${opts}</select>
    <label for="eTs">Дата и время</label>
    <input id="eTs" type="datetime-local" value="${toInputDT(r.ts)}">
    <div class="grid2">
      <div><label for="eReps">Повторения</label><input id="eReps" inputmode="decimal" value="${esc(inVal(r.reps))}" placeholder="0"></div>
      <div><label for="eSets">Подходы</label><input id="eSets" inputmode="decimal" value="${esc(inVal(r.sets))}" placeholder="0"></div>
    </div>
    <div class="grid2">
      <div><label for="eWeight">Вес (кг)</label><input id="eWeight" inputmode="decimal" value="${esc(inVal(r.weight))}" placeholder="0"></div>
      <div><label for="eTime">Время (мин)</label><input id="eTime" inputmode="decimal" value="${esc(minIn(r.time))}" placeholder="0"></div>
    </div>
    <label for="eNotes">Заметки</label>
    <input id="eNotes" value="${esc(r.notes||'')}" placeholder="необязательно">
    <button class="btn big" style="margin-top:16px" data-act="rec-save" data-id="${r.id}">Сохранить</button>
    <div class="grid2" style="margin-top:10px">
      <button class="btn ghost" data-act="rec-toform" data-id="${r.id}">${I('repeat')}Повторить</button>
      <button class="btn danger" data-act="rec-del" data-id="${r.id}">${I('trash')}Удалить</button>
    </div>`);
  editReturnW=fromW||null;
}
function afterRecEdit(){
  const w=editReturnW;
  editReturnW=null;
  if(w && wById(w)) openWorkout(w); else closeModal();
  refresh();
}
function reattach(r){
  const aw=activeW();
  if(aw && r.ts>=aw.start-60000 && r.ts<=Date.now()+60000){ r.wId=aw.id; return; }
  const w=wById(r.wId);
  if(w && !isActive(w) && dayKey(w.start)===dayKey(r.ts)) return;
  r.wId=workoutFor(r.ts);
}
function saveRecEdit(id){
  const r=DB.records.find(x=>x.id===id);
  if(!r){ closeModal(); return; }
  let ts=fromInputDT($('#eTs').value);
  if(!ts){ toast('Укажите дату и время'); return; }
  if(!checkLimits([['eReps','reps'],['eSets','sets'],['eWeight','weight'],['eTime','time']])) return;
  const vals={
    reps:num($('#eReps').value), sets:num($('#eSets').value),
    weight:num($('#eWeight').value), time:minOut($('#eTime').value),
    notes:$('#eNotes').value.trim()
  };
  if(!vals.reps && !vals.sets && !vals.weight && !vals.time && !vals.notes){ toast('Заполните хотя бы одно поле'); return; }
  const exId=+$('#eEx').value;
  if(exById(exId)) r.exId=exId;
  Object.assign(r, vals);
  if(Math.floor(ts/60000)!==Math.floor(r.ts/60000)){ r.ts=ts; reattach(r); }
  cleanupWorkouts(); save();
  afterRecEdit();
  toast('Сохранено');
}
async function deleteRec(id){
  if(!DB.records.some(x=>x.id===id)) return;
  if(!await ask('Удалить эту запись?','Удалить',true)) return;
  DB.records=DB.records.filter(x=>x.id!==id);
  cleanupWorkouts(); save();
  afterRecEdit();
  toast('Запись удалена');
}
function recToForm(id){
  const r=DB.records.find(x=>x.id===id);
  if(!r) return;
  const ex=exById(r.exId);
  closeModal();
  go('record');
  exInput.value=ex?ex.name:'';
  setVal('mReps',r.reps); setVal('mSets',r.sets); setVal('mWeight',r.weight); $('#mTime').value=minIn(r.time);
  $('#mNotes').value='';
  renderLastHint();
}

/* ================== УПРАЖНЕНИЯ ================== */
$('#exSearch').addEventListener('input', renderExList);

function renderExList(){
  const box=$('#exList');
  if(!DB.exercises.length){
    box.innerHTML='<div class="empty">Пока нет упражнений.<br>Нажмите + или просто сохраните первую запись.</div>';
    return;
  }
  const q=normKey($('#exSearch').value);
  const meta=exMeta();
  const list=DB.exercises.filter(e=>!q || normKey(e.name).includes(q)).sort((a,b)=>
    ((meta.get(b.id)||{}).last||0)-((meta.get(a.id)||{}).last||0) || a.name.localeCompare(b.name,'ru'));
  if(!list.length){ box.innerHTML='<div class="empty">Ничего не найдено</div>'; return; }
  box.innerHTML=list.map(e=>{
    const x=meta.get(e.id);
    const sub=x ? [`${x.count} ${plural(x.count,'запись','записи','записей')}`, 'посл. '+relDay(x.last), x.maxW?'макс '+fmtNum(x.maxW)+' кг':'']
      .filter(Boolean).join(' · ') : 'нет записей';
    return `<div class="ex-item" data-act="ex-open" data-id="${e.id}">
      <div class="ex-text"><div class="name">${esc(e.name)}</div><div class="count">${sub}</div></div>
      <div class="chev">${I('chev')}</div></div>`;
  }).join('');
}

function openAddEx(){
  openModal(`<h2>Новое упражнение</h2>
    <input id="newExName" placeholder="Например: Жим лёжа" autocomplete="off" autocapitalize="sentences" data-enter="ex-add-save">
    <div class="grid2" style="margin-top:14px">
      <button class="btn ghost" data-act="close-modal">Отмена</button>
      <button class="btn" data-act="ex-add-save">Создать</button>
    </div>`);
  $('#newExName').focus();
}
function createEx(){
  const name=cleanName($('#newExName').value);
  if(!name){ toast('Введите название'); return; }
  if(exByName(name)){ toast('Такое упражнение уже есть'); return; }
  DB.exercises.push({id:nid('ex'), name});
  save(); closeModal(); renderExList();
  toast('Упражнение добавлено');
}

/* ---- история упражнения ---- */
let histEx=null;
function openHistory(id){ histEx=id; showView('history'); renderHistory(); }

function renderHistory(){
  const ex=exById(histEx);
  if(!ex){ go('ex'); return; }
  $('#histTitle').textContent=ex.name;
  const box=$('#histList');
  const recs=DB.records.filter(r=>r.exId===ex.id).sort((a,b)=>b.ts-a.ts);
  if(!recs.length){ box.innerHTML=`<div class="empty">Записей пока нет<br><br><button class="btn" data-act="ex-record">${I('pen')}Записать подход</button></div>`; return; }

  const maxW=recs.reduce((m,r)=>Math.max(m,r.weight||0),0);
  const maxT=recs.reduce((m,r)=>Math.max(m,ton(r)),0);
  const maxR=recs.reduce((m,r)=>Math.max(m,r.reps||0),0);
  let html=`<div class="stats-summary">
    <div class="stats-box"><div class="lbl">Записей</div><div class="val">${recs.length}</div></div>
    <div class="stats-box"><div class="lbl">${I('trophy','sm')}Макс. вес</div><div class="val">${maxW?fmtNum(maxW)+' кг':'—'}</div></div>
    <div class="stats-box"><div class="lbl">${I('dumbbell','sm')}Лучший тоннаж</div><div class="val">${maxT?fmtTon(maxT):'—'}</div></div>
    <div class="stats-box"><div class="lbl">Макс. повторов</div><div class="val">${maxR?fmtNum(maxR):'—'}</div></div>
  </div>`;
  html+=sparkline(recs);

  html+='<div class="card list-card">';
  let lastDay='';
  recs.forEach(r=>{
    const dk=dayKey(r.ts);
    if(dk!==lastDay){
      const d=new Date(r.ts);
      html+=`<div class="list-day">${WD[d.getDay()]}, ${fmtDate(r.ts)}</div>`;
      lastDay=dk;
    }
    const t=ton(r);
    const pr=maxW && r.weight===maxW;
    html+=`<div class="rec-row" data-act="rec-edit" data-id="${r.id}">
      <div class="rec-main">
        <div class="rec-name">${esc(describe(r))||'—'}${pr?' '+I('trophy','pr'):''}</div>
        <div class="rec-desc">${t?'тоннаж '+fmtTon(t):''}${r.notes?` <span class="note">«${esc(r.notes)}»</span>`:''}</div>
      </div>
      <div class="rec-side">${fmtTime(r.ts)}</div>
    </div>`;
  });
  html+='</div>';
  box.innerHTML=html;
}

// мини-график прогресса по дням (макс. вес, иначе повторы/время)
function sparkline(recs){
  const metric = recs.some(r=>r.weight) ? ['weight','Макс. вес по дням, кг']
               : recs.some(r=>r.reps)   ? ['reps','Макс. повторов по дням']
               : recs.some(r=>r.time)   ? ['time','Макс. время по дням, мин'] : null;
  if(!metric) return '';
  const byDay=new Map();
  recs.forEach(r=>{
    let v=r[metric[0]]; if(!v) return; if(metric[0]==='time') v=round(v/60,2);
    const k=dayKey(r.ts);
    byDay.set(k, Math.max(byDay.get(k)||0, v));
  });
  const pts=[...byDay.entries()].sort((a,b)=>a[0]<b[0]?-1:1).map(x=>x[1]).slice(-30);
  if(pts.length<2) return '';
  const W=300,H=70,P=6;
  const mn=Math.min(...pts), mx=Math.max(...pts);
  const xy=pts.map((v,i)=>[
    P+i*(W-2*P)/(pts.length-1),
    H-P-(mx===mn?0.5:(v-mn)/(mx-mn))*(H-2*P)
  ]);
  const line=xy.map(p=>p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ');
  const last=xy[xy.length-1];
  return `<div class="card spark">
    <div class="muted">${metric[1]}</div>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <polyline points="${line}" fill="none" stroke="#4f8cff" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
      <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="3" fill="#4f8cff"/>
    </svg>
    <div class="spark-range"><span>мин ${fmtNum(mn)}</span><span>${pts.length} дн.</span><span>макс ${fmtNum(mx)}</span></div>
  </div>`;
}

function openExMenu(){
  const ex=exById(histEx); if(!ex) return;
  openModal(`<h2>${esc(ex.name)}</h2>
    <button class="btn big" data-act="ex-record">${I('pen')}Записать подход</button>
    <button class="btn ghost big" data-act="ex-rename">${I('edit')}Переименовать</button>
    <button class="btn danger big" data-act="ex-del">${I('trash')}Удалить упражнение</button>
    <button class="btn ghost big" data-act="close-modal">Отмена</button>`);
}
function recordEx(){
  const ex=exById(histEx); if(!ex) return;
  closeModal();
  go('record');
  exInput.value=ex.name;
  clearForm(false);
  renderLastHint();
}
function openRename(){
  const ex=exById(histEx); if(!ex) return;
  openModal(`<h2>Переименовать</h2>
    <input id="renName" value="${esc(ex.name)}" autocomplete="off" autocapitalize="sentences" data-enter="ex-rename-save">
    <p class="muted" style="margin:8px 2px 0">Если ввести название существующего упражнения — записи можно будет объединить.</p>
    <div class="grid2" style="margin-top:14px">
      <button class="btn ghost" data-act="close-modal">Отмена</button>
      <button class="btn" data-act="ex-rename-save">Сохранить</button>
    </div>`);
  const i=$('#renName'); i.focus(); try{ i.setSelectionRange(0,i.value.length); }catch(e){}
}
async function renameEx(){
  const ex=exById(histEx); if(!ex) return;
  const name=cleanName($('#renName').value);
  if(!name){ toast('Введите название'); return; }
  const formHad=normKey(exInput.value)===normKey(ex.name);
  const other=exByName(name);
  if(other && other.id!==ex.id){
    const n=DB.records.filter(r=>r.exId===ex.id).length;
    if(!await ask(`Упражнение «${esc(other.name)}» уже есть. Объединить? ${n} ${plural(n,'запись','записи','записей')} из «${esc(ex.name)}» перейдут в него.`,'Объединить')) return;
    DB.records.forEach(r=>{ if(r.exId===ex.id) r.exId=other.id; });
    DB.exercises=DB.exercises.filter(e=>e.id!==ex.id);
    save(); closeModal();
    if(formHad){ exInput.value=other.name; }
    openHistory(other.id);
    toast('Упражнения объединены');
    return;
  }
  ex.name=name;
  save(); closeModal();
  if(formHad) exInput.value=name;
  renderHistory();
  toast('Переименовано');
}
async function deleteEx(){
  const ex=exById(histEx); if(!ex) return;
  const n=DB.records.filter(r=>r.exId===ex.id).length;
  if(!await ask(`Удалить упражнение «${esc(ex.name)}»${n?` и ${plural(n,'его','все его','все его')} ${n} ${plural(n,'запись','записи','записей')}`:''}? Отменить будет нельзя.`,'Удалить',true)) return;
  DB.records=DB.records.filter(r=>r.exId!==ex.id);
  DB.exercises=DB.exercises.filter(e=>e.id!==ex.id);
  cleanupWorkouts(); save();
  closeModal();
  if(normKey(exInput.value)===normKey(ex.name)){ exInput.value=''; renderLastHint(); }
  histEx=null;
  go('ex');
  renderWorkoutBar();
  toast('Упражнение удалено');
}

/* ================== ТРЕНИРОВКА (детали) ================== */
function openWorkout(id){
  const w=wById(id);
  if(!w){ closeModal(); return; }
  const recs=recsOfW(id);
  const dur=wDur(w);
  const t=recs.reduce((a,r)=>a+ton(r),0);
  const d=new Date(w.start);
  const order=[], by=new Map();
  recs.forEach(r=>{ if(!by.has(r.exId)){ by.set(r.exId,[]); order.push(r.exId); } by.get(r.exId).push(r); });

  let html=`<div class="sheet-head"><h2>Тренировка #${workoutNumber(id)}</h2><button class="icon-btn" data-act="close-modal" aria-label="Закрыть">${I('x')}</button></div>
    <div class="muted" style="margin-bottom:12px">${WD[d.getDay()]}, ${fmtDate(w.start)} · ${fmtTime(w.start)}${isActive(w)?' · <span class="badge">идёт</span>':''}</div>
    <div class="stats-summary">
      <div class="stats-box"><div class="lbl">${I('clock','sm')}Длительность</div><div class="val">${dur?fmtDur(dur):'—'}</div></div>
      <div class="stats-box"><div class="lbl">${I('pause','sm')}Отдых</div><div class="val">${w.rest?fmtDur(w.rest):'—'}</div></div>
      <div class="stats-box"><div class="lbl">${I('dumbbell','sm')}Тоннаж</div><div class="val">${t?fmtTon(t):'—'}</div></div>
      <div class="stats-box"><div class="lbl">Упражнений</div><div class="val">${order.length}</div></div>
    </div>`;
  html+=order.map(exId=>{
    const ex=exById(exId), rs=by.get(exId);
    const tt=rs.reduce((a,r)=>a+ton(r),0);
    return `<div class="ex-block">
      <div class="ex-block-title"><span>${esc(ex?ex.name:'?')}</span><span class="muted">${tt?fmtTon(tt):''}</span></div>
      ${rs.map(r=>`<div class="set-line" data-act="rec-edit" data-id="${r.id}" data-w="${w.id}"><span class="num">${fmtTime(r.ts)}</span>${esc(describe(r))||'—'}${r.notes?`<span class="note">«${esc(r.notes)}»</span>`:''}</div>`).join('')}
    </div>`;
  }).join('');
  if(!recs.length) html+='<div class="empty">Записей пока нет</div>';
  html+=`<div class="grid2" style="margin-top:16px">
    ${isActive(w)?'<button class="btn ghost" data-act="close-modal">Закрыть</button>':`<button class="btn ghost" data-act="w-edit" data-id="${w.id}">${I('edit')}Дата и время</button>`}
    <button class="btn danger" data-act="w-del" data-id="${w.id}">${I('trash')}Удалить</button>
  </div>`;
  openModal(html);
}
function openWorkoutEdit(id){
  const w=wById(id);
  if(!w || isActive(w)) return;
  const dur=wDur(w);
  openModal(`<h2>Тренировка #${workoutNumber(id)}</h2>
    <label for="wStart">Начало</label>
    <input id="wStart" type="datetime-local" value="${toInputDT(w.start)}">
    <p class="muted" style="margin:6px 2px 0">При смене даты записи тренировки переносятся вместе с ней.</p>
    <div class="grid2">
      <div><label for="wDur">Длительность, мин</label><input id="wDur" inputmode="decimal" value="${dur?esc(inVal(round(dur/60,1))):''}" placeholder="—"></div>
      <div><label for="wRest">Отдых, мин</label><input id="wRest" inputmode="decimal" value="${w.rest?esc(inVal(round(w.rest/60,1))):''}" placeholder="—"></div>
    </div>
    <div class="grid2" style="margin-top:16px">
      <button class="btn ghost" data-act="w-open" data-id="${w.id}">Отмена</button>
      <button class="btn" data-act="w-edit-save" data-id="${w.id}">Сохранить</button>
    </div>`);
}
function saveWorkoutEdit(id){
  const w=wById(id);
  if(!w){ closeModal(); return; }
  const start=fromInputDT($('#wStart').value);
  if(!start){ toast('Укажите дату и время'); return; }
  const dur=num($('#wDur').value), rest=num($('#wRest').value);
  const newStart = Math.floor(start/60000)===Math.floor(w.start/60000) ? w.start : start;
  const shift=newStart-w.start;
  if(shift) DB.records.forEach(r=>{ if(r.wId===w.id) r.ts+=shift; });
  w.start=newStart;
  if(dur && dur>0){ w.timed=true; w.end=w.start+Math.round(dur*60000); }
  else { w.timed=false; w.end=null; }
  w.rest = rest && rest>0 ? Math.round(rest*60) : 0;
  cleanupWorkouts(); save();
  openWorkout(w.id); refresh();
  toast('Сохранено');
}
async function deleteWorkout(id){
  const w=wById(id); if(!w) return;
  const n=DB.records.filter(r=>r.wId===id).length;
  if(!await ask(`Удалить тренировку${n?` и ${n} ${plural(n,'запись','записи','записей')}`:''}? Отменить будет нельзя.`,'Удалить',true)) return;
  if(isActive(w)){
    DB.active.restEnd=null; DB.active.restTotal=0; hideRest();
    DB.active.wId=null;
  }
  DB.records=DB.records.filter(r=>r.wId!==id);
  DB.workouts=DB.workouts.filter(x=>x.id!==id);
  save(); closeModal(); renderWorkoutBar(); refresh();
  toast('Тренировка удалена');
}

/* ================== СТАТИСТИКА ================== */
let statsMode='cards', tblEx='all', tblPeriod='all';

function renderStats(){
  const top=$('#statsTop'), body=$('#statsBody'), warn=$('#statsWarn');
  $$('#statsSeg button').forEach(b=>b.classList.toggle('active', b.dataset.mode===statsMode));
  warn.innerHTML = (DB.records.length && (!DB.lastExport || Date.now()-DB.lastExport>14*DAY))
    ? `<div class="warn-line" data-act="export">${I('alert')}<span>${DB.lastExport?'Последняя резервная копия '+fmtDate(DB.lastExport):'Резервной копии ещё нет'} — нажмите, чтобы выгрузить таблицу</span></div>` : '';

  const ws=sortedWorkouts();
  if(!ws.length){
    top.innerHTML='';
    $('#statsSeg').classList.add('hidden');
    body.innerHTML='<div class="empty">Пока нет тренировок.<br>Сохраните первую запись или загрузите таблицу.</div>';
    return;
  }
  $('#statsSeg').classList.remove('hidden');
  const finished=ws.filter(w=>!isActive(w) && w.timed && w.end);
  const avg=finished.length ? finished.reduce((a,w)=>a+wDur(w),0)/finished.length : 0;
  const month=ws.filter(w=>w.start>Date.now()-30*DAY).length;
  const totalTon=DB.records.reduce((a,r)=>a+ton(r),0);
  top.innerHTML=`<div class="stats-summary">
    <div class="stats-box"><div class="lbl">Тренировок</div><div class="val">${ws.length}</div></div>
    <div class="stats-box"><div class="lbl">За 30 дней</div><div class="val">${month}</div></div>
    <div class="stats-box"><div class="lbl">${I('clock','sm')}Средняя длит.</div><div class="val">${avg?fmtDur(avg):'—'}</div></div>
    <div class="stats-box"><div class="lbl">${I('dumbbell','sm')}Тоннаж всего</div><div class="val">${totalTon?fmtTon(totalTon):'—'}</div></div>
  </div>`;
  body.innerHTML = statsMode==='table' ? tableHtml(ws) : cardsHtml(ws);
}

function cardsHtml(ws){
  let out='', lastM='';
  ws.map((w,i)=>({w,n:i+1})).reverse().forEach(({w,n})=>{
    const d=new Date(w.start);
    const mk=MONTHS[d.getMonth()]+' '+d.getFullYear();
    if(mk!==lastM){ out+=`<div class="month-head">${mk}</div>`; lastM=mk; }
    const recs=recsOfW(w.id);
    const names=[]; recs.forEach(r=>{ const e=exById(r.exId); if(e && !names.includes(e.name)) names.push(e.name); });
    const dur=wDur(w), t=recs.reduce((a,r)=>a+ton(r),0);
    const meta=[`${recs.length} ${plural(recs.length,'запись','записи','записей')}`];
    meta.push(I('clock','sm')+(dur?fmtDur(dur):'—'));
    if(w.rest) meta.push(I('pause','sm')+fmtDur(w.rest));
    if(t) meta.push(I('dumbbell','sm')+fmtTon(t));
    out+=`<div class="workout-card${isActive(w)?' live':''}" data-act="w-open" data-id="${w.id}">
      <div class="workout-head">
        <div class="workout-date">${WD[d.getDay()]}, ${fmtDM(w.start)} · ${fmtTime(w.start)}</div>
        <div class="workout-num">${isActive(w)?'<span class="badge">идёт</span>':'#'+n}</div>
      </div>
      <div class="workout-ex">${esc(names.join(', '))||'—'}</div>
      <div class="workout-meta">${meta.join(' · ')}</div>
    </div>`;
  });
  return out;
}

function tableHtml(ws){
  if(tblEx!=='all' && !exById(+tblEx)) tblEx='all';
  const exOpts=DB.exercises.slice().sort((a,b)=>a.name.localeCompare(b.name,'ru'))
    .map(e=>`<option value="${e.id}"${String(e.id)===tblEx?' selected':''}>${esc(e.name)}</option>`).join('');
  const per=[['all','Всё время'],['7','7 дней'],['30','30 дней'],['90','3 месяца'],['365','Год']]
    .map(([v,l])=>`<option value="${v}"${v===tblPeriod?' selected':''}>${l}</option>`).join('');
  const filters=`<div class="filters">
    <select data-filter="ex"><option value="all">Все упражнения</option>${exOpts}</select>
    <select data-filter="period">${per}</select>
  </div>`;
  const since = tblPeriod==='all' ? 0 : Date.now()-(+tblPeriod)*DAY;
  let rows='', shown=0;
  ws.map((w,i)=>({w,n:i+1})).reverse().forEach(({w,n})=>{
    if(w.start<since) return;
    let recs=recsOfW(w.id);
    if(tblEx!=='all') recs=recs.filter(r=>r.exId===+tblEx);
    if(!recs.length) return;
    shown++;
    const d=new Date(w.start), dur=wDur(w), t=recs.reduce((a,r)=>a+ton(r),0);
    rows+=`<tr class="grp" data-act="w-open" data-id="${w.id}"><td colspan="4">
      <b>${WD[d.getDay()]}, ${fmtDate(w.start)}</b> <span class="muted">· #${n} · ${fmtTime(w.start)}${dur?' · '+I('clock','sm')+fmtDur(dur):''}${w.rest?' · '+I('pause','sm')+fmtDur(w.rest):''}${t?' · '+I('dumbbell','sm')+fmtTon(t):''}</span>
    </td></tr>`;
    recs.forEach(r=>{
      const ex=exById(r.exId);
      const sub=[];
      if(r.time) sub.push(fmtDur(r.time));
      if(r.notes) sub.push(`<span class="note">«${esc(r.notes)}»</span>`);
      const tt=ton(r);
      rows+=`<tr data-act="rec-edit" data-id="${r.id}">
        <td><div class="t-name">${esc(ex?ex.name:'?')}</div>${sub.length?`<div class="t-sub">${sub.join(' · ')}</div>`:''}</td>
        <td class="n">${r.weight?fmtNum(r.weight):'—'}</td>
        <td class="n">${rxs(r)}</td>
        <td class="n">${tt?fmtNum(round(tt,1)):'—'}</td>
      </tr>`;
    });
  });
  if(!shown) return filters+'<div class="empty">Нет записей за выбранный период</div>';
  return filters+`<table class="log-table">
    <thead><tr><th>Упражнение</th><th class="n">Вес</th><th class="n">Пов×Под</th><th class="n">Тоннаж</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

/* ================== ДАННЫЕ: ВЫГРУЗКА ================== */
function openDataSheet(){
  const nW=sortedWorkouts().length;
  openModal(`<div class="sheet-head"><h2>Данные</h2><button class="icon-btn" data-act="close-modal" aria-label="Закрыть">${I('x')}</button></div>
    <p class="muted">Всё хранится только на этом устройстве: ${nW} ${plural(nW,'тренировка','тренировки','тренировок')}, ${DB.records.length} ${plural(DB.records.length,'запись','записи','записей')}, ${DB.exercises.length} ${plural(DB.exercises.length,'упражнение','упражнения','упражнений')}.<br>
    ${DB.lastExport?'Последняя выгрузка: '+fmtDate(DB.lastExport)+' '+fmtTime(DB.lastExport):'Выгрузок ещё не было.'}</p>
    <button class="btn big" data-act="export">${I('upload')}Выгрузить таблицу</button>
    <button class="btn ghost big" data-act="import">${I('download')}Загрузить таблицу</button>
    <button class="btn danger big" data-act="clear-all">${I('trash')}Удалить все данные</button>`);
}

function dec(v){ return v==null||v==='' ? '' : String(v).replace('.',','); }
const EXPORT_HEAD=['Дата','День','Время','Тренировка','Упражнение','Повторения','Подходы','Вес, кг','Тоннаж, кг','Время, мин','Заметки','Начало тренировки','Длительность, мин','Отдых, мин'];

function buildRows(){
  const rows=[EXPORT_HEAD];
  let n=0;
  DB.workouts.slice().sort((a,b)=>a.start-b.start).forEach(w=>{
    const recs=recsOfW(w.id);
    if(!recs.length) return;
    n++;
    const dur=isActive(w) ? 0 : wDur(w);
    recs.forEach((r,j)=>{
      const ex=exById(r.exId), d=new Date(r.ts), t=ton(r);
      rows.push([
        fmtDate(r.ts), WD[d.getDay()], fmtTime(r.ts), n, ex?ex.name:'?',
        dec(r.reps), dec(r.sets), dec(r.weight), t?dec(round(t,2)):'', r.time?dec(round(r.time/60,2)):'', r.notes||'',
        j===0 ? fmtTime(w.start) : '',
        j===0 && dur ? dec(round(dur/60,1)) : '',
        j===0 && w.rest ? dec(round(w.rest/60,1)) : ''
      ]);
    });
  });
  // упражнения без записей — чтобы список тоже восстановился
  const used=new Set(DB.records.map(r=>r.exId));
  DB.exercises.filter(e=>!used.has(e.id)).forEach(e=>rows.push(['','','','',e.name,'','','','','','','','','']));
  return rows;
}
function toDelimited(rows, sep){
  return rows.map(r=>r.map(c=>{
    let s=String(c==null?'':c);
    if(sep==='\t') s=s.replace(/[\t\r\n]+/g,' ');
    if(s.includes(sep) || /["\r\n]/.test(s) || /^\s|\s$/.test(s)) s='"'+s.replace(/"/g,'""')+'"';
    return s;
  }).join(sep)).join('\r\n');
}
function exportName(){ return `Тренировки_${dayKey(Date.now())}.csv`; }
function canShareFiles(){
  try{ return !!(navigator.share && navigator.canShare && navigator.canShare({files:[new File(['x'],'t.csv',{type:'text/csv'})]})); }
  catch(e){ return false; }
}
function markExported(){ DB.lastExport=Date.now(); save(); if(curView==='stats') renderStats(); }

function openExport(){
  if(!DB.records.length && !DB.exercises.length){ toast('Пока нечего выгружать'); return; }
  const nW=sortedWorkouts().length, nR=DB.records.length;
  const share=canShareFiles();
  openModal(`<div class="sheet-head"><h2>Выгрузить таблицу</h2><button class="icon-btn" data-act="close-modal" aria-label="Закрыть">${I('x')}</button></div>
    <p class="muted">${nW} ${plural(nW,'тренировка','тренировки','тренировок')} · ${nR} ${plural(nR,'запись','записи','записей')}.
    Файл CSV открывается в Excel, Numbers и Google Таблицах: одна строка — одно упражнение, тренировки идут по порядку с номером, датой, днём недели и тоннажем. Этот же файл потом можно загрузить обратно — это и резервная копия.</p>
    ${share?'<button class="btn big" data-act="export-share">'+I('upload')+'Сохранить в «Файлы» / отправить</button>':''}
    <button class="btn${share?' ghost':''} big" data-act="export-copy">${I('copy')}Скопировать таблицу</button>
    <button class="btn ghost big" data-act="export-download">${I('download')}Скачать файл</button>
    <p class="muted" style="margin-top:12px">«Скопировать» — вставка в Numbers / Excel / Google Таблицы сразу разложится по ячейкам.</p>`);
}
async function shareExport(){
  const name=exportName();
  const file=new File(['\ufeff'+toDelimited(buildRows(),';')], name, {type:'text/csv'});
  try{
    await navigator.share({files:[file], title:name});
    markExported(); closeModal(); toast('Готово');
  }catch(e){
    if(e && e.name==='AbortError') return;
    toast('Не получилось — попробуйте «Скопировать таблицу»');
  }
}
function downloadExport(){
  try{
    const blob=new Blob(['\ufeff'+toDelimited(buildRows(),';')], {type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url; a.download=exportName(); a.rel='noopener';
    document.body.appendChild(a); a.click();
    setTimeout(()=>{ a.remove(); URL.revokeObjectURL(url); }, 5000);
    markExported();
    toast('Если файл не появился — используйте другой способ', null, null, 4000);
  }catch(e){
    toast('Скачивание недоступно — используйте «Скопировать таблицу»');
  }
}
async function copyExport(){
  const text=toDelimited(buildRows(),'\t');
  if(await copyText(text)){ markExported(); closeModal(); toast('Скопировано — вставьте в таблицу или в Заметки', null, null, null, 'check'); return; }
  openModal(`<h2>Скопируйте вручную</h2>
    <textarea readonly style="height:50vh;font-family:ui-monospace,monospace;font-size:12px">${esc(text)}</textarea>
    <p class="muted">Нажмите и удерживайте текст → «Выбрать все» → «Скопировать».</p>
    <button class="btn ghost big" data-act="close-modal">Закрыть</button>`);
}
async function copyText(t){
  try{
    if(navigator.clipboard && navigator.clipboard.writeText){ await navigator.clipboard.writeText(t); return true; }
  }catch(e){}
  try{
    const ta=document.createElement('textarea');
    ta.value=t; ta.setAttribute('readonly','');
    ta.style.cssText='position:fixed;top:0;left:0;opacity:0;font-size:16px';
    document.body.appendChild(ta);
    ta.focus(); ta.select(); ta.setSelectionRange(0,t.length);
    const ok=document.execCommand('copy');
    ta.remove();
    return ok;
  }catch(e){ return false; }
}

/* ================== ДАННЫЕ: ЗАГРУЗКА ================== */
let pendingImport=null;

function openImport(){
  openModal(`<div class="sheet-head"><h2>Загрузить таблицу</h2><button class="icon-btn" data-act="close-modal" aria-label="Закрыть">${I('x')}</button></div>
    <p class="muted">Подходит CSV, выгруженный из этого трекера (и из старой версии), а также своя таблица с колонками
    <b>Дата</b>, <b>Упражнение</b>, <b>Повторения</b>, <b>Подходы</b>, <b>Вес</b> — остальные колонки по желанию. Порядок колонок не важен.</p>
    <div class="btn big file-btn">${I('folder')}Выбрать файл
      <input type="file" id="importFile" accept=".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values">
    </div>
    <label for="importText">или вставьте ячейки таблицы</label>
    <textarea id="importText" placeholder="Скопируйте строки в Numbers / Excel вместе со строкой заголовков и вставьте сюда"></textarea>
    <button class="btn ghost big" data-act="import-text">Загрузить из текста</button>`);
}
async function onImportFile(inp){
  const f=inp.files && inp.files[0];
  if(!f) return;
  try{
    const text=await readFileText(f);
    inp.value='';
    handleImportText(text);
  }catch(err){
    inp.value='';
    ask(esc(err && err.message || 'Не удалось прочитать файл'),'OK',false,null);
  }
}
async function readFileText(f){
  let buf;
  if(f.arrayBuffer) buf=await f.arrayBuffer();
  else buf=await new Promise((res,rej)=>{ const fr=new FileReader(); fr.onload=()=>res(fr.result); fr.onerror=()=>rej(fr.error); fr.readAsArrayBuffer(f); });
  const b=new Uint8Array(buf);
  if((b[0]===0x50&&b[1]===0x4B) || (b[0]===0xD0&&b[1]===0xCF))
    throw new Error('Это файл Excel / Numbers, а не CSV. Экспортируйте таблицу в CSV (Файл → Экспорт → CSV) или скопируйте ячейки и вставьте текстом.');
  if(b[0]===0xFF&&b[1]===0xFE) return new TextDecoder('utf-16le').decode(b);
  if(b[0]===0xFE&&b[1]===0xFF) return new TextDecoder('utf-16be').decode(b);
  try{ return new TextDecoder('utf-8',{fatal:true}).decode(b); }
  catch(e){
    try{ return new TextDecoder('windows-1251').decode(b); }   // CSV из Excel под Windows
    catch(e2){ return new TextDecoder('utf-8').decode(b); }
  }
}
function importFromTextarea(){
  const t=$('#importText') ? $('#importText').value : '';
  if(!t.trim()){ toast('Вставьте текст таблицы'); return; }
  handleImportText(t);
}

// CSV/TSV → массив строк (разделитель определяется автоматически)
function parseDelimited(text){
  text=String(text).replace(/^\ufeff/,'');
  const first=(text.split(/\r?\n/).find(l=>l.trim())||'');
  const count=ch=>first.split(ch).length-1;
  const sep=['\t',';',','].reduce((best,c)=>count(c)>count(best)?c:best, ';');
  const rows=[]; let row=[], cell='', q=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(q){
      if(c==='"'){ if(text[i+1]==='"'){ cell+='"'; i++; } else q=false; }
      else cell+=c;
    }
    else if(c==='"' && cell.trim()===''){ q=true; cell=''; }
    else if(c===sep){ row.push(cell); cell=''; }
    else if(c==='\n'){ row.push(cell); rows.push(row); row=[]; cell=''; }
    else if(c==='\r'){ /* пропуск */ }
    else cell+=c;
  }
  if(cell!=='' || row.length){ row.push(cell); rows.push(row); }
  return rows;
}

function normHead(s){ return String(s==null?'':s).replace(/^\ufeff/,'').trim().toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' '); }
function headKey(h){
  if(!h) return null;
  if(h.startsWith('начало')) return 'wstart';
  if(h.startsWith('длительн')) return 'dur';
  if(h.startsWith('отдых')) return 'rest';
  if(h.startsWith('тоннаж') || h.startsWith('день')) return null;
  if(h.startsWith('время') && /сек|мин/.test(h)) return 'time';
  if(h.startsWith('время')) return 'clock';
  if(h.startsWith('дата')) return 'date';
  if(h.startsWith('тренировк') || h==='№' || h==='#' || h==='n') return 'wnum';
  if(h.startsWith('упражн')) return 'ex';
  if(h.startsWith('повтор') || h.startsWith('количеств') || h==='кол-во') return 'reps';
  if(h.startsWith('подход')) return 'sets';
  if(h.startsWith('вес')) return 'weight';
  if(h.startsWith('замет') || h.startsWith('коммент')) return 'notes';
  return null;
}
function parseDay(s){
  s=String(s).trim();
  let m;
  const mk=(y,mo,d)=> (mo>=1&&mo<=12&&d>=1&&d<=31) ? {y,m:mo,d} : null;
  if((m=s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/))) return mk(+m[1],+m[2],+m[3]);
  if((m=s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/))){
    let d=+m[1], mo=+m[2], y=+m[3];
    if(y<100) y+=2000;
    if(mo>12 && d<=12){ const t=d; d=mo; mo=t; }   // формат М/Д/Г
    return mk(y,mo,d);
  }
  if(/^\d{5}([.,]\d+)?$/.test(s)){                 // серийная дата Excel
    const v=parseFloat(s.replace(',','.'));
    if(v>20000 && v<80000){ const d=new Date(Date.UTC(1899,11,30)+Math.floor(v)*DAY); return mk(d.getUTCFullYear(), d.getUTCMonth()+1, d.getUTCDate()); }
  }
  return null;
}
function parseClock(s){
  const m=String(s||'').match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if(!m || +m[1]>23 || +m[2]>59) return null;
  return {h:+m[1], mi:+m[2], s:+(m[3]||0)};
}
function dayNum(day){ return Math.round(Date.UTC(day.y,day.m-1,day.d)/DAY); }

function interpret(rows){
  const hi=rows.findIndex(r=>r.some(c=>normHead(c).startsWith('упражн')));
  if(hi<0) throw new Error('Не найдена строка заголовков. В таблице должна быть колонка «Упражнение» и, для записей, колонка «Дата».');
  const head=rows[hi].map(normHead);
  const col={}, unit={};
  head.forEach((h,i)=>{
    const k=headKey(h);
    if(k && col[k]===undefined){ col[k]=i; unit[k]= /сек/.test(h)?1 : /мин/.test(h)?60 : /час/.test(h)?3600 : null; }
  });
  const durU=unit.dur||60, restU=unit.rest||60, timeU=unit.time||1;

  const groups=new Map(), exOnly=new Set(), errors=[];
  let recCount=0;
  for(let i=hi+1;i<rows.length;i++){
    const r=rows[i];
    if(!r || r.every(c=>!String(c==null?'':c).trim())) continue;
    const g=k=> col[k]===undefined ? '' : String(r[col[k]]==null?'':r[col[k]]).trim();
    const exName=cleanName(g('ex'));
    const dateRaw=g('date');
    if(!exName){ errors.push(`Строка ${i+1}: нет названия упражнения`); continue; }
    if(!dateRaw){ exOnly.add(exName); continue; }
    const day=parseDay(dateRaw);
    if(!day){ errors.push(`Строка ${i+1}: не распознана дата «${dateRaw}»`); continue; }

    const clockRaw=g('clock');
    const clk=parseClock(clockRaw) || parseClock(dateRaw);
    let time=num(g('time'));
    if(time!=null) time=Math.round(time*timeU);
    // старый формат: колонка «Время» содержала секунды
    if(!parseClock(clockRaw) && clockRaw && col.time===undefined && time==null) time=num(clockRaw);

    const rec={exName, day, clk, reps:num(g('reps')), sets:num(g('sets')), weight:num(g('weight')), time, notes:g('notes')};
    if(!rec.reps && !rec.sets && !rec.weight && !rec.time && !rec.notes){ exOnly.add(exName); continue; }

    const dk=`${day.y}-${pad(day.m)}-${pad(day.d)}`;
    const wnum=g('wnum');
    let key;
    if(wnum){
      key='#'+wnum;
      const G0=groups.get(key);
      // тот же номер в другой день — другая тренировка (кроме перехода через полночь)
      if(G0 && dayNum(day)!==dayNum(G0.day) && !(dayNum(day)-dayNum(G0.day)===1 && clk && clk.h<6)) key=dk+'#'+wnum;
    } else {
      const dc=parseClock(dateRaw);
      key = dc ? `${dk} ${pad(dc.h)}:${pad(dc.mi)}:${pad(dc.s)}` : dk;
    }
    let G=groups.get(key);
    if(!G){ G={day, wstart:null, dur:null, rest:null, items:[]}; groups.set(key,G); }
    const ws=parseClock(g('wstart')); if(ws && !G.wstart) G.wstart=ws;
    const dur=num(g('dur'));  if(dur!=null && G.dur==null) G.dur=dur*durU;
    const rest=num(g('rest')); if(rest!=null && G.rest==null) G.rest=rest*restU;
    G.items.push(rec);
    recCount++;
  }

  const out=[];
  groups.forEach(G=>{
    if(!G.items.length) return;
    const at=(day,c)=>new Date(day.y,day.m-1,day.d, c?c.h:12, c?c.mi:0, c?c.s:0).getTime();
    let start=G.wstart ? at(G.day,G.wstart) : null;
    const recs=G.items.map((it,j)=>{
      const ts = it.clk ? at(it.day,it.clk) : (start!=null ? start : at(it.day,null)) + j*1000;
      return {exName:it.exName, ts, reps:it.reps, sets:it.sets, weight:it.weight, time:it.time, notes:it.notes};
    });
    const minTs=recs.reduce((m,r)=>Math.min(m,r.ts), Infinity);
    if(start==null || start>minTs) start=minTs;
    const end = G.dur>0 ? start+Math.round(G.dur*1000) : null;
    out.push({start, end, timed:!!end, rest:Math.round(G.rest||0), recs});
  });
  out.sort((a,b)=>a.start-b.start);
  return {groups:out, exOnly, errors, recCount};
}

function errHtml(errors){
  if(!errors.length) return '';
  return `<div class="warn-box">Пропущено строк: ${errors.length}<br>${errors.slice(0,5).map(esc).join('<br>')}${errors.length>5?'<br>…':''}</div>`;
}
function handleImportText(text){
  let P;
  try{ P=interpret(parseDelimited(text)); }
  catch(err){ ask(esc(err.message),'OK',false,null); return; }
  if(!P.recCount && !P.exOnly.size){ ask('В таблице не нашлось ни одной записи.'+errHtml(P.errors),'OK',false,null); return; }
  pendingImport=P;

  const names=new Set();
  P.groups.forEach(g=>g.recs.forEach(r=>names.add(normKey(r.exName))));
  P.exOnly.forEach(n=>names.add(normKey(n)));
  const have=new Set(DB.exercises.map(e=>normKey(e.name)));
  const newEx=[...names].filter(n=>!have.has(n)).length;
  let minTs=Infinity, maxTs=0;
  P.groups.forEach(g=>g.recs.forEach(r=>{ if(r.ts<minTs) minTs=r.ts; if(r.ts>maxTs) maxTs=r.ts; }));
  const hasData=DB.records.length>0;

  openModal(`<div class="sheet-head"><h2>Загрузка таблицы</h2><button class="icon-btn" data-act="close-modal" aria-label="Закрыть">${I('x')}</button></div>
    <div class="stats-summary">
      <div class="stats-box"><div class="lbl">Записей</div><div class="val">${P.recCount}</div></div>
      <div class="stats-box"><div class="lbl">Тренировок</div><div class="val">${P.groups.length}</div></div>
      <div class="stats-box"><div class="lbl">Упражнений</div><div class="val">${names.size}</div></div>
      <div class="stats-box"><div class="lbl">Новых упр.</div><div class="val">${newEx}</div></div>
    </div>
    ${P.recCount?`<p class="muted">Период: ${fmtDate(minTs)} — ${fmtDate(maxTs)}</p>`:''}
    ${errHtml(P.errors)}
    <button class="btn big" data-act="import-run" data-mode="merge">${I('plus')}${hasData?'Добавить к моим данным':'Загрузить'}</button>
    ${hasData?`<p class="muted" style="margin:8px 2px 0">Записи, которые уже есть в приложении, пропускаются — одну и ту же таблицу можно загружать повторно без дублей.</p>
    <button class="btn danger big" data-act="import-run" data-mode="replace">${I('swap')}Заменить все данные</button>`:''}
    <button class="btn ghost big" data-act="close-modal">Отмена</button>`);
}

function resetAll(){
  hideRest();
  DB=emptyDB();
  renderWorkoutBar();
}
async function runImport(mode){
  const P=pendingImport;
  if(!P) return;
  if(mode==='replace'){
    const ok=await ask(`Все текущие данные (${DB.records.length} ${plural(DB.records.length,'запись','записи','записей')}) будут удалены и заменены таблицей. Если сомневаетесь — сначала сделайте выгрузку.`,'Заменить',true);
    if(!ok) return;
    const keepExport=DB.lastExport;
    resetAll();
    DB.lastExport=keepExport;
  }
  const res=applyImport(P);
  pendingImport=null;
  closeModal();
  renderWorkoutBar(); refresh();
  ask(`Загружено записей: <b>${res.added}</b><br>Новых тренировок: ${res.newW}<br>Новых упражнений: ${res.newEx}${res.dup?`<br>Пропущено повторов: ${res.dup}`:''}`,'OK',false,null);
}
function applyImport(P){
  let added=0, dup=0, newW=0;
  const ex0=DB.exercises.length;
  const keyOf=(exId,ts,r)=>[exId, Math.floor(ts/60000), r.reps||0, r.sets||0, r.weight||0, r.time||0, normKey(r.notes||'')].join('|');
  // учёт с кратностью: две одинаковые записи в файле при одной в приложении → добавится одна
  const existing=new Map();
  DB.records.forEach(r=>{ const k=keyOf(r.exId,r.ts,r); existing.set(k,(existing.get(k)||0)+1); });

  P.groups.forEach(g=>{
    const fresh=[];
    g.recs.forEach(r=>{
      const ex=exByName(r.exName);
      const k=ex ? keyOf(ex.id,r.ts,r) : null;
      if(k && existing.get(k)>0){ existing.set(k,existing.get(k)-1); dup++; }
      else fresh.push(r);
    });
    if(!fresh.length) return;
    let w=DB.workouts.find(x=>!isActive(x) && Math.floor(x.start/60000)===Math.floor(g.start/60000));
    if(!w){
      w={id:nid('w'), start:g.start, end:g.end, timed:g.timed, rest:g.rest||0};
      DB.workouts.push(w); newW++;
    } else if(!w.timed && g.timed){
      w.start=g.start; w.end=g.end; w.timed=true; if(g.rest) w.rest=g.rest;
    }
    fresh.forEach(r=>{
      const ex=getOrCreateEx(r.exName);
      DB.records.push({id:nid('rec'), exId:ex.id, wId:w.id, ts:r.ts,
        reps:r.reps, sets:r.sets, weight:r.weight, time:r.time, notes:r.notes||''});
      added++;
    });
  });
  P.exOnly.forEach(n=>getOrCreateEx(n));
  cleanupWorkouts(); save();
  return {added, dup, newW, newEx:DB.exercises.length-ex0};
}

async function clearAll(){
  if(!await ask('Удалить <b>все</b> тренировки, записи и упражнения? Отменить будет нельзя. Рекомендуем сначала выгрузить таблицу.','Удалить всё',true)) return;
  resetAll(); save();
  closeModal();
  exInput.value=''; clearForm(true);
  refresh();
  toast('Все данные удалены');
}

/* ================== ОБРАБОТЧИКИ ================== */
document.addEventListener('click', e=>{
  const el=e.target.closest('[data-act]');
  if(!el) return;
  const act=el.dataset.act;
  const id=el.dataset.id!==undefined ? +el.dataset.id : null;
  switch(act){
    case 'tab':              go(el.dataset.tab); break;
    case 'close-modal':      closeModal(); break;
    case 'step':             stepInput(el.dataset.for, +el.dataset.d); break;
    case 'save':             saveRecord(); break;
    case 'clear-form':       clearForm(true); break;
    case 'fill-last':        fillFromLast(); break;
    case 'timer-start':      onTimerBtn(); break;
    case 'timer-stop':       stopWorkout(); break;
    case 'rest':             startRest(+el.dataset.sec); break;
    case 'rest-custom':      openCustomRest(); break;
    case 'rest-custom-start':customRestStart(); break;
    case 'rest-cancel':      cancelRest(); toast('Отдых остановлен'); break;
    case 'rest-add':         addRest(30); break;
    case 'rec-edit':         openRecEdit(id, el.dataset.w ? +el.dataset.w : null); break;
    case 'rec-save':         saveRecEdit(id); break;
    case 'rec-del':          deleteRec(id); break;
    case 'rec-toform':       recToForm(id); break;
    case 'rec-cancel':       afterRecEdit(); break;
    case 'ex-open':          openHistory(id); break;
    case 'ex-add':           openAddEx(); break;
    case 'ex-add-save':      createEx(); break;
    case 'ex-menu':          openExMenu(); break;
    case 'ex-record':        recordEx(); break;
    case 'ex-rename':        openRename(); break;
    case 'ex-rename-save':   renameEx(); break;
    case 'ex-del':           deleteEx(); break;
    case 'hist-back':        histEx=null; go('ex'); break;
    case 'w-open':           openWorkout(id); break;
    case 'w-edit':           openWorkoutEdit(id); break;
    case 'w-edit-save':      saveWorkoutEdit(id); break;
    case 'w-del':            deleteWorkout(id); break;
    case 'stats-mode':       statsMode=el.dataset.mode; renderStats(); break;
    case 'data':             openDataSheet(); break;
    case 'export':           openExport(); break;
    case 'export-share':     shareExport(); break;
    case 'export-download':  downloadExport(); break;
    case 'export-copy':      copyExport(); break;
    case 'import':           openImport(); break;
    case 'import-text':      importFromTextarea(); break;
    case 'import-run':       runImport(el.dataset.mode); break;
    case 'clear-all':        clearAll(); break;
  }
});

document.addEventListener('change', e=>{
  const t=e.target;
  if(t.id==='importFile') onImportFile(t);
  else if(t.dataset && t.dataset.filter==='ex'){ tblEx=t.value; renderStats(); }
  else if(t.dataset && t.dataset.filter==='period'){ tblPeriod=t.value; renderStats(); }
});

// Enter в полях модалок = кнопка действия
document.addEventListener('keydown', e=>{
  if(e.key!=='Enter') return;
  const t=e.target;
  if(t && t.dataset && t.dataset.enter){
    e.preventDefault();
    const b=document.querySelector(`[data-act="${t.dataset.enter}"]`);
    if(b) b.click();
  }
});

document.addEventListener('visibilitychange', ()=>{
  if(document.hidden) return;
  renderWorkoutBar();
  if(DB.active.restEnd){ tickRest(); requestWake(); }
  if(!$('#modal').classList.contains('show')) refresh();
});

// изменения из другой вкладки/окна
window.addEventListener('storage', e=>{
  if(e.key!==DB_KEY || !e.newValue) return;
  try{ DB=normalize(JSON.parse(e.newValue)); renderWorkoutBar(); refresh(); }catch(_){}
});

window.onerror=function(msg, src, line){ console.error('Ошибка:', msg, 'строка', line); return false; };

/* ================== ОФЛАЙН (для «На экран Домой» в Safari) ================== */
if('serviceWorker' in navigator && location.protocol==='https:'){
  navigator.serviceWorker.register('sw.js').catch(()=>{});
}

/* ================== СТАРТ ================== */
fixOrphans();
cleanupWorkouts();
save();
renderWorkoutBar();
if(DB.active.restEnd){
  if(DB.active.restEnd>Date.now()) showRest();
  else finishRest(Date.now()-DB.active.restEnd<15000);
}
showView('record');
renderRecord();
