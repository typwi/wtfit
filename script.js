'use strict';
/* =====================================================================
   WTFIT — дневник тренировок, все данные хранятся локально (localStorage)
   ===================================================================== */

const DB_KEY  = 'fitness_v4';
const OLD_KEY = 'fitness_v3';
const HINT_KEY = 'fitness_home_hint_off';
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
   active:    {wId, restEnd, restTotal, plan}                        — идущая тренировка, таймер отдыха, план {dayId}
   programs:  {id, name, folders:[{id, name, days:[{id, name, items:[{exId, reps, sets, weight, time, notes}]}]}]}
              — id программ, папок и тренировок берутся из одного счётчика seq.prog
*/
function emptyDB(){
  return {
    v:4, exercises:[], records:[], workouts:[], programs:[],
    measures:[], mkinds:[],
    seq:{ex:0, rec:0, w:0, prog:0, m:0},
    active:{wId:null, restEnd:null, restTotal:0, plan:null},
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
        notes:r.notes?String(r.notes):'',
        warm: r.warm===undefined ? /^\s*разминк/i.test(r.notes||'') : !!r.warm})),
    workouts: (Array.isArray(d.workouts)?d.workouts:[])
      .filter(w=>w && w.start)
      .map(w=>({id:+w.id, start:+w.start, end:w.end?+w.end:null, timed:!!w.timed, rest:Math.max(0,+w.rest||0), plan:w.plan?String(w.plan):'', planDay:w.planDay?+w.planDay:null})),
    programs: normPrograms(d.programs),
    measures: (Array.isArray(d.measures)?d.measures:[])
      .filter(m=>m && m.k && m.ts && num(m.v))
      .map(m=>({id:+m.id, k:String(m.k), ts:+m.ts, v:num(m.v)})),
    mkinds: (Array.isArray(d.mkinds)?d.mkinds:[])
      .filter(k=>k && k.k && cleanName(k.name))
      .map(k=>({k:String(k.k), name:cleanName(k.name), unit:cleanName(k.unit||'см')})),
    seq: Object.assign({}, base.seq, d.seq||{}),
    active: Object.assign({}, base.active, d.active||{}),
    lastExport: +d.lastExport || 0
  };
  const maxId = arr => arr.reduce((m,x)=>Math.max(m, x.id||0), 0);
  out.seq.ex  = Math.max(+out.seq.ex||0,  maxId(out.exercises));
  out.seq.rec = Math.max(+out.seq.rec||0, maxId(out.records));
  out.seq.w   = Math.max(+out.seq.w||0,   maxId(out.workouts));
  out.seq.m   = Math.max(+out.seq.m||0,   maxId(out.measures), ...out.mkinds.map(k=>+String(k.k).replace(/\D/g,'')||0));
  let maxP=0;
  out.programs.forEach(p=>{ maxP=Math.max(maxP,p.id); p.folders.forEach(f=>{ maxP=Math.max(maxP,f.id); f.days.forEach(x=>{ maxP=Math.max(maxP,x.id); }); }); });
  out.seq.prog = Math.max(+out.seq.prog||0, maxP);
  if(out.active.wId && !out.workouts.some(w=>w.id===+out.active.wId)) out.active.wId=null;
  if(out.active.wId) out.active.wId=+out.active.wId;
  if(!out.active.wId){ out.active.restEnd=null; out.active.restTotal=0; }
  const pl=out.active.plan;
  out.active.plan = (out.active.wId && pl && out.programs.some(p=>p.folders.some(f=>f.days.some(x=>x.id===+pl.dayId)))) ? {dayId:+pl.dayId} : null;
  out.workouts.forEach(w=>{
    if(w.id===out.active.wId){ w.end=null; w.timed=true; }
    else if(w.timed && !w.end) w.timed=false;
  });
  return out;
}

function normPrograms(arr){
  const A=x=>Array.isArray(x)?x:[];
  return A(arr).filter(p=>p && cleanName(p.name)).map(p=>({id:+p.id, name:cleanName(p.name),
    folders:A(p.folders).filter(f=>f && cleanName(f.name)).map(f=>({id:+f.id, name:cleanName(f.name),
      days:A(f.days).filter(x=>x && cleanName(x.name)).map(x=>({id:+x.id, name:cleanName(x.name),
        items:A(x.items).filter(it=>it && it.exId!=null).map(it=>({exId:+it.exId,
          reps:num(it.reps), sets:num(it.sets), weight:num(it.weight), time:num(it.time), notes:it.notes?String(it.notes):'',
          warm:!!it.warm, rest:(it.rest===0||it.rest==='0') ? 0 : num(it.rest)}))}))}))}));
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

// просим систему не очищать хранилище автоматически (где поддерживается)
function askPersist(){
  try{
    if(navigator.storage && navigator.storage.persist && navigator.storage.persisted)
      navigator.storage.persisted().then(p=>p || navigator.storage.persist()).catch(()=>{});
  }catch(e){}
}

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
    if(!r.warm && r.weight && r.weight>x.maxW) x.maxW=r.weight;
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
/* ---- подходы, прошлая тренировка, рекорды, отдых ---- */
function setUnits(r){ return Math.max(1, Math.round(r.sets||1)); }
// один подход коротко: «60×12», «12 повт», «60 кг», «15 мин»
function setLabel(r){
  if(r.weight && r.reps) return `${fmtNum(r.weight)}×${fmtNum(r.reps)}`;
  if(r.weight) return `${fmtNum(r.weight)} кг`;
  if(r.reps) return `${fmtNum(r.reps)} повт`;
  if(r.time) return fmtDur(r.time);
  return '—';
}
function isWork(r){ return !r.warm; }
// рабочие подходы (без разминки), развёрнутые по одному
function workSets(recs){ return expandSets(recs.filter(isWork)); }
const WARM_TAG='<span class="warm-tag">разминка</span>';
// запись «60×12, 3 подхода» → три отдельных подхода
function expandSets(recs){
  const out=[];
  recs.forEach(r=>{ for(let i=0;i<setUnits(r) && out.length<60;i++) out.push(r); });
  return out;
}
// тренировки, где было упражнение: [{wId, recs}] — от последней к первой
function exSessions(exId){
  const m=new Map();
  DB.records.forEach(r=>{ if(r.exId!==exId) return; if(!m.has(r.wId)) m.set(r.wId,[]); m.get(r.wId).push(r); });
  const arr=[...m.entries()].map(([wId,rs])=>({wId, recs:rs.sort((a,b)=>a.ts-b.ts)}));
  arr.sort((a,b)=>b.recs[b.recs.length-1].ts-a.recs[a.recs.length-1].ts);
  return arr;
}
// «текущая» тренировка для упражнения: идущая, иначе сегодняшняя
function curSessionW(exId){
  if(DB.active.wId) return DB.active.wId;
  const r=lastRecOf(exId);
  return (r && dayKey(r.ts)===dayKey(Date.now())) ? r.wId : null;
}
// расчётный максимум на 1 повторение (формула Эпли)
function e1rm(w, reps){
  if(!w || !reps) return 0;
  return reps===1 ? w : w*(1+reps/30);
}
// рекорды упражнения: макс. вес, лучший 1ПМ, лучший результат на каждом весе
function exPR(exId, exceptId){
  const byW=new Map();
  let maxW=0, e1=0, e1Any=0;
  DB.records.forEach(r=>{
    if(r.exId!==exId || r.id===exceptId || r.warm) return;
    if(r.weight && r.weight>maxW) maxW=r.weight;
    if(r.weight && r.reps){
      const b=byW.get(r.weight);
      if(!b || r.reps>b.reps || (r.reps===b.reps && r.ts<b.ts)) byW.set(r.weight, {reps:r.reps, ts:r.ts, id:r.id});
      const v=e1rm(r.weight, r.reps);
      if(r.reps<=12 && v>e1) e1=v;
      if(v>e1Any) e1Any=v;
    }
  });
  return {maxW, e1: e1||e1Any, byW};
}
// отдых перед каждой записью = время от предыдущей записи в той же тренировке
function buildGaps(){
  const by=new Map(), gaps=new Map();
  DB.records.forEach(r=>{ if(!by.has(r.wId)) by.set(r.wId,[]); by.get(r.wId).push(r); });
  by.forEach(rs=>{
    rs.sort((a,b)=>a.ts-b.ts);
    for(let i=1;i<rs.length;i++) gaps.set(rs[i].id, rs[i].ts-rs[i-1].ts);
  });
  return gaps;
}
function fmtGap(ms){
  if(ms==null) return '';
  const sec=Math.round(ms/1000);
  return sec<3600 ? fmtClock(sec) : fmtDur(sec);
}
function gapHtml(gaps, r, cls){
  const g=gaps.get(r.id);
  return g!=null ? `<span class="gap${cls?' '+cls:''}">${I('pause','sm')}${fmtGap(g)}</span>` : '';
}

// «отдых 3 мин» для пункта программы
function restLabel(sec){
  if(sec===0) return 'без отдыха';
  if(!sec) return '';
  const m=sec/60;
  return 'отдых '+(m>=1 ? fmtNum(round(m,1))+' мин' : sec+' сек');
}
function planDesc(it){
  return [esc(describe(it))||'—', it.rest!=null?`<span class="rest-lbl">${I('pause','sm')}${restLabel(it.rest)}</span>`:''].filter(Boolean).join(' ');
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

/* ---- предупреждения: копия и запуск с экрана «Домой» ---- */
function backupWarnHtml(){
  if(!DB.records.length || (DB.lastExport && Date.now()-DB.lastExport<=14*DAY)) return '';
  return `<div class="warn-line" data-act="backup">${I('alert')}<span>${DB.lastExport?'Последняя резервная копия '+fmtDate(DB.lastExport):'Резервной копии ещё нет'} — нажмите, чтобы сохранить полную копию</span></div>`;
}
function isIOS(){
  return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1);
}
function homeHintHtml(){
  if(navigator.standalone!==false || !isIOS()) return '';
  try{ if(localStorage.getItem(HINT_KEY)) return ''; }catch(e){}
  return `<div class="warn-line">${I('alert')}<span>Откройте WTFIT с иконки: Поделиться → «На экран Домой». В обычной вкладке Safari данные хранятся отдельно и могут стереться, если не заходить 7 дней.</span><button class="hint-x" data-act="hint-off" aria-label="Скрыть">${I('x')}</button></div>`;
}
function renderNotices(){
  const box=$('#recNotice');
  if(box) box.innerHTML=updateHtml()+homeHintHtml()+backupWarnHtml();
}

/* ================== НАВИГАЦИЯ ================== */
let curView='record';
function showView(v){
  $$('.view').forEach(x=>x.classList.add('hidden'));
  $('#view-'+v).classList.remove('hidden');
  const tab = v==='history' ? 'ex' : v==='program' ? 'prog' : v;
  $$('.nav button').forEach(b=>b.classList.toggle('active', b.dataset.tab===tab));
  curView=v;
  $('#scroller').scrollTop=0;
  if(typeof updateTopRest==='function') updateTopRest();
}
function go(tab){ showView(tab); refresh(); }
function refresh(){
  if(curView==='record') renderRecord();
  else if(curView==='ex') renderExList();
  else if(curView==='history') renderHistory();
  else if(curView==='stats') renderStats();
  else if(curView==='prog') renderProgList();
  else if(curView==='program') renderProgram();
}

/* ================== ЭКРАН «ЗАПИСЬ» ================== */
const exInput=$('#exInput');
const exSuggest=$('#exSuggest');
const NUM_FIELDS=['mWeight','mReps','mSets','mTime'];

function renderRecord(){
  renderNotices();
  renderWorkoutBar();
  renderPlan();
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

let lastExKey='';
exInput.addEventListener('input', ()=>{ renderSuggest(); renderLastHint(); renderPlanNext(); });
exInput.addEventListener('change', ()=>{ const k=normKey(exInput.value); if(k!==lastExKey){ lastExKey=k; setWarm(false); } });
$('#mWeight').addEventListener('input', ()=>renderLastHint());
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
  if(normKey(exInput.value)!==lastExKey){ lastExKey=normKey(exInput.value); setWarm(false); if(formEmpty()) autoFillNext(false); }
  renderLastHint(); renderPlanNext();
});

function formEmpty(){ return NUM_FIELDS.every(id=>!$('#'+id).value.trim()); }
function setVal(id,v){ $('#'+id).value=inVal(v); }
// данные для подсказки: подходы прошлой тренировки и пункта программы по этому упражнению
function hintCtx(ex){
  const cur=curSessionW(ex.id), sess=exSessions(ex.id);
  const prev=sess.find(x=>x.wId!==cur), today=sess.find(x=>x.wId===cur);
  const done=today ? workSets(today.recs).length : 0;
  const prevSets=prev ? workSets(prev.recs) : [];
  const prevWarm=prev ? expandSets(prev.recs.filter(r=>r.warm)) : [];
  const warmDone=today ? expandSets(today.recs.filter(r=>r.warm)).length : 0;
  let plan=null;
  const x=planCtx();
  if(x){
    const st=planStatus(x);
    const idx=x.d.items.map((it,k)=>k).filter(k=>x.d.items[k].exId===ex.id);
    if(idx.length){
      // чипы: каждый пункт развёрнут по подходам; отмечаем сделанные
      const chips=[];
      idx.forEach(k=>{ const it=x.d.items[k], s=st[k];
        for(let j=0;j<s.need;j++) chips.push({it, k, done:j<s.done, warm:!!it.warm}); });
      const nextChip=chips.findIndex(c=>!c.done);
      const work=idx.filter(k=>!x.d.items[k].warm);
      const need=work.reduce((a,k)=>a+st[k].need,0), wdone=work.reduce((a,k)=>a+st[k].done,0);
      plan={day:x.d.name, chips, next:nextChip, need, done:wdone,
        it: nextChip>=0 ? chips[nextChip].it : x.d.items[idx[idx.length-1]]};
    }
  }
  return {cur, prev, today, done, prevSets, prevWarm, warmDone, plan};
}
// подставить ОДИН подход (вес, повторы, время); в «Подходы» — 1
function fillSet(r, warm){
  if(!r) return;
  setWarm(!!warm);
  setVal('mWeight',r.weight); setVal('mReps',r.reps); setVal('mSets', (r.weight||r.reps) ? 1 : null);
  $('#mTime').value=minIn(r.time);
  NUM_FIELDS.forEach(id=>markBad($('#'+id),false));
  renderLastHint();
}
// «Подставить» в строке «Прошлый раз» — выделенный (следующий) подход
function fillFromLast(){
  const ex=exByName(exInput.value); if(!ex) return;
  const c=hintCtx(ex);
  if(!c.prevSets.length){ if(c.prevWarm.length) fillSet(c.prevWarm[0], true); return; }
  fillSet(c.prevSets[Math.min(c.done, c.prevSets.length-1)]);
}
// «Подставить» в строке «Программа»
function fillFromPlanEx(){
  const ex=exByName(exInput.value); if(!ex) return;
  const c=hintCtx(ex); if(!c.plan) return;
  fillSet(c.plan.it, c.plan.it.warm);
}
// нажатие на конкретный подход
function fillChip(src, i){
  const ex=exByName(exInput.value); if(!ex) return;
  const c=hintCtx(ex);
  if(src==='warm') fillSet(c.prevWarm[i], true);
  else if(src==='plan'){ const ch=c.plan && c.plan.chips[i]; if(ch) fillSet(ch.it, ch.warm); }
  else fillSet(c.prevSets[i]);
}
/* Тумблер «Разминка»: такие подходы не считаются рабочими (счётчики «N из M», план, рекорды, 1ПМ),
   но входят в тоннаж. Остаётся включённым для следующего подхода, сбрасывается при смене упражнения. */
let warmOn=false;
function setWarm(on){
  warmOn=!!on;
  const b=$('#warmBtn'); if(b){ b.classList.toggle('active', warmOn); b.setAttribute('aria-pressed', warmOn?'true':'false'); }
}
function clearForm(withName){
  if(swStart){ swStart=null; clearInterval(swTimer); swTimer=null; try{ localStorage.removeItem(SW_KEY); }catch(e){} swRender(); }
  NUM_FIELDS.forEach(id=>$('#'+id).value='');
  $('#mNotes').value='';
  setWarm(false);
  if(withName){ exInput.value=''; renderLastHint(); renderPlanNext(); }
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
  if(id==='mWeight') renderLastHint();
}

/* Автоподстановка: после «Сохранить» (и при выборе упражнения) в поля сразу ставится следующий подход —
   из прошлой тренировки или из программы. Источник выбирается тумблером «авто» в строке; повторное
   нажатие выключает. Любой чип по-прежнему подставляется нажатием. */
const AUTOFILL_KEY='fitness_autofill';
let autoSrc='plan';
try{ const v=localStorage.getItem(AUTOFILL_KEY); if(v==='prev'||v==='plan'||v==='off') autoSrc=v; }catch(e){}
function setAutoSrc(src){
  autoSrc = autoSrc===src ? 'off' : src;
  try{ localStorage.setItem(AUTOFILL_KEY, autoSrc); }catch(e){}
  if(autoSrc!=='off') autoFillNext(false);
  renderLastHint();
  toast(autoSrc==='off' ? 'Автоподстановка выключена'
    : autoSrc==='plan' ? 'После сохранения подставится следующий подход программы'
    : 'После сохранения подставится следующий подход прошлой тренировки', null, null, 2500, autoSrc==='off'?null:'repeat');
}
// какой подход прошлой тренировки следующий: сначала разминка, потом рабочие
function prevNextIdx(c){
  if(c.done===0 && c.warmDone<c.prevWarm.length) return {warm:true, i:c.warmDone};
  return {warm:false, i:c.done};
}
// подставить следующий подход по выбранному источнику; moveOn — можно ли перейти к следующему упражнению программы
function autoFillNext(moveOn){
  if(autoSrc==='off') return false;
  const ex=exByName(exInput.value);
  const c=ex ? hintCtx(ex) : null;
  const usePlan = autoSrc==='plan' && planCtx();
  if(usePlan && c && c.plan){
    if(c.plan.next>=0){ const ch=c.plan.chips[c.plan.next]; fillSet(ch.it, ch.warm); return true; }
    if(moveOn){
      // все подходы этого упражнения по программе сделаны — переходим к следующему пункту программы
      const x=planCtx(), i=planStatus(x).findIndex(s2=>!s2.ok);
      if(i>=0){ fillFromPlan(i, true); toast(`Дальше: ${exInput.value}`, null, null, 2500, 'repeat'); return true; }
    }
    return false;
  }
  // упражнения нет в программе (или программа не идёт) — берём из прошлой тренировки
  if(c && c.prev){
    const n=prevNextIdx(c);
    const r = n.warm ? c.prevWarm[n.i] : c.prevSets[n.i];
    if(r){ fillSet(r, n.warm); return true; }
  }
  return false;
}
function renderLastHint(){
  const box=$('#lastHint');
  const ex=exByName(exInput.value);
  if(!ex){ box.innerHTML=''; return; }
  const c=hintCtx(ex);
  if(!c.prev && !c.today && !c.plan){
    box.innerHTML=`<div class="hint-card"><div class="muted">Прошлый раз · записей по «${esc(ex.name)}» ещё нет</div></div>`;
    return;
  }
  const chip=(r,i,cls,src)=>`<button type="button" class="hs${cls}" data-act="fill-chip" data-src="${src}" data-i="${i}">${esc(setLabel(r))}</button>`;
  const sw=src=>{ const on = autoSrc===src || (autoSrc==='plan' && src==='prev' && !c.plan);
    return `<button type="button" class="auto-sw${on?' active':''}" data-act="auto-src" data-src="${src}" aria-pressed="${on}"><span class="warm-sw"></span>авто</button>`; };
  let html='<div class="hint-card hint-col">';
  if(c.prev){
    const n=c.cur ? prevNextIdx(c) : {warm:null,i:-1};
    html+=`<div class="hint-row"><div class="hint-lbl">Прошлый раз · ${relDay(c.prev.recs[0].ts)}${c.cur?` · сегодня <b>${c.done} из ${c.prevSets.length}</b>`:''}</div>${sw('prev')}</div>
      <div class="hint-sets">${
        c.prevWarm.map((r,i)=>chip(r,i,' warm'+(i<c.warmDone?' done':'')+(n.warm===true&&i===n.i?' next':''),'warm')).join('')
      }${c.prevSets.map((r,i)=>chip(r,i,(c.cur&&i<c.done?' done':'')+(n.warm===false&&i===n.i?' next':''),'prev')).join('')}</div>`;
  }
  if(c.plan){
    html+=`<div class="hint-row hint-plan-row"><div class="hint-lbl plan">${I('clip','sm')}Программа · <b>${c.plan.done} из ${c.plan.need}</b></div>${sw('plan')}</div>
      <div class="hint-sets">${c.plan.chips.map((ch,i)=>chip(ch.it,i,(ch.warm?' warm':'')+(ch.done?' done':'')+(i===c.plan.next?' next':''),'plan')).join('')}</div>`;
  }
  if(!c.prev && c.today){
    html+=`<div class="hint-lbl">Раньше не делали · сегодня <b>${c.done} ${plural(c.done,'рабочий подход','рабочих подхода','рабочих подходов')}</b>${c.warmDone?` + ${c.warmDone} разм.`:''}</div>`;
  }
  box.innerHTML=html+'</div>';
}

function recRow(r, fromW, gaps){
  const ex=exById(r.exId);
  return `<div class="rec-row" data-act="rec-edit" data-id="${r.id}"${fromW?` data-w="${fromW}"`:''}>
    <div class="rec-main">
      <div class="rec-name">${esc(ex?ex.name:'?')}</div>
      <div class="rec-desc">${r.warm?WARM_TAG:''}${esc(describe(r))}${r.notes?` <span class="note">«${esc(r.notes)}»</span>`:''}</div>
    </div>
    <div class="rec-side">${fmtTime(r.ts)}${gaps?gapHtml(gaps,r,'blk'):''}</div>
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
    <div class="card list-card">${(gs=>recs.map(r=>recRow(r,null,gs)).join(''))(buildGaps())}</div>`;
}

