package main

import (
	"archive/zip"
	"bytes"
	"strings"
	"testing"
)

func TestCheatReason(t *testing.T) {
	if cheatReason("window") != cheatReasons["window"] || cheatReason("<script>") != cheatReasons["other"] {
		t.Fatal("cheat reasons")
	}
}

func TestStatement(t *testing.T) {
	if got := (programGroup{Direction: "Бизнес-информатика на платформе 1С", Number: "26-8"}).code(); got != "1C-26-8" {
		t.Fatal(got)
	}
	if got := (programGroup{Direction: "Промышленная робототехника", Number: "26-20"}).code(); got != "Промышленная робототехника-26-20" {
		t.Fatal(got)
	}
	if got := (programGroup{Direction: "Промышленная робототехника", Number: "26-0"}).code(); got != "" {
		t.Fatal("group number 0 must be rejected:", got)
	}
	if got := (programGroup{Direction: "1C", Number: "26-8"}).code(); got != "1C-26-8" {
		t.Fatal(got)
	}
	if got := shortGroup("Электромонтаж-26-2"); got != "Электромонтаж-26-2" {
		t.Fatal(got)
	}
	if got := shortGroup("ЭЛЕКТРОМОНТАЖ И ЭКСПЛУАТАЦИЯ НИЗКОВОЛЬТНОГО ОБОРУДОВАНИЯ 26-2"); got != "Электромонтаж-26-2" {
		t.Fatal(got)
	}
	if got := shortGroup("ПРОМРОБО 25-3"); got != "ПРОМРОБО 25-3" {
		t.Fatal(got)
	}
	rows := []resultRow{
		{Date: "10.11.2026", Name: "Яковлев Ян", Group: "1C-26-8", Percent: 80},
		{Date: "09.11.2026", Name: "Ажимова  Виктория", Group: "1C-26-8", Percent: 42},
		{Date: "08.11.2026", Name: "Яковлев Ян", Group: "1C-26-8", Percent: 10},
		{Date: "06.11.2026", Name: "Ёлкин Олег", Group: "ПРОГРАММИРОВАНИЕ СТАНКОВ С ЧПУ 26-9", Percent: 0},
	}
	body, err := statement(rows)
	if err != nil {
		t.Fatal(err)
	}
	book, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		t.Fatal(err)
	}
	read := func(name string) string {
		for _, f := range book.File {
			if f.Name == name {
				r, _ := f.Open()
				var b bytes.Buffer
				b.ReadFrom(r)
				return b.String()
			}
		}
		t.Fatalf("missing %s", name)
		return ""
	}
	wb := read("xl/workbook.xml")
	if !strings.Contains(wb, `name="1C-26-8"`) || !strings.Contains(wb, `name="ЧПУ-26-9"`) {
		t.Fatal(wb)
	}
	sheet := read("xl/worksheets/sheet1.xml")
	for _, want := range []string{"10.11.2026 г.", "Ажимова Виктория", "<v>80</v>", "COUNTIF(C8:C9", "Подпись студента"} {
		if !strings.Contains(sheet, want) {
			t.Fatalf("sheet lacks %q", want)
		}
	}
	if strings.Contains(sheet, "<v>10</v>") || strings.Index(sheet, "Ажимова") > strings.Index(sheet, "Яковлев") {
		t.Fatal("statement must keep the latest attempt and sort students by name")
	}
}
