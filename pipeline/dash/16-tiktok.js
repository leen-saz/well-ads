// ---- TikTok: loaded live from the viewer's TikTok for Business connector, merged into D.ads / D.rows
const TT_SERVER = 'TikTok for Business';
const TT_STATUS = {AD_STATUS_DELIVERY_OK:'نشط', AD_STATUS_CAMPAIGN_DISABLE:'الحملة متوقفة', AD_STATUS_CAMPAIGN_EXCEED:'حد صرف الحملة خلص', AD_STATUS_BUDGET_EXCEED:'حد صرف المجموعة خلص'};
const TT_GOAL = {LEAD_GENERATION:'lead', WEB_CONVERSIONS:'lead', ENGAGEMENT:'profile', TRAFFIC:'traffic'};
let TT = {state:'loading', msg:'', retry:false, at:''};
const ttData = r => { let p=r&&(r.payload!=null?r.payload:(r.content&&r.content[0]&&r.content[0].text)); if(p&&typeof p==='object'&&!('data' in p)&&!('code' in p)&&typeof p.result==='string') p=p.result; if(typeof p==='string'){ try{p=JSON.parse(p);}catch(e){ throw {code:'tool_error',message:p}; } }
  if(p&&typeof p.code==='number'&&p.code!==0) throw {code:'tool_error',message:p.message||('TikTok '+p.code)}; return (p&&p.data)||p||{}; };
function ttError(e){
  const c=e&&e.code;
  if(c==='needs_reauth') return ['انتهى ربط الحساب، أعد ربط TikTok for Business من إعدادات claude.ai ← الموصّلات', false];
  if(c==='server_not_connected'||c==='selection_required') return ['الموصّل غير مضاف، أضف TikTok for Business من إعدادات claude.ai ← الموصّلات', false];
  if(c==='not_in_manifest'||c==='consent_required') return ['لم يُسمح للوحة بقراءة تيك توك، فعّله من قائمة الأذونات', false];
  if(c==='approval_required') return ['يحتاج موافقتك', true];
  if(c==='blocked_by_policy') return ['سياسة المؤسسة تمنع القراءة', false];
  if(e&&e.retryable) return ['تيك توك لا يستجيب الآن', true];
  return ['تعذّر التحميل'+(e&&e.message?': '+String(e.message).slice(0,200):''), true];
}
let ttMcp = null, ttBusy = false, ttStep = '';
const ttWait = ms => new Promise(r=>setTimeout(r,ms));
async function ttPool(tasks, n){ const out=new Array(tasks.length); let i=0;
  await Promise.all(Array.from({length:Math.min(n,tasks.length)},async()=>{ while(i<tasks.length){ const j=i++; out[j]=await tasks[j](); } })); return out; }