let saveGuard=0;
/* ---- секундомер поля «Время»: старт/стоп у поля, минуты пишутся сами; переживает сворачивание ---- */
const SW_KEY='fitness_stopwatch';
let swStart=null, swTimer=null;
try{ const v=+localStorage.getItem(SW_KEY); if(v>0) swStart=v; }catch(e){}
function swSec(){ return swStart ? Math.max(0, Math.round((Date.now()-swStart)/1000)) : 0; }
function swRender(){
  const b=$('#swBtn'); if(!b) return;
  b.classList.toggle('active', !!swStart);
  b.innerHTML = swStart ? `${I('pause')}<span>${fmtClock(swSec())}</span>` : `${I('timer')}`;
  if(swStart){ const t=$('#mTime'); if(t) t.value=minIn(swSec()); }
}
function swToggle(){
  if(swStart){ swStop(true); return; }
  unlockAudio();
  swStart=Date.now();
  try{ localStorage.setItem(SW_KEY, String(swStart)); }catch(e){}
  clearInterval(swTimer); swTimer=setInterval(swRender, 500);
  swRender();
  requestWakeAny();
}
function swStop(announce){
  if(!swStart) return 0;
  const sec=swSec();
  swStart=null; clearInterval(swTimer); swTimer=null;
  try{ localStorage.removeItem(SW_KEY); }catch(e){}
  const t=$('#mTime'); if(t){ t.value = sec ? minIn(sec) : ''; markBad(t,false); }
  swRender();
  if(announce) toast(`Время: ${fmtDur(sec)}`, null, null, 2000, 'timer');
  return sec;
}
// экран не гаснет, пока идёт секундомер (если браузер умеет)
async function requestWakeAny(){
  try{ if(!wakeLock && 'wakeLock' in navigator && !document.hidden){ wakeLock=await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release',()=>{ wakeLock=null; }); } }catch(e){}
}

function saveRecord(){
  if(Date.now()-saveGuard<700) return;
  if(swStart) swStop(false);           // секундомер идёт — останавливаем и берём его время
  const name=cleanName(exInput.value);
  if(!name){ toast('Введите название упражнения'); exInput.focus(); return; }
  if(!checkLimits([['mWeight','weight'],['mReps','reps'],['mSets','sets'],['mTime','time']])) return;
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
  const rec={id:nid('rec'), exId:ex.id, wId, ts, reps, sets, weight, time, notes, warm:warmOn};
  lastExKey=normKey(ex.name);
  const before=(createdEx || warmOn) ? null : exPR(ex.id);
  DB.records.push(rec);
  save();
  let prMsg='';
  if(before && weight){
    if(before.maxW && weight>before.maxW) prMsg=`Новый рекорд веса: ${fmtNum(weight)} кг!`;
    else if(reps && before.byW.has(weight) && reps>before.byW.get(weight).reps) prMsg=`Рекорд на ${fmtNum(weight)} кг: ${fmtNum(reps)} повт!`;
    else if(reps && before.e1 && e1rm(weight,reps)>before.e1+0.05 && reps<=12) prMsg=`Новый 1ПМ ≈ ${fmtNum(round(e1rm(weight,reps),1))} кг!`;
  }

  $('#mNotes').value='';
  if(document.activeElement && document.activeElement.blur) document.activeElement.blur();
  try{ navigator.vibrate && navigator.vibrate(30); }catch(e){}
  // автоотдых — только во время идущей тренировки и не для кардио «по времени»
  let autoStarted=false;
  let restSec=lastRest;
  const px=planCtx();
  if(px){
    // пункт программы, к которому относится этот подход: последний пункт этого упражнения и типа, где уже есть выполненные подходы
    const st=planStatus(px);
    let k=-1;
    px.d.items.forEach((it,i)=>{ if(it.exId===ex.id && !!it.warm===!!rec.warm && st[i].done>0) k=i; });
    if(k>=0 && px.d.items[k].rest!=null) restSec=px.d.items[k].rest;
  }
  if(arMode==='fixed') restSec=lastRest;
  if(arMode!=='off' && DB.active.wId && (reps || weight) && restSec>0){ startRest(restSec, true); autoStarted=true; }
  renderRecord();
  autoFillNext(true);

  toast((prMsg||(rec.warm?'Разминка сохранена':'Сохранено'))+(autoStarted?` · отдых ${fmtClock(restSec)}`:''), 'Отменить', ()=>{
    if(autoStarted && DB.active.restEnd){ DB.active.restEnd=null; DB.active.restTotal=0; save(); hideRest(); }
    DB.records=DB.records.filter(r=>r.id!==rec.id);
    if(createdEx && !DB.records.some(r=>r.exId===ex.id)) DB.exercises=DB.exercises.filter(e=>e.id!==ex.id);
    cleanupWorkouts(); save(); refresh();
    toast('Запись отменена');
  }, prMsg?5000:null, prMsg?'trophy':'check');
}

/* ================== ТАЙМЕР ТРЕНИРОВКИ ================== */
let wInterval=null, stopBusy=false;

function onTimerBtn(){
  if(DB.active.wId){ $('#scroller').scrollTo({top:0,behavior:'smooth'}); toast('Тренировка уже идёт'); return; }
  startWorkout(false);
}
function startWorkout(silent){
  if(DB.active.wId) return;
  forgotAsked=false;
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
  DB.active.plan=null;
  let had=false;
  if(w){ w.end=Date.now(); w.timed=true; had=DB.records.some(r=>r.wId===w.id); }
  cleanupWorkouts(); save();
  renderWorkoutBar(); refresh();
  if(had) openSummary(w.id);
  else toast('Пустая тренировка не сохранена');
}

/* ---- картинка итога: PNG 1080×1350 с логотипом, цифрами, рекордами и упражнениями ---- */
function loadImg(src){ return new Promise(res=>{ const im=new Image(); im.onload=()=>res(im); im.onerror=()=>res(null); im.src=src; }); }
function exSummaryLines(wId){
  const recs=recsOfW(wId), order=[], by=new Map();
  recs.forEach(r=>{ if(!by.has(r.exId)){ by.set(r.exId,[]); order.push(r.exId); } by.get(r.exId).push(r); });
  return order.map(exId=>{
    const ex=exById(exId), rs=by.get(exId), work=rs.filter(isWork);
    const n=expandSets(work).length;
    let top=null; work.forEach(r=>{ if(r.weight && (!top || r.weight>top.weight || (r.weight===top.weight && (r.reps||0)>(top.reps||0)))) top=r; });
    const time=rs.reduce((a,r)=>a+(r.time||0),0);
    let d;
    if(top) d=`${n} ${plural(n,'подход','подхода','подходов')} · ${fmtNum(top.weight)}×${fmtNum(top.reps||0)}`;
    else if(time) d=fmtDur(time);
    else { const reps=work.reduce((a,r)=>a+(r.reps||0)*setUnits(r),0); d = n ? `${n} ${plural(n,'подход','подхода','подходов')}${reps?' · '+fmtNum(reps)+' повт':''}` : 'разминка'; }
    return {name: ex?ex.name:'?', d};
  });
}
async function summaryImage(wId){
  const w=wById(wId); if(!w) return null;
  const st=wStats(w), prs=workoutPRs(wId), lines=exSummaryLines(wId);
  const W=1080, P=72, th=130, ROW=58;
  const L=lines.slice(0,14), nPr=Math.min(3,prs.length);
  // высота картинки под содержимое (не меньше 1350 — формат 4:5)
  const H=Math.max(1350, P+230+50+2*th+24+76 + (nPr?50+nPr*44+40:0) + 24+L.length*ROW + (lines.length>L.length?ROW:0) + 90);
  const cv=document.createElement('canvas'); cv.width=W; cv.height=H;
  const c=cv.getContext('2d');
  const F=(wt,sz)=>`${wt} ${sz}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  const fit=(t,max)=>{ if(c.measureText(t).width<=max) return t; while(t.length>1 && c.measureText(t+'…').width>max) t=t.slice(0,-1); return t+'…'; };
  const rr=(x,y,w2,h2,r)=>{ c.beginPath(); c.moveTo(x+r,y); c.arcTo(x+w2,y,x+w2,y+h2,r); c.arcTo(x+w2,y+h2,x,y+h2,r); c.arcTo(x,y+h2,x,y,r); c.arcTo(x,y,x+w2,y,r); c.closePath(); };
  // фон
  const g=c.createLinearGradient(0,0,0,H); g.addColorStop(0,'#0f1115'); g.addColorStop(1,'#0b1a33');
  c.fillStyle=g; c.fillRect(0,0,W,H);
  // шапка: логотип + WTFIT
  const logo=await loadImg('icon-512.png');
  if(logo){ c.save(); rr(P,P,120,120,26); c.clip(); c.drawImage(logo,P,P,120,120); c.restore(); }
  c.fillStyle='#4f8cff'; c.font=F(800,64); c.textBaseline='alphabetic';
  c.fillText('WTFIT', P+150, P+78);
  c.fillStyle='#8b93a7'; c.font=F(500,32);
  const d=new Date(w.start);
  c.fillText(`${['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота'][d.getDay()]}, ${fmtDate(w.start)}`, P+152, P+118);
  // подпись тренировки
  let y=P+230;
  c.fillStyle='#e8eaed'; c.font=F(800,58);
  c.fillText(fit(w.plan||'Тренировка', W-2*P), P, y);
  // плитки
  y+=50;
  const tiles=[['Длительность', st.dur?fmtDur(st.dur):'—'],['Тоннаж', st.ton?fmtTon(st.ton):'—'],['Рабочих подходов', String(st.sets)],['Упражнений', String(st.ex)]];
  const tw=(W-2*P-24)/2;
  tiles.forEach((t,i)=>{
    const x=P+(i%2)*(tw+24), yy=y+Math.floor(i/2)*(th+24);
    c.fillStyle='rgba(255,255,255,0.05)'; rr(x,yy,tw,th,24); c.fill();
    c.strokeStyle='rgba(79,140,255,0.25)'; c.lineWidth=2; c.stroke();
    c.fillStyle='#8b93a7'; c.font=F(600,28); c.fillText(t[0].toUpperCase(), x+30, yy+52);
    c.fillStyle='#ffffff'; c.font=F(800,50); c.fillText(fit(t[1], tw-60), x+30, yy+106);
  });
  y+=2*th+24+76;
  // рекорды
  if(prs.length){
    c.fillStyle='#ffd166'; c.font=F(800,36); c.fillText(`РЕКОРДЫ: ${prs.length}`, P, y);
    c.font=F(500,32); c.fillStyle='#ffe3a3';
    prs.slice(0,3).forEach((x,i)=>c.fillText(fit(x.text, W-2*P), P, y+50+i*44));
    y+=50+Math.min(3,prs.length)*44+40;
  }
  // упражнения
  c.fillStyle='#8b93a7'; c.font=F(700,30); c.fillText('УПРАЖНЕНИЯ', P, y); y+=24;
  const shown=L;
  shown.forEach((l,i)=>{
    const yy=y+44+i*ROW;
    c.fillStyle='#e8eaed'; c.font=F(600,36); c.fillText(fit(l.name, W*0.5), P, yy);
    c.fillStyle='#9ec4ff'; c.font=F(600,34); c.textAlign='right'; c.fillText(fit(l.d, W*0.4), W-P, yy); c.textAlign='left';
    c.strokeStyle='rgba(255,255,255,0.06)'; c.lineWidth=2; c.beginPath(); c.moveTo(P, yy+20); c.lineTo(W-P, yy+20); c.stroke();
  });
  if(lines.length>shown.length){ c.fillStyle='#8b93a7'; c.font=F(500,32); c.fillText(`и ещё ${lines.length-shown.length}…`, P, y+44+shown.length*ROW); }
  // подвал
  c.fillStyle='rgba(79,140,255,0.9)'; c.fillRect(0,H-14,W,14);
  return new Promise(res=>cv.toBlob(b=>res(b),'image/png'));
}
async function shareSummary(wId){
  const w=wById(wId); if(!w) return;
  toast('Готовлю картинку…', null, null, 1500);
  const blob=await summaryImage(wId);
  if(!blob){ toast('Не удалось нарисовать картинку'); return; }
  const name=`WTFIT_${dayKey(w.start)}.png`;
  const file=new File([blob], name, {type:'image/png'});
  try{
    if(navigator.canShare && navigator.canShare({files:[file]})){
      await navigator.share({files:[file], title:'WTFIT'});
      return;
    }
  }catch(e){ if(e && e.name==='AbortError') return; }
  // запасной вариант: показать картинку — долгое нажатие → «Сохранить в Фото»
  const url=URL.createObjectURL(blob);
  openModal(`<div class="sheet-head"><h2>Итог тренировки</h2>${closeX()}</div>
    <img src="${url}" alt="Итог тренировки" style="width:100%;border-radius:14px;display:block">
    <p class="muted" style="margin:10px 2px 0">Нажмите и удерживайте картинку → «Сохранить в Фото» или «Поделиться».</p>
    <a class="btn ghost big" href="${url}" download="${name}">${I('download')}Скачать</a>`);
}

/* ---- итог тренировки ---- */
// рекорды, поставленные в тренировке: сравнение с тем, что было до каждой записи
function workoutPRs(wId){
  const out=[];
  recsOfW(wId).forEach(r=>{
    if(!r.weight || r.warm) return;
    const before=DB.records.filter(x=>x.exId===r.exId && x.ts<r.ts && !x.warm);
    if(!before.length) return;
    const maxW=before.reduce((m,x)=>Math.max(m,x.weight||0),0);
    const atW=before.filter(x=>x.weight===r.weight && x.reps).reduce((m,x)=>Math.max(m,x.reps),0);
    const ex=exById(r.exId), name=ex?ex.name:'?';
    if(maxW && r.weight>maxW) out.push({exId:r.exId, text:`${name}: вес ${fmtNum(r.weight)} кг`});
    else if(r.reps && atW && r.reps>atW) out.push({exId:r.exId, text:`${name}: ${fmtNum(r.weight)} кг × ${fmtNum(r.reps)}`});
  });
  // по одному (последнему) рекорду на упражнение
  const m=new Map(); out.forEach(x=>m.set(x.exId, x));
  return [...m.values()];
}
// прошлая «такая же» тренировка: та же программа, иначе с максимальным совпадением упражнений (от половины)
function similarPrev(w){
  const ws=sortedWorkouts().filter(x=>x.id!==w.id && x.start<w.start && !isActive(x));
  if(w.planDay){ const same=ws.filter(x=>x.planDay===w.planDay); if(same.length) return same[same.length-1]; }
  if(w.plan){ const same=ws.filter(x=>x.plan===w.plan); if(same.length) return same[same.length-1]; }
  const mine=new Set(recsOfW(w.id).map(r=>r.exId));
  let best=null, bestScore=0;
  ws.forEach(x=>{
    const theirs=new Set(recsOfW(x.id).map(r=>r.exId));
    let common=0; mine.forEach(e=>{ if(theirs.has(e)) common++; });
    const score=common/Math.max(mine.size, theirs.size, 1);
    if(score>=0.5 && score>=bestScore){ best=x; bestScore=score; }
  });
  return best;
}
function wStats(w){
  const recs=recsOfW(w.id);
  return {ton:recs.reduce((a,r)=>a+ton(r),0), sets:workSets(recs).length, warm:expandSets(recs.filter(r=>r.warm)).length, dur:wDur(w), ex:new Set(recs.map(r=>r.exId)).size, rest:w.rest||0};
}
function cmpHtml(label, a, b, fmt, better){
  if(!b) return '';
  const d=a-b, pct=b ? Math.round(d/b*100) : 0;
  const sign=d>0?'+':d<0?'−':'';
  const cls = !d ? '' : ((better==='up')===(d>0) ? 'up' : 'down');
  return `<div class="cmp-row"><span>${label}</span><span class="cmp-v">${fmt(b)} → <b>${fmt(a)}</b></span>
    <span class="cmp-d ${cls}">${d?sign+(pct?Math.abs(pct)+'%':fmt(Math.abs(d))):'='}</span></div>`;
}
function openSummary(wId){
  const w=wById(wId); if(!w) return;
  const st=wStats(w), prs=workoutPRs(wId), prev=similarPrev(w);
  const d=new Date(w.start);
  let html=`<div class="sheet-head"><h2>${I('flag')} Тренировка завершена</h2>${closeX()}</div>
    <div class="muted" style="margin-bottom:${w.plan?4:12}px">${WD[d.getDay()]}, ${fmtDate(w.start)} · ${fmtTime(w.start)}–${fmtTime(w.end||Date.now())}</div>
    ${w.plan?`<div class="workout-plan" style="margin-bottom:12px">${I('clip','sm')}${esc(w.plan)}</div>`:''}
    <div class="stats-summary">
      <div class="stats-box"><div class="lbl">${I('clock','sm')}Длительность</div><div class="val">${st.dur?fmtDur(st.dur):'—'}</div></div>
      <div class="stats-box"><div class="lbl">${I('dumbbell','sm')}Тоннаж</div><div class="val">${st.ton?fmtTon(st.ton):'—'}</div></div>
      <div class="stats-box"><div class="lbl">Рабочих подходов</div><div class="val">${st.sets}${st.warm?`<span class="val-sub"> +${st.warm} разм.</span>`:''}</div></div>
      <div class="stats-box"><div class="lbl">Упражнений</div><div class="val">${st.ex}</div></div>
    </div>`;
  html+=`<div class="sum-block"><div class="sum-title">${I('trophy','sm')}Рекорды: ${prs.length||'нет'}</div>
    ${prs.map(x=>`<div class="sum-line">${esc(x.text)}</div>`).join('')}</div>`;
  if(prev){
    const ps=wStats(prev), pd=new Date(prev.start);
    html+=`<div class="sum-block"><div class="sum-title">Сравнение с ${WD[pd.getDay()]} ${fmtDM(prev.start)}${prev.planDay&&prev.planDay===w.planDay?' (тот же день программы)':''}</div>
      ${cmpHtml('Тоннаж', st.ton, ps.ton, v=>v?fmtTon(v):'0', 'up')}
      ${cmpHtml('Подходы', st.sets, ps.sets, v=>String(v), 'up')}
      ${st.dur&&ps.dur?cmpHtml('Длительность', st.dur, ps.dur, v=>fmtDur(v), 'down'):''}
      ${st.rest&&ps.rest?cmpHtml('Отдых', st.rest, ps.rest, v=>fmtDur(v), 'down'):''}</div>`;
  } else {
    html+=`<div class="sum-block muted">Похожих прошлых тренировок пока нет — сравнение появится в следующий раз.</div>`;
  }
  html+=`<div class="grid2" style="margin-top:14px">
    <button class="btn ghost" data-act="w-open" data-id="${w.id}">Подробнее</button>
    <button class="btn" data-act="close-modal">Готово</button></div>
    <button class="btn ghost big" data-act="sum-share" data-id="${w.id}">${I('upload')}Поделиться картинкой</button>`;
  openModal(html);
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
  const lb=$('#workoutLabel'), txt=w.plan||'Тренировка';
  if(lb && lb.dataset.t!==txt){ lb.dataset.t=txt; lb.innerHTML=`<span>${esc(txt)}</span>${I('edit','sm')}`; }
}
// подпись тренировки: свободный текст, по умолчанию — день программы
function renameWorkout(id){
  const w=wById(id); if(!w) return;
  openModal(`<h2>Подпись тренировки</h2>
    <input id="wLabel" value="${esc(w.plan||'')}" placeholder="Например: Верх · Сила" autocomplete="off" autocapitalize="sentences" data-enter="w-label-save">
    <p class="muted" style="margin:8px 2px 0">Видна в статистике и итоге. Пустое поле — без подписи.</p>
    <div class="grid2" style="margin-top:14px">
      <button class="btn ghost" data-act="close-modal">Отмена</button>
      <button class="btn" data-act="w-label-save" data-id="${w.id}">Сохранить</button>
    </div>`);
  const i=$('#wLabel'); i.focus(); try{ i.setSelectionRange(0,i.value.length); }catch(e){}
}
function saveWorkoutLabel(id){
  const w=wById(id); if(!w){ closeModal(); return; }
  w.plan=cleanName($('#wLabel').value);
  save(); closeModal(); renderWorkoutBar(); refresh();
  toast(w.plan?'Подпись сохранена':'Подпись убрана', null, null, null, 'check');
}

// тренировка без активности больше 3 часов — скорее всего, забыли нажать «Стоп»
const FORGOT_MS=3*3600e3;
let forgotAsked=false, forgotBusy=false;
async function checkForgotten(){
  const w=activeW();
  if(!w || forgotAsked || forgotBusy) return;
  const recs=recsOfW(w.id);
  const lastTs=recs.length ? recs[recs.length-1].ts : w.start;
  const lastAct=Math.max(lastTs, DB.active.restEnd||0);
  if(Date.now()-lastAct < FORGOT_MS) return;
  forgotBusy=true;
  const end=recs.length ? lastTs+60000 : w.start;
  const msg = recs.length
    ? `Тренировка идёт уже ${fmtDur((Date.now()-w.start)/1000)}, последняя запись — ${relDay(lastTs)} в ${fmtTime(lastTs)}. Похоже, её забыли завершить.<br><br>Завершить в ${fmtTime(end)}? Длительность будет ${fmtDur((end-w.start)/1000)}.`
    : `Тренировка без записей идёт уже ${fmtDur((Date.now()-w.start)/1000)}. Похоже, её забыли завершить. Убрать её?`;
  const ok=await ask(msg, recs.length?'Завершить':'Убрать', false, 'Продолжить');
  forgotBusy=false; forgotAsked=true;
  if(!ok || DB.active.wId!==w.id) return;
  if(DB.active.restEnd){ DB.active.restEnd=null; DB.active.restTotal=0; hideRest(); }
  DB.active.wId=null; DB.active.plan=null;
  w.end=end; w.timed=true;
  cleanupWorkouts(); save();
  renderWorkoutBar(); refresh();
  toast(recs.length ? `Тренировка завершена · ${fmtDur((end-w.start)/1000)}` : 'Пустая тренировка убрана', null, null, null, recs.length?'flag':null);
}

/* ================== ТАЙМЕР ОТДЫХА ================== */
let rInterval=null;

/* Автоотдых: после «Сохранить» (во время идущей тренировки) сам запускается отдых
   с последним выбранным временем. Переключатель — над кнопками отдыха. */
const AUTOREST_KEY='fitness_auto_rest', LASTREST_KEY='fitness_last_rest';
// режим: off — выключен, fixed — всегда последнее выбранное время, plan — время из пункта программы (иначе последнее выбранное)
let arMode='plan', lastRest=120;
try{
  const a=localStorage.getItem(AUTOREST_KEY);
  if(a==='0'||a==='off') arMode='off'; else if(a==='fixed') arMode='fixed'; else arMode='plan';
  const l=+localStorage.getItem(LASTREST_KEY); if(l>0) lastRest=l;
}catch(e){}
function renderRestPresets(){
  $$('#arSeg button').forEach(b=>b.classList.toggle('active', b.dataset.m===arMode));
  const t=$('#autoRestTime'); if(t) t.textContent=fmtClock(lastRest);
  const h=$('#arHint');
  if(h) h.textContent = arMode==='off' ? 'Автоотдых выключен — запускайте отдых кнопками ниже.'
    : arMode==='fixed' ? `После «Сохранить» всегда ${fmtClock(lastRest)}. Время меняется кнопками ниже.`
    : `После «Сохранить» — отдых из пункта программы, вне программы — ${fmtClock(lastRest)}.`;
  $$('.rest-presets .chip[data-sec]').forEach(c=>c.classList.toggle('sel', +c.dataset.sec===lastRest));
  const cu=$('.rest-presets .chip[data-act="rest-custom"]');
  if(cu) cu.classList.toggle('sel', ![60,120,180,300].includes(lastRest));
}
function setArMode(m){
  arMode=m;
  try{ localStorage.setItem(AUTOREST_KEY, m); }catch(e){}
  renderRestPresets();
}
function startRest(sec, auto){
  if(!auto){ lastRest=sec; try{ localStorage.setItem(LASTREST_KEY, String(sec)); }catch(e){} renderRestPresets(); }
  unlockAudio();
  askNotify();
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
  updateTopRest('');
  releaseWake();
}
/* Отдых в верхней панели: на других вкладках — всегда, на «Записи» — когда блок отдыха уехал под панель */
function initTopRest(){
  $$('.topbar').forEach(tb=>{
    const pill=document.createElement('button');
    pill.type='button'; pill.className='top-rest hidden'; pill.dataset.act='rest-jump';
    pill.setAttribute('aria-label','Отдых — перейти к таймеру');
    pill.innerHTML=I('pause')+'<span class="top-rest-t">00:00</span>';
    const last=tb.lastElementChild;
    if(last && last.classList.contains('icon-btn')) tb.insertBefore(pill, last); else tb.appendChild(pill);
  });
}
function restBlockVisible(){
  if(curView!=='record') return false;
  const rb=$('#restBlock'), tb=$('#view-record .topbar');
  if(!rb || rb.classList.contains('hidden') || !tb) return false;
  return rb.getBoundingClientRect().bottom > tb.getBoundingClientRect().bottom+8;
}
let topRestText='';
function updateTopRest(text){
  if(text!==undefined) topRestText=text;
  const show=!!topRestText && !!DB.active.restEnd && !restBlockVisible();
  $$('.top-rest').forEach(p=>{
    p.classList.toggle('hidden', !show);
    if(show) p.querySelector('.top-rest-t').textContent=topRestText;
  });
}
function jumpToRest(){
  if(curView!=='record') go('record');
  $('#scroller').scrollTo({top:0, behavior:'smooth'});
}
function tickRest(){
  const end=DB.active.restEnd;
  if(!end){ hideRest(); return; }
  const leftMs=end-Date.now();
  if(leftMs<=0){ finishRest(leftMs>-15000); return; }
  const txt=fmtClock(Math.ceil(leftMs/1000));
  $('#restTime').textContent=txt;
  updateTopRest(txt);
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

/* ---- звук / вибрация / уведомления / экран ---- */
/* Звук. На iPhone Web Audio «засыпает» (suspended / interrupted) после системных окон, звонка
   или сворачивания приложения. Будим его при касаниях и при возврате в приложение.
   Главное правило сигнала: он звучит СЕЙЧАС или не звучит вовсе. Всё, что не успело заиграть
   за 1,5 с (спящий звук, отложенное воспроизведение), гасится — иначе iOS проиграет его потом,
   в случайный момент, как только звук «проснётся». */
const BEEP_LATE_MS=1500;
let AC=null, beepEl=null, beepElUnlocked=false, beepElBusy=false;
function acReady(){ return AC && AC.state==='running'; }
function unlockAudio(){
  try{
    if(!AC || AC.state==='closed'){ const C=window.AudioContext||window.webkitAudioContext; if(C) AC=new C(); }
    if(AC){
      if(AC.state!=='running'){ const p=AC.resume(); if(p && p.catch) p.catch(()=>{}); }
      const b=AC.createBuffer(1,1,22050), s=AC.createBufferSource();
      s.buffer=b; s.connect(AC.destination); s.start(0);
    }
  }catch(e){}
  // запасной звук: один раз «разблокируем» <audio> беззвучным проигрыванием в момент касания
  try{
    if(!beepEl){ beepEl=new Audio(beepWavUrl()); beepEl.preload='auto'; }
    if(!beepElUnlocked && !beepElBusy){
      beepElBusy=true;
      beepEl.muted=true;
      const fin=ok=>{ try{ beepEl.pause(); beepEl.currentTime=0; }catch(_){} beepEl.muted=false; beepElBusy=false; if(ok) beepElUnlocked=true; };
      const p=beepEl.play();
      if(p && p.then) p.then(()=>fin(true), ()=>fin(false)); else fin(true);
    }
  }catch(e){ beepElBusy=false; }
}
// при каждом касании — только если звук уснул (дёшево)
document.addEventListener('touchend', ()=>{ if(!acReady() || !beepElUnlocked) unlockAudio(); }, {passive:true});
document.addEventListener('click', ()=>{ if(!acReady()) unlockAudio(); }, true);

// WAV с тремя сигналами 880 Гц — для запасного проигрывания
let _beepUrl=null;
function beepWavUrl(){
  if(_beepUrl) return _beepUrl;
  const sr=22050, len=Math.round(sr*0.9), data=new Int16Array(len);
  [0,0.3,0.6].forEach(st=>{
    const a=Math.round(st*sr), n=Math.round(0.22*sr);
    for(let i=0;i<n && a+i<len;i++){
      const env=Math.min(1, i/(0.02*sr)) * Math.min(1, (n-i)/(0.05*sr));
      data[a+i]=Math.round(Math.sin(2*Math.PI*880*i/sr)*env*0.45*32767);
    }
  });
  const buf=new ArrayBuffer(44+len*2), v=new DataView(buf);
  const w=(o,s)=>{ for(let i=0;i<s.length;i++) v.setUint8(o+i, s.charCodeAt(i)); };
  w(0,'RIFF'); v.setUint32(4,36+len*2,true); w(8,'WAVE'); w(12,'fmt ');
  v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,1,true);
  v.setUint32(24,sr,true); v.setUint32(28,sr*2,true); v.setUint16(32,2,true); v.setUint16(34,16,true);
  w(36,'data'); v.setUint32(40,len*2,true);
  new Int16Array(buf,44).set(data);
  _beepUrl=URL.createObjectURL(new Blob([buf],{type:'audio/wav'}));
  return _beepUrl;
}
// Web Audio: если через 1,5 с часы звука не сдвинулись — звук завис, отключаем запланированный сигнал
function beepWeb(){
  const ctx=AC, out=ctx.createGain();
  out.connect(ctx.destination);
  const t0=ctx.currentTime+0.05, start=ctx.currentTime;
  [0,0.3,0.6].forEach(dt=>{
    const o=ctx.createOscillator(), g=ctx.createGain();
    o.type='sine'; o.frequency.value=880;
    g.gain.setValueAtTime(0.0001,t0+dt);
    g.gain.exponentialRampToValueAtTime(0.3,t0+dt+0.02);
    g.gain.exponentialRampToValueAtTime(0.0001,t0+dt+0.22);
    o.connect(g); g.connect(out);
    o.start(t0+dt); o.stop(t0+dt+0.25);
  });
  setTimeout(()=>{
    if(ctx.currentTime-start < 0.5){ try{ out.disconnect(); }catch(_){} return false; }   // звук не играл — отменяем
  }, BEEP_LATE_MS);
  return true;
}
// <audio>: если за 1,5 с проигрывание не началось — останавливаем, чтобы оно не «выстрелило» позже
function beepFallback(){
  try{
    if(!beepEl) beepEl=new Audio(beepWavUrl());
    if(beepElBusy) return;                       // идёт беззвучная разблокировка — не трогаем
    const asked=Date.now();
    let started=false;
    const onPlaying=()=>{
      beepEl.removeEventListener('playing', onPlaying);
      if(Date.now()-asked > BEEP_LATE_MS){ try{ beepEl.pause(); beepEl.currentTime=0; }catch(_){} return; }
      started=true;
    };
    beepEl.addEventListener('playing', onPlaying);
    beepEl.muted=false; beepEl.currentTime=0;
    const p=beepEl.play(); if(p && p.catch) p.catch(()=>{});
    setTimeout(()=>{
      if(started) return;
      beepEl.removeEventListener('playing', onPlaying);
      try{ beepEl.pause(); beepEl.currentTime=0; }catch(_){}
    }, BEEP_LATE_MS);
  }catch(e){}
}
async function beep(){
  if(document.hidden) return;                    // приложение свёрнуто — звук не выйдет, остаётся уведомление
  try{
    if(!AC) unlockAudio();
    if(AC && AC.state!=='running'){
      await Promise.race([AC.resume().catch(()=>{}), new Promise(r=>setTimeout(r,300))]);
    }
    if(document.hidden) return;
    if(acReady()) beepWeb(); else beepFallback();
  }catch(e){ beepFallback(); }
}
// разрешение на уведомления спрашиваем один раз — при первом запуске таймера отдыха
// (на iPhone работает только в приложении с экрана «Домой», iOS 16.4+)
let notifyAsked=false;
function askNotify(){
  if(notifyAsked) return;
  notifyAsked=true;
  try{
    if(!window.Notification || Notification.permission!=='default') return;
    const p=Notification.requestPermission();
    // системное окно запроса «усыпляет» звук на iPhone — будим его сразу после ответа
    const wake=()=>{ try{ if(AC && AC.state!=='running') AC.resume().catch(()=>{}); }catch(_){} };
    if(p && p.then) p.then(wake, wake);
  }catch(e){}
}
function showNote(title, body){
  const opts={body, icon:'icon-192.png', tag:'rest'};
  try{
    // на iPhone уведомления показываются только через Service Worker
    if(swReg && swReg.showNotification){ swReg.showNotification(title, opts).catch(()=>{}); return; }
    new Notification(title, opts);
  }catch(e){}
}
function signalRestEnd(){
  beep();
  try{ navigator.vibrate && navigator.vibrate([200,100,200]); }catch(e){}
  try{
    if(document.hidden && window.Notification && Notification.permission==='granted')
      showNote('Отдых окончен','Пора к следующему подходу');
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

/* ================== ПОДСКАЗКИ ЗАМЕТОК ==================
   Кнопка-лупа рядом с полем «Заметки» включает выпадающий список ранее введённых заметок.
   Сначала — заметки к этому же упражнению, затем самые частые. Состояние кнопки запоминается. */
const NOTES_KEY='fitness_notes_suggest';
let notesOn=false;
try{ notesOn=localStorage.getItem(NOTES_KEY)==='1'; }catch(e){}
function notesField(id, value, exRef){
  return `<label for="${id}">Заметки</label>
    <div class="note-row">
      <div class="autocomplete"><input id="${id}" data-notes="1" data-ex="${exRef||''}" value="${esc(value||'')}" placeholder="необязательно" autocomplete="off" autocorrect="off" enterkeyhint="done"><div class="suggest note-suggest"></div></div>
      <button type="button" class="icon-btn note-toggle${notesOn?' active':''}" data-act="notes-toggle" aria-label="Подсказки заметок">${I('search')}</button>
    </div>`;
}
function noteExName(inp){
  const ref=inp.dataset.ex && document.getElementById(inp.dataset.ex);
  if(!ref) return '';
  if(ref.tagName==='SELECT'){ const e=exById(+ref.value); return e ? e.name : ''; }
  return ref.value;
}
let noteList=[];
function renderNoteSuggest(inp){
  const box=inp.parentElement.querySelector('.note-suggest');
  if(!box) return;
  if(!notesOn){ box.classList.remove('show'); return; }
  const q=normKey(inp.value);
  const ex=exByName(noteExName(inp)), exId=ex ? ex.id : null;
  const m=new Map();
  DB.records.forEach(r=>{
    if(!r.notes) return;
    const k=normKey(r.notes);
    let x=m.get(k);
    if(!x){ x={text:cleanName(r.notes), n:0, nEx:0, last:0}; m.set(k,x); }
    x.n++; if(r.exId===exId) x.nEx++;
    if(r.ts>x.last){ x.last=r.ts; x.text=cleanName(r.notes); }
  });
  let list=[...m.entries()].filter(([k])=> q ? (k.includes(q) && k!==q) : true).map(([k,x])=>Object.assign({k},x));
  if(!q && exId) list=list.filter(x=>x.nEx>0);                 // пустое поле — только заметки к этому упражнению
  list.sort((a,b)=>
    (q ? (b.k.startsWith(q)-a.k.startsWith(q)) : 0) || (b.nEx-a.nEx) || (b.n-a.n) || (b.last-a.last));
  noteList=list.slice(0,6).map(x=>x.text);
  if(!noteList.length){ box.classList.remove('show'); return; }
  box.innerHTML=noteList.map((t,i)=>`<div class="suggest-item" data-note="${i}"><span>${esc(t)}</span></div>`).join('');
  box.classList.add('show');
}
function hideNoteSuggest(){ $$('.note-suggest').forEach(b=>b.classList.remove('show')); }
function toggleNotes(){
  notesOn=!notesOn;
  try{ localStorage.setItem(NOTES_KEY, notesOn?'1':'0'); }catch(e){}
  $$('.note-toggle').forEach(b=>b.classList.toggle('active', notesOn));
  const inp=document.querySelector('input[data-notes]:focus') || (notesOn ? null : null);
  if(!notesOn) hideNoteSuggest();
  else if(inp) renderNoteSuggest(inp);
  toast(notesOn ? 'Подсказки заметок включены' : 'Подсказки заметок выключены', null, null, 1800, notesOn?'search':null);
}
document.addEventListener('focusin', e=>{ if(e.target.matches && e.target.matches('input[data-notes]')) renderNoteSuggest(e.target); });
document.addEventListener('input', e=>{ if(e.target.matches && e.target.matches('input[data-notes]')) renderNoteSuggest(e.target); });
document.addEventListener('focusout', e=>{ if(e.target.matches && e.target.matches('input[data-notes]')) setTimeout(hideNoteSuggest, 250); });
document.addEventListener('keydown', e=>{
  if(e.key==='Enter' && e.target.matches && e.target.matches('input[data-notes]')){ e.preventDefault(); hideNoteSuggest(); e.target.blur(); }
});
document.addEventListener('mousedown', e=>{ if(e.target.closest('.note-suggest, .note-toggle')) e.preventDefault(); });
document.addEventListener('click', e=>{
  const it=e.target.closest('.note-suggest .suggest-item');
  if(!it) return;
  const inp=it.closest('.autocomplete').querySelector('input[data-notes]');
  const t=noteList[+it.dataset.note];
  if(inp && t!=null){ inp.value=t; hideNoteSuggest(); inp.blur(); }
});

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
      <div><label for="eWeight">Вес (кг)</label><input id="eWeight" inputmode="decimal" value="${esc(inVal(r.weight))}" placeholder="0"></div>
      <div><label for="eReps">Повторения</label><input id="eReps" inputmode="decimal" value="${esc(inVal(r.reps))}" placeholder="0"></div>
    </div>
    <div class="grid2">
      <div><label for="eSets">Подходы</label><input id="eSets" inputmode="decimal" value="${esc(inVal(r.sets))}" placeholder="0"></div>
      <div><label for="eTime">Время (мин)</label><input id="eTime" inputmode="decimal" value="${esc(minIn(r.time))}" placeholder="0"></div>
    </div>
    ${notesField('eNotes', r.notes||'', 'eEx')}
    <label class="check"><input type="checkbox" id="eWarm"${r.warm?' checked':''}>Разминка — не считать рабочим подходом</label>
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
  if(!checkLimits([['eWeight','weight'],['eReps','reps'],['eSets','sets'],['eTime','time']])) return;
  const vals={
    reps:num($('#eReps').value), sets:num($('#eSets').value),
    weight:num($('#eWeight').value), time:minOut($('#eTime').value),
    notes:$('#eNotes').value.trim(),
    warm:!!($('#eWarm') && $('#eWarm').checked)
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
  const maxR=recs.reduce((m,r)=>Math.max(m,r.reps||0),0);
  const pr=exPR(ex.id), nSets=workSets(recs).length, nW=new Set(recs.map(r=>r.wId)).size;
  const gaps=buildGaps();
  let html=`<div class="stats-summary">
    <div class="stats-box"><div class="lbl">Тренировок</div><div class="val">${nW}</div></div>
    <div class="stats-box"><div class="lbl">Рабочих подходов</div><div class="val">${nSets}</div></div>
    <div class="stats-box"><div class="lbl">${I('trophy','sm')}Макс. вес</div><div class="val">${maxW?fmtNum(maxW)+' кг':'—'}</div></div>
    <div class="stats-box"><div class="lbl">${I('trophy','sm')}1ПМ (расчёт)</div><div class="val">${pr.e1?'≈ '+fmtNum(round(pr.e1,1))+' кг':(maxR?fmtNum(maxR)+' повт':'—')}</div></div>
  </div>`;
  html+=sparkline(recs);
  if(pr.byW.size){
    const rows=[...pr.byW.entries()].sort((a,b)=>b[0]-a[0]).slice(0,12);
    html+=`<div class="section-head"><span>Рекорды по весам</span><span class="muted">лучший результат</span></div>
      <div class="card list-card">${rows.map(([w,b])=>`<div class="pr-row">
        <span class="pr-w">${fmtNum(w)} кг</span>
        <span class="pr-r">${fmtNum(b.reps)} ${plural(Math.round(b.reps),'повтор','повтора','повторов')}</span>
        <span class="pr-e muted">1ПМ ≈ ${fmtNum(round(e1rm(w,b.reps),1))}</span>
        <span class="pr-d muted">${fmtDM(b.ts)}</span></div>`).join('')}</div>
      <p class="muted" style="margin:6px 2px 4px">1ПМ — расчётный максимум на одно повторение (формула Эпли). Точнее всего при 1–12 повторах.</p>`;
  }
  html+=`<div class="section-head"><span>История</span></div>`;

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
    const best=r.weight && pr.byW.has(r.weight) && pr.byW.get(r.weight).id===r.id;
    html+=`<div class="rec-row" data-act="rec-edit" data-id="${r.id}">
      <div class="rec-main">
        <div class="rec-name">${r.warm?WARM_TAG:''}${esc(describe(r))||'—'}${best?' '+I('trophy','pr'):''}</div>
        <div class="rec-desc">${t?'тоннаж '+fmtTon(t):''}${r.notes?` <span class="note">«${esc(r.notes)}»</span>`:''}</div>
      </div>
      <div class="rec-side">${fmtTime(r.ts)}${gapHtml(gaps,r,'blk')}</div>
    </div>`;
  });
  html+='</div>';
  box.innerHTML=html;
}

// мини-график прогресса по дням (макс. вес, иначе повторы/время)
function sparkline(recs){
  const metric = recs.some(r=>r.weight && r.reps) ? ['e1','Расчётный 1ПМ по дням, кг']
               : recs.some(r=>r.weight) ? ['weight','Макс. вес по дням, кг']
               : recs.some(r=>r.reps)   ? ['reps','Макс. повторов по дням']
               : recs.some(r=>r.time)   ? ['time','Макс. время по дням, мин'] : null;
  if(!metric) return '';
  const byDay=new Map();
  recs.forEach(r=>{
    if(r.warm && metric[0]!=='time') return;
    let v = metric[0]==='e1' ? round(e1rm(r.weight,r.reps),1) : r[metric[0]];
    if(!v) return; if(metric[0]==='time') v=round(v/60,2);
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
    forEachItem(it=>{ if(it.exId===ex.id) it.exId=other.id; });
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
  let inProg=0; forEachItem(it=>{ if(it.exId===ex.id) inProg++; });
  if(!await ask(`Удалить упражнение «${esc(ex.name)}»${n?` и ${plural(n,'его','все его','все его')} ${n} ${plural(n,'запись','записи','записей')}`:''}?${inProg?` Оно также уберётся из программ (${inProg} ${plural(inProg,'раз','раза','раз')}).`:''} Отменить будет нельзя.`,'Удалить',true)) return;
  DB.records=DB.records.filter(r=>r.exId!==ex.id);
  DB.programs.forEach(p=>p.folders.forEach(f=>f.days.forEach(d=>{ d.items=d.items.filter(it=>it.exId!==ex.id); })));
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
  const gaps=buildGaps();

  let html=`<div class="sheet-head"><h2>Тренировка #${workoutNumber(id)}</h2><button class="icon-btn" data-act="close-modal" aria-label="Закрыть">${I('x')}</button></div>
    <div class="muted" style="margin-bottom:4px">${WD[d.getDay()]}, ${fmtDate(w.start)} · ${fmtTime(w.start)}${isActive(w)?' · <span class="badge">идёт</span>':''}</div>
    <button class="workout-plan w-label-btn" style="margin-bottom:12px" data-act="w-rename" data-id="${w.id}">${I('clip','sm')}${w.plan?esc(w.plan):'Добавить подпись'}${I('edit','sm')}</button>
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
      ${rs.map(r=>`<div class="set-line" data-act="rec-edit" data-id="${r.id}" data-w="${w.id}"><span class="num">${fmtTime(r.ts)}</span>${r.warm?WARM_TAG:''}${esc(describe(r))||'—'}${gapHtml(gaps,r)}${r.notes?`<span class="note">«${esc(r.notes)}»</span>`:''}</div>`).join('')}
    </div>`;
  }).join('');
  if(!recs.length) html+='<div class="empty">Записей пока нет</div>';
  else html+=`<p class="muted" style="margin:10px 2px 0">${I('pause','sm')}— отдых перед подходом (время от предыдущей записи). Нажмите на запись, чтобы исправить или удалить её.</p>`;
  html+=`<button class="btn big" style="margin-top:14px" data-act="w-addrec" data-id="${w.id}">${I('plus')}Добавить упражнение</button>`;
  if(recs.length) html+=`<div class="grid2" style="margin-top:10px">
    <button class="btn ghost" data-act="sum-share" data-id="${w.id}">${I('upload')}Картинка</button>
    <button class="btn ghost" data-act="w-export" data-id="${w.id}">${I('download')}Таблица</button></div>`;
  if(recs.length) html+=`<button class="btn ghost big" data-act="w-toprog" data-id="${w.id}">${I('clip')}Добавить в программу</button>`;
  const fin=!isActive(w);
  html+=`<div class="grid2" style="margin-top:10px">
    ${fin&&recs.length?`<button class="btn ghost" data-act="w-summary" data-id="${w.id}">${I('flag')}Итог</button>`:'<button class="btn ghost" data-act="close-modal">Закрыть</button>'}
    ${fin?`<button class="btn ghost" data-act="w-edit" data-id="${w.id}">${I('edit')}Дата и время</button>`:`<button class="btn danger" data-act="w-del" data-id="${w.id}">${I('trash')}Удалить</button>`}
  </div>
  ${fin?`<button class="btn danger big" data-act="w-del" data-id="${w.id}">${I('trash')}Удалить тренировку</button>`:''}`;
  openModal(html);
}
// добавить в тренировку забытое упражнение
function openRecAdd(wId){
  const w=wById(wId);
  if(!w){ closeModal(); return; }
  const recs=recsOfW(wId);
  let ts = isActive(w) ? Date.now() : (recs.length ? recs[recs.length-1].ts+60000 : w.start);
  if(!isActive(w) && w.timed && w.end) ts=Math.min(ts, w.end);
  const dl=DB.exercises.slice().sort((a,b)=>a.name.localeCompare(b.name,'ru')).map(e=>`<option value="${esc(e.name)}"></option>`).join('');
  openModal(`<div class="sheet-head"><h2>Добавить в тренировку #${workoutNumber(wId)}</h2>
      <button class="icon-btn" data-act="w-open" data-id="${wId}" aria-label="Назад">${I('x')}</button></div>
    <label for="eExName">Упражнение</label>
    <input id="eExName" list="exDL2" placeholder="Начните вводить..." autocomplete="off" autocapitalize="sentences">
    <datalist id="exDL2">${dl}</datalist>
    <label for="eTs">Дата и время</label>
    <input id="eTs" type="datetime-local" value="${toInputDT(ts)}">
    <div class="grid2">
      <div><label for="eWeight">Вес (кг)</label><input id="eWeight" inputmode="decimal" placeholder="0"></div>
      <div><label for="eReps">Повторения</label><input id="eReps" inputmode="decimal" placeholder="0"></div>
    </div>
    <div class="grid2">
      <div><label for="eSets">Подходы</label><input id="eSets" inputmode="decimal" placeholder="0"></div>
      <div><label for="eTime">Время (мин)</label><input id="eTime" inputmode="decimal" placeholder="0"></div>
    </div>
    ${notesField('eNotes','','eExName')}
    <label class="check"><input type="checkbox" id="eWarm">Разминка — не считать рабочим подходом</label>
    <div class="grid2" style="margin-top:16px">
      <button class="btn ghost" data-act="w-open" data-id="${wId}">Отмена</button>
      <button class="btn ok" data-act="w-addrec-save" data-id="${wId}">${I('save')}Добавить</button>
    </div>`);
  $('#eExName').focus();
}
function saveRecAdd(wId){
  const w=wById(wId);
  if(!w){ closeModal(); return; }
  const nameInp=$('#eExName'), name=cleanName(nameInp.value);
  if(!name){ markBad(nameInp,true); toast('Введите название упражнения'); nameInp.focus(); return; }
  const ts=fromInputDT($('#eTs').value);
  if(!ts){ toast('Укажите дату и время'); return; }
  if(!checkLimits([['eWeight','weight'],['eReps','reps'],['eSets','sets'],['eTime','time']])) return;
  const vals={weight:num($('#eWeight').value), reps:num($('#eReps').value), sets:num($('#eSets').value),
    time:minOut($('#eTime').value), notes:$('#eNotes').value.trim(), warm:!!($('#eWarm') && $('#eWarm').checked)};
  if(!vals.reps && !vals.sets && !vals.weight && !vals.time && !vals.notes){ toast('Заполните хотя бы одно поле'); return; }
  const ex=getOrCreateEx(name);
  DB.records.push(Object.assign({id:nid('rec'), exId:ex.id, wId:w.id, ts}, vals));
  // время записи за пределами замеренной тренировки — расширяем её границы
  if(!isActive(w) && w.timed && w.end){
    if(ts<w.start) w.start=ts;
    if(ts>w.end) w.end=ts;
  }
  cleanupWorkouts(); save();
  openWorkout(w.id); refresh();
  toast(`Добавлено: ${ex.name}`, null, null, null, 'check');
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
    DB.active.wId=null; DB.active.plan=null;
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
  warn.innerHTML=backupWarnHtml();
  if(statsMode==='measures'){ top.innerHTML=''; body.innerHTML=measuresHtml(); return; }

  const ws=sortedWorkouts();
  if(!ws.length){
    top.innerHTML='';
    body.innerHTML='<div class="empty">Пока нет тренировок.<br>Сохраните первую запись или загрузите таблицу.</div>';
    return;
  }
  const finished=ws.filter(w=>!isActive(w) && w.timed && w.end);
  const avg=finished.length ? finished.reduce((a,w)=>a+wDur(w),0)/finished.length : 0;
  const month=ws.filter(w=>w.start>Date.now()-30*DAY).length;
  const totalTon=DB.records.reduce((a,r)=>a+ton(r),0);
  top.innerHTML=`<div class="stats-summary">
    <div class="stats-box"><div class="lbl">Тренировок</div><div class="val">${ws.length}</div></div>
    <div class="stats-box"><div class="lbl">За 30 дней</div><div class="val">${month}</div></div>
    <div class="stats-box"><div class="lbl">${I('clock','sm')}Средняя длит.</div><div class="val">${avg?fmtDur(avg):'—'}</div></div>
    <div class="stats-box"><div class="lbl">${I('dumbbell','sm')}Тоннаж всего</div><div class="val">${totalTon?fmtTon(totalTon):'—'}</div></div>
  </div>${weeklyHtml()}`;
  body.innerHTML = statsMode==='table' ? tableHtml(ws) : cardsHtml(ws);
}

/* ---- тоннаж по неделям: столбики за 12 недель, нажатие — подробности недели ---- */
let WEEKS=[];
function weekStart(ms){ const d=new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()-((d.getDay()+6)%7)).getTime(); }
function weeklyHtml(){
  if(!DB.records.length) return '';
  const cur=weekStart(Date.now());
  const first=weekStart(DB.records.reduce((m,r)=>Math.min(m,r.ts), Infinity));
  // от первой записи, но не меньше 4 и не больше 12 недель
  const N=Math.max(4, Math.min(12, Math.round((cur-first)/(7*DAY))+1));
  WEEKS=[];
  for(let i=N-1;i>=0;i--){ const st=new Date(cur); st.setDate(st.getDate()-7*i); WEEKS.push({start:st.getTime(), ton:0, w:new Set()}); }
  const idx=new Map(WEEKS.map((x,i)=>[x.start,i]));
  DB.records.forEach(r=>{ const i=idx.get(weekStart(r.ts)); if(i==null) return; WEEKS[i].ton+=ton(r); WEEKS[i].w.add(r.wId); });
  const max=Math.max(...WEEKS.map(x=>x.ton));
  if(!max) return '';
  const W=300, H=100, gap=4, bw=(W-gap*(N-1))/N, rad=3;
  const bars=WEEKS.map((x,i)=>{
    const h=x.ton ? Math.max(3, x.ton/max*(H-4)) : 0, X=i*(bw+gap), Y=H-h;
    const path = h ? `M${X},${H}V${Y+rad}Q${X},${Y} ${X+rad},${Y}H${X+bw-rad}Q${X+bw},${Y} ${X+bw},${Y+rad}V${H}Z` : '';
    return `<g class="wk-bar${i===N-1?' sel':''}" data-act="wk" data-i="${i}">
      <rect x="${X-gap/2}" y="0" width="${bw+gap}" height="${H}" fill="transparent"/>
      ${h?`<path d="${path}"/>`:`<rect x="${X}" y="${H-1}" width="${bw}" height="1" class="wk-zero"/>`}</g>`;
  }).join('');
  const step=N<=6?1:3;
  const lbl=WEEKS.map((x,i)=>`<span>${(N-1-i)%step===0?fmtDM(x.start):''}</span>`).join('');
  return `<div class="card wk-card">
    <div class="wk-head"><span class="wk-title">Тоннаж по неделям</span><span class="muted" id="wkCap">${wkCaption(N-1)}</span></div>
    <svg class="wk-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${bars}</svg>
    <div class="wk-labels" style="grid-template-columns:repeat(${N},1fr)">${lbl}</div>
  </div>`;
}
function wkCaption(i){
  const x=WEEKS[i]; if(!x) return '';
  const end=x.start+6*DAY, n=x.w.size;
  return `${fmtDM(x.start)}–${fmtDM(end)}: <b>${x.ton?fmtTon(x.ton):'0'}</b> · ${n} ${plural(n,'трен.','трен.','трен.')}`;
}
function selectWeek(i){
  $$('.wk-bar').forEach(g=>g.classList.toggle('sel', +g.dataset.i===i));
  const c=$('#wkCap'); if(c) c.innerHTML=wkCaption(i);
}

/* ================== ЗАМЕРЫ ТЕЛА ================== */
const MKINDS=[
  {k:'weight',   name:'Вес тела',          short:'Вес',     unit:'кг'},
  {k:'fat',      name:'Процент жира',      short:'Жир',     unit:'%'},
  {k:'neck',     name:'Шея',               short:'Шея',     unit:'см'},
  {k:'shoulders',name:'Плечи',             short:'Плечи',   unit:'см'},
  {k:'chest',    name:'Грудь',             short:'Грудь',   unit:'см'},
  {k:'waist',    name:'Талия',             short:'Талия',   unit:'см'},
  {k:'hips',     name:'Таз (ягодицы)',     short:'Таз',     unit:'см'},
  {k:'biceps_r', name:'Бицепс правый',     short:'Бицепс',  unit:'см'},
  {k:'biceps_l', name:'Бицепс левый',      short:'Бицепс',  unit:'см'},
  {k:'forearm_r',name:'Предплечье правое', short:'Предпл.', unit:'см'},
  {k:'forearm_l',name:'Предплечье левое',  short:'Предпл.', unit:'см'},
  {k:'thigh_r',  name:'Бедро правое',      short:'Бедро',   unit:'см'},
  {k:'thigh_l',  name:'Бедро левое',       short:'Бедро',   unit:'см'},
  {k:'calf_r',   name:'Голень правая',     short:'Голень',  unit:'см'},
  {k:'calf_l',   name:'Голень левая',      short:'Голень',  unit:'см'},
  // старые мерки без стороны — показываются, только если в них уже есть записи
  {k:'biceps',   name:'Бицепс (без стороны)',     unit:'см', legacy:true},
  {k:'forearm',  name:'Предплечье (без стороны)', unit:'см', legacy:true},
  {k:'thigh',    name:'Бедро (без стороны)',      unit:'см', legacy:true},
  {k:'calf',     name:'Голень (без стороны)',     unit:'см', legacy:true}
];
function allKinds(){ return MKINDS.concat(DB.mkinds); }
function isCustomKind(k){ return DB.mkinds.some(x=>x.k===k); }
function visibleKinds(){ return allKinds().filter(k=>!k.legacy || DB.measures.some(m=>m.k===k.k)); }
function kindOf(k){ return allKinds().find(x=>x.k===k); }
function mValues(k){ return DB.measures.filter(m=>m.k===k).sort((a,b)=>a.ts-b.ts); }
function fmtM(v, unit){ return fmtNum(v)+(unit?' '+unit:''); }
function deltaHtml(vals, unit){
  if(vals.length<2) return '';
  const d=round(vals[vals.length-1].v-vals[vals.length-2].v, 2);
  if(!d) return '<span class="m-delta">без изменений</span>';
  return `<span class="m-delta">${d>0?'▲ +':'▼ −'}${fmtNum(Math.abs(d))} ${unit}</span>`;
}
// старые записи «Вес» как упражнения — предложить перенести в замеры
function weightExercise(){
  return DB.exercises.find(e=>['вес','вес тела','масса тела','взвешивание'].includes(normKey(e.name)) && DB.records.some(r=>r.exId===e.id));
}
/* Силуэт. Правая сторона тела — справа на экране (как смотришь на себя с телефоном в руках).
   Вместо закрашенных областей — линии обхвата: где именно мерить. Синяя линия — замер есть,
   серая пунктирная — ещё нет. Нажатие на линию или подпись открывает мерку. */
// контур правой половины тела (x>150), сверху вниз; левая половина — зеркально
const BODY_HALF=[[150,56],[159,58],[161,70],[176,76],[192,80],[204,86],[210,98],[213,114],[214,130],[216,150],[218,163],[222,180],
  [226,205],[228,222],[232,232],[233,246],[227,253],[221,248],[219,234],[216,222],[211,200],[206,178],[203,163],[200,142],[196,113],
  [194,126],[190,150],[186,172],[188,193],[194,212],[196,230],[196,252],[192,282],[187,312],[185,324],[189,346],[186,372],[180,392],
  [185,404],[170,408],[165,402],[166,392],[164,378],[162,350],[162,320],[158,282],[154,252],[150,242]];
function smoothClosed(pts){
  const n=pts.length, P=i=>pts[(i+n)%n];
  let d=`M${pts[0][0]},${pts[0][1]}`;
  for(let i=0;i<n;i++){
    const p0=P(i-1), p1=P(i), p2=P(i+1), p3=P(i+2), t=0.5/3*2;
    const c1=[p1[0]+(p2[0]-p0[0])*t/2, p1[1]+(p2[1]-p0[1])*t/2];
    const c2=[p2[0]-(p3[0]-p1[0])*t/2, p2[1]-(p3[1]-p1[1])*t/2];
    d+=`C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0]},${p2[1]}`;
  }
  return d+'Z';
}
function bodyOutline(){
  const right=BODY_HALF, left=right.slice(1,-1).reverse().map(([x,y])=>[300-x,y]);
  return smoothClosed(right.concat(left));
}
// линии обхвата: [x1, x2, y], подпись [x, y, выравнивание]
const BODY_ZONES=[
  {k:'neck',      x1:139.5, x2:160.5, y:65,  lab:[176,58,'start']},
  {k:'shoulders', x1:93,    x2:207,   y:93,  lab:[236,86,'start']},
  {k:'chest',     x1:105,   x2:195,   y:120, lab:[150,120,'middle']},
  {k:'waist',     x1:114,   x2:186,   y:172, lab:[150,172,'middle']},
  {k:'hips',      x1:106,   x2:194,   y:215, lab:[150,215,'middle']},
  {k:'biceps_r',  x1:199.5, x2:214.5, y:135, lab:[238,135,'start']},
  {k:'biceps_l',  x1:85.5,  x2:100.5, y:135, lab:[62,135,'end']},
  {k:'forearm_r', x1:207.5, x2:222.8, y:186, lab:[240,190,'start']},
  {k:'forearm_l', x1:77.2,  x2:92.5,  y:186, lab:[60,190,'end']},
  {k:'thigh_r',   x1:155.5, x2:194.5, y:265, lab:[204,280,'start']},
  {k:'thigh_l',   x1:105.5, x2:144.5, y:265, lab:[96,280,'end']},
  {k:'calf_r',    x1:162,   x2:188.5, y:347, lab:[198,350,'start']},
  {k:'calf_l',    x1:111.5, x2:138,   y:347, lab:[102,350,'end']}
];
function bodySvg(){
  const zones=BODY_ZONES.map(z=>{
    const kd=kindOf(z.k), vals=mValues(z.k), l=vals[vals.length-1];
    const d=vals.length>1 ? round(vals[vals.length-1].v-vals[vals.length-2].v,1) : 0;
    const [x,y,a]=z.lab, mid=(z.x1+z.x2)/2, bulge=Math.max(2.5,(z.x2-z.x1)*0.07);
    const inside = a==='middle';
    // зона нажатия: линия + подпись
    const hx1=Math.min(z.x1-4, a==='end'?x-46:x-24), hx2=Math.max(z.x2+4, a==='start'?x+50:x+24);
    return `<g class="bz${l?' has':''}" data-act="m-open" data-k="${z.k}">
      <rect x="${hx1}" y="${Math.min(z.y,y)-17}" width="${hx2-hx1}" height="${Math.abs(z.y-y)+32}" fill="transparent"/>
      <path class="bz-back" d="M${z.x1},${z.y} Q${mid},${z.y-bulge*1.6} ${z.x2},${z.y}"/>
      <path class="bz-line" d="M${z.x1},${z.y} Q${mid},${z.y+bulge*2} ${z.x2},${z.y}"/>
      <text x="${x}" y="${inside?y-6:y-4}" text-anchor="${a}" class="bz-n">${esc(kd.short)}</text>
      <text x="${x}" y="${inside?y+15:y+10}" text-anchor="${a}" class="bz-v">${l?fmtNum(l.v):'+'}${d?`<tspan class="bz-d"> ${d>0?'+':'−'}${fmtNum(Math.abs(d))}</tspan>`:''}</text>
    </g>`;
  }).join('');
  return `<svg class="body-svg" viewBox="0 0 300 414" role="img" aria-label="Замеры тела">
    <text x="16" y="16" class="bz-side">ЛЕВАЯ</text><text x="284" y="16" text-anchor="end" class="bz-side">ПРАВАЯ</text>
    <g class="body-base">
      <ellipse cx="150" cy="34" rx="18" ry="22"/>
      <path d="${bodyOutline()}"/>
    </g>
    <g class="body-detail">
      <path d="M150,96 V236"/><path d="M118,104 Q134,112 148,106"/><path d="M182,104 Q166,112 152,106"/>
      <path d="M126,142 Q150,150 174,142"/>
    </g>
    ${zones}
  </svg>`;
}
function measuresHtml(){
  const wx=weightExercise();
  let html = wx ? `<div class="warn-line" data-act="m-migrate">${I('alert')}<span>Вес тела записан как упражнение «${esc(wx.name)}» (${DB.records.filter(r=>r.exId===wx.id).length} зап.) — нажмите, чтобы перенести в замеры. Тренировки с ним перестанут считаться тренировками.</span></div>` : '';
  // вес и жир — плитками
  html+='<div class="stats-summary">'+['weight','fat'].map(k=>{
    const kd=kindOf(k), v=mValues(k), l=v[v.length-1];
    return `<div class="stats-box m-tile" data-act="m-open" data-k="${k}"><div class="lbl">${esc(kd.name)}</div>
      <div class="val">${l?fmtM(l.v,kd.unit):'—'}</div><div class="m-tile-d">${l?fmtDate(l.ts)+' '+deltaHtml(v,kd.unit):'нажмите, чтобы записать'}</div></div>`;
  }).join('')+'</div>';
  html+=`<div class="card body-card">${bodySvg()}
    <p class="muted body-hint">Линии показывают, где мерить обхват. Нажмите на линию или подпись — запишете замер и увидите прогресс.</p></div>`;
  html+=`<button class="btn big" data-act="m-add-all">${I('plus')}Записать все замеры сразу</button>`;
  // свои мерки и старые без стороны
  const extra=visibleKinds().filter(k=>k.legacy || isCustomKind(k.k));
  if(extra.length){
    html+=`<div class="section-head"><span>Другие мерки</span></div><div class="card list-card">`;
    extra.forEach(kd=>{
      const vals=mValues(kd.k), last=vals[vals.length-1];
      html+=`<div class="rec-row" data-act="m-open" data-k="${esc(kd.k)}">
        <div class="rec-main"><div class="rec-name">${esc(kd.name)}</div>
          <div class="rec-desc">${last?`${fmtDate(last.ts)} ${deltaHtml(vals, kd.unit)}`:'нет замеров'}</div></div>
        <div class="m-val">${last?fmtM(last.v, kd.unit):'—'}</div><div class="chev">${I('chev')}</div></div>`;
    });
    html+='</div>';
  }
  html+=`<button class="btn ghost big" data-act="m-kind-add">${I('plus')}Своя мерка</button>
    <p class="muted" style="margin:10px 2px">Обхваты удобнее мерить утром, в одном и том же месте, не напрягая мышцы.</p>`;
  return html;
}
function mChart(vals, unit){
  if(vals.length<2) return '';
  const pts=vals.slice(-40), W=300, H=80, P=6;
  const t0=pts[0].ts, t1=pts[pts.length-1].ts, mn=Math.min(...pts.map(p=>p.v)), mx=Math.max(...pts.map(p=>p.v));
  const xy=pts.map(p=>[P+(t1===t0?0.5:(p.ts-t0)/(t1-t0))*(W-2*P), H-P-(mx===mn?0.5:(p.v-mn)/(mx-mn))*(H-2*P)]);
  return `<div class="card spark" style="background:var(--card2)">
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:80px">
      <polyline points="${xy.map(p=>p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ')}" fill="none" stroke="#4f8cff" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
      ${xy.map(p=>`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.5" fill="#4f8cff"/>`).join('')}
    </svg>
    <div class="spark-range"><span>${fmtDM(t0)}</span><span>мин ${fmtM(mn,unit)} · макс ${fmtM(mx,unit)}</span><span>${fmtDM(t1)}</span></div>
  </div>`;
}
function openMeasure(k){
  const kd=kindOf(k); if(!kd) return;
  const vals=mValues(k), last=vals[vals.length-1], first=vals[0];
  const total = vals.length>1 ? round(last.v-first.v,2) : 0;
  openModal(`<div class="sheet-head"><h2>${esc(kd.name)}</h2>${closeX()}</div>
    ${last?`<div class="stats-summary">
      <div class="stats-box"><div class="lbl">Сейчас</div><div class="val">${fmtM(last.v,kd.unit)}</div></div>
      <div class="stats-box"><div class="lbl">С ${fmtDM(first.ts)}</div><div class="val">${vals.length>1?(total>0?'+':total<0?'−':'')+fmtNum(Math.abs(total))+' '+kd.unit:'—'}</div></div>
    </div>`:''}
    ${mChart(vals, kd.unit)}
    <div class="grid2">
      <div><label for="mVal">Значение, ${esc(kd.unit)}</label><input id="mVal" inputmode="decimal" placeholder="${last?esc(inVal(last.v)):'0'}" data-enter="m-save"></div>
      <div><label for="mTs">Дата</label><input id="mTs" type="date" value="${dayKey(Date.now())}"></div>
    </div>
    <button class="btn ok big" data-act="m-save" data-k="${esc(k)}">${I('save')}Сохранить замер</button>
    ${vals.length?`<div class="section-head"><span>История</span><span class="muted">нажмите, чтобы удалить</span></div>
    <div class="card list-card">${vals.slice().reverse().map((m,i,a)=>{
      const prev=a[i+1], d=prev?round(m.v-prev.v,2):0;
      return `<div class="rec-row" data-act="m-del" data-id="${m.id}">
        <div class="rec-main"><div class="rec-name">${fmtM(m.v,kd.unit)}</div>
          <div class="rec-desc">${prev&&d?(d>0?'+':'−')+fmtNum(Math.abs(d))+' '+kd.unit:''}</div></div>
        <div class="rec-side">${fmtDate(m.ts)}</div></div>`;}).join('')}</div>`:''}
    ${isCustomKind(k)?`<button class="btn danger big" data-act="m-kind-del" data-k="${esc(k)}">${I('trash')}Удалить мерку</button>`:''}`);
}
function mDateTs(s){ const m=String(s||'').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? new Date(+m[1],+m[2]-1,+m[3],12,0).getTime() : null; }
function mValOk(inp){
  const raw=String(inp.value||'').replace(/[\s ]/g,'').replace(',','.');
  if(!raw) return null;
  const v=Number(raw);
  if(!isFinite(v) || v<=0 || v>1000){ markBad(inp,true); return false; }
  markBad(inp,false); return round(v,2);
}
function addMeasure(k, v, ts){
  // в один день по одной мерке — одно значение (новое заменяет)
  DB.measures=DB.measures.filter(m=>!(m.k===k && dayKey(m.ts)===dayKey(ts)));
  DB.measures.push({id:nid('m'), k, ts, v});
}
function saveMeasure(k){
  const inp=$('#mVal'), v=mValOk(inp);
  if(v===false){ toast('Значение — от 0 до 1000', null, null, 3000, 'alert'); return; }
  if(v==null){ markBad(inp,true); toast('Введите значение'); inp.focus(); return; }
  const ts=mDateTs($('#mTs').value) || Date.now();
  addMeasure(k, v, ts); save();
  openMeasure(k); if(curView==='stats') renderStats();
  toast('Замер сохранён', null, null, null, 'check');
}
async function delMeasure(id){
  const m=DB.measures.find(x=>x.id===id); if(!m) return;
  const kd=kindOf(m.k);
  if(!await ask(`Удалить замер ${fmtM(m.v, kd?kd.unit:'')} от ${fmtDate(m.ts)}?`,'Удалить',true)) return;
  DB.measures=DB.measures.filter(x=>x.id!==id); save();
  openMeasure(m.k); if(curView==='stats') renderStats();
}
function openMeasureAll(){
  openModal(`<div class="sheet-head"><h2>Записать замеры</h2>${closeX()}</div>
    <label for="maTs">Дата</label><input id="maTs" type="date" value="${dayKey(Date.now())}">
    <p class="muted" style="margin:8px 2px 0">Заполните только то, что мерили. В скобках — прошлое значение.</p>
    <div class="grid2">${visibleKinds().map(kd=>{ const v=mValues(kd.k), last=v[v.length-1];
      return `<div><label for="ma_${esc(kd.k)}">${esc(kd.name)}, ${esc(kd.unit)}</label>
        <input id="ma_${esc(kd.k)}" class="ma-inp" data-k="${esc(kd.k)}" inputmode="decimal" placeholder="${last?'('+esc(inVal(last.v))+')':'—'}"></div>`; }).join('')}</div>
    <button class="btn ok big" style="margin-top:16px" data-act="m-save-all">${I('save')}Сохранить</button>`);
}
function saveMeasureAll(){
  const ts=mDateTs($('#maTs').value) || Date.now();
  const got=[]; let bad=false;
  $$('.ma-inp').forEach(inp=>{ const v=mValOk(inp); if(v===false) bad=true; else if(v!=null) got.push([inp.dataset.k, v]); });
  if(bad){ toast('Проверьте выделенные поля: значение от 0 до 1000', null, null, 3500, 'alert'); return; }
  if(!got.length){ toast('Заполните хотя бы один замер'); return; }
  got.forEach(([k,v])=>addMeasure(k,v,ts)); save();
  closeModal(); renderStats();
  toast(`Сохранено замеров: ${got.length}`, null, null, null, 'check');
}
function addMeasureKind(){
  openModal(`<h2>Своя мерка</h2>
    <label for="mkName">Название</label><input id="mkName" placeholder="Например: Бицепс левый" autocomplete="off" autocapitalize="sentences">
    <label for="mkUnit">Единица</label><input id="mkUnit" value="см" autocomplete="off">
    <div class="grid2" style="margin-top:14px">
      <button class="btn ghost" data-act="close-modal">Отмена</button>
      <button class="btn" data-act="m-kind-save">Создать</button>
    </div>`);
  $('#mkName').focus();
}
function saveMeasureKind(){
  const name=cleanName($('#mkName').value), unit=cleanName($('#mkUnit').value)||'см';
  if(!name){ markBad($('#mkName'),true); toast('Введите название'); return; }
  if(allKinds().some(k=>normKey(k.name)===normKey(name))){ toast('Такая мерка уже есть'); return; }
  const k='custom_'+nid('m');
  DB.mkinds.push({k, name, unit}); save();
  closeModal(); renderStats(); openMeasure(k);
}
async function delMeasureKind(k){
  const kd=kindOf(k); if(!kd || !isCustomKind(k)) return;
  const n=mValues(k).length;
  if(!await ask(`Удалить мерку «${esc(kd.name)}»${n?` и ${n} ${plural(n,'замер','замера','замеров')}`:''}?`,'Удалить',true)) return;
  DB.mkinds=DB.mkinds.filter(x=>x.k!==k); DB.measures=DB.measures.filter(m=>m.k!==k); save();
  closeModal(); renderStats();
}
async function migrateWeight(){
  const ex=weightExercise(); if(!ex) return;
  const recs=DB.records.filter(r=>r.exId===ex.id && r.weight);
  if(!await ask(`Перенести ${recs.length} ${plural(recs.length,'запись','записи','записей')} из упражнения «${esc(ex.name)}» в замеры «Вес тела»? Упражнение будет удалено.`,'Перенести')) return;
  recs.forEach(r=>addMeasure('weight', r.weight, r.ts));
  DB.records=DB.records.filter(r=>r.exId!==ex.id);
  DB.programs.forEach(p=>p.folders.forEach(f=>f.days.forEach(d=>{ d.items=d.items.filter(it=>it.exId!==ex.id); })));
  DB.exercises=DB.exercises.filter(e=>e.id!==ex.id);
  cleanupWorkouts(); save(); renderWorkoutBar(); renderStats();
  toast('Вес тела перенесён в замеры', null, null, null, 'check');
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
      ${w.plan?`<div class="workout-plan">${I('clip','sm')}${esc(w.plan)}</div>`:''}
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

/* ================== ПРОГРАММЫ: МОДЕЛЬ ================== */
function allDays(){ const out=[]; DB.programs.forEach(p=>p.folders.forEach(f=>f.days.forEach(d=>out.push({p,f,d})))); return out; }
function findDay(id){ return allDays().find(x=>x.d.id===id) || null; }
function progById(id){ return DB.programs.find(p=>p.id===id); }
function findFolder(id){ for(const p of DB.programs) for(const f of p.folders) if(f.id===id) return {p,f}; return null; }
function forEachItem(fn){ DB.programs.forEach(p=>p.folders.forEach(f=>f.days.forEach(d=>d.items.forEach(fn)))); }
function progStats(p){
  let days=0, items=0;
  p.folders.forEach(f=>{ days+=f.days.length; f.days.forEach(d=>{ items+=d.items.length; }); });
  return {folders:p.folders.length, days, items};
}
function hasPlanDays(){ return DB.programs.some(p=>p.folders.some(f=>f.days.length)); }
function validatePlan(){
  if(DB.active.plan && (!DB.active.wId || !findDay(DB.active.plan.dayId))) DB.active.plan=null;
}
// упражнения, на которые ссылаются программы, должны существовать
function fixProgramRefs(){
  const ids=new Set(DB.exercises.map(e=>e.id));
  DB.programs.forEach(p=>p.folders.forEach(f=>f.days.forEach(d=>{ d.items=d.items.filter(it=>ids.has(it.exId)); })));
  validatePlan();
}
// «Неделя 1» → «Неделя 2», «Верх» → «Верх 2»; результат не совпадает ни с одним именем из list
function nextName(name, list){
  const taken=new Set((list||[]).map(normKey));
  let nm=name;
  do{
    const m=nm.match(/^(.*?)(\d+)(\D*)$/);
    nm = m ? m[1]+(+m[2]+1)+m[3] : nm+' 2';
  }while(taken.has(normKey(nm)));
  return nm;
}
function uniqueName(name, list){
  return (list||[]).some(x=>normKey(x)===normKey(name)) ? nextName(name, list) : name;
}
function copyItems(items){ return items.map(it=>Object.assign({}, it)); }
function cloneFolder(f, name){
  return {id:nid('prog'), name, days:f.days.map(d=>({id:nid('prog'), name:d.name, items:copyItems(d.items)}))};
}
const closeX = () => `<button class="icon-btn" data-act="close-modal" aria-label="Закрыть">${I('x')}</button>`;

/* ---- универсальный ввод названия ---- */
let nameCb=null;
function openNameSheet(title, value, placeholder, cb, okLabel){
  nameCb=cb;
  openModal(`<h2>${esc(title)}</h2>
    <input id="nameInp" value="${esc(value||'')}" placeholder="${esc(placeholder||'')}" autocomplete="off" autocapitalize="sentences" data-enter="name-save">
    <div class="grid2" style="margin-top:14px">
      <button class="btn ghost" data-act="close-modal">Отмена</button>
      <button class="btn" data-act="name-save">${esc(okLabel||'Сохранить')}</button>
    </div>`);
  const i=$('#nameInp'); i.focus(); try{ i.setSelectionRange(0,i.value.length); }catch(e){}
}
function nameSave(){
  const inp=$('#nameInp'); if(!inp) return;
  const v=cleanName(inp.value);
  if(!v){ markBad(inp,true); toast('Введите название'); return; }
  const cb=nameCb; nameCb=null;
  closeModal();
  if(cb) cb(v);
}

/* ================== ПРОГРАММЫ: ЭКРАНЫ ================== */
let curProg=null;

function renderProgList(){
  const box=$('#progList');
  const tools=`<div class="data-row">
      ${DB.programs.length
        ? `<button class="btn ghost sm" data-act="prog-export-all">${I('upload')}Выгрузить все</button>`
        : `<button class="btn ghost sm" data-act="prog-template">${I('copy')}Шаблон для Excel</button>`}
      <button class="btn ghost sm" data-act="import" data-kind="program">${I('download')}Загрузить</button>
    </div>`;
  if(!DB.programs.length){
    box.innerHTML=tools+`<div class="empty">Пока нет программ.<br>Нажмите +, чтобы создать программу, добавьте прошедшую тренировку из «Статистики» или загрузите таблицу.</div>`;
    return;
  }
  const live=DB.active.plan ? findDay(DB.active.plan.dayId) : null;
  box.innerHTML=tools+DB.programs.map(p=>{
    const s=progStats(p);
    return `<div class="ex-item" data-act="prog-open" data-id="${p.id}">
      <div class="ex-text"><div class="name">${esc(p.name)}${live && live.p===p?' <span class="badge">идёт</span>':''}</div>
        <div class="count">${s.folders} ${plural(s.folders,'папка','папки','папок')} · ${s.days} ${plural(s.days,'тренировка','тренировки','тренировок')}</div></div>
      <div class="chev">${I('chev')}</div></div>`;
  }).join('');
}

function openProgram(id){ curProg=id; showView('program'); renderProgram(); }

function renderProgram(){
  const p=progById(curProg);
  if(!p){ curProg=null; go('prog'); return; }
  $('#progTitle').textContent=p.name;
  const liveId=DB.active.plan ? DB.active.plan.dayId : null;
  let html='';
  if(!p.folders.length) html+='<div class="empty">В программе пока нет папок.<br>Папка — это, например, «Неделя 1».</div>';
  p.folders.forEach(f=>{
    html+=`<div class="folder-head"><span>${I('folder')}${esc(f.name)}</span>
      <button class="icon-btn sm" data-act="folder-menu" data-id="${f.id}" aria-label="Действия с папкой">${I('more')}</button></div>
      <div class="card list-card">`;
    f.days.forEach(d=>{
      const names=d.items.map(it=>{ const e=exById(it.exId); return e?e.name:'?'; });
      html+=`<div class="rec-row" data-act="day-open" data-id="${d.id}">
        <div class="rec-main"><div class="rec-name">${esc(d.name)}${d.id===liveId?' <span class="badge">идёт</span>':''}</div>
          <div class="rec-desc day-names">${d.items.length} упр.${names.length?' · '+esc(names.join(', ')):''}</div></div>
        <div class="chev">${I('chev')}</div></div>`;
    });
    html+=`<div class="rec-row add-row" data-act="day-add" data-id="${f.id}">${I('plus')}Добавить тренировку</div></div>`;
  });
  html+=`<button class="btn ghost big" data-act="folder-add">${I('folder')}Новая папка</button>`;
  $('#progBody').innerHTML=html;
}

function openProgMenu(){
  const p=progById(curProg); if(!p) return;
  openModal(`<h2>${esc(p.name)}</h2>
    <button class="btn ghost big" data-act="prog-rename">${I('edit')}Переименовать</button>
    <button class="btn ghost big" data-act="folder-add">${I('folder')}Новая папка</button>
    <button class="btn ghost big" data-act="prog-copy">${I('copy')}Сделать копию программы</button>
    <button class="btn ghost big" data-act="prog-export" data-id="${p.id}">${I('upload')}Выгрузить программу</button>
    <button class="btn danger big" data-act="prog-del">${I('trash')}Удалить программу</button>
    <button class="btn ghost big" data-act="close-modal">Отмена</button>`);
}
function newProgram(){
  openNameSheet('Новая программа', '', 'Например: Верх / Низ', name=>{
    const p={id:nid('prog'), name:uniqueName(name, DB.programs.map(x=>x.name)), folders:[{id:nid('prog'), name:'Неделя 1', days:[]}]};
    DB.programs.push(p); save();
    openProgram(p.id);
  }, 'Создать');
}
function renameProgram(){
  const p=progById(curProg); if(!p) return;
  openNameSheet('Переименовать программу', p.name, '', name=>{
    p.name=uniqueName(name, DB.programs.filter(x=>x!==p).map(x=>x.name));
    save(); renderProgram(); toast('Переименовано');
  });
}
function copyProgram(){
  const p=progById(curProg); if(!p) return;
  const c={id:nid('prog'), name:nextName(p.name, DB.programs.map(x=>x.name)), folders:p.folders.map(f=>cloneFolder(f, f.name))};
  DB.programs.splice(DB.programs.indexOf(p)+1, 0, c);
  save(); closeModal(); openProgram(c.id);
  toast('Создана копия программы', null, null, null, 'check');
}
async function deleteProgram(){
  const p=progById(curProg); if(!p) return;
  const s=progStats(p);
  if(!await ask(`Удалить программу «${esc(p.name)}» (${s.days} ${plural(s.days,'тренировка','тренировки','тренировок')})? Записи о проведённых тренировках останутся.`,'Удалить',true)) return;
  DB.programs=DB.programs.filter(x=>x!==p);
  validatePlan(); save(); closeModal();
  curProg=null; go('prog');
  toast('Программа удалена');
}

/* ---- папки ---- */
function addFolder(){
  const p=progById(curProg); if(!p) return;
  const names=p.folders.map(f=>f.name), last=p.folders[p.folders.length-1];
  openNameSheet('Новая папка', last ? nextName(last.name, names) : 'Неделя 1', 'Например: Неделя 2', name=>{
    p.folders.push({id:nid('prog'), name:uniqueName(name, names), days:[]});
    save(); renderProgram();
  }, 'Создать');
}
function openFolderMenu(fid){
  const x=findFolder(fid); if(!x) return;
  const i=x.p.folders.indexOf(x.f), n=x.p.folders.length;
  openModal(`<h2>${esc(x.f.name)}</h2>
    <button class="btn ghost big" data-act="day-add" data-id="${fid}">${I('plus')}Добавить тренировку</button>
    <button class="btn ghost big" data-act="folder-rename" data-id="${fid}">${I('edit')}Переименовать</button>
    <button class="btn ghost big" data-act="folder-dup" data-id="${fid}">${I('copy')}Дублировать папку</button>
    ${n>1?`<div class="grid2" style="margin-top:10px">
      <button class="btn ghost" data-act="folder-move" data-id="${fid}" data-d="-1"${i===0?' disabled':''}>${I('up')}Выше</button>
      <button class="btn ghost" data-act="folder-move" data-id="${fid}" data-d="1"${i===n-1?' disabled':''}>${I('down')}Ниже</button>
    </div>`:''}
    <button class="btn danger big" data-act="folder-del" data-id="${fid}">${I('trash')}Удалить папку</button>
    <button class="btn ghost big" data-act="close-modal">Отмена</button>`);
}
function renameFolder(fid){
  const x=findFolder(fid); if(!x) return;
  openNameSheet('Переименовать папку', x.f.name, '', name=>{
    x.f.name=uniqueName(name, x.p.folders.filter(f=>f!==x.f).map(f=>f.name));
    save(); renderProgram();
  });
}
function dupFolder(fid){
  const x=findFolder(fid); if(!x) return;
  const c=cloneFolder(x.f, nextName(x.f.name, x.p.folders.map(f=>f.name)));
  x.p.folders.splice(x.p.folders.indexOf(x.f)+1, 0, c);
  save(); closeModal(); renderProgram();
  toast(`Создана папка «${c.name}» — поменяйте в ней веса`, null, null, 4000, 'check');
}
function moveFolder(fid, d){
  const x=findFolder(fid); if(!x) return;
  const a=x.p.folders, i=a.indexOf(x.f), k=i+d;
  if(k<0 || k>=a.length) return;
  [a[i],a[k]]=[a[k],a[i]];
  save(); renderProgram(); openFolderMenu(fid);
}
async function deleteFolder(fid){
  const x=findFolder(fid); if(!x) return;
  const n=x.f.days.length;
  if(n && !await ask(`Удалить папку «${esc(x.f.name)}» и ${n} ${plural(n,'тренировку','тренировки','тренировок')} в ней?`,'Удалить',true)) return;
  x.p.folders.splice(x.p.folders.indexOf(x.f), 1);
  validatePlan(); save(); closeModal(); renderProgram();
  toast('Папка удалена');
}

/* ---- тренировка программы ---- */
function openDay(id){
  const x=findDay(id);
  if(!x){ closeModal(); return; }
  const {p,f,d}=x;
  const live=DB.active.plan && DB.active.plan.dayId===id;
  const list = d.items.length
    ? `<div class="card list-card sheet-list">${d.items.map((it,i)=>{
        const e=exById(it.exId);
        return `<div class="rec-row" data-act="day-edit" data-id="${d.id}">
          <span class="plan-mark">${i+1}</span>
          <div class="rec-main"><div class="rec-name">${it.warm?WARM_TAG:''}${esc(e?e.name:'?')}</div>
            <div class="rec-desc">${planDesc(it)}${it.notes?` <span class="note">«${esc(it.notes)}»</span>`:''}</div></div>
        </div>`;
      }).join('')}</div>`
    : '<div class="empty" style="padding:20px 10px">Упражнений пока нет — нажмите «Изменить»</div>';
  openModal(`<div class="sheet-head"><h2>${esc(d.name)}</h2>${closeX()}</div>
    <div class="muted" style="margin-bottom:12px">${esc(p.name)} · ${esc(f.name)}</div>
    ${list}
    <button class="btn ok big" data-act="plan-start" data-id="${d.id}"${d.items.length?'':' disabled'}>${I('play')}${live?'Продолжить тренировку':'Начать тренировку'}</button>
    <div class="grid2" style="margin-top:10px">
      <button class="btn ghost" data-act="day-edit" data-id="${d.id}">${I('edit')}Изменить</button>
      <button class="btn ghost" data-act="day-dup" data-id="${d.id}">${I('copy')}Копия</button>
    </div>
    <button class="btn danger big" data-act="day-del" data-id="${d.id}">${I('trash')}Удалить из программы</button>`);
}
function dupDay(id){
  const x=findDay(id); if(!x) return;
  const c={id:nid('prog'), name:nextName(x.d.name, x.f.days.map(d=>d.name)), items:copyItems(x.d.items)};
  x.f.days.splice(x.f.days.indexOf(x.d)+1, 0, c);
  save(); refresh(); openDay(c.id);
  toast('Создана копия', null, null, null, 'check');
}
async function deleteDay(id){
  const x=findDay(id); if(!x) return;
  if(!await ask(`Удалить тренировку «${esc(x.d.name)}» из программы?`,'Удалить',true)) return;
  x.f.days.splice(x.f.days.indexOf(x.d), 1);
  validatePlan(); save(); closeModal(); refresh();
  toast('Удалено');
}

/* ---- редактор тренировки программы ---- */
let dayDraft=null;
function emptyItem(){ return {name:'', reps:'', sets:'', weight:'', time:'', notes:'', rest:'', warm:false}; }
const restIn = sec => sec===0 ? '0' : (sec ? inVal(round(sec/60,2)) : '');
function openDayEdit(id, folderId){
  const x=id ? findDay(id) : null;
  if(id && !x) return;
  const fx = x ? {p:x.p, f:x.f} : findFolder(folderId);
  if(!fx) return;
  dayDraft={
    id:id||null, progId:fx.p.id, folderId:fx.f.id,
    name: x ? x.d.name : nextName('Тренировка '+fx.f.days.length, fx.f.days.map(d=>d.name)),
    items: x ? x.d.items.map(it=>{ const e=exById(it.exId);
      return {name:e?e.name:'', reps:inVal(it.reps), sets:inVal(it.sets), weight:inVal(it.weight), time:minIn(it.time), notes:it.notes||'',
        rest:restIn(it.rest), warm:!!it.warm}; }) : []
  };
  if(!dayDraft.items.length) dayDraft.items.push(emptyItem());
  renderDayEdit(x ? null : 0);
}
function renderDayEdit(focusIdx){
  const D=dayDraft, p=D && progById(D.progId);
  if(!p){ closeModal(); return; }
  const fOpts=p.folders.map(f=>`<option value="${f.id}"${f.id===D.folderId?' selected':''}>${esc(f.name)}</option>`).join('');
  const dl=DB.exercises.slice().sort((a,b)=>a.name.localeCompare(b.name,'ru')).map(e=>`<option value="${esc(e.name)}"></option>`).join('');
  const n=D.items.length;
  const items=D.items.map((it,i)=>`<div class="pi" data-i="${i}">
      <div class="pi-head"><span class="pi-num">${i+1}</span>
        <input class="pi-name" list="exDL" value="${esc(it.name)}" placeholder="Упражнение" autocomplete="off" autocapitalize="sentences">
        <button type="button" class="pi-btn" data-act="di-move" data-i="${i}" data-d="-1"${i===0?' disabled':''} aria-label="Выше">${I('up')}</button>
        <button type="button" class="pi-btn" data-act="di-move" data-i="${i}" data-d="1"${i===n-1?' disabled':''} aria-label="Ниже">${I('down')}</button>
        <button type="button" class="pi-btn" data-act="di-del" data-i="${i}" aria-label="Убрать">${I('trash')}</button>
      </div>
      <div class="pi-grid">
        <label class="pi-l">Вес, кг<input class="pi-weight" inputmode="decimal" value="${esc(it.weight)}" placeholder="—" autocomplete="off"></label>
        <label class="pi-l">Повт<input class="pi-reps" inputmode="decimal" value="${esc(it.reps)}" placeholder="—" autocomplete="off"></label>
        <label class="pi-l">Подх<input class="pi-sets" inputmode="decimal" value="${esc(it.sets)}" placeholder="—" autocomplete="off"></label>
        <label class="pi-l">Мин<input class="pi-time" inputmode="decimal" value="${esc(it.time)}" placeholder="—" autocomplete="off"></label>
      </div>
      <div class="pi-row2">
        <label class="pi-l pi-rest">Отдых, мин<input class="pi-restv" inputmode="decimal" value="${esc(it.rest)}" placeholder="—" autocomplete="off"></label>
        <label class="check pi-warm"><input type="checkbox" class="pi-warmv"${it.warm?' checked':''}>Разминка</label>
      </div>
      <input class="pi-notes" value="${esc(it.notes)}" placeholder="Заметка (необязательно)" autocomplete="off">
    </div>`).join('');
  const sh=$('#modalSheet'), keep=$('#modal').classList.contains('show') && $('#dItems') ? sh.scrollTop : 0;
  openModal(`<div class="sheet-head"><h2>${D.id?'Изменить тренировку':'Новая тренировка'}</h2>
      <button class="icon-btn" data-act="day-edit-cancel" aria-label="Закрыть">${I('x')}</button></div>
    <label for="dName">Название</label>
    <input id="dName" value="${esc(D.name)}" autocomplete="off" autocapitalize="sentences">
    ${p.folders.length>1?`<label for="dFolder">Папка</label><select id="dFolder">${fOpts}</select>`:''}
    <label>Упражнения</label>
    <div id="dItems">${items}</div>
    <datalist id="exDL">${dl}</datalist>
    <button class="btn ghost big" data-act="di-add">${I('plus')}Добавить упражнение</button>
    <div class="grid2" style="margin-top:14px">
      <button class="btn ghost" data-act="day-edit-cancel">Отмена</button>
      <button class="btn" data-act="day-save">Сохранить</button>
    </div>`);
  sh.scrollTop=keep;
  if(focusIdx!=null){
    const el=$$('#dItems .pi')[focusIdx];
    if(el){ try{ el.scrollIntoView({block:'center'}); }catch(e){} el.querySelector('.pi-name').focus(); }
  }
}
function readDayDraft(){
  const D=dayDraft; if(!D) return;
  const n=$('#dName'); if(n) D.name=n.value;
  const f=$('#dFolder'); if(f) D.folderId=+f.value;
  D.items=$$('#dItems .pi').map(el=>{
    const g=c=>el.querySelector(c).value;
    return {name:g('.pi-name'), reps:g('.pi-reps'), sets:g('.pi-sets'), weight:g('.pi-weight'), time:g('.pi-time'), notes:g('.pi-notes'),
      rest:g('.pi-restv'), warm:el.querySelector('.pi-warmv').checked};
  });
}
function dayItemAdd(){ readDayDraft(); dayDraft.items.push(emptyItem()); renderDayEdit(dayDraft.items.length-1); }
function dayItemMove(i, d){
  readDayDraft();
  const a=dayDraft.items, k=i+d;
  if(k<0 || k>=a.length) return;
  [a[i],a[k]]=[a[k],a[i]];
  renderDayEdit();
}
function dayItemDel(i){ readDayDraft(); dayDraft.items.splice(i,1); renderDayEdit(); }
function dayEditCancel(){
  const id=dayDraft && dayDraft.id;
  dayDraft=null;
  if(id && findDay(id)) openDay(id); else closeModal();
}
function saveDay(){
  readDayDraft();
  const D=dayDraft; if(!D) return;
  const p=progById(D.progId);
  if(!p){ closeModal(); return; }
  const name=cleanName(D.name);
  if(!name){ markBad($('#dName'),true); toast('Введите название тренировки'); return; }
  const LIM=[['.pi-weight','weight'],['.pi-reps','reps'],['.pi-sets','sets'],['.pi-time','time'],['.pi-restv','rest']];
  const items=[]; let bad=false;
  $$('#dItems .pi').forEach(el=>{
    const g=c=>el.querySelector(c);
    const nm=cleanName(g('.pi-name').value);
    const empty=!nm && LIM.every(([c])=>!g(c).value.trim()) && !g('.pi-notes').value.trim();
    if(empty){ LIM.forEach(([c])=>markBad(g(c),false)); markBad(g('.pi-name'),false); return; }
    let rowBad=false;
    LIM.forEach(([c,k])=>{ const b=fieldBad(g(c), LIMITS[k]); markBad(g(c), b); if(b) rowBad=true; });
    markBad(g('.pi-name'), !nm); if(!nm) rowBad=true;
    if(rowBad){ bad=true; return; }
    const rv=String(g('.pi-restv').value||'').trim();
    items.push({name:nm, reps:num(g('.pi-reps').value), sets:num(g('.pi-sets').value), weight:num(g('.pi-weight').value),
      time:minOut(g('.pi-time').value), notes:g('.pi-notes').value.trim(),
      rest: rv==='' ? null : (num(rv)===null ? 0 : Math.round(num(rv)*60)), warm:g('.pi-warmv').checked});
  });
  if(bad){ toast('Проверьте выделенные поля: нужно название; вес — до 100 000 кг, повторы и подходы — до 10 000, время — до 6 000 мин, отдых — до 600 мин', null, null, 5000, 'alert'); return; }
  const final=items.map(it=>({exId:getOrCreateEx(it.name).id, reps:it.reps, sets:it.sets, weight:it.weight, time:it.time, notes:it.notes, warm:it.warm, rest:it.rest}));
  let target=p.folders.find(f=>f.id===D.folderId) || p.folders[0];
  if(!target){ target={id:nid('prog'), name:'Неделя 1', days:[]}; p.folders.push(target); }
  let day=null;
  if(D.id){
    const x=findDay(D.id);
    if(x){
      day=x.d;
      if(x.f!==target){ x.f.days.splice(x.f.days.indexOf(day),1); target.days.push(day); }
    }
  }
  if(!day){ day={id:nid('prog'), name, items:[]}; target.days.push(day); }
  day.name=name; day.items=final;
  dayDraft=null;
  save(); refresh(); openDay(day.id);
  toast('Сохранено', null, null, null, 'check');
}

/* ================== ТРЕНИРОВКА ПО ПРОГРАММЕ (экран «Запись») ================== */
function planCtx(){
  const pl=DB.active.plan;
  if(!pl || !DB.active.wId) return null;
  return findDay(pl.dayId);
}
// какие пункты плана уже сделаны: по числу записей этого упражнения в идущей тренировке
// выполнение плана по подходам: у пункта «4 подхода» — нужно 4 записанных подхода этого упражнения
// выполнение плана по подходам. Разминочные пункты закрываются разминочными подходами, рабочие — рабочими.
function planStatus(x){
  const w=activeW(), pool={work:new Map(), warm:new Map()};
  (w ? recsOfW(w.id) : []).forEach(r=>{ const m=r.warm?pool.warm:pool.work; m.set(r.exId, (m.get(r.exId)||0)+setUnits(r)); });
  return x.d.items.map(it=>{
    const m=it.warm?pool.warm:pool.work;
    const need=Math.max(1, Math.round(it.sets||1));
    const a=m.get(it.exId)||0, done=Math.min(need, a);
    m.set(it.exId, a-done);
    return {need, done, ok: done>=need, warm:!!it.warm};
  });
}
const PLANFOLD_KEY='fitness_plan_folded';
let planFolded=true;
try{ planFolded=localStorage.getItem(PLANFOLD_KEY)!=='0'; }catch(e){}
function togglePlan(){
  planFolded=!planFolded;
  try{ localStorage.setItem(PLANFOLD_KEY, planFolded?'1':'0'); }catch(e){}
  renderPlan();
}
function renderPlan(){
  const box=$('#planBox'); if(!box) return;
  const x=planCtx();
  renderPlanNext();
  if(!x){
    box.innerHTML = hasPlanDays() ? `<button class="btn ghost plan-open" data-act="plan-pick">${I('clip')}Тренировка по программе</button>` : '';
    return;
  }
  const st=planStatus(x), done=st.filter(s=>s.ok).length, next=st.findIndex(s=>!s.ok);
  const needAll=st.reduce((a,s)=>a+s.need,0), doneAll=st.reduce((a,s)=>a+s.done,0);
  box.innerHTML=`<div class="card plan-card">
    <div class="plan-head" data-act="plan-toggle">
      <div class="plan-title-wrap"><div class="plan-sub">${esc(x.p.name)} · ${esc(x.f.name)}</div><div class="plan-title">${esc(x.d.name)}</div></div>
      <div class="plan-count">${done}/${st.length}</div>
      <span class="plan-fold">${I(planFolded?'down':'up')}</span>
      <button class="icon-btn sm" data-act="plan-close" aria-label="Убрать программу">${I('x')}</button>
    </div>
    <div class="progress plan-progress"><div style="width:${needAll?Math.round(doneAll/needAll*100):0}%"></div></div>
    ${planFolded ? '' : x.d.items.map((it,i)=>{ const e=exById(it.exId);
      const s=st[i], part=!s.ok && s.done>0;
      return `<div class="plan-row${s.ok?' done':''}${i===next?' next':''}${it.warm?' warm':''}" data-act="plan-fill" data-i="${i}">
        <span class="plan-mark${part?' part':''}">${s.ok?I('check'):part?`${s.done}/${s.need}`:(i+1)}</span>
        <div class="rec-main"><div class="rec-name">${it.warm?WARM_TAG:''}${esc(e?e.name:'?')}</div>
          <div class="rec-desc">${planDesc(it)}${it.notes?` <span class="note">«${esc(it.notes)}»</span>`:''}</div></div>
      </div>`; }).join('')}
    ${planFolded && next>=0 ? (()=>{ const it=x.d.items[next], e=exById(it.exId), s2=st[next];
      return `<div class="plan-next-row" data-act="plan-next" data-i="${next}">
        <div class="rec-main"><div class="plan-next-lbl">Далее${s2.need>1?` · подход ${s2.done+1} из ${s2.need}`:''}</div>
          <div class="rec-name">${it.warm?WARM_TAG:''}${esc(e?e.name:'?')}</div>
          <div class="rec-desc">${planDesc(it)}</div>
          ${it.notes?`<div class="plan-next-note">«${esc(it.notes)}»</div>`:''}</div>
        <span class="plan-next-btn">Подставить</span></div>`; })() : ''}
    ${st.length && next<0 ? `<div class="plan-done">${I('flag')}Все упражнения выполнены</div>` : ''}
  </div>`;
}
function openPlanPicker(){
  let html=`<div class="sheet-head"><h2>Тренировка по программе</h2>${closeX()}</div>`;
  DB.programs.forEach(p=>{
    if(!p.folders.some(f=>f.days.length)) return;
    html+=`<div class="pick-prog">${I('clip')}${esc(p.name)}</div><div class="card list-card sheet-list">`;
    p.folders.forEach(f=>{
      if(!f.days.length) return;
      html+=`<div class="list-day">${esc(f.name)}</div>`;
      f.days.forEach(d=>{
        html+=`<div class="rec-row" data-act="day-open" data-id="${d.id}">
          <div class="rec-main"><div class="rec-name">${esc(d.name)}</div><div class="rec-desc">${d.items.length} упр.</div></div>
          <div class="chev">${I('chev')}</div></div>`;
      });
    });
    html+='</div>';
  });
  openModal(html);
}
function startPlan(dayId){
  const x=findDay(dayId); if(!x) return;
  if(!DB.active.wId) startWorkout(true);
  DB.active.plan={dayId};
  const w=activeW();
  if(w){ w.plan=`${x.f.name} · ${x.d.name}`; w.planDay=x.d.id; }
  // тренировка по программе: автоподстановка и автоотдых — «по программе»
  autoSrc='plan'; arMode='plan';
  try{ localStorage.setItem(AUTOFILL_KEY, 'plan'); localStorage.setItem(AUTOREST_KEY, 'plan'); }catch(e){}
  renderRestPresets();
  save(); closeModal(); go('record');
  toast(`Тренировка «${x.d.name}» началась`, null, null, null, 'play');
}
function closePlan(){
  DB.active.plan=null; save(); renderPlan();
  toast('Программа скрыта — тренировка продолжается');
}
// подсказка над полем «Упражнение»: первое невыполненное упражнение программы — подставить одним нажатием
function renderPlanNext(){
  const box=$('#planNext'); if(box) box.innerHTML='';
}
function fillFromPlan(i, noScroll){
  const x=planCtx(); if(!x) return;
  const it=x.d.items[i]; if(!it) return;
  const e=exById(it.exId);
  exInput.value=e ? e.name : '';
  lastExKey=normKey(exInput.value); setWarm(!!it.warm);
  // подходы записываются по одному: в поле «Подходы» — 1, счётчик «подход k из n» — в подсказке
  setVal('mWeight',it.weight); setVal('mReps',it.reps); setVal('mSets', (it.weight||it.reps) ? 1 : null);
  $('#mTime').value=minIn(it.time);
  $('#mNotes').value='';
  NUM_FIELDS.forEach(id=>markBad($('#'+id),false));
  hideSuggest(); renderLastHint(); renderPlanNext();
  if(noScroll) return;
  try{
    const sc=$('#scroller'), fc=$('.form-card');
    sc.scrollBy({top:fc.getBoundingClientRect().top - sc.getBoundingClientRect().top - 64, behavior:'smooth'});
  }catch(err){}
}

/* ================== ДОБАВИТЬ ПРОШЕДШУЮ ТРЕНИРОВКУ В ПРОГРАММУ ================== */
let apState=null, lastProgId=null;
function openAddToProg(wId){
  const w=wById(wId); if(!w) return;
  const recs=recsOfW(wId);
  if(!recs.length){ toast('В тренировке нет записей'); return; }
  const def=(lastProgId && progById(lastProgId)) ? lastProgId : (DB.programs[0] ? DB.programs[0].id : 'new');
  apState={wId};
  const pOpts=DB.programs.map(p=>`<option value="${p.id}"${p.id===def?' selected':''}>${esc(p.name)}</option>`).join('')
    + `<option value="new"${def==='new'?' selected':''}>+ Новая программа</option>`;
  openModal(`<div class="sheet-head"><h2>Добавить в программу</h2>
      <button class="icon-btn" data-act="w-open" data-id="${wId}" aria-label="Назад">${I('x')}</button></div>
    <p class="muted">${recs.length} ${plural(recs.length,'упражнение','упражнения','упражнений')} из тренировки #${workoutNumber(wId)} (${fmtDate(w.start)}) — с весами, повторами и подходами.</p>
    <label for="apProg">Программа</label><select id="apProg">${pOpts}</select>
    <div id="apProgNewWrap"><label for="apProgName">Название новой программы</label>
      <input id="apProgName" placeholder="Например: Верх / Низ" autocomplete="off" autocapitalize="sentences"></div>
    <label for="apFolder">Папка</label><select id="apFolder"></select>
    <div id="apFolderNewWrap"><label for="apFolderName">Название новой папки</label>
      <input id="apFolderName" autocomplete="off" autocapitalize="sentences"></div>
    <label for="apName">Название тренировки</label>
    <input id="apName" autocomplete="off" autocapitalize="sentences" data-auto="1">
    <div class="grid2" style="margin-top:16px">
      <button class="btn ghost" data-act="w-open" data-id="${wId}">Отмена</button>
      <button class="btn" data-act="ap-save">Добавить</button>
    </div>`);
  updateAp(true);
}
function updateAp(resetFolder){
  const ps=$('#apProg'), fs=$('#apFolder'); if(!ps || !fs) return;
  const p = ps.value==='new' ? null : progById(+ps.value);
  $('#apProgNewWrap').classList.toggle('hidden', !!p);
  if(resetFolder){
    const folders=p ? p.folders : [], last=folders[folders.length-1];
    fs.innerHTML=folders.map(f=>`<option value="${f.id}"${f===last?' selected':''}>${esc(f.name)}</option>`).join('')+'<option value="new">+ Новая папка</option>';
    if(!folders.length) fs.value='new';
    $('#apFolderName').value = last ? nextName(last.name, folders.map(f=>f.name)) : 'Неделя 1';
  }
  const f = (p && fs.value!=='new') ? p.folders.find(x=>x.id===+fs.value) : null;
  $('#apFolderNewWrap').classList.toggle('hidden', !!f);
  const nm=$('#apName');
  if(nm.dataset.auto==='1') nm.value = f ? nextName('Тренировка '+f.days.length, f.days.map(d=>d.name)) : 'Тренировка 1';
}
function saveAddToProg(){
  const st=apState; if(!st) return;
  const w=wById(st.wId); if(!w){ closeModal(); return; }
  const pv=$('#apProg').value, fv=$('#apFolder').value;
  let p = pv==='new' ? null : progById(+pv);
  let newP=false, newF=false;
  if(!p){
    const nm=cleanName($('#apProgName').value);
    if(!nm){ markBad($('#apProgName'),true); toast('Введите название программы'); return; }
    p={id:0, name:uniqueName(nm, DB.programs.map(x=>x.name)), folders:[]}; newP=true;
  }
  let f = (!newP && fv!=='new') ? p.folders.find(x=>x.id===+fv) : null;
  if(!f){
    const fn=cleanName($('#apFolderName').value);
    if(!fn){ markBad($('#apFolderName'),true); toast('Введите название папки'); return; }
    f={id:0, name:uniqueName(fn, p.folders.map(x=>x.name)), days:[]}; newF=true;
  }
  const name=cleanName($('#apName').value);
  if(!name){ markBad($('#apName'),true); toast('Введите название тренировки'); return; }
  if(newP){ p.id=nid('prog'); DB.programs.push(p); }
  if(newF){ f.id=nid('prog'); p.folders.push(f); }
  f.days.push({id:nid('prog'), name,
    items:recsOfW(w.id).map(r=>({exId:r.exId, reps:r.reps, sets:r.sets, weight:r.weight, time:r.time, notes:r.notes||'', warm:!!r.warm, rest:null}))});
  lastProgId=p.id; apState=null;
  save(); closeModal(); refresh();
  const pid=p.id;
  toast(`Добавлено: «${p.name}» → «${f.name}»`, 'Открыть', ()=>openProgram(pid), 4500, 'check');
}

/* ================== ДАННЫЕ ================== */
function openDataSheet(){
  const nW=sortedWorkouts().length;
  openModal(`<div class="brand"><img src="icon-192.png" alt="" width="44" height="44"><div><div class="brand-name">WTFIT</div><div class="muted">дневник тренировок · версия ${esc(APP_VERSION)}</div></div></div>
    <div class="sheet-head"><h2>Данные</h2><button class="icon-btn" data-act="close-modal" aria-label="Закрыть">${I('x')}</button></div>
    <p class="muted">Всё хранится только на этом устройстве: ${nW} ${plural(nW,'тренировка','тренировки','тренировок')}, ${DB.records.length} ${plural(DB.records.length,'запись','записи','записей')}, ${DB.exercises.length} ${plural(DB.exercises.length,'упражнение','упражнения','упражнений')}, ${DB.programs.length} ${plural(DB.programs.length,'программа','программы','программ')}.<br>
    ${DB.lastExport?'Последняя полная копия: '+fmtDate(DB.lastExport)+' '+fmtTime(DB.lastExport):'Полных копий ещё не было.'}</p>
    <p class="muted" id="persistInfo">Защита хранилища: проверяется…</p>
    <button class="btn big" data-act="backup">${I('save')}Полная копия (всё в одном файле)</button>
    <button class="btn ghost big" data-act="import" data-kind="backup">${I('swap')}Восстановить из копии</button>
    <button class="btn ghost big" data-act="export">${I('upload')}Выгрузить записи (таблица)</button>
    <button class="btn danger big" data-act="clear-all">${I('trash')}Удалить все данные</button>`);
  const setInfo=t=>{ const el=$('#persistInfo'); if(el) el.textContent='Защита хранилища: '+t; };
  const unknown='этот браузер не сообщает — регулярно делайте полную копию.';
  try{
    if(navigator.storage && navigator.storage.persisted)
      navigator.storage.persisted().then(p=>{
        setInfo(p ? 'включена, система не удалит данные сама.'
                  : 'нет — при нехватке места система может очистить данные. Регулярно делайте полную копию.');
      }).catch(()=>setInfo(unknown));
    else setInfo(unknown);
  }catch(e){ setInfo(unknown); }
}

/* ---- выгрузка ---- */
function dec(v){ return v==null||v==='' ? '' : String(v).replace('.',','); }
const EXPORT_HEAD=['Дата','День','Время','Тренировка','Упражнение','Вес, кг','Повторения','Подходы','Тоннаж, кг','Время, мин','Заметки','Разминка','Начало тренировки','Длительность, мин','Отдых, мин'];
const PROG_HEAD=['Программа','Папка','Тренировка','Упражнение','Вес, кг','Повторения','Подходы','Время, мин','Отдых, мин','Разминка','Заметки'];

function recWorkouts(){ return DB.workouts.filter(w=>DB.records.some(r=>r.wId===w.id)).sort((a,b)=>a.start-b.start); }

// все записи; номер тренировки — сквозной
function buildRows(onlyW){
  const rows=[EXPORT_HEAD];
  let n=0;
  recWorkouts().forEach(w=>{
    n++;
    if(onlyW!=null && w.id!==onlyW) return;   // выгрузка одной тренировки — номер остаётся сквозным
    const recs=recsOfW(w.id);
    const dur=isActive(w) ? 0 : wDur(w);
    recs.forEach((r,j)=>{
      const ex=exById(r.exId), d=new Date(r.ts), t=ton(r);
      rows.push([
        fmtDate(r.ts), WD[d.getDay()], fmtTime(r.ts), n, ex?ex.name:'?',
        dec(r.weight), dec(r.reps), dec(r.sets), t?dec(round(t,2)):'', r.time?dec(round(r.time/60,2)):'', r.notes||'', r.warm?'да':'',
        j===0 ? fmtTime(w.start) : '',
        j===0 && dur ? dec(round(dur/60,1)) : '',
        j===0 && w.rest ? dec(round(w.rest/60,1)) : ''
      ]);
    });
  });
  // только реальные записи; упражнения без записей (например, из программ) сюда не попадают —
  // они сохраняются в полной копии и в выгрузке программ
  return rows;
}
function buildProgramRows(progs){
  const rows=[PROG_HEAD];
  progs.forEach(p=>{
    const E=n=>Array(n).fill('');
    if(!p.folders.length){ rows.push([p.name,...E(10)]); return; }
    p.folders.forEach(f=>{
      if(!f.days.length){ rows.push([p.name,f.name,...E(9)]); return; }
      f.days.forEach(d=>{
        if(!d.items.length){ rows.push([p.name,f.name,d.name,...E(8)]); return; }
        d.items.forEach(it=>{
          const e=exById(it.exId);
          rows.push([p.name, f.name, d.name, e?e.name:'?', dec(it.weight), dec(it.reps), dec(it.sets),
            it.time?dec(round(it.time/60,2)):'', it.rest===0?'0':(it.rest?dec(round(it.rest/60,2)):''), it.warm?'да':'', it.notes||'']);
        });
      });
    });
  });
  return rows;
}
function templateRows(){
  return [PROG_HEAD,
    ['Моя программа','Неделя 1','Верх','Жим лёжа','60','10','3','','','',''],
    ['','','','Тяга штанги в наклоне','50','10','3','','','',''],
    ['','','','Жим гантелей сидя','20','12','3','','','',''],
    ['','','Низ','Велосипед','','','','10','','','разминка'],
    ['','','','Приседания','80','8','4','','','',''],
    ['','','','Румынская тяга','70','10','3','','','',''],
    ['','Неделя 2','Верх','Жим лёжа','62,5','10','3','','','','+2,5 кг'],
    ['','','','Тяга штанги в наклоне','52,5','10','3','','','',''],
    ['','','','Жим гантелей сидя','22','12','3','','','',''],
    ['','','Низ','Велосипед','','','','10','','','разминка'],
    ['','','','Приседания','85','8','4','','','',''],
    ['','','','Румынская тяга','72,5','10','3','','','','']];
}
function toDelimited(rows, sep){
  return rows.map(r=>r.map(c=>{
    let s=String(c==null?'':c);
    if(sep==='\t') s=s.replace(/[\t\r\n]+/g,' ');
    else s=s.replace(/\r\n?|\n/g,' ');
    // текст, начинающийся с = + - @ (например, заметка «+2,5 кг»), Excel принял бы за формулу —
    // ставим впереди пробел: в таблице это обычный текст, при загрузке обратно пробел отбрасывается
    if(/^[=+\-@]/.test(s) && !/^[-+]?\d+([.,]\d+)?$/.test(s)) s=' '+s;
    if(s.includes(sep) || /["\r\n]/.test(s) || /^\s|\s$/.test(s)) s='"'+s.replace(/"/g,'""')+'"';
    return s;
  }).join(sep)).join('\r\n');
}
function safeFile(s){ return cleanName(s).replace(/[\\/:*?"<>|]+/g,'_').slice(0,60) || 'программа'; }
function canShareFiles(){
  try{ return !!(navigator.share && navigator.canShare && navigator.canShare({files:[new File(['x'],'t.csv',{type:'text/csv'})]})); }
  catch(e){ return false; }
}
function markExported(){ DB.lastExport=Date.now(); save(); refresh(); }

let exportCtx={kind:'records'};   // records | programs {ids} | template | backup

function exportButtons(){
  const share=canShareFiles();
  return `${share?`<button class="btn big" data-act="export-share">${I('upload')}Сохранить в «Файлы» / отправить</button>`:''}
    <button class="btn${share?' ghost':''} big" data-act="export-copy">${I('copy')}Скопировать таблицу</button>
    <button class="btn ghost big" data-act="export-download">${I('download')}Скачать файл</button>
    <p class="muted" style="margin-top:12px">«Скопировать» — вставка в Numbers / Excel / Google Таблицы сразу разложится по ячейкам.</p>`;
}
// выгрузить одну тренировку таблицей
function openWorkoutExport(wId){
  const w=wById(wId); if(!w) return;
  const n=recsOfW(wId).length;
  exportCtx={kind:'workout', wId};
  openModal(`<div class="sheet-head"><h2>Выгрузить тренировку</h2><button class="icon-btn" data-act="w-open" data-id="${wId}" aria-label="Назад">${I('x')}</button></div>
    <p class="muted">Тренировка #${workoutNumber(wId)} · ${fmtDate(w.start)}${w.plan?' · '+esc(w.plan):''} · ${n} ${plural(n,'запись','записи','записей')}.
    Таблица в том же формате, что и полная выгрузка: её можно открыть в Excel или загрузить обратно (повторы не задублируются).</p>
    ${exportButtons()}`);
}
function openExport(){
  const ws=recWorkouts();
  if(!ws.length && !DB.exercises.length){ toast('Пока нечего выгружать'); return; }
  exportCtx={kind:'records'};
  openModal(`<div class="sheet-head"><h2>Выгрузить записи</h2>${closeX()}</div>
    <p class="muted">Все записи: ${ws.length} ${plural(ws.length,'тренировка','тренировки','тренировок')} · ${DB.records.length} ${plural(DB.records.length,'запись','записи','записей')}.
    CSV открывается в Excel, Numbers и Google Таблицах: одна строка — одно упражнение. Этот же файл можно поправить в Excel (веса, повторы) и загрузить на вкладке «Программы» как программу тренировок.</p>
    ${exportButtons()}`);
}
function openProgExport(ids, template){
  exportCtx = template ? {kind:'template'} : {kind:'programs', ids};
  const progs = template ? [] : ids.map(progById).filter(Boolean);
  if(!template && !progs.length){ toast('Нет программ для выгрузки'); return; }
  const title = template ? 'Шаблон программы' : progs.length===1 ? 'Выгрузить программу' : 'Выгрузить программы';
  const what = template ? 'Пример программы на две недели. Заполните таблицу в Excel / Numbers, сохраните как CSV и загрузите на вкладке «Программы» → «Загрузить».'
    : progs.length===1 ? `Программа «${esc(progs[0].name)}».` : `${progs.length} ${plural(progs.length,'программа','программы','программ')}.`;
  openModal(`<div class="sheet-head"><h2>${title}</h2>${closeX()}</div>
    <p class="muted">${what} Одна строка — одно упражнение. Колонки: Программа, Папка, Тренировка, Упражнение, Вес, Повторения, Подходы, Время (мин), Отдых (мин; 0 — без отдыха), Разминка («да»), Заметки. Пустые ячейки в первых трёх колонках берутся из строки выше.</p>
    ${exportButtons()}`);
}
function exportPayload(){
  const today=dayKey(Date.now());
  if(exportCtx.kind==='records'){
    const rows=buildRows();
    if(rows.length<2){ toast('Пока нечего выгружать'); return null; }
    return csvPayload(rows, `WTFIT_тренировки_${today}.csv`);
  }
  if(exportCtx.kind==='backup'){
    const text=JSON.stringify(backupData());
    return {file:text, copy:text, name:`WTFIT_копия_${today}.json`, mime:'application/json', backup:true};
  }
  if(exportCtx.kind==='template') return csvPayload(templateRows(), 'Шаблон_программы.csv');
  if(exportCtx.kind==='workout'){
    const w=wById(exportCtx.wId); if(!w){ toast('Тренировка не найдена'); return null; }
    return csvPayload(buildRows(w.id), `WTFIT_тренировка_${dayKey(w.start)}.csv`);
  }
  const progs=(exportCtx.ids||[]).map(progById).filter(Boolean);
  if(!progs.length){ toast('Нет программ для выгрузки'); return null; }
  return csvPayload(buildProgramRows(progs), progs.length===1 ? `Программа_${safeFile(progs[0].name)}.csv` : `Программы_${today}.csv`);
}
function csvPayload(rows, name){
  return {file:'\ufeff'+toDelimited(rows,';'), copy:toDelimited(rows,'\t'), name, mime:'text/csv', backup:false};
}

/* ---- полная копия: записи, тренировки, упражнения и программы одним файлом ---- */
const BACKUP_APP='fitness-tracker-backup';
function backupData(){
  return {app:BACKUP_APP, v:1, created:new Date().toISOString(),
    data:{v:DB.v, exercises:DB.exercises, records:DB.records, workouts:DB.workouts, programs:DB.programs,
      measures:DB.measures, mkinds:DB.mkinds, seq:DB.seq}};
}
function openBackup(){
  exportCtx={kind:'backup'};
  const nW=recWorkouts().length;
  openModal(`<div class="sheet-head"><h2>Полная копия</h2>${closeX()}</div>
    <p class="muted">Один файл со всем сразу: ${nW} ${plural(nW,'тренировка','тренировки','тренировок')}, ${DB.records.length} ${plural(DB.records.length,'запись','записи','записей')},
    ${DB.exercises.length} ${plural(DB.exercises.length,'упражнение','упражнения','упражнений')}, ${DB.programs.length} ${plural(DB.programs.length,'программа','программы','программ')}.
    Сохраните его в «Файлы» (лучше в iCloud Drive). Восстановить: Статистика → ⋯ → «Восстановить из копии».</p>
    ${exportButtons().replace('Скопировать таблицу','Скопировать текст копии').replace(/<p class="muted" style="margin-top:12px">.*?<\/p>/s,'')}`);
}
async function shareExport(){
  const P=exportPayload(); if(!P) return;
  const file=new File([P.file], P.name, {type:P.mime});
  try{
    await navigator.share({files:[file], title:P.name});
    if(P.backup) markExported();
    closeModal(); toast('Готово');
  }catch(e){
    if(e && e.name==='AbortError') return;
    toast('Не получилось — попробуйте «Скопировать»');
  }
}
function downloadExport(){
  const P=exportPayload(); if(!P) return;
  try{
    const blob=new Blob([P.file], {type:P.mime+';charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url; a.download=P.name; a.rel='noopener';
    document.body.appendChild(a); a.click();
    setTimeout(()=>{ a.remove(); URL.revokeObjectURL(url); }, 5000);
    if(P.backup) markExported();
    toast('Если файл не появился — используйте другой способ', null, null, 4000);
  }catch(e){
    toast('Скачивание недоступно — используйте «Скопировать»');
  }
}
async function copyExport(){
  const P=exportPayload(); if(!P) return;
  const text=P.copy;
  if(await copyText(text)){
    if(P.backup) markExported();
    closeModal(); toast(P.mime==='application/json' ? 'Скопировано — сохраните текст в Заметки или файл' : 'Скопировано — вставьте в таблицу или в Заметки', null, null, null, 'check'); return;
  }
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

/* ================== ЗАГРУЗКА ==================
   «Загрузить» в Статистике   → записи (kind=records)
   «Загрузить» в Программах   → программа (kind=program)
   «Восстановить из копии»    → полная копия .json (kind=backup)
   Файл полной копии (.json) распознаётся в любом из трёх мест. */
let pendingImport=null, pendingProg=null, pendingBackup=null;
let importKind='records';

function openImport(kind){
  importKind=kind||'records';
  const inp=$('#importFile'); if(!inp) return;
  inp.value='';
  inp.click();
}
async function onImportFile(inp){
  const f=inp.files && inp.files[0];
  if(!f) return;
  try{
    const text=await readFileText(f);
    inp.value='';
    handleImportText(text, importKind);
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
    throw new Error('Это файл Excel / Numbers, а не CSV. Экспортируйте таблицу в CSV (Файл → Экспорт → CSV) и загрузите его.');
  if(b[0]===0xFF&&b[1]===0xFE) return new TextDecoder('utf-16le').decode(b);
  if(b[0]===0xFE&&b[1]===0xFF) return new TextDecoder('utf-16be').decode(b);
  try{ return new TextDecoder('utf-8',{fatal:true}).decode(b); }
  catch(e){
    // не UTF-8: CSV из Excel под Windows (windows-1251) или под Mac (x-mac-cyrillic) — берём тот,
    // где нашёлся заголовок «Упражнение» или больше обычных русских букв
    const score=t=>(/упражн/i.test(t)?1e6:0)+(t.match(/[а-яё]/g)||[]).length-(t.match(/[^\x00-\x7fа-яёА-ЯЁ№«»—–…]/g)||[]).length*3;
    let best=null, bestScore=-Infinity;
    ['windows-1251','x-mac-cyrillic'].forEach(enc=>{
      try{ const t=new TextDecoder(enc).decode(b), s=score(t); if(s>bestScore){ best=t; bestScore=s; } }catch(_){}
    });
    return best!=null ? best : new TextDecoder('utf-8').decode(b);
  }
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
  if(h.startsWith('разминк')) return 'warm';
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

    const wv=normKey(g('warm'));
    const rec={exName, day, clk, reps:num(g('reps')), sets:num(g('sets')), weight:num(g('weight')), time, notes:g('notes'),
      warm: col.warm!==undefined ? (wv==='да'||wv==='1'||wv==='yes'||wv==='+') : /^\s*разминк/i.test(g('notes'))};
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
      return {exName:it.exName, ts, reps:it.reps, sets:it.sets, weight:it.weight, time:it.time, notes:it.notes, warm:!!it.warm};
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

function previewBackup(text){
  let B;
  try{ B=JSON.parse(text); }catch(e){ ask('Файл копии повреждён — не удалось его прочитать.','OK',false,null); return; }
  const d=B && B.app===BACKUP_APP && B.data;
  if(!d || !Array.isArray(d.records) || !Array.isArray(d.exercises)){ ask('Это не файл полной копии WTFIT.','OK',false,null); return; }
  pendingBackup=d;
  const nW=new Set(d.records.map(r=>r.wId)).size, nP=Array.isArray(d.programs)?d.programs.length:0;
  const when=B.created ? new Date(B.created) : null;
  openModal(`<div class="sheet-head"><h2>Восстановление</h2>${closeX()}</div>
    <p class="muted">Полная копия${when && !isNaN(when)?' от '+fmtDate(when.getTime())+' '+fmtTime(when.getTime()):''}.</p>
    <div class="stats-summary">
      <div class="stats-box"><div class="lbl">Тренировок</div><div class="val">${nW}</div></div>
      <div class="stats-box"><div class="lbl">Записей</div><div class="val">${d.records.length}</div></div>
      <div class="stats-box"><div class="lbl">Упражнений</div><div class="val">${d.exercises.length}</div></div>
      <div class="stats-box"><div class="lbl">Программ</div><div class="val">${nP}</div></div>
    </div>
    <div class="warn-box">Все текущие данные на этом устройстве (${DB.records.length} ${plural(DB.records.length,'запись','записи','записей')}, ${DB.programs.length} ${plural(DB.programs.length,'программа','программы','программ')}) будут заменены содержимым копии.</div>
    <button class="btn danger big" data-act="backup-restore">${I('swap')}Восстановить из копии</button>
    <button class="btn ghost big" data-act="close-modal">Отмена</button>`);
}
async function restoreBackup(){
  const d=pendingBackup; if(!d) return;
  if(DB.records.length || DB.programs.length){
    if(!await ask('Заменить все текущие данные содержимым копии? Отменить будет нельзя.','Заменить',true)) return;
  }
  hideRest();
  const fresh=normalize(Object.assign({}, d, {active:null, lastExport:Date.now()}));
  DB=fresh;
  fixOrphans(); fixProgramRefs(); cleanupWorkouts(); save();
  pendingBackup=null;
  closeModal();
  exInput.value=''; clearForm(true);
  renderWorkoutBar(); refresh();
  toast('Данные восстановлены из копии', null, null, 3500, 'check');
}

function headerRow(rows){ return rows.findIndex(r=>r.some(c=>normHead(c).startsWith('упражн'))); }

const ENCODING_HELP='Похоже, файл сохранён не в UTF-8 и русские буквы испортились. В Excel сохраните таблицу как <b>«CSV UTF-8 (разделители — запятые)»</b>, в Numbers — Файл → Экспорт → CSV (кодировка Unicode UTF-8).';
function looksBroken(text){
  const s=String(text).slice(0,4000);
  if(/\ufffd/.test(s)) return true;                                  // «�» — байты не распознаны
  if((s.match(/[ÐÑ][\u0080-\u00bf\u2018-\u203a\u0152-\u0192]/g)||[]).length>3) return true;   // UTF-8, прочитанный как Latin-1
  const letters=(s.match(/[A-Za-zА-Яа-яЁё]/g)||[]).length;
  return letters<10 && (s.match(/\?{2,}/g)||[]).length>2;          // кириллица заменена на «???»
}
function handleImportText(text, kind){
  const trimmed=String(text).replace(/^\ufeff/,'').trim();
  if(trimmed.startsWith('{')){ previewBackup(trimmed); return; }
  if(kind==='backup'){
    ask('Это не файл полной копии. Выберите файл вида <b>WTFIT_копия_….json</b> (или старый <b>Полная_копия_….json</b>). Таблицы загружаются кнопкой «Загрузить» в Статистике (записи) или в Программах.','OK',false,null);
    return;
  }
  const rows=parseDelimited(text);
  const hi=headerRow(rows);
  if(hi<0){
    ask(looksBroken(text) ? ENCODING_HELP : 'Не найдена строка заголовков. В таблице должна быть колонка «Упражнение».','OK',false,null);
    return;
  }
  if(kind==='program'){ previewProgram(rows); return; }
  const head=rows[hi].map(normHead);
  if(!head.some(h=>h.startsWith('дата'))){
    const isProg=head.some(h=>h.startsWith('программ') || h.startsWith('папк'));
    ask(`В таблице нет колонки «Дата» — как записи тренировок её не загрузить.${isProg?' Похоже, это программа — загрузите её на вкладке «Программы».':''}`,'OK',false,null);
    return;
  }
  previewRecords(rows);
}

/* ---- записи ---- */
function previewRecords(rows){
  let P;
  try{ P=interpret(rows); }
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

  openModal(`<div class="sheet-head"><h2>Загрузка записей</h2>${closeX()}</div>
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
    <button class="btn danger big" data-act="import-run" data-mode="replace">${I('swap')}Заменить все записи</button>`:''}
    <button class="btn ghost big" data-act="close-modal">Отмена</button>`);
}

