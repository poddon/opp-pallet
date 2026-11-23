package main

import (
	"archive/zip"
	"bytes"
	"context"
	"sort"
	"database/sql"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/lib/pq"
)

type resultRow struct {
	ID string `json:"id"`
	Date string `json:"date"`
	Time string `json:"time"`
	Name string `json:"name"`
	Group string `json:"group"`
	Test string `json:"test"`
	Status string `json:"status"`
	Reason string `json:"reason,omitempty"`
	Percent int `json:"percent"`
	Archived bool `json:"archived"`
}

const resultCTE = `WITH result AS (
	SELECT l.session_id AS id,
	to_char(l.finished_at AT TIME ZONE 'Europe/Moscow','DD.MM.YYYY') AS date,
	to_char(l.finished_at AT TIME ZONE 'Europe/Moscow','HH24:MI:SS') AS time,
	l.name, l.group_code, a.title, a.test_id, l.status,
	CASE WHEN l.status='СПИСЫВАНИЕ' THEN coalesce(l.cheat_reason, 'Уход со страницы (другая вкладка или свёрнутый браузер)') ELSE '' END AS reason,
	CASE WHEN l.status='СПИСЫВАНИЕ' THEN 0 ELSE coalesce(round(100.0 *
		(SELECT count(*) FROM quiz_answers v WHERE v.session_id=l.session_id AND v.correct) /
		nullif(l.total,0))::int, 0) END AS pct,
	l.finished_at AS event_at, false AS archived
	FROM quiz_live l JOIN quiz_assignments a ON a.id=l.assignment_id WHERE l.finished_at IS NOT NULL
	UNION ALL
	SELECT coalesce(fields->>'id', fields->>'submission_id'), to_char(created_at AT TIME ZONE 'Europe/Moscow','DD.MM.YYYY'),
	to_char(created_at AT TIME ZONE 'Europe/Moscow','HH24:MI:SS'),
	coalesce(fields->>'student_name', fields->>'name'),
	upper(regexp_replace(btrim(group_code), '[[:space:]]+', ' ', 'g')),
	'Архивный тест', 'archive', status, '', round(pct)::int, created_at, true
	FROM quiz_results r CROSS JOIN LATERAL (SELECT to_jsonb(r) AS fields) legacy
)`

