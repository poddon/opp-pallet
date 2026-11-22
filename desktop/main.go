package main

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"time"

	_ "github.com/lib/pq"
)

//go:embed web/* schema.sql questions.json
var files embed.FS

type config struct {
	host, database, user, password, sslmode string
	studentHost, adminHost, adminPassword, consentFile string
	port int
	cleanup, apply bool
}

func parseConfig(args []string) (config, error) {
	var c config
	if len(args) == 0 || (args[0] != "start" && args[0] != "cleanup") {
		return c, errors.New("использование: OPP-test.exe start --help или OPP-test.exe cleanup --help")
	}
	c.cleanup = args[0] == "cleanup"
	flags := flag.NewFlagSet(args[0], flag.ContinueOnError)
	flags.StringVar(&c.host, "ip", "localhost", "адрес PostgreSQL")
	flags.IntVar(&c.port, "port", 5432, "порт PostgreSQL")
	flags.StringVar(&c.database, "name", "opp", "имя существующей базы PostgreSQL")
	flags.StringVar(&c.user, "user", os.Getenv("PGUSER"), "роль PostgreSQL (по умолчанию совпадает с --name)")
	flags.StringVar(&c.password, "password", os.Getenv("PGPASSWORD"), "пароль PostgreSQL")
	flags.StringVar(&c.sslmode, "sslmode", "disable", "режим TLS PostgreSQL (disable, require, verify-ca, verify-full)")
	if c.cleanup {
		flags.BoolVar(&c.apply, "apply", false, "удалить устаревшие технические записи после просмотра")
	} else {
		flags.StringVar(&c.studentHost, "student-bind", "0.0.0.0", "интерфейс портала студента")
		flags.StringVar(&c.adminHost, "admin-bind", "127.0.0.1", "интерфейс портала администратора")
		flags.StringVar(&c.adminPassword, "admin-password", os.Getenv("OPP_ADMIN_PASSWORD"), "пароль администратора, минимум 12 символов")
		flags.StringVar(&c.consentFile, "consent-file", os.Getenv("OPP_CONSENT_FILE"), "файл с текстом согласия в UTF-8")
	}
	if err := flags.Parse(args[1:]); err != nil {
		return c, err
	}
	if flags.NArg() != 0 || c.port < 1 || c.port > 65535 || c.database == "" || c.host == "" {
		return c, errors.New("проверьте параметры запуска")
	}
	if c.user == "" {
		c.user = c.database
	}
	if !c.cleanup && len([]rune(c.adminPassword)) < 12 {
		return c, errors.New("задайте OPP_ADMIN_PASSWORD из 12 или более символов")
	}
	return c, nil
}

func openDB(ctx context.Context, c config) (*sql.DB, error) {
	// lib/pq handles TLS and quotes parameter values in PostgreSQL connection strings.
	dsn := &url.URL{
		Scheme: "postgres",
		User: url.UserPassword(c.user, c.password),
		Host: net.JoinHostPort(c.host, strconv.Itoa(c.port)),
		Path: "/" + c.database, RawPath: "/" + url.PathEscape(c.database),
	}
	dsn.RawQuery = url.Values{"sslmode": {c.sslmode}, "connect_timeout": {"5"}}.Encode()
	db, err := sql.Open("postgres", dsn.String())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(12)
	db.SetMaxIdleConns(6)
	if err = db.PingContext(ctx); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

func (a *app) migrate(ctx context.Context) error {
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(80048005)"); err != nil {
		return err
	}
	schema, err := files.ReadFile("schema.sql")
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, string(schema)); err != nil {
		return err
	}
	return tx.Commit()
}

func run(args []string) error {
	c, err := parseConfig(args)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db, err := openDB(ctx, c)
	if err != nil {
		return fmt.Errorf("PostgreSQL %s:%d / %s: %w", c.host, c.port, c.database, err)
	}
	defer db.Close()
	a := &app{db: db}
	if c.cleanup {
		return a.cleanup(ctx, c.apply)
	}
	if err := a.configure(c); err != nil {
		return err
	}
	if err := a.migrate(ctx); err != nil {
		return fmt.Errorf("подготовка таблиц: %w", err)
	}
	student, err := net.Listen("tcp", net.JoinHostPort(c.studentHost, "8004"))
	if err != nil {
		return fmt.Errorf("порт студента 8004: %w", err)
	}
	defer student.Close()
	admin, err := net.Listen("tcp", net.JoinHostPort(c.adminHost, "8005"))
	if err != nil {
		return fmt.Errorf("порт администратора 8005: %w", err)
	}
	defer admin.Close()

	web, err := fs.Sub(files, "web")
	if err != nil {
		return err
	}
	server := func(handler http.Handler) *http.Server {
		return &http.Server{
			Handler: handler, ReadHeaderTimeout: 5*time.Second,
			ReadTimeout: 15*time.Second, WriteTimeout: 30*time.Second, IdleTimeout: 60*time.Second,
		}
	}
	studentServer, adminServer := server(a.studentPortal(web)), server(a.adminPortal(web))
	signalCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	errs := make(chan error, 2)
	go func() { errs <- studentServer.Serve(student) }()
	go func() { errs <- adminServer.Serve(admin) }()
	go a.schedule(signalCtx)
	fmt.Println("Студент       http://localhost:8004")
	fmt.Println("Администратор http://localhost:8005")
	if c.consentFile == "" {
		fmt.Println("Текст согласия ОПД не задан. Для допуска к тестам укажите --consent-file.")
	}
	select {
	case err = <-errs:
	case <-signalCtx.Done():
	}
	stop()
	shutdown, cancelShutdown := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelShutdown()
	studentServer.Shutdown(shutdown)
	adminServer.Shutdown(shutdown)
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

func (a *app) configure(c config) error {
	var err error
	a.catalog, err = readCatalog()
	if err != nil {
		return err
	}
	a.passwordHash = digest(c.adminPassword)
	if c.consentFile == "" {
		return nil
	}
	info, err := os.Stat(c.consentFile)
	if err != nil {
		return err
	}
	if info.Size() > 65536 {
		return errors.New("файл согласия превышает 64 КБ")
	}
	body, err := os.ReadFile(c.consentFile)
	if err != nil {
		return err
	}
	a.consent = strings.TrimSpace(strings.TrimPrefix(string(body), "\uFEFF"))
	if a.consent == "" {
		return errors.New("пустой файл согласия")
	}
	return nil
}

func main() {
	if err := run(os.Args[1:]); err != nil && !errors.Is(err, flag.ErrHelp) {
		log.Print(err)
		os.Exit(1)
	}
}
