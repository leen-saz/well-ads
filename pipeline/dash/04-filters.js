// ---- UI: filters
function platBtn(p, pressed){
  const org = S.mode==='organic';
  const off = !org && p==='tiktok' && TT.state!=='ok';
  const label = p==='all' ? 'كل المنصات' : `<span class="dot" style="background:var(${(PL[p]||{}).c||'--s-meta'})"></span> ${platName(p)}`;
  return `<button type="button" data-v="${p}" aria-pressed="${pressed}"${off?` disabled title="${esc(TT.state==='loading'?'جاري تحميل تيك توك':'تيك توك غير متاح')}" style="opacity:.5"`:''}>${label}</button>`;
}
function buildFilters(){
  $('#presets').innerHTML = PRESETS.map(([k,l])=>`<button type="button" data-k="${k}" aria-pressed="${S.preset===k}">${l}</button>`).join('');
  const org = S.mode==='organic';
  const metaKids = ORDER.filter(p=>family(p)==='meta' && p!=='meta');
  const gKids = ORDER.filter(p=>family(p)==='google' && p!=='google');
  let top;
  if(org) top = ['all','facebook','instagram','tiktok'];
  else {
    top = ['all'];
    if(metaKids.length) top.push(...metaKids); else if(ORDER.includes('meta')) top.push('meta');
    for(const p of ORDER){ if(family(p)==='meta'||family(p)==='google') continue; top.push(p); }
    if(gKids.length || ORDER.includes('google')) top.push('google');
  }
  $('#plats').innerHTML = top.map(p=>platBtn(p, p==='google' ? family(S.plat)==='google' : S.plat===p)).join('');
  const gRow=$('#gRow');
  if(gRow){
    gRow.hidden = org || !gKids.length;
    $('#gtypes').innerHTML = gKids.map(p=>platBtn(p, S.plat===p)).join('');
  }
  document.querySelectorAll('#mode button').forEach(b=>b.setAttribute('aria-pressed', b.dataset.v===S.mode));
  document.querySelectorAll('#wallStat button').forEach(b=>b.setAttribute('aria-pressed', S.wall===b.dataset.v));
  const adsOnly=$('#adsOnly'); if(adsOnly) adsOnly.hidden=org;
  const hint=$('#deptOrgHint'); if(hint) hint.hidden=!org;
  for(const id of ['from','to']){ const el=$('#'+id); el.min=MIN; el.max=TODAY; }
  dpLabel();
}
$('#presets').addEventListener('click',e=>{const b=e.target.closest('button'); if(!b) return; const pr=PRESETS.find(x=>x[0]===b.dataset.k); if(!pr) return; [S.from,S.to]=pr[2](); S.from=clamp(S.from); S.to=clamp(S.to); if(S.from>S.to)[S.from,S.to]=[S.to,S.from]; S.preset=pr[0]; S.shown=24; S.orgShown=24; save(); render();});
$('#plats').addEventListener('click',e=>{const b=e.target.closest('button'); if(!b||b.disabled) return; S.plat=b.dataset.v; S.shown=24; S.orgShown=24; save(); render();});
$('#stat').addEventListener('click',e=>{const b=e.target.closest('button'); if(!b) return; applyStat(b.dataset.v);});
$('#gtypes').addEventListener('click',e=>{const b=e.target.closest('button'); if(!b||b.disabled) return; S.plat=b.dataset.v; S.shown=24; S.orgShown=24; save(); render();});
$('#wallStat').addEventListener('click',e=>{const b=e.target.closest('button'); if(!b) return; applyStat(b.dataset.v);});
$('#mode').addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b||b.dataset.v===S.mode) return; applyMode(b.dataset.v,true); });
function isoDate(v){ return /^\d{4}-\d{2}-\d{2}$/.test(v||'') ? v : ''; }

