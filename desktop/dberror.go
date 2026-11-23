package main

import (
	"errors"
	"fmt"
	"strings"
	"syscall"
	"unicode/utf8"

	"github.com/lib/pq"
)

// dbError explains a failed PostgreSQL connection in plain Russian.
// PostgreSQL on Windows sends connection errors in Windows-1251, which the console
// shows as "����"; such messages are converted to UTF-8 first.
func dbError(c config, err error) error {
	where := fmt.Sprintf("база %s на %s:%d", c.database, c.host, c.port)
	var pqErr *pq.Error
	if errors.As(err, &pqErr) {
		switch pqErr.Code {
		case "3D000":
			return fmt.Errorf("%s: такой базы данных нет на сервере.\n"+
				"Укажите в --name имя существующей базы или создайте её в pgAdmin: Databases → Create → Database…, "+
				"имя %s, владелец (Owner) — роль %s.\n"+
				"Или выполните в Query Tool базы postgres: CREATE DATABASE %s OWNER %s;",
				where, c.database, c.user, pq.QuoteIdentifier(c.database), pq.QuoteIdentifier(c.user))
		case "28P01":
			return fmt.Errorf("%s: неверный пароль роли %q. Проверьте --password", where, c.user)
		case "28000":
			return fmt.Errorf("%s: роль %q не может войти (роли нет, у неё не включён вход или подключение запрещено в pg_hba.conf). "+
				"Если роль называется не так, как база, укажите её через --user. Ответ сервера: %s",
				where, c.user, readable(pqErr.Message))
		case "42501":
			return fmt.Errorf("%s: у роли %q нет прав на подключение к базе. Ответ сервера: %s", where, c.user, readable(pqErr.Message))
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
