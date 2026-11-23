package main

import (
	"regexp"
	"strings"
)

type direction struct {
	Name string `json:"name"` // full name from the Alabuga Polytech catalogue
	Code string `json:"code"` // prefix of the group name, as in the paper statements
}

// The public Alabuga Polytech catalogue: https://polytech-alabuga.ru/sitemap
// Seven directions use the short names from the statements ("1C-26-8", "Электромонтаж-26-2";
// "1C" with the Latin C). The others have no agreed short name and keep the full one.
var directions = []direction{
	{"Аэронавигация и программирование БПЛА", "БПЛА"},
	{"Бизнес-информатика на платформе 1С", "1C"},
	{"Биотехнологии", "Биотехнологии"},
	{"Лабораторный химический анализ", "Лабораторный химический анализ"},
	{"Лечебное дело и медицинская техника", "Лечебное дело и медицинская техника"},
	{"Международная педагогика", "Международная педагогика"},
	{"Микроэлектроника", "Микроэлектроника"},
	{"Программирование станков с ЧПУ", "ЧПУ"},
	{"Промышленная автоматика", "Промышленная автоматика"},
	{"Промышленная безопасность", "ПромБез"},
	{"Промышленная робототехника", "Промышленная робототехника"},
	{"Промышленное оборудование. Запорно-регулирующая арматура и насосы", "ЗРА"},
	{"Промышленное оборудование. КИПиА", "Промышленное оборудование. КИПиА"},
	{"Промышленное оборудование. Сварочные технологии", "Промышленное оборудование. Сварочные технологии"},
	{"Экономика и управление проектом", "Экономика и управление проектом"},
	{"Электромонтаж и эксплуатация низковольтного оборудования", "Электромонтаж"},
	{"Юриспруденция и управление рисками", "Юриспруденция и управление рисками"},
	{"BIM-проектирование", "BIM-проектирование"},
	{"FPV (оператор БПЛА)", "FPV (оператор БПЛА)"},
	{"WEB-программирование", "WEB"},
	{"WEB-программирование. Информационная безопасность", "WEB-программирование. Информационная безопасность"},
}

// Group number: two-digit year and the group number, e.g. "26-8".
var groupNumber = regexp.MustCompile(`^[0-9]{2}-[1-9][0-9]?$`)
var groupSuffix = regexp.MustCompile(`^(.*\S)[\s-]+([0-9]{2}-[0-9]+)$`)

type programGroup struct {
	Direction string `json:"direction"`
	Number    string `json:"number"`
}

func findDirection(name string) (direction, bool) {
	name = normalize(name)
	for _, d := range directions {
		if strings.EqualFold(name, d.Name) || strings.EqualFold(name, d.Code) {
			return d, true
		}
	}
	return direction{}, false
}

func (g programGroup) code() string {
	d, ok := findDirection(g.Direction)
	if !ok || !groupNumber.MatchString(g.Number) {
		return ""
	}
	code := d.Code + "-" + g.Number
	if !validLength(code, 80) {
		return ""
	}
	return code
}
