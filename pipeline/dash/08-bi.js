// ---- BI: buckets, slicers, cross-filter chips, funnel, share, heatmap, month pivot, drill tree
function granOf(){ if(S.gran!=='auto') return S.gran; const n=diffDays(S.from,S.to)+1; return n>200?'month':n>62?'week':'day'; }
const weekStart = d => addDays(d,-toD(d).getUTCDay());
function buckets(now){
  const g=granOf(), key = d => g==='day'?d : g==='week'?weekStart(d) : d.slice(0,8)+'01';
  const keys=[], byKey={}; let last=null;
  for(let d=S.from; d<=S.to; d=addDays(d,1)){ const k=key(d); if(k!==last){ keys.push(k); last=k; } const src=now.byDay[d]; if(!src) continue;
    const t=byKey[k] ||= {}; for(const [p,v] of Object.entries(src)){ const o=t[p] ||= {spend:0,leads:0,ls:0,ln:0}; o.spend+=v.spend; o.leads+=v.leads; o.ls+=v.ls||0; o.ln+=v.ln||0; } }
  const end = k => g==='day'?k : g==='week'?addDays(k,6) : addDays(addDays(k.slice(0,8)+'28',4).slice(0,8)+'01',-1);
  return {keys, byKey, g,
    span: k => [k<S.from?S.from:k, end(k)>S.to?S.to:end(k)],
    label: k => g==='day'?nice(k) : g==='week'?ui(`أسبوع ${nice(k<S.from?S.from:k)}`,`Week of ${nice(k<S.from?S.from:k)}`) : `${monthName(toD(k).getUTCMonth())} ${toD(k).getUTCFullYear()}`,
    tick: k => g==='month'?`${toD(k).getUTCMonth()+1}/${String(toD(k).getUTCFullYear()).slice(2)}` : `${toD(k).getUTCDate()}/${toD(k).getUTCMonth()+1}`};
}
function cplLine(el,now){
  const B=buckets(now), ks=B.keys, plats=orderNow();
  const W=640,H=200,L=8,R=46,T=10,Bm=26, iw=W-L-R, ih=H-T-Bm, bw=iw/Math.max(1,ks.length);
  const val=(k,p)=>{ const o=(B.byKey[k]||{})[p]; const n=o?(o.ln==null?o.leads:o.ln):0; return o&&n>0&&o.ls>0 ? o.ls/n : null; };
  const all=[]; ks.forEach(k=>plats.forEach(p=>{const v=val(k,p); if(v!=null) all.push(v);}));
  if(!all.length){ el.innerHTML='<div class="empty">ما فيه ليدز في هذي الفترة.</div>'; return; }
  all.sort((a,b)=>a-b); const max=niceMax(all[Math.floor(all.length*0.95)]||all[all.length-1]);
  const y=v=>T+ih-(Math.min(v,max)/max)*ih, x=i=>midX(L,iw,bw,i);
  let s=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="تكلفة الليد حسب المنصة">`;
  for(let i=0;i<=4;i++){const v=max*i/4,yy=y(v); s+=`<line class="grid" x1="${L}" x2="${L+iw}" y1="${yy}" y2="${yy}"/><text x="${W-R+6}" y="${yy+4}">${fmt(v)}</text>`;}
  plats.forEach(p=>{ let d='', pts=''; ks.forEach((k,i)=>{ const v=val(k,p); if(v==null){ d+=' '; return; } const span=B.span(k); const open=dayOpen(family(p), span[0])||dayOpen(family(p), span[1]); d+=(d.trim()&&!d.endsWith(' ')?'L':'M')+x(i).toFixed(1)+' '+y(v).toFixed(1);
      pts+=`<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.5" fill="var(${PL[p].c})"><title>${platName(p)} · ${B.label(k)}: ${sar(v)} ${money()}${open?' · '+ui('ناقص','incomplete'):''}</title></circle>`; });
    s+=`<path d="${d.replace(/ +/g,' ').trim()}" fill="none" stroke="var(${PL[p].c})" stroke-width="2" stroke-linejoin="round"/>`+pts; });
  const step=Math.ceil(ks.length/7); ks.forEach((k,i)=>{ if(i%step===0||i===ks.length-1) s+=`<text x="${x(i)}" y="${H-8}" text-anchor="middle">${B.tick(k)}</text>`; });
  el.innerHTML=s+'</svg>';
}
function buildSelects(){
  const camps=new Map(), goals=new Set(), fmts=new Set();
  for(const a of Object.values(ADS)){ if(!samePlat(a.platform)) continue; if(S.dept&&a.dept!==S.dept) continue; camps.set(a.platform+'|'+a.campaign,a); goals.add(a.goal); if(a.format) fmts.add(a.format); }
  if(S.camp && !camps.has(S.camp)) S.camp='';
  const opt=(v,l,cur)=>`<option value="${esc(v)}"${v===cur?' selected':''}>${esc(l)}</option>`;
  const cs=[...camps.entries()].sort((a,b)=>a[0].localeCompare(b[0],'ar'));
  $('#fCamp').innerHTML=opt('','كل الحملات',S.camp)+cs.map(([k,a])=>{ const pn=HIDDEN_PLAT.has(a.platform)?'':platName(a.platform); return opt(k,`${pn?pn+' · ':''}${a.campaign}`,S.camp); }).join('');
  $('#fGoal').innerHTML=opt('','كل الأهداف',S.goal)+[...goals].map(g=>opt(g,goalName(g),S.goal)).join('');
  $('#fFmt').innerHTML=opt('','كل الصيغ',S.fmt)+[...fmts].map(f=>opt(f,tr(f),S.fmt)).join('');
}
function renderChips(){
  const c=[];
  if(S.dept) c.push(['dept',`${ui('القسم','Department')}: ${depName(S.dept)}`]);
  if(S.plat!=='all') c.push(['plat',`${ui('المنصة','Platform')}: ${platName(S.plat)}`]);
  if(S.camp) c.push(['camp',`${ui('الحملة','Campaign')}: ${S.camp.split('|').slice(1).join('|')}`]);
  if(S.goal) c.push(['goal',`${ui('الهدف','Objective')}: ${goalName(S.goal)}`]);
  if(S.fmt) c.push(['fmt',`${ui('الصيغة','Format')}: ${tr(S.fmt)}`]);
  if(S.stat==='live') c.push(['stat',ui('النشطة الآن','Active now')]);
  if(S.stat==='off') c.push(['stat',ui('متوقف','Paused')]);
  if(!S.preset) c.push(['date',`${nice(S.from)} – ${nice(S.to)}`]);
  $('#chips').innerHTML = c.map(([k,l])=>`<span class="chip">${esc(l)}<button type="button" data-k="${k}" aria-label="${esc(ui('إزالة','Remove')+' '+l)}">×</button></span>`).join('')
    + (c.length>1?`<button type="button" class="chip clear" data-k="all">مسح الكل</button>`:'');
}
$('#chips').addEventListener('click',e=>{ const b=e.target.closest('[data-k]'); if(!b) return; const k=b.dataset.k;
  if(k==='plat'||k==='all'){ S.plat='all'; } if(k==='dept'||k==='all'){ S.dept=''; if(S.page==='dept') S.page='depts'; }
  if(k==='camp'||k==='all') S.camp=''; if(k==='goal'||k==='all') S.goal=''; if(k==='fmt'||k==='all') S.fmt='';
  if(k==='stat'||k==='all'){ S.stat='all'; S.wall='all'; } if(k==='date'||k==='all'){ [S.from,S.to]=PRESETS.find(x=>x[0]==='7')[2](); S.from=clamp(S.from); S.to=clamp(S.to); S.preset='7'; }
  S.shown=24; save(); render(); });
