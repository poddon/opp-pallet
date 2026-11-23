package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"mime"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/lib/pq"
)

type problem struct {
	code int
	message string
}

func (p problem) Error() string { return p.message }

type endpoint func(http.ResponseWriter, *http.Request) error

func route(next endpoint) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		if err := next(w, r.WithContext(ctx)); err != nil {
			var p problem
			if errors.As(err, &p) {
				writeJSON(w, p.code, map[string]string{"error": p.message})
				return
			}
			log.Printf("%s %s: %v", r.Method, r.URL.Path, err)
			writeJSON(w, 500, map[string]string{"error": "Ошибка сервера. Повторите запрос."})
		}
	}
}

func writeJSON(w http.ResponseWriter, code int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(data)
}

func readJSON(w http.ResponseWriter, r *http.Request, dest any) error {
	return readJSONLimit(w, r, dest, 32768)
}

func readJSONLimit(w http.ResponseWriter, r *http.Request, dest any, limit int64) error {
	contentType, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if contentType != "application/json" {
		return problem{415, "Ожидается JSON"}
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, limit))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dest); err != nil || dec.Decode(new(any)) != io.EOF {
		return problem{400, "Некорректный запрос"}
	}
	return nil
}

func portal(web fs.FS, name string) *http.ServeMux {
	mux := http.NewServeMux()
	assets := map[string]string{"/{$}": name + ".html"}
	for _, file := range []string{
		"portal.css", "common.js", name + ".js", "brand.css", name + "-brand.css",
		"logo-alabuga-white.png", "robot-blueprint.svg",
		"manrope-cyrillic.woff2", "manrope-latin.woff2", "unbounded-cyrillic.woff2", "unbounded-latin.woff2",
		"manrope-OFL.txt", "unbounded-OFL.txt",
	} {
		assets["/"+file] = file
	}
	for path, file := range assets {
		mux.HandleFunc("GET "+path, func(w http.ResponseWriter, r *http.Request) {
			http.ServeFileFS(w, r, web, file)
		})
	}
	return mux
}

func protect(mux http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
		mux.ServeHTTP(w, r)
	})
}

type assignment struct {
	ID int64 `json:"id"`
	Group string `json:"group"`
	Title string `json:"title"`
	Questions int `json:"questions"`
	Opened time.Time `json:"opened"`
	Closes time.Time `json:"closes"`
}

func (a *app) assignments(ctx context.Context, group string) ([]assignment, error) {
	rows, err := a.db.QueryContext(ctx, `SELECT id,group_code,title,jsonb_array_length(questions),opened_at,closes_at FROM quiz_assignments
		WHERE ($1='' OR group_code=$1) AND closed_at IS NULL AND closes_at > clock_timestamp()
		ORDER BY closes_at, id`, group)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []assignment{}
	for rows.Next() {
		var item assignment
		if err := rows.Scan(&item.ID,&item.Group,&item.Title,&item.Questions,&item.Opened,&item.Closes); err != nil {
			return nil, err
		}
		out = append(out,item)
	}
	return out, rows.Err()
}

func (a *app) groups(ctx context.Context, activeOnly bool) ([]string, error) {
	rows, err := a.db.QueryContext(ctx, `SELECT code FROM quiz_groups g WHERE NOT $1 OR EXISTS (
		SELECT FROM quiz_assignments WHERE group_code=g.code AND closed_at IS NULL AND closes_at > clock_timestamp())
		ORDER BY code`, activeOnly)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	groups := []string{}
	for rows.Next() {
		var code string
		if err := rows.Scan(&code); err != nil {
			return nil, err
		}
		groups = append(groups, code)
	}
	return groups, rows.Err()
}

