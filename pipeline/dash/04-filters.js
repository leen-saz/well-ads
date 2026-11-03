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
}
$('#presets').addEventListener('click',e=>{const b=e.target.closest('button'); if(!b) return; const pr=PRESETS.find(x=>x[0]===b.dataset.k); if(!pr) return; [S.from,S.to]=pr[2](); S.from=clamp(S.from); S.to=clamp(S.to); if(S.from>S.to)[S.from,S.to]=[S.to,S.from]; S.preset=pr[0]; S.shown=24; S.orgShown=24; save(); render();});
$('#plats').addEventListener('click',e=>{const b=e.target.closest('button'); if(!b||b.disabled) return; S.plat=b.dataset.v; S.shown=24; S.orgShown=24; save(); render();});
$('#stat').addEventListener('click',e=>{const b=e.target.closest('button'); if(!b) return; applyStat(b.dataset.v);});
$('#gtypes').addEventListener('click',e=>{const b=e.target.closest('button'); if(!b||b.disabled) return; S.plat=b.dataset.v; S.shown=24; S.orgShown=24; save(); render();});
$('#wallStat').addEventListener('click',e=>{const b=e.target.closest('button'); if(!b) return; applyStat(b.dataset.v);});
$('#mode').addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b||b.dataset.v===S.mode) return; applyMode(b.dataset.v,true); });
function isoDate(v){ return /^\d{4}-\d{2}-\d{2}$/.test(v||'') ? v : ''; }
function applyDates(){
  const rawF=isoDate($('#from').value), rawT=isoDate($('#to').value);
  if(!rawF || !rawT) return;
  let f=clamp(rawF), t=clamp(rawT); if(f>t)[f,t]=[t,f];
  if(f===S.from && t===S.to && !S.preset) return;
  S.from=f; S.to=t; S.preset=null; S.shown=24; S.orgShown=24; save(); render();
}
for(const id of ['from','to']){ const el=$('#'+id); el.addEventListener('change', applyDates); el.addEventListener('input', applyDates); }
$('#q').addEventListener('input',e=>{S.q=e.target.value.trim();S.shown=24;renderCards(cur);});
$('#sort').addEventListener('change',e=>{S.sort=e.target.value;S.shown=24;save();renderCards(cur);});
$('#more').addEventListener('click',()=>{S.shown+=24;renderCards(cur);});

