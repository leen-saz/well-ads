// ---- المشاهدين ومشاهد الفيديو (من a.aud و a.vid). كل صف [الفئة، ظهور، نقرات، صرف، ليدز أو null]
const AUD_DIMS=[['age','العمر','Age'],['gender','الجنس','Gender'],['region','المنطقة','Region'],['device','الجهاز','Device'],['place','المنصة','Placement'],['hour','وقت المشاهدة','Time of day']];
const AUD_WORD={male:['ذكور','Men'],female:['إناث','Women'],unknown:['غير معروف','Unknown'],android_smartphone:['أندرويد جوال','Android phone'],android_tablet:['أندرويد تابلت','Android tablet'],
  iphone:['آيفون','iPhone'],ipad:['آيباد','iPad'],ipod:['آيبود','iPod'],desktop:['كمبيوتر','Desktop'],mobile:['جوال','Mobile'],tablet:['تابلت','Tablet'],connected_tv:['تلفزيون','TV'],ios:['آيفون (iOS)','iOS'],android:['أندرويد','Android'],
  facebook:['فيسبوك','Facebook'],instagram:['انستقرام','Instagram'],messenger:['ماسنجر','Messenger'],audience_network:['شبكة الجمهور','Audience Network'],threads:['ثريدز','Threads'],tiktok:['تيك توك','TikTok'],pangle:['Pangle','Pangle']};
