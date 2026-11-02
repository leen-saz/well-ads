// ---- aggregation
const ADS = D.ads;
// Google search ads have no creative to study, so the production page leaves them out entirely.
if(CREATIVE_ONLY){ for(const k of Object.keys(ADS)) if(family(ADS[k].platform)==='google') delete ADS[k]; D.rows=D.rows.filter(r=>ADS[r[0]]); }
// الكلمة والشارة من قاعدة واحدة: نشط فقط إذا سحب المنصة قال إن الإعلان ومجموعته وحملته كلها مفعّلة.
function alignDelivery(a){
  if(!a) return;
  if(a.live){ a.status='نشط'; return; }
  if(cleanStatus(a.status)==='نشط') a.status='متوقف';
}
Object.values(ADS).forEach(a=>{ stamp(a); alignDelivery(a); });
refreshOrder();
function passesStatus(a){
  if(!a) return false;
  if(S.stat==='live') return !!a.live;
  if(S.stat==='off') return !a.live;
  return true;
}
function matchesSlice(a){
  if(!a || !samePlat(a.platform)) return false;
  if(S.dept && a.dept!==S.dept) return false;
  if(!passesStatus(a)) return false;
  if(S.camp && a.platform+'|'+a.campaign!==S.camp) return false;
  if(S.goal && a.goal!==S.goal) return false;
  if(S.fmt && (a.format||'')!==S.fmt) return false;
  return true;
}
function coverEnd(fam){
  const info = (D.platforms||{})[fam] || {};
  if(/^\d{4}-\d{2}-\d{2}$/.test(info.coverage_end||'')) return info.coverage_end;
  if(fam==='tiktok'){
    const day = String(info.synced_at||'').slice(0,10);
    if(/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
    return null;
  }
  if(info.ok===false){
    const day = String(info.stale_from||'').slice(0,10);
    return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
  }
  return TODAY;
}
function activeFamilies(){
  const fams = new Set();
  for(const a of Object.values(ADS)){
    if(!a || HIDDEN_PLAT.has(a.platform)) continue;
    if(!samePlat(a.platform)) continue;
    if(S.dept && a.dept!==S.dept) continue;
    if(!passesStatus(a)) continue;
    if(S.camp && a.platform+'|'+a.campaign!==S.camp) continue;
    if(S.goal && a.goal!==S.goal) continue;
    if(S.fmt && (a.format||'')!==S.fmt) continue;
    fams.add(family(a.platform)||a.platform);
  }
  return fams;
}
function holesBetween(from, to){
  const bad = [];
  for(const fam of activeFamilies()){
    const end = coverEnd(fam);
    if(!end || to>end) bad.push(fam);
  }
  return bad;
}
function dayOpen(fam, day){
  const end = coverEnd(fam);
  return !end || day>end;
}
function applyStat(v){
  S.stat = v==='on'||v==='live' ? 'live' : v==='off' ? 'off' : 'all';
  S.wall = S.stat==='live' ? 'on' : S.stat==='off' ? 'off' : 'all';
  S.shown=24; save(); render();
}
function agg(from,to){
  const byAd = {}, byDay = {}, byPlat = {};
  for(const [k,date,sp,im,cl,ld,cv=0] of D.rows){
    if(date<from||date>to) continue;
    const a = ADS[k]; if(!matchesSlice(a)) continue;
    const lg = a.goal==='lead' ? sp : 0;
    const ln = a.goal==='lead' ? ld : 0;
    const o = byAd[k] ||= {spend:0,impr:0,clicks:0,leads:0,conv:0,leadSpend:0,leadN:0,days:{}};
    o.spend+=sp; o.impr+=im; o.clicks+=cl; o.leads+=ld; o.conv+=cv; o.leadSpend+=lg; o.leadN+=ln; o.days[date]=(o.days[date]||0)+sp;
    const d = byDay[date] ||= {}; const dp = d[a.platform] ||= {spend:0,leads:0,ls:0,ln:0}; dp.spend+=sp; dp.leads+=ld; dp.ls+=lg; dp.ln+=ln;
    const p = byPlat[a.platform] ||= {spend:0,impr:0,clicks:0,leads:0,conv:0,leadSpend:0,leadN:0,ads:new Set()}; p.spend+=sp;p.impr+=im;p.clicks+=cl;p.leads+=ld;p.conv+=cv;p.leadSpend+=lg;p.leadN+=ln;p.ads.add(k);
  }
  // CRM (pipeline/crm/join.py): leads matched to ads. A closing is a payment; its value is the amount paid.
  // Leads count on their own day; closings on the lead's day or on the payment day (S.crmBy), as Leen picks.
  const add = (k,f,v) => { const a = ADS[k]; if(!a || !matchesSlice(a)) return;
    const o = byAd[k] ||= {spend:0,impr:0,clicks:0,leads:0,conv:0,leadSpend:0,leadN:0,days:{}}; o[f]=(o[f]||0)+v;
    const p = byPlat[a.platform] ||= {spend:0,impr:0,clicks:0,leads:0,conv:0,leadSpend:0,leadN:0,ads:new Set()}; p[f]=(p[f]||0)+v; };
  for(const [k,leadDay,paidDay,paid,amount] of ((D.crm&&D.crm.rows)||[])){
    if(leadDay>=from && leadDay<=to) add(k,'crmLeads',1);
    const d = S.crmBy==='paid' ? paidDay : leadDay;
    if(paid && d && d>=from && d<=to){ add(k,'booked',1); add(k,'value',amount); }
  }
  const tot = {spend:0,impr:0,clicks:0,leads:0,conv:0,leadSpend:0,leadN:0,crmLeads:0,booked:0,paid:0,value:0};
  for(const p of Object.values(byPlat)){for(const f in tot) tot[f]+=(p[f]||0);}
  // Every paid lead in the CRM, with or without an ad (crm.paid_all: [lead_day, paid_day, amount, source]); ignores the ad filters
  tot.allPaidN=0; tot.allPaid=0;
  for(const [leadDay,paidDay,amount] of ((D.crm&&D.crm.paid_all)||[])){
    const d = S.crmBy==='paid' ? paidDay : leadDay;
    if(d && d>=from && d<=to){ tot.allPaidN++; tot.allPaid+=amount; }
  }
  return {byAd,byDay,byPlat,tot};
}
const derive = o => {
  const leadN = o.leadN==null ? o.leads : o.leadN;
  return {...o, cpb:o.booked?o.spend/o.booked:null, closeRate:o.crmLeads?100*(o.booked||0)/o.crmLeads:null, roas:o.spend&&o.value?o.value/o.spend:null,
    cpl:leadN?(o.leadSpend??o.spend)/leadN:null, cpm2:o.conv?o.spend/o.conv:null, ctr:o.impr?100*o.clicks/o.impr:null, cpc:o.clicks?o.spend/o.clicks:null, cpm:o.impr?1000*o.spend/o.impr:null};
};

