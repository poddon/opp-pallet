package main

import (
	"regexp"
	"slices"
	"strings"
)

// The public Alabuga Polytech catalogue: https://polytech-alabuga.ru/sitemap
var directions = []string{
	"Аэронавигация и программирование БПЛА",
	"Бизнес-информатика на платформе 1С",
	"Биотехнологии",
	"Лабораторный химический анализ",
	"Лечебное дело и медицинская техника",
	"Международная педагогика",
	"Микроэлектроника",
	"Программирование станков с ЧПУ",
	"Промышленная автоматика",
	"Промышленная безопасность",
	"Промышленная робототехника",
	"Промышленное оборудование. Запорно-регулирующая арматура и насосы",
	"Промышленное оборудование. КИПиА",
	"Промышленное оборудование. Сварочные технологии",
	"Экономика и управление проектом",
	"Электромонтаж и эксплуатация низковольтного оборудования",
	"Юриспруденция и управление рисками",
	"BIM-проектирование",
	"FPV (оператор БПЛА)",
	"WEB-программирование",
	"WEB-программирование. Информационная безопасность",
}

var groupNumber = regexp.MustCompile(`^[0-9]{2}-[1-9][0-9]*$`)
var groupSuffix = regexp.MustCompile(`^(.*\S)\s+([0-9]{2}-[0-9]+)$`)

type programGroup struct {
	Direction string `json:"direction"`
	Number    string `json:"number"`
}

func (g programGroup) code() string {
	if !slices.Contains(directions, g.Direction) || !groupNumber.MatchString(g.Number) {
		return ""
	}
	code := strings.ToUpper(g.Direction + " " + g.Number)
	if !validLength(code, 80) {
		return ""
	}
	return code
}
