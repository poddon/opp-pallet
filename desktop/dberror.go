package main

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"syscall"
	"unicode/utf8"

	"github.com/lib/pq"
)

// dbError explains a failed PostgreSQL connection in plain Russian.
// PostgreSQL on Windows sends connection errors in Windows-1251, which the console
// shows as "����"; such messages are converted to UTF-8 first.
func dbError(c config, err error) error {
	where := fmt.Sprintf("PostgreSQL %s:%d, пользователь %s, база %s", c.host, c.port, c.user, c.database)
	var pqErr *pq.Error
	if errors.As(err, &pqErr) {
		switch pqErr.Code {
		case "28P01":
			return fmt.Errorf("%s: неверный пароль пользователя %q. Проверьте --password", where, c.user)
		case "28000":
			return fmt.Errorf("%s: пользователь %q не может войти (такого пользователя нет, у него не включён вход "+
				"или подключение запрещено в pg_hba.conf). Ответ сервера: %s", where, c.user, readable(pqErr.Message))
		case "3D000":
			return fmt.Errorf("%s: базы данных %q нет на сервере. Не указывайте --db, чтобы использовать базу postgres, "+
				"или укажите в --db существующую базу", where, c.database)
		case "42501":
			return fmt.Errorf("%s: у пользователя %q нет прав на подключение к базе. Ответ сервера: %s", where, c.user, readable(pqErr.Message))
		}
		return fmt.Errorf("%s: %s (код %s)", where, readable(pqErr.Message), pqErr.Code)
	}
	if errors.Is(err, syscall.ECONNREFUSED) || strings.Contains(err.Error(), "connectex") {
		return fmt.Errorf("%s: сервер PostgreSQL не отвечает. Проверьте, что служба PostgreSQL запущена, а адрес (--ip) и порт (--port) верные: %s",
			where, readable(err.Error()))
	}
	return fmt.Errorf("%s: %s", where, readable(err.Error()))
}

// readable converts Windows-1251 text to UTF-8 when it is not valid UTF-8.
func readable(s string) string {
	if utf8.ValidString(s) {
		return s
	}
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		ch := s[i]
		switch {
		case ch < 0x80:
			b.WriteByte(ch)
		case ch >= 0xC0:
			b.WriteRune(rune(0x0410 + int(ch) - 0xC0))
		case ch == 0xA8:
			b.WriteRune('Ё')
		case ch == 0xB8:
			b.WriteRune('ё')
		case ch == 0xAB:
			b.WriteRune('«')
		case ch == 0xBB:
			b.WriteRune('»')
		default:
			b.WriteRune('?')
		}
	}
	return b.String()
}

// migrationError explains a failure to create the application tables.
// foreign lists quiz_* tables owned by another PostgreSQL user.
func migrationError(c config, err error, foreign map[string]string) error {
	var pqErr *pq.Error
	if !errors.As(err, &pqErr) {
		return fmt.Errorf("создание таблиц в базе %s: %w", c.database, err)
	}
	if pqErr.Code != "42501" {
		return fmt.Errorf("создание таблиц в базе %s: %s (код %s)", c.database, readable(pqErr.Message), pqErr.Code)
	}
	if len(foreign) > 0 {
		owners := map[string]bool{}
		for _, owner := range foreign {
			owners[owner] = true
		}
		list := make([]string, 0, len(owners))
		for owner := range owners {
			list = append(list, owner)
		}
		sort.Strings(list)
		return fmt.Errorf("таблицы тестирования (quiz_*) в базе %s уже созданы другим пользователем (%s), "+
			"поэтому пользователь %q не может их обновить.\n"+
			"Запустите программу с --name %s или передайте таблицы пользователю %s — выполните от имени postgres в Query Tool базы %s:\n"+
			"DO $$DECLARE t text; BEGIN FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'quiz%%' "+
			"LOOP EXECUTE format('ALTER TABLE public.%%I OWNER TO %%I', t, %s); END LOOP; END$$;",
			c.database, strings.Join(list, ", "), c.user, list[0], c.user, c.database, pq.QuoteLiteral(c.user))
	}
	return fmt.Errorf("у пользователя %q нет прав создавать таблицы в базе %s (схема public). "+
		"Выдайте права от имени postgres в Query Tool базы %s:\n"+
		"GRANT CREATE, USAGE ON SCHEMA public TO %s;\nОтвет сервера: %s",
		c.user, c.database, c.database, pq.QuoteIdentifier(c.user), readable(pqErr.Message))
}