func (a *app) studentPortal(web fs.FS) http.Handler {
	mux := portal(web, "student")
	mux.HandleFunc("GET /api/student/groups", route(func(w http.ResponseWriter, r *http.Request) error {
		groups, err := a.groups(r.Context(), true)
		if err != nil {
			return err
		}
		consent, err := a.consentText(r.Context(), a.db)
		if err != nil {
			return err
		}
		version := ""
		if consent != "" {
			version = digest(consent)
		}
		writeJSON(w, 200, map[string]any{"groups": groups, "consent": consent, "version": version})
		return nil
	}))
	mux.HandleFunc("GET /api/student/tests", route(func(w http.ResponseWriter, r *http.Request) error {
		group := r.URL.Query().Get("group")
		if !validLength(group, 80) {
			return problem{400,"Выберите группу"}
		}
		tests, err := a.assignments(r.Context(), group)
		if err != nil {
			return err
		}
		writeJSON(w, 200, tests)
		return nil
	}))
	mux.HandleFunc("POST /api/student/attempt", route(func(w http.ResponseWriter, r *http.Request) error {
		var req attemptAction
		if err := readJSON(w,r,&req); err != nil {
			return err
		}
		if !validToken(req.Token) || req.Assignment <= 0 {
			return problem{400,"Некорректная попытка"}
		}
		switch req.Operation {
		case "start", "answer", "status", "flag":
		default:
			return problem{400,"Неизвестное действие"}
		}
		view, err := a.advance(r.Context(),req)
		if err != nil {
			return err
		}
		writeJSON(w, 200, view)
		return nil
	}))
	return protect(mux)
}

const adminCookie = "opp_admin"
const adminPath = "/api/admin/"

func (a *app) admin(next endpoint) http.HandlerFunc {
	return route(func(w http.ResponseWriter,r *http.Request) error {
		cookie, err := r.Cookie(adminCookie)
		if err != nil || !validToken(cookie.Value) {
			return problem{401,"Войдите в портал администратора"}
		}
		var valid bool
		err = a.db.QueryRowContext(r.Context(),`SELECT EXISTS (
			SELECT FROM quiz_admin_sessions WHERE token_hash=$1 AND expires_at > clock_timestamp())`,digest(cookie.Value)).Scan(&valid)
		if err != nil {
			return err
		}
		if !valid {
			return problem{401,"Сеанс закончился. Войдите снова."}
		}
		return next(w,r)
	})
}

func setAdminCookie(w http.ResponseWriter, r *http.Request, token string, age int) {
	http.SetCookie(w, &http.Cookie{Name:adminCookie, Value:token, Path:adminPath, MaxAge:age,
		HttpOnly:true, SameSite:http.SameSiteStrictMode, Secure:r.TLS!=nil})
}

func (a *app) login(w http.ResponseWriter,r *http.Request) error {
	var req struct{ Password string `json:"password"` }
	if err := readJSON(w,r,&req); err != nil {
		return err
	}
	if subtle.ConstantTimeCompare([]byte(digest(req.Password)),[]byte(a.passwordHash)) != 1 {
		time.Sleep(350*time.Millisecond)
		return problem{401,"Неверный пароль администратора"}
	}
	token, err := newToken()
	if err != nil {
		return err
	}
	if _, err := a.db.ExecContext(r.Context(),`INSERT INTO quiz_admin_sessions(token_hash,expires_at)
		VALUES ($1,clock_timestamp()+interval '8 hours')`, digest(token)); err != nil {
		return err
	}
	setAdminCookie(w,r,token,8*60*60)
	w.WriteHeader(204)
	return nil
}

func (a *app) logout(w http.ResponseWriter,r *http.Request) error {
	var req struct{}
	if err := readJSON(w,r,&req); err != nil {
		return err
	}
	cookie, _ := r.Cookie(adminCookie)
	if _, err := a.db.ExecContext(r.Context(),"DELETE FROM quiz_admin_sessions WHERE token_hash=$1",digest(cookie.Value)); err != nil {
		return err
	}
	setAdminCookie(w,r,"",-1)
	w.WriteHeader(204)
	return nil
}

