package main

import (
	"context"
	"math"
	"sort"
	"strings"
)

const passPercent = 70

type statLine struct {
	Group     string  `json:"group"`
	Attempts  int     `json:"attempts"`
	Students  int     `json:"students"`
	Average   float64 `json:"average"`  // average result, %
	Passed    int     `json:"passed"`   // attempts with 70% or more
	PassRate  float64 `json:"passRate"` // share of such attempts, %
	Cheating  int     `json:"cheating"`
	sum       int
	names     map[string]bool
}

type moduleStat struct {
	Module   string  `json:"module"`
	Correct  int     `json:"correct"`
	Total    int     `json:"total"`
	Average  float64 `json:"average"` // share of correct answers, %
}

type questionStat struct {
	Module      string  `json:"module"`
	Text        string  `json:"text"`
	Wrong       int     `json:"wrong"`
	Empty       int     `json:"empty"`
	Total       int     `json:"total"`
	WrongRate   float64 `json:"wrongRate"` // wrong answers among all, %
	CommonWrong string  `json:"commonWrong,omitempty"`
	CommonCount int     `json:"commonCount,omitempty"`
	choices     map[string]int
}

type resultStats struct {
	Total     statLine       `json:"total"`
	Groups    []statLine     `json:"groups"`
	Modules   []moduleStat   `json:"modules"`
	Questions []questionStat `json:"questions"` // questions with wrong answers, most wrong first
}

func round1(v float64) float64 { return math.Round(v*10) / 10 }

func (l *statLine) add(row resultRow) {
	if l.names == nil {
		l.names = map[string]bool{}
	}
	l.Attempts++
	l.sum += row.Percent
	if row.Percent >= passPercent {
		l.Passed++
	}
	if row.Status == flagged {
		l.Cheating++
	}
	l.names[strings.ToLower(normalize(row.Name))] = true
}

func (l *statLine) finish() {
	l.Students = len(l.names)
	if l.Attempts > 0 {
		l.Average = round1(float64(l.sum) / float64(l.Attempts))
		l.PassRate = round1(100 * float64(l.Passed) / float64(l.Attempts))
	}
}

// stats summarises the filtered results: totals, every group and every module.
func (a *app) stats(ctx context.Context, items []resultRow) (resultStats, error) {
	out := resultStats{Total: statLine{Group: "Все группы"}, Groups: []statLine{}, Modules: []moduleStat{}, Questions: []questionStat{}}
	groups := map[string]*statLine{}
	ids := []string{}
	for _, row := range items {
		out.Total.add(row)
		g := groups[row.Group]
		if g == nil {
			g = &statLine{Group: row.Group}
			groups[row.Group] = g
		}
		g.add(row)
		if !row.Archived {
			ids = append(ids, row.ID)
		}
	}
	out.Total.finish()
	for _, g := range groups {
		g.finish()
		out.Groups = append(out.Groups, *g)
	}
	sort.Slice(out.Groups, func(i, j int) bool { return sortKey(out.Groups[i].Group) < sortKey(out.Groups[j].Group) })

	answers, err := a.attemptAnswers(ctx, ids)
	if err != nil {
		return out, err
	}
	byModule := map[string]*moduleStat{}
	for _, m := range a.modules {
		byModule[m] = &moduleStat{Module: m}
	}
	questions := map[string]*questionStat{}
	for _, list := range answers {
		for _, q := range list {
			qs := questions[q.Text]
			if qs == nil {
				qs = &questionStat{Module: q.Module, Text: q.Text, choices: map[string]int{}}
				questions[q.Text] = qs
			}
			qs.Total++
			switch verdict(q) {
			case "Неправильно":
				qs.Wrong++
				qs.choices[q.Selected]++
			case "Без ответа":
				qs.Empty++
			}
			m := byModule[q.Module]
			if m == nil {
				continue
			}
			m.Total++
			if q.Correct {
				m.Correct++
			}
		}
	}
	for _, qs := range questions {
		if qs.Wrong == 0 {
			continue
		}
		qs.WrongRate = round1(100 * float64(qs.Wrong) / float64(qs.Total))
		for choice, n := range qs.choices {
			if n > qs.CommonCount || (n == qs.CommonCount && choice < qs.CommonWrong) {
				qs.CommonWrong, qs.CommonCount = choice, n
			}
		}
		out.Questions = append(out.Questions, *qs)
	}
	sort.Slice(out.Questions, func(i, j int) bool {
		a, b := out.Questions[i], out.Questions[j]
		if a.Wrong != b.Wrong {
			return a.Wrong > b.Wrong
		}
		if a.WrongRate != b.WrongRate {
			return a.WrongRate > b.WrongRate
		}
		return a.Text < b.Text
	})
	for _, name := range a.modules {
		m := byModule[name]
		if m.Total > 0 {
			m.Average = round1(100 * float64(m.Correct) / float64(m.Total))
		}
		out.Modules = append(out.Modules, *m)
	}
	return out, nil
}

func statsSheets(s resultStats) []sheetData {
	rows := [][]any{{"Группа", "Прохождений", "Студентов", "Средний результат, %", "Сдали на 70% и более", "Доля сдавших, %", "Списываний"}}
	line := func(l statLine) []any {
		return []any{l.Group, l.Attempts, l.Students, l.Average, l.Passed, l.PassRate, l.Cheating}
	}
	for _, g := range s.Groups {
		rows = append(rows, line(g))
	}
	rows = append(rows, line(s.Total), []any{})
	rows = append(rows, []any{"Модуль", "Правильных ответов", "Всего ответов", "Правильных, %"})
	for _, m := range s.Modules {
		rows = append(rows, []any{m.Module, m.Correct, m.Total, m.Average})
	}
	errors := [][]any{{"Модуль", "Вопрос", "Неправильно", "Без ответа", "Всего ответов", "Доля ошибок, %", "Частый неверный ответ", "Выбрали его"}}
	for _, q := range s.Questions {
		errors = append(errors, []any{q.Module, q.Text, q.Wrong, q.Empty, q.Total, q.WrongRate, q.CommonWrong, q.CommonCount})
	}
	return []sheetData{
		{"Статистика", rows, []int{36, 14, 12, 20, 20, 16, 12}},
		{"Ошибки по вопросам", errors, []int{12, 70, 13, 12, 14, 15, 50, 12}},
	}
}