func (a *app) results(w http.ResponseWriter, r *http.Request) error {
	q := r.URL.Query()
	// Group, test and status accept several values: ?group=A&group=B matches either group.
	many := func(key string) ([]string, error) {
		values := []string{}
		for _, v := range q[key] {
			if v == "" {
				continue
			}
			if !validLength(v, 160) || len(values) >= 200 {
				return nil, problem{400, "Некорректный фильтр"}
			}
			values = append(values, v)
		}
		return values, nil
	}
	groups, err := many("group")
	if err != nil {
		return err
	}
	tests, err := many("test")
	if err != nil {
		return err
	}
	statuses, err := many("status")
	if err != nil {
		return err
	}
	args := []any{strings.TrimSpace(q.Get("name")), pq.Array(groups), pq.Array(tests), pq.Array(statuses)}
	query := resultCTE+` SELECT id,date,time,name,group_code,title,status,reason,pct,archived FROM result
		WHERE ($1='' OR strpos(lower(name), lower($1)) > 0)
		AND (cardinality($2::text[])=0 OR group_code=ANY($2::text[]))
		AND (cardinality($3::text[])=0 OR test_id=ANY($3::text[]))
		AND (cardinality($4::text[])=0 OR status=ANY($4::text[]))`
	for _, filter := range []struct{ name, condition string }{
		{"from", " AND event_at >= $%d"},
		{"to", " AND event_at < $%d"},
	} {
		input := q.Get(filter.name)
		if input == "" {
			continue
		}
		day, err := time.ParseInLocation("2006-01-02",input,time.FixedZone("MSK",3*60*60))
		if err != nil {
			return problem{400,"Некорректный период"}
		}
		if filter.name == "to" {
			day = day.AddDate(0,0,1)
		}
		args = append(args,day)
		query += fmt.Sprintf(filter.condition,len(args))
	}
	query += " ORDER BY event_at DESC, archived, id DESC"
	const pageSize = 100
	page := 1
	format := q.Get("format")
	export := format == "xlsx" || format == "statement"
	if !export {
		if raw := q.Get("page"); raw != "" {
			var err error
			page, err = strconv.Atoi(raw)
			if err != nil || page < 1 || page > 1000000 {
				return problem{400,"Некорректный номер страницы"}
			}
		}
		query += fmt.Sprintf(" LIMIT %d OFFSET $%d", pageSize+1, len(args)+1)
		args = append(args,(page-1)*pageSize)
	}
	rows, err := a.db.QueryContext(r.Context(),query,args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	items := []resultRow{}
	for rows.Next() {
		var item resultRow
		if err := rows.Scan(&item.ID,&item.Date,&item.Time,&item.Name,&item.Group,&item.Test,&item.Status,&item.Reason,&item.Percent,&item.Archived); err != nil {
			return err
		}
		items = append(items,item)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if export {
		var body []byte
		name, display := "OPP-results.xlsx", "Результаты ОПП.xlsx"
		if format == "statement" {
			if len(items) == 0 {
				return problem{404, "Нет результатов для ведомости. Измените фильтры."}
			}
			body, err = statement(items)
			name, display = "Vedomost-OPP.xlsx", "Ведомость ОПП.xlsx"
		} else {
			body, err = a.exportResults(r.Context(), items)
		}
		if err != nil {
			return err
		}
		w.Header().Set("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
		w.Header().Set("Content-Disposition",`attachment; filename="`+name+`"; filename*=UTF-8''`+url.PathEscape(display))
		_, err = w.Write(body)
		return err
	}
	more := len(items)>pageSize
	if more {
		items=items[:pageSize]
	}
	writeJSON(w,200,map[string]any{"rows":items,"page":page,"more":more})
	return nil
}

type questionAnswer struct {
	Number int `json:"number"` // position in the student's attempt
	Module string `json:"module"`
	Text string `json:"text"`
	Expected string `json:"expected"`
	Selected string `json:"selected,omitempty"`
	Correct bool `json:"correct"`
}

type moduleScore struct {
	Module string `json:"module"`
	Correct int `json:"correct"`
	Wrong int `json:"wrong"`
	Empty int `json:"empty"`
	Total int `json:"total"`
}

func verdict(q questionAnswer) string {
	switch {
	case q.Selected == "":
		return "Без ответа"
	case q.Correct:
		return "Правильно"
	}
	return "Неправильно"
}

// attemptAnswers returns every question of the given attempts in module order,
// with the student's choice and whether it was right.
func (a *app) attemptAnswers(ctx context.Context, ids []string) (map[string][]questionAnswer, error) {
	out := map[string][]questionAnswer{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := a.db.QueryContext(ctx, `SELECT session_id, question_set FROM quiz_live
		WHERE session_id=ANY($1::text[]) AND question_set IS NOT NULL`, pq.Array(ids))
	if err != nil {
		return nil, err
	}
	banks := map[string][]question{}
	for rows.Next() {
		var id string
		var bank []byte
		if err := rows.Scan(&id, &bank); err != nil {
			rows.Close()
			return nil, err
		}
		var qs []question
		if err := json.Unmarshal(bank, &qs); err != nil {
			rows.Close()
			return nil, err
		}
		banks[id] = qs
		list := make([]questionAnswer, len(qs))
		for k, q := range qs {
			list[k] = questionAnswer{Number: k + 1, Module: a.moduleFor(q), Text: q.Text, Expected: q.Choices[q.Correct]}
		}
		out[id] = list
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows, err = a.db.QueryContext(ctx, `SELECT session_id,question,choice,correct FROM quiz_answers
		WHERE session_id=ANY($1::text[])`, pq.Array(ids))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var pos int
		var choice sql.NullInt64
		var right bool
		if err := rows.Scan(&id, &pos, &choice, &right); err != nil {
			return nil, err
		}
		qs, list := banks[id], out[id] // still in attempt order here
		if pos < 1 || pos > len(list) || !choice.Valid || int(choice.Int64) >= len(qs[pos-1].Choices) {
			continue
		}
		list[pos-1].Selected = qs[pos-1].Choices[choice.Int64]
		list[pos-1].Correct = right
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	order := map[string]int{}
	for k, m := range a.modules {
		order[m] = k
	}
	for id, list := range out {
		sort.SliceStable(list, func(i, j int) bool {
			oi, ok := order[list[i].Module]
			if !ok {
				oi = len(order)
			}
			oj, ok := order[list[j].Module]
			if !ok {
				oj = len(order)
			}
			return oi < oj
		})
		out[id] = list
	}
	return out, nil
}

func scores(list []questionAnswer) []moduleScore {
	var out []moduleScore
	for _, q := range list {
		if len(out) == 0 || out[len(out)-1].Module != q.Module {
			out = append(out, moduleScore{Module: q.Module})
		}
		m := &out[len(out)-1]
		m.Total++
		switch verdict(q) {
		case "Правильно":
			m.Correct++
		case "Неправильно":
			m.Wrong++
		default:
			m.Empty++
		}
	}
	return out
}

func (a *app) answers(w http.ResponseWriter,r *http.Request) error {
	id := r.PathValue("id")
	if !validToken(id) {
		return problem{404,"Попытка не найдена"}
	}
	ctx := r.Context()
	var name, group, title, status string
	var reason sql.NullString
	err := a.db.QueryRowContext(ctx,`SELECT l.name,l.group_code,a.title,l.status,l.cheat_reason FROM quiz_live l
		JOIN quiz_assignments a ON a.id=l.assignment_id WHERE l.session_id=$1 AND l.finished_at IS NOT NULL`,id).
		Scan(&name,&group,&title,&status,&reason)
	if errors.Is(err,sql.ErrNoRows) {
		return problem{404,"Попытка не найдена"}
	}
	if err != nil {
		return err
	}
	all, err := a.attemptAnswers(ctx, []string{id})
	if err != nil {
		return err
	}
	list := all[id]
	if list == nil {
		list = []questionAnswer{}
	}
	why := ""
	if status == flagged {
		why = reason.String
		if why == "" {
			why = cheatReasons["tab"]
		}
	}
	writeJSON(w,200,map[string]any{"name":name,"group":group,"title":title,"status":status,"reason":why,
		"answers":list,"modules":scores(list)})
	return nil
}

type sheetData struct {
	name string
	rows [][]any // string or int cells
	widths []int // column widths in characters
}

func workbook(sheets []sheetData) ([]byte,error) {
	var buf bytes.Buffer
	book := zip.NewWriter(&buf)
	types := `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
	list := `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>`
	rels := `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
	parts := map[string]string{}
	for k, sh := range sheets {
		n := k + 1
		types += fmt.Sprintf(`<Override PartName="/xl/worksheets/sheet%d.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`, n)
		var name bytes.Buffer
		xml.EscapeText(&name, []byte(sh.name))
		list += fmt.Sprintf(`<sheet name="%s" sheetId="%d" r:id="rId%d"/>`, name.String(), n, n)
		rels += fmt.Sprintf(`<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet%d.xml"/>`, n, n)
		var sheet bytes.Buffer
		sheet.WriteString(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`)
		sheet.WriteString(`<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`)
		if len(sh.widths) > 0 {
			sheet.WriteString("<cols>")
			for k, w := range sh.widths {
				fmt.Fprintf(&sheet, `<col min="%d" max="%d" width="%d" customWidth="1"/>`, k+1, k+1, w)
			}
			sheet.WriteString("</cols>")
		}
		sheet.WriteString("<sheetData>")
		width := 0
		for _, row := range sh.rows {
			width = max(width, len(row))
			sheet.WriteString("<row>")
			for _, value := range row {
				switch v := value.(type) {
				case int:
					fmt.Fprintf(&sheet, "<c><v>%d</v></c>", v)
				case nil:
					sheet.WriteString("<c/>")
				default:
					sheet.WriteString(`<c t="inlineStr"><is><t xml:space="preserve">`)
					xml.EscapeText(&sheet, []byte(fmt.Sprint(v)))
					sheet.WriteString("</t></is></c>")
				}
			}
			sheet.WriteString("</row>")
		}
		sheet.WriteString("</sheetData>")
		if width > 0 && len(sh.rows) > 0 {
			fmt.Fprintf(&sheet, `<autoFilter ref="A1:%s%d"/>`, column(width), len(sh.rows))
		}
		sheet.WriteString("</worksheet>")
		parts[fmt.Sprintf("xl/worksheets/sheet%d.xml", n)] = sheet.String()
	}
	files := []struct{name,body string}{
		{"[Content_Types].xml", types + `</Types>`},
		{"_rels/.rels",`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`},
		{"xl/workbook.xml", list + `</sheets></workbook>`},
		{"xl/_rels/workbook.xml.rels", rels + `</Relationships>`},
	}
	for k := range sheets {
		name := fmt.Sprintf("xl/worksheets/sheet%d.xml", k+1)
		files = append(files, struct{name,body string}{name, parts[name]})
	}
	for _, item := range files {
		f,err := book.Create(item.name)
		if err != nil {
			return nil,err
		}
		if _,err := fmt.Fprint(f,item.body); err != nil {
			return nil,err
		}
	}
	if err := book.Close(); err != nil {
		return nil,err
	}
	return buf.Bytes(),nil
}

func column(n int) string {
	name := ""
	for n > 0 {
		n--
		name = string(rune('A'+n%26)) + name
		n /= 26
	}
	return name
}

// exportResults builds the Excel file: a summary with a score per module and
// a sheet with every answer labelled with its module and verdict.
func (a *app) exportResults(ctx context.Context, items []resultRow) ([]byte, error) {
	ids := []string{}
	for _, row := range items {
		if !row.Archived {
			ids = append(ids, row.ID)
		}
	}
	answers, err := a.attemptAnswers(ctx, ids)
	if err != nil {
		return nil, err
	}
	head := []any{"Дата", "Время", "ФИО", "Группа", "Тест", "Статус", "Причина списывания", "Результат, %"}
	for _, m := range a.modules {
		head = append(head, m+": правильно", m+": неправильно", m+": без ответа")
	}
	summary := [][]any{head}
	detail := [][]any{{"Дата", "Время", "ФИО", "Группа", "Статус", "Модуль", "№ вопроса в попытке", "Вопрос", "Ответ студента", "Правильный ответ", "Итог"}}
	for _, row := range items {
		line := []any{row.Date, row.Time, row.Name, row.Group, row.Test, row.Status, row.Reason, row.Percent}
		list := answers[row.ID]
		byModule := map[string]moduleScore{}
		for _, m := range scores(list) {
			byModule[m.Module] = m
		}
		for _, m := range a.modules {
			if row.Archived {
				line = append(line, nil, nil, nil)
				continue
			}
			s := byModule[m]
			line = append(line, s.Correct, s.Wrong, s.Empty)
		}
		summary = append(summary, line)
		for _, q := range list {
			detail = append(detail, []any{row.Date, row.Time, row.Name, row.Group, row.Status,
				q.Module, q.Number, q.Text, q.Selected, q.Expected, verdict(q)})
		}
	}
	summaryWidths := []int{11, 9, 32, 36, 14, 14, 40, 12}
	for range a.modules {
		summaryWidths = append(summaryWidths, 16, 16, 16)
	}
	return workbook([]sheetData{
		{"Результаты", summary, summaryWidths},
		{"Ответы по модулям", detail, []int{11, 9, 32, 36, 14, 30, 10, 70, 45, 45, 14}},
	})
}
