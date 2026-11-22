// ---- creatives
// Campaign dates: start = the campaign's first day with spend; a campaign is stopped when none of its ads is
// live (hitting the spend cap still counts as running) and its stop day = its last day with spend.
const campKey = a => family(a.platform)+'|'+(a.campaign||'');
const CAMP = (()=>{ const first={}, last={}, live={}; let start=null;
  for(const [k,date,sp] of D.rows){ const a=ADS[k]; if(!a||!sp) continue; const ck=campKey(a);
    if(!first[ck]||date<first[ck]) first[ck]=date; if(!last[ck]||date>last[ck]) last[ck]=date; if(!start||date<start) start=date; }
  for(const a of Object.values(ADS)){ if(a.live || /حد صرف/.test(a.status||'')) live[campKey(a)]=true; }
  const out={}; for(const ck of Object.keys(first)) out[ck]={first:first[ck], last:last[ck], live:!!live[ck], early:first[ck]===start}; return out; })();
function campTag(a){ const c=CAMP[campKey(a)]; if(!c) return '';
  if(c.live) return `<span class="pill camp-on" title="${ui('أول يوم صرفت فيه الحملة','The campaign\'s first day with spend')}">${ui('الحملة شغالة من ','Campaign live since ')}${c.early?ui('قبل ','before '):''}${nice(c.first)}</span>`;
  return `<span class="pill camp-off" title="${ui('آخر يوم صرفت فيه الحملة','The campaign\'s last day with spend')}">${ui('الحملة توقفت ','Campaign stopped ')}${nice(c.last)}</span>`; }
function cardsList(c){
  let list = Object.entries(c.now.byAd).map(([k,o])=>({k,...derive(o),a:ADS[k]})).filter(x=>x.a);
  if(S.stat==='live' || S.stat==='idle' || S.stat==='off'){
    const have=new Set(list.map(x=>x.k));
    for(const [k,a] of Object.entries(ADS)) if(!have.has(k) && matchesSlice(a)) list.push({k,...derive({spend:0,impr:0,clicks:0,leads:0,conv:0,leadSpend:0}),a});
  }
  if(S.q){ const q=S.q.toLowerCase(); list=list.filter(x=>(x.a.name+' '+x.a.campaign+' '+x.a.group+' '+(x.a.text||'')).toLowerCase().includes(q)); }
  const key={spend:x=>-x.spend,leads:x=>-(x.leads+x.conv),cpl:x=>(x.a.goal==='lead'&&x.a.dest!=='whatsapp'?x.cpl:null)??1e12,ctr:x=>-(x.ctr??-1),impr:x=>-x.impr}[S.sort];
  return list.sort((x,y)=>key(x)-key(y));
}
// Winner: the ad got 30+ leads in its first 3 days (launch day = its first day with spend or impressions).
// Placements of one Meta ad (m123|facebook, m123|instagram) count together. Ads already running on the
// first day of the data are skipped: their real launch day is unknown.
const WIN_MIN_LEADS = 30, WIN_DAYS = 3;
// Off until the CRM is linked: a winner should be judged on closed patients, not raw leads.
const WIN_ON = false;
const WIN = !WIN_ON ? new Set() : (()=>{
  const base = k => String(k).split('|')[0], first={}, rows=D.rows.filter(r=>ADS[r[0]] && ADS[r[0]].goal==='lead' && (r[2]||r[3]));
  let start=null;
  for(const [k,date] of rows){ const b=base(k); if(!first[b]||date<first[b]) first[b]=date; if(!start||date<start) start=date; }
  const early={};
  for(const [k,date,,,,ld] of rows){ const b=base(k); if(date<=addDays(first[b],WIN_DAYS-1)) early[b]=(early[b]||0)+(ld||0); }
  const won=new Set(Object.keys(early).filter(b=>first[b]>start && early[b]>=WIN_MIN_LEADS));
  return new Set(Object.keys(ADS).filter(k=>won.has(base(k))));
})();
function winBadge(k){ return WIN.has(k) ? `<span class="pill win" title="${ui('جاب 30 ليد أو أكثر في أول 3 أيام من إطلاقه','30+ leads in its first 3 days')}">🏆 Winner</span>` : ''; }
// ---- production insights
// Idea = the same creative across ad sets / platforms: the name without the uploaded file prefix and the Spark/Own suffix.
function ideaKey(a){
  let n=String(a.name||'').replace(/[\u200e\u200f\u202a-\u202e]/g,'');
  n=n.replace(/^.*?\.(mp4|mov|webm|jpe?g|png|gif)_/i,'');
  n=n.replace(/\s*-\s*(spark|own)\s*$/i,'').replace(/\s*[-–]?\s*(copy|نسخة)(\s*\d+)?\s*$/i,'');
  n=n.toLowerCase().replace(/\s+/g,' ').trim();
  return n || 'ad:'+(a.name||'');
}
const sumVid = list => { const o={i:0,v:0,c:0,q:[0,0,0,0],n:0}; for(const a of list){ const v=a&&a.vid; if(!v||!v.v) continue; o.i+=v.i||0; o.v+=v.v; o.c+=v.c||0; (v.q||[]).forEach((x,j)=>o.q[j]+=x||0); o.n++; } return o.n?o:null; };
const hookRate = v => v&&v.i ? 100*v.v/v.i : null;     // stopped scrolling: first 2–3 seconds ÷ impressions
const holdRate = v => v&&v.v ? 100*v.c/v.v : null;     // watched to the end ÷ those who stopped
function hookRow(v){ if(!v) return ''; return `<div class="hookrow"><span>${ui('وقفوا يشوفون','Hook')} <b>${pct(hookRate(v))}</b></span><span>${ui('كمّلوا للنهاية','Watched to end')} <b>${pct(holdRate(v))}</b></span></div>`; }
// Wearing out: running ≥14 days, CTR of its last 7 active days fell 30%+ under its first 7 (1,000+ impressions each)
const TIRED = (()=>{ const by={}; for(const [k,date,sp,im,cl] of D.rows){ if(!im) continue; (by[k]||(by[k]=[])).push([date,im,cl]); }
  const out={}; for(const [k,list] of Object.entries(by)){ if(list.length<14) continue; list.sort((p,q)=>p[0]<q[0]?-1:1);
    const w=xs=>{ const im=xs.reduce((s,x)=>s+x[1],0), cl=xs.reduce((s,x)=>s+x[2],0); return im>=1000?100*cl/im:null; };
    const f=w(list.slice(0,7)), l=w(list.slice(-7)); if(f&&l!=null&&l<f*0.7) out[k]={from:f,to:l}; }
  return out; })();
