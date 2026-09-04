from pathlib import Path
html = Path('desktop/web/index.html')
s = html.read_text(encoding='utf-8')
s = s.replace(
    '<th>Дата</th><th>ФИО</th><th>Группа</th><th>Модуль</th><th>Верных</th><th>Всего</th><th>%</th><th>XP</th><th>Сек</th><th>Статус</th>',
    '<th>Дата</th><th>ФИО</th><th>Группа</th><th>Верных</th><th>Всего</th><th>%</th><th>Статус</th>'
)
html.write_text(s, encoding='utf-8')
appp = Path('desktop/web/app.js')
a = appp.read_text(encoding='utf-8')
a = a.replace('</td><td>" + esc(modTitle(r.modules)) + "</td><td>" + esc(r.correct)', '</td><td>" + esc(r.correct)')
a = a.replace(' + "</td><td>" + esc(r.xp) + "</td><td>" + esc(r.duration)', '')
a = a.replace("colspan='10'", "colspan='7'")
a = a.replace(
    'const heads = ["Дата", "ФИО", "Группа", "Модуль", "Верных", "Всего", "%", "XP", "Сек", "Статус"];',
    'const heads = ["Дата", "ФИО", "Группа", "Верных", "Всего", "%", "Статус"];'
)
a = a.replace('      const title = (bank()[r.modules] && bank()[r.modules].title) || "Общий тест";\n', '')
a = a.replace('      sheet += xlsxCell(3, n, title, false);\n', '')
a = a.replace('      sheet += xlsxCell(7, n, r.xp, true);\n      sheet += xlsxCell(8, n, r.duration, true);\n      sheet += xlsxCell(9, n, r.status, false);', '      sheet += xlsxCell(3, n, r.correct, true);\n      sheet += xlsxCell(4, n, r.total, true);\n      sheet += xlsxCell(5, n, r.pct, true);\n      sheet += xlsxCell(6, n, r.status, false);')
# if old numeric columns remain after title removal, collapse duplicates later
a = a.replace("A1:J'", "A1:G'")
appp.write_text(a, encoding='utf-8')
print('slim-table applied')
