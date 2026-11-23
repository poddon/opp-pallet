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

type resultStats struct {
	Total   statLine     `json:"total"`
	Groups  []statLine   `json:"groups"`
	Modules []moduleStat `json:"modules"`
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
	out := resultStats{Total: statLine{Group: "Все группы"}, Groups: []statLine{}, Modules: []moduleStat{}}
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
	for _, list := range answers {
		for _, q := range list {
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
	for _, name := range a.modules {
		m := byModule[name]
		if m.Total > 0 {
			m.Average = round1(100 * float64(m.Correct) / float64(m.Total))
		}
		out.Modules = append(out.Modules, *m)
	}
	return out, nil
}

func statsSheet(s resultStats) sheetData {
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
	return sheetData{"Статистика", rows, []int{36, 14, 12, 20, 20, 16, 12}}
}