$('#fCamp').addEventListener('change',e=>{ S.camp=e.target.value; if(S.camp){ const p=S.camp.split('|')[0]; if(HIDDEN_PLAT.has(p)) S.plat='all'; else if(S.plat!=='all'&&S.plat!==p) S.plat=p; } S.shown=24; render(); });
$('#fGoal').addEventListener('change',e=>{ S.goal=e.target.value; S.shown=24; render(); });
$('#fFmt').addEventListener('change',e=>{ S.fmt=e.target.value; S.shown=24; render(); });
$('#gran').addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b) return; S.gran=b.dataset.v; renderCharts(cur.now); });

function renderBI(now){
  const t=derive(now.tot), steps=[['الظهور',t.impr],['النقرات',t.clicks],['الليدز والمحادثات',t.leads+t.conv]];
  const mx=Math.max(1,t.impr), w=v=>Math.max(4, Math.round(100*Math.sqrt(v/mx)));
  if($('#funnel')) $('#funnel').innerHTML = steps.map(([l,v],i)=>`<div class="fstep"><span class="lbl">${l}</span><div class="fbar" style="width:${w(v)}%">${i===2?qty(v):fmt(v)}</div>`
    + (i? `<span class="frate">${i===1?`${tr('نسبة النقر')} ${pct(t.ctr)}`:`${ui('من النقرة لليد','Click to result')} ${pct(t.clicks?100*(t.leads+t.conv)/t.clicks:null)} · ${ui('تكلفة النتيجة','Cost per result')} ${sar((t.leads+t.conv)?t.spend/(t.leads+t.conv):null)} ${money()}`}</span>`:'')+`</div>`).join('');
  // Results = leads + conversations: Meta's goal is conversations, so leads alone made it look like 0%
  const res=p=>(now.byPlat[p].leads||0)+(now.byPlat[p].conv||0);
  const plats=ORDER.filter(p=>now.byPlat[p] && (now.byPlat[p].spend>0 || res(p)>0)), ts=plats.reduce((a,p)=>a+now.byPlat[p].spend,0)||1, tl=plats.reduce((a,p)=>a+res(p),0)||1;
  // One row per platform: its share of spend (gray) against its share of results (its colour), on one scale,
  // plus a plain verdict so the reader does not have to compare the two bars by eye
  const rows=plats.map(p=>({p, s:100*now.byPlat[p].spend/ts, r:100*res(p)/tl})).sort((a,b)=>b.s-a.s);
  const top=Math.max(1,...rows.map(x=>Math.max(x.s,x.r)));
  const anyRes=plats.some(p=>res(p)>0);
  const verdict=x=> !anyRes ? ['eq',ui('ما فيه نتائج بالفترة','No results in this period')] : x.r-x.s>=3 ? ['up',ui('تجيب أكثر من نصيبها','More than its share')] : x.s-x.r>=3 ? ['down',ui('تجيب أقل من نصيبها','Less than its share')] : ['eq',ui('على قد نصيبها','About its share')];
  $('#share').innerHTML = plats.length ? `<div class="legend sh-key"><span><i class="sh-k"></i>${ui('حصتها من الصرف','Share of spend')}</span><span><i class="sh-k res"></i>${ui('حصتها من النتائج','Share of results')}</span></div>`
    + rows.map(x=>{ const [k,l]=verdict(x); return `<div class="sh-row"><span class="sh-p"><span class="dot" style="background:var(${PL[x.p].c})"></span>${platName(x.p)}</span>`
      + `<div class="sh-bars"><div class="sh-b"><i style="width:${100*x.s/top}%"></i><b>${fmt(x.s,0)}%</b></div><div class="sh-b res"><i style="width:${100*x.r/top}%;background:var(${PL[x.p].c})"></i><b>${fmt(x.r,0)}%</b></div></div>`
      + `<span class="sh-v ${k}">${l}</span></div>`; }).join('') : '<div class="empty">لا توجد بيانات.</div>';
  // day-of-week heatmap of CPL (lead campaigns)
  const hm={}; for(const [k,date,sp,im,cl,ld] of D.rows){ if(date<S.from||date>S.to) continue; const a=ADS[k]; if(!a||!now.byAd[k]||a.goal!=='lead') continue;
    const w=toD(date).getUTCDay(), o=(hm[a.platform] ||= {})[w] ||= {s:0,l:0}; o.s+=sp; o.l+=ld; }
  const hp=ORDER.filter(p=>hm[p]); let vals=[]; hp.forEach(p=>Object.values(hm[p]).forEach(o=>{ if(o.l) vals.push(o.s/o.l); }));
  const lo=Math.min(...vals), hi=Math.max(...vals);
  $('#heat').innerHTML = hp.length ? `<thead><tr><th></th>${[0,1,2,3,4,5,6].map(d=>`<th>${dayName(d)}</th>`).join('')}</tr></thead><tbody>`+hp.map(p=>`<tr><th>${platName(p)}</th>${[0,1,2,3,4,5,6].map(w=>{ const o=hm[p][w]; const v=o&&o.l?o.s/o.l:null;
      const a = v==null?0:(hi>lo?(v-lo)/(hi-lo):.5); return `<td style="background:color-mix(in srgb, var(--accent) ${Math.round(10+a*70)}%, var(--surface));color:${a>.55?'#fff':'var(--ink)'}" title="${platName(p)} · ${dayName(w)}: ${v==null?'—':sar(v)+' '+money()}">${v==null?'—':sar(v)}</td>`; }).join('')}</tr>`).join('')+'</tbody>'
    : '<tbody><tr><td class="empty">ما فيه ليدز في هذي الفترة.</td></tr></tbody>';
}
function monthEnd(ym){ return addDays(addDays(ym+'-28',4).slice(0,8)+'01',-1); }
function renderPace(){
  const monthYm = S.to.slice(0,7), first = monthYm+'-01', last = monthEnd(monthYm);
  const dim = toD(last).getUTCDate();
  const paceFrom = S.from>first ? S.from : first;
  let paceTo = S.to<last ? S.to : last;
  const dropToday = paceTo===TODAY && TODAY!==MAX;
  const completeTo = dropToday ? addDays(TODAY,-1) : paceTo;
  const hasComplete = completeTo>=paceFrom;
  const prevMonthEnd = addDays(first,-1), prevYm = prevMonthEnd.slice(0,7);
  const prevLastDom = toD(prevMonthEnd).getUTCDate();
  const prevDay = day => { const dom=toD(day).getUTCDate(); if(dom>prevLastDom) return null; return prevYm+'-'+String(dom).padStart(2,'0'); };
  const curM={s:0,l:0}, prevSame={s:0,l:0}, todayBit={s:0,l:0};
  const prevDays=new Set();
  if(hasComplete){ for(let d=paceFrom; d<=completeTo; d=addDays(d,1)){ const p=prevDay(d); if(p) prevDays.add(p); } }
  const prevList=[...prevDays].sort();
  const prevKnown=prevList.length>0 && prevList.every(d=>d>=MIN) && !holesBetween(prevList[0], prevList[prevList.length-1]).length;
  for(const [k,date,sp,im,cl,ld,cv=0] of D.rows){ const a=ADS[k]; if(!matchesSlice(a)) continue;
    const add=o=>{ o.s+=sp; o.l+=ld+cv; };
    if(hasComplete && date>=paceFrom && date<=completeTo) add(curM);
    if(dropToday && date===TODAY) add(todayBit);
    if(prevDays.has(date)) add(prevSame);
  }
  const done = hasComplete ? diffDays(paceFrom, completeTo)+1 : 0;
  const open = hasComplete && holesBetween(paceFrom, completeTo).length;
  // Fewer than 3 complete days is too little to project a whole month
  const proj = done<3 || open ? null : {s:curM.s*dim/done, l:curM.l*dim/done};
  const ch=(a,b)=>!b?'—':a>=b&&a/b>=4?`▲ ×${fmt(a/b,1)}`:`${a>=b?'▲':'▼'} ${fmt(Math.abs(100*(a-b)/b),0)}%`;
  const mname=x=>monthName(+x.slice(5)-1);
  const spendShown = hasComplete ? curM.s : (dropToday ? todayBit.s : null);
  const resultShown = hasComplete ? curM.l : (dropToday ? todayBit.l : null);
  const spendLabel = hasComplete
    ? ui(`صرف ${mname(monthYm)} حتى الآن (${done} من ${dim} يوم)`,`${mname(monthYm)} spend so far (${done} of ${dim} days)`)
    : ui('صرف اليوم الجزئي','Partial spend today');
  const sameLabel = ui(`مقارنة بنفس الأيام من ${mname(prevYm)}`,`Same days versus ${mname(prevYm)}`);
  const prevCount = prevDays.size;
  const prevLabel = prevCount && prevCount===toD(prevMonthEnd).getUTCDate() && done===dim
    ? ui(`${mname(prevYm)} كامل: ليدز ومحادثات`,`${mname(prevYm)} full: leads and chats`)
    : ui(`نفس الأيام من ${mname(prevYm)}: ليدز ومحادثات`,`Same days in ${mname(prevYm)}: leads and chats`);
  $('#pace').innerHTML = `<div class="kv">
    <div><div class="k">${spendLabel}</div><div class="mini">${spendShown==null?'—':sar(spendShown)+' '+money()}</div></div>
    <div><div class="k">${ui('نتائج حتى الآن','Results so far')}</div><div class="mini">${resultShown==null?'—':qty(resultShown)}</div></div>
    <div><div class="k">${ui('توقع الصرف لنهاية الشهر','Spend forecast to month end')}</div><div class="mini">${proj?sar(proj.s)+' '+money():(done<3&&!open?ui('يطلع بعد 3 أيام','after 3 days'):'—')}</div></div>
    <div><div class="k">${ui('توقع النتائج لنهاية الشهر','Results forecast to month end')}</div><div class="mini">${proj?qty(proj.l):(done<3&&!open?ui('يطلع بعد 3 أيام','after 3 days'):'—')}</div></div>
    <div><div class="k">${sameLabel}</div><div class="mini">${open||!prevKnown?'—':ui('صرف','Spend')+' '+ch(curM.s,prevSame.s)+' · '+ui('نتائج','results')+' '+ch(curM.l,prevSame.l)}</div></div>
    <div><div class="k">${prevLabel}</div><div class="mini">${prevKnown?qty(prevSame.l):'—'} ${ui('ليد أو محادثة','leads or chats')}</div><div class="k">${prevKnown?`${sar(prevSame.s)} ${money()} · ${ui('تكلفة النتيجة','cost per result')} ${prevSame.l?sar(prevSame.s/prevSame.l)+' '+money():'—'}`:'—'}</div></div></div>`;
}
function renderMonths(){
  const m={}, plats=orderNow();
  for(const [k,date,sp,im,cl,ld,cv=0] of D.rows){ const a=ADS[k]; if(date<S.from||date>S.to || !matchesSlice(a)) continue;
    const ym=date.slice(0,7), o=(m[ym] ||= {})[a.platform] ||= {s:0,l:0,ls:0,ln:0,c:0}; o.s+=sp; o.l+=ld; o.c+=cv; if(a.goal==='lead'&&a.dest!=='whatsapp'){ o.ls+=sp; o.ln+=ld; } }
  const months=Object.keys(m).sort().reverse(), used=plats.filter(p=>months.some(ym=>m[ym][p]));
  if(!months.length){ $('#tMonth').innerHTML='<tbody><tr><td class="empty">لا توجد بيانات.</td></tr></tbody>'; return; }
  const cpls=[]; months.forEach(ym=>used.forEach(p=>{const o=m[ym][p]; if(o&&o.ln) cpls.push(o.ls/o.ln);})); const lo=Math.min(...cpls), hi=Math.max(...cpls);
  const shade=v=>{ if(v==null||!isFinite(v)) return ''; const a=hi>lo?(v-lo)/(hi-lo):.5; return ` style="background:color-mix(in srgb, var(--pulse) ${Math.round(a*45)}%, transparent)"`; };
  const name=ym=>`${monthName(+ym.slice(5)-1)} ${ym.slice(0,4)}`;
  let h=`<thead><tr><th>الشهر</th>${used.map(p=>`<th class="n">${platName(p)} ${ui('صرف','Spend')}</th><th class="n">ليدز</th><th class="n">تكلفة الليد</th>`).join('')}<th class="n">${ui('المجموع صرف','Total spend')}</th><th class="n">ليدز</th><th class="n">تكلفة الليد</th></tr></thead><tbody>`;
  months.forEach(ym=>{ let ts=0,tl=0,tls=0,leadN=0; h+=`<tr class="click" data-ym="${ym}" title="${ui('ركّز اللوحة على','Focus the report on')} ${name(ym)}"><td>${name(ym)}</td>`;
    used.forEach(p=>{ const o=m[ym][p]||{s:0,l:0,ls:0,ln:0}; const c=o.ln?o.ls/o.ln:null; h+=`<td class="n">${sar(o.s)}</td><td class="n">${qty(o.l)}</td><td class="n hot"${shade(c)}>${sar(c)}</td>`; });
    for(const o of Object.values(m[ym])){ ts+=o.s; tl+=o.l; tls+=o.ls; leadN+=o.ln||0; }
    h+=`<td class="n"><b>${sar(ts)}</b></td><td class="n"><b>${qty(tl)}</b></td><td class="n hot"${shade(leadN?tls/leadN:null)}><b>${sar(leadN?tls/leadN:null)}</b></td></tr>`; });
  $('#tMonth').innerHTML=h+'</tbody>';
  $('#tMonth').querySelectorAll('tr[data-ym]').forEach(tr=>tr.onclick=()=>{ const ym=tr.dataset.ym, f=ym+'-01', t=addDays(addDays(ym+'-28',4).slice(0,8)+'01',-1);
    S.from=clamp(f); S.to=t>TODAY?TODAY:t; S.preset=null; S.shown=24; render(); window.scrollTo({top:0,behavior:'smooth'}); });
}
function renderTree(now){
  const T={}; for(const [k,o] of Object.entries(now.byAd)){ const a=ADS[k]; const l1=a.platform, l2=l1+'|'+a.campaign, l3=l2+'|'+a.group;
    for(const [key,lab,lv,par] of [[l1,platName(l1)||l1,1,null],[l2,a.campaign,2,l1],[l3,a.group,3,l2],[k,a.name,4,l3]]){
      const n=T[key] ||= {key,lab,lv,par,kids:new Set(),spend:0,impr:0,clicks:0,leads:0,conv:0,leadSpend:0,leadN:0,live:0,ads:0};
      n.spend+=o.spend;n.impr+=o.impr;n.clicks+=o.clicks;n.leads+=o.leads;n.conv+=o.conv;n.leadSpend+=o.leadSpend;n.leadN+=o.leadN||0; if(lv===4){n.live=a.live;} if(par) T[par]?.kids.add(key); } }
  // second pass for kids (parents created before children)
  for(const n of Object.values(T)) if(n.par&&T[n.par]) T[n.par].kids.add(n.key);
  const rows=[]; const walk=(keys)=>{ [...keys].map(k=>T[k]).sort((a,b)=>b.spend-a.spend).forEach(n=>{ rows.push(n); if(n.kids.size&&S.open.has(n.key)) walk(n.kids); }); };
  walk(Object.values(T).filter(n=>n.lv===1 && !HIDDEN_PLAT.has(n.key)).map(n=>n.key));
  const tot=derive(now.tot);
  $('#tTree').innerHTML = `<thead><tr><th>الاسم</th><th class="n">الصرف</th><th class="n">الحصة</th><th class="n">الليدز</th><th class="n">تكلفة الليد</th><th class="n">محادثات</th><th class="n">الظهور</th><th class="n">نسبة النقر</th></tr></thead><tbody>`
    + rows.map(n=>{ const d=derive(n); return `<tr class="lv${n.lv}row"><td class="name lv${n.lv}">${n.kids.size?`<button type="button" class="tg" data-k="${esc(n.key)}" aria-expanded="${S.open.has(n.key)}">${S.open.has(n.key)?'▾':'▸'}</button>`:'<span class="tg"></span>'}${n.lv===1?platCell(n.key):esc(n.lab)}${n.lv===4&&n.live?' <span class="pill st-live"><span class="dot"></span>نشط</span>':''}</td>`
      + `<td class="n">${sar(d.spend)}</td><td class="n">${fmt(tot.spend?100*d.spend/tot.spend:0,0)}%</td><td class="n">${qty(d.leads)}</td><td class="n">${sar(d.cpl)}</td><td class="n">${fmt(d.conv)}</td><td class="n">${fmt(d.impr)}</td><td class="n">${pct(d.ctr)}</td></tr>`; }).join('')
    + `<tr class="lv1row"><td><b>المجموع</b></td><td class="n"><b>${sar(tot.spend)}</b></td><td class="n">100%</td><td class="n"><b>${qty(tot.leads)}</b></td><td class="n"><b>${sar(tot.cpl)}</b></td><td class="n">${fmt(tot.conv)}</td><td class="n">${fmt(tot.impr)}</td><td class="n">${pct(tot.ctr)}</td></tr></tbody>`;
  $('#tTree').querySelectorAll('.tg[data-k]').forEach(b=>b.onclick=()=>{ const k=b.dataset.k; S.open.has(k)?S.open.delete(k):S.open.add(k); renderTree(cur.now); });
  $('#treeOpen').onclick=()=>{ Object.values(T).forEach(n=>{ if(n.lv<3) S.open.add(n.key); }); renderTree(cur.now); };
  $('#treeClose').onclick=()=>{ S.open.clear(); renderTree(cur.now); };
  localize();
}

