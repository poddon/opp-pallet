package main

import (
	"archive/zip"
	"bytes"
	"io"
	"context"
	"encoding/json"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/lib/pq"
)

func TestPortalsPostgreSQL(t *testing.T) {
	if os.Getenv("OPP_TEST_POSTGRES") != "1" {
		t.Skip("dedicated PostgreSQL test database not configured")
	}
	ctx := context.Background()
	db, err := openDB(ctx, config{host:"localhost", database:"opp", user:"opp", password:"opp-ci-password", port:5432, sslmode:"disable"})
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	a := &app{db:db}
	a.catalog, err = readCatalog()
	if err != nil {
		t.Fatal(err)
	}
	if err := a.loadCatalog(); err != nil {
		t.Fatal(err)
	}
	if len(a.catalog) != 5 || a.catalog[0].ID != generalTest || len(a.catalog[0].Questions) != 50 || len(a.modules) != 4 || a.modules[0] != "Модуль 1" || a.modules[3] != "Модуль 4" {
		t.Fatal("expected a general test with all 50 questions from four modules")
	}
	for _, q := range a.catalog[0].Questions {
		if q.Module == "" {
			t.Fatal("general test question without module")
		}
	}
	chosen := a.catalog[0]
	if err := a.migrate(ctx); err != nil {
		t.Fatal(err)
	}
	if err := a.migrate(ctx); err != nil {
		t.Fatal("repeat migration:",err)
	}
	var seeded int
	if err := db.QueryRow("SELECT count(*) FROM quiz_admins WHERE login=ANY($1)", pq.Array([]string{
		"лукьянчиков егор игоревич", "пышненко кирилл валерьевич", "цурихин дмитрий сергеевич", "ибатуллин богдан альбертович",
	})).Scan(&seeded); err != nil || seeded != 4 {
		t.Fatalf("default administrators: %d %v", seeded, err)
	}
	if err := a.setAdminPassword(ctx, "Тестовый Администратор Ёлкин", "admin-test-password"); err != nil {
		t.Fatal(err)
	}
	web, err := fs.Sub(files,"web")
	if err != nil {
		t.Fatal(err)
	}
	student, admin := a.studentPortal(web), a.adminPortal(web)
	var adminCookie *http.Cookie
	request := func(portal http.Handler, method,path string, body any, status int, decode any) *httptest.ResponseRecorder {
		t.Helper()
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		r := httptest.NewRequest(method,path,bytes.NewReader(b))
		if body != nil {
			r.Header.Set("Content-Type","application/json")
		}
		if adminCookie != nil {
			r.AddCookie(adminCookie)
		}
		w := httptest.NewRecorder()
		portal.ServeHTTP(w,r)
		if w.Code != status {
			t.Fatalf("%s %s: got %d, want %d (%s)",method,path,w.Code,status,w.Body.String())
		}
		if decode != nil {
			if err := json.Unmarshal(w.Body.Bytes(),decode); err != nil {
				t.Fatal(err)
			}
		}
		return w
	}

	request(student,"GET","/",nil,200,nil)
	request(admin,"GET","/",nil,200,nil)
	for _, asset := range []string{"/brand.css", "/logo-alabuga-white.png", "/robot-blueprint.svg",
		"/manrope-cyrillic.woff2", "/manrope-latin.woff2", "/unbounded-cyrillic.woff2", "/unbounded-latin.woff2"} {
		request(student, "GET", asset, nil, 200, nil)
		request(admin, "GET", asset, nil, 200, nil)
	}
	request(student, "GET", "/student-brand.css", nil, 200, nil)
	request(admin, "GET", "/admin-brand.css", nil, 200, nil)
	request(student, "GET", "/admin-brand.css", nil, 404, nil)
	request(admin, "GET", "/student-brand.css", nil, 404, nil)
	request(student,"GET","/admin.js",nil,404,nil)
	request(admin,"GET","/student.js",nil,404,nil)
	request(admin,"GET","/api/admin/results",nil,401,nil)
	const consentEndpoint = "/api/admin/consent"
	request(student, "POST", consentEndpoint, map[string]string{"text": "Без доступа"}, 404, nil)
	request(student,"GET","/api/admin/results",nil,404,nil)
	request(admin,"POST","/api/admin/login",map[string]any{"password":"admin-test-password"},400,nil)
	request(admin,"POST","/api/admin/login",map[string]any{"login":"Тестовый Администратор Ёлкин","password":"wrong-password"},401,nil)
	login := request(admin,"POST","/api/admin/login",map[string]any{"login":"  тестовый администратор елкин ","password":"admin-test-password"},200,nil)
	adminCookie = login.Result().Cookies()[0]
	var setup map[string]any
	request(admin,"GET","/api/admin/setup",nil,200,&setup)
	if setup["admin"] != "Тестовый Администратор Ёлкин" {
		t.Fatalf("admin name: %v", setup["admin"])
	}
	request(admin,"POST","/api/admin/password",map[string]string{"current":"wrong","next":"new-admin-password"},403,nil)
	request(admin,"POST","/api/admin/password",map[string]string{"current":"admin-test-password","next":"123"},400,nil)
	request(admin,"POST","/api/admin/password",map[string]string{"current":"admin-test-password","next":"new-admin-password"},204,nil)
	saved := adminCookie
	adminCookie = nil
	request(admin,"POST","/api/admin/login",map[string]any{"login":"Тестовый Администратор Ёлкин","password":"admin-test-password"},401,nil)
	request(admin,"POST","/api/admin/login",map[string]any{"login":"Тестовый Администратор Ёлкин","password":"new-admin-password"},200,nil)
	adminCookie = saved
	group := "CI "+strconv.FormatInt(time.Now().UnixNano(),10)
	request(admin,"POST","/api/admin/groups",map[string]any{"code":group},200,nil)
	const endpoint = "/api/admin/assignments"
	programs := []programGroup{
		{Direction: "Программирование станков с ЧПУ", Number: "26-9"},
		{Direction: "Программирование станков с ЧПУ", Number: "26-10"},
		{Direction: "Промышленная робототехника", Number: "26-1"},
	}
	request(admin, "POST", "/api/admin/assignments", map[string]any{"groups": []string{group}, "test": "missing", "minutes": 2}, 400, nil)
	batch := map[string]any{"groups": []string{group, group}, "programs": programs, "minutes": 2}
	request(admin, "POST", consentEndpoint, map[string]string{"text": "Изменение из админки"}, 404, nil)
	var opened bulkAssignmentResult
	request(admin, "POST", endpoint, batch, 201, &opened)
	if len(opened.Opened) != 4 || len(opened.AlreadyOpen) != 0 || opened.Opened[group] == 0 {
		t.Fatalf("bulk assignment: %+v", opened)
	}
	for _, program := range programs {
		var tests []assignment
		request(student, "GET", "/api/student/tests?"+url.Values{"group": {program.code()}}.Encode(), nil, 200, &tests)
		if len(tests) != 1 || tests[0].ID != opened.Opened[program.code()] || tests[0].Title != chosen.Title || tests[0].Questions != len(chosen.Questions) {
			t.Fatalf("tests for %s: %+v", program.code(), tests)
		}
	}
	var retry bulkAssignmentResult
	request(admin, "POST", endpoint, batch, 201, &retry)
	if len(retry.Opened) != 0 || len(retry.AlreadyOpen) != 4 {
		t.Fatalf("repeat bulk assignment: %+v", retry)
	}
	request(admin, "POST", endpoint, map[string]any{"programs": []programGroup{
		{Direction: programs[0].Direction, Number: "26-0"},
	}, "minutes": 2}, 400, nil)

	id := opened.Opened[group]
	token, err := newToken()
	if err != nil {
		t.Fatal(err)
	}
	req := attemptAction{Operation:"start",Token:token,Assignment:id,Group:group,Name:"Иванов Иван", Rules:true}
	const studentAttempt = "/api/student/attempt"
	var view attemptView
	request(student,"POST",studentAttempt,req,400,nil)
	newConsent := consentText()
	if !strings.Contains(newConsent, "152-ФЗ") || !strings.Contains(newConsent, "Алабуга") {
		t.Fatal("built-in consent text is missing")
	}
	var studentConfig map[string]any
	request(student, "GET", "/api/student/groups", nil, 200, &studentConfig)
	if studentConfig["consent"] != newConsent || studentConfig["version"] != digest(newConsent) {
		t.Fatalf("student consent setting: %+v", studentConfig)
	}
	req.Consent = digest("Устаревший текст согласия")
	request(student, "POST", studentAttempt, req, 412, nil)
	req.Consent = digest(newConsent)
	request(student,"POST",studentAttempt,req,200,&view)
	request(student,"POST",studentAttempt,req,200,&view)
	if view.Position != 1 || view.Total != len(chosen.Questions) || len(view.Choices) < 2 {
		t.Fatalf("unexpected initial question: %+v",view)
	}
	var recordedConsent string
	if err := db.QueryRow("SELECT consent_text FROM quiz_live WHERE session_id=$1", digest(token)).Scan(&recordedConsent); err != nil {
		t.Fatal(err)
	}
	if recordedConsent != newConsent {
		t.Fatal("attempt did not store the accepted consent version")
	}
	request(admin,"GET","/api/admin/live",nil,404,nil)
	var bank []byte
	if err := db.QueryRow("SELECT question_set FROM quiz_live WHERE session_id=$1", digest(token)).Scan(&bank); err != nil {
		t.Fatal(err)
	}
	var questions []question
	if err := json.Unmarshal(bank, &questions); err != nil {
		t.Fatal(err)
	}
	correctChoice := questions[0].Correct
	req.Operation, req.Position, req.Choice = "answer", 1, &correctChoice
	request(student,"POST",studentAttempt,req,200,&view)
	request(student,"POST",studentAttempt,req,200,&view)
	if view.Position != 2 {
		t.Fatalf("answer retry changed position: %+v",view)
	}
	wrongChoice := (questions[1].Correct + 1) % len(questions[1].Choices)
	req.Position, req.Choice = 2, &wrongChoice
	request(student, "POST", studentAttempt, req, 200, &view)
	request(admin,"POST","/api/admin/assignments/"+strconv.FormatInt(id,10)+"/close",map[string]string{},204,nil)
	req.Operation = "status"
	request(student,"POST",studentAttempt,req,200,&view)
	if view.Status != closed || view.Score != 1 {
		t.Fatalf("result after manual close: %+v", view)
	}
	query := "?"+url.Values{"test":{chosen.ID, "archive"}, "status":{closed, completed}, "name":{"Иванов"},
		"group":{group, programs[0].code()}}.Encode()
	var matches struct{ Rows []resultRow }
	request(admin,"GET","/api/admin/results"+query,nil,200,&matches)
	if len(matches.Rows)==0 || matches.Rows[0].Group != group {
		t.Fatalf("filtered results: %+v",matches)
	}
	var none struct{ Rows []resultRow }
	request(admin,"GET","/api/admin/results?"+url.Values{"group":{group}, "status":{flagged}}.Encode(),nil,200,&none)
	if len(none.Rows) != 0 {
		t.Fatalf("combined filters ignored status: %+v", none)
	}
	var details struct {
		Answers []struct {
			Number   int
			Module   string
			Selected string
			Expected string
			Correct  bool
		}
		Modules []moduleScore
	}
	request(admin,"GET","/api/admin/answers/"+digest(token),nil,200,&details)
	if len(details.Answers) != view.Total || len(details.Modules) != len(a.modules) {
		t.Fatalf("stored answer count: %d, modules %+v", len(details.Answers), details.Modules)
	}
	byNumber := map[int]int{}
	for k, item := range details.Answers {
		byNumber[item.Number] = k
		if item.Module == "" || item.Module != a.moduleFor(questions[item.Number-1]) {
			t.Fatalf("answer %d has module %q", item.Number, item.Module)
		}
	}
	correctTotal, wrongTotal := 0, 0
	for _, m := range details.Modules {
		correctTotal += m.Correct
		wrongTotal += m.Wrong
	}
	if correctTotal != 1 || wrongTotal != 1 {
		t.Fatalf("module scores: %+v", details.Modules)
	}
	right, wrong, empty := details.Answers[byNumber[1]], details.Answers[byNumber[2]], details.Answers[byNumber[3]]
	if !right.Correct || right.Selected == "" || right.Selected != right.Expected ||
		wrong.Correct || wrong.Selected == "" || wrong.Selected == wrong.Expected ||
		empty.Correct || empty.Selected != "" || empty.Expected == "" {
		t.Fatalf("stored answers: correct=%+v, incorrect=%+v, unanswered=%+v", right, wrong, empty)
	}
	export := request(admin,"GET","/api/admin/results"+query+"&format=xlsx",nil,200,nil)
	book, err := zip.NewReader(bytes.NewReader(export.Body.Bytes()), int64(export.Body.Len()))
	if err != nil {
		t.Fatal("xlsx is not a ZIP:", err)
	}
	var answerSheet []byte
	for _, f := range book.File {
		if f.Name == "xl/worksheets/sheet2.xml" {
			r, err := f.Open()
			if err != nil {
				t.Fatal(err)
			}
			answerSheet, _ = io.ReadAll(r)
			r.Close()
		}
	}
	for _, want := range []string{a.modules[0], "Правильно", "Неправильно", "Без ответа"} {
		if !bytes.Contains(answerSheet, []byte(want)) {
			t.Fatalf("answer sheet lacks %q", want)
		}
	}
	var stillOpen []assignment
	request(student, "GET", "/api/student/tests?"+url.Values{"group": {programs[0].code()}}.Encode(), nil, 200, &stillOpen)
	if len(stillOpen) != 1 {
		t.Fatal("closing one group must leave the other group open")
	}
	var reopened bulkAssignmentResult
	request(admin, "POST", endpoint, map[string]any{"groups": []string{group}, "minutes": 2}, 201, &reopened)
	id = reopened.Opened[group]
	if id == 0 {
		t.Fatal("group did not reopen")
	}
	newID := strconv.FormatInt(id,10)
	if _, err := db.Exec("UPDATE quiz_assignments SET opened_at=clock_timestamp()-interval '3 minutes',closes_at=clock_timestamp()-interval '1 minute' WHERE id=$1",id); err != nil {
		t.Fatal(err)
	}
	if err := a.expire(ctx); err != nil {
		t.Fatal(err)
	}
	var ended bool
	if err := db.QueryRow("SELECT closed_at=closes_at FROM quiz_assignments WHERE id=$1",id).Scan(&ended); err != nil || !ended {
		t.Fatalf("auto close %s: %t %v",newID,ended,err)
	}
	if _, err := db.Exec("INSERT INTO quiz_live(session_id,name,group_code,updated_at) VALUES ($1,'legacy',$2,now()-interval '2 days')",group,group); err != nil {
		t.Fatal(err)
	}
	if err := a.cleanup(ctx,false); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := db.QueryRow("SELECT count(*) FROM quiz_live WHERE session_id=$1",group).Scan(&count); err != nil || count!=1 {
		t.Fatalf("preview modified data: %d %v",count,err)
	}
	if err := a.cleanup(ctx,true); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow("SELECT count(*) FROM quiz_live WHERE session_id=$1",group).Scan(&count); err != nil || count!=0 {
		t.Fatalf("cleanup did not delete legacy row: %d %v",count,err)
	}
	request(admin,"GET","/api/admin/answers/"+digest(token),nil,200,nil)

	// Leaving the page during an attempt counts as cheating and zeroes the result.
	cheatGroup := programs[1].code()
	cheatToken, err := newToken()
	if err != nil {
		t.Fatal(err)
	}
	cheat := attemptAction{Operation:"start", Token:cheatToken, Assignment:opened.Opened[cheatGroup], Group:cheatGroup,
		Name:"Петров Пётр", Rules:true, Consent:digest(newConsent)}
	request(student, "POST", studentAttempt, cheat, 200, &view)
	if err := db.QueryRow("SELECT question_set FROM quiz_live WHERE session_id=$1", digest(cheatToken)).Scan(&bank); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(bank, &questions); err != nil {
		t.Fatal(err)
	}
	cheatRight := questions[0].Correct
	cheat.Operation, cheat.Position, cheat.Choice = "answer", 1, &cheatRight
	request(student, "POST", studentAttempt, cheat, 200, &view)
	cheat.Operation = "flag"
	request(student, "POST", studentAttempt, cheat, 200, &view)
	if view.Status != flagged || view.Score != 0 {
		t.Fatalf("cheating attempt: %+v", view)
	}
	var cheated struct{ Rows []resultRow }
	request(admin, "GET", "/api/admin/results?"+url.Values{"group":{cheatGroup}, "status":{flagged}}.Encode(), nil, 200, &cheated)
	if len(cheated.Rows) != 1 || cheated.Rows[0].Percent != 0 {
		t.Fatalf("cheating result: %+v", cheated)
	}
}
