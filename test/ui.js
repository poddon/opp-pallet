/* Оформление теста: линейка прогресса, таймер, клавиши 1–4. Логику теста не меняет. */
(function () {
  function $(id) { return document.getElementById(id); }
  var ruler = $("ruler"), qn = $("qn"), verdict = $("verdict"), qt = $("qt");
  var total = 0, cur = -1;
  function parse() {
    var m = /(\d+)\s*\/\s*(\d+)/.exec(qn.textContent || "");
    return m ? { i: +m[1] - 1, n: +m[2] } : null;
  }
  function build(n) {
    total = n; ruler.innerHTML = "";
    for (var k = 0; k < n; k++) ruler.appendChild(document.createElement("span"));
  }
  function onQ() {
    var p = parse(); if (!p) return;
    if (p.n !== total || p.i === 0) build(p.n);
    var segs = ruler.children;
    if (segs[cur]) segs[cur].classList.remove("cur");
    cur = p.i;
    if (segs[cur] && !segs[cur].classList.contains("ok") && !segs[cur].classList.contains("bad")) segs[cur].classList.add("cur");
  }
  function onVerdict() {
    if (verdict.classList.contains("hidden")) return;
    var s = ruler.children[cur]; if (!s) return;
    s.classList.remove("cur");
    s.classList.add(verdict.classList.contains("ok") ? "ok" : "bad");
  }
  function onTimer() {
    var m = /(\d+):(\d+)/.exec(qt.textContent || "");
    qt.classList.toggle("warn", !!m && +m[1] === 0 && +m[2] <= 10);
  }
  new MutationObserver(onQ).observe(qn, { childList: true, characterData: true, subtree: true });
  new MutationObserver(onVerdict).observe(verdict, { attributes: true, attributeFilter: ["class"] });
  new MutationObserver(onTimer).observe(qt, { childList: true, characterData: true, subtree: true });
  document.addEventListener("keydown", function (e) {
    if ($("quiz").classList.contains("hidden")) return;
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    var n = parseInt(e.key, 10);
    if (n >= 1 && n <= 4) {
      var b = $("opts").children[n - 1];
      if (b && !b.disabled) { e.preventDefault(); b.click(); }
    }
  });
})();
