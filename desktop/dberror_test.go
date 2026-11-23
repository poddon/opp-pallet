package main

import (
	"strings"
	"testing"

	"github.com/lib/pq"
)

func TestDBError(t *testing.T) {
	// "база данных "skopp" не существует" as PostgreSQL on Windows sends it (Windows-1251).
	cp1251 := string([]byte{0xE1, 0xE0, 0xE7, 0xE0, ' ', 0xE4, 0xE0, 0xED, 0xED, 0xFB, 0xF5})
	if got := readable(cp1251); got != "база данных" {
		t.Fatal(got)
	}
	c := config{host: "localhost", port: 5432, database: "postgres", user: "skopp"}
	if err := dbError(c, &pq.Error{Code: "28P01"}); !strings.Contains(err.Error(), `неверный пароль пользователя "skopp"`) {
		t.Fatal(err)
	}
	if err := migrationError(c, &pq.Error{Code: "42501", Message: "permission denied for schema public"}, nil); !strings.Contains(err.Error(), `GRANT CREATE, USAGE ON SCHEMA public TO "skopp"`) {
		t.Fatal(err)
	}
	owned := migrationError(c, &pq.Error{Code: "42501"}, map[string]string{"quiz_live": "postgres"})
	if !strings.Contains(owned.Error(), "уже созданы другим пользователем (postgres)") || !strings.Contains(owned.Error(), "OWNER TO %I', t, 'skopp')") {
		t.Fatal(owned)
	}
}
