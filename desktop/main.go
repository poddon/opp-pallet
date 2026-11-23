package main

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"runtime"
	"strconv"
	"time"

	_ "github.com/lib/pq"
)

//go:embed web/* schema.sql questions.json consent.txt
var files embed.FS

type config struct {
	host, database, user, password, sslmode string
	studentHost, adminHost string
	port int
	cleanup, apply bool
}

func parseConfig(args []string) (config, error) {
	var c config
	if len(args) == 0 || (args[0] != "start" && args[0] != "cleanup") {
		return c, errors.New("использование: OPP-test.exe start --ip localhost --port 5432 --name ИМЯ_БАЗЫ --password ПАРОЛЬ\n" +
			"подробнее: OPP-test.exe start --help или OPP-test.exe cleanup --help")
	}
	c.cleanup = args[0] == "cleanup"
	flags := flag.NewFlagSet(args[0], flag.ContinueOnError)
	flags.StringVar(&c.host, "ip", "localhost", "адрес PostgreSQL")
	flags.IntVar(&c.port, "port", 5432, "порт PostgreSQL")
	flags.StringVar(&c.database, "name", "opp", "имя существующей базы PostgreSQL")
	flags.StringVar(&c.user, "user", os.Getenv("PGUSER"), "роль PostgreSQL (по умолчанию совпадает с --name)")
	flags.StringVar(&c.password, "password", "", "пароль PostgreSQL (или PGPASSWORD)")
	flags.StringVar(&c.sslmode, "sslmode", "disable", "режим TLS PostgreSQL (disable, require, verify-ca, verify-full)")
	if c.cleanup {
		flags.BoolVar(&c.apply, "apply", false, "удалить устаревшие технические записи после просмотра")
	} else {
		flags.StringVar(&c.studentHost, "student-bind", "0.0.0.0", "интерфейс портала студента")
		flags.StringVar(&c.adminHost, "admin-bind", "127.0.0.1", "интерфейс портала администратора")
	}
	if err := flags.Parse(args[1:]); err != nil {
		return c, err
	}
	if flags.NArg() != 0 {
		return c, errors.New("проверьте параметры запуска")
	}
	if c.password == "" {
		c.password = os.Getenv("PGPASSWORD")
	}
	return validateConfig(c)
}

func validateConfig(c config) (config, error) {
	if c.port < 1 || c.port > 65535 {
		return c, errors.New("порт PostgreSQL должен быть от 1 до 65535")
	}
	if c.database == "" || c.host == "" {
		return c, errors.New("укажите адрес PostgreSQL и имя существующей базы")
	}
	if c.user == "" {
		c.user = c.database
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
	if err := tx.Commit(); err != nil {
		return err
	}
	return a.seedAdmins(ctx)
}

func run(c config) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	fmt.Printf("Подключение к базе %s на %s:%d (роль %s)…\n", c.database, c.host, c.port, c.user)
	db, err := openDB(ctx, c)
	if err != nil {
		return dbError(c, err)
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
		return fmt.Errorf("подготовка таблиц (проверьте права роли PostgreSQL): %w", err)
	}
	student, err := net.Listen("tcp", net.JoinHostPort(c.studentHost, "8004"))
	if err != nil {
		return fmt.Errorf("порт студента 8004: %w. Если приложение уже запущено, закройте предыдущий экземпляр", err)
	}
	defer student.Close()
	admin, err := net.Listen("tcp", net.JoinHostPort(c.adminHost, "8005"))
	if err != nil {
		return fmt.Errorf("порт администратора 8005: %w. Если приложение уже запущено, закройте предыдущий экземпляр", err)
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
	if err = a.loadCatalog(); err != nil {
		return err
	}
	return nil
}

func main() {
	args := os.Args[1:]
	wizard := runtime.GOOS == "windows" && len(args) == 0
	input := newStartupInput(os.Stdin, os.Stdout)

	var c config
	var err error
	if wizard {
		c, err = input.configure(executableDir())
	} else {
		c, err = parseConfig(args)
	}
	if err == nil {
		err = run(c)
	}
	if err != nil && !errors.Is(err, flag.ErrHelp) {
		fmt.Fprintln(os.Stderr, "Ошибка:", err)
		if wizard || ownsConsole() {
			fmt.Fprintln(os.Stderr, "Нажмите Enter, чтобы закрыть окно.")
			_, _ = input.reader.ReadString('\n')
		}
		os.Exit(1)
	}
}