func (a *app) adminPortal(web fs.FS) http.Handler {
	mux := portal(web,"admin")
	mux.HandleFunc("POST "+adminPath+"login",route(a.login))
	mux.HandleFunc("POST "+adminPath+"logout",a.admin(a.logout))
	mux.HandleFunc("GET "+adminPath+"setup",a.admin(func(w http.ResponseWriter,r *http.Request) error {
		groups, err := a.groups(r.Context(),false)
		if err != nil {
			return err
		}
		tests := make([]map[string]any,0,len(a.catalog))
		for _, t := range a.catalog {
			tests = append(tests,map[string]any{"id":t.ID,"title":t.Title,"questions":len(t.Questions)})
		}
		consent, err := a.consentText(r.Context(), a.db)
		if err != nil {
			return err
		}
		writeJSON(w, 200, map[string]any{"groups": groups, "directions": directions, "tests": tests, "consent": consent})
		return nil
	}))
	mux.HandleFunc("POST "+adminPath+"groups",a.admin(a.addGroup))
	mux.HandleFunc("POST "+adminPath+"consent", a.admin(a.saveConsent))
	mux.HandleFunc("GET "+adminPath+"assignments",a.admin(func(w http.ResponseWriter,r *http.Request) error {
		rows, err := a.assignments(r.Context(),"")
		if err != nil {
			return err
		}
		writeJSON(w,200,rows)
		return nil
	}))
	mux.HandleFunc("POST "+adminPath+"assignments",a.admin(a.openAssignment))
	mux.HandleFunc("POST "+adminPath+"assignments/{id}/close",a.admin(a.closeAssignment))
	mux.HandleFunc("GET "+adminPath+"live",a.admin(a.live))
	mux.HandleFunc("GET "+adminPath+"results",a.admin(a.results))
	mux.HandleFunc("GET "+adminPath+"answers/{id}",a.admin(a.answers))
	return protect(mux)
}

func (a *app) addGroup(w http.ResponseWriter,r *http.Request) error {
	var req struct{ Code string `json:"code"` }
	if err := readJSON(w,r,&req); err != nil {
		return err
	}
	code := strings.ToUpper(normalize(req.Code))
	if !validLength(code,80) {
		return problem{400,"Укажите название группы длиной до 80 символов"}
	}
	if _, err := a.db.ExecContext(r.Context(),"INSERT INTO quiz_groups(code) VALUES ($1) ON CONFLICT DO NOTHING",code); err != nil {
		return err
	}
	writeJSON(w,200,map[string]string{"code":code})
	return nil
}

type bulkAssignmentResult struct {
	Opened      map[string]int64 `json:"opened"`
	AlreadyOpen []string         `json:"alreadyOpen"`
}

