// ---- dates (all strings YYYY-MM-DD, UTC math to avoid DST issues)
const toD = s => new Date(s+'T00:00:00Z');
const toS = d => d.toISOString().slice(0,10);
const addDays = (s,n) => { const d=toD(s); d.setUTCDate(d.getUTCDate()+n); return toS(d); };
const diffDays = (a,b) => Math.round((toD(b)-toD(a))/864e5);
const MIN = D.range.start, MAX = D.range.end, TODAY = D.range.today || D.range.end;
const clamp = s => s<MIN?MIN:s>TODAY?TODAY:s;
// The quick periods. Days are the data's own (Riyadh) days: TODAY is today in Riyadh, MAX the last complete day.
// Keys stay as before ('7', '30', '90') so saved choices keep working; any other range is picked on the calendar.
const PRESETS = [
  ['t','اليوم',()=>[TODAY,TODAY]],
  ['y','أمس',()=>{ const y=addDays(TODAY,-1); const d=y<MIN?MIN:y>TODAY?TODAY:y; return [d,d]; }],
  ['7','آخر أسبوع',()=>[addDays(MAX,-6),MAX]],
  ['30','آخر شهر',()=>[addDays(MAX,-29),MAX]],
  ['90','كل الفترة',()=>[MIN,TODAY]],
];
const MONTHS_AR=['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
const MONTHS_EN=['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS_AR=['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
const DAYS_EN=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
function monthName(i){ return (LANG==='en'?MONTHS_EN:MONTHS_AR)[i]; }
function dayName(i){ return (LANG==='en'?DAYS_EN:DAYS_AR)[i]; }
const nice = s => { const d=toD(s); const day=d.getUTCDate(), mon=monthName(d.getUTCMonth()); return LANG==='en'? mon+' '+day : day+' '+mon; };

// ---- state. mode is shareable via ?mode=organic (also accepts #organic)
function modeFromUrl(){
  const q = new URLSearchParams(location.search).get('mode');
  if(q==='organic'||q==='ads') return q;
  const h = decodeURIComponent((location.hash||'').replace(/^#/,''));
  if(h==='organic'||h==='mode=organic') return 'organic';
  if(h==='ads'||h==='mode=ads') return 'ads';
  return 'ads';
}
// /creative (or ?view=creative): only the creative wall and the KPIs above it
const CREATIVE_ONLY = /^\/(creative|c)\/?$/.test(location.pathname) || new URLSearchParams(location.search).get('view')==='creative';
const S = {mode:CREATIVE_ONLY?'ads':modeFromUrl(), page:CREATIVE_ONLY?'creative':'overview', dept:'', from:addDays(MAX,-6), to:MAX, preset:'7', plat:'all', stat:'all', wall:'all', q:'', sort:'spend', shown:24, orgQ:'', orgSort:'date', orgShown:24, camp:'', goal:'', fmt:'', gran:'auto', open:new Set(), crmBy:'lead'};
try{ const p=JSON.parse(localStorage.getItem('well-ads-ui')||'{}'); if(p.preset){const pr=PRESETS.find(x=>x[0]===p.preset); if(pr){[S.from,S.to]=pr[2]();S.preset=p.preset;}} else if(/^\d{4}-\d{2}-\d{2}$/.test(p.from||'') && /^\d{4}-\d{2}-\d{2}$/.test(p.to||'')){ S.from=clamp(p.from); S.to=clamp(p.to); if(S.from>S.to)[S.from,S.to]=[S.to,S.from]; S.preset=null; } if(p.plat) S.plat=p.plat; if(p.sort) S.sort=p.sort; if(p.orgSort) S.orgSort=p.orgSort; if(p.stat==='live'||p.stat==='off'){ S.stat=p.stat; S.wall=p.stat==='live'?'on':'off'; } }catch(e){}
if(HIDDEN_PLAT.has(S.plat)) S.plat='all';
if(HIDDEN_DEPT.has(S.dept)) S.dept='';
function syncModeShape(){
  if(S.mode==='organic'){
    if(!['accounts','posts'].includes(S.page)) S.page='accounts';
    if(!['all','facebook','instagram','tiktok'].includes(S.plat)) S.plat='all';
  }else if(!['overview','depts','dept','channels','creative'].includes(S.page)) S.page='overview';
}
{ const q=new URLSearchParams(location.search).get('p'); if(q && !CREATIVE_ONLY) S.page=q; }
syncModeShape();
if(S.mode==='organic' && new URLSearchParams(location.search).get('mode')!=='organic'){
  const url=new URL(location.href); url.searchParams.set('mode','organic'); url.hash='';
  history.replaceState({mode:'organic'},'',url.pathname+url.search);
}
let TARGET=null; try{ const t=parseFloat(localStorage.getItem('well-ads-target')); if(t>0) TARGET=t; }catch(e){}
const tgtStyle = v => !TARGET||v==null||!isFinite(v) ? '' : v<=TARGET ? 'background:color-mix(in srgb, var(--accent) 22%, transparent);border-radius:6px;padding:1px 6px'
  : v>TARGET*1.25 ? 'background:color-mix(in srgb, var(--pulse) 30%, transparent);border-radius:6px;padding:1px 6px' : '';
const tgtCell = v => `<span style="${tgtStyle(v)}">${sar(v)}</span>`;
const save = () => { try{ localStorage.setItem('well-ads-ui',JSON.stringify({preset:S.preset,from:S.preset?null:S.from,to:S.preset?null:S.to,plat:S.plat,sort:S.sort,orgSort:S.orgSort,stat:S.stat})); }catch(e){} };
function samePlat(p){
  if(S.plat==='all') return true;
  if(S.plat==='google') return family(p)==='google';
  if(S.plat==='meta') return family(p)==='meta';
  return p===S.plat;
}
function orderNow(){ return ORDER.filter(p=>samePlat(p)); }