async function loadTikTok(fromClick){
  if(ttBusy) return; ttBusy = true;
  try{
    if(!ttMcp) ttMcp = window.claude && window.claude.use ? await window.claude.use('mcp') : null;
    if(!ttMcp){ const tp=(D.platforms||{}).tiktok;
      TT = tp&&tp.ok ? {state:'ok', snap:true, msg:'', retry:false, at:String(tp.synced_at||'').replace('T',' ').slice(5,16)}
                     : {state:'off', msg:'بيانات تيك توك غير متوفرة', retry:false, at:''};
      renderMeta(); buildFilters(); render(); return; }
    TT={state:'loading',msg:'',retry:false,at:''}; renderMeta();
    const opt = fromClick ? {cache:{refresh:true}} : {cache:{staleTime:300000}};
    const call = async (tool,input) => {
      try{ return ttData(await ttMcp.callTool(TT_SERVER,tool,input,opt)); }
      catch(e){ if(e&&(e.retryable||e.code==='upstream_error'||e.code==='server_unavailable')){ await ttWait((e.retryAfterMs||1500)+Math.random()*1000); return ttData(await ttMcp.callTool(TT_SERVER,tool,input,opt)); } throw e; }
    };
    const report = async (input) => { let out=[], page=1; for(;;){ const d=await call('report_integrated_get',{...input,page,page_size:200}); out=out.concat(d.list||[]); if(page>=((d.page_info||{}).total_page||1)) return out; page++; } };
    ttStep='الحساب';
    const advertisers = ((await call('auth_advertiser_get')).list||[]);
    const adv = advertisers.find(a=>a && !ttExcludedAccount(a.advertiser_id, a.advertiser_name||a.name));
    if(!adv) throw {code:'tool_error', message: advertisers.length ? 'حساب تيك توك المربوط مستبعد من اللوحة' : 'لا يوجد حساب إعلاني'};
    const A = adv.advertiser_id, ALL = [{field_name:'ad_status',filter_type:'IN',filter_value:'["STATUS_ALL"]'}];
    ttStep='الحملات'; const camps = await call('tool_execute',{tool_name:'campaign_get',params:{advertiser_id:A,page_size:1000,fields:['campaign_id','objective_type','operation_status']}});
    ttStep='المجموعات'; const groups = await call('tool_execute',{tool_name:'adgroup_get',params:{advertiser_id:A,page_size:1000,fields:['adgroup_id','operation_status']}});
    ttStep='الإعلانات'; const ads = await call('tool_execute',{tool_name:'ad_get',params:{advertiser_id:A,page_size:1000,exclude_field_types_in_response:['NULL_FIELD'],
        fields:['ad_id','ad_name','campaign_id','campaign_name','adgroup_id','adgroup_name','operation_status','secondary_status','tiktok_item_id','ad_text']}});
    ttStep='أسماء الإعلانات'; const life = await report({advertiser_id:A,report_type:'BASIC',data_level:'AUCTION_AD',dimensions:['ad_id'],metrics:['ad_name','campaign_name','campaign_id','adgroup_name','spend'],query_lifetime:true,filtering:ALL});
    const end = TODAY, wins=[]; for(let s=MIN; s<=end; s=addDays(s,30)){ const e=addDays(s,29); wins.push([s, e>end?end:e]); }
    ttStep='الأرقام اليومية';
    const days = await ttPool(wins.map(([s,e])=>()=>report({advertiser_id:A,report_type:'BASIC',data_level:'AUCTION_AD',dimensions:['ad_id','stat_time_day'],metrics:['spend','impressions','clicks','conversion'],start_date:s,end_date:e,filtering:ALL})), 2);
    const obj = {}, campOn = {}, groupOn = {};
    (camps.list||[]).forEach(c=>{ obj[c.campaign_id]=c.objective_type; campOn[c.campaign_id]=c.operation_status; });
    (groups.list||[]).forEach(g=>groupOn[g.adgroup_id]=g.operation_status);
    const ttThumb = {}; // the connector gives no cover, so keep the one embedded at build time
    for(const k of Object.keys(ADS)) if(ADS[k].platform==='tiktok'){ if(ADS[k].thumb) ttThumb[k]=ADS[k].thumb; delete ADS[k]; }
    D.rows = D.rows.filter(r=>!String(r[0]).startsWith('t'));
    const known = {};
    (ads.list||[]).forEach(a=>{ if(ttExcludedAd(a)) return; known[a.ad_id]=1;
      const live = a.operation_status==='ENABLE' && campOn[a.campaign_id]==='ENABLE' && groupOn[a.adgroup_id]==='ENABLE';
      const word = live ? 'نشط' : ((TT_STATUS[a.secondary_status] && TT_STATUS[a.secondary_status]!=='نشط') ? TT_STATUS[a.secondary_status] : 'متوقف');
      ADS['t'+a.ad_id] = stamp({platform:'tiktok', family:'tiktok', name:a.ad_name||a.ad_id, campaign:a.campaign_name||'', group:a.adgroup_name||'', format:'فيديو',
        status:word, live,
        text:a.ad_text||'', thumb:ttThumb['t'+a.ad_id]||null, link:a.tiktok_item_id?'https://www.tiktok.com/embed/v2/'+a.tiktok_item_id:null, goal:TT_GOAL[obj[a.campaign_id]]||'other'}); });
    life.forEach(r=>{ const id=r.dimensions.ad_id, m=r.metrics||{}; if(known[id] || ttExcludedAd(m)) return;
      ADS['t'+id] = stamp({platform:'tiktok', family:'tiktok', name:m.ad_name||id, campaign:m.campaign_name||'', group:m.adgroup_name||'', format:'فيديو', status:'محذوف', live:false,
        text:'', thumb:ttThumb['t'+id]||null, link:null, goal:TT_GOAL[obj[m.campaign_id]]||'lead'}); });
    let n=0;
    days.flat().forEach(r=>{ const m=r.metrics||{}, sp=Math.round(parseFloat(m.spend||0)*100)/100, im=parseInt(m.impressions||0,10);
      if(!sp && !im) return; const k='t'+r.dimensions.ad_id; if(!ADS[k]) return; n++;
      D.rows.push([k, String(r.dimensions.stat_time_day).slice(0,10), sp, im, parseInt(m.clicks||0,10), parseFloat(m.conversion||0), 0]); });
    TT = {state:'ok', msg:'', retry:false, at:new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})};
  }catch(e){
    console.error('[tiktok] failed at', ttStep, e);
    const [msg,retry] = ttError(e);
    TT = {state:'error', msg: `${msg} (المرحلة: ${ttStep}${e&&e.code?' · '+e.code:''})`, retry, at:''};
  }finally{ ttBusy=false; }
  renderMeta(); buildFilters(); render();
}

document.addEventListener('error', function(e){
  const el=e.target;
  if(!el || !el.dataset) return;
  if(el.dataset.media==='img'){
    const box=document.createElement('div');
    box.className='txt';
    box.textContent=el.getAttribute('alt')||'';
    el.replaceWith(box);
    return;
  }
  if(el.dataset.media==='video'){
    const poster=el.getAttribute('poster');
    if(poster){
      const img=document.createElement('img');
      img.src=poster; img.alt=''; img.dataset.media='img';
      el.replaceWith(img);
      return;
    }
    const box=document.createElement('div');
    box.className='txt';
    box.textContent='';
    el.replaceWith(box);
  }
}, true);
$('#lang').addEventListener('click',e=>{
  const b=e.target.closest('button'); if(!b) return;
  const v=b.dataset.v==='en'?'en':'ar';
  if(v===LANG) return;
  LANG=v; syncLangUrl(); render(); renderMeta();
});
document.addEventListener('keydown',e=>{
  if(e.key!=='Escape') return;
  const dlg=$('#dlg'); if(dlg&&dlg.open) return;
  const box=$('#filterOpen'); if(box&&box.checked) box.checked=false;
});
syncLangUrl();
buildFilters(); render(); renderMeta(); loadTikTok(false);
// The audience detail and organic posts after the first view (01-base.js)
loadExtra(render);
