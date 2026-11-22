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
	a := &app{db:db, passwordHash:digest("admin-test-password"), consent:"Текст согласия для проверки"}
	a.catalog, err = readCatalog()
	if err != nil {
		t.Fatal(err)
	}
	if len(a.catalog) != 4 {
		t.Fatalf("catalog size: %d", len(a.catalog))
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
	request(student,"GET","/api/admin/results",nil,404,nil)
	login := request(admin,"POST","/api/admin/login",map[string]any{"password":"admin-test-password"},204,nil)
	adminCookie = login.Result().Cookies()[0]
	group := "CI "+strconv.FormatInt(time.Now().UnixNano(),10)
	request(admin,"POST","/api/admin/groups",map[string]any{"code":group},200,nil)
	open := func(testID string) int64 {
		t.Helper()
		var out map[string]int64
		request(admin,"POST","/api/admin/assignments",map[string]any{"test":testID,"group":group,"minutes":2},201,&out)
		return out["id"]
	}
	id := open("robotics")
	token, err := newToken()
	if err != nil {
		t.Fatal(err)
	}
	req := attemptAction{Operation:"start",Token:token,Assignment:id,Group:group,Name:"Иванов Иван", Rules:true}
	const studentAttempt = "/api/student/attempt"
	var view attemptView
	request(student,"POST",studentAttempt,req,400,nil)
	req.Consent = digest(a.consent)
	request(student,"POST",studentAttempt,req,200,&view)
	request(student,"POST",studentAttempt,req,200,&view)
	if view.Position != 1 || len(view.Choices) < 2 {
		t.Fatalf("unexpected initial question: %+v",view)
	}
	var live []map[string]any
	request(admin,"GET","/api/admin/live",nil,200,&live)
	if len(live) == 0 || live[0]["group"] != group {
		t.Fatal("missing progress")
	}
	choice := 0
	req.Operation,req.Position,req.Choice = "answer",1,&choice
	request(student,"POST",studentAttempt,req,200,&view)
	request(student,"POST",studentAttempt,req,200,&view)
	if view.Position != 2 {
		t.Fatalf("answer retry changed position: %+v",view)
	}
	request(admin,"POST","/api/admin/assignments/"+strconv.FormatInt(id,10)+"/close",map[string]string{},204,nil)
	req.Operation = "status"
	request(student,"POST",studentAttempt,req,200,&view)
	if view.Status != closed {
		t.Fatalf("status after manual close: %s",view.Status)
	}
	query := "?"+url.Values{"test":{"robotics"}, "status":{closed}, "name":{"Иванов"}, "group":{group}}.Encode()
	var matches struct{ Rows []resultRow }
	request(admin,"GET","/api/admin/results"+query,nil,200,&matches)
	if len(matches.Rows)==0 || matches.Rows[0].Group != group {
		t.Fatalf("filtered results: %+v",matches)
	}
	var details struct { Answers []struct{ Selected string } }
	request(admin,"GET","/api/admin/answers/"+digest(token),nil,200,&details)
	if len(details.Answers)!=view.Total || details.Answers[0].Selected=="" || details.Answers[1].Selected!="" {
		t.Fatalf("stored answers: %+v",details)
	}
	export := request(admin,"GET","/api/admin/results"+query+"&format=xlsx",nil,200,nil)
	if !bytes.HasPrefix(export.Body.Bytes(),[]byte("PK")) {
		t.Fatal("xlsx is not a ZIP")
	}
	id = open("robotics")
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
