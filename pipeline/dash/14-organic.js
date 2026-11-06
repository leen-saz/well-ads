function sumField(days, field){
  const have=new Map();
  for(const d of days||[]){
    if(!d.date||d.date<S.from||d.date>S.to||d[field]==null) continue;
    have.set(d.date, (have.get(d.date)||0)+Number(d[field]));
  }
  if(!have.size) return null;
  for(let d=S.from; d<=S.to; d=addDays(d,1)){ if(!have.has(d)) return null; }
  let n=0; for(const v of have.values()) n+=v;
  return n;
}
function periodMatch(page){
  const p=page&&page.period;
  return !!(p && p.start===S.from && p.end===S.to);
}
function metricOf(page, field){
  const summed=sumField(page&&page.days, field);
  if(summed!=null) return summed;
  if(periodMatch(page) && page.period[field]!=null) return Number(page.period[field]);
  return null;
}
function uniqueOf(page, field){
  if(S.from===S.to){
    const hit=(page&&page.days||[]).find(d=>d.date===S.from && d[field]!=null);
    if(hit) return Number(hit[field]);
  }
  if(periodMatch(page) && page.period[field]!=null) return Number(page.period[field]);
  return null;
}
function needsHTML(needs){
  const list=(needs||[]).filter(Boolean);
  return '';
}
function pendingKind(network){
  if(network==='tiktok') return 'tiktok';
  if(network==='ga4') return 'ga4';
  return 'meta';
}
function pendingBlock(title, needs, kind){
  needsHTML(needs);
  return `<section class="panel pend"><div class="panel-h"><h2>${esc(title)}</h2><span class="pill pending">بانتظار البيانات</span></div><p class="hint">${esc(pendingCopy(kind||'meta'))}</p></section>`;
}
function pageHas(page){
  return !!((page.days&&page.days.length) || (page.posts&&page.posts.length) || page.followers!=null);
}
function metricText(value, pending){
  if(value!=null && value!=='' && isFinite(Number(value))) return fmt(Number(value));
  return pending ? ui('بانتظار الصلاحية','Awaiting permission') : fmt(value);
}
function noInsightSeries(page){
  if(page.days && page.days.length) return false;
  const period=page.period;
  if(period && (period.views!=null || period.reach!=null || period.engagement!=null)) return false;
  return true;
}
function careBlocked(page, network){
  return network==='facebook' && !!page && page.name==='Well Care.' && noInsightSeries(page);
}
function pageBlock(page, network){
  if(!page) return '';
  const label=platName(network)||'';
  if((page.status==='pending' || page.status==='stale' || !page.status) && !pageHas(page)) return pendingBlock(page.name||label, page.needs, pendingKind(network));
  const views=metricOf(page,'views'), reach=uniqueOf(page,'reach');
  const eng = network==='instagram' ? uniqueOf(page,'engagement') : metricOf(page,'engagement');
  const posts=(page.posts||[]).filter(p=>p.date && p.date>=S.from && p.date<=S.to && (!S.dept || p.dept===S.dept));
  const ins = page.insights==='pending' || careBlocked(page, network);
  const postWait = !posts.length && (page.posts_status==='pending' || (careBlocked(page, network) && !(page.posts||[]).length));
  const banner = page.needs&&page.needs.length ? (needsHTML(page.needs), `<p class="hint">${esc(pendingCopy(pendingKind(network)))}</p>`) : '';
  const period = !page.days?.length && page.period ? `<p class="hint">${periodMatch(page)
    ? `${ui('أرقام النافذة','Window totals')} ${esc(page.period.start)} – ${esc(page.period.end)} ${ui('لأن المنصة أعادت إجمالاً واحداً','because the platform returned one total')}`
    : `${ui('المنصة أعادت إجمالاً واحداً للفترة','The platform returned one total for')} ${esc(page.period.start)} – ${esc(page.period.end)} ${ui('ولا يُعرض هنا لأن الفترة مختلفة','and it is not shown because this range is different')}`}</p>` : '';
  const flag = page.status==='pending'||page.status==='stale' ? '<span class="pill pending">بانتظار تحديث</span>' : platCell(network);
  return `<section class="panel"><div class="panel-h"><h2>${esc(page.name||label)}</h2>${flag}</div>
    ${banner}${period}
    <div class="kpis">
      <div class="kpi hero"><span class="l">المتابعون الآن</span><span class="v">${fmt(page.followers)}</span></div>
      <div class="kpi"><span class="l">المشاهدات في الفترة</span><span class="v">${metricText(views, ins && views==null)}</span></div>
      <div class="kpi"><span class="l">الوصول في الفترة</span><span class="v">${metricText(reach, ins && reach==null)}</span></div>
      <div class="kpi"><span class="l">التفاعل في الفترة</span><span class="v">${metricText(eng, ins && eng==null)}</span></div>
      <div class="kpi"><span class="l">المنشورات في الفترة</span><span class="v">${postWait?metricText(null, true):fmt(posts.length)}</span></div>
    </div></section>`;
}
function organicPosts(){
  const org=D.organic||{}, out=[];
  const push=(p, network, page)=>{
    const item={...p, network:p.network||network, page:p.page||page||''};
    item.id=item.id||`${item.network}:${item.date||''}:${item.caption||''}`;
    const eng=item.engagement!=null?item.engagement:((item.likes||0)+(item.comments||0)+(item.shares||0)+(item.saves||0));
    item.engagement=eng;
    item.er=item.reach>0?100*eng/item.reach:null;
    out.push(item);
  };
  for(const page of org.facebook||[]) for(const p of page.posts||[]) push(p,'facebook',page.name);
  for(const page of org.instagram||[]) for(const p of page.posts||[]) push(p,'instagram',page.name);
  const tt=org.tiktok||{};
  for(const p of tt.posts||[]) push(p,'tiktok',tt.name||'تيك توك');
  return out;
}
function organicNeeds(){
  const org=D.organic||{}, needs=[];
  const add=n=>{ if(n && !needs.includes(n)) needs.push(n); };
  const pendingPage = page => !(page.posts||[]).length && (page.posts_status==='pending' || page.status==='pending' || page.status==='stale' || !page.status);
  const show = net => S.plat==='all' || S.plat===net;
  if(show('facebook')) for(const page of org.facebook||[]) if(pendingPage(page)) (page.needs||[]).forEach(add);
  if(show('instagram')) for(const page of org.instagram||[]) if(pendingPage(page)) (page.needs||[]).forEach(add);
  if(show('tiktok')){
    const tt=org.tiktok||{};
    if((!tt.status || tt.status==='pending' || tt.status==='stale') && !(tt.posts||[]).length) (tt.needs||['الموصّل الحالي يسحب الإعلانات المدفوعة فقط.']).forEach(add);
  }
  if(S.plat==='all'){
    const ga=org.ga4||{};
    if((!ga.status || ga.status==='pending' || ga.status==='stale') && !(ga.days||[]).length) (ga.needs||['GA4_PROPERTY_ID','GA4_SERVICE_ACCOUNT_JSON']).forEach(add);
  }
  return needs;
}
function organicList(){
  let list=organicPosts().filter(p=>{
    if(!p.date || p.date<S.from||p.date>S.to) return false;
    if(S.dept && p.dept!==S.dept) return false;
    if(S.plat!=='all' && p.network!==S.plat) return false;
    return true;
  });
  if(S.orgQ){ const q=S.orgQ.toLowerCase(); list=list.filter(p=>(`${p.caption||''} ${p.page||''} ${p.type||''}`).toLowerCase().includes(q)); }
  const num={views:p=>p.views||0, reach:p=>p.reach||0, likes:p=>p.likes||0, comments:p=>p.comments||0, shares:p=>p.shares||0, saves:p=>p.saves||0, eng:p=>p.er==null?-1:p.er};
  if(S.orgSort==='date') list.sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  else list.sort((a,b)=>(num[S.orgSort](b)-num[S.orgSort](a)) || (b.date||'').localeCompare(a.date||''));
  return list;
}
function orgSources(){
  const org=D.organic||{}, items=[];
  for(const page of org.facebook||[]) items.push({network:'facebook', page});
  for(const page of org.instagram||[]) items.push({network:'instagram', page});
  if(org.tiktok) items.push({network:'tiktok', page:org.tiktok});
  return items.filter(s=>S.plat==='all' || s.network===S.plat);
}
function gaBlock(){
  if(S.plat!=='all') return '';
  const ga=(D.organic||{}).ga4;
  if(!ga) return pendingBlock('Google Analytics', ['GA4_PROPERTY_ID','GA4_SERVICE_ACCOUNT_JSON'], 'ga4');
  const ok=ga.status==='ok' || (ga.days&&ga.days.length);
  if(!ok) return pendingBlock(ga.name||'Google Analytics', ga.needs, 'ga4');
  return `<section class="panel"><div class="panel-h"><h2>${esc(ga.name||'Google Analytics')}</h2><span class="pill">GA4</span></div>
    <div class="kpis">
      <div class="kpi hero"><span class="l">المستخدمون</span><span class="v">${fmt(S.from===S.to?metricOf(ga,'users'):null)}</span></div>
      <div class="kpi"><span class="l">الجلسات</span><span class="v">${fmt(metricOf(ga,'sessions'))}</span></div>
      <div class="kpi"><span class="l">مشاهدات الصفحات</span><span class="v">${fmt(metricOf(ga,'views'))}</span></div>
    </div>
    ${(ga.channels||[]).length && ga.window && ga.window.start===S.from && ga.window.end===S.to?`<div class="tbl"><table><thead><tr><th>القناة</th><th class="n">جلسات</th><th class="n">مستخدمون</th></tr></thead><tbody>${ga.channels.map(c=>`<tr><td>${esc(c.channel)}</td><td class="n">${fmt(c.sessions)}</td><td class="n">${fmt(c.users)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="hint">'+ui('تقسيم القنوات غير متاح لهذه الفترة.','Channel split is not available for this range.')+'</p>'}
  </section>`;
}
function pendingKinds(){
  const org=D.organic||{}, kinds=[];
  const show=net=>S.plat==='all'||S.plat===net;
  const missing=page=>page && (page.status==='pending'||page.status==='stale'||!page.status) && !pageHas(page);
  if((show('facebook')&&(org.facebook||[]).some(missing)) || (show('instagram')&&(org.instagram||[]).some(missing))) kinds.push('meta');
  if(show('tiktok') && missing(org.tiktok||{})) kinds.push('tiktok');
  if(S.plat==='all'){
    const ga=org.ga4||{};
    if((!ga.status || ga.status==='pending' || ga.status==='stale') && !(ga.days||[]).length) kinds.push('ga4');
  }
  return kinds;
}
function pendingLines(kinds){
  return (kinds||pendingKinds()).map(k=>`<p class="hint">${esc(pendingCopy(k))}</p>`).join('');
}
function renderAccounts(){
  const root=$('#acctPage'); if(!root) return;
  const note=extraNote('organic'); if(note){ root.innerHTML=note; return; }
  const list=orgSources();
  const hasFollowers=list.some(s=>s.page.followers!=null);
  const followers=list.reduce((n,s)=>n+(s.page.followers!=null?Number(s.page.followers):0),0);
  const add = arr => arr.length ? arr.reduce((a,b)=>a+b,0) : null;
  const views=list.map(s=>metricOf(s.page,'views'));
  const reach=list.map(s=>uniqueOf(s.page,'reach'));
  const eng=list.map(s=>s.network==='instagram'?uniqueOf(s.page,'engagement'):metricOf(s.page,'engagement'));
  const addExact = arr => arr.length && arr.every(v=>v!=null) ? arr.reduce((a,b)=>a+b,0) : null;
  const insWait = list.length && views.every(v=>v==null) && reach.every(v=>v==null) && eng.every(v=>v==null) && list.every(s=>s.page.insights==='pending' || careBlocked(s.page, s.network) || ((s.page.status==='pending'||s.page.status==='stale') && !(s.page.days||[]).length));
  const posts=organicPosts().filter(p=>(S.plat==='all'||p.network===S.plat) && (!S.dept || p.dept===S.dept) && p.date && p.date>=S.from && p.date<=S.to);
  const postsWait = !posts.length && list.some(s=>s.page.posts_status==='pending' || (careBlocked(s.page, s.network) && !(s.page.posts||[]).length));
  root.innerHTML = `<section class="kpis" aria-label="ملخص الحسابات">
    <div class="kpi hero"><span class="l">المتابعون الآن</span><span class="v">${hasFollowers?fmt(followers):'—'}</span></div>
    <div class="kpi"><span class="l">المشاهدات في الفترة</span><span class="v">${insWait?metricText(null,true):fmt(addExact(views))}</span></div>
    <div class="kpi"><span class="l">الوصول في الفترة</span><span class="v">${insWait?metricText(null,true):fmt(addExact(reach))}</span></div>
    <div class="kpi"><span class="l">التفاعل في الفترة</span><span class="v">${insWait?metricText(null,true):fmt(addExact(eng))}</span></div>
    <div class="kpi"><span class="l">المنشورات في الفترة</span><span class="v">${postsWait?metricText(null,true):fmt(posts.length)}</span></div>
  </section>` + list.map(s=>pageBlock(s.page, s.network)).join('') + gaBlock();
}
function renderPosts(){
  const cards=$('#ocards'); if(!cards) return;
  const note=extraNote('organic'); if(note){ cards.innerHTML=note; return; }
  const all=organicPosts(), list=organicList(), needs=organicNeeds();
  const bits=[ui(`${fmt(list.length)} منشور`,`${fmt(list.length)} posts`)];
  if(S.dept && depName(S.dept)) bits.push(depName(S.dept));
  if(S.plat!=='all') bits.push(platName(S.plat)||'');
  if($('#orgCount')) $('#orgCount').textContent=bits.join(' · ');
  if($('#osort') && document.activeElement!==$('#osort')) $('#osort').value=S.orgSort;
  const show=list.slice(0,S.orgShown);
  if(!all.length && needs.length){
    needsHTML(needs);
    cards.innerHTML=`<div class="empty"><div class="panel-h"><span>بانتظار بيانات المنشورات</span><span class="pill pending">بانتظار البيانات</span></div>${pendingLines()}</div>`;
  }else if(!list.length){
    cards.innerHTML='<div class="empty">لا يوجد منشور يطابق البحث أو الفلاتر في هذه الفترة.</div>';
  }else{
    cards.innerHTML=show.map(p=>{
      const title=(p.caption||'').trim() || p.type || 'منشور';
      return wallCard({
        key:p.id, wall:'post', label:ui('تفاصيل ','Details: ')+title.slice(0,80),
        thumb:mediaHTML({thumb:p.thumb, video:p.video, link:p.permalink, text:p.caption, name:title}, false),
        badges:`${platCell(p.network)}<span class="pill">${p.date?nice(p.date):'—'}</span>`,
        title:esc(title.length>110?title.slice(0,110)+'…':title),
        sub:`${depCell(p.dept)}${p.dsrc==='default'?' <span class="jdg" title="النص لا يحدد القسم">*</span>':''} ${esc(p.page||'')} ${p.type?`· ${esc(p.type)}`:''}`,
        stats:statCell('مشاهدات',metricText(p.views,p.insights==='pending'))+statCell('وصول',metricText(p.reach,p.insights==='pending'))+statCell('نسبة التفاعل',p.insights==='pending'&&p.er==null?metricText(null,true):pct(p.er))+statCell('إعجاب',fmt(p.likes))+statCell('تعليقات',fmt(p.comments))+statCell('مشاركات',metricText(p.shares,p.insights==='pending'))+statCell('حفظ',metricText(p.saves,p.insights==='pending')),
      });
    }).join('');
  }
  const more=$('#omore');
  if(more){ more.hidden=list.length<=S.orgShown; more.textContent=ui(`عرض المزيد (${fmt(Math.max(0,list.length-S.orgShown))} متبقي)`,`Show more (${fmt(Math.max(0,list.length-S.orgShown))} left)`); }
  const extra=$('#orgExtra');
  if(extra){
    const kinds=all.length ? pendingKinds() : [];
    if(kinds.length) needsHTML(needs);
    extra.innerHTML = kinds.length
      ? `<section class="panel pend"><div class="panel-h"><h2>مصادر ناقصة</h2><span class="pill pending">بانتظار البيانات</span></div>${pendingLines(kinds)}</section>` : '';
  }
  localize();
}
function openOrganic(id){
  const p=organicPosts().find(x=>x.id===id); if(!p) return;
  const title=(p.caption||'').trim() || p.type || 'منشور';
  $('#dlgBody').innerHTML = `
    <div class="panel-h"><h2 id="dlgTitle">${esc(title.length>140?title.slice(0,140)+'…':title)}</h2><button type="button" class="btn" id="dlgClose">إغلاق</button></div>
    <div class="dlg-top">
      <div class="thumb">${mediaHTML({thumb:p.thumb, video:p.video, link:p.permalink, text:p.caption, caption:p.caption, name:title}, true)}</div>
      <div style="display:grid;gap:8px;min-width:0">
        <div class="row">${platCell(p.network)}${depCell(p.dept)}<span class="pill">${p.date?nice(p.date):'—'}</span>${p.type?`<span class="pill">${esc(p.type)}</span>`:''}</div>
        <div class="sub">${esc(p.page||'')}${(DEP[p.dept]&&!HIDDEN_DEPT.has(p.dept))?`<br>${tr('القسم')}: ${esc(depName(p.dept))} · ${p.dsrc==='ad'?tr('من نص المنشور'):p.dsrc==='campaign'?tr('من اسم الحملة'):tr('افتراضي')}`:''}</div>
        ${p.caption?`<pre>${esc(p.caption)}</pre>`:''}
        ${usableLink(p.permalink)?`<a href="${esc(p.permalink)}" target="_blank" rel="noopener">${/instagram\.com\/(p|reel|tv)\//.test(p.permalink)||/\/(posts|videos|reel)\//.test(p.permalink)||/tiktok\.com\/@[^/]+\/video\//.test(p.permalink)?'فتح المنشور':'فتح الحساب'}</a>`:''}
      </div>
    </div>
    <div class="kv">
      <div><div class="k">المشاهدات</div><div class="mini">${metricText(p.views,p.insights==='pending')}</div></div>
      <div><div class="k">الوصول</div><div class="mini">${metricText(p.reach,p.insights==='pending')}</div></div>
      <div><div class="k">نسبة التفاعل</div><div class="mini">${p.insights==='pending'&&p.er==null?metricText(null,true):pct(p.er)}</div></div>
      <div><div class="k">إعجاب</div><div class="mini">${fmt(p.likes)}</div></div>
      <div><div class="k">تعليقات</div><div class="mini">${fmt(p.comments)}</div></div>
      <div><div class="k">مشاركات</div><div class="mini">${metricText(p.shares,p.insights==='pending')}</div></div>
      <div><div class="k">حفظ</div><div class="mini">${metricText(p.saves,p.insights==='pending')}</div></div>
    </div>`;
  const dlg=$('#dlg'); dlg.showModal(); $('#dlgClose').onclick=()=>dlg.close();
  localize();
}
const tabsEl=$('#tabs'); if(tabsEl) tabsEl.addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b) return; const p=b.dataset.p;
  if(p.startsWith('dept:')){ S.page='dept'; S.dept=p.slice(5); S.camp=''; } else S.page=p;
  try{ const u=new URL(location.href); u.searchParams.set('p',S.page); history.replaceState(history.state,'',u.pathname+u.search); }catch(_){}
  save(); render(); window.scrollTo({top:0}); });
$('#depts').addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b) return; S.dept=b.dataset.v; S.camp=''; S.shown=24; S.orgShown=24; if(S.mode==='ads' && S.page==='dept' && !S.dept) S.page='depts'; render(); });
$('#ocards').addEventListener('click', onCardClick);
$('#ocards').addEventListener('keydown', onCardKey);
$('#oq').addEventListener('input',e=>{ S.orgQ=e.target.value.trim(); S.orgShown=24; renderPosts(); });
$('#osort').addEventListener('change',e=>{ S.orgSort=e.target.value; S.orgShown=24; save(); renderPosts(); });
$('#omore').addEventListener('click',()=>{ S.orgShown+=24; renderPosts(); });
window.__check = () => { const keep={...S}; S.plat='all'; S.stat='all'; S.camp=''; S.goal=''; S.fmt=''; S.dept='';
  const A=aggAllDepts('2026-09-14','2026-10-11'); const out={};
  for(const k of DORDER){ const o=derive(A.by[k]||{spend:0,leads:0,leadSpend:0}); out[k]={spend:+(o.spend||0).toFixed(2), leads:o.leads||0}; }
  Object.assign(S,keep); return out; };

