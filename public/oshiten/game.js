

(()=>{
const sh=(hex,a)=>{const n=parseInt(hex.slice(1),16);const f=v=>Math.max(0,Math.min(255,Math.round(a<0?v*(1+a):v+(255-v)*a)));return'#'+((f(n>>16)<<16)|(f(n>>8&255)<<8)|f(n&255)).toString(16).padStart(6,'0')};
const mixc=(a,b,t)=>{const p=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));const A=p(a),B=p(b);return'#'+A.map((v,i)=>Math.round(v+(B[i]-v)*t).toString(16).padStart(2,'0')).join('')};
let UID=0;
function person(p){
  const u='q'+(UID++), cx=100, top=40, cw=p.cw, H=60*p.len, ch=top+H, ye=top+H*.5+p.eyeY, yn=ye+(ch-ye)*(p.nY||.5), ym=ye+(ch-ye)*(p.mY||.71), jw=p.jw, cq=p.chin;
  const nw=cw*p.neck, ys=ch+(p.nl||10), sw=p.sw, S=p.skin, SS=mixc(S,'#A8674E',.3), SD=mixc(S,'#6E3B2C',.5), C=p.cloth, CS=sh(C,-.18), CD=sh(C,-.36), Hc=p.hair, HL=sh(Hc,.22), HD=sh(Hc,-.3);
  const dp=p.dp||1, k1=(ch-ye)*(p.k1||.6), k2=jw*(p.k2||.8), sl=p.sl||0, eE=p.ear==null?.5:p.ear;
  const FACE=`M${cx},${top} C${cx+cw*.62},${top} ${cx+cw},${ye-22} ${cx+cw},${ye+1} C${cx+cw},${ye+1+k1} ${cx+k2},${ch} ${cx},${ch} C${cx-k2},${ch} ${cx-cw},${ye+1+k1} ${cx-cw},${ye+1} C${cx-cw},${ye-22} ${cx-cw*.62},${top} ${cx},${top}Z`;
  const CHEST=`M${cx-nw-4},${ys-1} C${cx-nw-13},${ys+1} ${cx-sw+17},${ys+3+p.shL+sl*.6} ${cx-sw+8},${ys+8+p.shL+sl} L${cx-sw+13},232 L${cx+sw-13},232 L${cx+sw-8},${ys+8+sl} C${cx+sw-17},${ys+3+sl*.6} ${cx+nw+13},${ys+1} ${cx+nw+4},${ys-1} Q${cx},${ys+7.5} ${cx-nw-4},${ys-1}Z`;
  const ARM=sd=>{const X=d=>cx+sd*d, k=(sd<0?p.shL:0)+sl*.9;return`M${X(sw-17)},${ys+5+k} C${X(sw-6)},${ys+5+k} ${X(sw+1)},${ys+11+k} ${X(sw+2)},${ys+25+k} L${X(sw+4)},232 L${X(sw-12)},232 L${X(sw-13)},${ys+39+k} C${X(sw-13)},${ys+25+k} ${X(sw-15)},${ys+12+k} ${X(sw-17)},${ys+5+k}Z`};
  const hh=p.h||172, zs=1+(hh-170)*.0022, zy=(182-hh)*.9-197*(1-zs);
  const o=[`<g transform="translate(0,${zy.toFixed(2)}) translate(${cx},232) scale(${zs.toFixed(4)}) translate(${-cx},-232)"><g class="who">`], R=n=>Math.round(n*100)/100;
  let sr=7+UID*13;const rnd=()=>{sr=(sr*9301+49297)%233280;return sr/233280};
  o.push(`<defs>
  <filter id="${u}b1" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.3"/></filter>
  <filter id="${u}b2" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="2.8"/></filter>
  <clipPath id="${u}f"><path d="${FACE}"/></clipPath>
  <clipPath id="${u}c"><path d="${CHEST}"/></clipPath>
  <clipPath id="${u}n"><path d="M${cx-nw},${ym-4} L${cx-nw-1.6},${ys+5} Q${cx},${ys+10} ${cx+nw+1.6},${ys+5} L${cx+nw},${ym-4}Z"/></clipPath>
  <clipPath id="${u}s"><rect x="0" y="0" width="200" height="${ys+54}"/></clipPath>
  <linearGradient id="${u}gf" x1="0" x2="1"><stop offset=".46" stop-color="${SD}" stop-opacity="0"/><stop offset="1" stop-color="${SD}" stop-opacity=".3"/></linearGradient>
  <linearGradient id="${u}gc" x1="0" x2="1"><stop offset="0" stop-color="${sh(C,.06)}"/><stop offset=".5" stop-color="${C}"/><stop offset="1" stop-color="${CS}"/></linearGradient>
  <linearGradient id="${u}gh" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${HL}"/><stop offset=".45" stop-color="${Hc}"/><stop offset="1" stop-color="${HD}"/></linearGradient>
  <linearGradient id="${u}gs" x1="0" x2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".2"/></linearGradient>
  </defs>`);
  o.push(`<g class="body" style="--d:${p.d}s">`);
  // 腕（胴とは別の塊）と胴
  const T=p.top, C2=p.c2||'#F2EFEA', IN=p.inn||'#F4F0EA', open=T==='cardigan'||T==='check'||T==='blazer';
  if(T==='hoodie')o.push(`<path d="M${cx-nw-10},${ys+5} C${cx-nw-10},${ys-7} ${cx-nw-3},${ys-10} ${cx},${ys-10} C${cx+nw+3},${ys-10} ${cx+nw+10},${ys-7} ${cx+nw+10},${ys+5} Q${cx},${ys+12} ${cx-nw-10},${ys+5}Z" fill="${CS}"/>`);
  o.push(`<defs><clipPath id="${u}a"><path d="${ARM(-1)} ${ARM(1)}"/></clipPath></defs>`);
  const pat=(clip)=>{let t='';
    if(T==='border'){for(let y=ys+9;y<232;y+=p.bw*2)t+=`<rect x="20" y="${R(y)}" width="160" height="${p.bw}" fill="${C2}" opacity=".92"/>`}
    if(T==='check'){for(let x=cx-66;x<cx+66;x+=9)t+=`<rect x="${x}" y="${ys-4}" width="3.2" height="150" fill="${C2}" opacity=".34"/>`;for(let y=ys+4;y<232;y+=9)t+=`<rect x="20" y="${y}" width="160" height="3.2" fill="${C2}" opacity=".34"/>`;for(let x=cx-63;x<cx+66;x+=9)t+=`<rect x="${x+3.6}" y="${ys-4}" width=".7" height="150" fill="${CD}" opacity=".4"/>`}
    return t?`<g clip-path="url(#${clip})">${t}</g>`:''};
  for(const sd of[-1,1]){
    const X=d=>cx+sd*d;
    if(p.short){o.push(`<path d="${ARM(sd)}" fill="${sd>0?mixc(S,SD,.22):S}"/><g clip-path="url(#${u}s)"><path d="${ARM(sd)}" fill="${sd>0?CS:C}"/>${sd>0?pat(u+'a'):''}</g><path d="M${X(sw-13.5)},${ys+54} L${X(sw+3.6)},${ys+54}" stroke="#000" stroke-opacity=".22" stroke-width="1.6" filter="url(#${u}b1)"/>`)}
    else o.push(`<path d="${ARM(sd)}" fill="${sd>0?CS:C}"/>${sd>0?pat(u+'a'):''}`);
    if(sd>0)o.push(`<path d="${ARM(sd)}" fill="#000" opacity="${T==='border'||T==='check'?.1:0}" clip-path="url(#${u}s)"/>`);
  }
  o.push(`<path d="${CHEST}" fill="url(#${u}gc)"/>`);
  o.push(`<g clip-path="url(#${u}c)">`);
  o.push(pat(u+'c'));
  if(T==='border'||T==='check')o.push(`<rect x="${cx}" y="${ys-4}" width="80" height="140" fill="url(#${u}gs)"/>`);
  if(open){
    const wd=T==='blazer'?9:4;
    o.push(`<path d="M${cx-nw-2.5},${ys} L${cx-wd},232 L${cx+wd},232 L${cx+nw+2.5},${ys} Q${cx},${ys+8} ${cx-nw-2.5},${ys}Z" fill="${IN}"/><path d="M${cx-nw-2.5},${ys} L${cx-wd},232 M${cx+nw+2.5},${ys} L${cx+wd},232" stroke="${CD}" stroke-opacity=".5" stroke-width="1.2" filter="url(#${u}b1)" fill="none"/>`);
    if(p.collarIn){o.push(`<path d="M${cx-nw-2.5},${ys} Q${cx-nw-3},${ys+9} ${cx-3.5},${ys+13} L${cx},${ys+7.5} L${cx+3.5},${ys+13} Q${cx+nw+3},${ys+9} ${cx+nw+2.5},${ys} Q${cx},${ys+8} ${cx-nw-2.5},${ys}Z" fill="${sh(IN,.5)}"/><path d="M${cx-3.5},${ys+13} L${cx},${ys+7.5} L${cx+3.5},${ys+13}" stroke="${sh(IN,-.3)}" stroke-width=".6" fill="none"/>`);for(let k=0;k<4;k++)o.push(`<circle cx="${cx}" cy="${ys+24+k*17}" r="1.1" fill="${sh(IN,-.2)}"/>`)}
    else o.push(`<path d="M${cx-nw-3},${ys-.4} Q${cx},${ys+8} ${cx+nw+3},${ys-.4}" fill="none" stroke="${sh(IN,-.12)}" stroke-width="2.4" transform="translate(0,1.2)"/>`);
    if(T==='check')for(const sd of[-1,1]){const X=d=>cx+sd*d, q=`M${X(nw+1.6)},${ys-1.6} L${X(nw+11)},${ys+3.5} L${X(nw+5)},${ys+20} L${X(nw+1.4)},${ys+11}Z`;o.push(`<path d="${q}" fill="#000" opacity=".22" transform="translate(0,1.6)" filter="url(#${u}b1)"/><path d="${q}" fill="${sh(C,.14)}"/><path d="M${X(nw+11)},${ys+3.5} L${X(nw+5)},${ys+20} L${X(nw+1.4)},${ys+11}" stroke="${CD}" stroke-opacity=".5" stroke-width=".6" fill="none"/>`)}
    if(T==='blazer')for(const sd of[-1,1]){const X=d=>cx+sd*d;o.push(`<path d="M${X(nw+1.5)},${ys-1.5} L${X(nw+11)},${ys+3} L${X(nw+7)},${ys+19} L${X(nw+11)},${ys+23} L${X(8.2)},${ys+58} L${X(nw+2.4)},${ys+3}Z" fill="${sh(C,-.08)}"/><path d="M${X(nw+11)},${ys+3} L${X(nw+7)},${ys+19} L${X(nw+11)},${ys+23} L${X(8.2)},${ys+58}" stroke="${CD}" stroke-opacity=".5" stroke-width=".7" fill="none"/>`)}
  }else if(T==='shirt'||T==='polo'||T==='blouse'){
    const cc=T==='blouse'?sh(C,.4):sh(C,.16), len=T==='polo'?26:140;
    o.push(`<path d="M${cx-nw-2},${ys-.6} Q${cx},${ys+8.5} ${cx+nw+2},${ys-.6} L${cx+2.2},${ys+12} L${cx-2.2},${ys+12}Z" fill="${mixc(S,SD,.25)}"/>`);
    o.push(`<path d="M${cx},${ys+11} V${ys+len}" stroke="${CD}" stroke-opacity=".4" stroke-width=".8"/><path d="M${cx-2.4},${ys+11} V${ys+len} M${cx+2.4},${ys+11} V${ys+len}" stroke="${CD}" stroke-opacity=".14" stroke-width=".6"/>`);
    for(let k=0;k<(T==='polo'?2:5);k++)o.push(`<circle cx="${cx}" cy="${ys+17+k*(T==='polo'?7:16)}" r="1" fill="${sh(C,.35)}" stroke="${CD}" stroke-opacity=".4" stroke-width=".3"/>`);
    for(const sd of[-1,1]){const X=d=>cx+sd*d;
      if(T==='blouse')o.push(`<path d="M${X(nw+2)},${ys-1.2} C${X(nw+11)},${ys+1} ${X(nw+10)},${ys+12} ${X(2.4)},${ys+13} L${X(1.6)},${ys+8.6} Q${X(nw-1)},${ys+6} ${X(nw+2)},${ys-1.2}Z" fill="${cc}"/><path d="M${X(nw+2)},${ys-1.2} C${X(nw+11)},${ys+1} ${X(nw+10)},${ys+12} ${X(2.4)},${ys+13}" stroke="${CD}" stroke-opacity=".3" stroke-width=".6" fill="none"/>`);
      else o.push(`<path d="M${X(nw+1.6)},${ys-1.6} L${X(nw+10.5)},${ys+4} L${X(3.4)},${ys+18} L${X(1.2)},${ys+9.5} Q${X(nw-1)},${ys+6} ${X(nw+1.6)},${ys-1.6}Z" fill="#000" opacity=".22" transform="translate(0,1.6)" filter="url(#${u}b1)"/><path d="M${X(nw+1.6)},${ys-1.6} L${X(nw+10.5)},${ys+4} L${X(3.4)},${ys+18} L${X(1.2)},${ys+9.5} Q${X(nw-1)},${ys+6} ${X(nw+1.6)},${ys-1.6}Z" fill="${cc}"/><path d="M${X(nw+10.5)},${ys+4} L${X(3.4)},${ys+18} L${X(1.2)},${ys+9.5}" stroke="${CD}" stroke-opacity=".55" stroke-width=".6" fill="none"/>`)}
  }else{
    const band=T==='knit'?4.6:(T==='hoodie'?3.6:2.8);
    o.push(`<path d="M${cx-nw-4},${ys-1} Q${cx},${ys+7.5} ${cx+nw+4},${ys-1}" fill="none" stroke="${sh(C,-.1)}" stroke-width="${band}" transform="translate(0,${band/2})"/><path d="M${cx-nw-5},${ys+band} Q${cx},${ys+8.5+band} ${cx+nw+5},${ys+band}" fill="none" stroke="${CD}" stroke-opacity=".35" stroke-width="1" filter="url(#${u}b1)"/>`);
    if(T==='knit'){for(const x of[-30,-20,-10,0,10,20,30])o.push(`<path d="M${cx+x},${ys+16} V232" stroke="${CD}" stroke-opacity=".13" stroke-width="1.6"/>`)}
    if(T==='hoodie')o.push(`<path d="M${cx-4.5},${ys+7.5} q-1.2,14 .6,26 M${cx+4.5},${ys+7.5} q1.2,13 -.4,22" stroke="${sh(C,.45)}" stroke-width="1.1" fill="none" stroke-linecap="round"/><path d="M${cx-4.5},${ys+7.5} q-1.2,14 .6,26 M${cx+4.5},${ys+7.5} q1.2,13 -.4,22" stroke="${CD}" stroke-opacity=".35" stroke-width="1.1" fill="none" transform="translate(.8,.6)" filter="url(#${u}b1)"/>`);
    const py=ys+44, PC=p.pc||'#fff';
    if(p.print===1)o.push(`<circle cx="${cx+sw*.3}" cy="${ys+24}" r="4.2" fill="${PC}" opacity=".9"/><circle cx="${cx+sw*.3}" cy="${ys+24}" r="2.2" fill="none" stroke="${C}" stroke-width=".8"/>`);
    if(p.print===2)o.push(`<circle cx="${cx}" cy="${py}" r="13" fill="none" stroke="${PC}" stroke-width="2.4" opacity=".9"/><circle cx="${cx}" cy="${py}" r="7.5" fill="${PC}" opacity=".9"/>`);
    if(p.print===3)o.push(`<g fill="${PC}" opacity=".88"><rect x="${cx-17}" y="${py-10}" width="34" height="4.2" rx="1"/><rect x="${cx-12}" y="${py-2.5}" width="24" height="2.6" rx="1"/><rect x="${cx-15}" y="${py+3.5}" width="30" height="2.6" rx="1"/><rect x="${cx-8}" y="${py+9.5}" width="16" height="2.6" rx="1"/></g>`);
    if(p.print===4)o.push(`<rect x="${cx-15}" y="${py-14}" width="30" height="34" rx="1.6" fill="${PC}" opacity=".9"/><rect x="${cx-12.4}" y="${py-11.4}" width="24.8" height="21" fill="${mixc(C,'#777',.5)}" opacity=".8"/><rect x="${cx-9}" y="${py+12.6}" width="18" height="2.2" fill="${C}" opacity=".6"/>`);
    if(p.print===5)o.push(`<path d="M${cx},${py-13} l3.6,8.6 9.2,.8 -7,6.1 2.2,9 -8,-4.9 -8,4.9 2.2,-9 -7,-6.1 9.2,-.8Z" fill="${PC}" opacity=".9"/>`);
    if(p.print===6)o.push(`<g fill="${PC}" opacity=".9"><rect x="${cx-20}" y="${py-4}" width="40" height="1.6"/><rect x="${cx-20}" y="${py+6}" width="40" height="1.6"/><path d="M${cx},${py-2} l4,3 -4,3 -4,-3Z"/><rect x="${cx-16}" y="${py+.2}" width="9" height="1.6"/><rect x="${cx+7}" y="${py+.2}" width="9" height="1.6"/></g>`);
  }
  // 頭が落とす影、服のしわ、肩の縫い目
  o.push(`<ellipse cx="${cx+2}" cy="${ys+7}" rx="${nw+11}" ry="5.5" fill="#000" opacity=".16" filter="url(#${u}b2)"/>`);
  o.push(`<path d="M${cx-sw+15},${ys+42} Q${cx-sw+25},${ys+52} ${cx-sw+31},${ys+70} M${cx+sw-15},${ys+42} Q${cx+sw-25},${ys+52} ${cx+sw-31},${ys+70} M${cx-sw+16},${ys+62} Q${cx-sw+24},${ys+70} ${cx-sw+26},${ys+86} M${cx+sw-16},${ys+62} Q${cx+sw-24},${ys+70} ${cx+sw-26},${ys+86}" stroke="${CD}" stroke-opacity=".17" stroke-width="2.2" fill="none" stroke-linecap="round" filter="url(#${u}b1)"/>`);
  o.push(`<path d="M${cx-sw+18},${ys+6+p.shL} Q${cx-sw+13.5},${ys+20} ${cx-sw+13},${ys+38} M${cx+sw-18},${ys+6} Q${cx+sw-13.5},${ys+20} ${cx+sw-13},${ys+38}" stroke="${CD}" stroke-opacity=".28" stroke-width=".8" fill="none"/>`);
  o.push(`</g>`);
  // 脇のすき間の影
  o.push(`<path d="M${cx-sw+12.6},${ys+40} L${cx-sw+12.6},232 M${cx+sw-12.6},${ys+40} L${cx+sw-12.6},232" stroke="#000" stroke-opacity=".2" stroke-width="1.4" filter="url(#${u}b1)"/>`);
  // 後ろ髪（肩にかかる）
  if(p.hl==='chin')o.push(`<path d="M${cx-cw-4.6},${ye+4} L${cx-cw-4},${ch-1} Q${cx},${ch+7} ${cx+cw+4},${ch-1} L${cx+cw+4.6},${ye+4}Z" fill="${HD}"/>`);
  if(p.tail){const sd=p.flip?-1:1,X=d=>cx+sd*d;o.push(`<path d="M${X(nw-1)},${ch-8} C${X(cw+5)},${ch-6} ${X(cw+6)},${ys+2} ${X(cw+1)},${ys+12} Q${X(cw-1)},${ys+15} ${X(cw-3)},${ys+11} C${X(cw-1)},${ys+2} ${X(nw+3)},${ch+2} ${X(nw-1)},${ch-2}Z" fill="${HD}"/>`)}
  if(p.bl)for(const sd of[-1,1]){const X=d=>cx+sd*d, L=ys+p.bl+(sd<0?2:-2);o.push(`<path d="M${X(cw+5)},${ye-2} C${X(cw+6.6)},${ye+24} ${X(cw+6.4)},${ch+8} ${X(cw+4.6)},${L-5} Q${X(cw+4)},${L-.6} ${X(cw+2.6)},${L} Q${X(cw+1.8)},${L-1.2} ${X(cw+1)},${L-.6} Q${X(cw)},${L+1.2} ${X(cw-1.4)},${L+1} Q${X(cw-2.2)},${L-.8} ${X(cw-3)},${L-.4} Q${X(cw-4)},${L+.2} ${X(cw-4.8)},${L-1.6} C${X(cw-7)},${L-10} ${X(nw+2.5)},${ch+6} ${X(nw+1)},${ch-6} L${X(cw-2)},${ye+4}Z" fill="${HD}"/><path d="M${X(cw+3.6)},${ye+12} C${X(cw+5)},${ye+28} ${X(cw+4.4)},${ch+8} ${X(cw+2.6)},${L-3} M${X(cw+1)},${ye+18} C${X(cw+2)},${ch} ${X(cw+1)},${ch+8} ${X(cw-.8)},${L-1} M${X(cw-2)},${ch} C${X(cw-1.6)},${ch+6} ${X(cw-2.4)},${ch+12} ${X(cw-3.2)},${L-4}" stroke="${Hc}" stroke-opacity=".6" stroke-width=".6" fill="none" stroke-linecap="round"/>`)}
  // 首（顔幅の6〜7割）とあご下の影
  o.push(`<path d="M${cx-nw},${ym-4} L${cx-nw-1.6},${ys+5} Q${cx},${ys+10} ${cx+nw+1.6},${ys+5} L${cx+nw},${ym-4}Z" fill="${S}"/>`);
  o.push(`<path d="M${cx-nw-.4},${ym-2} L${cx-nw-1},${ch+1.5} Q${cx},${ch+9.5} ${cx+nw+1},${ch+1.5} L${cx+nw+.4},${ym-2}Z" fill="${SD}" opacity=".3" filter="url(#${u}b1)" clip-path="url(#${u}n)"/>`);
  o.push(`</g>`);
  // 頭
  o.push(`<g class="head" style="--d:${p.d}s;--t:${p.tilt}deg;transform-origin:${cx}px ${ch+2}px">`);
  const ey=(ye+yn)/2+.5;
  for(const sd of[-1,1])o.push(`<path d="M${cx+sd*(cw-.6)},${ey-5.6} C${cx+sd*(cw+1.3+eE)},${ey-6.6} ${cx+sd*(cw+1.6+eE)},${ey+2} ${cx+sd*(cw+.9+eE*.4)},${ey+5.4} L${cx+sd*(cw-1)},${ey+4.6}Z" fill="${sd>0?mixc(S,SD,.3):mixc(S,SS,.5)}"/><path d="M${cx+sd*(cw+.4)},${ey-3.6} q${sd*(.8+eE*.5)},2 ${sd*.3},5" stroke="${SD}" stroke-opacity=".45" stroke-width=".7" fill="none"/>`);
  o.push(`<path d="${FACE}" fill="${S}"/>`);
  o.push(`<g clip-path="url(#${u}f)"><rect x="${cx-cw-2}" y="${top}" width="${cw*2+4}" height="${H+2}" fill="url(#${u}gf)"/>`);
  o.push(`<ellipse cx="${cx-cw*.52}" cy="${yn+.5}" rx="6" ry="4.2" fill="#D9806E" opacity="${p.female?.2:.12}" filter="url(#${u}b2)"/><ellipse cx="${cx+cw*.52}" cy="${yn+.5}" rx="6" ry="4.2" fill="#D9806E" opacity="${p.female?.2:.12}" filter="url(#${u}b2)"/>`);
  o.push(`<path d="M${cx-jw-3},${ym+2} Q${cx},${ch+1} ${cx+jw+3},${ym+2} L${cx+jw+3},${ch+4} L${cx-jw-3},${ch+4}Z" fill="${SD}" opacity=".16" filter="url(#${u}b1)"/>`);
  for(const sd of[-1,1])o.push(`<ellipse cx="${cx+sd*p.ex}" cy="${ye-1.4}" rx="${p.ea+2.8}" ry="4" fill="${SD}" opacity="${p.sock||.3}" filter="url(#${u}b1)"/><ellipse cx="${cx+sd*cw*.8}" cy="${yn+3}" rx="4.4" ry="9" fill="${SD}" opacity="${R((sd>0?.19:.12)*dp)}" filter="url(#${u}b2)"/><ellipse cx="${cx+sd*cw*.86}" cy="${ye-13}" rx="3.4" ry="7" fill="${SD}" opacity="${R(.14*dp)}" filter="url(#${u}b2)"/>`);
  o.push(`<ellipse cx="${cx-3}" cy="${ye-14}" rx="${cw*.5}" ry="5" fill="#fff" opacity=".13" filter="url(#${u}b2)"/><ellipse cx="${cx-cw*.42}" cy="${ye+5.5}" rx="4.6" ry="2.6" fill="#fff" opacity=".1" filter="url(#${u}b2)"/>`);
  if(p.bags)for(const sd of[-1,1])o.push(`<ellipse cx="${cx+sd*p.ex}" cy="${ye+4.3}" rx="${p.ea+1.2}" ry="1.7" fill="${SD}" opacity="${p.female?.2:.3}" filter="url(#${u}b1)"/><path d="M${cx+sd*(p.ex-p.ea)},${ye+4.6} q${sd*p.ea},2.4 ${sd*(p.ea*2+.6)},.2" stroke="${SD}" stroke-opacity=".3" stroke-width=".6" fill="none"/>`);
  if(p.old){
    o.push(`<path d="M${cx-p.nw-1.8},${yn-1} Q${cx-p.mw-3},${ym-2} ${cx-p.mw-1.6},${ym+2.6} M${cx+p.nw+1.8},${yn-1} Q${cx+p.mw+3},${ym-2} ${cx+p.mw+1.6},${ym+2.6}" stroke="${SD}" stroke-opacity=".55" stroke-width="1.5" fill="none" stroke-linecap="round" filter="url(#${u}b1)"/>`);
    o.push(`<path d="M${cx-p.ex-p.ea+.6},${ye+3.4} q${p.ea},2 ${p.ea*2-1},.2 M${cx+p.ex-p.ea+.4},${ye+3.4} q${p.ea},2 ${p.ea*2-1},.2 M${cx-9},${ye-15} q9,-1.6 18,0 M${cx-7},${ye-18.6} q7,-1.2 14,0" stroke="${SD}" stroke-opacity=".34" stroke-width=".9" fill="none" stroke-linecap="round" filter="url(#${u}b1)"/>`);
  }
  o.push(`</g>`);
  let stubJ='';
  if(p.stubble){
    const sc='#4E4A47', dots=(n,x0,x1,y0,y1)=>{let t='';for(let i=0;i<n;i++){const x=x0+rnd()*(x1-x0), y=y0+rnd()*(y1-y0);t+=`<circle cx="${R(x)}" cy="${R(y)}" r="${R(.09+rnd()*.09)}" fill="${rnd()<.3?'#A9A49E':sc}" opacity="${R(.3+rnd()*.25)}"/>`}return t};
    stubJ=`<path d="M${cx-jw-2},${ym} Q${cx-jw},${ch-1} ${cx},${ch+1} Q${cx+jw},${ch-1} ${cx+jw+2},${ym} Q${cx+jw-3},${ym+4} ${cx+p.mw+2},${ym+3.2} Q${cx},${ym+5.5} ${cx-p.mw-2},${ym+3.2} Q${cx-jw+3},${ym+4} ${cx-jw-2},${ym}Z" fill="${sc}" opacity=".13" filter="url(#${u}b2)"/>`+dots(260,cx-jw-1,cx+jw+1,ym+2.6,ch);
    o.push(`<g clip-path="url(#${u}f)"><path d="M${cx-p.mw-2.5},${ym+.5} Q${cx-p.mw-1},${yn+2.2} ${cx},${yn+2.6} Q${cx+p.mw+1},${yn+2.2} ${cx+p.mw+2.5},${ym+.5} Q${cx},${ym-2} ${cx-p.mw-2.5},${ym+.5}Z" fill="${sc}" opacity=".13" filter="url(#${u}b2)"/>${dots(80,cx-p.mw-1.5,cx+p.mw+1.5,yn+2.4,ym-.6)}</g>`);
  }
  o.push(`<defs><clipPath id="${u}j"><rect x="${cx-cw-4}" y="${ym}" width="${cw*2+8}" height="${H}"/></clipPath></defs>`);
  o.push(`<g class="jaw" style="transform-origin:${cx}px ${ym}px"><g clip-path="url(#${u}j)"><path d="${FACE}" fill="${S}"/><g clip-path="url(#${u}f)"><rect x="${cx-cw-2}" y="${top}" width="${cw*2+4}" height="${H+2}" fill="url(#${u}gf)"/><path d="M${cx-jw-3},${ym+2} Q${cx},${ch+1} ${cx+jw+3},${ym+2} L${cx+jw+3},${ch+4} L${cx-jw-3},${ch+4}Z" fill="${SD}" opacity=".16" filter="url(#${u}b1)"/>${stubJ}</g></g></g>`);
  // 目（小さい黒目・線ではなく影のふち）
  for(const sd of[-1,1]){
    const x=cx+sd*p.ex, y=ye+(sd>0?p.asym:0), a=p.ea*1.12, eo=p.eo*1.2, ti=p.eti, id=u+(sd<0?'l':'r');
    const upper=`M${x-sd*a},${y+.35} Q${x-sd*.7},${y-eo*2} ${x+sd*a},${y+ti}`;
    const shape=`${upper} Q${x+sd*.5},${y+(p.lo||1.9)} ${x-sd*a},${y+.35}Z`;
    o.push(`<defs><clipPath id="${id}"><path d="${shape}"/></clipPath></defs><path d="${shape}" fill="#EFE9E3"/>`);
    o.push(`<g clip-path="url(#${id})"><g class="ir"><circle cx="${x}" cy="${y-.25}" r="${a*(p.ir||.43)}" fill="${p.iris}"/><circle cx="${x}" cy="${y-.25}" r="${p.ir?a*p.ir*.47:a*.2}" fill="#140E0C"/><circle cx="${x-.7}" cy="${y-1}" r="${p.ir?.8:.42}" fill="#fff" opacity=".85"/></g><path d="${upper}" stroke="#000" stroke-opacity=".28" stroke-width="1.8" fill="none"/></g>`);
    o.push(`<path d="${upper}" stroke="#2C201C" stroke-width="${p.female?1.2:.95}" fill="none" stroke-linecap="round"/>`);
    o.push(`<path d="M${x-sd*(a-.8)},${y-eo-1} Q${x-sd*.4},${y-eo*2-1.3} ${x+sd*(a-.2)},${y+ti-1.2}" stroke="${SD}" stroke-opacity="${p.dbl===0?0:.62}" stroke-width=".6" fill="none" stroke-linecap="round"/><path d="M${x-sd*a*.8},${y+1.7} Q${x},${y+2.9} ${x+sd*a*.85},${y+1.5}" stroke="${SD}" stroke-opacity=".34" stroke-width=".5" fill="none" stroke-linecap="round"/>`);
    o.push(`<ellipse class="lid" style="--b:${p.d*1.9}s" cx="${x}" cy="${y-.2}" rx="${a+.9}" ry="${eo+1.5}" fill="${mixc(S,SD,.12)}"/>`);
    const by=y-eo-4.4+(sd>0?p.browAs:0)-(p.browY||0), th=p.browTh, ar=p.browAr, ix=x-sd*(a+1.4), ox=x+sd*(a+2);
    o.push(`<path d="M${ix},${by-th*.45} Q${x},${by-th*.5-ar} ${ox},${by+p.browTail} Q${x},${by+th*.5-ar*.7} ${ix},${by+th*.55}Z" fill="${p.brow}" opacity=".88"/>`);
  }
  // 鼻（線なし・影で）
  o.push(`<path d="M${cx+.9},${ye+1.5} L${cx+p.nw*.95+.8},${yn-2.6} L${cx+.5},${yn-2}Z" fill="${SD}" opacity="${R(Math.min(.8,.44*dp))}" filter="url(#${u}b1)"/><path d="M${cx+.6},${ye-2} L${cx+p.nw*.5+.8},${yn-3} L${cx+.2},${yn-3}Z" fill="${SD}" opacity=".2"/><ellipse cx="${cx-.7}" cy="${yn-2.7}" rx="1.3" ry="1.9" fill="#fff" opacity=".2" filter="url(#${u}b1)"/><path d="M${cx-p.nw-.6},${yn+.2} Q${cx},${yn+3.6} ${cx+p.nw+.9},${yn+.2} Q${cx},${yn+1.6} ${cx-p.nw-.6},${yn+.2}Z" fill="${SD}" opacity=".3" filter="url(#${u}b1)"/>`);
  o.push(`<ellipse cx="${cx-p.nw-.5}" cy="${yn-1.3}" rx="1.1" ry="1.9" fill="${SD}" opacity=".3" filter="url(#${u}b1)"/><ellipse cx="${cx+p.nw+.5}" cy="${yn-1.3}" rx="1.3" ry="2" fill="${SD}" opacity=".4" filter="url(#${u}b1)"/>`);
  o.push(`<path d="M${cx-p.nw},${yn-.5} Q${cx},${yn+2.5} ${cx+p.nw},${yn-.5} Q${cx},${yn+.7} ${cx-p.nw},${yn-.5}Z" fill="${SD}" opacity=".55"/><ellipse cx="${cx-p.nw*.55}" cy="${yn+.25}" rx=".95" ry=".5" fill="#4A2C24" opacity=".6"/><ellipse cx="${cx+p.nw*.55}" cy="${yn+.25}" rx=".95" ry=".5" fill="#4A2C24" opacity=".6"/>`);
  // 口（ふだんは閉じている）
  const lipU=p.female?mixc(S,'#B45A5E',.62):mixc(S,'#9A5A50',.5), lipL=sh(lipU,.14), lipD=mixc(lipU,'#3A1C1C',.6), mw=p.mw, lf=p.lf, cA=p.cA, cB=p.cB;
  const lipTop=(dy)=>`M${cx-mw},${ym+cA+dy} Q${cx-mw*.45},${ym-1.5*lf+dy} ${cx-.9},${ym-1.15*lf+dy} Q${cx},${ym-.7*lf+dy} ${cx+.9},${ym-1.15*lf+dy} Q${cx+mw*.45},${ym-1.5*lf+dy} ${cx+mw},${ym+cB+dy}`;
  o.push(`<ellipse cx="${cx}" cy="${ym+3.4*lf+1.6}" rx="${mw*.62}" ry="1.5" fill="${SD}" opacity=".46" filter="url(#${u}b1)"/>`);
  o.push(`<g class="ms"><path d="M${cx-mw*.86},${ym+.5} Q${cx},${ym+1.1} ${cx+mw*.86},${ym+.5} Q${cx},${ym+3.5*lf} ${cx-mw*.86},${ym+.5}Z" fill="${lipL}"/><path d="${lipTop(0)} Q${cx},${ym+1} ${cx-mw},${ym+cA}Z" fill="${lipU}"/><path d="M${cx-mw},${ym+cA} Q${cx},${ym+1.1} ${cx+mw},${ym+cB}" stroke="${lipD}" stroke-opacity=".6" stroke-width=".5" fill="none" stroke-linecap="round"/><ellipse cx="${cx-mw-.3}" cy="${ym+cA+.3}" rx="1.1" ry=".9" fill="${SD}" opacity=".4" filter="url(#${u}b1)"/><ellipse cx="${cx+mw+.3}" cy="${ym+cB+.3}" rx="1.1" ry=".9" fill="${SD}" opacity=".45" filter="url(#${u}b1)"/></g>`);
  if(p.grin)o.push(`<g class="ms"><path d="M${cx-mw-.8},${ym+cA+.2} Q${cx},${ym+1.4} ${cx+mw+.8},${ym+cB+.2} Q${cx},${ym+8.4} ${cx-mw-.8},${ym+cA+.2}Z" fill="#54202A"/><path d="M${cx-mw*.88},${ym+cA*.5+.4} Q${cx},${ym+1.5} ${cx+mw*.88},${ym+cB*.5+.4} Q${cx},${ym+4.6} ${cx-mw*.88},${ym+cA*.5+.4}Z" fill="#F0EBE4"/><path d="M${cx-mw*.72},${ym+3.4} Q${cx},${ym+6.6} ${cx+mw*.72},${ym+3.4} Q${cx},${ym+8.8} ${cx-mw*.72},${ym+3.4}Z" fill="${lipL}"/><path d="${lipTop(0)} Q${cx},${ym+1.5} ${cx-mw},${ym+cA}Z" fill="${lipU}"/></g>`);
  if(p.exp==='smile'||p.grin)o.push(`<g clip-path="url(#${u}f)"><path d="M${cx-p.nw-2},${yn} Q${cx-mw-3.4},${ym-2.5} ${cx-mw-2},${ym+2.4} M${cx+p.nw+2},${yn} Q${cx+mw+3.4},${ym-2.5} ${cx+mw+2},${ym+2.4}" stroke="${SD}" stroke-opacity=".34" stroke-width="1.3" fill="none" stroke-linecap="round" filter="url(#${u}b1)"/><ellipse cx="${cx-cw*.5}" cy="${yn+1}" rx="5" ry="3.4" fill="#E08A78" opacity=".16" filter="url(#${u}b2)"/><ellipse cx="${cx+cw*.5}" cy="${yn+1}" rx="5" ry="3.4" fill="#E08A78" opacity=".16" filter="url(#${u}b2)"/></g>`);
  if(p.cheekB)o.push(`<g clip-path="url(#${u}f)"><path d="M${cx-cw+1},${yn-3} Q${cx-cw*.62},${yn+1} ${cx-cw*.7},${ym+2} M${cx+cw-1},${yn-3} Q${cx+cw*.62},${yn+1} ${cx+cw*.7},${ym+2}" stroke="${SD}" stroke-opacity=".38" stroke-width="2.6" fill="none" stroke-linecap="round" filter="url(#${u}b2)"/><ellipse cx="${cx-cw*.6}" cy="${yn-3.5}" rx="4" ry="2" fill="#fff" opacity=".16" filter="url(#${u}b1)"/><ellipse cx="${cx+cw*.55}" cy="${yn-3.5}" rx="3.6" ry="2" fill="#fff" opacity=".1" filter="url(#${u}b1)"/></g>`);
  if(p.mole)o.push(`<circle cx="${R(cx+p.moleX*cw*.7)}" cy="${R(ye+2+p.moleY*(ch-ye-5))}" r=".55" fill="#4A3028" opacity=".75"/>`);
  if(p.nose==='bulb')o.push(`<ellipse cx="${cx}" cy="${yn-1.4}" rx="${p.nw*.8}" ry="2.2" fill="${SD}" opacity=".16" filter="url(#${u}b1)"/><ellipse cx="${cx-.5}" cy="${yn-2}" rx="${p.nw*.42}" ry="1.4" fill="#fff" opacity=".2" filter="url(#${u}b1)"/>`);
  if(p.nose==='long')o.push(`<path d="M${cx+1.2},${ye-3} L${cx+p.nw*.9+1.2},${yn-1.6} L${cx+.9},${yn-1.2}Z" fill="${SD}" opacity=".22" filter="url(#${u}b1)"/>`);
  o.push(`<g class="mo"><path d="M${cx-mw*.9},${ym-.2} Q${cx},${ym-.9} ${cx+mw*.9},${ym-.2} Q${cx+mw*.72},${ym+6.4} ${cx},${ym+6.9} Q${cx-mw*.72},${ym+6.4} ${cx-mw*.9},${ym-.2}Z" fill="#54202A"/><path d="M${cx-mw*.72},${ym-.1} Q${cx},${ym-.7} ${cx+mw*.72},${ym-.1} L${cx+mw*.62},${ym+1.7} Q${cx},${ym+2.1} ${cx-mw*.62},${ym+1.7}Z" fill="#F0EBE4"/><ellipse cx="${cx}" cy="${ym+5.2}" rx="${mw*.42}" ry="1.4" fill="#B5606A"/><path d="M${cx-mw*.8},${ym+4.6} Q${cx},${ym+8.2} ${cx+mw*.8},${ym+4.6} Q${cx},${ym+10.2*lf} ${cx-mw*.8},${ym+4.6}Z" fill="${lipL}"/><path d="${lipTop(-.3)} Q${cx},${ym-.4} ${cx-mw},${ym+cA-.3}Z" fill="${lipU}"/></g>`);
  if(p.flip)o.push(`<g transform="translate(${2*cx},0) scale(-1,1)">`);
  // 髪（ひとかたまりの形＋額に落ちる影＋毛流れ＋つや）
  const hf=`fill="url(#${u}gh)"`;
  const hairOut=(d,dark,light,gloss,locks=[])=>{
    o.push(`<defs><clipPath id="${u}h"><path d="${d}"/></clipPath></defs>`);
    o.push(`<g clip-path="url(#${u}f)"><path d="${d}" transform="translate(0,2)" fill="${SD}" opacity=".55" filter="url(#${u}b1)"/>${locks.map(l=>`<path d="${l}" transform="translate(.6,1.8)" fill="${SD}" opacity=".5" filter="url(#${u}b1)"/>`).join('')}</g>`);
    o.push(`<path d="${d}" ${hf}/>`);
    o.push(`<g clip-path="url(#${u}h)"><ellipse cx="${cx-cw-1}" cy="${ye-8}" rx="5" ry="17" fill="${HD}" opacity=".5" filter="url(#${u}b2)"/><ellipse cx="${cx+cw+1}" cy="${ye-8}" rx="6" ry="17" fill="${HD}" opacity=".62" filter="url(#${u}b2)"/><path d="M${cx-cw-2},${ye-20} Q${cx},${top+8} ${cx+cw+2},${ye-20}" stroke="${HD}" stroke-opacity=".3" stroke-width="5" fill="none" filter="url(#${u}b2)"/>${gloss}<path d="M${cx-cw*.72},${top+2.5} Q${cx-2},${top-6.5} ${cx+cw*.55},${top+3}" stroke="${sh(Hc,.5)}" stroke-opacity=".34" stroke-width="2.4" fill="none" stroke-linecap="round" filter="url(#${u}b1)"/><path d="${dark}" stroke="${HD}" stroke-opacity=".62" stroke-width=".6" fill="none" stroke-linecap="round"/><path d="${light}" stroke="${HL}" stroke-opacity=".55" stroke-width=".5" fill="none" stroke-linecap="round"/></g>`);
    locks.forEach((l,i)=>o.push(`<path d="${l}" fill="${i%2?Hc:mixc(Hc,HD,.45)}"/>`));
  };
  if(p.hairT==='short'){
    const d=`M${cx-cw+.9},${ye+3.5} L${cx-cw-.8},${ye+1} C${cx-cw-2.4},${ye-6} ${cx-cw-3.6},${ye-15} ${cx-cw-1.6},${ye-23} C${cx-cw+1.5},${top-6.5} ${cx-12},${top-11.6} ${cx-2},${top-11.6} C${cx+9},${top-11.6} ${cx+cw-2},${top-7.5} ${cx+cw+1.4},${ye-23} C${cx+cw+3.6},${ye-15} ${cx+cw+2.4},${ye-6} ${cx+cw+.8},${ye+1} L${cx+cw-.9},${ye+3.5} C${cx+cw-.5},${ye-3} ${cx+cw-1.1},${ye-8} ${cx+cw-2.6},${ye-12.5} C${cx+cw-7},${ye-13} ${cx+4},${ye-15.5} ${cx-9},${ye-21.5} C${cx-13},${ye-20.5} ${cx-cw+5},${ye-17} ${cx-cw+2.6},${ye-12.5} C${cx-cw+1.1},${ye-8} ${cx-cw+.5},${ye-3} ${cx-cw+.9},${ye+3.5}Z`;
    // 束: 根元(分け目あたり)から額へ、先細りで流れる
    const lock=(x0,y0,x1,y1,w,bend)=>{const mx=(x0+x1)/2+bend, my=(y0+y1)/2-Math.abs(bend)*.4;return`M${R(x0-w)},${R(y0)} Q${R(mx-w*.75)},${R(my+1.2)} ${R(x1)},${R(y1)} Q${R(mx+w*.75)},${R(my-1.2)} ${R(x0+w)},${R(y0)}Z`};
    const rx0=cx-8, ry0=ye-24;
    const locks=[lock(cx-1,ye-23,cx+6.5,ye-14.3,2.6,1.6),lock(cx+7,ye-22,cx+14.5,ye-12.3,2.6,1.4)];
    let dk='',lt='';
    for(let i=-8;i<=10;i++){const x0=rx0+i*.9+rnd()*.6, y0=top-9.5+Math.abs(i)*.3, x1=cx+i*2.6+rnd(), y1=ye-21-rnd(), t=`M${R(x0)},${R(y0)} Q${R(x0+i*1.3)},${R((y0+y1)/2-1.5)} ${R(x1)},${R(y1)} `;if((i+9)%3===0)lt+=t;else dk+=t}
    for(const sd of[-1,1])for(let k=0;k<5;k++){const x=cx+sd*(cw-1.4+k*1);dk+=`M${R(x)},${R(ye-19+k*1.4+rnd())} Q${R(x+sd*1.2)},${R(ye-10)} ${R(x+sd*.1)},${R(ye-.5-k*.5)} `}
    hairOut(d,dk,lt,`<ellipse cx="${cx-2}" cy="${top-2}" rx="14" ry="3.6" fill="${sh(Hc,.4)}" opacity=".33" filter="url(#${u}b2)"/>`,locks);
  }else if(p.hairT==='gen'){
    const hv=p.hv, hs=p.hs, lg=p.hl!=='ear', yb=p.hl==='chin'?ye+22.5:ye+27, Tx=lg?cw-3:cw-2.6, Ty=lg?ye-6:ye-12.5, px=cx-6, hy=top+10, eb=ye-9.2+(p.fb||0);
    let fr;
    if(p.fr==='sweep')fr=`C${cx+Tx-4.4},${Ty-.5} ${cx+4},${ye-15.5} ${cx-9},${ye-21.5} C${cx-13},${ye-20.5} ${cx-Tx+2.4},${Ty-4.5} ${cx-Tx},${Ty}`;
    else if(p.fr==='arch')fr=`C${cx+cw-6},${Ty-7} ${cx+6},${ye-19} ${px+1.5},${hy} C${cx-12},${ye-19.5} ${cx-cw+4},${Ty-8} ${cx-Tx},${Ty}`;
    else if(p.fr==='up')fr=`C${cx+Tx-2},${ye-20} ${cx+11},${ye-23.6} ${cx},${ye-23.6} C${cx-11},${ye-23.6} ${cx-Tx+2},${ye-20} ${cx-Tx},${Ty}`;
    else if(p.fr==='center')fr=`C${cx+Tx-2},${Ty-6} ${cx+5},${ye-17} ${cx},${top+9} C${cx-5},${ye-17} ${cx-Tx+2},${Ty-6} ${cx-Tx},${Ty}`;
    else{const sl=(rnd()-.5)*2.6, bx=Tx-(lg?2.5:5.5), n=3+Math.floor(rnd()*3);let q=`C${cx+Tx-.8},${R(Ty+2)} ${cx+bx+1.6},${R(eb-1.5+sl)} ${R(cx+bx-1)},${R(eb+.4+sl)}`, x0=bx-1;for(let i=0;i<n;i++){const x1=bx-1-(2*bx-2)*(i+1)/n+(i<n-1?(rnd()-.5)*2.4:0), yl=eb+sl*(1-2*(i+1)/n), dip=.9+rnd()*1.5, up=i<n-1?1+rnd()*2.2:0;q+=` Q${R(cx+(x0+x1)/2)},${R(yl+dip+sl*.3)} ${R(cx+x1)},${R(yl-up)}`;x0=x1}fr=q+` C${cx-bx-1.6},${R(eb-2-sl)} ${cx-Tx+.8},${R(Ty+2)} ${cx-Tx},${Ty}`}
    let d;
    if(!lg)d=`M${cx-cw+.9},${ye+3.5} L${cx-cw-.8},${ye+1} C${cx-cw-.8-hs*.45},${ye-6} ${cx-cw-.8-hs*.8},${ye-15} ${cx-cw-hs*.45},${ye-23} C${cx-cw+1.5},${top-hv*.55} ${cx-12},${R(top-hv+rnd()*1.6-.8)} ${cx-2},${top-hv} C${cx+9},${R(top-hv+rnd()*1.6-.8)} ${cx+cw-2},${top-hv*.65} ${cx+cw+hs*.4},${ye-23} C${cx+cw+.8+hs*.8},${ye-15} ${cx+cw+.8+hs*.45},${ye-6} ${cx+cw+.8},${ye+1} L${cx+cw-.9},${ye+3.5} C${cx+cw-.5},${ye-3} ${cx+cw-1.1},${ye-8} ${cx+Tx},${Ty} ${fr} C${cx-cw+1.1},${ye-8} ${cx-cw+.5},${ye-3} ${cx-cw+.9},${ye+3.5}Z`;
    else d=`M${cx-cw+.2},${yb-2} L${cx-cw-3.4},${yb} C${cx-cw-5},${yb-8} ${cx-cw-5.6},${ye+9} ${cx-cw-5.4},${ye-2} C${cx-cw-5.6},${ye-23} ${cx-13},${top-hv} ${cx-1},${top-hv} C${cx+11},${top-hv} ${cx+cw+5.5},${ye-24} ${cx+cw+5.6},${ye-2} C${cx+cw+5.8},${ye+9} ${cx+cw+5},${yb-8} ${cx+cw+3.6},${yb} L${cx+cw-.4},${yb-2} C${cx+cw-1.2},${ye+14} ${cx+cw-1.4},${ye+2} ${cx+Tx},${Ty} ${fr} C${cx-cw+1.4},${ye+2} ${cx-cw+1.2},${ye+14} ${cx-cw+.2},${yb-2}Z`;
    const lock=(x0,y0,x1,y1,w,bend)=>{const mx=(x0+x1)/2+bend, my=(y0+y1)/2-Math.abs(bend)*.4;return`M${R(x0-w)},${R(y0)} Q${R(mx-w*.75)},${R(my+1.2)} ${R(x1)},${R(y1)} Q${R(mx+w*.75)},${R(my-1.2)} ${R(x0+w)},${R(y0)}Z`};
    const locks=[];
    if(p.fr==='sweep'&&!lg)locks.push(lock(cx-1,ye-23,cx+6.5,ye-14.3,2.6,1.6),lock(cx+7,ye-22,cx+14.5,ye-12.3,2.6,1.4));
    let dk='',lt='';
    const ox=p.fr==='center'||p.fr==='up'?cx:p.fr==='bangs'?cx-4:cx-8, endY=p.fr==='bangs'?eb:ye-17;
    if(!p.buzz){
      for(let i=-8;i<=9;i++){const x0=ox+i*.9+rnd()*.6, y0=top-hv+1.6+Math.abs(i)*.3, x1=cx+i*(lg?3.3:2.6)+rnd(), y1=endY-rnd()*2+Math.abs(i)*(lg?1.6:.3), t=`M${R(x0)},${R(y0)} Q${R(x0+i*1.3)},${R((y0+y1)/2-1.5)} ${R(x1)},${R(y1)} `;if((i+9)%3===0)lt+=t;else dk+=t}
      for(const sd of[-1,1])for(let k=0;k<5;k++){const x=cx+sd*(cw-1.4+k*(lg?1.3:1));dk+=`M${R(x)},${R(ye-19+k*1.4+rnd())} Q${R(x+sd*1.2)},${R(ye-6)} ${R(x+sd*.1)},${R((lg?yb-1:ye-.5)-k*.5)} `}
    }
    if(p.bun)o.push(`<ellipse cx="${cx+1}" cy="${top-hv-1.4}" rx="10" ry="6.8" fill="${mixc(Hc,HD,.5)}"/><path d="M${cx-6},${top-hv-3.6} q7,-3.6 13,.6" stroke="${HL}" stroke-opacity=".4" stroke-width=".6" fill="none"/>`);
    hairOut(d,dk,lt,p.buzz?'':`<ellipse cx="${cx-2}" cy="${top-hv+9}" rx="15" ry="3.4" fill="${sh(Hc,.4)}" opacity=".46" filter="url(#${u}b2)"/>`,locks);
    if(p.wisp)for(const sd of[-1,1])o.push(`<path d="M${cx+sd*(cw-2.2)},${ye-11} C${cx+sd*(cw-.2)},${ye-2} ${cx+sd*(cw-1.6)},${ye+8} ${cx+sd*(cw-.4)},${R(ye+15+rnd()*4)}" stroke="${Hc}" stroke-width=".8" fill="none" stroke-linecap="round" opacity=".85"/>`);
  }else if(p.hairT==='thin'){
    let d='';
    for(const sd of[-1,1]){const X=k=>R(cx+sd*k);d+=`M${X(cw-1.2)},${ye+3} L${X(cw+.8)},${ye+1} C${X(cw+1.1)},${ye-3} ${X(cw+1.4)},${ye-8} ${X(cw+1.2)},${ye-11.5} C${X(cw+1)},${ye-14.5} ${X(cw+.2)},${ye-16.6} ${X(cw-2)},${ye-17.2} C${X(cw-3.2)},${ye-17.4} ${X(cw-3.9)},${ye-16.6} ${X(cw-3.8)},${ye-15.4} C${X(cw-3.2)},${ye-15} ${X(cw-2.2)},${ye-8} ${X(cw-1.2)},${ye+3}Z `}
    let dk='',lt='';
    for(const sd of[-1,1])for(let k=0;k<6;k++){const x=cx+sd*(cw-3+k*.9), t=`M${R(x)},${R(ye-20+k*1.3+rnd()*2)} Q${R(x+sd*(.8+rnd()*.6))},${R(ye-11)} ${R(x+sd*rnd()*.6)},${R(ye-1-k*.6)} `;if(k%3===1)lt+=t;else dk+=t}
    hairOut(d,dk,lt,'');
    let st='';for(let i=0;i<(p.bald?0:13);i++){const x0=cx-cw+4+rnd()*2, y0=ye-21+i*.15+rnd(), x1=cx+cw-5-rnd()*5, y1=top+1.5+i*.75+rnd();st+=`M${R(x0)},${R(y0)} Q${R(cx-4+rnd()*4)},${R(top-3.5+i*1)} ${R(x1)},${R(y1)} `}
    o.push(`<g clip-path="url(#${u}f)"><path d="M${cx-cw-1},${ye-18} Q${cx},${top-12} ${cx+cw+1},${ye-18} L${cx+cw-5},${top+7} Q${cx},${top+13} ${cx-cw+5},${top+7}Z" fill="${Hc}" opacity="${p.bald?.08:.3}" filter="url(#${u}b2)"/><path d="${st}" stroke="${Hc}" stroke-opacity=".7" stroke-width=".45" fill="none" stroke-linecap="round"/><ellipse cx="${cx-4}" cy="${top+6}" rx="8" ry="2.6" fill="#fff" opacity=".22" filter="url(#${u}b2)"/></g>`);
  }else if(p.hairT==='medium'){
    const px=cx-6, hy=top+10;
    const d=`M${px},${top-8.5} C${cx+10},${top-9} ${cx+cw+5.5},${ye-24} ${cx+cw+5.6},${ye-2} C${cx+cw+5.8},${ye+9} ${cx+cw+5},${ye+19} ${cx+cw+3.6},${ye+27} L${cx+cw-.4},${ye+25} C${cx+cw-1.2},${ye+14} ${cx+cw-1.4},${ye+2} ${cx+cw-3},${ye-6} C${cx+cw-6},${ye-13} ${cx+6},${ye-19} ${px+1.5},${hy} C${cx-12},${ye-19.5} ${cx-cw+4},${ye-14} ${cx-cw+2.6},${ye-5} C${cx-cw+1.4},${ye+3} ${cx-cw+1},${ye+14} ${cx-cw+.2},${ye+25} L${cx-cw-3.4},${ye+27} C${cx-cw-5},${ye+19} ${cx-cw-5.6},${ye+9} ${cx-cw-5.4},${ye-2} C${cx-cw-5.6},${ye-23} ${cx-13},${top-9} ${px},${top-8.5}Z`;
    let dk=`M${px},${top-8} Q${px+.4},${top} ${px+1.5},${hy} `,lt='';
    for(let i=0;i<9;i++){const y0=top-7.5+i*1.9, x0=px+.4+i*.12, x1=cx+cw+5-i*.55, y1=ye-16+i*5+rnd()*2, t=`M${R(x0)},${R(y0)} C${R(cx+8-i*.3)},${R(y0+1+i*.6)} ${R(x1-1)},${R(y1-16)} ${R(x1)},${R(y1)} `;if(i%3===1)lt+=t;else dk+=t}
    for(let i=0;i<7;i++){const y0=top-7.5+i*2.3, x1=cx-cw-5+i*.6, y1=ye-14+i*5.5+rnd()*2, t=`M${R(px-.4)},${R(y0)} C${R(cx-13)},${R(y0+1+i*.5)} ${R(x1+1)},${R(y1-15)} ${R(x1)},${R(y1)} `;if(i%3===1)lt+=t;else dk+=t}
    for(const sd of[-1,1])for(let k=0;k<4;k++){const x=cx+sd*(cw+.4+k*1.3);dk+=`M${R(x)},${R(ye+2+k*2+rnd()*2)} Q${R(x+sd*.8)},${R(ye+14)} ${R(x-sd*.2)},${R(ye+26)} `}
    hairOut(d,dk,lt,`<ellipse cx="${cx+4}" cy="${top+3}" rx="19" ry="3.2" fill="${sh(Hc,.45)}" opacity=".32" filter="url(#${u}b2)" transform="rotate(14 ${cx+4} ${top+3})"/>`);
  }else{
    const cyh=ye-9, rx=cw+5.2, ry=cyh-(top-8.5), N=11, a0=208, a1=-28;
    const pt=(a,k)=>{const r=a*Math.PI/180;return[R(cx+rx*k*Math.cos(r)),R(cyh-ry*k*Math.sin(r))]};
    let d=`M${pt(a0,1)}`;
    for(let i=0;i<N;i++){const A=a0+(a1-a0)*(i+1)/N, M=a0+(a1-a0)*(i+.5)/N;d+=` Q${pt(M,1.045+rnd()*.035)} ${pt(A,1)}`}
    d+=` L${cx+cw-.5},${ye+2} C${cx+cw-1.5},${ye-6} ${cx+cw-3.5},${ye-13} ${cx+cw-7.5},${ye-17.5} C${cx+cw-10},${ye-20.5} ${cx+9},${ye-21.6} ${cx+5},${ye-22.6} C${cx-1},${ye-19.6} ${cx-9},${ye-18.4} ${cx-cw+7},${ye-17} C${cx-cw+3.5},${ye-13} ${cx-cw+1.5},${ye-6} ${cx-cw+.5},${ye+2}Z`;
    let dk='',lt='';
    for(let k=0;k<34;k++){const a=(200-rnd()*220)*Math.PI/180, f=.55+rnd()*.42, x=cx+rx*f*Math.cos(a), y=cyh-ry*f*Math.sin(a), w=1.5+rnd()*1.7, up=(rnd()<.5?-1:1)*(1.1+rnd()*1.2), t=`M${R(x-w)},${R(y)} q${R(w)},${R(up)} ${R(w*2)},${R(rnd()-.5)} `;if(k%3===0)lt+=t;else dk+=t}
    hairOut(d,dk,lt,`<ellipse cx="${cx-6}" cy="${top-1}" rx="15" ry="4" fill="${sh(Hc,.5)}" opacity=".4" filter="url(#${u}b2)" transform="rotate(-10 ${cx-6} ${top-1})"/>`);
  }
  if(p.flip)o.push(`</g>`);
  if(p.glasses){const gy=ye+.3, gw=p.ea*2+5.2;o.push(`<g fill="#fff" fill-opacity=".1" stroke="#2E2E36" stroke-width="${p.gsw||.95}"><rect x="${cx-p.ex-gw/2}" y="${gy-4.6}" width="${gw}" height="9" rx="${p.grx||3.4}"/><rect x="${cx+p.ex-gw/2}" y="${gy-4.6+p.asym}" width="${gw}" height="9" rx="${p.grx||3.4}"/><path d="M${cx-p.ex+gw/2},${gy-1.4} q${p.ex-gw/2},-1.6 ${2*p.ex-gw},${p.asym} M${cx-p.ex-gw/2},${gy-2} L${cx-cw-.6},${gy-2.8} M${cx+p.ex+gw/2},${gy-2+p.asym} L${cx+cw+.6},${gy-2.8}" fill="none"/></g>`)}
  o.push(`</g>`);
  o.push(`</g></g>`);
  return o.join('');
}
const mul=a=>()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lum=h=>{const n=parseInt(h.slice(1),16);return(.299*(n>>16)+.587*(n>>8&255)+.114*(n&255))/255};
const SK=['#F1D3BC','#EFD0B8','#EBC9AE','#E7C7AE','#E2BA98','#DDB28F','#CFA588','#C4987A'];
const HB=['#1E1A19','#241D1B','#2A211D','#1B1B1F'], HBR=['#3A2924','#4A342A','#5B3F2E'], HDY=['#7A5A3C','#8A6A4A','#9A7B55','#6B4A3A'], HG=['#57534F','#6F6A66','#8C8782','#A7A09A','#C4BFB9'];
const CB=['#2B2B30','#F1EEE8','#5E7C9B','#3D4B63','#6C6A5C','#8A8F96','#7A5C48','#56705A','#B9A98C','#8C3F45','#33383F','#D8D4CC'];
const CV=['#E2536A','#F08A2C','#F2C83A','#57B56B','#3FA7D6','#4A63C8','#9A5BC4','#F29CB7','#E84545','#69C9B9','#B7D94C','#7FD3F2'];
const CP=['#E4C1C9','#C9D6E8','#EADCC4','#CFE0D0','#D9CCE6','#F1EEE8','#F3D9C2','#BFD5D2'];
const LINES=['今日すっごく楽しかったです！','大阪から来ました。また来ます','娘に教えてもらって来ました','今日もよかったよ、また来るわ','初めて来ました、最高でした','ダンスかっこよかった！','歌、泣きそうになりました','ずっと応援してます','次のツアーも行きます','今日の衣装かわいかった','MC笑いました','明日も来ます','遠征してきたかいがありました','体に気をつけてね','また会いに来ます','新曲めっちゃ好きです','友達を連れてきました','誕生日おめでとう！','今日が一番よかった','ありがとう、元気出ました'];
function gen(i,fam){
  const r=mul(i*7919+101), U=(a,b)=>a+(b-a)*r(), pick=a=>a[Math.floor(r()*a.length)], W=ps=>{let t=0;for(const q of ps)t+=q[1];let x=r()*t;for(const q of ps){if((x-=q[1])<0)return q[0]}return ps[0][0]}, nrm=()=>(r()+r()+r()+r()-2)/.58;
  const female=r()<.4, age=W(female?[['y',45],['m',38],['o',17]]:[['y',30],['m',42],['o',28]]), old=age==='o';
  const h=female?clamp(158+nrm()*5.5,145,173):clamp(171+nrm()*6,157,189);
  const fat=clamp(nrm()*.7+(age==='y'?-.15:.25),-1,1.9), f=Math.max(0,fat);
  const p={female:female?1:0,old:old?1:0,h,age};
  p.skin=pick(SK);p.iris=pick(['#3A261E','#2E1F18','#40302A','#33251F']);
  if(female){Object.assign(p,{cw:U(19.6,22.2)+f*1.1,len:U(.9,1.02),jw:U(14,18)+f*1.8,chin:U(6,8.5)+f*1.2,neck:U(.54,.62)+f*.03,sw:Math.max(45,U(45.5,50)+fat*2.4),ex:U(8.3,9.9),ea:U(3.7,4.7),eo:U(1.15,2.05),eti:U(-.8,.6),browTh:U(1,1.6),browAr:U(.4,1.4),browTail:U(.3,1.5),nw:U(2.7,3.9),mw:U(5.3,7.2),lf:U(.7,1.2),sl:U(1.5,8)})}
  else{Object.assign(p,{cw:U(21.4,24.6)+f*1.2,len:U(.97,1.1),jw:U(17,22)+f*1.6,chin:U(8.5,11)+f*1,neck:U(.6,.72)+f*.03,sw:Math.max(50,U(51,57)+fat*3),ex:U(9,10.8),ea:U(3.5,4.5),eo:U(.95,1.6),eti:U(-.5,.5),browTh:U(1.4,2.5),browAr:U(0,1),browTail:U(.5,1.6),nw:U(3.3,4.9),mw:U(6.2,8),lf:U(.6,.95),sl:U(0,6.5)})}
  p.jw=Math.min(p.jw,p.cw-1.6);p.chin=Math.min(p.chin,p.jw-5);p.neck=Math.min(p.neck,.78);
  Object.assign(p,{eyeY:U(-.6,.6),shL:U(0,2.6),asym:U(-.35,.35),browAs:U(-.5,.5),tilt:U(-.9,.9),d:-U(0,3)});
  p.ear=U(0,1.2);p.eyeT=W([['single',35],['dbl',30],['hooded',15],['droopy',10],['up',10]]);p.dbl=p.eyeT==='dbl'||p.eyeT==='hooded'||(p.eyeT!=='single'&&r()<.5)?1:0;p.sock=p.eyeT==='hooded'?.44:U(.24,.34);if(p.eyeT==='single')p.eo*=.8;if(p.eyeT==='hooded')p.eo*=.9;if(p.eyeT==='droopy')p.eti=U(.5,1.1);if(p.eyeT==='up')p.eti=U(-1.2,-.6);
  p.mw*=U(1,1.22);if(p.exp==='neutral'||p.exp==='shy'){const sm=U(-.5,.9);p.cA=sm+U(-.2,.2);p.cB=sm+U(-.2,.2)}
  // 顔の骨格の型
  p.k1=U(.52,.68);p.k2=U(.68,.9);p.cA=0;p.cB=0;
  p.fam=fam||W([['flat',35],['round',25],['long',18],['bony',14],['deep',8]]);
  p.shape=p.fam==='round'?'round':p.fam==='long'?'long':p.fam==='bony'?W([['square',60],['heart',40]]):p.fam==='deep'?W([['base',50],['long',25],['square',25]]):W([['base',60],['round',20],['square',20]]);
  if(p.shape==='round'){p.len*=.9;p.cw+=1.6;p.jw=p.cw-1.8;p.k1=.74;p.k2=.96;p.chin+=1.5}
  if(p.shape==='long'){p.len*=1.12;p.cw-=1.5;p.jw-=1.2;p.k1=.6;p.k2=.74}
  if(p.shape==='square'){p.jw=p.cw-1.1;p.k1=.76;p.k2=.99;p.chin+=2.6;p.len*=.98}
  if(p.shape==='heart'){p.jw-=3.2;p.k1=.46;p.k2=.54;p.chin-=1.6;p.len*=1.03}
  p.jw=Math.min(p.jw,p.cw-1);p.chin=clamp(p.chin,4.5,p.jw-4);
  {const q=p.shape==='heart'?U(.52,.58):p.shape==='long'?U(.57,.65):p.shape==='round'?U(.7,.77):p.shape==='square'?U(.73,.79):U(.6,.71);p.k2=q*p.cw/p.jw;p.k1=p.shape==='heart'?U(.52,.58):p.shape==='square'?U(.66,.72):p.shape==='round'?U(.64,.7):U(.56,.66)}
  {const lim=p.shape==='long'?[1.38,1.47]:p.shape==='round'?[1.13,1.24]:[1.24,1.4];const raw=60*p.len/(2*p.cw), rt=p.shape==='long'?1.36+(clamp(raw,1.36,1.75)-1.36)/.39*.09:clamp(raw,lim[0],lim[1]);p.len=rt*2*p.cw/60}
  {const wj=.352*p.cw+.432*p.jw*p.k2;p.neck=clamp(wj*(female?U(.7,.84):U(.8,.94))*(1+f*.03),p.cw*.42,p.cw*.8)/p.cw}
  p.nY=U(.42,.58);p.mY=clamp(U(.66,.78),p.nY+.17,.8);
  p.ea*=U(.8,1.24);p.ex*=U(.9,1.12);p.eo*=U(.8,1.4);p.nw*=U(.78,1.32);p.mw*=U(.85,1.15);p.lf*=U(.7,1.45);
  p.browTh*=U(.6,1.5);p.browAr=U(.5,1.5);p.browTail=U(-.2,1.1);if(r()<.22){p.browTail=U(-1.2,-.3);p.browAr=U(.2,.9)}p.browY=U(-1.3,1.5);
  p.nose=W([['plain',50],['bulb',25],['long',25]]);
  // 顔の系統ごとの、部品と影のそろえ方
  p.dp=1;
  if(p.fam==='flat'){p.dp=.5;p.sock=.16;p.dbl=r()<.2?1:0;p.eo*=.82;p.nw*=.9;p.nose='plain';p.nY=U(.44,.5);p.browAr=U(.3,.8);p.browY=U(.2,1.5);p.ex*=1.04}
  if(p.fam==='round'){p.dp=.75;p.sock=.22;p.eo*=1.25;p.ea*=1.06;p.nose=W([['bulb',70],['plain',30]]);p.nY=U(.42,.48);p.mY=clamp(p.nY+U(.2,.24),.6,.74);p.lf*=1.15;p.browAr=U(.4,1.6)}
  if(p.fam==='long'){p.dp=1.05;p.nose='long';p.nY=U(.54,.6);p.mY=clamp(p.nY+U(.18,.21),.7,.8);p.ex*=.93;p.nw*=.92;p.mw*=.94;p.browAr=U(.4,1)}
  if(p.fam==='bony'){p.dp=1.4;p.sock=U(.3,.36);p.lf*=.7;p.nw*=1.08;p.nose=W([['long',50],['plain',50]]);p.eo*=.9;p.browTh*=1.1;p.cheekB=1}
  if(p.fam==='deep'){p.dp=1.6;p.sock=.4;p.bags=0;p.dbl=1;p.ea*=1.1;p.eo*=1.12;p.browY=U(-1.6,-.7);p.browTh*=1.3;p.nw*=1.15;p.nose='long';p.nY=U(.5,.57);p.mY=clamp(p.nY+U(.18,.22),.68,.8);p.lf*=1.1}
  // 表情
  p.exp=W([['neutral',32],['smile',38],['grin',23],['shy',7]]);
  if(p.exp==='smile'){const s2=U(-1.9,-1);p.cA=s2+U(-.2,.2);p.cB=s2+U(-.2,.2);p.eo*=.86}
  if(p.exp==='grin'){p.grin=1;p.cA=p.cB=-1.5;p.eo*=.72}
  if(p.exp==='shy'){p.browTail=U(1.3,1.7);p.tilt=U(1.2,2.4)*(r()<.5?-1:1)}
  if(r()<.14){p.mole=1;p.moleX=U(-.7,.7);p.moleY=U(.15,.85)}
  p.gsw=W([[.95,50],[1.7,34],[.6,16]]);
  if(old&&p.eo>1.3)p.eo=U(1.05,1.3);
  p.bags=(old?r()<.55:age==='m'?r()<.18:0)?1:0;
  p.stubble=(!female&&age!=='y'&&r()<.2)?1:0;
  // 髪の色
  const grey=old?r()<(female?.55:.8):age==='m'?r()<(female?.04:.14):false;
  p.hair=grey?pick(HG):W([[pick(HB),female?40:68],[pick(HBR),female?40:26],[pick(HDY),age==='y'?(female?22:8):(female?10:1)]]);
  p.brow=grey?mixc(p.hair,'#3B3633',.5):sh(p.hair,-.12);
  // 髪型
  let hs;
  if(female){
    hs=W(age==='y'?[['long',34],['shoulder',20],['bob',20],['pony',14],['bun',6],['shortf',6]]:age==='m'?[['bob',25],['shoulder',24],['pony',18],['long',10],['shortf',16],['wavy',7]]:[['wavy',40],['shortf',24],['bob',20],['pony',16]]);
  }else{
    hs=W(age==='y'?[['sweep',32],['heavy',28],['center',14],['up',16],['buzz',6],['messy',10]]:age==='m'?[['sweep',28],['up',24],['heavy',10],['buzz',10],['thin',15],['bald',5],['messy',8]]:[['thin',30],['bald',13],['up',24],['sweep',15],['buzz',10],['messy',8]]);
  }
  p.style=hs;p.flip=r()<.5?1:0;
  const G=o=>Object.assign(p,{hairT:'gen',hv:U(8.6,10.8),hs:U(2,4.4)},o);
  const ffr=()=>W([['arch',40],['bangs',34],['center',18],['sweep',8]]);
  if(hs==='long'){const fr=ffr();if(fr==='arch'&&r()<.6)Object.assign(p,{hairT:'medium',bl:U(13,24)});else G({hl:'long',fr,bl:U(13,26),hv:U(8.5,10)})}
  else if(hs==='shoulder'){const fr=ffr();if(fr==='arch'&&r()<.5)Object.assign(p,{hairT:'medium',bl:U(5,10)});else G({hl:'long',fr,bl:U(4,10),hv:U(8.5,10)})}
  else if(hs==='bob')G({hl:'chin',fr:W([['bangs',50],['center',25],['arch',25]]),hv:U(8.5,10.5)});
  else if(hs==='pony')G({hl:'ear',fr:W([['bangs',15],['up',35],['center',50]]),hv:U(8.2,9.8),hs:U(1.4,2.4),wisp:1});
  else if(hs==='bun')G({hl:'ear',fr:W([['bangs',45],['up',25],['center',30]]),hv:U(8,9.4),hs:U(1.4,2.4),bun:1,wisp:1});
  else if(hs==='shortf')G({hl:'ear',fr:W([['bangs',40],['sweep',40],['center',20]]),hv:U(9,10.8),hs:U(3,4.6)});
  else if(hs==='wavy')p.hairT='wavy';
  else if(hs==='sweep'){if(r()<.35)p.hairT='short';else G({hl:'ear',fr:'sweep'})}
  else if(hs==='heavy')G({hl:'ear',fr:'bangs',hv:U(9.2,11),hs:U(2.6,4.6),fb:U(0,1.6)});
  else if(hs==='center')G({hl:'ear',fr:'center'});
  else if(hs==='up')G({hl:'ear',fr:'up',hv:U(7.5,11),hs:U(1.2,3.4)});
  else if(hs==='buzz')G({hl:'ear',fr:'up',hv:U(2.8,4),hs:U(.3,.9),buzz:1});
  else if(hs==='messy')G({hl:'ear',fr:W([['bangs',50],['sweep',50]]),hv:U(9.6,11.2),hs:U(3.4,4.8),messy:1,fb:U(0,1.4)});
  else if(hs==='thin')p.hairT='thin';
  else if(hs==='bald'){p.hairT='thin';p.bald=1}
  // めがね
  if(r()<(female?.22:.42)){p.glasses=1;p.grx=W([[1.6,30],[3.4,45],[4.4,25]])}
  // 服
  const top=W(female?[['blouse',14],['cardigan',16],['knit',14],['teeP',13],['tee',7],['border',10],['hoodie',8],['shirt',7],['long',7],['blazer',4]]:[['teeP',23],['tee',13],['check',14],['hoodie',11],['long',8],['shirt',8],['polo',6],['border',5],['knit',5],['blazer',4],['cardigan',3]]);
  p.top=top==='teeP'?'tee':top;
  const tee=p.top==='tee';
  p.cloth=tee&&top==='teeP'?W([[pick(CV),55],[pick(CB),45]]):female&&['blouse','cardigan','knit','shirt'].includes(p.top)?W([[pick(CP),60],[pick(CB),40]]):p.top==='blazer'?pick(['#2B2B30','#3D4B63','#33383F','#6C6A5C','#B9A98C']):pick(CB);
  if(top==='teeP'){p.print=1+Math.floor(r()*6)}
  p.pc=lum(p.cloth)>.72?'#2B2B30':'#FFFFFF';
  p.short=(tee||p.top==='polo'||(p.top==='border'&&r()<.5)||(p.top==='shirt'&&r()<.3)||(p.top==='blouse'&&r()<.3))?1:0;
  if(p.top==='border'){p.bw=W([[2.2,40],[3.4,40],[5,20]]);p.c2=lum(p.cloth)>.6?pick(['#2B2B30','#3D4B63','#8C3F45']):'#F1EEE8'}
  if(p.top==='check'){p.cloth=pick(['#8C3F45','#3D4B63','#56705A','#5E7C9B','#7A5C48','#6C6A5C']);p.c2=pick(['#F1EEE8','#2B2B30','#F2C83A']);p.inn=pick(['#F1EEE8','#2B2B30','#8A8F96',pick(CV)])}
  if(p.top==='cardigan'){p.collarIn=female&&r()<.5?1:0;p.inn=p.collarIn?'#F4F0EA':pick(['#F1EEE8','#2B2B30','#D8D4CC',pick(CP)])}
  if(p.top==='blazer'){p.collarIn=r()<.5?1:0;p.inn=p.collarIn?'#F4F0EA':pick(['#F1EEE8','#2B2B30','#8A8F96'])}
  // 動きの癖
  p.mv=W([['calm',24],['nod',18],['bounce',14],['swayer',14],['fidget',12],['lean',9],['tilt',9]]);
  const m={'--bl':U(2.8,7).toFixed(2)+'s','--ts':U(.8,1.7).toFixed(2)+'s','--ha':'sway','--hd':U(5.5,9).toFixed(2)+'s'};
  const tk=W([['',50],['S',25],['L',25]]);m['--tk']='talk'+tk;m['--tj']='jaw'+tk;m['--hn']=W([['nod',55],['nodBig',25],['nodNo',20]]);
  if(p.mv==='nod'){m['--ha']='nodI';m['--hd']=U(2.6,4).toFixed(2)+'s'}
  if(p.mv==='bounce'){m['--wa']='whoBounce';m['--wd']=U(.7,1.1).toFixed(2)+'s'}
  if(p.mv==='swayer'){m['--wa']='whoSway';m['--wd']=U(2.6,4).toFixed(2)+'s'}
  if(p.mv==='fidget'){m['--ha']='fid';m['--hd']=U(1.8,2.8).toFixed(2)+'s';m['--ga']='look';m['--gd']=U(3,5).toFixed(2)+'s'}
  if(p.mv==='lean'){m['--wa']='whoLean';m['--wd']=U(3,5).toFixed(2)+'s'}
  if(p.mv==='tilt'){m['--ha']='tiltI';m['--hd']=U(3.5,5.5).toFixed(2)+'s'}
  if(p.exp==='shy'){m['--ga']='lookDown';m['--gd']=U(3.5,5.5).toFixed(2)+'s'}
  p.mvars=m;
  p.line=pick(LINES);
  return p;
}

