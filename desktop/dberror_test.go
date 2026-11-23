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
	c := config{host: "localhost", port: 5432, database: "skopp", user: "skopp"}
	err := dbError(c, &pq.Error{Code: "3D000", Message: cp1251})
	if !strings.Contains(err.Error(), "база skopp на localhost:5432: такой базы данных нет на сервере") || !strings.Contains(err.Error(), `CREATE DATABASE "skopp" OWNER "skopp"`) {
		t.Fatal(err)
	}
	if err := dbError(c, &pq.Error{Code: "28P01"}); !strings.Contains(err.Error(), "неверный пароль") {
		t.Fatal(err)
	}
}
