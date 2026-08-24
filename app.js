(async function(){
  const parts = [];
  for (let i=0;i<3;i++){
    const r = await fetch('app.part'+i+'.txt?v=eq5');
    parts.push(await r.text());
  }
  const code = parts.join('');
  const s = document.createElement('script');
  s.textContent = code;
  document.body.appendChild(s);
})().catch(e=>{console.error(e);document.body.insertAdjacentHTML('beforeend','<p style="color:red;text-align:center;margin-top:40vh">Ошибка загрузки app.js</p>');});