// ===== ここからゲーム本体 =====
const $=s=>document.querySelector(s);
let PAUSED=false,PLIST=[],WL=null;
const sleep=ms=>new Promise(r=>{let left=ms,t=performance.now();const tick=()=>{if(PAUSED){t=performance.now();setTimeout(tick,150);return}const n=performance.now();left-=n-t;t=n;if(left<=0)r();else setTimeout(tick,Math.min(left,150))};setTimeout(tick,Math.min(ms,150))});
function phr(el,t){el.textContent='';const a=String(t||'').split(' ');a.forEach((w,i)=>{const s=document.createElement('span');s.className='ph';s.textContent=w;el.appendChild(s);if(i<a.length-1)el.appendChild(document.createTextNode(' '))})}
const store={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{localStorage.setItem(k,v)}catch(e){}}};
async function awake(on){try{if(on){if(!WL&&navigator.wakeLock)WL=await navigator.wakeLock.request('screen')}else if(WL){await WL.release();WL=null}}catch(e){WL=null}}
function setPause(p){if(p===PAUSED)return;if(p&&(!window.__G||$('#main').hidden))return;PAUSED=p;
  if(p){PLIST=document.getAnimations().filter(a=>a.playState==='running');PLIST.forEach(a=>{try{a.pause()}catch(e){}})}
  else{PLIST.forEach(a=>{try{a.play()}catch(e){}});PLIST=[];awake(true)}
  $('#pause').classList.toggle('show',p)}
