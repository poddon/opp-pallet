(()=>{
const API=(window.OPP_DB_URL||"https://munbcjaikjpbpuxzpbqq.supabase.co/functions/v1/quiz-api")+"?action=live";
const $=id=>document.getElementById(id);
const clean=s=>String(s||"").trim();
let sessionId="",lastState="",sending=false;
const uuid=()=>crypto.randomUUID?crypto.randomUUID():"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,c=>{const n=Math.random()*16|0;return(c==="x"?n:(n&3|8)).toString(16)});
async function studentPulse(){
const quiz=$("quiz"),result=$("result"),cheat=$("cheat");
const active=quiz&&!quiz.classList.contains("hidden");
if(!active&&!sessionId)return;
const name=clean($("fio")?.value),group=clean($("group")?.value);if(!name||!group)return;
if(active&&!sessionId)sessionId=uuid();
const q=clean($("qn")?.textContent).match(/(\d+)\s*\/\s*(\d+)/);
const question=q?Number(q[1]):1,total=q?Number(q[2]):50;
const time=clean($("qt")?.textContent);const parts=time.split(":");
const seconds_left=parts.length===2?(Number(parts[0])*60+Number(parts[1])):0;
const status=active?"Проходит":cheat&&!cheat.classList.contains("hidden")?"Нарушение":result&&!result.classList.contains("hidden")?"Завершил":"Завершил";
const signature=[sessionId,question,status,Math.floor(seconds_left/5)].join(":");
if(sending||(!active&&signature===lastState))return;
sending=true;
try{const r=await fetch(API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({session_id:sessionId,name,group,question,total,seconds_left,status})});if(r.ok){lastState=signature;if(!active)sessionId=""}}catch(e){console.warn("Отслеживание прогресса:",e)}finally{sending=false}
}
setInterval(studentPulse,3000);
const safe=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let refreshing=false;
async function adminRefresh(){
if(!$("admin")||$("admin").classList.contains("hidden")||refreshing)return;
refreshing=true;
try{const r=await fetch(API,{cache:"no-store",headers:{"x-admin-name":encodeURIComponent(clean($("fio")?.value)),"x-admin-password":$("pwd")?.value||""}});
if(!r.ok)throw Error("HTTP "+r.status);
const d=await r.json();if(!d.ok||!Array.isArray(d.rows))throw Error("Ответ сервера");
const rows=d.rows.filter(x=>x.status==="Проходит");
$("liveCount").textContent=String(rows.length);
$("liveBody").innerHTML=rows.length?rows.map(x=>"<tr><td>"+safe(x.name)+"</td><td>"+safe(x.group_code)+"</td><td>"+safe(x.question)+" / "+safe(x.total)+"</td><td>"+safe(x.seconds_left)+" с</td><td>Проходит</td></tr>").join(""):"<tr><td colspan='5'>Сейчас никто не проходит тест</td></tr>";
$("liveMessage").textContent="Обновлено: "+new Date().toLocaleTimeString("ru-RU");
}catch(e){$("liveMessage").textContent="Не удалось обновить: "+e.message}finally{refreshing=false}
}
setInterval(adminRefresh,3000);
$("go")?.addEventListener("click",()=>setTimeout(adminRefresh,800));
})();