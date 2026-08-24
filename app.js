(function () {
  try { localStorage.setItem("opp_access_v1", JSON.stringify({ "1": true })); } catch (e) {}
  try {
    fetch("https://abacus.jasoncameron.dev/set/opp-pallet/module1?value=1", {
      method: "POST",
      headers: { Authorization: "Bearer 96ae5f9d-549c-42b6-870d-a54ab46e150e" }
    }).catch(function () {});
  } catch (e) {}
  var s = document.createElement("script");
  s.src = "https://cdn.jsdelivr.net/gh/poddon/opp-pallet@c3c00d1e3d54253b10c1205da96edd3391117eeb/app.js?v=restore1";
  s.onerror = function () {
    document.body.insertAdjacentHTML("beforeend",
      '<p style="color:#ff8a8a;text-align:center;margin-top:30vh;font-family:sans-serif">Не удалось загрузить приложение. Нажмите Ctrl+F5.</p>');
  };
  document.body.appendChild(s);
})();
