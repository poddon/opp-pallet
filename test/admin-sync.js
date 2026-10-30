(()=>{
  const base=(window.OPP_DB_URL||"https://munbcjaikjpbpuxzpbqq.supabase.co/functions/v1/quiz-api")+"?action=results";
  const $=id=>document.getElementById(id);
  const escape=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  let busy=false;

  async function refresh(){
    const panel=$("admin");
    if(busy||!panel||panel.classList.contains("hidden"))return;
    busy=true;
    try{
      const response=await fetch(base,{method:"GET",cache:"no-store",headers:{"x-admin-name":encodeURIComponent($("fio").value.trim()),"x-admin-password":$("pwd").value}});
      if(response.status===401)throw Error("пароль общей базы не совпадает с паролем входа");
      if(!response.ok)throw Error("HTTP "+response.status);
      const data=await response.json();
      if(!data.ok||!Array.isArray(data.rows))throw Error("Invalid server response");
      const rows=data.rows;
      const body=$("abody");
      body.innerHTML=rows.length?rows.map(r=>"<tr>"+[r.date,r.name,r.group,r.modules,r.correct,r.total,r.pct,r.xp,r.duration,r.status].map(v=>"<td>"+escape(v)+"</td>").join("")+"</tr>").join(""):"<tr><td colspan='10'>Пока нет результатов</td></tr>";
      const good=rows.filter(r=>r.status==="Пройден");
      const values=[rows.length,good.length,rows.filter(r=>r.status==="СПИСЫВАНИЕ").length,good.length?Math.round(good.reduce((s,r)=>s+(Number(r.pct)||0),0)/good.length)+"%":"0%"];
      const labels=["прохождений","успешных","списываний","средний %"];
      $("astats").innerHTML=values.map((v,i)=>"<div class='stat'><b>"+v+"</b><span>"+labels[i]+"</span></div>").join("");
      window.OPP_SHARED_RESULTS=rows;

      window.OPP_REMOTE_READY=true;
      window.OPP_REMOTE_REFRESHED=Date.now();
      const info=$("sharedStatus");if(info)info.textContent="Общая база: "+rows.length+" результатов · обновлено "+new Date().toLocaleTimeString("ru-RU");
    }catch(err){
      const info=$("sharedStatus");if(info)info.textContent="Не удалось получить общие результаты: "+err.message;

    }finally{busy=false}
  }
  const admin=$("admin");
  const indicator=document.createElement("p");indicator.id="sharedStatus";indicator.className="sub";indicator.textContent="Общая база: ожидание входа";
  const table=$("abody")?.closest(".tbl");if(table)table.parentNode.insertBefore(indicator,table);
  $("go").addEventListener("click",()=>setTimeout(refresh,700));
  setInterval(refresh,15000);
})();