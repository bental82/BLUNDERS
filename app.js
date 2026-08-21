/* CLAMP Trainer — move trainer for "Preventing Blunders in Chess".
   Call startTrainer() once window.DATA and window.PIECES are set. */
function startTrainer(){
"use strict";
var $=function(id){return document.getElementById(id)};
var FILES="abcdefgh";
function idxOf(n){return (8-(+n[1]))*8+FILES.indexOf(n[0])}
function nameOf(i){return FILES[i%8]+(8-((i/8)|0))}
function fenBoard(f){var rows=f.split(" ")[0].split("/"),b=new Array(64).fill(null),i=0;
  for(var r=0;r<rows.length;r++){for(var k=0;k<rows[r].length;k++){var c=rows[r][k];
    if(c>="1"&&c<="8")i+=+c;else b[i++]=c;}} return b;}
function fenTurn(f){return f.split(" ")[1]}
var COL={R:"#e5484d",G:"#3fb950",B:"#4d8ff5",Y:"#e3b341"};
var SVGNS="http://www.w3.org/2000/svg";
function d(ms){return Math.round(ms*(window.__SPEED||1))}

/* ============================== board ============================== */
function Board(el){
  this.el=el;this.flip=false;this.sqs=[];this.pieces={};this.at=new Array(64).fill(null);
  this.nid=1;this.dests=[];this.onPick=null;this.locked=true;this.legal=null;this.sel=null;
  this.build();
}
Board.prototype.build=function(){
  var self=this;
  for(var i=0;i<64;i++){
    var d=document.createElement("div"); var f=i%8,r=(i/8)|0;
    d.className="sq "+(((f+r)%2)?"d":"l"); d.dataset.i=i;
    d.innerHTML='<span class="co f"></span><span class="co r"></span>';
    this.sqs.push(d); this.el.appendChild(d);
  }
  this.destLayer=document.createElement("div");
  this.destLayer.style.cssText="position:absolute;inset:0;pointer-events:none;z-index:4";
  this.el.appendChild(this.destLayer);
  this.ov=document.createElementNS(SVGNS,"svg");
  this.ov.setAttribute("viewBox","0 0 8 8");this.ov.setAttribute("class","ov");
  this.el.appendChild(this.ov);
  this.layout();
  this.el.addEventListener("pointerdown",function(e){self.down(e)});
};
Board.prototype.pos=function(i){var f=i%8,r=(i/8)|0;return this.flip?{c:7-f,r:7-r}:{c:f,r:r}};
Board.prototype.sqAt=function(cx,cy){
  var b=this.el.getBoundingClientRect(),s=b.width/8;
  var c=Math.floor((cx-b.left)/s),r=Math.floor((cy-b.top)/s);
  if(c<0||c>7||r<0||r>7)return -1;
  return this.flip?((7-r)*8+(7-c)):(r*8+c);
};
Board.prototype.layout=function(){
  for(var i=0;i<64;i++){var p=this.pos(i),d=this.sqs[i];
    d.style.left=(p.c*12.5)+"%";d.style.top=(p.r*12.5)+"%";
    var co=d.children;
    co[0].textContent=(p.r===7)?FILES[i%8]:"";
    co[1].textContent=(p.c===0)?String(8-((i/8)|0)):"";
  }
  for(var k in this.pieces)this.xf(this.pieces[k]);
  this.drawDests();this.redrawAnn();
};
Board.prototype.xf=function(o){var p=this.pos(o.sq);
  o.el.style.transform="translate("+(p.c*100)+"%,"+(p.r*100)+"%)"};
Board.prototype.spawn=function(code,i){
  var id=this.nid++,el=document.createElement("div");
  el.className="pc";el.innerHTML='<svg viewBox="0 0 45 45">'+PIECES[code]+"</svg>";
  var o={id:id,code:code,sq:i,el:el};this.pieces[id]=o;this.at[i]=id;
  this.el.appendChild(el);this.xf(o);return o;
};
Board.prototype.kill=function(i){
  var id=this.at[i];if(!id)return;var o=this.pieces[id];
  o.el.classList.add("gone");(function(e){setTimeout(function(){e.remove()},200)})(o.el);
  delete this.pieces[id];this.at[i]=null;
};
Board.prototype.set=function(fen,last){
  for(var k in this.pieces)this.pieces[k].el.remove();
  this.pieces={};this.at=new Array(64).fill(null);
  var b=fenBoard(fen);
  for(var i=0;i<64;i++)if(b[i])this.spawn(b[i],i);
  this.turn=fenTurn(fen);this.clearMarks();this.ann={cal:[],csl:[]};this.redrawAnn();
  if(last)this.mark("last",[idxOf(last.slice(0,2)),idxOf(last.slice(2,4))]);
};
Board.prototype.move=function(uci){
  if(!uci||uci==="0000")return;
  var from=idxOf(uci.slice(0,2)),to=idxOf(uci.slice(2,4)),promo=uci[4];
  var id=this.at[from];if(!id)return;var o=this.pieces[id];
  if(o.code.toLowerCase()==="p"&&(from%8)!==(to%8)&&!this.at[to])
    this.kill(to+((o.code==="P")?8:-8));
  if(this.at[to])this.kill(to);
  if(o.code.toLowerCase()==="k"&&Math.abs((from%8)-(to%8))===2){
    var base=((to/8)|0)*8, rf=(to%8===6)?base+7:base, rt=(to%8===6)?base+5:base+3;
    var rid=this.at[rf];
    if(rid){var ro=this.pieces[rid];this.at[rf]=null;this.at[rt]=rid;ro.sq=rt;this.xf(ro)}
  }
  this.at[from]=null;this.at[to]=id;o.sq=to;
  if(promo){o.code=(o.code==="P")?promo.toUpperCase():promo.toLowerCase();
    o.el.innerHTML='<svg viewBox="0 0 45 45">'+PIECES[o.code]+"</svg>"}
  this.xf(o);this.clearMarks();this.mark("last",[from,to]);
};
Board.prototype.clearMarks=function(){
  for(var i=0;i<64;i++)this.sqs[i].classList.remove("last","sel","err");
  this.sel=null;this.dests=[];this.drawDests();
};
Board.prototype.mark=function(cls,arr){for(var i=0;i<arr.length;i++)this.sqs[arr[i]].classList.add(cls)};
Board.prototype.drawDests=function(){
  this.destLayer.innerHTML="";
  for(var i=0;i<this.dests.length;i++){
    var t=this.dests[i],p=this.pos(t),d=document.createElement("div");
    d.className="dest"+(this.at[t]?" cap":"");d.innerHTML="<i></i>";
    d.style.left=(p.c*12.5)+"%";d.style.top=(p.r*12.5)+"%";
    this.destLayer.appendChild(d);
  }
};
Board.prototype.select=function(i){
  for(var k=0;k<64;k++)this.sqs[k].classList.remove("sel");
  this.sel=(i>=0)?i:null;this.dests=[];
  if(i>=0&&this.legal){
    this.sqs[i].classList.add("sel");
    var from=nameOf(i);
    for(var m=0;m<this.legal.length;m++)
      if(this.legal[m].slice(0,2)===from)this.dests.push(idxOf(this.legal[m].slice(2,4)));
  }
  this.drawDests();
};
Board.prototype.down=function(e){
  if(this.locked||!this.legal)return;
  var sq=this.sqAt(e.clientX,e.clientY);if(sq<0)return;
  e.preventDefault();
  if(this.sel!==null&&this.dests.indexOf(sq)>=0){this.commit(this.sel,sq);return}
  var id=this.at[sq];
  if(!id){this.select(-1);return}
  var o=this.pieces[id];
  var mine=(this.turn==="w")?(o.code===o.code.toUpperCase()):(o.code===o.code.toLowerCase());
  if(!mine){this.select(-1);return}
  this.select(sq);
  var self=this,moved=false,el=o.el;
  var b=this.el.getBoundingClientRect(),s=b.width/8;
  var p=this.pos(sq),ox=e.clientX,oy=e.clientY;
  function mv(ev){
    if(!moved&&Math.abs(ev.clientX-ox)+Math.abs(ev.clientY-oy)<5)return;
    moved=true;el.classList.add("drag");
    el.style.transform="translate("+(p.c*s+ev.clientX-ox)+"px,"+(p.r*s+ev.clientY-oy)+"px)";
  }
  function up(ev){
    document.removeEventListener("pointermove",mv);document.removeEventListener("pointerup",up);
    if(!moved)return;
    el.classList.remove("drag");self.xf(o);
    var t=self.sqAt(ev.clientX,ev.clientY);
    if(t>=0&&t!==sq&&self.dests.indexOf(t)>=0)self.commit(sq,t);
  }
  document.addEventListener("pointermove",mv);document.addEventListener("pointerup",up);
};
Board.prototype.commit=function(from,to){
  var uci=nameOf(from)+nameOf(to);
  var cands=[];
  for(var m=0;m<this.legal.length;m++)if(this.legal[m].slice(0,4)===uci)cands.push(this.legal[m]);
  this.select(-1);
  if(!cands.length)return;
  var pick=cands[0];
  if(cands.length>1){var q=cands.filter(function(x){return x[4]==="q"});if(q.length)pick=q[0]}
  if(this.onPick)this.onPick(pick);
};
Board.prototype.annotate=function(cal,csl){
  this.ann={cal:cal||[],csl:csl||[]};this.redrawAnn();
};
Board.prototype.redrawAnn=function(){
  var o=this.ov;o.innerHTML="";var a=this.ann||{cal:[],csl:[]},self=this;
  function ctr(sq){var p=self.pos(idxOf(sq));return{x:p.c+.5,y:p.r+.5}}
  a.csl.forEach(function(t){
    var c=ctr(t.slice(1,3)),el=document.createElementNS(SVGNS,"circle");
    el.setAttribute("cx",c.x);el.setAttribute("cy",c.y);el.setAttribute("r",.44);
    el.setAttribute("fill","none");el.setAttribute("stroke",COL[t[0]]||COL.G);
    el.setAttribute("stroke-width",.062);el.setAttribute("opacity",.92);o.appendChild(el);
  });
  a.cal.forEach(function(t){
    var A=ctr(t.slice(1,3)),B=ctr(t.slice(3,5)),col=COL[t[0]]||COL.R;
    var dx=B.x-A.x,dy=B.y-A.y,L=Math.sqrt(dx*dx+dy*dy);if(!L)return;
    var ux=dx/L,uy=dy/L,head=.32,sx=A.x+ux*.3,sy=A.y+uy*.3;
    var ex=B.x-ux*.06,ey=B.y-uy*.06,bx=ex-ux*head,by=ey-uy*head;
    var g=document.createElementNS(SVGNS,"g");g.setAttribute("opacity",.88);
    var ln=document.createElementNS(SVGNS,"line");
    ln.setAttribute("x1",sx);ln.setAttribute("y1",sy);ln.setAttribute("x2",bx+ux*.02);
    ln.setAttribute("y2",by+uy*.02);ln.setAttribute("stroke",col);
    ln.setAttribute("stroke-width",.115);ln.setAttribute("stroke-linecap","round");
    var pg=document.createElementNS(SVGNS,"polygon");
    pg.setAttribute("points",[ex,ey,bx-uy*head*.55,by+ux*head*.55,bx+uy*head*.55,by-ux*head*.55].join(" "));
    pg.setAttribute("fill",col);
    g.appendChild(ln);g.appendChild(pg);o.appendChild(g);
  });
};

/* ============================== text ============================== */
function esc(s){return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}
var MOVE=/(^|[\s(–—"'“])([KQRBN]?[a-h][1-8](?:=[QRBN])?[+#]?[!?]{0,2}|O-O(?:-O)?[+#]?)(?=$|[\s.,;:)?!"'’”])/g;
function fmt(s){
  return esc(s).replace(MOVE,function(m,pre,mv){return pre+"<code>"+mv+"</code>"});
}
function prose(t){
  if(!t)return"";
  var links=[],i;
  t=t.replace(/\[(https?:\/\/[^\]\s]+)\]/g,function(m,u){
    links.push('<a href="'+u+'" target="_blank" rel="noopener">'+
      u.replace(/^https?:\/\/(www\.)?/,"").replace(/\/$/,"")+"</a>");
    return "@@L"+(links.length-1)+"@@";});
  t=t.replace(/\{\{(-?\d+)\}\}/g,function(m,n){
    if(n==="-1")return"";
    links.push('<a href="#" data-goto="'+n+'">open this lesson</a>');
    return "@@L"+(links.length-1)+"@@";});
  var blocks=t.split(/\n\s*\n/),out="";
  for(i=0;i<blocks.length;i++){
    var b=blocks[i].trim();if(!b)continue;
    var lines=b.split("\n");
    var isList=/^\s*\*\s+/.test(lines[0]);
    if(isList){
      out+="<ul>"+lines.filter(function(l){return l.trim()}).map(function(l){
        return "<li>"+fmt(l.replace(/^\s*\*\s+/,""))+"</li>"}).join("")+"</ul>";
    } else out+="<p>"+fmt(b.replace(/\n/g," "))+"</p>";
  }
  out=out.replace(/<\/ul><ul>/g,"");
  return out.replace(/@@L(\d+)@@/g,function(m,n){return links[+n]||""});
}

/* ============================== state ============================== */
var KEY="pbc.trainer.v1";
var P={res:{},read:{},cursor:0},C={secs:20,auto:0,coords:1,mode:"all"};
function load(){try{var j=JSON.parse(localStorage.getItem(KEY)||"{}");
  if(j.P){P.res=j.P.res||{};P.read=j.P.read||{};P.cursor=j.P.cursor||0}
  if(j.C){for(var k in j.C)C[k]=j.C[k]}}catch(e){}}
function save(){try{localStorage.setItem(KEY,JSON.stringify({P:P,C:C}))}catch(e){}}
load();

var S={order:[],k:0,ply:0,phase:"idle",failed:false,hinted:false,parts:[],
       pendAnn:null,explore:null,trapAlt:null,trapK:0,timer:null,why:""};
var board=new Board($("board"));

function item(){return DATA[S.order[S.k]]}
function statusOf(it){
  if(it.kind!=="pos")return P.read[it.id]?"read":"";
  var seen=0,total=0,worst="clean";
  for(var i=0;i<it.plies.length;i++){
    if(!it.plies[i].q)continue;
    total++;
    var r=P.res[it.id+":"+i];
    if(!r)continue;
    seen++;
    if(r==="missed")worst="missed";
    else if(r==="hint"&&worst!=="missed")worst="hint";
  }
  if(!total)return P.read[it.id]?"read":"";
  if(seen===0)return"";
  if(seen<total)return worst==="clean"?"partial":worst;
  return worst;
}
function buildOrder(){
  S.order=[];
  for(var i=0;i<DATA.length;i++){
    var st=statusOf(DATA[i]);
    if(C.mode==="all")S.order.push(i);
    else if(C.mode==="todo"){if(st===""||st==="partial")S.order.push(i)}
    else if(C.mode==="missed"){if(st==="missed"||st==="hint")S.order.push(i)}
  }
  if(!S.order.length){C.mode="all";for(var j=0;j<DATA.length;j++)S.order.push(j)}
}

/* ============================== rail ============================== */
function renderRail(){
  var h="",cur=null,list=$("railList"),chapStats={};
  DATA.forEach(function(it){
    var st=statusOf(it);
    var s=chapStats[it.chap]||(chapStats[it.chap]={ok:0,no:0,n:0});
    s.n++;if(st==="clean"||st==="read")s.ok++;else if(st==="missed"||st==="hint")s.no++;
  });
  DATA.forEach(function(it,i){
    if(it.chap!==cur){
      cur=it.chap;var s=chapStats[cur];
      h+='<div class="chap"><span>'+esc(cur.replace(/^\d+\.\s*/,""))+'</span>'+
         '<span class="cbar"><i class="ok" style="width:'+(s.ok/s.n*100)+'%"></i>'+
         '<i class="no" style="width:'+(s.no/s.n*100)+'%"></i></span></div>';
    }
    var st2=statusOf(it);
    h+='<div class="row'+(it.kind!=="pos"?" lesson":"")+(st2?" s-"+st2:"")+
       '" data-i="'+i+'"><span class="dot"></span><span class="nm">'+
       esc(it.title)+"</span></div>";
  });
  list.innerHTML=h;
  var rows=list.querySelectorAll(".row");
  for(var j=0;j<rows.length;j++)rows[j].addEventListener("click",function(){
    jumpTo(+this.dataset.i)});
  syncRail();
}
function syncRail(){
  var list=$("railList"),rows=list.querySelectorAll(".row");
  for(var j=0;j<rows.length;j++){
    var i=+rows[j].dataset.i,it=DATA[i],st=statusOf(it);
    rows[j].className="row"+(it.kind!=="pos"?" lesson":"")+(st?" s-"+st:"")+
      (i===S.order[S.k]?" cur":"");
  }
  var c=list.querySelector(".row.cur");
  if(c)c.scrollIntoView({block:"nearest"});
}
function jumpTo(dataIdx){
  var k=S.order.indexOf(dataIdx);
  if(k<0){C.mode="all";buildOrder();k=S.order.indexOf(dataIdx)}
  S.k=k;loadItem();
  if(window.innerWidth<760)$("app").classList.add("railoff");
}

/* ============================== timer ============================== */
function budget(){
  if(!C.secs)return 0;
  var it=item(),first=true;
  for(var i=0;i<S.ply;i++)if(it.plies[i].q)first=false;
  return first?C.secs:Math.max(8,Math.round(C.secs*.75));
}
function startTimer(){
  stopTimer();
  var t=$("timer"),f=$("timerFill"),secs=budget();
  t.className="timer"+(secs?"":" off");
  f.style.transform="scaleX(1)";
  if(!secs)return;
  var t0=Date.now();
  S.timer=setInterval(function(){
    var frac=1-(Date.now()-t0)/(secs*1000);
    if(frac<=0){f.style.transform="scaleX(0)";stopTimer();timeUp();return}
    f.style.transform="scaleX("+frac+")";
    t.className="timer"+(frac<.18?" crit":(frac<.4?" warn":""));
  },80);
}
function stopTimer(){if(S.timer){clearInterval(S.timer);S.timer=null}}
function timeUp(){reveal(true)}

/* ============================== flow ============================== */
function loadItem(){
  stopTimer();board.locked=true;board.legal=null;board.annotate([],[]);
  S.ply=0;S.parts=[];S.failed=false;S.hinted=false;S.explore=null;S.trapAlt=null;S.pendAnn=null;
  var it=item();
  P.cursor=S.order[S.k];save();
  $("crumbC").textContent=it.chap.replace(/^\d+\.\s*/,"");
  $("crumbT").textContent=it.title;
  $("counter").textContent=(S.k+1)+" / "+S.order.length;
  renderTally();syncRail();
  if(it.kind!=="pos"){showLesson(it);return}
  $("lessonwrap").style.display="none";$("stage").style.display="";
  fit();
  board.flip=(it.player==="b");board.layout();
  board.set(it.fen);
  $("timerFill").style.transform="scaleX(1)";$("timer").className="timer off";
  if(it.intro)S.parts.push(it.intro);
  if(it.introcal||it.introcsl)S.pendAnn={cal:it.introcal||[],csl:it.introcsl||[]};
  S.phase="intro";renderPanel();
  setTimeout(step,d(it.intro?520:140));
}
function showLesson(it){
  $("stage").style.display="none";$("lessonwrap").style.display="";
  $("lesK").textContent=it.chap.replace(/^\d+\.\s*/,"");
  $("lesT").textContent=it.title;
  $("lesB").innerHTML=prose(it.text||"");
  $("lesB").querySelectorAll("[data-goto]").forEach(function(a){
    a.addEventListener("click",function(e){e.preventDefault();jumpTo(+this.dataset.goto)})});
  P.read[it.id]=1;save();syncRail();renderTally();
  $("lessonwrap").scrollTop=0;
  S.phase="lesson";
}
function step(){
  var it=item();
  if(S.ply>=it.plies.length){itemDone();return}
  var p=it.plies[S.ply];
  if(p.q){ask(p);return}
  if(p.u==="0000"){
    S.parts.push("The opponent has nothing to do here. Move the same piece again.");
    S.ply++;renderPanel();setTimeout(step,d(460));return;
  }
  board.move(p.u);
  if(p.t)S.parts.push(p.t);
  if(p.cal||p.csl)S.pendAnn={cal:p.cal||[],csl:p.csl||[]};
  S.ply++;renderPanel();
  setTimeout(step,d(p.t?880:540));
}
function ask(p){
  S.phase="quiz";S.explore=null;S.trapAlt=null;
  board.annotate([],[]);
  board.legal=p.legal.split(" ");board.locked=false;board.turn=p.side;
  board.onPick=onPick;
  $("turnBadge").textContent=(p.side==="w"?"White":"Black")+" to move";
  renderPanel();startTimer();
}
function onPick(uci){
  var it=item(),p=it.plies[S.ply];
  board.locked=true;board.legal=null;board.select(-1);stopTimer();
  if(uci===p.u){good(p);return}
  var hit=null;
  (p.alts||[]).forEach(function(a){if(a.u===uci)hit=a});
  mark(p,"missed");
  if(hit){playTrap(p,hit);return}
  var to=idxOf(uci.slice(2,4));
  board.el.classList.add("shake");board.sqs[to].classList.add("err");
  setTimeout(function(){board.el.classList.remove("shake")},340);
  setTimeout(function(){board.sqs[to].classList.remove("err");
    teach(p,"That is not it.")},d(640));
}
function good(p){
  board.move(p.u);
  mark(p,S.hinted?"hint":"clean");
  var quiet=!p.t&&!p.cal&&!p.csl&&!(p.alts&&p.alts.length);
  S.phase="solved";S.hinted=false;
  var a=S.pendAnn||{cal:[],csl:[]};
  board.annotate((a.cal||[]).concat(p.cal||[]),(a.csl||[]).concat(p.csl||[]));
  S.pendAnn=null;
  renderPanel();
  if(quiet){S.parts=[];S.ply++;S.phase="idle";setTimeout(step,d(360));return}
  if(C.auto)setTimeout(function(){if(S.phase==="solved")next()},C.auto*1000);
}
function reveal(fromTimer){
  if(S.phase!=="quiz")return;
  var it=item(),p=it.plies[S.ply];
  board.locked=true;board.legal=null;board.select(-1);stopTimer();
  mark(p,"missed");
  teach(p,fromTimer?"Out of time.":"Shown.");
}
function teach(p,why){
  S.phase="taught";S.failed=true;S.why=why;
  board.set(p.f);board.move(p.u);
  var a=S.pendAnn||{cal:[],csl:[]};
  board.annotate((a.cal||[]).concat(p.cal||[]),(a.csl||[]).concat(p.csl||[]));
  renderPanel();
}
function playTrap(p,alt){
  S.phase="trap";S.trapAlt=alt;S.trapK=0;
  board.set(p.f);
  var i=0;
  (function run(){
    if(S.phase!=="trap")return;
    if(i>=alt.line.length){renderPanel();return}
    board.move(alt.line[i].u);
    var st=alt.line[i];
    board.annotate(st.cal||[],st.csl||[]);
    S.trapK=i;i++;renderPanel();
    setTimeout(run,d(st.t?1250:750));
  })();
}
function mark(p,val){
  var it=item(),key=it.id+":"+S.ply,cur=P.res[key];
  if(val==="missed"||cur==="missed"){P.res[key]="missed"}
  else if(val==="hint"||cur==="hint"){P.res[key]="hint"}
  else P.res[key]="clean";
  save();syncRail();renderTally();
}
function itemDone(){
  var it=item();P.read[it.id]=1;save();
  S.phase="done";board.locked=true;board.legal=null;renderPanel();syncRail();
  if(C.auto)setTimeout(function(){if(S.phase==="done")next()},C.auto*1000);
}
function next(){
  if(S.phase==="taught"){retry();return}
  if(S.phase==="trap"){teach(item().plies[S.ply],"You walked into it.");return}
  if(S.phase==="solved"){S.parts=[];S.ply++;S.phase="idle";step();return}
  if(S.k<S.order.length-1){S.k++;loadItem()}
  else overlayEnd();
}
function prev(){if(S.k>0){S.k--;loadItem()}}
function skip(){if(S.k<S.order.length-1){S.k++;loadItem()}else overlayEnd()}
function retry(){
  var p=item().plies[S.ply];
  board.set(p.f);board.annotate([],[]);
  S.hinted=false;S.explore=null;ask(p);
}
function hint(){
  if(S.phase!=="quiz")return;
  var p=item().plies[S.ply];
  S.hinted=true;
  board.annotate([],["Y"+p.u.slice(0,2)]);
  mark(p,"hint");renderPanel();
}

/* ============================== panel ============================== */
var ICO={ok:'<svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>',
         no:'<svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>',
         nu:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'};
function renderPanel(){
  var it=item();if(it.kind!=="pos")return;
  var p=it.plies[Math.min(S.ply,it.plies.length-1)],h="";
  var ctx=S.parts.map(function(t){return prose(t)}).join("");
  if(S.phase==="intro"||S.phase==="quiz"||S.phase==="idle"){
    if(ctx)h+='<div class="ask">'+ctx+"</div>";
    if(S.phase==="quiz"){
      if(!ctx)h+='<div class="ask">'+prose(defaultAsk(it,p))+"</div>";
      if(S.hinted)h+='<div class="hintline">The circled piece is the one that moves.</div>';
    }
  } else if(S.phase==="solved"){
    h+='<div class="verdict v-ok"><span class="mk">'+ICO.ok+"</span>Correct</div>";
    h+='<div style="margin-bottom:12px"><span class="movetag ok">'+esc(p.s)+"</span></div>";
    if(ctx)h+='<div class="prose" style="opacity:.6">'+ctx+"</div>";
    if(p.t)h+='<div class="prose">'+prose(p.t)+"</div>";
    h+=altsBlock(p);
  } else if(S.phase==="trap"){
    var a=S.trapAlt;
    h+='<div class="verdict v-no"><span class="mk">'+ICO.no+"</span>Blunder</div>";
    h+='<div style="margin-bottom:12px"><span class="movetag no">'+esc(a.s)+"</span></div>";
    h+='<div class="prose">'+a.line.slice(0,S.trapK+1).map(function(x){
        return x.t?prose(x.t):""}).join("")+"</div>";
    h+=lineBar(a,S.trapK,"trap");
  } else if(S.phase==="taught"){
    var tmo=(S.why==="Out of time.");
    h+='<div class="verdict '+(tmo?"v-nu":"v-no")+'"><span class="mk">'+
       (tmo?ICO.nu:ICO.no)+"</span>"+esc(S.why||"")+"</div>";
    h+='<div style="margin-bottom:12px"><span class="movetag ok">'+esc(p.s)+"</span></div>";
    if(ctx)h+='<div class="prose" style="opacity:.6">'+ctx+"</div>";
    if(p.t)h+='<div class="prose">'+prose(p.t)+"</div>";
    h+=altsBlock(p);
  } else if(S.phase==="done"){
    var qs=0;for(var z=0;z<it.plies.length;z++)if(it.plies[z].q)qs++;
    h+='<div class="verdict v-ok"><span class="mk">'+ICO.ok+"</span>Position complete</div>";
    if(qs>1)h+='<div class="prose">All '+qs+" moves found.</div>";
    var lastp=it.plies[it.plies.length-1];
    if(!lastp.q&&lastp.t)h+='<div class="prose">'+prose(lastp.t)+"</div>";
  }
  $("panel").innerHTML=h;
  wirePanel();buttons();
}
function defaultAsk(it,p){
  var m=/(\d+)\s+Moves in a Row/i.exec(it.title);
  if(m)return "Move the piece "+m[1]+" times in a row without ever letting it be captured.";
  return (p.side==="w"?"White":"Black")+" to play.";
}
function altsBlock(p){
  if(!p.alts||!p.alts.length)return"";
  var h="",bad=[],ok=[];
  p.alts.forEach(function(a,i){(a.bad?bad:ok).push(i)});
  if(bad.length){
    h+='<div class="sect"><div class="sect-h">What goes wrong</div>';
    bad.forEach(function(i){h+=altCard(p.alts[i],i,"blunder")});
    h+="</div>";
  }
  if(ok.length){
    h+='<div class="sect"><div class="sect-h">Also considered</div>';
    ok.forEach(function(i){h+=altCard(p.alts[i],i,"")});
    h+="</div>";
  }
  return h;
}
function altCard(a,idx,tag){
  var open=!!(S.explore&&S.explore.i===idx);
  var h='<div class="alt'+(open?" on":"")+'" data-alt="'+idx+'">'+
        '<div class="alt-h"><span class="movetag '+(a.bad?"no":"ok")+'">'+esc(a.s)+"</span>"+
        (tag?'<span class="why">'+tag+"</span>":"")+"</div>";
  var upto=open?S.explore.k:0;
  h+='<div class="prose">'+a.line.slice(0,upto+1).map(function(x){
      return x.t?prose(x.t):""}).join("")+"</div>";
  h+=lineBar(a,open?S.explore.k:-1,"alt"+idx);
  return h+"</div>";
}
function lineBar(a,active,ns){
  var h='<div class="linebar" data-ns="'+ns+'">';
  a.line.forEach(function(x,i){
    h+='<button class="lm'+(i===active?" on":"")+'" data-step="'+i+'">'+esc(x.s)+"</button>"});
  if(ns!=="trap")h+='<button class="lm" data-step="-1">back</button>';
  return h+"</div>";
}
function backToAnswer(){
  var p=item().plies[S.ply];
  S.explore=null;board.set(p.f);board.move(p.u);
  var an=S.pendAnn||{cal:[],csl:[]};
  board.annotate((an.cal||[]).concat(p.cal||[]),(an.csl||[]).concat(p.csl||[]));
  renderPanel();
}
function wirePanel(){
  var pn=$("panel");
  pn.querySelectorAll("[data-goto]").forEach(function(a){
    a.addEventListener("click",function(e){e.preventDefault();jumpTo(+this.dataset.goto)})});
  pn.querySelectorAll(".lm").forEach(function(b){
    b.addEventListener("click",function(e){
      e.stopPropagation();
      var ns=this.parentNode.dataset.ns,st=+this.dataset.step;
      if(ns==="trap")return;
      var idx=+ns.slice(3),p=item().plies[S.ply],a=p.alts[idx];
      if(st<0){backToAnswer();return}
      S.explore={i:idx,k:st};
      board.set(p.f);
      for(var i=0;i<=st;i++)board.move(a.line[i].u);
      board.annotate(a.line[st].cal||[],a.line[st].csl||[]);
      renderPanel();
    })});
  pn.querySelectorAll(".alt").forEach(function(el){
    el.addEventListener("click",function(){
      var idx=+this.dataset.alt;
      if(S.explore&&S.explore.i===idx)return;
      var p=item().plies[S.ply],a=p.alts[idx];
      S.explore={i:idx,k:0};board.set(p.f);board.move(a.line[0].u);
      board.annotate(a.line[0].cal||[],a.line[0].csl||[]);renderPanel();
    })});
}
function buttons(){
  var q=(S.phase==="quiz");
  $("bHint").style.display=q?"":"none";
  $("bReveal").style.display=q?"":"none";
  $("bHint").disabled=S.hinted;
  $("bReveal").textContent=S.hinted?"Show me":"Give up";
  var n=$("bNext");
  n.className="btn"+(q?"":" pri");
  n.innerHTML=(S.phase==="taught"?"Try again":
              (S.phase==="trap"?"Show the right move":
              (q?"Skip":"Next")))+' <kbd>↵</kbd>';
  $("turnBadge").style.display=q?"":"none";
}
function renderTally(){
  var ok=0,no=0,tot=0;
  DATA.forEach(function(it){
    if(it.kind!=="pos")return;
    for(var i=0;i<it.plies.length;i++){
      if(!it.plies[i].q)continue;
      tot++;
      var r=P.res[it.id+":"+i];
      if(r==="clean")ok++;else if(r==="missed"||r==="hint")no++;
    }
  });
  $("tally").innerHTML='<span class="ok">'+ok+' clean</span><span class="no">'+no+" missed</span>";
  return {ok:ok,no:no,tot:tot};
}

/* ============================== overlays ============================== */
function seg(name,opts,val){
  return '<div class="seg" data-seg="'+name+'">'+opts.map(function(o){
    return '<button data-v="'+o[0]+'"'+(String(o[0])===String(val)?' class="on"':"")+">"+o[1]+"</button>"
  }).join("")+"</div>";
}
function prefRows(){
  return '<div class="opt"><div class="lab"><b>Clock</b><span>Per position; later moves in a line get 75%. Running out counts as a miss.</span></div>'+
    seg("secs",[[0,"off"],[10,"10s"],[20,"20s"],[30,"30s"],[45,"45s"]],C.secs)+"</div>"+
    '<div class="opt"><div class="lab"><b>Work through</b><span>all &middot; only untouched &middot; only missed</span></div>'+
    seg("mode",[["all","all"],["todo","new"],["missed","missed"]],C.mode)+"</div>"+
    '<div class="opt"><div class="lab"><b>Auto-advance</b><span>After a correct answer.</span></div>'+
    seg("auto",[[0,"off"],[2,"2s"],[4,"4s"]],C.auto)+"</div>"+
    '<div class="opt"><div class="lab"><b>Coordinates</b><span>File and rank labels.</span></div>'+
    seg("coords",[[1,"on"],[0,"off"]],C.coords)+"</div>";
}
function overlayStart(){
  var t=renderTally(),done=t.ok+t.no;
  var res=DATA[P.cursor]||DATA[0];
  var h='<h2>Preventing Blunders in Chess</h2><div class="sub">CM Can Kabadayı &middot; '+
        DATA.length+" items &middot; "+t.tot+" quiz moves</div>"+
        '<div class="stat"><div><div class="n">'+t.ok+'</div><div class="k">clean</div></div>'+
        '<div><div class="n">'+t.no+'</div><div class="k">missed</div></div>'+
        '<div><div class="n">'+Math.round(done/t.tot*100)+'%</div><div class="k">covered</div></div></div>'+
        prefRows()+
        '<div class="cardfoot"><button class="btn pri" data-act="go">'+
        (done?"Continue — "+esc(res.title):"Start the course")+"</button>"+
        (done?'<button class="btn" data-act="restart">From the top</button>':"")+
        '<span class="spacer"></span><button class="btn gh" data-act="wipe">Reset progress</button></div>';
  openVeil(h,function(act){
    if(act==="go"){buildOrder();var k=S.order.indexOf(P.cursor);S.k=k<0?0:k;closeVeil();loadItem()}
    if(act==="restart"){buildOrder();S.k=0;closeVeil();loadItem()}
    if(act==="wipe"){if(confirm("Erase all progress?")){P={res:{},read:{},cursor:0};save();
      renderRail();overlayStart()}}
  });
}
function overlaySettings(){
  var h='<h2>Settings</h2><div class="sub">Saved in this browser.</div>'+prefRows()+
    '<div class="cardfoot"><button class="btn pri" data-act="close">Done</button>'+
    '<span class="spacer"></span><button class="btn gh" data-act="wipe">Reset progress</button></div>';
  openVeil(h,function(act){
    if(act==="close"){var cur=S.order[S.k];buildOrder();var k=S.order.indexOf(cur);
      S.k=(k<0)?Math.min(S.k,S.order.length-1):k;closeVeil();
      $("counter").textContent=(S.k+1)+" / "+S.order.length;syncRail()}
    if(act==="wipe"){if(confirm("Erase all progress?")){P={res:{},read:{},cursor:0};save();
      renderRail();renderTally();closeVeil()}}
  });
}
function overlayEnd(){
  var t=renderTally();
  openVeil('<h2>End of the run</h2><div class="sub">'+t.ok+" clean, "+t.no+
    " missed, out of "+t.tot+" quiz moves.</div>"+
    '<div class="cardfoot"><button class="btn pri" data-act="missed">Run the missed ones</button>'+
    '<button class="btn" data-act="close">Stay here</button></div>',
    function(act){
      if(act==="missed"){C.mode="missed";save();buildOrder();S.k=0;closeVeil();loadItem()}
      if(act==="close")closeVeil();
    });
}
function openVeil(html,onAct){
  var v=$("veil"),c=$("veilCard");c.innerHTML=html;v.style.display="grid";
  c.querySelectorAll("[data-act]").forEach(function(b){
    b.addEventListener("click",function(){onAct(this.dataset.act)})});
  c.querySelectorAll("[data-seg] button").forEach(function(b){
    b.addEventListener("click",function(){
      var name=this.parentNode.dataset.seg,v2=this.dataset.v;
      C[name]=(name==="mode")?v2:+v2;save();
      var sib=this.parentNode.children;
      for(var i=0;i<sib.length;i++)sib[i].className=(sib[i]===this)?"on":"";
      applyPrefs();
    })});
}
function closeVeil(){$("veil").style.display="none"}
function applyPrefs(){$("app").classList.toggle("nocoords",!C.coords)}

/* ============================== sizing / keys ============================== */
function fit(){
  var stage=$("stage");
  if(stage.style.display==="none")return;
  var wide=window.innerWidth>1080;
  var availH=stage.clientHeight-92;
  var availW=wide?Math.min(stage.clientWidth-540,720):Math.min(stage.clientWidth-4,560);
  var s=Math.floor(Math.max(160,Math.min(availH,availW))/8);
  document.documentElement.style.setProperty("--sq",s+"px");
}
window.addEventListener("resize",fit);
document.addEventListener("keydown",function(e){
  if($("veil").style.display!=="none"){if(e.key==="Escape")closeVeil();return}
  if(e.key==="Enter"){e.preventDefault();
    if(S.phase==="lesson")skip();else if(S.phase==="quiz")skip();else next();return}
  if(e.key==="ArrowRight"){e.preventDefault();skip();return}
  if(e.key==="ArrowLeft"){e.preventDefault();prev();return}
  var k=e.key.toLowerCase();
  if(k==="h")hint();
  else if(k==="r")reveal(false);
  else if(k==="f"){board.flip=!board.flip;board.layout()}
  else if(k==="c"){$("app").classList.toggle("railoff");setTimeout(fit,250)}
});

$("btnRail").addEventListener("click",function(){$("app").classList.toggle("railoff");
  setTimeout(fit,250)});
$("btnCfg").addEventListener("click",overlaySettings);
$("bHint").addEventListener("click",hint);
$("bReveal").addEventListener("click",function(){reveal(false)});
$("bNext").addEventListener("click",function(){if(S.phase==="quiz")skip();else next()});
$("bPrev").addEventListener("click",prev);
$("bNext2").addEventListener("click",skip);
$("bPrev2").addEventListener("click",prev);
$("bFlip").addEventListener("click",function(){board.flip=!board.flip;board.layout()});

/* ============================== boot ============================== */
var bootEl=document.getElementById("boot");if(bootEl)bootEl.remove();
applyPrefs();
if(window.innerWidth>1180)$("app").classList.remove("railoff");
buildOrder();renderRail();fit();
var k0=S.order.indexOf(P.cursor);S.k=k0<0?0:k0;
loadItem();
overlayStart();
window.addEventListener("beforeunload",save);
window.__CT={S:S,board:board,next:next,jumpTo:jumpTo,pick:onPick,item:item,fit:fit};
}
