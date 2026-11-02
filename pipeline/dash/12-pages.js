// ---- pages, departments
const PAGES = () => S.mode==='organic'
  ? [['accounts','الحسابات'],['posts','المنشورات']]
  : [['overview','نظرة عامة'],['depts','الأقسام'],...DORDER.map(k=>['dept:'+k, DEP[k].ar]),['channels','المنصات والحملات'],['creative','الكرييتف']];
function renderTabs(){
  const el=$('#tabs'); if(!el) return;
  el.hidden = CREATIVE_ONLY;
  el.innerHTML = PAGES().filter(([id])=>!id.startsWith('dept:')).map(([id,l])=>`<button type="button" data-p="${id}" aria-current="${tabOn(id)||(id==='depts'&&S.page==='dept')?'page':'false'}">${tr(l)}</button>`).join('');
}
function tabOn(id){ return id.startsWith('dept:') ? S.page==='dept' && S.dept===id.slice(5) : S.page===id; }
function setDept(k){
  S.dept = S.dept===k ? '' : k;
  S.camp=''; S.shown=24; save(); render();
}
function aggAllDepts(from,to){
  const keep=S.dept; S.dept=''; const r=agg(from,to); S.dept=keep;
  const by={}, byDP={};
  for(const [k,o] of Object.entries(r.byAd)){
    const a=ADS[k], dk=a.dept||'brand';
    const x=by[dk] ||= {spend:0,impr:0,clicks:0,leads:0,conv:0,leadSpend:0,leadN:0,ads:0};
    const y=(byDP[dk] ||= {})[a.platform] ||= {spend:0,leads:0,leadSpend:0,leadN:0,conv:0,impr:0,clicks:0};
    for(const f of ['spend','impr','clicks','leads','conv','leadSpend','leadN']){ x[f]+=o[f]||0; if(y[f]!=null) y[f]+=o[f]||0; }
    x.ads++;
  }
  return {by,byDP,tot:r.tot};
}
function lastSpendDate(dk, inRange){
  let m='';
  for(const r of D.rows){
    const a=ADS[r[0]];
    if(!a || a.dept!==dk || !(r[2]>0)) continue;
    if(HIDDEN_PLAT.has(a.platform) || !samePlat(a.platform) || !passesStatus(a)) continue;
    if(S.camp && a.platform+'|'+a.campaign!==S.camp) continue;
    if(S.goal && a.goal!==S.goal) continue;
    if(S.fmt && (a.format||'')!==S.fmt) continue;
    if(inRange && (r[1]<S.from || r[1]>S.to)) continue;
    if(r[1]>m) m=r[1];
  }
  return m;
}