function tiredTag(k){ const t=TIRED[k]; return t && ADS[k] && ADS[k].live ? `<span class="pill tired" title="${ui('نسبة النقر آخر 7 أيام نزلت عن أول 7 أيام','CTR in its last 7 days fell vs its first 7')}">${ui('بدأ يتعب','Wearing out')} · ${pct(t.from)} → ${pct(t.to)}</span>` : ''; }
function ideaList(list){
  const g={}; for(const x of list){ const id=ideaKey(x.a); const y=g[id]||(g[id]={k:'idea:'+id, id, members:[], spend:0,impr:0,clicks:0,leads:0,conv:0,leadSpend:0,leadN:0});
    y.members.push(x); for(const f of ['spend','impr','clicks','leads','conv','leadSpend','leadN']) y[f]+=x[f]||0; }
  return Object.values(g).map(y=>{ const lead=y.members.slice().sort((p,q)=>(q.a.thumb?1:0)-(p.a.thumb?1:0)||q.spend-p.spend)[0];
    return {...derive(y), k:y.k, a:lead.a, members:y.members, idea:true}; });
}
let IDEAS={};
function openIdea(k){
  const y=IDEAS[k]; if(!y) return;
  const plats=[...new Set(y.members.map(m=>platName(family(m.a.platform))))].join(ui('، ',', '));
  const vids=y.members.some(m=>m.a.vid&&m.a.vid.v);
  const resCell=m=>m.a.goal==='messages'?`${qty(m.conv)} <span class="sub">${ui('محادثة','chats')}</span>`:m.a.goal==='lead'?`${qty(m.leads)} <span class="sub">${ui('ليد','leads')}</span>`:'—';
  $('#dlgBody').innerHTML = `<div class="panel-h"><h2 id="dlgTitle">${esc(y.a.name)}</h2><button type="button" class="btn" id="dlgClose">إغلاق</button></div>
    <div class="dlg-top"><div class="thumb">${mediaHTML(y.a,true)}</div><div style="display:grid;gap:8px;min-width:0">
      <div class="sub">${fmt(y.members.length)} ${ui('إعلان بنفس الفكرة',y.members.length===1?'ad with this idea':'ads with this idea')} · ${esc(plats)}</div>
      ${hookRow(sumVid(y.members.map(m=>m.a)))}
      <div class="row">${viewControl(y.a)}</div></div></div>
    <div class="tbl"><table><thead><tr><th>${ui('الإعلان','Ad')}</th><th>${ui('المنصة','Platform')}</th><th class="n">${ui('الصرف','Spend')}</th><th class="n">${ui('النتائج','Results')}</th><th class="n">${ui('تكلفة النتيجة','Cost per result')}</th><th class="n">${ui('نسبة النقر','CTR')}</th>${vids?`<th class="n">${ui('وقفوا يشوفون','Hook')}</th>`:''}</tr></thead>
    <tbody>${y.members.filter(m=>m.spend>0||(m.leads+m.conv)>0).sort((p,q)=>q.spend-p.spend).map(m=>`<tr class="click" data-ad="${esc(m.k)}"><td>${esc(m.a.name)} ${WIN.has(m.k)?'🏆':''}<div class="sub">${esc(m.a.campaign)}${m.a.group?' · '+esc(m.a.group):''}</div></td><td>${platCell(m.a.platform)}</td><td class="n">${sar(m.spend)}</td><td class="n">${resCell(m)}</td><td class="n">${m.a.goal==='lead'?sar(m.cpl):m.a.goal==='messages'?sar(m.cpm2):'—'}</td><td class="n">${pct(m.ctr)}</td>${vids?`<td class="n">${m.a.vid&&m.a.vid.v?pct(hookRate(m.a.vid)):ui('صورة','Image')}</td>`:''}</tr>`).join('')}</tbody></table></div>`;
  const dlg=$('#dlg'); if(!dlg.open) dlg.showModal(); $('#dlgClose').onclick=()=>dlg.close();
  $('#dlgBody').onclick=e=>{ const r=e.target.closest('tr[data-ad]'); if(r) openAd(r.dataset.ad); };
  $('#dlgBody').onkeydown=null;
  localize();
}
// Compare: pick up to 4 cards
const CMP=new Set();
function cmpBox(k){ return `<label class="cmp" data-cmp="${esc(k)}"><input type="checkbox" ${CMP.has(k)?'checked':''}> ${ui('قارن','Compare')}</label>`; }
function syncCmp(){ const b=$('#cmpBar'); b.hidden=CMP.size<1; $('#cmpGo').disabled=CMP.size<2;
  $('#cmpN').textContent = CMP.size<2 ? ui(`${CMP.size} مختارة · اختر واحد ثاني على الأقل`,`${CMP.size} selected · pick at least one more`) : ui(`${CMP.size} مختارة`,`${CMP.size} selected`); }
