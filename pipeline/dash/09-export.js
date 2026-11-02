// ---- export: every ad in the current filters, with its totals for the period
function exportCSV(){
  const head=['المنصة','القسم','الحملة','المجموعة','الإعلان','الحالة','الهدف','الصيغة','من','إلى','الصرف (ر.س)','الظهور','النقرات','الليدز','المحادثات','تكلفة الليد','نسبة النقر %','تكلفة النقرة','تكلفة الألف ظهور'].map(tr);
  const q=v=>{ const t=v==null?'':String(v); return /[",\n]/.test(t)?'"'+t.replace(/"/g,'""')+'"':t; };
  const n=(v,d=2)=>v==null||!isFinite(v)?'':v.toFixed(d);
  const lines=[head.join(',')];
  Object.entries(cur.now.byAd).map(([k,o])=>({a:ADS[k],...derive(o)})).sort((x,y)=>y.spend-x.spend).forEach(x=>{ const a=x.a;
    lines.push([HIDDEN_PLAT.has(a.platform)?'':(platName(a.platform)||''),HIDDEN_DEPT.has(a.dept)?'':(depName(a.dept)||''),a.campaign,a.group,a.name,cleanStatus(a.status),goalName(a.goal),tr(a.format||''),S.from,S.to,
      n(x.spend),x.impr,x.clicks,(x.leads==null||!isFinite(x.leads)?'':String(Math.round(x.leads*100)/100)),n(x.conv,0),a.goal==='lead'?n(x.cpl):'',n(x.ctr),n(x.cpc),n(x.cpm)].map(q).join(',')); });
  const blob=new Blob(['﻿'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob), link=document.createElement('a');
  link.href=url; link.download=`well-ads_${S.from}_${S.to}${S.plat!=='all'?'_'+S.plat:''}.csv`; document.body.appendChild(link); link.click();
  setTimeout(()=>{ URL.revokeObjectURL(url); link.remove(); },1000);
}
$('#csv').addEventListener('click',exportCSV);
$('#tgt').value = TARGET||'';
$('#tgt').addEventListener('change',e=>{ const v=parseFloat(e.target.value); TARGET = v>0 ? v : null; try{ TARGET?localStorage.setItem('well-ads-target',TARGET):localStorage.removeItem('well-ads-target'); }catch(x){} render(); });