/* ---- программа ---- */
function progHeadKey(h){
  if(!h) return null;
  if(h.startsWith('программ')) return 'prog';
  if(h.startsWith('папк') || h.startsWith('недел') || h.startsWith('блок') || h.startsWith('этап')) return 'folder';
  if(h.startsWith('тренировк')) return 'day';
  if(h.startsWith('время') && /сек|мин/.test(h)) return 'time';
  if(h.startsWith('дата')) return 'date';
  if(h.startsWith('упражн')) return 'ex';
  if(h.startsWith('повтор') || h.startsWith('количеств') || h==='кол-во') return 'reps';
  if(h.startsWith('подход')) return 'sets';
  if(h.startsWith('вес')) return 'weight';
  if(h.startsWith('замет') || h.startsWith('коммент')) return 'notes';
  if(h.startsWith('отдых')) return 'rest';
  if(h.startsWith('разминк')) return 'warm';
  return null;
}
function parsePrograms(rows){
  const hi=headerRow(rows);
  if(hi<0) throw new Error('Не найдена строка заголовков: нужна колонка «Упражнение».');
  const head=rows[hi].map(normHead);
  const col={}, unit={};
  head.forEach((h,i)=>{ const k=progHeadKey(h); if(k && col[k]===undefined){ col[k]=i; unit[k]=/сек/.test(h)?'s':'m'; } });
  // таблица записей без колонок программы → раскладываем по неделям
  if(col.prog===undefined && col.folder===undefined && col.date!==undefined) return programFromRecords(rows);

  const errors=[], progs=[];
  const getP=name=>{ let p=progs.find(x=>normKey(x.name)===normKey(name)); if(!p){ p={name, folders:[]}; progs.push(p); } return p; };
  const getF=(p,name)=>{ let f=p.folders.find(x=>normKey(x.name)===normKey(name)); if(!f){ f={name, days:[]}; p.folders.push(f); } return f; };
  const getD=(f,name)=>{ let d=f.days.find(x=>normKey(x.name)===normKey(name)); if(!d){ d={name, items:[]}; f.days.push(d); } return d; };
  let cur={prog:'', folder:'', day:''};

  for(let i=hi+1;i<rows.length;i++){
    const r=rows[i];
    if(!r || r.every(c=>!String(c==null?'':c).trim())) continue;
    const g=k=> col[k]===undefined ? '' : String(r[col[k]]==null?'':r[col[k]]).trim();
    const pv=cleanName(g('prog')), fv=cleanName(g('folder')), dv=cleanName(g('day'));
    // пустые ячейки «Программа / Папка / Тренировка» берутся из строки выше
    if(pv && normKey(pv)!==normKey(cur.prog)) cur={prog:pv, folder:'', day:''};
    if(fv && normKey(fv)!==normKey(cur.folder)){ cur.folder=fv; cur.day=''; }
    if(dv) cur.day=dv;
    const p=getP(cur.prog);
    const exName=cleanName(g('ex'));
    const raw={reps:g('reps'), sets:g('sets'), weight:g('weight'), time:g('time')};
    if(!exName){
      if(Object.values(raw).some(Boolean) || g('notes')) errors.push(`Строка ${i+1}: нет названия упражнения`);
      else if(cur.folder || cur.day){ const f=getF(p, cur.folder||'Неделя 1'); if(cur.day) getD(f, cur.day); }
      continue;
    }
    let bad=null;
    const val=(k,max)=>{
      const s=raw[k].replace(/[\s  ]/g,'').replace(',','.');
      if(!s) return null;
      const v=Number(s);
      if(!isFinite(v) || v<0 || v>max){ bad=bad||k; return null; }
      return v ? round(v,3) : null;
    };
    const reps=val('reps',LIMITS.reps), sets=val('sets',LIMITS.sets), weight=val('weight',LIMITS.weight);
    let time=val('time', unit.time==='s' ? LIMITS.time*60 : LIMITS.time);
    if(bad){ errors.push(`Строка ${i+1}: неверное значение (${LIMIT_TEXT[bad]})`); continue; }
    if(time!=null) time=Math.round(unit.time==='s' ? time : time*60);
    const f=getF(p, cur.folder||'Неделя 1'), d=getD(f, cur.day||'Тренировка 1');
    const rs=g('rest').replace(/\s/g,'').replace(',','.'), wv=normKey(g('warm'));
    let rest=null;
    if(rs!==''){ const v=Number(rs); if(isFinite(v) && v>=0 && v<=LIMITS.rest*(unit.rest==='s'?60:1)) rest=Math.round(unit.rest==='s'?v:v*60); }
    d.items.push({exName, reps, sets, weight, time, notes:g('notes'), rest, warm: wv==='да'||wv==='1'||wv==='+'||wv==='yes'});
  }
  return {programs:progs, errors, period:''};
}
function programFromRecords(rows){
  const P=interpret(rows);
  const weeks=new Map();
  P.groups.forEach(g=>{
    const d=new Date(g.start);
    const mon=new Date(d.getFullYear(), d.getMonth(), d.getDate()-((d.getDay()+6)%7)).getTime();
    if(!weeks.has(mon)) weeks.set(mon, []);
    weeks.get(mon).push(g);
  });
  const folders=[...weeks.keys()].sort((a,b)=>a-b).map((k,wi)=>({
    name:`Неделя ${wi+1}`,
    days:weeks.get(k).map((g,j)=>({name:`Тренировка ${j+1}`,
      items:g.recs.map(r=>({exName:r.exName, reps:r.reps, sets:r.sets, weight:r.weight, time:r.time, notes:r.notes||'', warm:!!r.warm}))}))
  }));
  const G=P.groups;
  return {programs: folders.length ? [{name:'', folders}] : [], errors:P.errors,
    period: G.length ? `${fmtDate(G[0].start)} — ${fmtDate(G[G.length-1].start)}` : ''};
}
function previewProgram(rows){
  let PP;
  try{ PP=parsePrograms(rows); }
  catch(err){ ask(esc(err.message),'OK',false,null); return; }
  let nF=0, nD=0, nI=0; const names=new Set();
  PP.programs.forEach(p=>p.folders.forEach(f=>{ nF++; f.days.forEach(d=>{ nD++; d.items.forEach(it=>{ nI++; names.add(normKey(it.exName)); }); }); }));
  if(!nD){ ask('В таблице не нашлось ни одной тренировки.'+errHtml(PP.errors),'OK',false,null); return; }
  pendingProg=PP;
  const have=new Set(DB.exercises.map(e=>normKey(e.name)));
  const newEx=[...names].filter(n=>!have.has(n)).length;
  const single=PP.programs.length===1;
  const defName = single ? (PP.programs[0].name || `Программа ${fmtDate(Date.now())}`) : '';
  openModal(`<div class="sheet-head"><h2>Загрузка программы</h2>${closeX()}</div>
    <div class="stats-summary">
      <div class="stats-box"><div class="lbl">${single?'Папок':'Программ'}</div><div class="val">${single?nF:PP.programs.length}</div></div>
      <div class="stats-box"><div class="lbl">Тренировок</div><div class="val">${nD}</div></div>
      <div class="stats-box"><div class="lbl">Упражнений</div><div class="val">${nI}</div></div>
      <div class="stats-box"><div class="lbl">Новых упр.</div><div class="val">${newEx}</div></div>
    </div>
    ${PP.period?`<p class="muted">Из записей за ${PP.period}. Тренировки разложены по неделям, даты не сохраняются.</p>`:''}
    ${errHtml(PP.errors)}
    ${single
      ? `<label for="ipName">Название программы</label><input id="ipName" value="${esc(defName)}" autocomplete="off" autocapitalize="sentences">`
      : `<p class="muted">Программы: ${PP.programs.map(p=>'«'+esc(p.name||'Без названия')+'»').join(', ')}</p>`}
    ${DB.programs.length?`<label class="check"><input type="checkbox" id="ipReplace" checked>Заменить программу с таким же названием</label>`:''}
    <button class="btn big" data-act="import-prog-run">${I('clip')}${single?'Загрузить программу':'Загрузить программы'}</button>
    <button class="btn ghost big" data-act="close-modal">Отмена</button>`);
}
function runProgramImport(){
  const PP=pendingProg; if(!PP) return;
  const single=PP.programs.length===1;
  let nameOv=null;
  if(single){
    nameOv=cleanName($('#ipName').value);
    if(!nameOv){ markBad($('#ipName'),true); toast('Введите название программы'); return; }
  }
  const replace=!!($('#ipReplace') && $('#ipReplace').checked);
  const res=applyProgramImport(PP, nameOv, replace);
  pendingProg=null;
  closeModal();
  if(single && res.lastId!=null) openProgram(res.lastId); else go('prog');
  toast(res.replaced && !res.created ? 'Программа обновлена' : `Загружено: ${res.created+res.replaced} ${plural(res.created+res.replaced,'программа','программы','программ')}`, null, null, null, 'check');
}
function applyProgramImport(PP, nameOv, replace){
  let created=0, replaced=0, lastId=null;
  PP.programs.forEach(pp=>{
    const name = nameOv || pp.name || `Программа ${fmtDate(Date.now())}`;
    const folders=pp.folders.map(f=>({id:nid('prog'), name:f.name, days:f.days.map(d=>({id:nid('prog'), name:d.name,
      items:d.items.map(it=>({exId:getOrCreateEx(it.exName).id, reps:it.reps, sets:it.sets, weight:it.weight, time:it.time, notes:it.notes||'', warm:!!it.warm, rest:it.rest!=null?it.rest:null}))}))}));
    const old = replace ? DB.programs.find(p=>normKey(p.name)===normKey(name)) : null;
    if(old){ old.name=name; old.folders=folders; replaced++; lastId=old.id; }
    else{
      const p={id:nid('prog'), name:uniqueName(name, DB.programs.map(x=>x.name)), folders};
      DB.programs.push(p); created++; lastId=p.id;
    }
  });
  validatePlan(); save();
  return {created, replaced, lastId};
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
    const ok=await ask(`Все текущие записи (${DB.records.length} ${plural(DB.records.length,'запись','записи','записей')}) будут удалены и заменены таблицей. Программы и замеры останутся. Если сомневаетесь — сначала сделайте полную копию.`,'Заменить',true);
    if(!ok) return;
    // программы и упражнения, на которые они ссылаются, сохраняются
    const keepExport=DB.lastExport, progs=DB.programs, seq=Object.assign({}, DB.seq), meas=DB.measures, mk=DB.mkinds;
    const used=new Set(); forEachItem(it=>used.add(it.exId));
    const keepEx=DB.exercises.filter(e=>used.has(e.id));
    resetAll();
    DB.lastExport=keepExport; DB.programs=progs; DB.exercises=keepEx; DB.seq=seq; DB.measures=meas; DB.mkinds=mk;
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
        reps:r.reps, sets:r.sets, weight:r.weight, time:r.time, notes:r.notes||'', warm:!!r.warm});
      added++;
    });
  });
  P.exOnly.forEach(n=>getOrCreateEx(n));
  cleanupWorkouts(); save();
  return {added, dup, newW, newEx:DB.exercises.length-ex0};
}

