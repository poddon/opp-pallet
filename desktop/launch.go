package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

var disableInputEcho = func() func() { return func() {} }
var ownsConsole = func() bool { return false }

type startupInput struct {
	reader *bufio.Reader
	out    io.Writer
}

func newStartupInput(in io.Reader, out io.Writer) startupInput {
	return startupInput{reader: bufio.NewReader(in), out: out}
}

func executableDir() string {
	path, err := os.Executable()
	if err != nil {
		return "."
	}
	return filepath.Dir(path)
}

func (p startupInput) ask(label, fallback string, secret bool) (string, error) {
	fmt.Fprint(p.out, label)
	if fallback != "" {
		if secret {
			fmt.Fprint(p.out, " [нажмите Enter, чтобы оставить заданный пароль]")
		} else {
			fmt.Fprintf(p.out, " [%s]", fallback)
		}
	}
	fmt.Fprint(p.out, ": ")
	if secret {
		restore := disableInputEcho()
		defer func() {
			restore()
			fmt.Fprintln(p.out)
		}()
	}
	line, err := p.reader.ReadString('\n')
	if err != nil {
		if !errors.Is(err, io.EOF) {
			return "", err
		}
		if line == "" {
			return "", errors.New("ввод параметров запуска прерван")
		}
	}
	line = strings.TrimRight(line, "\r\n")
	if !secret {
		line = strings.TrimSpace(line)
	}
	if line == "" {
		return fallback, nil
	}
	return line, nil
}

func (p startupInput) configure(dir string) (config, error) {
	saved, err := legacyDatabaseSettings(dir)
	if err != nil {
		fmt.Fprintf(p.out, "Настройки из pg-config.json не загружены: %v\n", err)
	}
	fmt.Fprintln(p.out, "Тестирование ОПП. Подключение к существующей PostgreSQL.")
	fmt.Fprintln(p.out, "Enter оставляет значение в квадратных скобках.")
	c := config{sslmode: "disable", studentHost: "0.0.0.0", adminHost: "127.0.0.1"}
	ask := func(dest *string, label, fallback string, secret bool) {
		if err != nil {
			return
		}
		*dest, err = p.ask(label, fallback, secret)
	}

	// A legacy configuration file is optional. Continue with defaults if it could not be loaded.
	err = nil
	ask(&c.host, "Адрес PostgreSQL", saved.Host, false)
	var port string
	ask(&port, "Порт PostgreSQL", strconv.Itoa(saved.Port), false)
	if err != nil {
		return c, err
	}
	if c.port, err = strconv.Atoi(port); err != nil || c.port < 1 || c.port > 65535 {
		return c, errors.New("порт PostgreSQL должен быть от 1 до 65535")
	}
	ask(&c.database, "Имя существующей базы", saved.Database, false)
	ask(&c.user, "Пользователь PostgreSQL", saved.User, false)
	ask(&c.password, "Пароль PostgreSQL", saved.Password, true)
	ask(&c.adminPassword, "Отдельный пароль админки, минимум 12 символов (Enter — входить по паролю PostgreSQL)", os.Getenv("OPP_ADMIN_PASSWORD"), true)

	consent := os.Getenv("OPP_CONSENT_FILE")
	if consent == "" {
		defaultFile := filepath.Join(dir, "consent.txt")
		if info, err := os.Stat(defaultFile); err == nil && info.Mode().IsRegular() {
			consent = defaultFile
		}
	}
	ask(&c.consentFile, "Файл согласия ОПД (Enter, чтобы пропустить, если файла нет)", consent, false)
	if err != nil {
		return c, err
	}
	c.consentFile = strings.Trim(c.consentFile, `"`)
	if c.consentFile != "" && !filepath.IsAbs(c.consentFile) {
		c.consentFile = filepath.Join(dir, c.consentFile)
	}
	return validateConfig(c)
}

type databaseSettings struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Database string `json:"database"`
	User     string `json:"user"`
	Password string `json:"password"`
}

func legacyDatabaseSettings(dir string) (databaseSettings, error) {
	defaults := databaseSettings{
		Host: "localhost", Port: 5432, Database: "opp",
		User: "postgres",
	}
	settings := defaults
	var problem error
	f, err := os.Open(filepath.Join(dir, "pg-config.json"))
	switch {
	case err == nil:
		defer f.Close()
		var saved databaseSettings
		if err := json.NewDecoder(io.LimitReader(f, 64<<10)).Decode(&saved); err != nil {
			problem = errors.New("проверьте формат файла")
			break
		}
		if saved.Host != "" {
			settings.Host = saved.Host
		}
		if saved.Port != 0 {
			settings.Port = saved.Port
		}
		if saved.Database != "" {
			settings.Database = saved.Database
		}
		if saved.User != "" {
			settings.User = saved.User
		}
		if saved.Password != "СЮДА_ПАРОЛЬ" {
			settings.Password = saved.Password
		}
	case !errors.Is(err, os.ErrNotExist):
		problem = err
	}
	if user := os.Getenv("PGUSER"); user != "" {
		settings.User = user
	}
	if password := os.Getenv("PGPASSWORD"); password != "" {
		settings.Password = password
	}
	return settings, problem
}