function cmpItem(k){
  if(k.startsWith('idea:')){ const y=IDEAS[k]; return y && {a:y.a, x:y, vid:sumVid(y.members.map(m=>m.a)), win:y.members.some(m=>WIN.has(m.k)), n:y.members.length}; }
  const a=ADS[k]; if(!a) return null; return {a, x:derive(cur.now.byAd[k]||{spend:0,impr:0,clicks:0,leads:0,conv:0,leadSpend:0}), vid:a.vid, win:WIN.has(k), k};
}
function openCompare(){
  const items=[...CMP].map(cmpItem).filter(Boolean); if(items.length<2) return;
  const metrics=[[ui('الصرف','Spend'),i=>i.x.spend,0],[ui('الليدز','Leads'),i=>i.x.leads,1],[ui('تكلفة الليد','CPL'),i=>i.a.goal==='lead'&&i.a.dest!=='whatsapp'?i.x.cpl:null,-1],[ui('نسبة النقر','CTR'),i=>i.x.ctr,1],[ui('الظهور','Impressions'),i=>i.x.impr,0],[ui('وقفوا يشوفون','Hook'),i=>hookRate(i.vid),1],[ui('كمّلوا للنهاية','Watched to end'),i=>holdRate(i.vid),1]];
  const best=metrics.map(([,f,dir])=>{ if(!dir) return null; const v=items.map(f).filter(x=>x!=null&&isFinite(x)); if(v.length<2) return null; return dir>0?Math.max(...v):Math.min(...v); });
  const show=(j,v)=> j===0||j===2? sar(v) : j===1? qty(v) : j===4? fmt(v) : pct(v);
  $('#dlgBody').innerHTML = `<div class="panel-h"><h2 id="dlgTitle">${ui('مقارنة','Compare')}</h2><button type="button" class="btn" id="dlgClose">إغلاق</button></div>
    <div class="cmp-grid">${items.map(i=>`<div><div class="thumb">${mediaHTML(i.a,false)}</div>
      <div class="nm" style="margin-top:6px;font-weight:700">${esc(i.a.name)} ${i.win?'🏆':''}</div>
      <div class="sub">${platCell(i.a.platform)} ${i.n?`· ${fmt(i.n)} ${ui('إعلان',i.n===1?'ad':'ads')}`:''}</div>
      <dl>${metrics.map(([lbl,f],j)=>{ const v=f(i); return `<dt>${lbl}</dt><dd class="${best[j]!=null&&v===best[j]?'best':''}">${v==null?'—':show(j,v)}</dd>`; }).join('')}</dl></div>`).join('')}</div>
    <p class="sub">${ui('الأفضل في كل سطر ملوّن. الأرقام للفترة المختارة، ومقاييس الفيديو مدى الحياة.','Best in each row is highlighted. Numbers are for the selected period; video metrics are lifetime.')}</p>`;
  const dlg=$('#dlg'); if(!dlg.open) dlg.showModal(); $('#dlgClose').onclick=()=>dlg.close(); $('#dlgBody').onclick=null; localize();
}
function resultCells(x){
  const g=x.a.dest==='whatsapp'?'traffic':x.a.goal;   // opens WhatsApp: no platform leads, so clicks and cost per click
  // Cost per lead counts only the spend of lead-goal ads; say so when the card's spend has more in it
  if(g==='lead'){ const ls=x.leadSpend??x.spend, ln=x.leadN??x.leads, part=Math.round(ls)<Math.round(x.spend)||ln!==x.leads;
    return statCell('الليدز',qty(x.leads))+statCell('تكلفة الليد',sar(x.cpl),part?`${sar(ls)} ${ui('صرف إعلانات الليدز','spend of lead ads')} ÷ ${qty(ln)} ${ui('ليد منها','of their leads')}`:''); }
  if(g==='messages') return statCell('محادثات',fmt(x.conv))+statCell('تكلفة المحادثة',sar(x.cpm2));
  return statCell('نقرات',fmt(x.clicks))+statCell('تكلفة النقرة',sar(x.cpc));
}
function statCell(k,v,how=''){ return `<div${how?` title="${esc(how)}"`:''}><span class="k">${k}</span><span class="mini">${v}</span>${how?`<span class="sub" style="display:block;font-size:11px">= ${esc(how)}</span>`:''}</div>`; }
// The badge reads `delivery` (really delivering, or why not). `live` only means switched on and is not shown on its own.
function liveBadge(a){ return deliveryBadge(a); }
function usableLink(url){
  const href=String(url||'');
  if(!/^https?:/i.test(href)) return '';
  // معاينة سناب على adsapi ترجع 403 في المتصفح؛ الصورة المضمّنة هي المعاينة.
  if(/adsapi\.snapchat\.com/i.test(href)) return '';
  return href;
}
// الصورة إما مضمّنة (data:) أو ملف من /thumbs/
const isImg = t => /^(data:image|\/thumbs\/)/.test(String(t||''));
function mediaHTML(item, play){
  const thumb=item.thumb||'';
  const video=item.video||'';
  const link=usableLink(item.preview_url)||usableLink(item.link)||usableLink(item.permalink)||'';
  const file=/\.(mp4|webm|mov)(\?|$)/i.test(video)||/\.(mp4|webm|mov)(\?|$)/i.test(link);
  const embed=/tiktok\.com\/(embed|player)/.test(video)||/tiktok\.com\/(embed|player)/.test(link);
  const label=item.text||item.caption||item.name||'';
  const poster = thumb && isImg(thumb) ? ` poster="${esc(thumb)}"` : '';
  if(play && file) return `<video controls playsinline${poster} src="${esc(video||link)}" data-media="video"></video>`;
  if(play && embed) return `<iframe src="${esc(video||link)}" title="معاينة الفيديو" allow="fullscreen; autoplay; encrypted-media" allowfullscreen data-media="frame"></iframe>`;
  let inner;
  if(thumb && isImg(thumb)) inner = `<img src="${esc(thumb)}" alt="${esc(label)}" loading="lazy" data-media="img">`;
  else if(thumb && /^https?:/i.test(thumb)) inner = `<img src="${esc(thumb)}" alt="${esc(label)}" loading="lazy" data-media="img">`;
  else inner = `<div class="nothumb" role="img" aria-label="${esc(label)}"><svg viewBox="0 0 24 24" aria-hidden="true">${/فيديو|video/i.test(item.format||'')||file||embed?'<rect x="2" y="4" width="20" height="16" rx="3"/><path d="m10 9 5 3-5 3z"/>':'<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 9h10M7 13h10M7 17h6"/>'}</svg><span>${ui('متحمس تعرف؟ اضغط زر «عرض المادة الإعلانية» لمعرفته','Curious? Press «View creative» to see it')}</span></div>`;
  if(!play && (file || embed)) inner += `<span class="play" aria-hidden="true">▶</span>`;
  return inner;
}
function thumbHTML(a){ return mediaHTML(a, false); }
function creativeAction(a){
  const video=usableLink(a.video);
  const page=usableLink(a.preview_url)||usableLink(a.permalink);
  const image=usableLink(a.image_url);
  if(video && /\.(mp4|webm|mov)(\?|$)/i.test(video)) return {type:'video', src:video, poster:a.thumb&&isImg(a.thumb)?a.thumb:''};
  if(page) return {type:'tab', href:page};
  if(video) return {type:'tab', href:video};
  if(image) return {type:'tab', href:image};
  if(a.thumb && isImg(a.thumb)) return {type:'img', src:a.thumb};
  const link=usableLink(a.link);
  if(link) return {type:'tab', href:link};
  return null;
}
function viewControl(a){
  const act=creativeAction(a); if(!act) return '';
  const label=ui('عرض المادة الإعلانية','View creative');
  if(act.type==='tab') return `<a class="btn view" href="${esc(act.href)}" target="_blank" rel="noopener">${label}</a>`;
  return `<button type="button" class="btn view" data-view="1">${label}</button>`;
}
function openCreative(a, back){
  const act=creativeAction(a); if(!act) return;
  if(act.type==='tab'){ window.open(act.href,'_blank','noopener'); return; }
  const media = act.type==='video'
    ? `<video class="fullimg" controls playsinline autoplay${act.poster?` poster="${esc(act.poster)}"`:''} src="${esc(act.src)}" data-media="video"></video>`
    : `<img class="fullimg" src="${esc(act.src)}" alt="${esc(a.name||'')}" data-media="img">`;
  $('#dlgBody').innerHTML = `<div class="panel-h"><h2 id="dlgTitle">${esc(a.name||labelSafe(a))}</h2><div class="row">${back?'<button type="button" class="btn" id="dlgBack">رجوع</button>':''}<button type="button" class="btn" id="dlgClose">إغلاق</button></div></div>${media}`;
  const dlg=$('#dlg'); if(!dlg.open) dlg.showModal(); $('#dlgClose').onclick=()=>dlg.close();
  if(back) $('#dlgBack').onclick=()=>openAd(back);
  localize();
}
function labelSafe(a){ return a && (a.name||a.text||'') || ''; }
function previewLink(a){
  const href=usableLink(a.preview_url)||usableLink(a.permalink)||usableLink(a.video)||usableLink(a.link);
  if(!href) return '';
  const act=creativeAction(a); if(act && act.type==='tab' && act.href===href) return '';
  const label = /tiktok\.com/.test(href) ? 'مشاهدة الفيديو' : family(a.platform)==='google' ? 'صفحة الهبوط' : (a.preview_url||a.permalink) ? 'فتح المنشور' : 'فتح في مدير الإعلانات';
  return `<a href="${esc(href)}" target="_blank" rel="noopener">${label}</a>`;
}
function wallCard({key, wall, label, thumb, badges, title, sub, stats, flag, view}){
  return `<div class="card" role="button" tabindex="0" data-k="${esc(key)}" data-wall="${wall}" aria-label="${esc(label)}">
      <div class="thumb">${thumb}
        <div class="badges">${badges}</div>
      </div>
      <div class="body">
        <div class="nm">${title}</div>
        <div class="cp">${sub}</div>
        <div class="stats">${stats}</div>
        ${flag||''}
        ${view||''}
      </div>
    </div>`;
}
function renderCards(c){
  let list = cardsList(c);
  { list=ideaList(list); const key={spend:x=>-x.spend,leads:x=>-(x.leads+x.conv),cpl:x=>(x.a.goal==='lead'&&x.a.dest!=='whatsapp'?x.cpl:null)??1e12,ctr:x=>-(x.ctr??-1),impr:x=>-x.impr}[S.sort]; list.sort((p,q)=>key(p)-key(q)); IDEAS={}; list.forEach(x=>IDEAS[x.k]=x); }
  renderSummary(c, list);
  const show = list.slice(0,S.shown);
  $('#cards').innerHTML = show.length ? show.map(x=>wallCard({
    key:x.k, wall:'ad', label:ui('تفاصيل ','Details: ')+x.a.name, thumb:thumbHTML(x.a),
    badges:`${x.idea?`<span class="pill">${fmt(x.members.length)} ${ui('إعلان',x.members.length===1?'ad':'ads')}</span>`:platCell(x.a.platform)}${x.idea?deliveryBadge(x.members.find(m=>deliveryOf(m.a)===bestDelivery(x.members.map(y=>y.a)))?.a, bestDelivery(x.members.map(y=>y.a))):liveBadge(x.a)}${x.idea?(x.members.some(m=>WIN.has(m.k))?winBadge(x.members.find(m=>WIN.has(m.k)).k):''):winBadge(x.k)}`,
    title:esc(x.a.name),
    sub:`${x.idea?'':campTag(x.a)+' '+tiredTag(x.k)} ${depCell(x.a.dept)} ${goalPill(x.a.goal)} ${esc(x.a.campaign)} · ${esc(x.a.group)}${x.a.format?` · <span>${esc(tr(x.a.format))}</span>`:''}`,
    stats:statCell('الصرف',sar(x.spend))+resultCells(x)+statCell('الظهور',fmt(x.impr))+statCell(family(x.a.platform)==='meta'&&x.a.goal==='lead'?'محادثات':'النقرات', family(x.a.platform)==='meta'&&x.a.goal==='lead'?fmt(x.conv):fmt(x.clicks))+statCell('نسبة النقر',pct(x.ctr)),
    flag:(x.a.dest==='whatsapp'?`<span class="pill wa-dest">${ui('توجيه للواتساب، الليدز ما تنقاس من المنصة','Sent to WhatsApp, leads are not measured by the platform')}</span>`:x.a.dest==='unknown'?`<span class="pill wa-dest">${ui('وجهة غير معروفة','Destination unknown')}</span>`:x.a.goal==='lead'&&x.leads===0&&x.conv===0&&x.spend>=50&&family(x.a.platform)!=='google'?`<span class="flag">${ui(`صرف ${sar(x.spend)} ${money()} بدون ليد أو محادثة`,`Spend ${sar(x.spend)} ${money()} with no lead or conversation`)}</span>`:''),
    view:hookRow(x.idea?sumVid(x.members.map(m=>m.a)):x.a.vid)+viewControl(x.a)+cmpBox(x.k),
  })).join('') : '<div class="empty">لا توجد مادة إعلانية تطابق الفلاتر في هذه الفترة.</div>';
  $('#more').hidden = list.length<=S.shown;
  $('#more').textContent = ui(`عرض المزيد (${fmt(list.length-S.shown)} متبقي)`,`Show more (${fmt(list.length-S.shown)} left)`);
  localize();
}
const openCard = k => k.startsWith('idea:') ? openIdea(k) : openAd(k);
function onCardClick(e){
  if(e.target.closest('a')) return;
  const b=e.target.closest('.card'); if(!b) return;
  const box=e.target.closest('[data-cmp]');
  if(box){ e.stopPropagation(); if(e.target.tagName!=='INPUT') return; const k=box.dataset.cmp;
    if(e.target.checked){ if(CMP.size>=4){ e.target.checked=false; return; } CMP.add(k); } else CMP.delete(k); syncCmp(); return; }
  if(e.target.closest('[data-view]')){ e.preventDefault(); const k=b.dataset.k; const a=b.dataset.wall==='post'?null:(k.startsWith('idea:')?(IDEAS[k]||{}).a:ADS[k]); if(a) openCreative(a); return; }
  if(b.dataset.wall==='post') openOrganic(b.dataset.k); else openCard(b.dataset.k);
}
function onCardKey(e){
  if(e.target.closest('a') || e.target.closest('[data-view]') || e.target.closest('[data-cmp]')) return;
  if(e.key!=='Enter' && e.key!==' ') return;
  const b=e.target.closest('.card'); if(!b) return;
  e.preventDefault();
  if(b.dataset.wall==='post') openOrganic(b.dataset.k); else openCard(b.dataset.k);
}
$('#cmpGo').addEventListener('click',openCompare);
$('#cmpClear').addEventListener('click',()=>{ CMP.clear(); syncCmp(); renderCards(cur); });
$('#cards').addEventListener('click', onCardClick);
$('#cards').addEventListener('keydown', onCardKey);