async function clearAll(){
  if(!await ask('Удалить <b>все</b> тренировки, записи, упражнения и программы? Отменить будет нельзя. Рекомендуем сначала сделать полную копию.','Удалить всё',true)) return;
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
    case 'rest-jump':        jumpToRest(); break;
    case 'notes-toggle':     toggleNotes(); break;
    case 'w-addrec':         openRecAdd(id); break;
    case 'w-addrec-save':    saveRecAdd(id); break;
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
    case 'warm-toggle':      setWarm(!warmOn); break;
    case 'ar-mode':          setArMode(el.dataset.m); break;
    case 'plan-toggle':      togglePlan(); break;
    case 'w-rename':         renameWorkout(id); break;
    case 'w-rename-active':  if(DB.active.wId) renameWorkout(DB.active.wId); break;
    case 'w-label-save':     saveWorkoutLabel(id); break;
    case 'auto-src':         setAutoSrc(el.dataset.src); break;
    case 'sw-toggle':        swToggle(); break;
    case 'w-export':         openWorkoutExport(id); break;
    case 'sum-share':        shareSummary(id); break;
    case 'fill-chip':        fillChip(el.dataset.src, +el.dataset.i); break;
    case 'fill-plan-ex':     fillFromPlanEx(); break;
    case 'w-summary':        openSummary(id); break;
    case 'stats-mode':       statsMode=el.dataset.mode; renderStats(); break;
    case 'wk':               selectWeek(+el.dataset.i); break;
    case 'm-open':           openMeasure(el.dataset.k); break;
    case 'm-save':           saveMeasure(el.dataset.k || (document.querySelector('[data-act="m-save"][data-k]')||{}).dataset.k); break;
    case 'm-del':            delMeasure(id); break;
    case 'm-add-all':        openMeasureAll(); break;
    case 'm-save-all':       saveMeasureAll(); break;
    case 'm-kind-add':       addMeasureKind(); break;
    case 'm-kind-save':      saveMeasureKind(); break;
    case 'm-kind-del':       delMeasureKind(el.dataset.k); break;
    case 'm-migrate':        migrateWeight(); break;
    case 'data':             openDataSheet(); break;
    case 'export':           openExport(); break;
    case 'export-share':     shareExport(); break;
    case 'export-download':  downloadExport(); break;
    case 'export-copy':      copyExport(); break;
    case 'import':           openImport(el.dataset.kind); break;
    case 'import-run':       runImport(el.dataset.mode); break;
    case 'clear-all':        clearAll(); break;
    case 'backup':           openBackup(); break;
    case 'backup-restore':   restoreBackup(); break;
    case 'import-prog-run':  runProgramImport(); break;
    case 'app-reload':       location.reload(); break;
    case 'hint-off':         try{ localStorage.setItem(HINT_KEY,'1'); }catch(_){} renderNotices(); break;
    // программы
    case 'name-save':        nameSave(); break;
    case 'prog-add':         newProgram(); break;
    case 'prog-open':        openProgram(id); break;
    case 'prog-back':        curProg=null; go('prog'); break;
    case 'prog-menu':        openProgMenu(); break;
    case 'prog-rename':      renameProgram(); break;
    case 'prog-copy':        copyProgram(); break;
    case 'prog-del':         deleteProgram(); break;
    case 'prog-export':      openProgExport([id]); break;
    case 'prog-export-all':  openProgExport(DB.programs.map(p=>p.id)); break;
    case 'prog-template':    openProgExport([], true); break;
    case 'folder-add':       addFolder(); break;
    case 'folder-menu':      openFolderMenu(id); break;
    case 'folder-rename':    renameFolder(id); break;
    case 'folder-dup':       dupFolder(id); break;
    case 'folder-move':      moveFolder(id, +el.dataset.d); break;
    case 'folder-del':       deleteFolder(id); break;
    case 'day-open':         openDay(id); break;
    case 'day-add':          openDayEdit(null, id); break;
    case 'day-edit':         openDayEdit(id); break;
    case 'day-edit-cancel':  dayEditCancel(); break;
    case 'day-save':         saveDay(); break;
    case 'day-dup':          dupDay(id); break;
    case 'day-del':          deleteDay(id); break;
    case 'di-add':           dayItemAdd(); break;
    case 'di-move':          dayItemMove(+el.dataset.i, +el.dataset.d); break;
    case 'di-del':           dayItemDel(+el.dataset.i); break;
    case 'plan-pick':        openPlanPicker(); break;
    case 'plan-start':       startPlan(id); break;
    case 'plan-close':       closePlan(); break;
    case 'plan-fill':        fillFromPlan(+el.dataset.i); break;
    case 'plan-next':        fillFromPlan(+el.dataset.i, true); break;
    case 'w-toprog':         openAddToProg(id); break;
    case 'ap-save':          saveAddToProg(); break;
  }
});

