package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strconv"
	"testing"
	"time"
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
	a := &app{db:db, passwordHash:digest("admin-test-password")}
	a.catalog, err = readCatalog()
	if err != nil {
		t.Fatal(err)
	}
	if len(a.catalog) != 5 || a.catalog[0].ID != "general" || len(a.catalog[0].Questions) != 50 {
		t.Fatal("expected a general test with all 50 questions and four thematic tests")
	}
	if err := a.migrate(ctx); err != nil {
		t.Fatal(err)
	}
	if err := a.migrate(ctx); err != nil {
		t.Fatal("repeat migration:",err)
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
	request(student,"GET","/admin.js",nil,404,nil)
	request(admin,"GET","/student.js",nil,404,nil)
	request(admin,"GET","/api/admin/results",nil,401,nil)
	const consentEndpoint = "/api/admin/consent"
	request(admin, "POST", consentEndpoint, map[string]string{"text": "Без доступа"}, 401, nil)
	request(student, "POST", consentEndpoint, map[string]string{"text": "Без доступа"}, 404, nil)
	request(student,"GET","/api/admin/results",nil,404,nil)
	login := request(admin,"POST","/api/admin/login",map[string]any{"password":"admin-test-password"},204,nil)
	adminCookie = login.Result().Cookies()[0]
	group := "CI "+strconv.FormatInt(time.Now().UnixNano(),10)
	request(admin,"POST","/api/admin/groups",map[string]any{"code":group},200,nil)
	const endpoint = "/api/admin/assignments"
	programs := []programGroup{
		{Direction: "Промышленная робототехника", Number: "26-1"},
		{Direction: "Промышленная робототехника", Number: "26-2"},
		{Direction: "Промышленная автоматика", Number: "26-1"},
	}
	batch := map[string]any{"groups": []string{group, group}, "programs": programs, "minutes": 2}
	request(admin, "POST", endpoint, batch, 409, nil)
	request(admin, "POST", consentEndpoint, map[string]string{"text": "   "}, 400, nil)
	const oldConsent = "Первая версия согласия для проверки"
	request(admin, "POST", consentEndpoint, map[string]string{"text": oldConsent}, 200, nil)
	var opened bulkAssignmentResult
	request(admin, "POST", endpoint, batch, 201, &opened)
	if len(opened.Opened) != 4 || len(opened.AlreadyOpen) != 0 || opened.Opened[group] == 0 {
		t.Fatalf("bulk assignment: %+v", opened)
	}
	for _, program := range programs {
		var tests []assignment
		request(student, "GET", "/api/student/tests?"+url.Values{"group": {program.code()}}.Encode(), nil, 200, &tests)
		if len(tests) != 1 || tests[0].ID != opened.Opened[program.code()] || tests[0].Title != "Общий тест" {
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
	const newConsent = "Вторая версия согласия для проверки"
	request(admin, "POST", consentEndpoint, map[string]string{"text": newConsent}, 200, nil)
	var studentConfig map[string]any
	request(student, "GET", "/api/student/groups", nil, 200, &studentConfig)
	if studentConfig["consent"] != newConsent || studentConfig["version"] != digest(newConsent) {
		t.Fatalf("student consent setting: %+v", studentConfig)
	}
	req.Consent = digest(oldConsent)
	request(student, "POST", studentAttempt, req, 412, nil)
	req.Consent = digest(newConsent)
	request(student,"POST",studentAttempt,req,200,&view)
	request(student,"POST",studentAttempt,req,200,&view)
	if view.Position != 1 || view.Total != 50 || len(view.Choices) < 2 {
		t.Fatalf("unexpected initial question: %+v",view)
	}
	var recordedConsent string
	if err := db.QueryRow("SELECT consent_text FROM quiz_live WHERE session_id=$1", digest(token)).Scan(&recordedConsent); err != nil {
		t.Fatal(err)
	}
	if recordedConsent != newConsent {
		t.Fatal("attempt did not store the accepted consent version")
	}
	var live []map[string]any
	request(admin,"GET","/api/admin/live",nil,200,&live)
	if len(live) == 0 || live[0]["group"] != group {
		t.Fatal("missing progress")
	}
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
	query := "?"+url.Values{"test":{"general"}, "status":{closed}, "name":{"Иванов"}, "group":{group}}.Encode()
	var matches struct{ Rows []resultRow }
	request(admin,"GET","/api/admin/results"+query,nil,200,&matches)
	if len(matches.Rows)==0 || matches.Rows[0].Group != group {
		t.Fatalf("filtered results: %+v",matches)
	}
	var details struct {
		Answers []struct {
			Selected string
			Expected string
			Correct  bool
		}
	}
	request(admin,"GET","/api/admin/answers/"+digest(token),nil,200,&details)
	if len(details.Answers) != view.Total {
		t.Fatalf("stored answer count: %d", len(details.Answers))
	}
	right, wrong, empty := details.Answers[0], details.Answers[1], details.Answers[2]
	if !right.Correct || right.Selected == "" || right.Selected != right.Expected ||
		wrong.Correct || wrong.Selected == "" || wrong.Selected == wrong.Expected ||
		empty.Correct || empty.Selected != "" || empty.Expected == "" {
		t.Fatalf("stored answers: correct=%+v, incorrect=%+v, unanswered=%+v", right, wrong, empty)
	}
	export := request(admin,"GET","/api/admin/results"+query+"&format=xlsx",nil,200,nil)
	if !bytes.HasPrefix(export.Body.Bytes(),[]byte("PK")) {
		t.Fatal("xlsx is not a ZIP")
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
}
