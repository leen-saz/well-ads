// ---- Wins for the selected period vs the period before it, inside the page filters
const FIRST = (()=>{ const ad={}, camp={}; for(const [k,date,sp] of D.rows){ if(!sp||!ADS[k]) continue; const b=String(k).split('|')[0], c=ADS[k].platform+'|'+ADS[k].campaign;
  if(!ad[b]||date<ad[b]) ad[b]=date; if(!camp[c]||date<camp[c]) camp[c]=date; } return {ad,camp}; })();
function renderWins(){
  const el=$('#wins'); if(!el || !cur) return;
  const from=S.from, to=S.to, pFrom=cur.pFrom, pTo=cur.pTo, A=cur.now, B=cur.compareOk?cur.prev:null;
  $('#winsH').textContent = cur.n===7 ? ui('نجاحات هالأسبوع',"This week's wins") : ui('نجاحات الفترة','Wins in this period');
  $('#winsSub').textContent = B ? `${nice(from)} – ${nice(to)} ${ui('مقارنة بـ','vs')} ${nice(pFrom)} – ${nice(pTo)}` : `${nice(from)} – ${nice(to)} · ${ui('ما فيه فترة سابقة كاملة للمقارنة','no full previous period to compare')}`;
  const a=derive(A.tot), b=B?derive(B.tot):null, out=[], ch=(x,y)=>y?100*(x-y)/Math.abs(y):null;
  const add=(ic,title,detail)=>out.push(`<div class="win-i"><span class="ic" aria-hidden="true">${ic}</span><div><b>${title}</b><span>${detail}</span></div></div>`);
  if(b){ const c=ch(a.leads,b.leads); if(c!=null&&c>=3) add('📈',ui(`الليدز زادت ${fmt(c,0)}%`,`Leads up ${fmt(c,0)}%`),ui(`${qty(a.leads)} ليد مقابل ${qty(b.leads)}`,`${qty(a.leads)} vs ${qty(b.leads)}`));
    const d=ch(a.cpl,b.cpl); if(d!=null&&d<=-3) add('💰',ui(`تكلفة الليد نزلت ${fmt(-d,0)}%`,`Cost per lead down ${fmt(-d,0)}%`),ui(`${sar(a.cpl)} ريال مقابل ${sar(b.cpl)}`,`${sar(a.cpl)} vs ${sar(b.cpl)} SAR`));
    const m=ch(a.conv,b.conv); if(m!=null&&m>=5&&a.conv>=10) add('💬',ui(`المحادثات زادت ${fmt(m,0)}%`,`Chats up ${fmt(m,0)}%`),ui(`${qty(a.conv)} محادثة مقابل ${qty(b.conv)}`,`${qty(a.conv)} vs ${qty(b.conv)}`)); }
  const cnt=(n,one,two,few)=>n===1?one:n===2?two:`${n} ${n<=10?few:one}`;
  const base=k=>String(k).split('|')[0], seen=new Set(), newWins=[];
  for(const k of Object.keys(A.byAd)){ const bk=base(k); if(seen.has(bk)) continue; seen.add(bk); if(WIN.has(k) && FIRST.ad[bk]>=addDays(from,-(WIN_DAYS-1))) newWins.push(ADS[k].name); }
  if(newWins.length) add('🏆',ui(cnt(newWins.length,'إعلان فايز جديد','إعلانين فايزين جداد','إعلانات فايزة جديدة'),`${newWins.length} new winning ads`),esc(newWins.slice(0,3).join(' · '))+(newWins.length>3?' …':''));
  const ideas={}; for(const [k,o] of Object.entries(A.byAd)){ const a1=ADS[k]; if(a1.goal!=='lead') continue; const id=ideaKey(a1), y=ideas[id]||(ideas[id]={name:a1.name,leadSpend:0,leadN:0}); y.leadSpend+=o.leadSpend; y.leadN+=o.leadN; }
  const best=Object.values(ideas).filter(y=>y.leadN>=10).sort((p,q)=>p.leadSpend/p.leadN-q.leadSpend/q.leadN)[0];
  if(best) add('🎬',ui('أرخص فكرة في الفترة','Cheapest idea in this period'),`${esc(best.name)} · ${qty(best.leadN)} ${ui('ليد بـ','leads at')} ${sar(best.leadSpend/best.leadN)} ${ui('ريال','SAR')}`);
  if(B && !S.dept){ const ad=aggAllDepts(from,to), bd=aggAllDepts(pFrom,pTo);
    const imp=DORDER.map(k=>{ const x=derive(ad.by[k]||{}), y=derive(bd.by[k]||{}); return {k,c:(x.leadN>=10&&y.cpl)?ch(x.cpl,y.cpl):null,x,y}; }).filter(r=>r.c!=null&&r.c<=-5).sort((p,q)=>p.c-q.c)[0];
    if(imp) add('🩺',ui(`${depName(imp.k)}: تكلفة الليد نزلت ${fmt(-imp.c,0)}%`,`${depName(imp.k)}: cost per lead down ${fmt(-imp.c,0)}%`),ui(`${sar(imp.x.cpl)} ريال مقابل ${sar(imp.y.cpl)}`,`${sar(imp.x.cpl)} vs ${sar(imp.y.cpl)} SAR`)); }
  if(B){ const pl=Object.keys(A.byPlat).map(p=>{ const x=derive(A.byPlat[p]), y=B.byPlat[p]?derive(B.byPlat[p]):null; return {p,c:(y&&x.leadN>=10&&y.cpl)?ch(x.cpl,y.cpl):null,x,y}; }).filter(r=>r.c!=null&&r.c<=-5).sort((p,q)=>p.c-q.c)[0];
    if(pl) add('📣',ui(`${platName(family(pl.p))}: تكلفة الليد نزلت ${fmt(-pl.c,0)}%`,`${platName(family(pl.p))}: cost per lead down ${fmt(-pl.c,0)}%`),ui(`${sar(pl.x.cpl)} ريال مقابل ${sar(pl.y.cpl)}`,`${sar(pl.x.cpl)} vs ${sar(pl.y.cpl)} SAR`)); }
  const days=Object.entries(A.byDay).map(([d,v])=>[d,Object.values(v).reduce((s,x)=>s+x.leads,0)]).sort((p,q)=>q[1]-p[1]);
  if(days.length){ const all=agg(MIN,addDays(from,-1));
    const rec=Math.max(0,...Object.entries(all.byDay).map(([,v])=>Object.values(v).reduce((s,x)=>s+x.leads,0)));
    if(days[0][1]>rec && rec>0) add('⭐',ui('أعلى يوم ليدز من بداية البيانات','Best lead day on record'),`${nice(days[0][0])} · ${qty(days[0][1])} ${ui('ليد','leads')}`); }
  const camps=new Set(), ads=new Set();
  for(const k of Object.keys(A.byAd)){ const a1=ADS[k]; if(FIRST.camp[a1.platform+'|'+a1.campaign]>=from) camps.add(a1.platform+'|'+a1.campaign); if(FIRST.ad[base(k)]>=from) ads.add(base(k)); }
  const en=(n,w)=>`${n} ${w}${n===1?'':'s'}`;
  const launched=[camps.size&&[cnt(camps.size,'حملة','حملتين','حملات'),en(camps.size,'campaign')],ads.size&&[cnt(ads.size,'إعلان جديد','إعلانين جداد','إعلانات جديدة'),en(ads.size,'new ad')]].filter(Boolean);
  if(launched.length) add('🚀',ui(`أطلقنا ${launched.map(x=>x[0]).join(' و')}`,`Launched ${launched.map(x=>x[1]).join(' and ')}`),ui('أول صرف لها كان في هالفترة','First spend was in this period'));
  el.innerHTML = out.length ? out.join('') : `<p class="hint">${ui('ما فيه تحسّن واضح في هالفترة مقارنة باللي قبلها.','No clear improvement vs the previous period.')}</p>`;
}
function renderReport(now,prev){
  document.querySelectorAll('section[data-mode]').forEach(s=>{
    const modes=(s.dataset.mode||'ads').split(/\s+/), pages=(s.dataset.page||'').split(/\s+/).filter(Boolean);
    s.hidden = !modes.includes(S.mode) || (pages.length && !pages.includes(S.page)) || (CREATIVE_ONLY && (s.id==='kpis' || !pages.includes('creative')));
  });
  renderTabs();
  const mr=$('#modeRow'); if(mr) mr.hidden = CREATIVE_ONLY;
  const root=$('#deptRoot');
  if(root && S.mode==='ads') root.hidden = !S.dept || S.page!=='dept' || CREATIVE_ONLY;
  $('#depts').innerHTML = [['','كل الأقسام'],...DORDER.map(k=>[k,depName(k)])].map(([k,l])=>`<button type="button" data-v="${k}" aria-pressed="${S.dept===k}">${k?`<span class="dot" style="background:var(${DEP[k].color})"></span> `:''}${l}</button>`).join('');
  const A=aggAllDepts(S.from,S.to), B=cur&&cur.prev?aggAllDepts(cur.pFrom,cur.pTo):null;
  renderDeptMini(A); renderDeptCards(A,B); renderDeptPlat(A); renderDeptPage(now,prev); renderRules();
  renderAccounts(); renderPosts();
}
function renderDeptMini(A){
  const el=$('#deptMini'); if(!el) return;
  const mx=Math.max(1,...DORDER.map(k=>A.by[k]?.spend||0)), ml=Math.max(1,...DORDER.map(k=>A.by[k]?.leads||0));
  el.innerHTML = DORDER.map(k=>{ const o=derive(A.by[k]||{spend:0,leads:0,leadSpend:0,conv:0,impr:0,clicks:0});
    return `<div class="dbar-row${S.dept&&S.dept!==k?' dim':''}" data-d="${k}">${depCell(k)}
      <div style="display:grid;gap:3px"><div class="dbar"><span style="width:${100*(o.spend||0)/mx}%;background:var(${DEP[k].color})"></span></div><div class="dbar" style="height:8px"><span style="width:${100*(o.leads||0)/ml}%;background:var(--ink)"></span></div></div>
      <span class="num">${sar2(o.spend)} ${money()} · ${qty(o.leads)} ${ui('ليد','leads')} · ${sar(o.cpl)}</span></div>`; }).join('');
  el.querySelectorAll('[data-d]').forEach(r=>r.onclick=()=>setDept(r.dataset.d));
}
function renderDeptCards(A,B){
  const el=$('#deptCards'); if(!el) return;
  if($('#dcSub')) $('#dcSub').textContent = `${nice(S.from)} – ${nice(S.to)}`;
  el.innerHTML = DORDER.map(k=>{ const z={spend:0,leads:0,leadSpend:0,leadN:0,conv:0,impr:0,clicks:0}; const o=derive(A.by[k]||z), p=cur&&cur.compareOk&&B?derive(B.by[k]||z):{};
    return `<button type="button" class="dcard${S.dept&&S.dept!==k?' dim':''}" data-d="${k}" aria-pressed="${S.dept===k}" style="--dc:var(${DEP[k].color})">
      <span class="nm">${depName(k)}</span>
      <div class="kv"><div><div class="k">الصرف</div><div class="mini">${sar2(o.spend)} ${money()}</div></div><div><div class="k">الليدز</div><div class="mini">${qty(o.leads)}</div></div>
      <div><div class="k">تكلفة الليد</div><div class="mini">${sar(o.cpl)}</div></div><div><div class="k">محادثات</div><div class="mini">${fmt(o.conv)}</div></div></div>
      ${delta(o.leads,p.leads,false)}
      ${delta(o.cpl,p.cpl,true)}
      <span class="hint">${ui('آخر صرف','Last spend')}: ${lastSpendDate(k,true)?nice(lastSpendDate(k,true)):'—'}</span></button>`; }).join('');
  el.querySelectorAll('button[data-d]').forEach(b=>b.onclick=()=>setDept(b.dataset.d));
}
function renderDeptPlat(A){
  const el=$('#tDeptPlat'); if(!el) return;
  const used=ORDER.filter(p=>DORDER.some(k=>A.byDP[k]?.[p]?.spend>0));
  let h=`<thead><tr><th>القسم</th>${used.map(p=>`<th class="n">${platName(p)} ${ui('صرف','Spend')}</th><th class="n">ليدز</th><th class="n">تكلفة الليد</th>`).join('')}<th class="n">المجموع</th><th class="n">ليدز</th><th class="n">تكلفة الليد</th></tr></thead><tbody>`;
  DORDER.forEach(k=>{ h+=`<tr class="click${S.dept===k?' lv1row':''}" data-d="${k}"><td>${depCell(k)}</td>`;
    used.forEach(p=>{ const o=derive(A.byDP[k]?.[p]||{spend:0,leads:0,leadSpend:0,leadN:0}); h+=`<td class="n">${o.spend?sar2(o.spend):'—'}</td><td class="n">${o.spend?qty(o.leads):'—'}</td><td class="n">${sar(o.cpl)}</td>`; });
    const t=derive(A.by[k]||{spend:0,leads:0,leadSpend:0,leadN:0}); h+=`<td class="n"><b>${sar2(t.spend)}</b></td><td class="n"><b>${qty(t.leads)}</b></td><td class="n"><b>${sar(t.cpl)}</b></td></tr>`; });
  el.innerHTML=h+'</tbody>';
  el.querySelectorAll('tr[data-d]').forEach(tr=>tr.onclick=()=>setDept(tr.dataset.d));
}
function renderDeptPage(now,prev){
  const root=$('#deptRoot'); if(!root) return;
  if(S.page!=='dept' || !S.dept || !DEP[S.dept]){ root.innerHTML=''; return; }
  const rows=Object.entries(now.byPlat).filter(([p])=>!HIDDEN_PLAT.has(p)).map(([p,o])=>({p,...derive(o)})).sort((a,b)=>b.spend-a.spend);
  const camps={};
  for(const [id,o] of Object.entries(now.byAd)){ const a=ADS[id]; const key=a.platform+'|'+a.campaign; const c=camps[key] ||= {p:a.platform,name:a.campaign,goal:a.goal,spend:0,leads:0,conv:0,leadSpend:0,leadN:0,impr:0,clicks:0}; c.spend+=o.spend;c.leads+=o.leads;c.conv+=o.conv;c.leadSpend+=o.leadSpend;c.leadN+=o.leadN||0;c.impr+=o.impr;c.clicks+=o.clicks; }
  const campRows=Object.values(camps).map(derive).sort((a,b)=>b.spend-a.spend);
  const ads=Object.entries(now.byAd).map(([id,o])=>({id,...derive(o),a:ADS[id]})).filter(x=>x.spend>0).sort((x,y)=>(y.leads+y.conv)-(x.leads+x.conv)||y.spend-x.spend).slice(0,12);
  const prevTot=cur&&cur.compareOk&&prev?derive(prev.tot):{};
  const tot=derive(now.tot);
  root.innerHTML = `<div class="panel-h"><h2>${depName(S.dept)}</h2><span class="sub">${ui('مقارنة بالفترة السابقة','Compared with the previous period')} · ${ui('الصرف','Spend')} ${sar2(tot.spend)} ${money()} · ${ui('الليدز','Leads')} ${qty(tot.leads)}</span></div>
    <div class="vgrid">
      <div class="bi-card"><h3>المنصات</h3>${rows.length?`<div class="tbl"><table><thead><tr><th>المنصة</th><th class="n">الصرف</th><th class="n">الليدز</th><th class="n">تكلفة الليد</th><th class="n">محادثات</th><th class="n">نسبة النقر</th></tr></thead><tbody>${rows.map(r=>`<tr class="click" data-p="${r.p}"><td>${platCell(r.p)}</td><td class="n">${sar2(r.spend)}</td><td class="n">${qty(r.leads)}</td><td class="n">${sar(r.cpl)}</td><td class="n">${family(r.p)==='meta'?fmt(r.conv):'—'}</td><td class="n">${pct(r.ctr)}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">'+ui('لا يوجد صرف لهذا القسم في الفترة. آخر صرف: ','No spend for this department in this range. Last spend: ')+(lastSpendDate(S.dept,false)?nice(lastSpendDate(S.dept,false)):'—')+'</div>'}</div>
      <div class="bi-card"><h3>مقارنة الفترة السابقة</h3><div class="kv"><div><div class="k">صرف سابق</div><div class="mini">${sar2(prevTot.spend)}</div></div><div><div class="k">ليدز سابقة</div><div class="mini">${qty(prevTot.leads)}</div></div><div><div class="k">تكلفة ليد سابقة</div><div class="mini">${sar(prevTot.cpl)}</div></div></div>${delta(tot.spend,prevTot.spend,true)}${delta(tot.leads,prevTot.leads,false)}${delta(tot.cpl,prevTot.cpl,true)}</div>
    </div>
    <h3>الاتجاه</h3>
    <div class="charts"><div><div class="sub">الصرف</div><div class="chart" id="dSpend"></div></div><div><div class="sub">الليدز</div><div class="chart" id="dLeads"></div></div><div><div class="sub">تكلفة الليد</div><div class="chart" id="dCpl"></div></div></div>
    <h3>الحملات</h3>
    <div class="tbl"><table id="dCamp"><thead><tr><th>المنصة</th><th>الحملة</th><th class="n">الصرف</th><th class="n">الليدز</th><th class="n">تكلفة الليد</th></tr></thead><tbody>${campRows.map(r=>`<tr class="click" data-c="${esc(r.p+'|'+r.name)}"><td>${platCell(r.p)}</td><td class="name">${esc(r.name)}</td><td class="n">${sar2(r.spend)}</td><td class="n">${r.goal==='lead'?qty(r.leadN):'—'}</td><td class="n">${r.goal==='lead'?sar(r.cpl):'—'}</td></tr>`).join('')||'<tr><td class="empty">لا توجد حملات.</td></tr>'}</tbody></table></div>
    <h3>أفضل الإعلانات</h3>
    <div class="tbl"><table><thead><tr><th>الإعلان</th><th>المنصة</th><th class="n">الصرف</th><th class="n">ليدز</th><th class="n">محادثات</th><th class="n">تكلفة الليد</th></tr></thead><tbody>${ads.map(x=>`<tr class="click" data-k="${x.id}"><td class="name">${esc(x.a.name)}</td><td>${platCell(x.a.platform)}</td><td class="n">${sar2(x.spend)}</td><td class="n">${qty(x.leads)}</td><td class="n">${fmt(x.conv)}</td><td class="n">${x.a.goal==='lead'?sar(x.cpl):'—'}</td></tr>`).join('')||'<tr><td class="empty">لا توجد إعلانات صرفت.</td></tr>'}</tbody></table></div>`;
  stacked($('#dSpend'), now, 'spend'); stacked($('#dLeads'), now, 'leads'); cplLine($('#dCpl'), now);
  root.querySelectorAll('tr[data-p]').forEach(tr=>tr.onclick=()=>{ S.plat=tr.dataset.p; save(); render(); });
  root.querySelectorAll('tr[data-c]').forEach(tr=>tr.onclick=()=>{ S.camp=tr.dataset.c; render(); });
  root.querySelectorAll('tr[data-k]').forEach(tr=>tr.onclick=()=>openAd(tr.dataset.k));
}
function renderRules(){
  const el=$('#rulesNote'); if(!el) return;
  const hints=LANG==='en'
    ? {iv:'IV, drips, and Hair-Vitality', midwife:'Midwife, maternity care', foot:'Foot alignment', renan:'Renan'}
    : {iv:'IV، محاليل، و Hair-Vitality', midwife:'قابلة، رعاية الحمل، midwife', foot:'Foot Alignment، تقويم القدم', renan:'رينان'};
  const cards=[
    ['براندينق','هذه حملات براندينق، وتبقى ضمن الحملات والمنصات بدون قسم.'],
    ...DORDER.map(k=>[depName(k), hints[k]||'']),
  ];
  el.innerHTML=`<h2>كيف تنقسم الأقسام</h2><div class="ins">${cards.map(([t,l])=>noteCard(t,l)).join('')}</div>`;
}