// Week by week over the ad's whole life: shows when it started to wear out
function weekly(k){
  const w={}; for(const [kk,date,sp,im,cl,ld] of D.rows){ if(kk!==k) continue; const d=toD(date); d.setUTCDate(d.getUTCDate()-d.getUTCDay()); const wk=toS(d); const x=w[wk]||(w[wk]={sp:0,im:0,cl:0,ld:0}); x.sp+=sp; x.im+=im; x.cl+=cl; x.ld+=ld; }
  const rows=Object.entries(w).sort((p,q)=>p[0]<q[0]?-1:1); if(rows.length<2) return '';
  const lead=ADS[k].goal==='lead';
  return `<div><div class="sub">${ui('أسبوع بأسبوع من أول ما اشتغل الإعلان','Week by week since the ad started')}</div><div class="tbl"><table><thead><tr><th>${ui('الأسبوع','Week')}</th><th class="n">${ui('الصرف','Spend')}</th><th class="n">${ui('الظهور','Impressions')}</th><th class="n">${ui('نسبة النقر','CTR')}</th>${lead?`<th class="n">${ui('الليدز','Leads')}</th><th class="n">${ui('تكلفة الليد','CPL')}</th>`:''}</tr></thead><tbody>${rows.map(([wk,x])=>`<tr><td>${nice(wk)}</td><td class="n">${sar(x.sp)}</td><td class="n">${fmt(x.im)}</td><td class="n">${x.im?pct(100*x.cl/x.im):'—'}</td>${lead?`<td class="n">${qty(x.ld)}</td><td class="n">${x.ld?sar(x.sp/x.ld):'—'}</td>`:''}</tr>`).join('')}</tbody></table></div></div>`;
}

