// ---- tables
function sortable(tbl,cols,rows,state,draw){
  tbl.onclick = e => { const th=e.target.closest('th'); if(!th) return; const k=th.dataset.k; state.dir = state.k===k ? -state.dir : (cols.find(c=>c.k===k).asc?1:-1); state.k=k; draw(); };
  rows.sort((a,b)=>{ const x=a[state.k], y=b[state.k]; if(x==null&&y==null) return 0; if(x==null) return 1; if(y==null) return -1; return (typeof x==='string'? x.localeCompare(y,LANG==='en'?'en':'ar') : x-y)*state.dir; });
  tbl.innerHTML = `<thead><tr>${cols.map(c=>`<th data-k="${c.k}" class="${c.n?'n':''}" ${state.k===c.k?`aria-sort="${state.dir>0?'ascending':'descending'}"`:''}>${c.l}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${cols.map(c=>`<td class="${c.n?'n':''}${c.cls?' '+c.cls:''}">${c.f?c.f(r):esc(r[c.k])}</td>`).join('')}</tr>`).join('')}</tbody>`;
}
const goalPill = g => `<span class="pill">${esc(goalName(g))}</span>`;
const platCell = p => { if(HIDDEN_PLAT.has(p)) return ''; const i=PL[p]||{c:'--s-meta'}; const name=platName(p); if(!name) return ''; return `<span class="pill"><span class="dot" style="background:var(${i.c})"></span>${name}</span>`; };
const TP = {k:'spend',dir:-1};
function renderPlat(now,prev){
  const tot = now.tot.spend||1;
  const rows = Object.entries(now.byPlat).filter(([p])=>!HIDDEN_PLAT.has(p)).map(([p,o])=>{
    const d=derive(o), fam=family(p);
    const open = dayOpen(fam, S.to) || (cur&&cur.prev && dayOpen(fam, cur.pTo));
    const b = !open && prev?.byPlat[p] ? derive(prev.byPlat[p]) : {};
    return {p,...d,share:100*o.spend/tot,ads:o.ads.size,pcpl:b.cpl??null};
  });
  const cols=[
    {k:'p',l:'المنصة',f:r=>platCell(r.p)},
    {k:'spend',l:'الصرف',n:1,f:r=>sar(r.spend)},
    {k:'share',l:'الحصة',n:1,f:r=>`${fmt(r.share,0)}%<span class="bar-cell" style="width:${Math.round(r.share*.6)}px"></span>`},
    {k:'leads',l:'الليدز',n:1,f:r=>qty(r.leads)},
    {k:'cpl',l:'تكلفة الليد',n:1,asc:1,f:r=>sar(r.cpl)},
    {k:'conv',l:'محادثات',n:1,f:r=>family(r.p)==='meta'?fmt(r.conv):'—'},
    {k:'pcpl',l:'تكلفة الليد قبل',n:1,asc:1,f:r=>sar(r.pcpl)},
    {k:'impr',l:'الظهور',n:1,f:r=>fmt(r.impr)},
    {k:'clicks',l:'النقرات',n:1,f:r=>fmt(r.clicks)},
    {k:'ctr',l:'نسبة النقر',n:1,f:r=>pct(r.ctr)},
    {k:'cpc',l:'تكلفة النقرة',n:1,asc:1,f:r=>sar(r.cpc)},
    {k:'ads',l:'إعلانات صرفت',n:1,f:r=>fmt(r.ads)},
  ];
  const draw=()=>{ sortable($('#tPlat'),cols,rows,TP,draw); $('#tPlat').querySelectorAll('tbody tr').forEach((tr,i)=>{ tr.classList.add('click'); tr.title='فلترة على هذي المنصة'; tr.onclick=()=>{ S.plat=rows[i].p; S.camp=''; S.shown=24; save(); render(); }; }); }; draw();
}
const TC = {k:'spend',dir:-1};
function renderCamp(now){
  const m={};
  for(const [k,o] of Object.entries(now.byAd)){ const a=ADS[k]; const key=a.platform+'|'+a.campaign; const c=m[key] ||= {p:a.platform,name:a.campaign,goal:a.goal,spend:0,impr:0,clicks:0,leads:0,conv:0,leadSpend:0,leadN:0,ads:0,live:0}; c.spend+=o.spend;c.impr+=o.impr;c.clicks+=o.clicks;c.leads+=o.leads;c.conv+=o.conv;c.leadSpend+=o.leadSpend;c.leadN+=o.leadN||0;c.ads++; if(a.live)c.live++;
    c.crmLeads=(c.crmLeads||0)+(o.crmLeads||0); c.booked=(c.booked||0)+(o.booked||0); c.paid=(c.paid||0)+(o.paid||0); c.value=(c.value||0)+(o.value||0); }
  const rows = Object.values(m).map(derive);
  $('#campCount').textContent = ui(`${fmt(rows.length)} حملة صرفت في الفترة`, `${fmt(rows.length)} campaigns with spend in this range`);
  const cols=[
    {k:'p',l:'المنصة',f:r=>platCell(r.p)},
    {k:'name',l:'الحملة',cls:'name'},
    {k:'goal',l:'الهدف',f:r=>goalPill(r.goal)},
    {k:'spend',l:'الصرف',n:1,f:r=>sar(r.spend)},
    {k:'leads',l:'الليدز',n:1,f:r=>r.goal==='lead'?qty(r.leadN):'—'},
    {k:'cpl',l:'تكلفة الليد',n:1,asc:1,f:r=>r.goal==='lead'?tgtCell(r.cpl):'—'},
    ...(D.crm ? [
      {k:'booked',l:'الاقفالات',n:1,f:r=>fmt(r.booked||0)},
      {k:'cpb',l:'تكلفة الاقفالة',n:1,asc:1,f:r=>sar(r.cpb)},
      {k:'roas',l:'ROAS',n:1,f:r=>r.roas==null?'—':fmt(r.roas,2)+'×'},
    ] : []),
    {k:'conv',l:'محادثات',n:1,f:r=>family(r.p)==='meta'?fmt(r.conv):'—'},
    {k:'impr',l:'الظهور',n:1,f:r=>fmt(r.impr)},
    {k:'ctr',l:'نسبة النقر',n:1,f:r=>pct(r.ctr)},
    {k:'cpc',l:'تكلفة النقرة',n:1,asc:1,f:r=>sar(r.cpc)},
    {k:'live',l:'نشط / صرف',n:1,f:r=>`${fmt(r.live)} / ${fmt(r.ads)}`},
  ];
  const draw=()=>{ sortable($('#tCamp'),cols,rows,TC,draw); $('#tCamp').querySelectorAll('tbody tr').forEach((tr,i)=>{ tr.classList.add('click'); tr.title='فلترة على هذي الحملة'; tr.onclick=()=>{ S.camp=rows[i].p+'|'+rows[i].name; S.shown=24; render(); }; }); }; draw();
}


