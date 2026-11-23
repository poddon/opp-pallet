package main

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"fmt"
	"sort"
	"strings"
	"time"
)

// shortGroup returns the group name used in the statement, e.g. "Электромонтаж-26-2".
// Groups created by earlier versions ("ЭЛЕКТРОМОНТАЖ И ЭКСПЛУАТАЦИЯ НИЗКОВОЛЬТНОГО ОБОРУДОВАНИЯ 26-2")
// get the same name; unknown names are kept as they are.
func shortGroup(code string) string {
	m := groupSuffix.FindStringSubmatch(code)
	if m == nil {
		return code
	}
	if d, ok := findDirection(m[1]); ok {
		return d.Code + "-" + m[2]
	}
	return code
}

type statementStudent struct {
	name    string
	percent int
}

type statementGroup struct {
	code, label string
	day         time.Time
	students    []statementStudent
}

// statement builds the per-group examination statement ("ведомость"): one sheet per group,
// the latest result of each student, and the share of students with 70% or more.
func statement(rows []resultRow) ([]byte, error) {
	groups := map[string]*statementGroup{}
	seen := map[string]bool{}
	for _, row := range rows { // rows are ordered newest first
		key := row.Group + "\x00" + strings.ToLower(normalize(row.Name))
		if seen[key] {
			continue
		}
		seen[key] = true
		g := groups[row.Group]
		if g == nil {
			g = &statementGroup{code: row.Group, label: shortGroup(row.Group)}
			groups[row.Group] = g
		}
		if day, err := time.Parse("02.01.2006", row.Date); err == nil && day.After(g.day) {
			g.day = day
		}
		g.students = append(g.students, statementStudent{normalize(row.Name), row.Percent})
	}
	list := make([]*statementGroup, 0, len(groups))
	for _, g := range groups {
		sort.Slice(g.students, func(i, j int) bool { return sortKey(g.students[i].name) < sortKey(g.students[j].name) })
		list = append(list, g)
	}
	sort.Slice(list, func(i, j int) bool { return sortKey(list[i].label) < sortKey(list[j].label) })

	var buf bytes.Buffer
	book := zip.NewWriter(&buf)
	types := `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`
	sheets, names, rels := "", "", ""
	used := map[string]bool{}
	parts := []struct{ name, body string }{}
	for k, g := range list {
		n := k + 1
		title := sheetTitle(g.label, used)
		types += fmt.Sprintf(`<Override PartName="/xl/worksheets/sheet%d.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`, n)
		sheets += fmt.Sprintf(`<sheet name="%s" sheetId="%d" r:id="rId%d"/>`, esc(title), n, n)
		rels += fmt.Sprintf(`<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet%d.xml"/>`, n, n)
		body, last := statementSheet(g)
		names += fmt.Sprintf(`<definedName name="_xlnm.Print_Area" localSheetId="%d">'%s'!$A$1:$D$%d</definedName>`,
			k, esc(strings.ReplaceAll(title, "'", "''")), last)
		parts = append(parts, struct{ name, body string }{fmt.Sprintf("xl/worksheets/sheet%d.xml", n), body})
	}
	rels += fmt.Sprintf(`<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`, len(list)+1)
	files := []struct{ name, body string }{
		{"[Content_Types].xml", types + `</Types>`},
		{"_rels/.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`},
		{"xl/workbook.xml", `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
			sheets + `</sheets><definedNames>` + names + `</definedNames><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`},
		{"xl/_rels/workbook.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` + rels + `</Relationships>`},
		{"xl/styles.xml", statementStyles},
	}
	for _, item := range append(files, parts...) {
		f, err := book.Create(item.name)
		if err != nil {
			return nil, err
		}
		if _, err := f.Write([]byte(item.body)); err != nil {
			return nil, err
		}
	}
	if err := book.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// Cell styles, matching the paper statement (Times New Roman 10).
const (
	stTitle = iota + 1
	stBoldRight
	stText
	stBoldLeft
	stHead
	stNumber
	stName
	stPercent
	stSummary
	stShare
	stSignLine
)

const statementStyles = `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
	`<fonts count="2"><font><sz val="10"/><name val="Times New Roman"/><family val="1"/><charset val="204"/></font>` +
	`<font><b/><sz val="10"/><name val="Times New Roman"/><family val="1"/><charset val="204"/></font></fonts>` +
	`<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
	`<borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border>` +
	`<border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border>` +
	`<border><left/><right/><top/><bottom style="thin"/><diagonal/></border></borders>` +
	`<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
	`<cellXfs count="12">` +
	`<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
	`<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>` +
	`<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right"/></xf>` +
	`<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left"/></xf>` +
	`<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left"/></xf>` +
	`<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>` +
	`<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>` +
	`<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>` +
	`<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>` +
	`<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>` +
	`<xf numFmtId="9" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>` +
	`<xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyBorder="1"/>` +
	`</cellXfs><cellStyles count="1"><cellStyle name="Обычный" xfId="0" builtinId="0"/></cellStyles></styleSheet>`

func statementSheet(g *statementGroup) (string, int) {
	var b strings.Builder
	b.WriteString(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`)
	b.WriteString(`<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView workbookViewId="0"/></sheetViews>`)
	b.WriteString(`<sheetFormatPr defaultRowHeight="15.75" customHeight="1"/>`)
	b.WriteString(`<cols><col min="1" max="1" width="8" customWidth="1"/><col min="2" max="2" width="32.11" customWidth="1"/>` +
		`<col min="3" max="3" width="12.44" customWidth="1"/><col min="4" max="4" width="16.89" customWidth="1"/></cols><sheetData>`)
	row := func(r int, height float64, cells ...string) {
		fmt.Fprintf(&b, `<row r="%d" ht="%.2f" customHeight="1">%s</row>`, r, height, strings.Join(cells, ""))
	}
	text := func(ref string, style int, value string) string {
		return fmt.Sprintf(`<c r="%s" s="%d" t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>`, ref, style, esc(value))
	}
	num := func(ref string, style, value int) string {
		return fmt.Sprintf(`<c r="%s" s="%d"><v>%d</v></c>`, ref, style, value)
	}
	empty := func(ref string, style int) string { return fmt.Sprintf(`<c r="%s" s="%d"/>`, ref, style) }

	row(1, 31.5, text("A1", stTitle, `Смежная ведомость по итоговому тестированию по направлению "Опытное производство поддонов"`),
		empty("B1", stTitle), empty("C1", stTitle), empty("D1", stTitle))
	row(2, 15.75, text("D2", stBoldRight, "СК"))
	date := ""
	if !g.day.IsZero() {
		date = g.day.Format("02.01.2006") + " г."
	}
	row(3, 15.75, text("A3", 0, "Дата:"), text("B3", stText, date))
	row(4, 15.75, text("A4", 0, "№ группы:"), text("B4", stBoldLeft, g.label))
	row(5, 15.75, text("A5", 0, "Тема:"), text("B5", stBoldLeft, "Итоговое тестирование"))
	row(6, 15.75)
	row(7, 15.75, text("A7", stHead, "№"), text("B7", stHead, "ФИО"), text("C7", stHead, "% Освоения"), text("D7", stHead, "Подпись студента"))
	r := 8
	for k, s := range g.students {
		row(r, 15.75, num(fmt.Sprintf("A%d", r), stNumber, k+1), text(fmt.Sprintf("B%d", r), stName, s.name),
			num(fmt.Sprintf("C%d", r), stPercent, s.percent), empty(fmt.Sprintf("D%d", r), stName))
		r++
	}
	last := r - 1
	r++
	summary := r
	share := fmt.Sprintf(`<c r="C%d" s="%d"><f>IFERROR(COUNTIF(C8:C%d,"&gt;=70")/COUNT(C8:C%d),0)</f></c>`, r, stShare, last, last)
	row(r, 35.4, text(fmt.Sprintf("A%d", r), stSummary, "Количество студентов от общего кол-ва учащихся группы, сдавших на 70% и более"),
		empty(fmt.Sprintf("B%d", r), stSummary), share)
	r += 2
	row(r, 15.75, text(fmt.Sprintf("A%d", r), 0, "Руководитель проекта 2 уровня"), empty(fmt.Sprintf("C%d", r), stSignLine))
	r += 2
	row(r, 15.75, text(fmt.Sprintf("A%d", r), 0, "Старший преподаватель (Старший специалист)"), empty(fmt.Sprintf("C%d", r), stSignLine))
	b.WriteString(`</sheetData>`)
	fmt.Fprintf(&b, `<mergeCells count="2"><mergeCell ref="A1:D1"/><mergeCell ref="A%d:B%d"/></mergeCells>`, summary, summary)
	b.WriteString(`<printOptions horizontalCentered="1"/><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0" footer="0"/>`)
	b.WriteString(`<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/></worksheet>`)
	return b.String(), r
}

func esc(s string) string {
	var b bytes.Buffer
	xml.EscapeText(&b, []byte(s))
	return b.String()
}

func sortKey(s string) string {
	return strings.ReplaceAll(strings.ToLower(s), "ё", "е")
}

// sheetTitle makes a unique Excel sheet name: at most 31 characters, without []:*?/\.
func sheetTitle(label string, used map[string]bool) string {
	clean := strings.Map(func(r rune) rune {
		if strings.ContainsRune(`[]:*?/\`, r) {
			return '-'
		}
		return r
	}, label)
	clean = strings.Trim(clean, "'")
	if clean == "" {
		clean = "Группа"
	}
	runes := []rune(clean)
	if len(runes) > 31 {
		runes = runes[:31]
	}
	title := string(runes)
	for k := 2; used[strings.ToLower(title)]; k++ {
		suffix := fmt.Sprintf(" (%d)", k)
		base := []rune(clean)
		if len(base)+len([]rune(suffix)) > 31 {
			base = base[:31-len([]rune(suffix))]
		}
		title = string(base) + suffix
	}
	used[strings.ToLower(title)] = true
	return title
}