const MCS=[['ピンク','#E84C7A'],['赤','#E0353B'],['オレンジ','#F0862C'],['黄','#EBBE22'],['緑','#2BAE66'],['水色','#35B4E6'],['青','#3A6BDD'],['紫','#9457E0']];
let MC='#E84C7A';
function hsl(hex){const n=parseInt(hex.slice(1),16),r=(n>>16)/255,gg=(n>>8&255)/255,b=(n&255)/255,mx=Math.max(r,gg,b),mn=Math.min(r,gg,b),d=mx-mn,l=(mx+mn)/2;let h=0;if(d){h=mx===r?((gg-b)/d)%6:mx===gg?(b-r)/d+2:(r-gg)/d+4;h*=60;if(h<0)h+=360}return[h,d?d/(1-Math.abs(2*l-1)):0,l]}
const nearMC=c=>{if(!/^#[0-9a-f]{6}$/i.test(c||''))return false;const a=hsl(c),b=hsl(MC);const dh=Math.min(Math.abs(a[0]-b[0]),360-Math.abs(a[0]-b[0]));return a[1]>.3&&a[2]>.25&&a[2]<.85&&dh<34};
function setMC(c){MC=c;const [h,s,l]=hsl(c),R=document.documentElement.style;R.setProperty('--mc',c);R.setProperty('--mc2',`hsl(${h} ${Math.round(s*85)}% 90%)`);{const n=parseInt(c.slice(1),16),lum=(.2126*(n>>16)+.7152*(n>>8&255)+.0722*(n&255))/255;R.setProperty('--mct',lum>.66?'#2B2540':'#fff');R.setProperty('--mcd',lum>.5?`hsl(${Math.round(h)} ${Math.round(s*100)}% 34%)`:c)}
  document.querySelectorAll('#hands path[data-mc]').forEach(p=>p.setAttribute('fill',c));store.set('oshiten_mc',c);document.querySelectorAll('#mcpick button').forEach(b=>b.classList.toggle('on',b.dataset.c===c))}
// ---- タイトル演出（前のチャットでHopが「めっちゃいい」と言った15秒の演出をそのまま使う。変えたのは 700→300 と、はめ込みのための名前だけ）
const TM=(()=>{const $=s=>document.querySelector(s);
const clamp=(v,a=0,b=1)=>Math.min(b,Math.max(a,v));
const P=(t,a,b)=>clamp((t-a)/(b-a));
const oC=p=>1-Math.pow(1-p,3);
const iC=p=>p*p*p;
const oB=(p,s=1.9)=>{p=p-1;return p*p*((s+1)*p+s)+1};
const sm=p=>p*p*(3-2*p);
const oE=p=>p===0||p===1?p:Math.pow(2,-9*p)*Math.sin((p*10-.75)*(2*Math.PI)/3)+1;
const END=15;
function fill(id,txt){const el=$(id);[...txt].forEach(c=>{const s=document.createElement('span');s.textContent=c;el.appendChild(s)});return [...el.children]}
const L1=fill('#l1','推しに'), L2=fill('#l2','転生'), L4=fill('#l4','したので、'),
      L5=fill('#l5','ヲタク知識で'), L6=fill('#l6','お見送り会'), L8=fill('#l8','を乗り切る');
const rnd=(i,k)=>{const x=Math.sin(i*127.1+k*311.7)*43758.5453;return x-Math.floor(x)};
const cols=['var(--magenta)','var(--lavender)','var(--cyan)','var(--lemon)'];
const stripes=$('#stripes');
for(let i=0;i<34;i++){const e=document.createElement('i');e.style.left=(i*90-60)+'px';e.style.background=cols[i%4];stripes.appendChild(e)}
const night=$('#night'); const beams=[];
for(let i=0;i<64;i++){const e=document.createElement('i');e.style.left=(900-560+i*24+rnd(i,1)*10)+'px';e.style.background=cols[i%4];night.appendChild(e);beams.push(e)}
const q=$('#queue'); const dots=[];
for(let i=0;i<30;i++){const b=document.createElement('b');q.appendChild(b);dots.push(b)}
const NS='http://www.w3.org/2000/svg';
const rings=[...Array(4)].map((_,i)=>{const c=document.createElementNS(NS,'circle');c.setAttribute('cx',150);c.setAttribute('cy',228);c.setAttribute('stroke',i%2?'var(--lavender)':'var(--magenta)');$('#rings').appendChild(c);return c});
const rays=[...Array(18)].map((_,i)=>{const l=document.createElementNS(NS,'line');l.setAttribute('stroke',cols[i%4]);l.setAttribute('stroke-width',i%3?4:7);$('#burst').appendChild(l);return l});
const camKeys=[[0,1.5,140,150],[1.4,1.36,158,228],[3.4,1.28,200,280],[4.6,1.24,190,355],[6.0,1.2,192,450],[7.7,1.24,178,580],[10.4,1.3,176,592],[11.2,1.1,190,560],[12.4,1,195,390],[99,1,195,390]];
function cam(t){for(let i=0;i<camKeys.length-1;i++){const[a,s0,x0,y0]=camKeys[i],[b,s1,x1,y1]=camKeys[i+1];if(t<=b){const p=sm(P(t,a,b));return[s0+(s1-s0)*p,x0+(x1-x0)*p,y0+(y1-y0)*p]}}return[1,195,390]}
function shake(t,s,d,amp){if(t<s||t>s+d)return[0,0];const k=amp*(1-(t-s)/d);return[k*Math.sin(t*93),k*Math.cos(t*71)]}
function set(el,op,tf){el.style.opacity=op;el.style.transform=tf}
const stage=$('#tstage'), camEl=$('#cam'), flash=$('#flash'), pill=$('#pill'),
      digits=$('#digits'), dgs=[...digits.children], mai=$('#mai');
function render(t){
  const dark=t<1.4;
  stage.classList.toggle('tdark',dark);
  night.style.opacity=dark?1:0;
  beams.forEach((b,i)=>{const sp=(0.7+rnd(i,2))*420;b.style.transform=`translateY(${-((t*sp+rnd(i,3)*600)%900)}px)`});
  flash.style.opacity=t<1.4?0:(1-P(t,1.4,1.95))*.95;
  stripes.style.transform=`translateX(${-(t*14)%90}px)`;
  let[s,fx,fy]=cam(t);
  const sh=[shake(t,1.4,.5,13),shake(t,3.25,.3,6),shake(t,10.4,.55,15),shake(t,11.45,.3,7)].reduce((a,b)=>[a[0]+b[0],a[1]+b[1]],[0,0]);
  const rot=(1-sm(P(t,0,12.4)))*-3;
  camEl.style.transform=`translate(${sh[0]}px,${sh[1]}px) rotate(${rot}deg) scale(${s}) translate(${195-fx}px,${390-fy}px)`;
  L1.forEach((e,i)=>{const a=.25+i*.16,p=P(t,a,a+.5);set(e,p>0?1:0,`translateY(${(1-oB(p))*-110}px)`)});
  const p2=P(t,1.4,1.72), jig=t>3.25?Math.sin((t-3.25)*38)*Math.exp(-(t-3.25)*6)*5:0;
  L2.forEach((e,i)=>{set(e,p2>0?1:0,`scale(${3.2-2.2*oC(p2)}) rotate(${(i?1:-1)*(1-oC(p2))*12+jig*(i?1:.4)}deg)`)});
  rings.forEach((c,i)=>{let r,o;
    if(t<1.4){const p=P(t,.9+i*.05,1.4);r=260-240*iC(p);o=p>0?p*.8:0}
    else{const p=P(t,1.4+i*.14,2.6+i*.14);r=40+300*oC(p);o=(1-p)*.9}
    c.setAttribute('r',Math.max(1,r));c.setAttribute('opacity',o);c.setAttribute('stroke-width',3+ (1-P(t,1.4,2.6))*5)});
  let px,prot,psx=1;
  if(t<2.55){px=440}
  else if(t<3.25){const p=P(t,2.55,3.25);px=440-470*oC(p);psx=1+.35*(1-p)}
  else{const p=P(t,3.25,3.9);px=-30*(1-oE(p));}
  prot=t<3.25?-2:-7-Math.sin((t-3.25)*20)*Math.exp(-(t-3.25)*5)*10;
  set(pill,t>2.55?1:0,`translateX(${px}px) rotate(${prot}deg) scaleX(${psx}) skewX(${(psx-1)*-40}deg)`);
  L4.forEach((e,i)=>{const a=3.65+i*.09,p=P(t,a,a+.22);set(e,p>0?1:0,`scale(${oB(p,2.6)})`)});
  L5.forEach((e,i)=>{const a=4.55+i*.1,p=P(t,a,a+.38),r=(rnd(i,5)-.5)*80;
    set(e,p>0?1:0,`translateY(${(1-oB(p))*40}px) rotate(${r*(1-oB(p))}deg) scale(${.4+.6*oB(p)})`)});
  L6.forEach((e,i)=>{const a=5.8+i*.17,p=P(t,a,a+.75);
    set(e,p>0?1:0,`translateX(${(1-oC(p))*470}px) translateY(${-Math.abs(Math.sin(p*Math.PI*3))*14*(1-p)}px)`)});
  const qo=P(t,5.6,6.1)*(1-P(t,7.9,8.5));q.style.opacity=qo*.55;
  dots.forEach((d,i)=>{d.style.left=((i*22 - t*150)%660+660)%660-100+'px'});
  const pd=P(t,7.6,7.95);
  let n=Math.floor(300*Math.pow(P(t,7.9,10.4),2.4)); if(t>=10.4)n=300;
  const str=String(n).padStart(3,'0');
  dgs.forEach((d,i)=>{d.textContent=str[i];const lead=str.slice(0,i+1).replace(/0/g,'')==='' && i<2;d.classList.toggle('dim',lead);
    const jit=(t>7.9&&t<10.4)?(rnd(Math.floor(t*30),i)-.5)*6:0;d.style.transform=`translateY(${jit}px)`});
  const punch=t>10.4?1+.28*(1-oC(P(t,10.4,10.75))):1;
  set(digits,pd>0?1:0,`scale(${oB(pd)*punch})`);
  digits.style.transformOrigin='50% 80%';
  const pm=P(t,10.55,10.85);
  set(mai,pm>0?1:0,`scale(${2.4-1.4*oB(pm)}) rotate(${-24+18*oB(pm)}deg)`);
  rays.forEach((l,i)=>{const p=P(t,10.4,11.1),ang=i/rays.length*Math.PI*2,r0=90+30*oC(p),r1=r0+(70+rnd(i,7)*60)*oC(p)*(1-p*.6);
    const cx=150,cy=592;
    l.setAttribute('x1',cx+Math.cos(ang)*r0);l.setAttribute('y1',cy+Math.sin(ang)*r0*.7);
    l.setAttribute('x2',cx+Math.cos(ang)*r1);l.setAttribute('y2',cy+Math.sin(ang)*r1*.7);
    l.setAttribute('opacity',p>0&&p<1?1-p:0)});
  L8.forEach((e,i)=>{const last=i===L8.length-1,a=last?11.35:11.0+i*.07,p=P(t,a,a+(last?.3:.35));
    set(e,p>0?1:0,last?`scale(${2.6-1.6*oB(p,2.2)}) rotate(${(1-oB(p))*-30}deg)`:`translateY(${(1-oB(p))*70}px)`)});
}
let t0=null, raf=0, onEnd=null, ended=false;
function fit(){const app=$('#app'),w=app.clientWidth,h=app.clientHeight,bh=236;const s=Math.min((w-92)/390,(h-bh)/664);const box=$('#fitbox');const T=((h-bh)-664*s)/2-78*s;box.style.width=390*s+'px';box.style.height=780*s+'px';box.style.marginLeft=-195*s+'px';box.style.top=T+'px';$('#fit').style.transform=`scale(${s})`;
  const X=u=>w/2+(u-195)*s,Y=v=>T+v*s,bt=h-bh;
  // [中心x, 上端y, 幅] を画面の寸法で決めて、絵の座標に直す。文字の裏・色えらびの板の裏から顔を出す
  const P=[[Math.min(w-46,X(215)+62),Y(52),108],[Math.max(46,X(26)-54),Y(196),100],[Math.max(48,X(30)-58),Y(380),110],[Math.min(w-44,X(352)+52),Y(452),96],[Math.max(46,X(84)-56),Y(604),104]];
  [...document.querySelectorAll('#scat i')].forEach((el,k)=>{const p=P[k];if(!p)return;const ww=p[2]/s;el.style.width=ww+'px';el.style.height=ww*136/126+'px';el.style.left=((p[0]-w/2)/s+195-ww/2)+'px';el.style.top=((p[1]-T)/s)+'px'})}
window.__placeScat=()=>fit();
addEventListener('resize',fit);
const TMS=2;// タイトルムービーの速さ（倍）
function loop(now){if(t0===null)t0=now;const t=Math.min(END+60,(now-t0)/1000*TMS);render(t);if(t>=12.6&&!ended){ended=true;onEnd&&onEnd()}raf=requestAnimationFrame(loop)}
return{play(cb){cancelAnimationFrame(raf);fit();t0=null;ended=false;onEnd=cb;if(matchMedia('(prefers-reduced-motion: reduce)').matches){render(END);ended=true;cb&&cb();return}raf=requestAnimationFrame(loop)},
  skip(){cancelAnimationFrame(raf);render(END);if(!ended){ended=true;onEnd&&onEnd()}},stop(){cancelAnimationFrame(raf)},playing:()=>!ended,END}})();

let G=null, runId=0, SPEED=1;
const show=id=>document.querySelectorAll('.scr').forEach(e=>e.hidden=e.id!==id);
const taps=new Map();
const nextTap=host=>new Promise(r=>taps.set(host,r));
const bindTap=host=>host.addEventListener('click',e=>{if(e.target.closest('button'))return;const r=taps.get(host);if(r){taps.delete(host);r()}});
async function say(host,dlg,who,t){dlg.querySelector('.who').textContent=who;const tx=dlg.querySelector('.tx');phr(tx,t);tx.classList.remove('pop');void tx.offsetWidth;tx.classList.add('pop');await sleep(180);await nextTap(host)}
function choose(box,opts){return new Promise(r=>{box.innerHTML='';for(const o of opts){const b=document.createElement('button');b.type='button';b.textContent=o.t;if(o.pri)b.className='pri';b.onclick=()=>{box.innerHTML='';r(o.v)};box.appendChild(b)}})}
async function story(lines,o={}){show('story');if(!Q.on||Q.cv!==$('#sq'))$('#sq').hidden=true;$('#sbg').className='bg '+(o.bg||'mall');const dlg=$('#sdlg'),host=$('#story');dlg.hidden=false;dlg.classList.toggle('night',!!o.night);$('#schoices').innerHTML='';$('#demo').classList.remove('show');$('#mcchip').classList.remove('show');const id=runId;
  for(const L of lines){if(id!==runId)return false;if(L.bg)$('#sbg').className='bg '+L.bg;if(L.demo)$('#demo').classList.add('show');if(L.chip)$('#mcchip').classList.add('show');await say(host,dlg,L.who||'',L.t)}
  return id===runId}
// ---- タイトル
function prep(){try{const s=(Date.now()^Math.floor(Math.random()*1e9))>>>0,r=buildRun(300,s);Q.ppl.clear();Q.spr.clear();setLine(r,-1);PRE={total:300,run:r,ready:Promise.all(r.seq.map(x=>sprite(x.per)))};$('#scat').innerHTML=r.feat.map((x,k)=>`<i style="--hh:${[16,11,20,13,18][k]}px;animation-duration:${[.58,.71,.52,.66,.61][k]}s;animation-delay:${[-.1,-.45,-.27,-.62,-.38][k]}s"><svg viewBox="37 ${(4+Math.max(0,172-x.p.h)*.95).toFixed(1)} 126 136" aria-hidden="true">${person(x.p)}</svg></i>`).join('');window.__placeScat&&window.__placeScat()}catch(e){PRE=null}}
function title(){++runId;CLIP.tok++;clkStop();$("#hands").classList.remove("look");Q.cheerOK=false;$("#main").classList.remove("open");show('title');queueOff();$('#sq').hidden=true;prep();awake(false);PAUSED=false;$('#pause').classList.remove('show');$('#scat').classList.remove('show');$('#tbtn').classList.remove('show');$('#skip').hidden=false;
  const done=()=>{$('#scat').classList.add('show');$('#tbtn').classList.add('show');$('#skip').hidden=true;store.set('oshiten_seen','1')};
  TM.play(done);if(store.get('oshiten_seen')&&!title.force)TM.skip();title.force=false;$('#skip').onclick=e=>{e.stopPropagation();TM.skip()}}
// ---- 台本
let PRE=null;
const VOICE=['（拍手 鳴り止まない …え 目線が高い）','（手が細い 衣装の袖 …これ 推しのあの子の手だ）','（何て言えばいい 「中身ヲタクです」って？ 言えるわけない）','（何が起きてるのか分からないけど ここで騒いで中止にでもなったら 売上に影響が出てしまう！？）','（………やるしかない）'];
const INTRO=[{t:'（拍手 鳴り止まない …え 目線が高い）'},{t:'（手が細い 衣装の袖 …これ あの子の手だ）'},{t:'（さっきまで客席の後ろの方で 叫んでたはずなのに）'},{t:'（夢か？ 夢だよな 昨日ほとんど寝てないし）'},{who:'メンバー',t:'（小声で）「…大丈夫？ ぼーっとしてる」'},{t:'（ウワーッ メンバーの顔がこんな近くに！？）'},{t:'「だ だいじょうぶ」'},{t:'（この声…この衣装…あの子だ！ リアルすぎる 夢じゃなくて 現実！？）'},{t:'（何て言えばいい 「中身ヲタクです」って？ 言えるわけない）'},{who:'スタッフ',t:'「このあとお見送り会を行います 参加券をお持ちの方はこちらにお並びくださーい！」'},{t:'（何が起きてるのか分からないけど ここで騒いで中止にでもなったら 売上に影響が出てしまう！？）'},{t:'（それに中止になったら TLで誕生日って言ってたあの人も 午後休の人も悲しんでしまう！）'},{t:'（………やるしかない）'}];
const QUEUE=[{t:'（並んだ もう始まる）'},{who:'スタッフ',t:'「お客様 止まらず歩きながらでお願いしまーす！」'},{t:'（止まらないのか 1人あたり何秒だこれ）'},{t:'（あの子のお見送り 行った人はみんな「一人一人にまっすぐありがとうって言ってくれる」って言ってた）'},{demo:1,t:'（だったら 笑顔で返す ちゃんと言葉で返す 話に乗る あとは手を振る このへんか）'},{t:'（他推しの人にも 手くらいは振るよな あの子なら）'},{t:'（そういえばTLで「リリイベでメンカラ気づいてくれた！」「私も！」って流れてたな）'},{t:'（俺もメンカラT着てきたのに …今はあの子の衣装だ）'},{chip:1,t:'（自分の色の服の人がいたら 気づいてあげよう）'},{t:'（…とりあえず これで乗り切ろう）'}];
const BUSTED=[{bg:'room',who:'マネージャー',t:'（控室のドアを閉めて）「…ねえ 今日 本当にあの子なの？」'},{t:'（え いや その …言えるわけない）'},{who:'マネージャー',t:'「答えて」'},{bg:'dark',t:'──ふっと 視界が揺れた'},{bg:'out',t:'（会場の外 …自分の手だ）'},{t:'数日経っても TLもニュースも 何も変わらなかった'},{t:'（あれは 何だったんだろう）'},{t:'スマホの中のあの子に聞いてみる 答えは返ってこない'}];
const REQUEST=[{bg:'out',t:'（気がついたら モールの隅のベンチに座ってた 自分の手だ）'},{who:'推しの声',t:'「…おつかれさま 今日 代わってくれて ありがとう」'},{who:'推しの声',t:'「みんな 笑って帰ってくれてた」'},{who:'推しの声',t:'「あのね 私 人が多いと酔っちゃうの」'},{who:'推しの声',t:'「だから これからも お見送り 代わってくれないかな」'}];
const SAY={軽:['かわいい〜〜！！','今日も最高でした！','衣装めっちゃ似合ってる','髪型かわいい！','おつかれさま〜！','ダンスきれっきれでした'],ネタ:['今日も顔が天才','結婚してください！','推しが尊くて無理','寿命のびました','視力よくなった気がする'],深:['ずっと支えにしてます','しんどい時 歌に救われました','人生変わりました 本当に','5年間ずっと好きです'],静:['（無言でぺこりと会釈）','（手を振って通る）','（照れて俯く）'],推し:['ずっと推してます','一番好きです！','推しててよかった','一生ついていきます'],CD:['CD10枚買いました！','新曲毎日聴いてます','今日のBメロの表情 最高でした','新曲の振り付け好きです'],感謝:['いつもありがとう！','元気もらってます','笑顔に助けられてます','出会ってくれてありがとう'],遠征:['夜行バスで来ました！','北海道から来ました','始発で来ました！','遠征してきました！'],記念:['今日が初めてです！','今日で10回目です','受験おわって来ました','就職決まりました！']};
const NEWSAY=['は はじめまして…！','あの 初めて来ました','初めてなんですけど…','え えっと はじめまして'];
const GRPSAY=['いえーい！','みんなで来ました〜！','うちら全員推しです！','せーの かわいい〜！'];
const REP=['…また来ちゃいました笑','もう一回来ちゃった','何回でも来ます','さっきぶりです笑'];
const TBL={軽:{s:1,k:1,n:2,l:1},ネタ:{s:1,k:1,n:2,l:0},深:{s:1,k:1,n:0,l:2},静:{s:2,k:1,n:1,l:1},推し:{s:1,k:1,n:1,l:2},CD:{s:1,k:2,n:1,l:1},感謝:{s:1,k:1,n:1,l:2},遠征:{s:1,k:2,n:1,l:1},記念:{s:1,k:2,n:1,l:1}};
const TOPN={check:'チェックシャツ',hoodie:'パーカー',border:'ボーダー',blazer:'ジャケット',knit:'ニット',cardigan:'カーディガン',polo:'ポロシャツ',blouse:'ブラウス',shirt:'シャツ',long:'長袖',tee:'Tシャツ'};
const desc=p=>p.glasses?'メガネ':(TOPN[p.top]||'服');
// ---- 並びを作る（開演前に一括）
function buildRun(total,seed){
  const r=mul(seed),U=(a,b)=>a+(b-a)*r(),pick=a=>a[Math.floor(r()*a.length)],shf=a=>{for(let i=a.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a},W=ps=>{let t=0;for(const q of ps)t+=q[1];let x=r()*t;for(const q of ps){if((x-=q[1])<0)return q[0]}return ps[0][0]};
  const k=total/300,nCast=Math.max(2,Math.round(9*k)),nReg=Math.max(4,Math.round(26*k)),nReal=Math.max(20,Math.round(U(84,96)*k)),nHeavyReg=Math.max(3,Math.round(8*k));
  const people=[];
  // おまいつの最初の5人は おじさん4人＋若い女の子1人（どの端末でも同じ顔になるよう、決まった順に探して決める）
  {const W5=[p=>!p.female&&p.age==='o'&&!p.glasses,p=>!p.female&&p.age==='m'&&p.glasses&&p.hairT!=='thin',p=>p.female&&p.age==='y'&&p.style==='long'&&!p.glasses,p=>!p.female&&p.age!=='y'&&p.hairT==='thin'&&!p.glasses,p=>!p.female&&p.age==='m'&&!p.glasses&&p.stubble&&p.hairT!=='thin'],want=i=>W5[i];
   for(let i=0;i<nCast;i++){let p=gen(5000+i);if(i<5){for(let k=1;k<400&&!want(i)(p);k++)p=gen(5000+i+k*37)}people.push({layer:'cast',p,heavy:1})}}
  const pool=shf([...Array(100).keys()]).slice(0,nReg);
  pool.forEach((x,i)=>people.push({layer:'regular',p:gen(6000+x),heavy:i<nHeavyReg?1:0}));
  while(people.length<nReal)people.push({layer:'new',p:gen(20000+Math.floor(r()*900000))});
  const news=people.filter(x=>x.layer==='new');
  if(news[0]){news[0].tl='bd'}
  if(news[1]){news[1].tl='pm';Object.assign(news[1].p,{top:'blazer',cloth:'#33383F',collarIn:1,inn:'#F4F0EA',short:0,print:0})}
  // 周回の枚数
  const heavy=people.filter(x=>x.heavy),light=people.filter(x=>x.layer==='regular'&&!x.heavy),twice=shf(news.filter(x=>!x.tl)).slice(0,Math.round(12*k));
  const need=total-1;let L=2;
  const sum=L=>nReal+heavy.length*(L-1)+light.length*(Math.ceil(L/2)-1)+twice.length;
  while(sum(L+1)<=need)L++;
  people.forEach(x=>x.laps=1);heavy.forEach(x=>x.laps=L);light.forEach(x=>x.laps=Math.ceil(L/2));twice.forEach(x=>x.laps=2);
  let s=people.reduce((a,x)=>a+x.laps,0),guard=0;
  while(s<need&&guard++<2000){const x=pick(light.length?light:heavy);if(x.laps<L){x.laps++;s++}else{const y=pick(news);if(y.laps<2){y.laps++;s++}else if(guard>1500){pick(heavy).laps++;s++}}}
  // 列の再現: 通ったら最後尾に並び直す
  const line=shf(people.slice()),seq=[];
  // 連れ：若い初回の2〜3人を列の中で隣同士にしておく（最後の1人が話しかけてくる）
  {const nG=Math.max(1,Math.round(6*k));const yn=shf(line.filter(x=>x.layer==='new'&&x.laps===1&&!x.tl&&x.p.age==='y'));
   for(let q=0;q<nG&&yn.length>=2;q++){const m=yn.splice(0,(yn.length>=3&&r()<.4)?3:2);m.forEach(x=>{x.pal=q+1;line.splice(line.indexOf(x),1)});line.splice(1+Math.floor(r()*(line.length-1)),0,...m)}}
  while(seq.length<need&&line.length){const x=line.shift();x.done=(x.done||0)+1;seq.push({per:x,lap:x.done});if(x.done<x.laps)line.push(x)}
  const last={layer:'new',p:gen(30000+Math.floor(r()*900000)),laps:1};seq.push({per:last,lap:1});
  const N=seq.length;
  const palEnd=[];seq.forEach((x,i)=>{const nx=seq[i+1];if(x.per.pal){if(nx&&nx.per.pal===x.per.pal)x.tight=1;else if(i>4&&seq[i-1].tight){x.grp=1;palEnd.push(i)}}});
  // 話しかけてくる客の位置（後半ほど密）
  const nE=Math.max(6,Math.round(43*k)),slots=new Set([3,N-1,...palEnd]);let g2=0;
  const feat=people.filter(x=>x.layer==='cast').slice(0,5);feat.forEach(x=>x.feat=1);
  while(slots.size<nE&&g2++<5000){const i=Math.floor(r()*N);const w=i>N*.8?1:.38;if(i>3&&r()<w)slots.add(i)}
  const bw=[N*.4,N*.6],kw=[N*.3,N*.8];let breakAt,kidsAt,g3=0;
  do{breakAt=Math.floor(U(bw[0],bw[1]));kidsAt=Math.floor(U(kw[0],kw[1]))}while((Math.abs(breakAt-kidsAt)<N*.08||slots.has(breakAt)||slots.has(kidsAt))&&g3++<500);
  // おまいつの5人は 必ず1回は話しかけてくる
  feat.forEach(x=>{const mine=seq.map((q,i)=>q.per===x?i:-1).filter(i=>i>4&&i<N-1&&i!==breakAt&&i!==kidsAt);if(mine.length&&!mine.some(i=>slots.has(i)))slots.add(mine[Math.floor(r()*mine.length)])});
  // 始まる前に手を振りまくった分だけ 前半に話しかけてくる人が増える。その候補（実際に話しかけるかは始まった時に決める）
  {const nB=Math.max(6,Math.round(20*k)),bonus=[];let g4=0;
   while(bonus.length<nB&&g4++<3000){const i=4+Math.floor(r()*Math.max(1,Math.floor(N*.35)-4)),q=seq[i]&&seq[i].per;if(q&&!slots.has(i)&&!bonus.includes(i)&&i!==breakAt&&i!==kidsAt&&q.layer!=='cast'&&!q.tl&&!q.pal&&q!==last)bonus.push(i)}
   bonus.sort((a,b)=>a-b).forEach((i,j)=>{slots.add(i);seq[i].bonus=j+1})}
  // 推し色の人
  const engPer=[...new Set([...slots].map(i=>seq[i].per))].filter(x=>!x.tl&&x!==last);
  {const safe=['#6B7280','#2F3A56','#F4F1EC','#C9B89A','#33383F','#8FA3B8'].filter(c=>!nearMC(c));[...people,last].forEach((x,k)=>{if(nearMC(x.p.cloth))x.p.cloth=safe[k%safe.length];if(nearMC(x.p.inn))x.p.inn='#F4F0EA'})}
  // 推し色を着るのは 若い人（何周もする人ほど）とおじさん。おばさんは着ない。上着の前を開けて 中に着ている人もいる
  {const wMC=x=>{const p=x.p;if(p.female&&p.age!=='y')return 0;return(p.age==='y'?3:1)*(x.laps>=2?2.5:1)};
   const cand=engPer.filter(x=>wMC(x)>0),nMC=Math.max(1,Math.round(nE*.12)),out=[];
   while(out.length<nMC&&cand.length){let t=0;cand.forEach(x=>t+=wMC(x));let v=r()*t,j=0;for(;j<cand.length-1;j++){if((v-=wMC(cand[j]))<0)break}out.push(cand.splice(j,1)[0])}
   const pcOf=c=>{const n=parseInt(c.slice(1),16);return(.2126*(n>>16)+.7152*(n>>8&255)+.0722*(n&255))/255>.66?'#2B2540':'#FFFFFF'};
   out.forEach(x=>{x.mc=1;const p=x.p,open=['cardigan','blazer','check'].includes(p.top);
     if(open?r()<.75:(p.age!=='y'&&r()<.35)){if(!open)Object.assign(p,p.female?{top:'cardigan',cloth:pick(['#F1EEE8','#D8D4CC','#6B7280','#2F3A56'])}:{top:'check',cloth:pick(['#3D4B63','#56705A','#5E7C9B','#7A5C48','#6C6A5C'].filter(c=>!nearMC(c)).concat('#6C6A5C')),c2:pick(['#F1EEE8','#2B2B30'])});Object.assign(p,{inn:MC,collarIn:0});x.mcIn=1}
     else Object.assign(p,{top:'tee',cloth:MC,pc:pcOf(MC),print:1+Math.floor(r()*6),short:1})})}
  let firstE=true;const seenE=new Set();
  seq.forEach((g,i)=>{g.i=i;const per=g.per,p=per.p;
    if(g.lap>=3&&['cardigan','blazer','check'].includes(p.top)&&!per.mc&&!per.tl&&r()<.08){if(!per.alt)per.alt=Object.assign({},p,{top:'tee',cloth:p.inn&&p.inn!=='#F4F0EA'?p.inn:'#D8D4CC',print:0,short:1,collarIn:0});g.alt=1}
    if(!slots.has(i))return;
    const e={};g.eng=e;const isLast=i===N-1,rep=g.lap>=2;
    if(g.bonus){e.first=false;e.staller=false}else{e.first=firstE;firstE=false}e.last=isLast;e.repeat=rep;
    e.tone=W([['軽',3],['ネタ',2],['深',1.5],['静',2],['推し',2],['CD',4],['感謝',4],['遠征',1.5],['記念',1.5]]);
    e.pace=W([['normal',80],['fast',15],['slow',5]]);
    e.staller=!g.bonus&&!e.first&&!isLast&&per.layer!=='cast'&&!rep&&!per.tl&&r()<.045;
    if(per.tl==='bd'&&!rep){e.tone='記念';e.say='今日ちょっと特別な日で'}
    else if(per.tl==='pm'&&!rep){e.tone='軽';e.say='ギリ間に合った…'}
    else if(isLast){e.tone='感謝';e.say='今日 来てよかったです'}
    else if(e.staller){e.tone='深';e.say='ずっと言いたかったんですけど──'}
    else if(rep&&e.tone!=='静'&&r()<.4){e.say=pick(REP);e.ann=1}
    else e.say=pick(SAY[e.tone]);
    e.kind=e.first?null:g.grp?'grp':(per.layer==='new'&&g.lap===1&&!per.tl&&!isLast&&!e.staller)?'new':(per.layer==='cast'&&!rep&&!e.staller&&e.tone!=='静')?'cast':null;
    if(e.kind==='cast'&&e.tone==='深'){e.tone='ネタ';e.say=pick(SAY['ネタ'])}
    if(e.kind==='grp'){e.tone='ネタ';e.say=pick(GRPSAY);e.staller=false;e.pace='normal'}
    else if(e.kind==='new'){if(e.tone==='静')e.say='（緊張した顔で 小さく会釈）';else{e.tone='軽';e.say=pick(NEWSAY)}}
    e.silent=e.tone==='静';
    e.windowMs=e.first?2200:isLast?1100:e.pace==='fast'?1300:e.silent?1700:rep?1800:2000+(e.pace==='slow'?400:0);
    e.approach=e.pace==='fast'?750:950;
    e.hasMC=!!per.mc;
    if(e.first)e.inner='';
    else if(per.layer==='cast'&&!seenE.has(per))e.inner='（いつもの人だ！）';
    else if(e.ann&&r()<.5)e.inner=`（さっきの${desc(p)}の人だ ${g.lap}周目…！）`;
    else e.inner='';
    seenE.add(per)});
  return{seq,N,breakAt,kidsAt,nReal,nE,L,feat}}
window.__buildRun=buildRun;
// ---- 列（背景）: いま実際に並んでいる人を、蛇腹の列として奥まで描く
const Q={spr:new Map(),ppl:new Map(),order:[],cv:null,on:false,t0:0};
function sprite(per){let o=Q.spr.get(per);if(o)return o.ready;o={img:null};Q.spr.set(per,o);
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="37 4 126 180" width="200" height="286"><style>${$('#pcss').textContent}</style>${person(per.p)}</svg>`;
  o.ready=new Promise(res=>{const im=new Image();im.onload=()=>{try{const c=document.createElement('canvas');c.width=200;c.height=286;c.getContext('2d').drawImage(im,0,0,200,286);o.img=c}catch(e){}res()};im.onerror=()=>res();im.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg)});
  return o.ready}
function lineAt(run,i){const out=[],seen=new Set(),cur=i>=0?run.seq[i].per:null,lastP=run.seq[run.N-1].per;let dup=false;
  for(let j=i+1;j<run.N;j++){const p=run.seq[j].per;if(seen.has(p)){dup=true;continue}seen.add(p);if(p!==cur)out.push(p)}
  if(dup||(cur&&run.seq.slice(i+1).some(g=>g.per===cur))){const k=out.indexOf(lastP);if(k>=0)out.splice(k,1)}
  return out}
const QR={hor:.13,y0:.9,h0:.36,k:.81};
function rows(W,Hs){const a=[];let n=0;for(let r=0;r<16;r++){const s=Math.pow(QR.k,r),h=QR.h0*Hs*s,w=h*126/180,cap=Math.max(3,Math.floor(W*1.06/(w*.84)));a.push({r,s,h,w,y:(QR.hor+(QR.y0-QR.hor)*s)*Hs,cap,from:n});n+=cap}return a}
function slot(R,k,W){let row=R[R.length-1];for(const x of R){if(k<x.from+x.cap){row=x;break}}
  const j=Math.min(k-row.from,row.cap-1),t=(j+.5)/row.cap,x=(row.r%2?t:1-t)*W*1.06-W*.03;return{x,row}}
function setLine(run,i){const order=lineAt(run,i);Q.order=order;const keep=new Set(order);
  for(const [p,o] of Q.ppl){if(!keep.has(p))Q.ppl.delete(p)}
  order.forEach((p,k)=>{let o=Q.ppl.get(p);if(!o){o={k,x:null,y:0,h:0,ph:(p.p.seed||k)*1.7%6.28,jx:((k*7919)%13-6)/100};Q.ppl.set(p,o)}o.k=k;sprite(p)})}
function cheerY(now,r,ph,h){if(!Q.cheer||(ph*7.3)%1>.7)return 0;const e=(now-Q.cheer)/1000-r*.05-(ph*3.1)%1*.08;return e>0&&e<.42?Math.sin(e/.42*Math.PI)*h*.09:0}
function drawQ(now){if(!Q.on)return;requestAnimationFrame(drawQ);const cv=Q.cv;if(!cv||!cv.offsetParent)return;
  const dpr=Math.min(2,window.devicePixelRatio||1),W=cv.clientWidth,H=cv.clientHeight;if(!W)return;
  if(cv.width!==Math.round(W*dpr)){cv.width=Math.round(W*dpr);cv.height=Math.round(H*dpr)}
  const Hs=cv.dataset.full?H*.6:H,c=cv.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,W,H);
  const dt=Math.min(.1,(now-(Q.t0||now))/1000);Q.t0=now;const a=1-Math.exp(-dt*3.2),R=rows(W,Hs),t=now/1000;
  // 床
  const fy=QR.hor*Hs+6;const g=c.createLinearGradient(0,fy,0,Hs);g.addColorStop(0,'#E3DCD3');g.addColorStop(1,'#F1EAE0');c.fillStyle=g;c.fillRect(0,fy,W,Hs-fy);
  const byRow=R.map(()=>[]);
  for(const [p,o] of Q.ppl){const s=slot(R,o.k,W),tx=s.x+o.jx*s.row.w,ty=s.row.y,th=s.row.h;
    if(o.x===null){o.x=s.row.r%2?W*1.2:-W*.2;o.y=ty;o.h=th;if(Q.fresh){o.x=tx}}
    o.x+=(tx-o.x)*a;o.y+=(ty-o.y)*a;o.h+=(th-o.h)*a;
    let ri=0,best=1e9;for(const x of R){const d=Math.abs(x.h-o.h);if(d<best){best=d;ri=x.r}}byRow[ri].push([p,o])}
  Q.fresh=false;
  for(let r=R.length-1;r>=0;r--){const row=R[r],list=byRow[r];if(!list.length&&r>0&&!byRow.slice(0,r).some(x=>x.length))continue;
    list.sort((A,B)=>A[1].x-B[1].x);
    for(const [p,o] of list){const im=Q.spr.get(p)&&Q.spr.get(p).img;if(!im)continue;const h=o.h,w=h*200/286,bob=Math.sin(t*1.1+o.ph)*h*.006-cheerY(now,r,o.ph,h),look=p.layer==='new'&&!p.passed&&!p.tl&&o.ph%1<.55;if(look){const a=Math.sin(t*2.4+o.ph*3)*.06;c.save();c.translate(o.x+Math.sin(t*2.4+o.ph*3)*h*.03,o.y+bob);c.rotate(a);c.drawImage(im,-w/2,-h,w,h);c.restore()}else c.drawImage(im,o.x-w/2,o.y-h+bob,w,h)}
    if(list.length){const by=row.y-row.h*.3,th=Math.max(1.6,row.h*.042);c.fillStyle='rgba(44,40,66,.92)';c.fillRect(0,by,W,th);
      const step=row.w*1.9;for(let x=(r%2?step*.3:step*.8);x<W;x+=step){c.fillStyle='#8E8AA0';c.fillRect(x-th*.7,by-th*1.4,th*1.4,row.h*.34);c.fillStyle='#C9C6D6';c.fillRect(x-th*.9,by-th*1.9,th*1.8,th*.9)}}
    c.globalCompositeOperation='source-atop';c.fillStyle='rgba(236,238,244,.075)';c.fillRect(0,0,W,row.y);c.globalCompositeOperation='source-over'}
  c.globalCompositeOperation='source-atop';c.fillStyle='rgba(240,238,244,.16)';c.fillRect(0,0,W,Hs);c.globalCompositeOperation='source-over';
  if(cv.dataset.full){c.fillStyle='#F4EEE6';c.fillRect(0,Hs*.88,W,H);const tg=c.createLinearGradient(0,Hs*.88,0,Hs);tg.addColorStop(0,'#fff');tg.addColorStop(1,'#EDE6F0');c.fillStyle=tg;c.fillRect(0,Hs*.88,W,Hs*.12);c.fillStyle='#E84C7A';c.fillRect(0,Hs*.88,W,4)}}
function queueOn(cv){Q.cv=cv;Q.fresh=true;for(const o of Q.ppl.values())o.x=null;if(!Q.on){Q.on=true;Q.t0=0;requestAnimationFrame(drawQ)}}
function queueOff(){Q.on=false}
window.__Q=Q;window.__setLine=setLine;
// ---- 本編の部品
const stage=()=>$('#stage');
function curX(el){return parseFloat(getComputedStyle(el).left)/el.parentElement.clientWidth*100}
function move(el,from,to,ms,ease){if(from==null)from=curX(el);if(el._a)el._a.cancel();el.style.left=from+'%';const a=el.animate([{left:from+'%'},{left:to+'%'}],{duration:Math.max(1,ms/SPEED),easing:ease||'linear',fill:'forwards'});el._a=a;return a.finished.then(()=>{el.style.left=to+'%'},()=>{})}
function spawn(g,cls){const el=document.createElement('div');el.className='fan vis '+(cls||'');const p=g.alt&&g.per.alt&&!g.per.mc?g.per.alt:g.per.p;for(const q in p.mvars)el.style.setProperty(q,p.mvars[q]);
  if(g.per.mc){el.classList.add('mcp');const late=G&&g.i>G.run.N*.8;el.style.setProperty('--pulse',isEng(g)?(G.mcSeen?(late?.45:.75):1.7):(late?.3:.5))}
  el.innerHTML=`<div class="stp" style="--sp:${(.46+Math.random()*.16).toFixed(2)}s;animation-delay:-${Math.random().toFixed(2)}s"><svg viewBox="37 4 126 180" aria-hidden="true">${person(p)}</svg></div>`;if(g.per&&g.per.layer){const per=g.per;
    if(g.grp||g.tight)el.classList.add('pal');
    else if(per.layer==='new'&&g.lap===1&&!per.tl)el.classList.add('shy');
    else if(g.lap>=2||per.layer==='cast')el.classList.add('easy')}
  stage().insertBefore(el,$('#table'));return el}
function hands(k){const h=$('#hands');h.className='';void h.offsetWidth;h.className=k;clearTimeout(h._t);h._t=setTimeout(()=>{h.className='';h.style.translate=''},620)}
function aim(el){const h=$('#hands'),st=stage();if(!el||!st)return;const b=el.getBoundingClientRect(),sb=st.getBoundingClientRect();const dx=clamp((b.left+b.width/2-(sb.left+sb.width/2))*.45,-sb.width*.22,sb.width*.22);h.style.translate=dx.toFixed(1)+'px 0'}
function stars(){const s=$('#stars');s.classList.remove('go');void s.offsetWidth;s.classList.add('go')}
const inner=t=>{phr($('#inner'),t||'')},memo=t=>{phr($('#memo'),t||'')};
let bubTok=0;
async function bubble(t,el){const b=$('#bubble'),tok=++bubTok;phr(b,t);b.classList.remove('pop');void b.offsetWidth;b.classList.add('show','pop');const talk=el&&!t.startsWith('（');if(talk)el.classList.add('on');await sleep(Math.min(1600,300+t.length*70)/SPEED);if(el)el.classList.remove('on')}
const bubbleOff=()=>{bubTok++;$('#bubble').classList.remove('show')};
// むやみな連打：誰もいない所・振り終えた人・推し色でない人を続けて叩くと 挙動不審で少し怪しまれる
const STRAY={t:[],cool:0};
function stray(){if(!G||PAUSED||Q.cheerOK||$('#main').hidden||$('#over').classList.contains('show')||!$('#story').hidden)return;const n=performance.now();STRAY.t=STRAY.t.filter(x=>n-x<1200);STRAY.t.push(n);
  if(STRAY.t.length>=3&&n>STRAY.cool){STRAY.cool=n+2000;STRAY.t=[];addSus(3,'flail');if(!G.toldFlail){G.toldFlail=1;inner('（やみくもに振ると 変に見られる）')}}}
function addSus(d,why){const s=G.sus;G.sus=Math.max(0,Math.min(100,G.sus+d));G.susMax=Math.max(G.susMax,G.sus);G.log.push({seq:G.i+1,delta:d,why});if(G.sus>s){const m=$('#mgr');m.classList.add('glare');clearTimeout(m._t);m._t=setTimeout(()=>m.classList.remove('glare'),1300)}}
const FLOW=[];
const faceSvg=p=>`<svg viewBox="37 4 126 180" preserveAspectRatio="xMidYMin slice" aria-hidden="true">${person(p)}</svg>`;
let gq=Promise.resolve();
let gTok=0,gCur=null;
function guide(key,t,card){if(!G||G.guided[key])return;const el=$('#guide'),id=G.id,now=performance.now();
  if(gCur&&now-gCur.t<1300/SPEED&&G.guided)G.guided[gCur.key]=0;  // 読む間もなく次が来たものは、次の機会にもう一度出す
  G.guided[key]=1;const tok=++gTok;gCur={key,t:now};
  document.querySelectorAll('#cards .tip').forEach(x=>x.classList.remove('tip'));$('#cards').classList.remove('tipall');
  phr(el.querySelector('.tx'),t);el.classList.remove('show');void el.offsetWidth;el.classList.add('show');
  const cb=card&&document.querySelector(`#cards button[data-v="${card}"]`);if(cb)cb.classList.add('tip');if(card==='all')$('#cards').classList.add('tipall');
  sleep(Math.max(2600,t.length*150)/SPEED).then(()=>{if(tok!==gTok)return;el.classList.remove('show');if(cb)cb.classList.remove('tip');$('#cards').classList.remove('tipall');gCur=null})}
window.__wave=()=>waveTap();
function waveTap(){if(Q.cheerOK){const n=performance.now();if(!Q.cheer||n-Q.cheer>450)Q.cheer=n;if(G&&(!G.lastCheer||n-G.lastCheer>180)){G.lastCheer=n;G.cheerN=(G.cheerN||0)+1}}const f=FLOW.find(x=>!x.tapped);hands('two');if(f)f.wave();else if(!Q.cheerOK)stray()}
function doFlow(g){const el=spawn(g);const mc=!!g.per.mc;G.st.flowTotal++;if(mc)G.st.mcTotal++;
  const f={el,tapped:false,seen:false};FLOW.push(f);
  if(G.st.flowTotal===1){guide('tapP1','来てくれたよ！ 手を振ってあげて！')}else if(FLOW.length>=3)guide('one','一人ずつ振ってあげてね');
  f.wave=()=>{aim(el);if(!f.tapped){f.tapped=true;G.st.flowTap++;el.classList.add('waved');const sv=el.querySelector('svg');if(sv)sv.animate([{transform:'translateY(0)'},{transform:'translateY(-9px)'},{transform:'translateY(0)'}],{duration:340,easing:'ease-out'})}};
  el.style.cursor='pointer';
  // 客を押す操作を教える：押すまで 最初の3人まで 客の上に指の印を出す
  if(!G.guided.tapP&&(G.fingN||0)<3&&!mc){G.fingN=(G.fingN||0)+1;el.insertAdjacentHTML('beforeend','<i class="fing" aria-hidden="true"><svg viewBox="0 0 60 72"><path d="M18 8a6 6 0 0 1 12 0v22l2-1a6 6 0 0 1 8 3l2-1a6 6 0 0 1 8 3l1 0a6 6 0 0 1 7 6v12c0 10-8 18-18 18h-6c-6 0-10-3-13-8L9 50a6 6 0 0 1 9-7V8z" fill="#fff" stroke="#2B2540" stroke-width="3" stroke-linejoin="round"/></svg></i>')}
  if(mc&&!G.mcRing){G.mcRing=1;el.classList.add('tapme')}
  el._mcTap=mc;el._tap=()=>{if(!G.guided.tapP){G.guided.tapP=1;document.querySelectorAll('.fan .fing').forEach(x=>x.remove())}if(f.tapped&&(!mc||f.seen))stray();hands('two');f.wave();if(mc&&!f.seen){f.seen=true;el._mcTap=false;G.st.mcHit++;G.mcSeen=1;stars();hlPush('mc',fp(g),'（服を見たのに気づいて その場で小さく跳ねた）');el.classList.add('glad');el.querySelector('svg').animate([{transform:'translateY(0)'},{transform:'translateY(-14px)'},{transform:'translateY(0)'},{transform:'translateY(-8px)'},{transform:'translateY(0)'}],{duration:520,easing:'ease-out'});memo('（服を見たのに気づいて その場で小さく跳ねた）')}};
  if(mc)guide('mc','私の色の服を着てくれてる！');
  return move(el,112,-42,1900).then(()=>{const k=FLOW.indexOf(f);if(k>=0)FLOW.splice(k,1);if(!f.tapped&&!f.ex)G.st.flowMiss++;el.remove()})}
// 列の間隔：等間隔にしない。数人が詰まって来る／ふっと空く／ふつう、を混ぜる
function gapMaker(seed){const r=mul(seed+991);let left=0,kind='n';return late=>{if(left<=0){const x=r();kind=x<.38?'b':x<.6?'l':'n';left=kind==='b'?2+Math.floor(r()*4):kind==='l'?1:1+Math.floor(r()*3)}left--;
  const v=kind==='b'?560+r()*220:kind==='l'?1700+r()*900:820+r()*420;return v*(late?.85:1)}}
// 始まる前の手振り：3回までは何も起きず、そこから2回ごとに 前半の話しかけてくる人が1人増える
function setExtra(){if(G)G.extra=Math.max(0,Math.floor(((G.cheerN||0)-3)/2))}
const isEng=g=>!!g.eng&&!(g.bonus>((G&&G.extra)||0));
function doEngage(g){let decided;const dp=new Promise(r=>decided=r);const done=engageBody(g,decided).then(decided,decided);return{dp,done}}
async function engageBody(g,decided){const e=g.eng,el=spawn(g);
  if(e.first)guide('eng','話しかけられたら 返してあげて！','all');
  else if(e.hasMC)guide('mc','私の色の服を着てくれてる！');
  else if(e.staller)guide('stall','止まる人は スタッフさんに任せてね');
  else if(e.ann)guide('rep','また来てくれた人だよ 覚えてるって伝えて','k');
  else if(e.kind==='grp')guide('grp','連れの子たちとは 一緒に盛り上がって！','n');
  else if(e.kind==='new')guide('new','初めての人には にっこりしてあげて','s');
  else if(e.kind==='cast')guide('cast','いつも来てくれる人だよ ノリよく返してね','n');
  else if(e.tone==='深')guide('deep','大事な話だよ 最後まで聞いてあげて','l');
  else if(e.silent)guide('sil','緊張してる人には にっこりしてあげて','s');
  else if(e.tone==='感謝'||e.tone==='推し')guide('listen','気持ちは 最後まで聞いてあげて','l');
  else if(e.tone==='CD'||e.tone==='遠征'||e.tone==='記念')guide('info','教えてくれたことに 言葉で返してあげて','k');G.st.engTotal++;if(e.ann)G.st.repeatTotal++;if(e.hasMC)G.st.mcTotal++;if(g.per.feat)G.st.omaiTotal++;
  G.waveRes=null;memo('');inner('');
  let mv=null;if(e.staller)await move(el,112,62,e.approach,'ease-out');else{mv=move(el,112,-6,e.approach+e.windowMs).then(()=>null);el.classList.add('cling');await sleep(230/SPEED)}
  bubble(e.say,el);$('#guide').classList.remove('show');inner(e.inner);
  $('#wave .hint').classList.remove('show');{const cd=$('#cards');cd.classList.add('show','arm');sleep(300).then(()=>cd.classList.remove('arm'))}FLOW.forEach(f=>f.ex=1);
  let res;const pickP=new Promise(r=>res=r);G.cardRes=v=>res(v);el.style.cursor='pointer';if(e.hasMC&&!G.mcRing2){G.mcRing2=1;el.classList.add('tapme')}el._mcTap=!!e.hasMC;el._tap=()=>{if(e.hasMC)res('mc');else stray()};
  let choice=null;
  if(e.staller){const t0=performance.now();let told=false;
    for(let kk=0;kk<Math.round(32/SPEED);kk++){const v=await Promise.race([pickP.then(x=>x),sleep(120).then(()=>null)]);if(v&&!told){told=true;bubble('──それでね 去年の秋のあの現場が最後で──',el)}}
    G.cardRes=null;$('#cards').classList.remove('show');decided();
    await sleep(260/SPEED);el.style.transform='translateX(-50%) rotate(-7deg)';G.st.pushed++;memo('（後ろから押し出された）');if(!G.pushSeen){G.pushSeen=1;inner('（立ち止まる人は こうやって流されるんだ）')}
    bubbleOff();await move(el,null,-46,480,'ease-in');el.remove();return}
  choice=await Promise.race([pickP,mv]);el.classList.remove('cling');
  G.cardRes=null;el._tap=null;el._mcTap=false;$('#cards').classList.remove('show');decided();
  const cast=g.per.layer==='cast';let out,txt;
  if(e.hasMC)G.mcSeen=1;
  if(choice===null){G.st.pass++;txt='（目が合わないまま行っちゃった）';out='pass'}
  else if(choice==='mc'){G.st.mcHit++;G.st.good++;out='good';txt='（服を見たら 口を覆って喜んだ）';stars()}
  else{const v=e.kind==='cast'?{s:1,k:1,n:2,l:1}[choice]:e.kind==='new'?{s:2,k:0,n:1,l:1}[choice]:e.kind==='grp'?{s:1,k:0,n:2,l:0}[choice]:TBL[e.tone][choice];
    if(choice==='l')stage().animate([{transform:'translateY(0)'},{transform:'translateY(6px)'},{transform:'translateY(0)'},{transform:'translateY(4px)'},{transform:'translateY(0)'}],{duration:560,easing:'ease-in-out'});else if(choice==='n')hands('one');else if(choice==='s')stars();
    const unlike=false;
    if(e.tone==='深'&&choice==='n')addSus(6,'deep-accident');
    if(cast&&e.ann&&choice!=='k'&&!g.per.caught){g.per.caught=1;addSus(12,'cast-contradiction')}
    if(e.ann&&choice==='k'){out='good';G.st.good++;G.st.repeatHit++;txt='（「覚えて…？」って顔で出ていった）'}
    else if(v===2){out='good';G.st.good++;txt=e.last?'（今日いちばんの顔だった）':e.silent?'（小さく振り返してくれた）':'（ぱっと明るい顔で出ていった）'}
    else if(v===1){out='neutral';G.st.neutral++;txt='（にこにこ会釈して行った）'}
    else{out='bad';G.st.mismatch++;txt='（一瞬 間があった）';
      if(e.kind==='new'&&choice==='k'){txt='（「誰かと間違えてる…？」って顔をした）';addSus(5,'new-individual');if(!G.toldNew){G.toldNew=1;setTimeout(()=>inner('（初めての人に 知ってる風は変か…）'),600)}}
      if(e.kind==='grp'&&choice==='k'){txt='（連れの子が先に流されていった）';if(!G.toldGrp){G.toldGrp=1;setTimeout(()=>inner('（連れの子には 軽く返すのがいいのか）'),600)}}}
    if(out==='good'&&e.kind==='grp')txt='（みんなで笑いながら出ていった）';
    if(g.per.feat&&choice==='k'){if(out==='bad')G.st.mismatch--;else if(out==='neutral')G.st.neutral--;if(out!=='good')G.st.good++;out='good';G.st.omai++;stars();txt='（「覚えてくれてる…！？」って振り返った）';if(!G.toldOmai){G.toldOmai=1;setTimeout(()=>inner('（顔を覚えててよかった）'),500)}}
    if(out==='good'&&!unlike){G.streak++;if(G.streak%3===0)addSus(-2,'good-streak')}else G.streak=0;
    if(g.per.tl&&choice==='k'&&!e.repeat){txt='（「え なんで知って…」と固まった）'}}
  if(choice==='mc')hlPush('mc',fp(g),e.say);else if(g.per.feat&&choice==='k')hlPush('omai',fp(g),e.say);else if(e.ann&&choice==='k')hlPush('rep',fp(g),e.say);else if(out==='good')hlPush('good',fp(g),e.say);
  {const b=bestOf(e,g);const miss=out==='bad'||out==='pass'||(e.hasMC&&choice!=='mc')||(e.ann&&choice!=='k'&&choice!=='mc');
   if(miss)G.rev.push({p:g.alt&&g.per.alt&&!g.per.mc?g.per.alt:g.per.p,seq:g.i+1,say:e.say,choice,best:b.best,why:b.why})}
  memo(txt);if(e.first)inner('（今ので合ってた？ 顔を見るしかない）');
  bubbleOff();await move(el,null,-46,out==='pass'?600:e.pace==='fast'?550:850,'ease-in');el.remove()}
// ---- 壁の時計：14:44:00 から本物の速さで進む。一時停止の間は止まる
const CLK={on:false,acc:0,last:0,w:[],tk:0};
{const g=$("#cticks");if(g){let h="";for(let k=0;k<60;k++){const a=k*6*Math.PI/180,big=k%5===0,r0=big?36:40;h+=`<line x1="${(50+Math.sin(a)*r0).toFixed(2)}" y1="${(50-Math.cos(a)*r0).toFixed(2)}" x2="${(50+Math.sin(a)*43).toFixed(2)}" y2="${(50-Math.cos(a)*43).toFixed(2)}" stroke="#4A4460" stroke-width="${big?3:1}"/>`}g.innerHTML=h}}
function clkDraw(){const s=CLK.acc,f=s-Math.floor(s),sec=Math.floor(s)+Math.min(1,f*7),m=44+s/60,hr=2+m/60;
  const R=(id,d)=>{const e=$(id);if(e)e.setAttribute("transform",`rotate(${d.toFixed(2)} 50 50)`)};R("#csh",sec*6);R("#cmh",m*6);R("#chh",hr*30)}
function clkLoop(now){if(!CLK.on)return;if(!PAUSED)CLK.acc+=Math.min(.25,(now-CLK.last)/1000);CLK.last=now;clkDraw();
  CLK.w=CLK.w.filter(x=>{if(CLK.acc>=x.t){x.r();return false}return true});requestAnimationFrame(clkLoop)}
function clkStart(at){CLK.acc=at;{const c=$("#clock");if(c)c.classList.remove("ring","gone")}CLK.w=[];CLK.last=performance.now();clkDraw();if(!CLK.on){CLK.on=true;requestAnimationFrame(clkLoop)}}
function goSignal(){const c=$("#clock");if(!c)return;c.classList.remove("ring");void c.offsetWidth;c.classList.add("ring");sleep(1000).then(()=>c.classList.add("gone"))}
function clkStop(){CLK.on=false;CLK.w=[]}
const clkAt=t=>new Promise(r=>{if(CLK.acc>=t)r();else CLK.w.push({t,r})});
const OPEN=[{who:"スタッフ",t:"「このあとお見送り会を行います 参加券をお持ちの方はこちらにお並びくださーい！」"},{who:"スタッフ",t:"「お客様 止まらず歩きながらでお願いしまーす！」"}];
// 始まる前の推しの声は1つだけ。スタッフの2行を読み終えた時か 14:44:50 の早い方で出す
// 始まる前の声：読み終えたら（遅くても 14:44:40 に）1つ目、そのあと時刻ごとに。読んでいる途中には重ねない【仮：文】
const OSHI=[[39,"手を振ると みんな喜ぶよ"],[45,"振ったら みんな返してくれるよ"],[51,"来てくれた人の顔 ちゃんと見てあげてね"],[56,"話しかけてくれたら 返してあげてね"]];
async function oshiTalk(id,early){const ok=()=>id===runId&&CLK.acc<60;await Promise.race([early,clkAt(40)]);if(!ok())return;guide("wave","列のみんなに 手を振ってあげて！");
  for(const[t,x]of OSHI){await Promise.all([clkAt(t),early]);if(!ok())return;guide("o"+t,x)}}
// 14:45:00 になったら 読んでいる途中でも打ち切って始める。読み終えたら 14:45 まで待つ
async function doOpen(id){const o=$("#over"),dlg=$("#odlg"),at=clkAt(60);let cut=false;at.then(()=>{cut=true});
  o.className="show soft";$("#ochoices").innerHTML="";dlg.hidden=false;inner("");memo("");$("#main").classList.add("open");Q.cheerOK=true;// 始まった時から 並んでいる客の顔を押せば手を振れる。読み進めるのはスタッフの話の枠を押した時だけ
  let readDone;oshiTalk(id,new Promise(r=>readDone=r));
  for(const L of OPEN){if(cut||id!==runId)break;dlg.querySelector(".who").textContent=L.who||"";const tx=dlg.querySelector(".tx");phr(tx,L.t);tx.classList.remove("pop");void tx.offsetWidth;tx.classList.add("pop");
    await Promise.race([sleep(180),at]);if(cut)break;await Promise.race([nextTap(o),at]);taps.delete(o)}
  taps.delete(o);o.className="";readDone();if(!cut&&id===runId){$("#wave .hint").classList.add("show");Q.cheerOK=true}
  await at;Q.cheerOK=false;setExtra();$("#main").classList.remove("open");if(id!==runId)return;inner("");goSignal()}
async function overSay(who,t){const o=$('#over');await say(o,$('#odlg'),who,t)}
async function doBreak(){const o=$('#over');o.className='show';$('#ochoices').innerHTML='';inner('');memo('');
  await overSay('スタッフ','「一度止めまーす！」');
  const hot=G.sus>=40;$('#mgr').classList.add('glare');
  await overSay('マネージャー',hot?'「…ねえ さっきから何回か いつもと違う 返し してるよね」':'「ねえ …今日なんか変じゃない？」');
  $('#odlg').hidden=true;const c=await choose($('#ochoices'),[{t:'とぼける',v:'dodge'},{t:'ごまかす',v:'excuse'},{t:'黙る',v:'silence'}]);$('#odlg').hidden=false;G.breakChoice=c;
  if(c==='silence'){addSus(10,'break');await overSay('マネージャー','「…黙るんだ。ふーん」')}else await overSay('マネージャー',hot?'「…そっか。お水 置いとくね あとで少し話そう」':'「そっか …お水 置いとくね」');
  $('#mgr').classList.remove('glare');
  await overSay('','（冷たい …生き返る） 列は止まったままこっちを見てる');
  hands('two');await overSay('','（列の前の方の人たちが いっせいに手を振り返してくれた）');
  await overSay('スタッフ','「再開しまーす！」');o.className=''}
// 子ども：未就学の男の子／未就学の女の子／小学校低学年 のどれか。大人を縮めるのでなく 顔の形と部品の大きさから描き分ける
function child(r,base){const v=r()<.34?'a':r()<.5?'b':'c',girl=v==='b'||(v==='c'&&r()<.5),pre=v!=='c';let kid;
  for(let k=0;k<400;k++){kid=gen(base+k,'round');if(!!kid.female===girl&&kid.age==='y'&&kid.hairT==='gen'&&!kid.buzz)break}
  const P=pre?{cw:25.5,len:.8,eyeY:4.8,ea:6.1,eo:3.1,lo:3.8,ir:.6,nw:2.0,mw:4.0,sw:36,nl:4,h:102}:{cw:24.5,len:.86,eyeY:3.4,ea:5.6,eo:2.7,lo:3.2,ir:.55,nw:2.4,mw:4.6,sw:40,nl:6,h:112};
  Object.assign(kid,P,{jw:P.cw-1.6,chin:5,k1:.68,k2:.97,neck:.42,browTh:.5,browY:-1.6,old:0,bags:0,stubble:0,glasses:0,grin:0,exp:'smile',cA:-1.2,cB:-1.2,dp:.5,sock:.14,mole:0,
    top:'tee',cloth:['#F2B33D','#6FC3E8','#F28AA8','#8BD17C','#F59A5B'][Math.floor(r()*5)],print:0,short:1,inn:0,collarIn:0},girl?{hl:'chin',fr:'bangs'}:{hl:'ear',fr:'bangs'});
  return kid}
async function doKids(){const o=$('#over');const r=mul(G.seed+77);
  const off=Math.floor(r()*9000);let mom,kid;for(let k=0;k<400;k++){mom=gen(40000+off+k);if(mom.female&&mom.age!=='o'&&mom.hairT!=='wavy')break}kid=child(r,50000+off);
  const a=spawn({per:{p:mom},i:G.i}),b=spawn({per:{p:kid},i:G.i},'kid');a.style.zIndex=1;
  inner('');memo('');
  await Promise.all([sleep(1100/SPEED).then(()=>move(a,112,72,1700,'ease-out')),move(b,125,40,1900,'ease-out')]);// 子どもが先に来て 保護者はあとから
  o.className='show soft';$('#ochoices').innerHTML='';
  await overSay('','（列が止まった …子連れだから ゆっくり話させてあげるんだ）');
  await overSay('','（スタッフがすっと一歩さがった）');b.classList.add('on');
  await overSay('こども','「…だ だいすきです！」');b.classList.remove('on');
  // 選ばせずに 3つとも順にやる（実際のお見送りでも全部するため）
  G.kidsChoice='all';hlPush('kids',kid,'…だ だいすきです！');
  await overSay('','（しゃがんで目を合わせたら 真っ赤になって ぶんぶん頷いた）');
  await overSay('','（「来てくれてありがとう」 お母さんの方が泣きそうになってた）');
  hands('two');await overSay('','（両手いっぱいで振り返してくれた ちいさい手だった）');
  await overSay('','（お母さんが深々と頭下げて ふたりゆっくり出てった） 後ろの大人たちが目を細めて見てる');
  o.className='';await Promise.all([move(a,null,-46,2700,'ease-in'),move(b,null,-30,2700,'ease-in')]);a.remove();b.remove()}
// ---- 1回の流れ
async function runGame(total,o={}){const id=++runId;CLIP.tok++;SPEED=window.__speed||1;
  const seed=(Date.now()^Math.floor(Math.random()*1e9))>>>0;
  let run0,ready;if(PRE&&PRE.total===total){run0=PRE.run;ready=PRE.ready;PRE=null}else{run0=buildRun(total,seed);Q.ppl.clear();Q.spr.clear();setLine(run0,-1);ready=Promise.all(run0.seq.map(x=>sprite(x.per)))}
  G={id,seed,total,hl:[],guided:o.skipIntro&&G&&G.guided?{...G.guided}:{},rev:[],run:run0,i:0,sus:0,susMax:0,log:[],recent:[],streak:0,mcSeen:0,st:{good:0,neutral:0,mismatch:0,pass:0,pushed:0,omai:0,omaiTotal:0,mcHit:0,mcTotal:0,flowTap:0,flowMiss:0,flowTotal:0,repeatHit:0,repeatTotal:0,engTotal:0}};
  window.__G=G;FLOW.length=0;awake(true);store.set('oshiten_seen','1');
  setLine(run0,-1);queueOn($('#qcv'));
  show('main');stage().querySelectorAll('.fan').forEach(e=>e.remove());bubbleOff();inner('');memo('');$('#cards').classList.remove('show');$('#over').className='';$("#wave .hint").classList.toggle("show",!!o.skipIntro);clkStart(o.skipIntro?50:30);
  // 開いたらすぐ列。事情は最初の数人のあいだ、心の声として流す【仮：どの行を残すか】
    if(!o.skipIntro){await doOpen(id);if(id!==runId)return;$('#wave .hint').classList.add('show');await Promise.race([ready,sleep(2500)]);await sleep(1200/SPEED)}
  else{Q.cheerOK=true;await clkAt(60);Q.cheerOK=false;setExtra();if(id!==runId)return;goSignal();await Promise.race([ready,sleep(2500)]);await sleep(1200/SPEED)}
  if(id!==runId)return;
  const run=G.run;let lateSaid=false;const gap=gapMaker(seed),pend=new Set();const clear=()=>Promise.all([...pend]);
  for(let i=0;i<run.N;i++){if(id!==runId)return;const g=run.seq[i];
    if(i===run.breakAt){await clear();if(id!==runId)return;G.i=i;await doBreak();if(id!==runId)return}
    if(i===run.kidsAt){await clear();if(id!==runId)return;G.i=i;await doKids();if(id!==runId)return}
    $('#mgr').classList.toggle('peek',i%14<3);
    if(!lateSaid&&i>run.N*.8&&!isEng(g)){lateSaid=true;inner('（後半 知ってる顔ばっかりだ）')}
    if(isEng(g)){G.i=i;setLine(run,i);g.per.passed=1;const E=doEngage(g);pend.add(E.done);E.done.then(()=>pend.delete(E.done));await E.dp;if(id!==runId)return;await sleep((240+Math.random()*460)/SPEED)}
    else{G.i=i;setLine(run,i);g.per.passed=1;if(G.st.flowTotal===6)$('#wave .hint').classList.remove('show');const p=doFlow(g);pend.add(p);p.then(()=>pend.delete(p));const gp=gap(i>run.N*.8);await sleep((g.tight?330:i<3&&!o.skipIntro?1500:gp)/SPEED)}}
  await clear();
  if(id!==runId)return;
  // 終幕
  await sleep(500);queueOff();const busted=G.sus>=75;G.busted=busted;
  if(busted){if(!await story(BUSTED))return;return result(null)}
  const line=G.sus>=40?'「おつかれさま。…今日ちょっといつもと違った気がするけど もしかして体調悪い？気づいてあげられなくてごめんね」':'「おつかれさま！ 今日すごく良かったよ」';
  if(!await story([{bg:'room',who:'マネージャー',t:line},{t:'（…バレてないよな）'},...REQUEST]))return;
  $('#sdlg .nx').hidden=true;const ans=await choose($('#schoices'),[{t:'引き受ける',v:'yes',pri:1},{t:'少し考えさせて',v:'later'}]);$('#sdlg .nx').hidden=false;if(id!==runId)return;
  result(ans)}
const CARD={s:'笑顔',k:'個別',n:'ノリ',l:'聞く',mc:'服をタップ'};
function bestOf(e,g){if(e.hasMC)return{best:['mc'],why:'推しの色の服を着ていた'};if(e.ann)return{best:['k'],why:'さっきも来てくれた人'};
  const K={cast:[{s:1,k:1,n:2,l:1},'いつも来てくれる人（おまいつ）'],new:[{s:2,k:0,n:1,l:1},'初めて来た人'],grp:[{s:1,k:0,n:2,l:0},'連れで来ていた子']};
  const W={軽:'軽いあいさつ',ネタ:'ふざけた一言',深:'重い話',静:'何も言えなかった人',推し:'気持ちを伝えてくれた',CD:'近況を教えてくれた',感謝:'気持ちを伝えてくれた',遠征:'近況を教えてくれた',記念:'近況を教えてくれた'};
  const t=e.kind?K[e.kind][0]:TBL[e.tone],why=e.kind?K[e.kind][1]:W[e.tone];const mx=Math.max(...Object.values(t));const best=Object.keys(t).filter(c=>t[c]===mx);return{best,why}}
function score(){const s=G.st,flow=s.flowTotal?s.flowTap/s.flowTotal:1,eng=s.engTotal?(s.good+s.neutral*.45)/s.engTotal:1,mc=s.mcTotal?s.mcHit/s.mcTotal:1,rep=s.repeatTotal?s.repeatHit/s.repeatTotal:1;
  return Math.max(0,Math.min(100,Math.round(flow*38+eng*42+mc*8+rep*12-s.mismatch*2+s.omai*2-(G.busted?25:0))))}
function result(ans){awake(false);show('result');const s=G.st,rows=[['見送った人数',G.run.N],['手を振って見送った人',s.flowTap],['話しかけてきて 笑顔で帰った人',s.good],['話しかけてきて ふつうに帰った人',s.neutral],['返し方が合わなかった人',s.mismatch],['返せなかった人',s.pass],['手を振れなかった人',s.flowMiss],['推しの色の服に気づけた人',`${s.mcHit} / ${s.mcTotal}`],['また来た人を覚えていた回数',`${s.repeatHit} / ${s.repeatTotal}`],['スタッフに押し出された人',s.pushed]];if(s.omai>0)rows.push(['顔を覚えていた いつもの人',`${s.omai}回`]);
  $('#rlist').innerHTML=rows.map(r=>`<dt>${r[0]}</dt><dd>${r[1]}</dd>`).join('');
  $('#rscore').innerHTML=`${score()}<small>点</small>`;
  {const R=G.rev,box=$('#rrev');box.innerHTML=R.length?'<h3>振り返り</h3>'+R.slice(0,30).map(x=>`<div class="rv"><div class="fc">${faceSvg(x.p)}</div><div class="bd"><b>${x.seq}人目 「${String(x.say).replace(/[<>&]/g,'')}」</b><span>${x.why}</span><span class="ch">選んだ：<i class="ng">${x.choice?CARD[x.choice]:'返せなかった'}</i>　合うのは：<i class="ok">${x.best.map(c=>CARD[c]).join(' か ')}</i></span></div></div>`).join('')+(R.length>30?`<p class="more">ほか ${R.length-30}人</p>`:''):'<h3>振り返り</h3><p class="more">返し方を外した人はいなかった</p>'}
  $('#rlead').textContent=G.busted?'今日は 最後まで隠し通せなかった':'バレずに 最後までやりきった';
  const row=$('#rrow');row.innerHTML='';const mk=(t,f,c)=>{const b=document.createElement('button');b.type='button';b.className=c;b.textContent=t;b.onclick=f;row.appendChild(b)};
  if(ans==='yes')mk('次のお見送り会へ',()=>runGame(G.total,{skipIntro:true}),'big');
  mk('タイトルへ',()=>title(),ans==='yes'?'sub':'big');shareSetup()}
// ---- 見どころ動画（その回の名場面から描き直す・縦 720x1280）と 共有
const fp=g=>g.alt&&g.per.alt&&!g.per.mc?g.per.alt:g.per.p;
function hlPush(k,p,say){if(G&&G.hl&&p&&G.hl.length<60)G.hl.push({k,p,say:String(say||''),seq:G.i+1})}
const HLN={kids:'子どもが来てくれた',omai:'顔を覚えていた いつもの人',mc:'推しの色の服に気づけた',rep:'また来た人を覚えていた',good:'笑顔で帰ってくれた'};
function pickHL(list){const ord=['kids','omai','mc','rep','good'],out=[];for(const k of ord){const x=list.find(y=>y.k===k);if(x)out.push(x);if(out.length>=3)break}
  for(const x of list){if(out.length>=3)break;if(!out.includes(x))out.push(x)}return out.sort((a,b)=>a.seq-b.seq)}
function faceImg(p){const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="37 4 126 180" width="504" height="720"><style>${$('#pcss').textContent}</style>${person(p)}</svg>`;
  return new Promise(res=>{const im=new Image();im.onload=()=>{try{const c=document.createElement('canvas');c.width=504;c.height=720;c.getContext('2d').drawImage(im,0,0,504,720);res(c)}catch(e){res(null)}};im.onerror=()=>res(null);im.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg)})}
function wrapT(c,t,maxW){const out=[];let cur='';for(const w of String(t).split(' ')){const tryS=cur?cur+' '+w:w;if(c.measureText(tryS).width<=maxW){cur=tryS;continue}if(cur)out.push(cur);cur='';for(const ch of w){if(c.measureText(cur+ch).width>maxW){out.push(cur);cur=ch}else cur+=ch}}if(cur)out.push(cur);return out}
const eo=p=>1-Math.pow(1-Math.max(0,Math.min(1,p)),3);
function rrect(c,x,y,w,h,r){c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath()}
const cl01=x=>Math.max(0,Math.min(1,x));
const spr=(t,k=7,w=14)=>t<=0?0:1-Math.exp(-k*t)*Math.cos(w*t);
const hsh=n=>{const x=Math.sin(n*127.1+311.7)*43758.5453;return x-Math.floor(x)};
const eio=x=>{x=cl01(x);return x<.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2};
const HANDP=['M22,140 L26,74 Q50,60 74,74 L78,140Z','M22,82 q7,-9 14,0 q7,-9 14,0 q7,-9 14,0 q7,-9 14,0 v10 h-56z','M34,76 Q30,40 36,22 Q40,14 44,22 L45,44 L47,14 Q51,6 55,14 L55,44 L59,18 Q63,10 66,19 L64,48 L70,30 Q75,25 76,33 L68,76Z'];
let HP2=null;
function drawHand(c,x,y,s,rot,mc,flip){HP2=HP2||HANDP.map(d=>new Path2D(d));c.save();c.translate(x,y);c.rotate(rot);c.scale(s*(flip?-1:1),s);c.translate(-50,-140);[mc,'#fff','#F1D3BC'].forEach((col,i)=>{c.fillStyle=col;c.fill(HP2[i])});c.restore()}
// 縁取りと影のついた文字（シール風）
function stk(c,txt,x,y,o){c.lineJoin='round';c.miterLimit=2;const lw=o.lw||10;if(o.sh){c.fillStyle=o.sh;c.strokeStyle=o.sh;c.lineWidth=lw;c.strokeText(txt,x+(o.sx||5),y+(o.sy||7));c.fillText(txt,x+(o.sx||5),y+(o.sy||7))}if(o.line){c.strokeStyle=o.line;c.lineWidth=lw;c.strokeText(txt,x,y)}c.fillStyle=o.fill;c.fillText(txt,x,y)}
function rays(c,cx,cy,R,n,rot,col,a){if(a<=0)return;c.save();c.globalAlpha=a;c.translate(cx,cy);c.rotate(rot);c.fillStyle=col;c.beginPath();for(let i=0;i<n;i++){const a0=i*2*Math.PI/n,a1=a0+Math.PI/n;c.moveTo(0,0);c.lineTo(Math.cos(a0)*R,Math.sin(a0)*R);c.lineTo(Math.cos(a1)*R,Math.sin(a1)*R);c.closePath()}c.fill();c.restore()}
function confetti(c,ox,oy,tt,seed,cols,n){if(tt<0||tt>2)return;for(let i=0;i<n;i++){const a=hsh(seed+i)*Math.PI*2,sp=700+hsh(seed+i+.5)*1100,d=(1-Math.exp(-3.2*tt))/3.2;
  const x=ox+Math.cos(a)*sp*d,y=oy+(Math.sin(a)*sp-500)*d+420*tt*tt,w=12+hsh(seed+i+.7)*14;c.save();c.globalAlpha=cl01(1.9-tt);c.translate(x,y);c.rotate(tt*(5+hsh(seed+i+.3)*12));c.scale(1,Math.cos(tt*(8+hsh(seed+i+.9)*8)));c.fillStyle=cols[i%cols.length];c.fillRect(-w/2,-w*.32,w,w*.64);c.restore()}}
// 斜めに横切る幕（場面の切り替え）。u: 0→1で覆い、1→2で抜ける
function wipe(c,u,a,b){if(u<=0||u>=2)return;const W=720,H=1280,k=320,S=W+k+20;let x0,x1;if(u<1){x0=-k-10;x1=-k-10+S*eio(u)}else{x0=-k-10+S*eio(u-1);x1=W+10}
  const band=(p,q,col)=>{c.fillStyle=col;c.beginPath();c.moveTo(p+k,0);c.lineTo(q+k,0);c.lineTo(q,H);c.lineTo(p,H);c.closePath();c.fill()};
  band(x0,x1,a);if(u<1)band(x1-26,x1,b);else band(x0,x0+26,b)}
// 吹き出しの文: 1行に収まるなら字を少し小さくしてでも1行、無理なら行の長さをそろえて折る
function sayLines(c,t,F2){for(let fs=50;fs>=40;fs-=2){c.font=`900 ${fs}px ${F2}`;if(c.measureText(t).width<=560)return[t]}
  c.font=`900 46px ${F2}`;const ch=[...t],n=Math.ceil(c.measureText(t).width/540),per=Math.ceil(ch.length/n),out=[];for(let i=0;i<ch.length;i+=per)out.push(ch.slice(i,i+per).join(''));return out}
function clipPlan(){const hl=pickHL(G.hl||[]);const T0=2.7,SC=3.3,TE=4.4;
  const seq=G.run.seq,used=new Set(hl.map(x=>x.p)),crowd=[];for(let k=0;k<seq.length&&crowd.length<8;k+=Math.max(1,Math.floor(seq.length/9))){const p=seq[k].per.p;if(!used.has(p)&&!seq[k].per.mc){used.add(p);crowd.push(p)}}
  return{hl,crowd,T0,SC,TE,T:T0+SC*hl.length+TE,score:score(),lead:G.busted?'今日は 最後まで隠し通せなかった':'バレずに 最後までやりきった',N:G.run.N}}
function drawClip(c,P,faces,t){const W=720,H=1280,mc=getComputedStyle(document.documentElement).getPropertyValue('--mc').trim()||'#E84C7A';
  const ink='#2B2540',cream='#F6F0E8',mcL=mixc(mc,'#ffffff',.72),mcD=mixc(mc,'#2B2540',.45),F1='"Dela Gothic One","Zen Kaku Gothic New",sans-serif',F2='"Zen Kaku Gothic New","Hiragino Sans",sans-serif';
  const nh=P.hl.length,cf=faces.slice(nh),tEnd=P.T0+P.SC*nh;c.save();c.textAlign='center';c.textBaseline='middle';
  // 揺れ（判子を押した瞬間）
  const sc=t>=P.T0&&t<tEnd?(t-P.T0)%P.SC:-1;if(sc>1.62&&sc<1.95){const d=(1.95-sc)/.33*12;c.translate((hsh(t*60)-.5)*d,(hsh(t*60+3)-.5)*d)}
  if(t<P.T0){// ---- 幕開け: 題名が弾んで出て 列の人が流れ 両手が振られる
    c.fillStyle=mc;c.fillRect(-20,-20,W+40,H+40);
    c.save();c.globalAlpha=.16;c.fillStyle='#fff';const off=(t*140)%120;for(let x=-H;x<W+H;x+=120){c.beginPath();c.moveTo(x+off,0);c.lineTo(x+off+50,0);c.lineTo(x+off+50-H*.6,H);c.lineTo(x+off-H*.6,H);c.closePath();c.fill()}c.restore();
    c.fillStyle=cream;c.beginPath();c.moveTo(0,1010);c.quadraticCurveTo(W/2,960,W,1010);c.lineTo(W,H);c.lineTo(0,H);c.fill();
    cf.forEach((f,i)=>{if(!f)return;const sp=190,x=((i*sp-t*150)%(cf.length*sp)+cf.length*sp)%(cf.length*sp)-90,hop=Math.max(0,Math.sin(t*9+i*1.7))*16;c.drawImage(f,x-110,1290-314-hop,220,314)});
    const L=[['推しに転生',112,F1],['（一時的）',58,F1],['したので、ヲタク知識で',48,F1],['お見送り会300枚を',62,F1],['乗り切る',118,F1]],Y=[230,350,440,540,680];
    L.forEach(([s,fs,ff],i)=>{const ti=t-.1-i*.17,p=spr(ti*1.15);if(ti<=0)return;c.save();c.translate(W/2+(i%2?1:-1)*(1-cl01(ti*3.2))*260,Y[i]);c.rotate((i%2?.05:-.05)*(1-cl01(ti*3)));c.scale(p,p);c.font=`${fs}px ${ff}`;stk(c,s,0,0,{fill:i===0||i===4?'#fff':cream,line:ink,lw:fs*.16,sh:mcD,sx:fs*.05,sy:fs*.07});c.restore()});
    const hu=spr(t-1.25,6,10),wv=Math.sin(t*13)*.22;if(t>1.25){drawHand(c,105,H+30-hu*250,2.4,-.2+wv,mc,0);drawHand(c,W-105,H+30-hu*250,2.4,.2-wv,mc,1)}
  }else if(t<tEnd){// ---- 名場面: 何人目か・その人の一言・判子
    const k=Math.floor((t-P.T0)/P.SC),x=P.hl[k],lt=t-P.T0-k*P.SC,fc=faces[k];
    c.fillStyle=cream;c.fillRect(-20,-20,W+40,H+40);
    const st=lt-1.5;rays(c,W/2,760,1100,18,lt*.18,mcL,.55+(st>0?.45*Math.exp(-st*3):0));
    // 背景の大きな番号（奥でゆっくり流れる）
    {const ep=eo(lt/.55);c.save();c.globalAlpha=.95;c.font=`250px ${F1}`;const ns=String(x.seq),nw=c.measureText(ns).width;c.translate(W/2-40+(1-ep)*320-lt*10,175);c.lineJoin='round';c.lineWidth=7;c.strokeStyle=mc;c.strokeText(ns,0,0);c.font=`64px ${F1}`;stk(c,'人目',nw/2+70,48,{fill:ink});c.restore()}
    // 本人：右から弾んで入り、手を振られて跳ねる
    if(fc){const ent=spr(lt*1.05,6,11),hop=lt>.95&&lt<1.35?Math.sin((lt-.95)/.4*Math.PI)*60:0,sq=1+.07*Math.sin(lt*20)*Math.exp(-lt*5)+(lt>1.35&&lt<1.6?.05*Math.sin((lt-1.35)/.25*Math.PI):0);
      const fw=500,fh=714,bx=W/2+(1-ent)*W*.9,by=H-90-hop+Math.max(0,160-(x.p.h||165))/180*fh*-.9;c.save();c.translate(bx,by);c.scale(1/sq,sq);c.drawImage(fc,-fw/2,-fh,fw,fh);c.restore()}
    // 推しの両手
    {const hu=spr(lt-.55,6,10),wv=Math.sin(lt*14)*.24,dn=lt>2.7?eo((lt-2.7)/.3):0;if(lt>.55){drawHand(c,95,H+40-hu*300+dn*300,2.3,.18+wv,mc,0);drawHand(c,W-95,H+40-hu*300+dn*300,2.3,-.18-wv,mc,1)}}
    // ひとことの吹き出し（文字は一文字ずつ）
    {const bp=spr(lt-.4,8,15);if(lt>.4){const sl=sayLines(c,x.say||'',F2),bh=sl.length*66+60,by=290,cx=W/2;c.save();c.translate(cx,by+bh+30);c.scale(bp,bp);c.translate(-cx,-(by+bh+30));
      c.fillStyle='rgba(43,37,64,.18)';rrect(c,cx-310+8,by+10,620,bh,40);c.fill();c.fillStyle='#fff';rrect(c,cx-310,by,620,bh,40);c.fill();c.beginPath();c.moveTo(cx-30,by+bh-2);c.lineTo(cx+8,by+bh+40);c.lineTo(cx+34,by+bh-2);c.closePath();c.fill();
      let n=Math.floor((lt-.5)*24),i0=0;c.fillStyle=ink;sl.forEach((l,i)=>{const ch=[...l],m=Math.max(0,Math.min(ch.length,n-i0));i0+=ch.length;const full=c.measureText(l).width;c.textAlign='left';c.fillText(ch.slice(0,m).join(''),cx-full/2,by+62+i*66)});c.textAlign='center';c.restore()}}
    // 判子：上から叩きつけて 紙吹雪
    if(st>0){const s=1+1.5*Math.pow(Math.max(0,1-st/.13),2)-.06*Math.sin(cl01((st-.13)/.25)*Math.PI);c.save();c.translate(W/2,1035);c.rotate(-.06);c.scale(s,s);c.globalAlpha=cl01(st/.08);c.font=`900 44px ${F2}`;const lb=HLN[x.k],lw=c.measureText(lb).width+86;
      c.fillStyle=mcD;rrect(c,-lw/2+6,-50+9,lw,100,50);c.fill();c.fillStyle=mc;rrect(c,-lw/2,-50,lw,100,50);c.fill();c.strokeStyle='#fff';c.lineWidth=5;rrect(c,-lw/2+10,-40,lw-20,80,40);c.stroke();c.fillStyle='#fff';c.fillText(lb,0,3);c.restore();
      confetti(c,W/2,1035,st-.12,k*97+11,[mc,'#fff',mcL,'#F2C83A'],46)}
  }else{// ---- 結果: 点数が輪とともに上がる
    const lt=t-tEnd;c.fillStyle=mc;c.fillRect(-20,-20,W+40,H+40);rays(c,W/2,640,1300,22,lt*.12,'#fff',.12);
    {const p=spr(lt-.15,7,13);c.save();c.translate(W/2,300);c.scale(p,p);c.font=`900 50px ${F2}`;stk(c,P.lead,0,0,{fill:'#fff',line:ink,lw:10,sh:mcD});c.restore()}
    const up=eo((lt-.4)/1.5),cnt=Math.round(P.score*up),done=lt>1.9,pl=done?1+.12*Math.exp(-(lt-1.9)*5)*Math.cos((lt-1.9)*18):1;
    c.save();c.translate(W/2,650);c.lineCap='round';c.lineWidth=30;c.strokeStyle='rgba(255,255,255,.3)';c.beginPath();c.arc(0,0,205,0,7);c.stroke();c.strokeStyle='#fff';c.beginPath();c.arc(0,0,205,-Math.PI/2,-Math.PI/2+Math.PI*2*P.score/100*up);c.stroke();
      c.scale(pl,pl);c.font=`200px ${F1}`;stk(c,String(cnt),0,-6,{fill:'#fff',line:ink,lw:16,sh:mcD,sx:7,sy:10});c.font=`54px ${F1}`;stk(c,'点',0,118,{fill:'#fff',line:ink,lw:10});c.restore();
    if(done)confetti(c,W/2,650,lt-1.9,501,['#fff',mcL,'#F2C83A',ink],60);
    {const p=spr(lt-2.1,7,13);if(lt>2.1){c.save();c.translate(W/2,960);c.scale(p,p);c.font=`900 44px ${F2}`;stk(c,`見送った人数 ${P.N}`,0,0,{fill:'#fff',line:ink,lw:9});c.restore()}}
    {const a=cl01((lt-2.6)/.4);if(a>0){c.globalAlpha=a;c.font=`34px ${F1}`;stk(c,'推しに転生（一時的）したので、',W/2,130+(1-a)*20,{fill:'#fff',line:ink,lw:7});stk(c,'ヲタク知識でお見送り会300枚を乗り切る',W/2,182+(1-a)*20,{fill:'#fff',line:ink,lw:7});c.globalAlpha=1}}
  }
  // 場面の切り替えの幕
  const bounds=[P.T0];for(let k=1;k<=nh;k++)bounds.push(P.T0+P.SC*k);bounds.forEach((b,i)=>{const u=(t-(b-.28))/.28;wipe(c,u,i%2?mc:ink,i%2?ink:mc)});
  c.restore()}
const CLIP={blob:null,type:'',busy:false,tok:0};
async function makeClip(){const tok=++CLIP.tok,cv=$('#shcv'),st=$('#shst');CLIP.blob=null;shBtns();
  const types=['video/mp4;codecs=avc1.42E01E','video/mp4','video/webm;codecs=vp9','video/webm'];
  const mt=window.MediaRecorder&&cv.captureStream?types.find(x=>MediaRecorder.isTypeSupported(x)):null;
  const P=clipPlan();const c=cv.getContext('2d');
  try{await Promise.all([document.fonts.load('54px "Dela Gothic One"','推しに転生（一時的）したので、ヲタク知識でお見送り会300枚を乗り切る人目点0123456789'),document.fonts.load('900 40px "Zen Kaku Gothic New"',P.lead+P.hl.map(x=>x.say+HLN[x.k]).join('')+'見送った人数0123456789')])}catch(e){}
  const faces=await Promise.all([...P.hl.map(x=>faceImg(x.p)),...P.crowd.map(faceImg)]);if(tok!==CLIP.tok)return;CLIP.P=P;CLIP.faces=faces;
  const loop=t0=>new Promise(res=>{const f=now=>{if(tok!==CLIP.tok)return res(false);if(document.hidden)return res(false);const t=(now-t0)/1000;drawClip(c,P,faces,Math.min(t,P.T));if(t<P.T)requestAnimationFrame(f);else res(true)};requestAnimationFrame(f)});
  if(!mt){st.textContent='この端末では動画をつくれません';st.hidden=false;for(;;){if(!await loop(performance.now()))return}}
  st.textContent='動画をつくっています';st.hidden=false;
  let rec,chunks=[],stream;try{stream=cv.captureStream(30);rec=new MediaRecorder(stream,{mimeType:mt,videoBitsPerSecond:5e6})}catch(e){st.textContent='この端末では動画をつくれません';return}
  rec.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data)};let recErr=false;rec.onerror=()=>{recErr=true};const stopped=new Promise(r=>rec.onstop=r);
  rec.start(250);const ok=await loop(performance.now());rec.stop();await stopped;stream.getTracks().forEach(x=>x.stop());
  if(tok!==CLIP.tok)return;if(!ok){st.hidden=true;CLIP.retry=true;return}
  const bl=new Blob(chunks,{type:mt.split(';')[0]});if(recErr||bl.size<1000){st.textContent='この端末では動画をつくれません';st.hidden=false;for(;;){if(!await loop(performance.now()))return}}
  CLIP.type=mt.split(';')[0];CLIP.blob=bl;st.hidden=true;shBtns();
  for(;;){if(!await loop(performance.now()))return}}
function clipFile(){return new File([CLIP.blob],'oshiten.'+(CLIP.type.includes('mp4')?'mp4':'webm'),{type:CLIP.type})}
function shareText(){return `${document.title}\n${G.busted?'今日は 最後まで隠し通せなかった':'バレずに 最後までやりきった'} ${score()}点`}
const shareURL=()=>location.origin+'/oshiten/';
function shBtns(){const has=!!CLIP.blob;$('#shshare').disabled=!has;$('#shsave').disabled=!has;
  if(has){let can=false;try{can=!!(navigator.canShare&&navigator.canShare({files:[clipFile()]}))}catch(e){}$('#shshare').hidden=!can}}
function shareSetup(){$('#shshare').hidden=false;$('#shshare').onclick=async()=>{if(!CLIP.blob)return;try{await navigator.share({files:[clipFile()],text:shareText()+'\n'+shareURL()})}catch(e){}};
  $('#shsave').onclick=()=>{if(!CLIP.blob)return;const u=URL.createObjectURL(CLIP.blob),a=document.createElement('a');a.href=u;a.download=clipFile().name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),60000)};
  $('#shx').onclick=()=>window.open('https://x.com/intent/tweet?text='+encodeURIComponent(shareText())+'&url='+encodeURIComponent(shareURL()),'_blank','noopener');
  $('#shth').onclick=()=>window.open('https://www.threads.com/intent/post?text='+encodeURIComponent(shareText())+'&url='+encodeURIComponent(shareURL()),'_blank','noopener');
  CLIP.retry=false;makeClip()}
function previewLoop(){const tok=++CLIP.tok,c=$('#shcv').getContext('2d');let t0=performance.now();const f=now=>{if(tok!==CLIP.tok||document.hidden)return;let t=(now-t0)/1000;if(t>CLIP.P.T){t0=now;t=0}drawClip(c,CLIP.P,CLIP.faces,t);requestAnimationFrame(f)};requestAnimationFrame(f)}
document.addEventListener('visibilitychange',()=>{if(document.hidden||$('#result').hidden)return;if(CLIP.retry){CLIP.retry=false;makeClip()}else if(CLIP.blob&&CLIP.P)previewLoop()});
// ---- 起動
bindTap($('#story'));bindTap($('#over'));
// 下の枠は返し方のボタンを出す場所だけにする。手を振るのは客の顔を押した時だけ（下の枠を押しても何も起きない）
$('#stage').addEventListener('pointerdown',e=>{if(PAUSED||!G||e.target.closest('button'))return;if(Q.cheerOK){waveTap();return}// 始まる前は 並んでいる客を押しても手を振れる
  const fs=[...new Set(document.elementsFromPoint(e.clientX,e.clientY).map(x=>x.closest&&x.closest('.fan')).filter(Boolean))];const t=fs[0];if(t&&t._tap)t._tap();else stray()});
$('#cards').addEventListener('pointerdown',e=>{const b=e.target.closest('button');if(b&&G&&G.cardRes&&!PAUSED&&!$('#cards').classList.contains('arm')){try{navigator.vibrate&&navigator.vibrate(12)}catch(_){}G.cardRes(b.dataset.v)}});
document.addEventListener('visibilitychange',()=>{if(document.hidden)setPause(true)});addEventListener('pagehide',()=>setPause(true));
$('#pause').onclick=()=>setPause(false);
document.addEventListener('contextmenu',e=>e.preventDefault());document.addEventListener('gesturestart',e=>e.preventDefault());
// iPhone で素早く続けて押すと画面が拡大されるのを止める（ボタンと入力欄はそのまま押せるようにする）
{let lastT=0;document.addEventListener('touchend',e=>{const n=e.timeStamp;if(n-lastT<350&&!(e.target.closest&&e.target.closest('button,a,input,select,textarea,label'))){e.preventDefault();e.target.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}))}lastT=n},{passive:false});document.addEventListener('dblclick',e=>e.preventDefault())}
$('#quit').onclick=e=>{const b=e.currentTarget;if(b.dataset.arm){delete b.dataset.arm;b.textContent='やめる';title()}else{b.dataset.arm='1';b.textContent='もう一度押すとやめる';clearTimeout(b._t);b._t=setTimeout(()=>{delete b.dataset.arm;b.textContent='やめる'},2200)}};
$('#start').onclick=()=>runGame(300);
$('#short').onclick=()=>runGame(70);
{const m=gen(777,'bony');Object.assign(m,{female:1,old:0,bags:0,stubble:0,glasses:1,grx:1.6,gsw:1.7,top:'blazer',cloth:'#33383F',collarIn:1,inn:'#F4F0EA',short:0,print:0,h:166,exp:'neutral',grin:0,cA:.4,cB:.4,browTail:-.9,browAr:.5,hairT:'gen',hl:'chin',fr:'center',hv:9.2,hs:3,flip:0});
 $('#mgr').innerHTML=`<svg viewBox="37 4 126 180" aria-hidden="true">${person(m)}</svg>`}
$('#title').addEventListener('click',e=>{if(e.target.closest('button'))return;if(TM.playing())TM.skip()});
{const box=$('#mcpick');MCS.forEach(([n,c])=>{const b=document.createElement('button');b.type='button';b.dataset.c=c;b.style.background=c;b.setAttribute('aria-label',n);b.onclick=e=>{e.stopPropagation();if(MC!==c){setMC(c);prep()}};box.appendChild(b)});const sv=store.get('oshiten_mc');setMC(MCS.some(x=>x[1]===sv)?sv:MCS[Math.floor(Math.random()*MCS.length)][1])}
$('#again').onclick=()=>{title.force=true;title()};
title();

})();

