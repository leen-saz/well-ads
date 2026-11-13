// ---- charts (stacked bars, one axis each)
function niceMax(v){ if(v<=0) return 1; const p=Math.pow(10,Math.floor(Math.log10(v))); const n=v/p; return (n<=1?1:n<=2?2:n<=2.5?2.5:n<=5?5:10)*p; }
function barX(L,iw,bw,i){ return LANG==='en' ? L+i*bw : L+iw-(i+1)*bw; }
function midX(L,iw,bw,i){ return LANG==='en' ? L+(i+.5)*bw : L+iw-(i+.5)*bw; }
function stacked(el,now,field,unit){
  const BK = buckets(now), days = BK.keys; now = {byDay:BK.byKey};
  const plats = orderNow();
  const W=640,H=230,L=8,R=46,T=10,B=26, iw=W-L-R, ih=H-T-B;
  const tot = days.map(d=>plats.reduce((s,p)=>s+((now.byDay[d]||{})[p]?.[field]||0),0));
  const max = niceMax(Math.max(...tot,0));
  const bw = iw/days.length, gap = Math.min(2,bw*.2), w=Math.max(1,bw-gap);
  const y = v => T+ih-(v/max)*ih;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${field==='spend'?'الصرف اليومي':'الليدز اليومية'}">`;
  for(let i=0;i<=4;i++){const v=max*i/4, yy=y(v); s+=`<line class="grid" x1="${L}" x2="${L+iw}" y1="${yy}" y2="${yy}"/><text x="${W-R+6}" y="${yy+4}" text-anchor="start">${fmt(v)}</text>`;}
  days.forEach((d,i)=>{
    const x = barX(L,iw,bw,i)+gap/2;
    let acc=0;
    plats.forEach((p,j)=>{ const v=(now.byDay[d]||{})[p]?.[field]||0; if(!v) return; const y0=y(acc), y1=y(acc+v); acc+=v;
      const h=Math.max(0,y0-y1-(acc>v?1:0)); s+=`<rect x="${x}" y="${y1}" width="${w}" height="${h}" rx="${Math.min(2,w/2)}" fill="var(${PL[p].c})"/>`; });
    s+=`<rect class="hit" data-i="${i}" x="${barX(L,iw,bw,i)}" y="${T}" width="${bw}" height="${ih}"><title>${BK.label(d)}</title></rect>`;
  });
  const step = Math.ceil(days.length/7);
  days.forEach((d,i)=>{ if(i%step===0||i===days.length-1){ const x=midX(L,iw,bw,i); s+=`<text x="${x}" y="${H-8}" text-anchor="middle">${BK.tick(d)}</text>`; }});
  s+=`</svg><div class="tip" hidden></div>`;
  el.innerHTML=s;
  const tip=el.querySelector('.tip');
  el.querySelectorAll('.hit').forEach(r=>{
    r.addEventListener('mousemove',ev=>{
      const d=days[+r.dataset.i];
      const span=BK.span(d);
      const rows=plats.map(p=>{ const open=dayOpen(family(p), span[0])||dayOpen(family(p), span[1]); const v=(now.byDay[d]||{})[p]?.[field]||0; return [p, open&&!v?null:v]; });
      const known=rows.filter(([,v])=>v!=null);
      const incomplete=known.length!==rows.length;
      const sum=known.reduce((s,[,v])=>s+v,0);
      const cell=v=> v==null ? '—' : (field==='spend'?sar(v):qty(v));
      const totalTxt = !known.length ? '—' : cell(sum)+(incomplete?' · '+ui('ناقص','incomplete'):'');
      tip.innerHTML=`<div class="t">${BK.label(d)}</div>`+rows.map(([p,v])=>`<div class="r"><span><span class="dot" style="background:var(${PL[p].c})"></span> ${platName(p)}</span><b>${cell(v)}</b></div>`).join('')+`<div class="r"><span>${tr('المجموع')}</span><b>${totalTxt}</b></div>`;
      tip.hidden=false; const bx=el.getBoundingClientRect(); let x=ev.clientX-bx.left+12, yy=ev.clientY-bx.top-10;
      if(x+170>bx.width) x=ev.clientX-bx.left-180; tip.style.left=Math.max(0,x)+'px'; tip.style.top=Math.max(0,yy)+'px';
    });
    r.addEventListener('mouseleave',()=>tip.hidden=true);
    r.addEventListener('click',()=>{ const d=days[+r.dataset.i]; const [f,t]=BK.span(d); S.from=clamp(f); S.to=t>TODAY?TODAY:t; S.preset=null; S.shown=24; render(); });
  });
}
function renderCharts(now){
  const plats = orderNow();
  $('#legend').innerHTML = plats.map(p=>`<span><span class="dot" style="background:var(${PL[p].c})"></span>${platName(p)}</span>`).join('');
  stacked($('#chSpend'),now,'spend'); stacked($('#chLeads'),now,'leads'); cplLine($('#chCpl'),now);
  const g=granOf();
  $('#chSpendT').textContent={day:'الصرف اليومي (ريال)',week:'الصرف الأسبوعي (ريال)',month:'الصرف الشهري (ريال)'}[g];
  $('#chLeadsT').textContent={day:'الليدز اليومية',week:'الليدز الأسبوعية',month:'الليدز الشهرية'}[g];
  document.querySelectorAll('#gran button').forEach(b=>b.setAttribute('aria-pressed',S.gran===b.dataset.v));
  localize();
}