// ---- اختيار تاريخ: a month calendar of the days that have data (MIN..TODAY, Riyadh days as YYYY-MM-DD strings).
// First click picks the start, second the end (in either order); the from/to fields type the same range; Apply sets it.
const DP = { from:'', to:'', month:'' };
const dpOpen = () => !$('#dpick').hidden;
function dpLabel(){
  const btn=$('#dpickBtn'); if(!btn) return;
  btn.setAttribute('aria-pressed', String(!S.preset));
  $('#dpickLbl').textContent = S.preset ? tr('اختيار تاريخ') : (S.from===S.to ? nice(S.from) : `${nice(S.from)} – ${nice(S.to)}`);
}
function dpDraw(){
  const [y,m] = DP.month.split('-').map(Number), first = `${DP.month}-01`;
  const days = new Date(Date.UTC(y,m,0)).getUTCDate(), lead = toD(first).getUTCDay();
  $('#dpMonth').textContent = `${monthName(m-1)} ${y}`;
  $('#dpWeek').innerHTML = (LANG==='en' ? ['Su','Mo','Tu','We','Th','Fr','Sa'] : ['ح','ن','ث','ر','خ','ج','س']).map(d=>`<span>${d}</span>`).join('');
  const lo = DP.from, hi = DP.to || DP.from, cells = Array.from({length:lead},()=>'<span></span>');
  for(let d=1; d<=days; d++){
    const s = `${DP.month}-${String(d).padStart(2,'0')}`, off = s<MIN || s>TODAY;
    const cls = [s===lo?'s':'', s===hi?'e':'', lo && s>lo && s<hi ? 'in':'', s===TODAY?'today':''].filter(Boolean).join(' ');
    cells.push(`<button type="button" data-d="${s}" class="${cls}" aria-label="${nice(s)} ${y}" aria-pressed="${s===lo||s===hi||(!!lo&&s>lo&&s<hi)}"${off?' disabled':''}>${d}</button>`);
  }
  $('#dpGrid').innerHTML = cells.join('');
  const prev = $('#dpick [data-nav="-1"]'), next = $('#dpick [data-nav="1"]');
  prev.textContent = ui('›','‹'); next.textContent = ui('‹','›');
  prev.disabled = first <= MIN.slice(0,7)+'-01'; next.disabled = first >= TODAY.slice(0,7)+'-01';
  $('#from').value = DP.from; $('#to').value = DP.to || DP.from;
  $('#dpSel').textContent = !DP.from ? tr('اختار يوم البداية') : !DP.to ? tr('اختار يوم النهاية') : `${nice(DP.from)} – ${nice(DP.to)} (${diffDays(DP.from,DP.to)+1} ${tr('يوم')})`;
  $('#dpApply').disabled = !DP.from;
}
function dpShow(on){
  const box=$('#dpick'), btn=$('#dpickBtn');
  box.hidden = !on; btn.setAttribute('aria-expanded', String(on));
  if(!on) return;
  DP.from = S.from; DP.to = S.to; DP.month = S.to.slice(0,7);
  dpDraw();
  ($('#dpGrid .e') || $('#dpGrid button:not(:disabled)'))?.focus();
}
function dpMonth(n){
  const [y,m] = DP.month.split('-').map(Number), d = new Date(Date.UTC(y, m-1+n, 1));
  DP.month = toS(d).slice(0,7); dpDraw();
}
$('#dpickBtn').addEventListener('click', ()=>dpShow(!dpOpen()));
$('#dpick').addEventListener('click', e=>{
  const nav = e.target.closest('[data-nav]'); if(nav){ dpMonth(+nav.dataset.nav); return; }
  const b = e.target.closest('#dpGrid button[data-d]'); if(!b || b.disabled) return;
  const d = b.dataset.d;
  if(!DP.from || DP.to){ DP.from = d; DP.to = ''; }
  else if(d < DP.from){ DP.to = DP.from; DP.from = d; }
  else DP.to = d;
  dpDraw(); $(`#dpGrid button[data-d="${d}"]`)?.focus();
});
// Arrow keys move a day (right/left follow the reading direction), up/down a week; Escape closes
$('#dpick').addEventListener('keydown', e=>{
  if(e.key==='Escape'){ e.preventDefault(); dpShow(false); $('#dpickBtn').focus(); return; }
  const b = e.target.closest && e.target.closest('#dpGrid button[data-d]'); if(!b) return;
  const rtl = getComputedStyle($('#dpick')).direction==='rtl';
  const step = {ArrowLeft: rtl?1:-1, ArrowRight: rtl?-1:1, ArrowUp:-7, ArrowDown:7}[e.key]; if(!step) return;
  e.preventDefault();
  let d = addDays(b.dataset.d, step); d = d<MIN?MIN:d>TODAY?TODAY:d;
  if(d.slice(0,7)!==DP.month){ DP.month = d.slice(0,7); dpDraw(); }
  $(`#dpGrid button[data-d="${d}"]`)?.focus();
});
// The typed fields set the same pending range (applied with the button, like a click on the calendar)
for(const id of ['from','to']){ $('#'+id).addEventListener('change', ()=>{
  const f=isoDate($('#from').value), t=isoDate($('#to').value); if(!f) return;
  let a=clamp(f), z=clamp(t||f); if(a>z)[a,z]=[z,a];
  DP.from=a; DP.to=z; DP.month=z.slice(0,7); dpDraw();
}); }
$('#dpApply').addEventListener('click', ()=>{
  if(!DP.from) return;
  let f=clamp(DP.from), t=clamp(DP.to||DP.from); if(f>t)[f,t]=[t,f];
  S.from=f; S.to=t; S.preset=null; S.shown=24; S.orgShown=24; dpShow(false); save(); render(); $('#dpickBtn').focus();
});
$('#dpCancel').addEventListener('click', ()=>{ dpShow(false); $('#dpickBtn').focus(); });
// Outside clicks close it. The path is read from the event: a day click redraws the grid, so its button is no longer in the page
document.addEventListener('click', e=>{ if(dpOpen() && !e.composedPath().some(n=>n.classList && n.classList.contains('dpick-wrap'))) dpShow(false); });
$('#q').addEventListener('input',e=>{S.q=e.target.value.trim();S.shown=24;renderCards(cur);});
$('#sort').addEventListener('change',e=>{S.sort=e.target.value;S.shown=24;save();renderCards(cur);});
$('#more').addEventListener('click',()=>{S.shown+=24;renderCards(cur);});

