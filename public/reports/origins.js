(function(){
var tb=document.getElementById('tb'),cnt=document.getElementById('count'),q=document.getElementById('q');
var fCat='all', fVid='all', fMed='all';
function apply(){
  var term=q.value.trim().toLowerCase(), n=0;
  for(var i=0;i<tb.rows.length;i++){
    var tr=tb.rows[i];
    var ok=(fCat==='all'||tr.getAttribute('data-cat')===fCat)
        && (fVid==='all'||tr.getAttribute('data-video')===fVid)
        && (fMed==='all'||tr.getAttribute('data-media')===fMed)
        && (!term||tr.textContent.toLowerCase().indexOf(term)>=0);
    tr.hidden=!ok; if(ok)n++;
  }
  cnt.textContent=n+' 件表示中';
}
function wire(sel,attr,set){
  var bs=document.querySelectorAll(sel);
  for(var i=0;i<bs.length;i++){(function(b){
    b.addEventListener('click',function(){
      set(b.getAttribute(attr));
      for(var j=0;j<bs.length;j++) bs[j].setAttribute('aria-pressed', String(bs[j]===b));
      apply();
    });
  })(bs[i]);}
}
wire('button[data-f]','data-f',function(v){fCat=v;});
wire('button[data-v]','data-v',function(v){fVid=v;});
wire('button[data-m]','data-m',function(v){fMed=v;});
q.addEventListener('input',apply);
apply();

var msg=document.getElementById('copyMsg');
function say(t){ if(msg){ msg.textContent=t; setTimeout(function(){msg.textContent='';},3000);} }
function copyText(t,btn){
  var o=btn.textContent;
  var done=function(){ btn.textContent='コピーしました'; setTimeout(function(){btn.textContent=o;},1600); };
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(t).then(done,function(){fallback(t,done);});
  } else fallback(t,done);
}
function fallback(t,done){
  var ta=document.createElement('textarea'); ta.value=t; ta.setAttribute('readonly','');
  ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta);
  ta.select(); ta.setSelectionRange(0,t.length);
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