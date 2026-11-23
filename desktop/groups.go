package main

import (
	"regexp"
	"slices"
)

// Directions as they are named in the paper statements ("1C-26-8", "Электромонтаж-26-2").
// "1C" uses the Latin C, as in the statements.
var directions = []string{"1C", "Электромонтаж", "БПЛА", "ЗРА", "WEB", "ЧПУ", "ПромБез"}

var groupNumber = regexp.MustCompile(`^[0-9]{2}-[1-9][0-9]*$`)
var groupSuffix = regexp.MustCompile(`^(.*\S)[\s-]+([0-9]{2}-[0-9]+)$`)

type programGroup struct {
	Direction string `json:"direction"`
	Number    string `json:"number"`
}

func (g programGroup) code() string {
	if !slices.Contains(directions, g.Direction) || !groupNumber.MatchString(g.Number) {
		return ""
	}
	code := g.Direction + "-" + g.Number
	if !validLength(code, 80) {
		return ""
	}
	return code
}
