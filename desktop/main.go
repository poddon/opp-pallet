package main

import (
	"context"
	"database/sql"
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	_ "github.com/lib/pq"
)

//go:embed all:web
var webFS embed.FS

type pgCfg struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Database string `json:"database"`
	User     string `json:"user"`
	Password string `json:"password"`
}

func exeDir() string {
	p, err := os.Executable()
	if err != nil {
		wd, _ := os.Getwd()
		return wd
	}
	return filepath.Dir(p)
}

func loadCfg() (pgCfg, string, error) {
	c := pgCfg{Host: "127.0.0.1", Port: 5432, Database: "opp", User: "postgres"}
	path := filepath.Join(exeDir(), "pg-config.json")
	b, err := os.ReadFile(path)
	if err != nil {
		_ = os.WriteFile(path, []byte(`{
  "host": "127.0.0.1",
  "port": 5432,
  "database": "opp",
  "user": "postgres",
  "password": "СЮДА_ПАРОЛЬ"
}
`), 0644)
		return c, path, fmt.Errorf("создан файл %s — впишите пароль и перезапустите", path)
	}
	if err := json.Unmarshal(b, &c); err != nil {
		return c, path, err
	}
	if c.Port == 0 {
		c.Port = 5432
	}
	if strings.TrimSpace(c.Password) == "" || c.Password == "СЮДА_ПАРОЛЬ" {
		return c, path, fmt.Errorf("в %s не указан пароль PostgreSQL", path)
	}
	return c, path, nil
}

func openDB(c pgCfg) (*sql.DB, error) {
	dsn := fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=disable", c.User, c.Password, c.Host, c.Port, c.Database)
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	_, _ = db.Exec(`CREATE TABLE IF NOT EXISTS quiz_results (
		id SERIAL PRIMARY KEY,
		taken_at TEXT NOT NULL,
		student_name TEXT NOT NULL,
		group_code TEXT NOT NULL,
		module_id TEXT NOT NULL DEFAULT '1',
		status TEXT NOT NULL,
		correct INTEGER NOT NULL DEFAULT 0,
		total INTEGER NOT NULL DEFAULT 0,
		pct INTEGER NOT NULL DEFAULT 0,
		xp INTEGER NOT NULL DEFAULT 0,
		duration_sec INTEGER NOT NULL DEFAULT 0,
		created_at TIMESTAMPTZ NOT NULL DEFAULT now()
	)`)
	_, _ = db.Exec(`CREATE TABLE IF NOT EXISTS module_access (
		module_id TEXT PRIMARY KEY,
		is_open BOOLEAN NOT NULL DEFAULT TRUE
	)`)
	_, _ = db.Exec(`INSERT INTO module_access (module_id, is_open) VALUES ('1', TRUE) ON CONFLICT (module_id) DO NOTHING`)
	_, _ = db.Exec(`CREATE TABLE IF NOT EXISTS fio_done (
		name_norm TEXT PRIMARY KEY,
		name_display TEXT,
		updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
	)`)
	_, _ = db.Exec(`CREATE TABLE IF NOT EXISTS fio_grants (
		id SERIAL PRIMARY KEY,
		name_norm TEXT NOT NULL,
		name_display TEXT,
		granted_by TEXT,
		used BOOLEAN NOT NULL DEFAULT FALSE,
		created_at TIMESTAMPTZ NOT NULL DEFAULT now()
	)`)
	return db, nil
}

