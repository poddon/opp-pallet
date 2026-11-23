package main

import (
	"archive/zip"
	"bytes"
	"database/sql"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"net/http"
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
	Percent int `json:"percent"`
	Archived bool `json:"archived"`
}

const resultCTE = `WITH result AS (
	SELECT l.session_id AS id,
	to_char(l.finished_at AT TIME ZONE 'Europe/Moscow','DD.MM.YYYY') AS date,
	to_char(l.finished_at AT TIME ZONE 'Europe/Moscow','HH24:MI:SS') AS time,
	l.name, l.group_code, a.title, a.test_id, l.status,
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
	'Архивный тест', 'archive', status, round(pct)::int, created_at, true
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
	query := resultCTE+` SELECT id,date,time,name,group_code,title,status,pct,archived FROM result
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
	export := q.Get("format") == "xlsx"
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
		if err := rows.Scan(&item.ID,&item.Date,&item.Time,&item.Name,&item.Group,&item.Test,&item.Status,&item.Percent,&item.Archived); err != nil {
			return err
		}
		items = append(items,item)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if export {
		body, err := workbook(items)
		if err != nil {
			return err
		}
		w.Header().Set("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
		w.Header().Set("Content-Disposition",`attachment; filename="OPP-results.xlsx"`)
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

func (a *app) answers(w http.ResponseWriter,r *http.Request) error {
	id := r.PathValue("id")
	if !validToken(id) {
		return problem{404,"Попытка не найдена"}
	}
	ctx := r.Context()
	var name, group, title string
	var bank []byte
	err := a.db.QueryRowContext(ctx,`SELECT l.name,l.group_code,a.title,l.question_set FROM quiz_live l
		JOIN quiz_assignments a ON a.id=l.assignment_id WHERE l.session_id=$1 AND l.finished_at IS NOT NULL`,id).
		Scan(&name,&group,&title,&bank)
	if errors.Is(err,sql.ErrNoRows) {
		return problem{404,"Попытка не найдена"}
	}
	if err != nil {
		return err
	}
	var qs []question
	if err := json.Unmarshal(bank,&qs); err != nil {
		return err
	}
	type questionAnswer struct {
		Text string `json:"text"`
		Expected string `json:"expected"`
		Selected string `json:"selected,omitempty"`
		Correct bool `json:"correct"`
	}
	out := make([]questionAnswer,len(qs))
	for i, q := range qs {
		out[i] = questionAnswer{Text:q.Text,Expected:q.Choices[q.Correct]}
	}
	rows, err := a.db.QueryContext(ctx,"SELECT question,choice,correct FROM quiz_answers WHERE session_id=$1",id)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var pos int
		var choice sql.NullInt64
		var right bool
		if err := rows.Scan(&pos,&choice,&right); err != nil {
			return err
		}
		if choice.Valid {
			out[pos-1].Selected = qs[pos-1].Choices[choice.Int64]
			out[pos-1].Correct = right
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	writeJSON(w,200,map[string]any{"name":name,"group":group,"title":title,"answers":out})
	return nil
}

func workbook(rows []resultRow) ([]byte,error) {
	var sheet bytes.Buffer
	sheet.WriteString(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>`)
	textCell := func(value string) {
		sheet.WriteString(`<c t="inlineStr"><is><t xml:space="preserve">`)
		xml.EscapeText(&sheet,[]byte(value))
		sheet.WriteString("</t></is></c>")
	}
	sheet.WriteString("<row>")
	for _, label := range []string{"Дата","Время","ФИО","Группа","Тест","Статус","Результат, %"} {
		textCell(label)
	}
	sheet.WriteString("</row>")
	for _, row := range rows {
		sheet.WriteString("<row>")
		for _, value := range []string{row.Date,row.Time,row.Name,row.Group,row.Test,row.Status} {
			textCell(value)
		}
		fmt.Fprintf(&sheet,"<c><v>%d</v></c></row>",row.Percent)
	}
	sheet.WriteString("</sheetData>")
	fmt.Fprintf(&sheet,`<autoFilter ref="A1:G%d"/></worksheet>`,len(rows)+1)
	var buf bytes.Buffer
	book := zip.NewWriter(&buf)
	for _, item := range []struct{name,body string}{
		{"[Content_Types].xml",`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`},
		{"_rels/.rels",`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`},
		{"xl/workbook.xml",`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Результаты" sheetId="1" r:id="rId1"/></sheets></workbook>`},
		{"xl/_rels/workbook.xml.rels",`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`},
		{"xl/worksheets/sheet1.xml",sheet.String()},
	} {
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
