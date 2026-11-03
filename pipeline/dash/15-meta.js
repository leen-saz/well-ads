// ---- header meta
const failedKeys = Object.entries(D.platforms||{}).filter(([,v])=>v&&!v.ok).map(([p])=>p);
function renderMeta(){
  const failed = failedKeys.map(p=>platName(p)).filter(Boolean);
  const tt = TT.state==='ok' ? ''
    : TT.state==='loading' ? `<span class="pill">تيك توك: جاري التحميل…</span>`
    : `<span class="pill warn">${tr('تيك توك')}: ${esc(tr(TT.msg))}</span>${TT.retry?` <button type="button" class="btn" id="ttRetry">تحميل تيك توك</button>`:''}`;
  // نفس صيغة التاريخ في كل الموقع: "28 أكتوبر، 15:10"
  const at = s => { try { return new Intl.DateTimeFormat(LANG==='en'?'en-GB':'ar-SA-u-nu-latn-ca-gregory',{timeZone:'Asia/Riyadh',day:'numeric',month:LANG==='en'?'short':'long',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(s)).replace(' في ','، '); } catch(e){ return s; } };
  // تيك توك يجي من روتين خارجي: لو تأخر أكثر من 6 ساعات ينقال بوضوح بدل ما يطلع "شغّال"
  const tp=(D.platforms||{}).tiktok||{}, lag=tp.synced_at ? (Date.now()-new Date(tp.synced_at))/36e5 : null;
  const late = lag!=null && lag>6 ? `<span class="pill warn">${ui(`بيانات تيك توك متأخرة ${Math.floor(lag)} ساعة`,`TikTok data is ${Math.floor(lag)}h late`)}</span>` : '';
  $('#metaLine').innerHTML = `<span>${ui('آخر تحديث للبيانات','Data updated')} <span class="num">${at(D.generated_at)}</span></span>`
    + tt + late + (failed.length?`<span class="pill warn">${tr('تعذّر تحديث')}: ${failed.join(ui('، ', ', '))}</span>`:'');
  const r=$('#ttRetry'); if(r) r.onclick=()=>loadTikTok(true);
  localize();
}

