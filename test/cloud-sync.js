(()=>{
const KEY="opp50_results_v2",DONE="opp50_uploads_v2",OLD="opp50_uploads",API=(window.OPP_DB_URL||"https://munbcjaikjpbpuxzpbqq.supabase.co/functions/v1/quiz-api")+"?action=results";
let busy=false;
const read=(k,empty)=>{try{return JSON.parse(localStorage.getItem(k)||"null")||empty}catch{return empty}};
const uid=()=>typeof crypto!=="undefined"&&crypto.randomUUID?crypto.randomUUID():"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,c=>{const n=Math.random()*16|0;return(c==="x"?n:n&3|8).toString(16)});
const signature=r=>JSON.stringify([r.date,r.name,r.group,r.modules,r.status,r.correct,r.total,r.pct,r.xp,r.duration]);
async function sync(){
if(busy||!navigator.onLine)return;
busy=true;
try{
const rows=read(KEY,[]),sent=read(DONE,{}),legacy=read(OLD,{});
for(const r of rows){
if(!r||!r.name||!r.group||!["Пройден","СПИСЫВАНИЕ"].includes(r.status))continue;
const sig=signature(r),old=JSON.stringify(r);
if(sent[sig]||legacy[old])continue;
if(!sent["id:"+sig]){sent["id:"+sig]=uid();localStorage.setItem(DONE,JSON.stringify(sent))}
try{
const response=await fetch(API,{method:"POST",mode:"cors",cache:"no-store",headers:{"Content-Type":"application/json"},body:JSON.stringify({...r,submission_id:sent["id:"+sig]})});
if(!response.ok)throw new Error("HTTP "+response.status);
const data=await response.json();if(!data.ok)throw new Error("API rejected result");
sent[sig]=true;localStorage.setItem(DONE,JSON.stringify(sent));
}catch(e){console.warn("ОПП: результат ожидает синхронизации",e);break}
}
}finally{busy=false}
}
window.OPP_SYNC_RESULTS=sync;
window.addEventListener("online",sync);
document.addEventListener("visibilitychange",()=>{if(!document.hidden)sync()});
setInterval(sync,8000);setTimeout(sync,1500);
})();