func normName(s string) string {
	return strings.Join(strings.Fields(strings.ToLower(strings.TrimSpace(s))), " ")
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func handleAPI(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		if r.Method == http.MethodOptions {
			w.WriteHeader(204)
			return
		}
		if db == nil {
			writeJSON(w, 503, map[string]any{"ok": false, "error": "no-db"})
			return
		}
		action := r.URL.Query().Get("action")
		var input map[string]any
		if r.Method == http.MethodPost {
			b, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
			_ = json.Unmarshal(b, &input)
			if input == nil {
				input = map[string]any{}
			}
		}
		str := func(k string) string {
			if input == nil {
				return ""
			}
			if v, ok := input[k]; ok && v != nil {
				return strings.TrimSpace(fmt.Sprint(v))
			}
			return ""
		}
		num := func(k string) int {
			if input == nil {
				return 0
			}
			switch v := input[k].(type) {
			case float64:
				return int(v)
			default:
				var n int
				fmt.Sscanf(fmt.Sprint(v), "%d", &n)
				return n
			}
		}
		switch action {
		case "health":
			if err := db.Ping(); err != nil {
				writeJSON(w, 500, map[string]any{"ok": false})
				return
			}
			writeJSON(w, 200, map[string]any{"ok": true, "db": "postgresql"})
		case "results":
			if r.Method == http.MethodGet {
				rows, err := db.Query(`SELECT taken_at, student_name, group_code, module_id, status, correct, total, pct, xp, duration_sec FROM quiz_results WHERE status <> 'СПИСЫВАНИЕ' ORDER BY id DESC LIMIT 2000`)
				if err != nil {
					writeJSON(w, 500, map[string]any{"ok": false})
					return
				}
				defer rows.Close()
				out := []map[string]any{}
				for rows.Next() {
					var date, name, group, modules, status string
					var correct, total, pct, xp, duration int
					if rows.Scan(&date, &name, &group, &modules, &status, &correct, &total, &pct, &xp, &duration) == nil {
						out = append(out, map[string]any{"date": date, "name": name, "group": group, "modules": modules, "status": status, "correct": correct, "total": total, "pct": pct, "xp": xp, "duration": duration})
					}
				}
				writeJSON(w, 200, map[string]any{"ok": true, "rows": out})
				return
			}
			if str("status") == "СПИСЫВАНИЕ" {
				writeJSON(w, 200, map[string]any{"ok": true, "skipped": "cheat"})
				return
			}
			name, group := str("name"), str("group")
			if name == "" || group == "" {
				writeJSON(w, 400, map[string]any{"ok": false, "error": "fields"})
				return
			}
			status := str("status")
			if status == "" {
				status = "Пройден"
			}
			_, err := db.Exec(`INSERT INTO quiz_results (taken_at, student_name, group_code, module_id, status, correct, total, pct, xp, duration_sec) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, str("date"), name, group, orDefault(str("modules"), "1"), status, num("correct"), num("total"), num("pct"), num("xp"), num("duration"))
			if err != nil {
				writeJSON(w, 500, map[string]any{"ok": false, "error": "insert"})
				return
			}
			if status == "Пройден" {
				norm := normName(name)
				_, _ = db.Exec(`INSERT INTO fio_done (name_norm, name_display, updated_at) VALUES ($1,$2,now()) ON CONFLICT (name_norm) DO UPDATE SET updated_at = now(), name_display = EXCLUDED.name_display`, norm, name)
			}
			writeJSON(w, 200, map[string]any{"ok": true})
		case "check":
			norm := normName(str("name"))
			var n, free int
			_ = db.QueryRow(`SELECT COUNT(*) FROM fio_done WHERE name_norm = $1`, norm).Scan(&n)
			_ = db.QueryRow(`SELECT COUNT(*) FROM fio_grants WHERE name_norm = $1 AND used = FALSE`, norm).Scan(&free)
			writeJSON(w, 200, map[string]any{"ok": true, "allowed": n == 0 || free > 0, "done": n > 0, "grant": free})
		case "grant":
			name := str("name")
			if name == "" {
				writeJSON(w, 400, map[string]any{"ok": false})
				return
			}
			_, _ = db.Exec(`INSERT INTO fio_grants (name_norm, name_display, granted_by) VALUES ($1,$2,$3)`, normName(name), name, str("by"))
			writeJSON(w, 200, map[string]any{"ok": true})
		default:
			writeJSON(w, 400, map[string]any{"ok": false, "error": "unknown_action"})
		}
	}
}

func orDefault(s, d string) string {
	if strings.TrimSpace(s) == "" {
		return d
	}
	return s
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("cmd", "/c", "start", "", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	_ = cmd.Start()
}

func main() {
	sub, err := fs.Sub(webFS, "web")
	if err != nil {
		fmt.Println("ошибка файлов сайта:", err)
		waitExit()
		return
	}
	cfg, cfgPath, cfgErr := loadCfg()
	var db *sql.DB
	if cfgErr != nil {
		fmt.Println("PostgreSQL не подключена:")
		fmt.Println(" ", cfgErr)
	} else if db, err = openDB(cfg); err != nil {
		fmt.Println("PostgreSQL не отвечает:")
		fmt.Println(" ", err)
		fmt.Println(" Проверьте", cfgPath)
	} else {
		fmt.Printf("PostgreSQL: %s:%d / %s\n", cfg.Host, cfg.Port, cfg.Database)
		defer db.Close()
	}
	ln, err := net.Listen("tcp", "127.0.0.1:17880")
	if err != nil {
		ln, err = net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			fmt.Println(err)
			waitExit()
			return
		}
	}
	addr := "http://" + ln.Addr().String() + "/"
	mux := http.NewServeMux()
	mux.HandleFunc("/api.php", handleAPI(db))
	mux.Handle("/", http.FileServer(http.FS(sub)))
	fmt.Println("Тест ОПП запущен")
	fmt.Println(addr)
	go func() {
		time.Sleep(400 * time.Millisecond)
		openBrowser(addr)
	}()
	_ = http.Serve(ln, mux)
}

func waitExit() {
	fmt.Println("Нажмите Enter, чтобы закрыть")
	buf := make([]byte, 1)
	_, _ = os.Stdin.Read(buf)
}