const AUD_REGION=[[/riyadh/i,'الرياض'],[/makkah|mecca/i,'مكة المكرمة'],[/eastern|sharqiyah/i,'الشرقية'],[/madinah|medina/i,'المدينة المنورة'],[/qassim|qasim/i,'القصيم'],[/asir|aseer/i,'عسير'],[/tabuk/i,'تبوك'],[/hail|ha'il/i,'حائل'],[/jazan|jizan/i,'جازان'],[/najran/i,'نجران'],[/bahah|baha/i,'الباحة'],[/jawf|jouf/i,'الجوف'],[/northern/i,'الحدود الشمالية']];
// ---- شخصيات الجمهور: من تفاصيل المشاهدين (aud) للإعلانات اللي في الفترة والفلاتر
function renderPersonas(c){
  const el=$('#perCards'); if(!el || !c) return;
  if(EXTRA_WAIT){ el.innerHTML=extraLoading(); $('#perSub').textContent=''; return; }
  const ads=cardsList(c).map(x=>({k:x.k,a:x.a,spend:x.spend})).filter(x=>x.a.aud && x.a.aud.gender);
  if(!ads.length){ el.innerHTML=`<div class="empty">${ui('ما فيه تفاصيل مشاهدين للإعلانات في هالفترة.','No audience detail for the ads in this period.')}</div>`; $('#perSub').textContent=''; return; }
  // Rows: [segment, impressions, clicks, spend, results or null]. Results = leads + chats (Meta), null where the platform does not split them.
  const G={}, ALL={region:{},device:{},hour:{}};
  const add=(o,key,r)=>{ const t=(o[key] ||= [0,0,0,null]); t[0]+=r[1]; t[1]+=r[2]; t[2]+=r[3]; if(r[4]!=null) t[3]=(t[3]||0)+r[4]; };
  for(const {k,a} of ads){
    const A=a.aud;
    for(const gr of A.gender){
      const gk=String(gr[0]).toLowerCase(); if(gk!=='female'&&gk!=='male') continue;
      const P=(G[gk] ||= {tot:[0,0,0,null],age:{},ads:[]});
      add(P,'tot',gr);
      if(gr[1]>=200) P.ads.push({k,a,ctr:100*gr[2]/gr[1],impr:gr[1]});
    }
    // Age inside each gender only where the platform reports them together (Meta). No estimate from the separate lists.
    for(const r of (A.agegender||[])){ const [gk,age]=String(r[0]).split('|'); if(G[gk]) add(G[gk].age,age,r); }
    // Region, device and hour are never split by gender: they describe everyone who saw the ads
    for(const dim of ['region','device','hour']) for(const r of (A[dim]||[])) add(ALL[dim],r[0],r);
  }
  const ctr=t=>t[0]?t[1]/t[0]:0;
  const share=(o,by)=>{ const tot=Object.values(o).reduce((x,t)=>x+by(t),0); return Object.entries(o).filter(([,t])=>by(t)>0).sort((x,y)=>by(y[1])-by(x[1])).map(([v,t])=>[v,tot?100*by(t)/tot:0,t]); };
  // An age group counts only with enough impressions (5% of the gender and 100): small groups made noisy winners
  const ages=P=>{ const tot=P.tot[0]||1; const ok=Object.entries(P.age).filter(([,t])=>t[0]>=Math.max(100,tot*.05));
    const rated=ok.filter(([,t])=>t[3]>0).sort((x,y)=>x[1][2]/x[1][3]-y[1][2]/y[1][3]);
    return (rated.length?rated:ok.sort((x,y)=>ctr(y[1])-ctr(x[1]))).slice(0,2).map(([v])=>audLabel('age',v)); };
  const cards=['female','male'].filter(g=>G[g]&&G[g].tot[0]>0).map(g=>{
    const P=G[g], T=P.tot, cpr=T[3]?T[2]/T[3]:null, ag=ages(P);
    const best=P.ads.sort((x,y)=>y.ctr-x.ctr).slice(0,3);
    return {g,cpr,html:`<article class="per"><h3>${g==='female'?ui('سيدة','Woman'):ui('رجل','Man')}${ag.length?' '+ag.join(ui(' أو ',' or ')):''}</h3>
      <dl><dt>${ui('من الظهور','Share of impressions')}</dt><dd>${pct(100*T[0]/((G.female?.tot[0]||0)+(G.male?.tot[0]||0)||1))}</dd>
      <dt>${ui('نسبة النقر','CTR')}</dt><dd>${pct(100*ctr(T))}</dd><dt>${ui('الصرف','Spend')}</dt><dd>${sar(T[2])} ${money()}</dd>
      <dt>${ui('النتايج (ليدز ومحادثات)','Results (leads and chats)')}</dt><dd>${T[3]==null?ui('المنصة ما تقسمها','not split by the platform'):qty(T[3])}</dd><dt>${ui('تكلفة النتيجة','Cost per result')}</dt><dd>${cpr==null?'—':sar(cpr)}</dd></dl>
      ${best.length?`<div><div class="sub">${ui('أكثر مواد إعلانية تشدّه','Creatives that pull them most')}</div><ol>${best.map(b=>`<li>${esc(b.a.name)} <span class="sub">${pct(b.ctr)}</span></li>`).join('')}</ol></div>`:''}
    </article>`};
  });
  const win=cards.filter(x=>x.cpr!=null).sort((x,y)=>x.cpr-y.cpr)[0];
  // Everyone: the top region and device with their share, and the hours with the most clicks
  const reg=share(ALL.region,t=>t[0])[0], dev=share(ALL.device,t=>t[0]).slice(0,2), hrs=share(ALL.hour,t=>t[1]).slice(0,3).map(([h])=>+h).sort((x,y)=>x-y);
  const all=[reg&&ui(`أغلب الظهور من ${audLabel('region',reg[0])} (${pct(reg[1])})`,`Most impressions from ${audLabel('region',reg[0])} (${pct(reg[1])})`),
    dev.length&&ui(`الأجهزة: ${dev.map(([v,p])=>`${audLabel('device',v)} ${pct(p)}`).join('، ')}`,`Devices: ${dev.map(([v,p])=>`${audLabel('device',v)} ${pct(p)}`).join(', ')}`),
    hrs.length&&ui(`أكثر نقر الساعة ${hrs.map(h=>h+':00').join('، ')}`,`Most clicks at ${hrs.map(h=>h+':00').join(', ')}`)].filter(Boolean);
  el.innerHTML=(all.length?`<p class="who" style="grid-column:1/-1;margin:0">${ui('كل المشاهدين','Everyone')}: ${all.join(' · ')}. <span class="sub">${ui('المنصات ما تقسم المنطقة والجهاز والوقت حسب الجنس، والجهاز حسب الظهور مو حسب النقر.','Platforms do not split region, device and time by gender; devices are by impressions, not clicks.')}</span></p>`:'')
    +cards.map(x=>x===win&&cards.length>1?x.html.replace('<article class="per">',`<article class="per"><span class="best">${ui('الأرخص نتيجة','Cheapest result')}</span>`):x.html).join('');
  $('#perSub').textContent=ui(`من ${fmt(ads.length)} إعلان فيها تفاصيل مشاهدين`,`From ${fmt(ads.length)} ads with audience detail`);
}
function audLabel(dim,v){
  if(dim==='hour') return `${+v}:00`;
  const w=AUD_WORD[String(v).toLowerCase()]; if(w) return ui(w[0],w[1]);
  if(dim==='region'&&LANG!=='en'){ const r=AUD_REGION.find(([re])=>re.test(v)); if(r) return r[1]; }
  return String(v);
}
// أكثر فئة تتفاعل: أعلى نسبة نقر بين الفئات اللي لها ظهور كافي (5% من البعد و100 ظهور على الأقل)، وأرخص ليد إذا الليدز متوفرة
function audBest(rows){
  const tot=rows.reduce((s,r)=>s+r[1],0), clk=rows.reduce((s,r)=>s+r[2],0); if(!tot) return null;
  const ok=rows.filter(r=>r[1]>=Math.max(100,tot*.05)); if(!ok.length) return null;
  const ctr=r=>100*r[2]/r[1], avg=100*clk/tot;
  const top=ok.reduce((b,r)=>ctr(r)>ctr(b)?r:b);
  const withLeads=ok.filter(r=>r[4]>0), cheap=withLeads.length?withLeads.reduce((b,r)=>r[3]/r[4]<b[3]/b[4]?r:b):null;
  return {top, ctr:ctr(top), lift:avg?ctr(top)/avg-1:null, cheap, cpl:cheap?cheap[3]/cheap[4]:null};
}
function audTable(dim,rows,lead){
  const tot=rows.reduce((s,r)=>s+r[1],0)||1;
  if(dim==='hour'){
    const by=Array.from({length:24},(_,h)=>rows.find(r=>+r[0]===h)||[h,0,0,0,null]), max=Math.max(...by.map(r=>r[1]),1), best=audBest(rows);
    return `<div class="aud-hours" role="img" aria-label="${ui('الظهور حسب ساعة اليوم','Impressions by hour of day')}">${by.map(r=>`<span${best&&+best.top[0]===+r[0]?' class="top"':''} style="height:${Math.max(2,100*r[1]/max)}%" title="${audLabel('hour',r[0])}: ${fmt(r[1])} ${ui('ظهور','impr.')} · ${ui('نسبة النقر','CTR')} ${r[1]?pct(100*r[2]/r[1]):'—'}"></span>`).join('')}</div>
      <div class="sub" style="display:flex;justify-content:space-between;direction:ltr"><span>0:00</span><span>12:00</span><span>23:00</span></div>`;
  }
  const showLeads=lead&&rows.some(r=>r[4]!=null);
  return `<div class="tbl"><table><thead><tr><th>${ui('الفئة','Segment')}</th><th>${ui('من الظهور','Share of impressions')}</th><th class="n">${ui('نسبة النقر','CTR')}</th><th class="n">${ui('الصرف','Spend')}</th>${showLeads?`<th class="n">${ui('الليدز','Leads')}</th><th class="n">${ui('تكلفة الليد','CPL')}</th>`:''}</tr></thead>
    <tbody>${rows.slice(0,12).map(r=>`<tr><td>${esc(audLabel(dim,r[0]))}</td><td><div style="display:flex;gap:8px;align-items:center"><div class="aud-bar" style="flex:1"><i style="width:${100*r[1]/tot}%"></i></div><span class="sub">${pct(100*r[1]/tot)}</span></div></td><td class="n">${r[1]?pct(100*r[2]/r[1]):'—'}</td><td class="n">${sar(r[3])}</td>${showLeads?`<td class="n">${r[4]==null?'—':qty(r[4])}</td><td class="n">${r[4]?sar(r[3]/r[4]):'—'}</td>`:''}</tr>`).join('')}</tbody></table></div>`;
}
function audBox(a, dim){
  const A=a.aud; if(!A) return '';
  const dims=AUD_DIMS.filter(([d])=>A[d]&&A[d].length); if(!dims.length) return '';
  const on=dims.some(([d])=>d===dim)?dim:dims[0][0], lead=a.goal==='lead';
  const fam=family(a.platform), notes=[ui('آخر 30 يوم','Last 30 days')];
  if(A.hour&&(fam==='snap'||fam==='tiktok')) notes.push(ui('الساعة: آخر 7 أيام بتوقيت الرياض','Hours: last 7 days, Riyadh time'));
  if(A.lvl==='group') notes.push(ui('قوقل يعطي العمر والجنس والمنطقة والساعة للمجموعة الإعلانية كاملة','Google reports age, gender, region and hour for the whole ad group'));
  if(fam==='snap') notes.push(ui('سناب ما يقسم الليدز على الفئات، والنقرات هي السوايب','Snap does not split leads by segment; clicks are swipes'));
  const best=dims.map(([d,ar,en])=>{ const b=audBest(A[d]); if(!b) return '';
    const lift=b.lift!=null&&isFinite(b.lift)&&Math.abs(b.lift)>=.05?` (${b.lift>0?ui('أعلى','above'):ui('أقل','below')} ${ui('من المتوسط بـ','average by')} ${fmt(Math.abs(b.lift)*100)}%)`:'';
    const cheap=lead&&b.cheap?` · ${ui('أرخص ليد','cheapest lead')}: ${esc(audLabel(d,b.cheap[0]))} ${sar(b.cpl)} ${money()}`:'';
    return `<li><b>${ui(ar,en)}:</b> ${esc(audLabel(d,b.top[0]))} · ${ui('نسبة النقر','CTR')} ${pct(b.ctr)}${lift}${cheap}</li>`; }).filter(Boolean);
  return `<section class="aud" data-aud-root>
    <div class="aud-h"><h3 style="margin:0">${ui('المشاهدين','Audience')}</h3><span class="sub">${notes.join(' · ')}</span></div>
    ${best.length?`<div class="aud-best"><h3>${ui('المشاهدين الأكثر تفاعل','Most engaged viewers')}</h3><ul>${best.join('')}</ul><span class="sub">${ui('الفئة لازم يكون لها 5% من الظهور على الأقل عشان تنحسب','A segment needs at least 5% of impressions to count')}</span></div>`:''}
    <div class="seg" role="group" aria-label="${ui('تفاصيل المشاهدين','Audience breakdown')}">${dims.map(([d,ar,en])=>`<button type="button" data-aud-dim="${d}" aria-pressed="${d===on}">${ui(ar,en)}</button>`).join('')}</div>
    ${audTable(on,A[on],lead)}
  </section>`;
}
// مشاهد الفيديو: منحنى ميتا ثانية بثانية، وغيرها من أرباع الفيديو
const CURVE_S=[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,20,25,30,40,50,60];
function scenesBox(a){
  const v=a.vid; if(!v||!v.v) return '';
  let pts, unit;
  if(v.pc&&v.pc.length>2){ pts=v.pc.map((p,i)=>[CURVE_S[i]??i, p]); const z=pts.findIndex(p=>p[1]===0); if(z>1) pts=pts.slice(0,z+1); unit='s'; }   // الأصفار بعد نهاية الفيديو ما تنرسم
  else if(v.q&&v.q.some(Boolean)){ pts=[[0,100],...v.q.map((n,i)=>[25*(i+1), Math.min(100,100*n/v.v)])]; unit='%'; }
  else return '';
  const W=640,H=140,maxX=pts[pts.length-1][0]||1, X=x=>8+(W-16)*x/maxX, Y=y=>8+(H-16)*(1-y/100);
  let drop=null, calm=null;
  for(let i=1;i<pts.length;i++){ const d=pts[i-1][1]-pts[i][1]; if(!drop||d>drop.d) drop={i,d}; if(!calm||d<calm.d) calm={i,d}; }
  const at=s=>unit==='s'?ui(`الثانية ${s}`,`second ${s}`):ui(`${s}% من الفيديو`,`${s}% of the video`);
  const half=pts.find(p=>p[1]<50), hook=unit==='s'?(pts.find(p=>p[0]===3)||[])[1]:null, lines=[];
  if(drop&&drop.d>0) lines.push(`${ui('أكثر مكان يطلعون فيه','Biggest drop-off')}: ${ui('بين','between')} ${at(pts[drop.i-1][0])} ${ui('و','and')} ${at(pts[drop.i][0])} (${ui('نزل','fell')} ${fmt(drop.d)} ${ui('نقطة','points')})`);
  if(calm&&pts.length>3) lines.push(`${ui('أقوى مقطع يمسك المشاهد','Strongest stretch')}: ${ui('بين','between')} ${at(pts[calm.i-1][0])} ${ui('و','and')} ${at(pts[calm.i][0])}`);
  if(hook!=null) lines.push(`${ui('باقين بعد أول 3 ثواني','Still watching after 3 seconds')}: ${pct(hook)}`);
  if(half) lines.push(`${ui('نص المشاهدين طلعوا قبل','Half the viewers left before')} ${at(half[0])}`);
  if(unit==='%'&&v.c) lines.push(`${ui('كمّلوا الفيديو كامل','Watched the whole video')}: ${pct(100*v.c/v.v)}`);
  const dl=drop&&drop.d>0?`<line class="drop" x1="${X(pts[drop.i-1][0])}" y1="${Y(pts[drop.i-1][1])}" x2="${X(pts[drop.i][0])}" y2="${Y(pts[drop.i][1])}"/>`:'';
  return `<section class="scn"><h3>${ui('مشاهد الفيديو الأكثر تفاعل','Most engaging video moments')}</h3>
    <svg viewBox="0 0 ${W} ${H+18}" role="img" aria-label="${ui('نسبة اللي باقين يشوفون الفيديو','Share still watching')}"><line class="grid" x1="8" x2="${W-8}" y1="${Y(50)}" y2="${Y(50)}"/><polyline points="${pts.map(p=>`${X(p[0])},${Y(p[1])}`).join(' ')}"/>${dl}
      <text x="8" y="${H+14}" text-anchor="start">${unit==='s'?'0s':'0%'}</text><text x="${W-8}" y="${H+14}" text-anchor="end">${unit==='s'?maxX+'s':'100%'}</text></svg>
    <ul>${lines.map(l=>`<li>${l}</li>`).join('')}</ul>
    <span class="sub">${unit==='s'?ui('من منحنى ميتا: نسبة اللي باقين يشوفون عند كل ثانية','From Meta\'s curve: share still watching at each second'):ui('المنصة تعطي أرباع الفيديو بس، مو كل ثانية','This platform only reports video quarters, not each second')}</span>
  </section>`;
}
function openAd(k){
  const a=ADS[k], o=derive(cur.now.byAd[k]||{spend:0,impr:0,clicks:0,leads:0,conv:0,leadSpend:0,days:{}});
  const days=[]; for(let d=S.from; d<=S.to; d=addDays(d,1)) days.push(d);
  const vals=days.map(d=>(cur.now.byAd[k]?.days||{})[d]||0), max=niceMax(Math.max(...vals,0));
  const W=640,H=120,bw=W/days.length;
  let sp=`<svg viewBox="0 0 ${W} ${H+18}" role="img" aria-label="الصرف اليومي للإعلان"><line class="grid" x1="0" x2="${W}" y1="${H}" y2="${H}"/>`;
  vals.forEach((v,i)=>{ if(!v) return; const h=v/max*(H-6); const x=LANG==='en'?i*bw+1:W-(i+1)*bw+1; sp+=`<rect x="${x}" y="${H-h}" width="${Math.max(1,bw-2)}" height="${h}" rx="2" fill="var(${PL[a.platform].c})"><title>${nice(days[i])}: ${sar(v)} ${money()}</title></rect>`; });
  sp+= LANG==='en'
    ? `<text x="0" y="${H+14}" text-anchor="start">${nice(days[0])}</text><text x="${W}" y="${H+14}" text-anchor="end">${nice(days[days.length-1])}</text></svg>`
    : `<text x="${W}" y="${H+14}" text-anchor="end">${nice(days[0])}</text><text x="0" y="${H+14}" text-anchor="start">${nice(days[days.length-1])}</text></svg>`;
  $('#dlgBody').innerHTML = `
    <div class="panel-h"><h2 id="dlgTitle">${esc(a.name)}</h2><button type="button" class="btn" id="dlgClose">إغلاق</button></div>
    <div class="dlg-top">
      ${(()=>{ const m=mediaHTML(a, true), still=!/^<(video|iframe)/.test(m)&&creativeAction(a);
        return still ? `<div class="thumb zoom" data-view="1" role="button" tabindex="0" title="${ui('عرض المادة الإعلانية','View creative')}">${m}</div>` : `<div class="thumb">${m}</div>`; })()}
      <div style="display:grid;gap:8px;min-width:0">
        <div class="row">${platCell(a.platform)}${depCell(a.dept)}${goalPill(a.goal)}${liveBadge(a)}${winBadge(k)}${campTag(a)}${tiredTag(k)}${a.format?`<span class="pill">${esc(a.format)}</span>`:''}</div>
        <div class="sub">${tr('الحملة')}: ${esc(a.campaign)}<br>${tr('المجموعة')}: ${esc(a.group)}${(DEP[a.dept]&&!HIDDEN_DEPT.has(a.dept))?`<br>${tr('القسم')}: ${esc(depName(a.dept))} · ${a.dsrc==='ad'?tr('من اسم الإعلان'):a.dsrc==='campaign'?tr('من اسم الحملة'):tr('افتراضي')}`:''}</div>
        ${a.text?`<pre>${esc(a.text)}</pre>`:''}
        ${hookRow(a.vid)}
        <div class="row">${viewControl(a)}${previewLink(a)}</div>
      </div>
    </div>
    <div class="kv">
      <div><div class="k">الصرف</div><div class="mini">${sar(o.spend)} ${money()}</div></div>
      ${a.goal==='messages'&&!o.leads ? '' : `<div><div class="k">الليدز</div><div class="mini">${qty(o.leads)}</div></div>
      <div><div class="k">تكلفة الليد</div><div class="mini">${a.goal==='lead'?sar(o.cpl):'—'}</div></div>`}
      ${family(a.platform)==='meta' ? `<div><div class="k">محادثات</div><div class="mini">${fmt(o.conv)}</div></div>${a.goal==='messages'?`<div><div class="k">${ui('تكلفة المحادثة','Cost per chat')}</div><div class="mini">${o.conv?sar(o.spend/o.conv):'—'}</div></div>`:''}` : ''}
      <div><div class="k">الظهور</div><div class="mini">${fmt(o.impr)}</div></div>
      <div><div class="k">النقرات</div><div class="mini">${fmt(o.clicks)}</div></div>
      <div><div class="k">نسبة النقر</div><div class="mini">${pct(o.ctr)}</div></div>
      <div><div class="k">تكلفة النقرة</div><div class="mini">${sar(o.cpc)}</div></div>
      <div><div class="k">تكلفة الألف ظهور</div><div class="mini">${sar(o.cpm)}</div></div>
    </div>
    ${scenesBox(a)}
    ${audBox(a)}
    <div><div class="sub">الصرف اليومي في الفترة المختارة</div><div class="chart">${sp}</div></div>
    ${weekly(k)}`;
  const dlg=$('#dlg'); if(!dlg.open) dlg.showModal(); $('#dlgClose').onclick=()=>dlg.close();
  $('#dlgBody').onclick=e=>{ const d=e.target.closest('[data-aud-dim]'); if(d){ const box=d.closest('[data-aud-root]'); box.outerHTML=audBox(a, d.dataset.audDim); localize(); $(`[data-aud-dim="${d.dataset.audDim}"]`)?.focus(); return; }
    const v=e.target.closest('[data-view]'); if(!v || v.tagName==='A') return; e.preventDefault(); openCreative(a, k); };
  $('#dlgBody').onkeydown=e=>{ if((e.key==='Enter'||e.key===' ') && e.target.matches('.thumb[data-view]')){ e.preventDefault(); openCreative(a, k); } };
  localize();
}
$('#dlg').addEventListener('click',e=>{ if(e.target.id==='dlg') e.target.close(); });