document.addEventListener('change', e=>{
  const t=e.target;
  if(t.id==='importFile') onImportFile(t);
  else if(t.dataset && t.dataset.filter==='ex'){ tblEx=t.value; renderStats(); }
  else if(t.dataset && t.dataset.filter==='period'){ tblPeriod=t.value; renderStats(); }
  else if(t.id==='apProg') updateAp(true);
  else if(t.id==='apFolder') updateAp(false);
});
document.addEventListener('input', e=>{
  const t=e.target;
  if(t.id==='apName') t.dataset.auto='0';
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
  try{ if(AC && AC.state!=='running') AC.resume().catch(()=>{}); }catch(_){}   // разбудить звук после сворачивания
  if(DB.active.restEnd){ tickRest(); requestWake(); }
  if(!$('#modal').classList.contains('show')) refresh();
  checkForgotten();
  if(swReg) swReg.update().then(checkUpdate, checkUpdate);   // проверить, не вышла ли новая версия
  else checkUpdate();
});

// изменения из другой вкладки/окна
window.addEventListener('storage', e=>{
  if(e.key!==DB_KEY || !e.newValue) return;
  try{ DB=normalize(JSON.parse(e.newValue)); renderWorkoutBar(); refresh(); }catch(_){}
});

window.onerror=function(msg, src, line){ console.error('Ошибка:', msg, 'строка', line); return false; };

