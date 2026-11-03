// ---- render
let cur=null;
function applyMode(mode, push){
  if(mode!=='ads' && mode!=='organic') mode='ads';
  const prev=S.mode;
  if(mode==='organic' && prev!=='organic'){ S._adsPage=S.page; S._adsPlat=S.plat; if(S._orgPage) S.page=S._orgPage; if(S._orgPlat) S.plat=S._orgPlat; }
  if(mode==='ads' && prev==='organic'){ S._orgPage=S.page; S._orgPlat=S.plat; if(S._adsPage) S.page=S._adsPage; if(S._adsPlat) S.plat=S._adsPlat; }
  S.mode=mode;
  syncModeShape();
  if(push){
    const url=new URL(location.href);
    if(mode==='organic') url.searchParams.set('mode','organic'); else url.searchParams.delete('mode');
    url.hash='';
    history.pushState({mode},'',url.pathname+url.search);
  }
  save(); render(); window.scrollTo({top:0});
}
window.addEventListener('popstate',()=>{
  const q=new URLSearchParams(location.search).get('lang');
  LANG = q==='en' ? 'en' : 'ar';
  try{ localStorage.setItem('well-ads-lang', LANG); }catch(e){}
  const next=modeFromUrl(), prev=S.mode;
  if(next==='organic' && prev!=='organic'){ S._adsPage=S.page; S._adsPlat=S.plat; if(S._orgPage) S.page=S._orgPage; if(S._orgPlat) S.plat=S._orgPlat; }
  if(next==='ads' && prev==='organic'){ S._orgPage=S.page; S._orgPlat=S.plat; if(S._adsPage) S.page=S._adsPage; if(S._adsPlat) S.plat=S._adsPlat; }
  S.mode=next; syncModeShape(); render();
});
function render(){
  if(CREATIVE_ONLY) S.page='creative';
  refreshOrder();
  buildFilters();
  document.querySelectorAll('#presets button').forEach(b=>b.setAttribute('aria-pressed',S.preset===b.dataset.k));
  document.querySelectorAll('#plats button[data-v]').forEach(b=>b.setAttribute('aria-pressed',S.plat===b.dataset.v));
  document.querySelectorAll('#stat button').forEach(b=>b.setAttribute('aria-pressed',S.stat===b.dataset.v));
  if(document.activeElement!==$('#from')) $('#from').value=S.from;
  if($('#sort')) $('#sort').value=S.sort;
  if(document.activeElement!==$('#to')) $('#to').value=S.to;
  const n = diffDays(S.from,S.to)+1;
  const pTo = addDays(S.from,-1), pFrom = addDays(pTo,-(n-1));
  const now = agg(S.from,S.to), prev = pFrom>=MIN ? agg(pFrom,pTo) : null;
  const holes = S.mode==='ads' ? holesBetween(S.from,S.to) : [];
  const prevHoles = prev && S.mode==='ads' ? holesBetween(pFrom,pTo) : [];
  const compareOk = !!(prev && !holes.length && !prevHoles.length);
  cur = {now,prev,n,pFrom,pTo,compareOk,holes};
  const partial = S.to===TODAY && TODAY!==MAX ? ` · <b style="color:var(--bad)">${tr('اليوم الحالي جزئي')}</b>` : '';
  const holeNote = holes.length ? ` · <b style="color:var(--bad)">${ui('بيانات ناقصة','Missing data')}: ${holes.map(fam=>{ const end=coverEnd(fam); const name=platName(fam)||fam; return end?`${name} ${ui('حتى','through')} ${nice(end)}`:name; }).join(ui('، ', ', '))}</b>` : '';
  const liveNote = S.mode!=='ads' ? '' : S.stat==='live' ? ` · ${tr('الأرقام للإعلانات النشطة الآن فقط')}` : S.stat==='off' ? ` · ${tr('الأرقام للإعلانات المتوقفة فقط')}` : '';
  const dayWord = n===1 ? tr('يوم') : (LANG==='en'?'days':tr('يوم'));
  const prevBit = prev ? ` · ${tr('مقارنة بـ')} <b>${nice(pFrom)} – ${nice(pTo)}</b>` : ` · ${tr('لا توجد فترة سابقة كاملة للمقارنة')}`;
  $('#rangeLabel').innerHTML = `${tr('الفترة:')} <b>${nice(S.from)} – ${nice(S.to)}</b> (${n} ${dayWord})` + (S.mode==='organic' ? '' : prevBit) + partial + holeNote + liveNote;
  const head=$('#headSub'); if(head) head.textContent = S.mode==='organic' ? 'صفحات فيسبوك · إنستغرام · تيك توك · تحليلات الموقع' : (CREATIVE_ONLY ? 'ميتا · سناب شات · تيك توك — كل المبالغ بالريال السعودي' : 'ميتا · جوجل · سناب شات · تيك توك — كل المبالغ بالريال السعودي');
  buildSelects(); renderChips();
  syncSections();
  if(shown('kpis')) renderKpis(now,prev);
  if(shown('chSpend')) renderCharts(now);
  if(shown('share')||shown('heat')) renderBI(now);
  if(shown('tPlat')) renderPlat(now,prev);
  if(shown('tCamp')) renderCamp(now);
  if(shown('tMonth')) renderMonths();
  if(shown('pace')) renderPace();
  if(shown('tTree')) renderTree(now);
  if(shown('cards')) renderCards(cur);
  if(shown('perCards')) renderPersonas(cur);
  renderReport(now,prev); renderWins();
  localize();
}