func (a *app) openAssignment(w http.ResponseWriter, r *http.Request) error {
	var req struct {
		Groups   []string       `json:"groups"`
		Programs []programGroup `json:"programs"`
		Test     string         `json:"test"`
		Minutes  int            `json:"minutes"`
	}
	if err := readJSON(w, r, &req); err != nil {
		return err
	}
	if req.Minutes < 1 || req.Minutes > 1440 || len(req.Groups)+len(req.Programs) == 0 {
		return problem{400, "Выберите группы и укажите срок от 1 до 1440 минут"}
	}
	groups := make([]string, 0, len(req.Groups)+len(req.Programs))
	createdGroups := make([]string, 0, len(req.Programs))
	for _, code := range req.Groups {
		if !validLength(code, 80) {
			return problem{400, "Некорректное название группы"}
		}
		groups = append(groups, code)
	}
	for _, entry := range req.Programs {
		code := entry.code()
		if code == "" {
			return problem{400, "Выберите направление и укажите номер группы в формате 26-1"}
		}
		groups = append(groups, code)
		createdGroups = append(createdGroups, code)
	}
	slices.Sort(groups)
	groups = slices.Compact(groups)

	index := slices.IndexFunc(a.catalog, func(t test) bool { return t.ID == req.Test })
	if index < 0 {
		return problem{400, "Выберите тест"}
	}
	selected := a.catalog[index]
	questions, err := json.Marshal(selected.Questions)
	if err != nil {
		return err
	}

	ctx := r.Context()
	if err := a.expire(ctx); err != nil {
		return err
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `INSERT INTO quiz_groups(code)
		SELECT code FROM unnest($1::text[]) AS names(code) ORDER BY code
		ON CONFLICT DO NOTHING`, pq.Array(createdGroups)); err != nil {
		return err
	}
	var groupCount int
	if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM quiz_groups WHERE code=ANY($1::text[])",
		pq.Array(groups)).Scan(&groupCount); err != nil {
		return err
	}
	if groupCount != len(groups) {
		return problem{400, "Одна из выбранных групп не найдена. Обновите список групп."}
	}
	rows, err := tx.QueryContext(ctx, `INSERT INTO quiz_assignments(group_code,test_id,title,questions,opened_at,closes_at)
		SELECT code,$2,$3,$4,t,t + make_interval(mins => $5)
		FROM quiz_groups CROSS JOIN (SELECT clock_timestamp() AS t) stamp
		WHERE code=ANY($1::text[]) ORDER BY code
		ON CONFLICT DO NOTHING RETURNING group_code,id`,
		pq.Array(groups), selected.ID, selected.Title, string(questions), req.Minutes)
	if err != nil {
		return err
	}
	defer rows.Close()
	result := bulkAssignmentResult{Opened: make(map[string]int64), AlreadyOpen: []string{}}
	for rows.Next() {
		var code string
		var id int64
		if err := rows.Scan(&code, &id); err != nil {
			return err
		}
		result.Opened[code] = id
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, code := range groups {
		if _, ok := result.Opened[code]; !ok {
			result.AlreadyOpen = append(result.AlreadyOpen, code)
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	writeJSON(w, 201, result)
	return nil
}

func (a *app) closeAssignment(w http.ResponseWriter,r *http.Request) error {
	var req struct{}
	if err := readJSON(w,r,&req); err != nil {
		return err
	}
	id, err := strconv.ParseInt(r.PathValue("id"),10,64)
	if err != nil || id < 1 {
		return problem{400,"Некорректный номер теста"}
	}
	ctx := r.Context()
	tx, err := a.db.BeginTx(ctx,nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx,`UPDATE quiz_assignments SET closed_at=least(closes_at,clock_timestamp())
		WHERE id=$1 AND closed_at IS NULL`,id); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,finishClosed+" AND a.id=$1",id); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	w.WriteHeader(204)
	return nil
}

func (a *app) live(w http.ResponseWriter,r *http.Request) error {
	type liveRow struct {
		Name string `json:"name"`
		Group string `json:"group"`
		Title string `json:"title"`
		Question int `json:"question"`
		Total int `json:"total"`
		Seconds int `json:"seconds"`
	}
	rows, err := a.db.QueryContext(r.Context(),`SELECT l.name,l.group_code,a.title,l.question,l.total,
		greatest(0,ceil(extract(epoch from l.deadline-clock_timestamp())))::int
		FROM quiz_live l JOIN quiz_assignments a ON a.id=l.assignment_id
		WHERE l.finished_at IS NULL AND l.updated_at > clock_timestamp()-interval '25 seconds'
		AND a.closed_at IS NULL AND a.closes_at > clock_timestamp()
		ORDER BY l.updated_at DESC, l.session_id`)
	if err != nil {
		return err
	}
	defer rows.Close()
	out := []liveRow{}
	for rows.Next() {
		var row liveRow
		if err := rows.Scan(&row.Name,&row.Group,&row.Title,&row.Question,&row.Total,&row.Seconds); err != nil {
			return err
		}
		out = append(out,row)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("чтение прогресса: %w",err)
	}
	writeJSON(w,200,out)
	return nil
}
