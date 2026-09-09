(function(){
var DATA = window.__ORIGINS || [];
var VID = {"_56xLKRcVYM":"横浜アリーナ版","ImXkCr22kCU":"Promotion Edit"};
var tb=document.getElementById('tb'), cnt=document.getElementById('count'), q=document.getElementById('q');
var listTop=document.getElementById('listTop');
var fCat='all', fVid='all', fMed='all', perPage=25, page=1, hits=DATA;

function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }

function recompute(){
  var term=q.value.trim().toLowerCase();
  hits=[];
  for(var i=0;i<DATA.length;i++){
    var d=DATA[i];
    if(fCat!=='all'&&d.c!==fCat) continue;
    if(fVid!=='all'&&d.v!==fVid) continue;
    if(fMed!=='all'&&!d.m) continue;
    if(term){
      var hay=(d.c+' '+d.s+' '+d.m+' '+d.a+' '+d.q+' '+d.mq+' '+d.nt).toLowerCase();
      if(hay.indexOf(term)<0) continue;
    }
    hits.push(d);
  }
  page=1;
  render();
}

function pageCount(){ return perPage==='all' ? 1 : Math.max(1, Math.ceil(hits.length/perPage)); }

function render(){
  var per = perPage==='all' ? hits.length : perPage;
  var start = perPage==='all' ? 0 : (page-1)*perPage;
  var slice = hits.slice(start, start+Math.max(per,0));
  var html='';
  for(var i=0;i<slice.length;i++){
    var d=slice[i];
    html+='<tr>'
      +'<td class="c" data-h="分類">'+esc(d.c)+'</td>'
      +'<td class="s" data-h="出自">'+esc(d.s)+(d.m?'<span class="tag">'+esc(d.m)+'</span>':'')+'</td>'
      +'<td class="a" data-h="投稿者">'+esc(d.a)+'</td>'
      +'<td class="q" data-h="本人の書きぶり">'+esc(d.q)
        +(d.mq?'<div class="mq">'+esc(d.mq)+'</div>':'')
        +(d.nt?'<div class="n">'+esc(d.nt)+'</div>':'')+'</td>'
      +'<td class="l" data-h="いいね">'+d.l+'</td>'
      +'<td class="v" data-h="動画">'+esc(VID[d.v]||d.v)+'</td>'
      +'<td class="k"><a href="https://www.youtube.com/watch?v='+esc(d.v)+'&lc='+esc(d.i)+'" target="_blank" rel="noopener">コメントを開く</a></td>'
      +'</tr>';
  }
  tb.innerHTML = html;
  var emptyEl=document.getElementById('empty');
  emptyEl.hidden = hits.length>0;
  var total=hits.length, pc=pageCount();
  if(total===0){ cnt.textContent='0 件'; }
  else if(perPage==='all'){ cnt.textContent=total+' 件をすべて表示'; }
  else { cnt.textContent=total+' 件中 '+(start+1)+'〜'+Math.min(start+perPage,total)+' 件目'; }
  var posText = total===0 ? '' : (perPage==='all' ? '1 / 1 ページ' : page+' / '+pc+' ページ');
  var poss=document.querySelectorAll('[data-pager] .pos');
  for(var p1=0;p1<poss.length;p1++) poss[p1].textContent=posText;
  var atFirst=(perPage==='all'||page<=1), atLast=(perPage==='all'||page>=pc);
  var gbs=document.querySelectorAll('[data-pager] button[data-go]');
  for(var p2=0;p2<gbs.length;p2++){
    var g=gbs[p2].getAttribute('data-go');
    gbs[p2].disabled = (g==='first'||g==='prev') ? atFirst : atLast;
  }
  // ページが1枚しか無いときは送り自体を隠す
  var pagers=document.querySelectorAll('[data-pager]');
  for(var p3=0;p3<pagers.length;p3++) pagers[p3].hidden = (total===0 || pc<=1);
}

function go(p){
  var pc=pageCount();
  page = Math.min(Math.max(1,p), pc);
  render();
  if(listTop) listTop.scrollIntoView();
}

function wire(sel,attr,set){
  var bs=document.querySelectorAll(sel);
  for(var i=0;i<bs.length;i++){(function(b){
    b.addEventListener('click',function(){
      set(b.getAttribute(attr));
      for(var j=0;j<bs.length;j++) bs[j].setAttribute('aria-pressed', String(bs[j]===b));
      recompute();
    });
  })(bs[i]);}
}
wire('button[data-f]','data-f',function(v){fCat=v;});
wire('button[data-v]','data-v',function(v){fVid=v;});
wire('button[data-m]','data-m',function(v){fMed=v;});
wire('button[data-p]','data-p',function(v){perPage = (v==='all'?'all':parseInt(v,10));});

var gobs=document.querySelectorAll('[data-pager] button[data-go]');
for(var gi=0;gi<gobs.length;gi++){(function(b){
  b.addEventListener('click',function(){
    var g=b.getAttribute('data-go');
    if(g==='first') go(1);
    else if(g==='prev') go(page-1);
    else if(g==='next') go(page+1);
    else go(pageCount());
  });
})(gobs[gi]);}

var t=null;
q.addEventListener('input',function(){ clearTimeout(t); t=setTimeout(recompute,150); });
recompute();

var msg=document.getElementById('copyMsg');
function say(x){ if(msg){ msg.textContent=x; setTimeout(function(){msg.textContent='';},3000);} }
function copyText(txt,btn){
  var o=btn.textContent;
  var done=function(){ btn.textContent='コピーしました'; setTimeout(function(){btn.textContent=o;},1600); };
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(txt).then(done,function(){fallback(txt,done);});
  } else fallback(txt,done);
}
function fallback(txt,done){
  var ta=document.createElement('textarea'); ta.value=txt; ta.setAttribute('readonly','');
  ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta);
  ta.select(); ta.setSelectionRange(0,txt.length);
  try{ document.execCommand('copy'); done(); }catch(e){ say('コピーできませんでした。「コピーされる文面を見る」を開いて長押しで選んでください'); }
  document.body.removeChild(ta);
}
var cbs=document.querySelectorAll('button.copy[data-copy]');
for(var k=0;k<cbs.length;k++){(function(b){
  b.addEventListener('click',function(){ copyText(b.getAttribute('data-copy'),b); });
})(cbs[k]);}
var ca=document.getElementById('copyAll'), raw=document.getElementById('rawText');
if(ca&&raw) ca.addEventListener('click',function(){ copyText(raw.textContent,ca); });
})();