// ---- summary strip at the top of the creative page (asked by Leen, 2026-11-21)
// Block 1: how many ads are delivering right now, by the platform's own `delivery` field (never `live` alone).
//   on, not delivering = budget / rejected / in review / scheduled; stopped = off or ended; unknown stays apart.
//   Follows the platform, department, campaign, goal and format filters. Ads count if they ran in the chosen period
//   or are on and not stopped now (scheduled, in review or rejected ads have no spend yet, so a period alone would hide them).
// Block 2: the same idea list the cards below show (cardsList + ideaList), so the two always agree.
const SS_FAMS = ['meta','snap','tiktok','google'];
const SS_PENDING = ['budget','rejected','in_review','scheduled'];
const SS_MIN_SPEND = 50;   // best / worst need real spend: 3 riyals and one lead is noise (same floor as the card flag)
const SS_WHY = {budget:['الميزانية خلصت','Budget used up'],rejected:['مرفوض','Rejected'],in_review:['قيد المراجعة','In review'],scheduled:['مجدول','Scheduled']};
function summaryStatus(c){
  const rows = c.now.byAd, by = {}, tot = {delivering:0,pending:0,stopped:0,unknown:0,why:{}};
  const mk = () => ({delivering:0,pending:0,stopped:0,unknown:0,why:{}});
  for(const [k,a] of Object.entries(ADS)){
    if(!matchesSlice(a,true)) continue;
    const d = deliveryOf(a);
    if(!rows[k] && d!=='delivering' && !SS_PENDING.includes(d)) continue;
    const bucket = d==='delivering' ? 'delivering' : SS_PENDING.includes(d) ? 'pending' : d==='unknown' ? 'unknown' : 'stopped';
    for(const o of [tot, by[family(a.platform)||a.platform] ||= mk()]){ o[bucket]++; if(bucket==='pending') o.why[d]=(o.why[d]||0)+1; }
  }
  return {by, tot};
}
function summaryCreative(list){
  const t = {spend:0,impr:0,clicks:0,res:0}, rated = [];
  for(const x of list){
    const res = (x.leads||0)+(x.conv||0);
    t.spend+=x.spend; t.impr+=x.impr; t.clicks+=x.clicks; t.res+=res;
    if(x.spend>=SS_MIN_SPEND && res>0) rated.push({x, res, cpr:x.spend/res});
  }
  rated.sort((p,q)=>p.cpr-q.cpr);
  return {n:list.length, ...t, cpr:t.res?t.spend/t.res:null, ctr:t.impr?100*t.clicks/t.impr:null,
    best:rated[0]||null, worst:rated.length>1?rated[rated.length-1]:null};
}
function ssWhy(why){
  return SS_PENDING.filter(d=>why[d]).map(d=>`${ui(...SS_WHY[d])} ${fmt(why[d])}`).join(ui(' · ',' · '));
}
function renderSummary(c, list){
  const box = $('#sumStripBody'); if(!box) return;
  const st = summaryStatus(c), cr = summaryCreative(list);
  const fams = SS_FAMS.filter(f=>st.by[f]).concat(Object.keys(st.by).filter(f=>!SS_FAMS.includes(f)));
  const row = (label, o, cls='') => `<tr${cls?` class="${cls}"`:''}><th scope="row">${label}</th>`
    + `<td class="n st-live-n">${fmt(o.delivering)}</td>`
    + `<td class="n">${fmt(o.pending)}${o.pending?`<span class="sub">${esc(ssWhy(o.why))}</span>`:''}</td>`
    + `<td class="n">${fmt(o.stopped)}</td>`
    + (st.tot.unknown?`<td class="n">${fmt(o.unknown)}</td>`:'') + `</tr>`;
  const platLabel = f => `<span class="pill"><span class="dot" style="background:var(${(PL[f]||{c:'--s-meta'}).c})"></span>${esc(platName(f)||f)}</span>`;
  const pick = (label, p, sub) => `<div class="kpi ss-pick"><span class="l">${label}</span>${p
    ? `<button type="button" class="ss-name" data-k="${esc(p.x.k)}" title="${esc(p.x.a.name)}">${esc(p.x.a.name)}</button><span class="v">${sar(p.cpr)}<small>${money()}</small></span><span class="sub">${fmt(p.res)} ${ui('نتيجة','results')} · ${sar(p.x.spend)} ${money()}</span>`
    : `<span class="v">—</span><span class="sub">${sub}</span>`}</div>`;
  const kpi = (l,v,u) => `<div class="kpi"><span class="l">${l}</span><span class="v">${v}${u?`<small>${u}</small>`:''}</span></div>`;
  box.innerHTML = `<div class="ss-block"><div class="khead"><h2 id="ssH1">${ui('حالة التسليم الآن','Delivery right now')}</h2>`
    + `<span class="sub">${ui('من حالة الإعلان عند المنصة نفسها، مو بس إنه مفعّل','From the platform\'s own ad status, not just whether the ad is switched on')}</span></div>`
    + (fams.length ? `<div class="tbl"><table class="ss-table" aria-labelledby="ssH1"><thead><tr><th scope="col">${ui('المنصة','Platform')}</th>`
      + `<th scope="col" class="n">${ui('يصرف الآن','Delivering now')}</th><th scope="col" class="n">${ui('مفعّل بس ما يصرف','On, not delivering')}</th><th scope="col" class="n">${ui('متوقف','Stopped')}</th>`
      + (st.tot.unknown?`<th scope="col" class="n">${ui('غير معروف','Unknown')}</th>`:'') + `</tr></thead><tbody>`
      + fams.map(f=>row(platLabel(f), st.by[f])).join('') + (fams.length>1 ? row(`<b>${ui('الكل','All')}</b>`, st.tot, 'ss-total') : '') + `</tbody></table></div>`
    : `<p class="knote">${ui('ما فيه إعلانات تطابق الفلاتر.','No ads match the filters.')}</p>`)
    + `<p class="knote">${ui('«مفعّل بس ما يصرف» = الميزانية خلصت أو مرفوض أو قيد المراجعة أو مجدول. المتوقف = مطفي أو انتهت مدته. العدد بالإعلانات (الكرت الواحد ممكن يضم أكثر من إعلان).','"On, not delivering" = budget used up, rejected, in review or scheduled. Stopped = switched off or ended. Counted in ads (one card can hold several ads).')}</p></div>`
    + `<div class="ss-block"><div class="khead"><h2 id="ssH2">${ui('المواد الإعلانية بالأرقام','Creatives in numbers')}</h2>`
    + `<span class="sub">${ui('للفترة والمنصة اللي اخترتها، ونفس المواد اللي تحت','For the period and platform you picked, the same creatives shown below')}</span></div>`
    + `<div class="kpis ss-kpis">${kpi(ui('عدد المواد','Creatives'),fmt(cr.n),'')}${kpi(ui('الصرف','Spend'),sar(cr.spend),money())}${kpi(ui('النتائج (ليدز ومحادثات)','Results (leads and chats)'),fmt(cr.res),'')}`
    + `${kpi(ui('تكلفة النتيجة','Cost per result'),sar(cr.cpr),cr.cpr==null?'':money())}${kpi(ui('نسبة النقر','CTR'),pct(cr.ctr),'')}`
    + `${pick(ui('أفضل مادة بتكلفة النتيجة','Best creative by cost per result'),cr.best,ui('ما فيه مادة صرفت '+SS_MIN_SPEND+' ريال وجابت نتيجة','No creative spent '+SS_MIN_SPEND+' SAR and got a result'))}`
    + `${pick(ui('أضعف مادة بتكلفة النتيجة','Weakest creative by cost per result'),cr.worst,ui('تحتاج مادتين على الأقل للمقارنة','Needs at least two creatives to compare'))}</div>`
    + `<p class="knote">${ui(`الأفضل والأضعف من المواد اللي صرفت ${SS_MIN_SPEND} ريال أو أكثر وجابت نتيجة. اضغط على الاسم عشان تفتح تفاصيل المادة.`,`Best and weakest come from creatives that spent ${SS_MIN_SPEND} SAR or more and got a result. Tap the name to open the creative.`)}</p></div>`;
}
$('#sumStripBody').addEventListener('click', e=>{ const b=e.target.closest('.ss-name'); if(b) openCard(b.dataset.k); });