function delta(a,b,lowerIsBetter){
  if(b==null||a==null||!isFinite(a)||!isFinite(b)||b===0) return `<span class="delta flat">— لا مقارنة</span>`;
  const ch = 100*(a-b)/Math.abs(b);
  if(Math.abs(ch)<0.5) return `<span class="delta flat">● ثابت</span>`;
  const up = ch>0, good = lowerIsBetter ? !up : up;
  // From a tiny base, +1,130% says little: show it as a multiple (×12.3)
  const txt = up && ch>=300 ? `×${fmt(a/b,1)}` : `${fmt(Math.abs(ch),1)}%`;
  return `<span class="delta ${good?'good':'bad'}">${up?'▲':'▼'} ${txt} <span style="color:var(--muted)">${tr('عن الفترة السابقة')}</span></span>`;
}
document.addEventListener('click', e => { const m = e.target.closest && e.target.closest('#moreF'); if(m){ const c=$('#filterCard'); const on=!c.classList.contains('show-adv'); c.classList.toggle('show-adv',on); m.setAttribute('aria-expanded',String(on)); m.textContent=tr(on?'فلاتر أقل':'فلاتر أكثر'); } });
document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-crmby]'); if(!b) return; S.crmBy = b.dataset.crmby; render(); });
// Full-funnel summary (awareness → interest → conversion → sale), then the outcome: the usual way to read ad performance.
function renderKpis(now,prev){
  const a=derive(now.tot), b=cur&&cur.compareOk&&prev?derive(prev.tot):{};
  const dl = d => /لا مقارنة/.test(d) ? '' : d;   // no comparison → no line
  const kpi = (l,v,u,d,cls='') => `<div class="kpi ${cls}"><span class="l">${l}</span><span class="v">${v}${u?`<small>${u}</small>`:''}</span>${dl(d)}</div>`;
  const ratio = (x,y) => x!=null && y ? x/y : null;
  const allN = a.allPaidN||0, allP = a.allPaid||0;
  const mer = ratio(allP, a.spend), merB = ratio(b.allPaid, b.spend);
  const cac = allN ? a.spend/allN : null, cacB = b.allPaidN ? b.spend/b.allPaidN : null;
  const crm = !!(D.crm && D.crm.paid_all);
  // 1) Outcome
  const toggle = D.crm ? `<span class="seg seg-sm" role="group" aria-label="${tr('الاقفالات حسب')}">`
    + [['lead','يوم الليد'],['paid','يوم الدفع']].map(([v,l])=>`<button type="button" data-crmby="${v}" aria-pressed="${(S.crmBy||'lead')===v}">${tr(l)}</button>`).join('') + `</span>` : '';
  const spend = delta(a.spend,b.spend,null).replace(/delta (good|bad)">/,'delta flat">');
  // Outcome tiles (references: icon chip, number, change, and a small bar chart of the same number over the range)
  const BK = buckets(now), keys = BK.keys.slice(-14);
  const daySum = (k,f) => Object.values(BK.byKey[k]||{}).reduce((t,v)=>t+(v[f]||0),0);
  const paidIn = (k,amount) => { const [x,y] = BK.span(k); let n=0;
    for(const [ld,pd,am] of ((D.crm&&D.crm.paid_all)||[])){ const d = S.crmBy==='paid'?pd:ld; if(d && d>=x && d<=y) n += amount?am:1; } return n; };
  const spark = vals => { const m = Math.max(...vals,0); if(!m || vals.length<2) return '';
    const bw = 100/vals.length; return `<svg class="spark" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">${vals.map((v,i)=>{ const h=Math.max(2,30*v/m);
      return `<rect x="${(LANG==='en'?i:vals.length-1-i)*bw+bw*.18}" y="${32-h}" width="${bw*.64}" height="${h}" rx="1.5" opacity="${i===vals.length-1?1:.45}"/>`; }).join('')}</svg>`; };
  const ICON = {
    spend:'<path d="M3 7h18v12H3z"/><path d="M3 10h18"/><path d="M16 15h2"/>',
    closings:'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    paid:'<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>',
    ret:'<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    cac:'<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>' };
  const tile = (l,v,u,d,ic,vals,cls='') => `<div class="kpi hero tile ${cls}"><span class="ic" aria-hidden="true"><svg viewBox="0 0 24 24">${ICON[ic]}</svg></span>`
    + `<span class="l">${l}</span><span class="v">${v}${u?`<small>${u}</small>`:''}</span>${dl(d)}${vals?spark(vals):''}</div>`;
  const outcome = [
    tile('الصرف',sar(a.spend),money(),spend,'spend',keys.map(k=>daySum(k,'spend'))),
    ...(crm ? [
      tile('الاقفالات',fmt(allN),'',delta(allN,b.allPaidN,false),'closings',keys.map(k=>paidIn(k,false)),'feature'),
      tile('المدفوع',sar(allP),money(),delta(allP,b.allPaid,false),'paid',keys.map(k=>paidIn(k,true))),
      tile('العائد على الصرف',mer==null?'—':fmt(mer,2)+'×','',delta(mer,merB,false),'ret',null),
      tile('تكلفة العميل',sar(cac),money(),delta(cac,cacB,true),'cac',null),
    ] : []),
  ].join('');
  // 2) Funnel: each stage has its volume, its cost, and the rate that carries people to the next stage
  const vol = [a.impr||0, a.clicks||0, (a.leads||0)+(a.conv||0), crm ? allN : (a.booked||0)];
  const top = Math.max(...vol, 1), w = v => v>0 ? Math.max(8, 100*Math.log10(v+1)/Math.log10(top+1)) : 4;
  const clickToLead = ratio(100*((a.leads||0)+(a.conv||0)), a.clicks), clickToLeadB = ratio(100*((b.leads||0)+(b.conv||0)), b.clicks);
  const leadToSale = a.closeRate, leadToSaleB = b.closeRate;   // ad-linked paid closings ÷ ad-linked CRM leads: both sides from ads
  const stages = [
    {n:'الوعي', hint:'كم شخص شاف الإعلان', main:kpi('الظهور',fmt(a.impr),'',delta(a.impr,b.impr,false),'main'),
     sub:[kpi('تكلفة الألف ظهور',sar(a.cpm),money(),delta(a.cpm,b.cpm,true),'sub')]},
    {n:'الاهتمام', hint:'كم واحد ضغط', main:kpi('نقرات الرابط والسوايب',fmt(a.clicks),'',delta(a.clicks,b.clicks,false),'main'),
     sub:[kpi('تكلفة النقرة',sar(a.cpc),money(),delta(a.cpc,b.cpc,true),'sub')],
     rate:kpi('نسبة النقر',pct(a.ctr),'',delta(a.ctr,b.ctr,false),'rate')},
    {n:'التحويل', hint:'كم واحد ترك بياناته أو راسلنا', main:kpi('الليدز',qty(a.leads),'',delta(a.leads,b.leads,false),'main'),
     sub:[kpi('تكلفة الليد',sar(a.cpl),money(),delta(a.cpl,b.cpl,true),'sub'), kpi('محادثات واتساب وماسنجر',fmt(a.conv),'',delta(a.conv,b.conv,false),'sub')],
     rate:kpi('من نقرة إلى ليد',pct(clickToLead),'',delta(clickToLead,clickToLeadB,false),'rate')},
    ...(D.crm ? [{n:'البيع', hint:'كم واحد دفع', main:kpi('اقفالات مدفوعة',fmt(crm?allN:(a.booked||0)),'',delta(crm?allN:a.booked,crm?b.allPaidN:b.booked,false),'main'),
     sub:[kpi('اقفالات من الإعلانات',fmt(a.booked||0),'',delta(a.booked,b.booked,false),'sub'), kpi('العائد من الإعلانات',a.roas==null?'—':fmt(a.roas,2)+'×','',delta(a.roas,b.roas,false),'sub')],
     rate:kpi('من ليد إلى اقفالة',pct(leadToSale),'',delta(leadToSale,leadToSaleB,false),'rate')}] : []),
  ];
  // A real funnel: each layer narrower than the one above; stage name on one side, its cost on the other, the rate between layers
  const widths = [100, 84, 68, 52];
  const funnel = stages.map((st,i)=>(st.rate?`<div class="flink"><span class="farrow" aria-hidden="true">↓</span>${st.rate}</div>`:'')
    + `<div class="flayer"><div class="fname"><b>${i+1}</b><span>${st.n}</span><em>${st.hint}</em></div>`
    + `<div class="fband-wrap"><div class="fband" style="--w:${widths[i]}%;--k:${i};--fc:${['#7C8CFF','#8B6CFF','#7E57FD','#5B36D6'][i]}">${st.main}</div></div>`
    + `<div class="fcost">${st.sub.join('')}</div></div>`).join('');
  $('#kpis').innerHTML =
    `<div class="kgroup"><div class="khead"><h3>النتيجة</h3>${toggle}</div><div class="kpis kout">${outcome}</div>`
    + (crm ? `<p class="knote">${tr('الاقفالات والمدفوع من كل المصادر في نظام العملاء (مدفوعات ميسّر). العائد على الصرف = المدفوع ÷ الصرف. تكلفة العميل = الصرف ÷ الاقفالات.')}</p>` : '') + `</div>`
    + `<div class="kgroup"><div class="khead"><h3>رحلة العميل</h3></div><div class="ffun">${funnel}</div></div>`;
}

function noteCard(title, line, alert){
  return `<div class="item${alert?' alert':''}"><span class="b">${title}</span><span class="sub">${line}</span></div>`;
}