/* ================== ОФЛАЙН И ОБНОВЛЕНИЯ ==================
   Версия приложения задаётся в одном месте — version.js (его читают и страница, и Service Worker).
   Страница знает свою версию (APP_VERSION) и спрашивает у Service Worker, какая версия у него.
   Если у SW новее — значит, на GitHub вышло обновление и оно уже скачано: показываем плашку «Обновить».
   Проверка идёт при запуске, при возврате в приложение и при смене SW — событие не потеряется. */
const APP_VERSION = window.APP_VERSION || '?';
let swReg=null, updateReady=false;
function swVersion(sw){
  return new Promise(res=>{
    if(!sw){ res(null); return; }
    try{
      const ch=new MessageChannel();
      const t=setTimeout(()=>res(null), 2000);
      ch.port1.onmessage=e=>{ clearTimeout(t); res(e.data); };
      sw.postMessage('version', [ch.port2]);
    }catch(e){ res(null); }
  });
}
async function checkUpdate(){
  if(updateReady || !('serviceWorker' in navigator)) return;
  const v=await swVersion(navigator.serviceWorker.controller);
  if(v && APP_VERSION!=='?' && v!==APP_VERSION){
    updateReady=true;
    renderNotices();
    toast('Вышла новая версия приложения', 'Обновить', ()=>location.reload(), 8000, 'swap');
  }
}
function updateHtml(){
  return updateReady ? `<div class="warn-line upd-line" data-act="app-reload">${I('swap')}<span>Вышла новая версия приложения — нажмите, чтобы обновить</span></div>` : '';
}
if('serviceWorker' in navigator && location.protocol==='https:'){
  navigator.serviceWorker.register('sw.js', {updateViaCache:'none'})
    .then(r=>{
      swReg=r;
      // новая версия установилась, пока приложение открыто
      r.addEventListener('updatefound', ()=>{
        const w=r.installing; if(!w) return;
        w.addEventListener('statechange', ()=>{ if(w.state==='activated') checkUpdate(); });
      });
    })
    .catch(()=>{});
  navigator.serviceWorker.addEventListener('controllerchange', checkUpdate);
  navigator.serviceWorker.ready.then(()=>checkUpdate()).catch(()=>{});
}

/* ================== СТАРТ ================== */
initTopRest();
if(swStart){ swTimer=setInterval(swRender, 500); }
swRender();
renderRestPresets();
$$('.note-toggle').forEach(b=>b.classList.toggle('active', notesOn));
$('#scroller').addEventListener('scroll', ()=>{ if(DB.active.restEnd) updateTopRest(); }, {passive:true});
askPersist();
fixOrphans();
fixProgramRefs();
cleanupWorkouts();
save();
renderWorkoutBar();
if(DB.active.restEnd){
  if(DB.active.restEnd>Date.now()) showRest();
  else finishRest(Date.now()-DB.active.restEnd<15000);
}
showView('record');
renderRecord();
checkForgotten();
