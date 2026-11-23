package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	mathrand "math/rand"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	generalTest = "general"
	questionSeconds = 55
	inProgress = "Проходит"
	completed = "Пройден"
	closed = "Тест закрыт"
	flagged = "СПИСЫВАНИЕ"
)

type app struct {
	db *sql.DB
	catalog []test
	modules []string          // module labels in catalogue order: "Модуль 1", "Модуль 2", …
	moduleLabel map[string]string // module title -> label
	moduleOf map[string]string // question text -> module, for attempts saved before modules were stored
}

type question struct {
	Text string `json:"q"`
	Choices []string `json:"a"`
	Correct int `json:"i"`
	Module string `json:"m,omitempty"`
}

type test struct {
	ID string `json:"id"`
	Title string `json:"title"`
	Questions []question `json:"questions"`
}

func readCatalog() ([]test, error) {
	body, err := files.ReadFile("questions.json")
	if err != nil {
		return nil, err
	}
	var catalog []test
	if err := json.Unmarshal(body, &catalog); err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	general := test{ID: generalTest, Title: "Общий тест"}
	for k := range catalog {
		t := &catalog[k]
		if seen[t.ID] {
			return nil, fmt.Errorf("повторяется тест %s", t.ID)
		}
		seen[t.ID] = true
		if t.ID == "" || t.Title == "" || len(t.Questions) == 0 {
			return nil, errors.New("некорректный тест в банке вопросов")
		}
		for _, q := range t.Questions {
			if q.Text == "" || len(q.Choices) < 2 || q.Correct < 0 || q.Correct >= len(q.Choices) {
				return nil, fmt.Errorf("некорректный вопрос теста %s", t.ID)
			}
		}
		for i := range t.Questions {
			t.Questions[i].Module = t.Title
		}
		general.Questions = append(general.Questions, t.Questions...)
	}
	if len(catalog) == 0 {
		return nil, errors.New("банк вопросов пуст")
	}
	return append([]test{general}, catalog...), nil
}

func (a *app) loadCatalog() error {
	catalog, err := readCatalog()
	if err != nil {
		return err
	}
	a.catalog, a.modules, a.moduleOf, a.moduleLabel = catalog, nil, map[string]string{}, map[string]string{}
	for k, t := range catalog[1:] {
		label := fmt.Sprintf("Модуль %d", k+1)
		a.modules = append(a.modules, label)
		a.moduleLabel[t.Title] = label
		for _, q := range t.Questions {
			a.moduleOf[q.Text] = t.Title
		}
	}
	return nil
}

// moduleFor returns the module label ("Модуль 1") of a stored question.
func (a *app) moduleFor(q question) string {
	title := q.Module
	if title == "" {
		title = a.moduleOf[q.Text]
	}
	if label := a.moduleLabel[title]; label != "" {
		return label
	}
	return "Без модуля"
}

func digest(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

func newToken() (string, error) {
	var token [32]byte
	_, err := rand.Read(token[:])
	return hex.EncodeToString(token[:]), err
}

func validToken(s string) bool {
	_, err := hex.DecodeString(s)
	return len(s) == 64 && err == nil
}

func normalize(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

func validLength(s string, max int) bool {
	return s != "" && utf8.RuneCountInString(s) <= max && !strings.ContainsRune(s, 0)
}

func shuffleQuestions(qs []question) {
	mathrand.Shuffle(len(qs), func(i, j int) { qs[i], qs[j] = qs[j], qs[i] })
	for k := range qs {
		q := &qs[k]
		mathrand.Shuffle(len(q.Choices), func(i, j int) {
			q.Choices[i], q.Choices[j] = q.Choices[j], q.Choices[i]
			switch q.Correct {
			case i:
				q.Correct = j
			case j:
				q.Correct = i
			}
		})
	}
}

const closeDue = `UPDATE quiz_assignments SET closed_at=closes_at
	WHERE closed_at IS NULL AND closes_at <= clock_timestamp()`

const finishClosed = `UPDATE quiz_live l SET status='Тест закрыт', finished_at=a.closed_at,
	seconds_left=0, updated_at=clock_timestamp()
	FROM quiz_assignments a WHERE l.assignment_id=a.id AND l.finished_at IS NULL AND a.closed_at IS NOT NULL`

func (a *app) expire(ctx context.Context) error {
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, closeDue); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, finishClosed); err != nil {
		return err
	}
	return tx.Commit()
}

const dropExpiredSessions = `DELETE FROM quiz_admin_sessions WHERE expires_at <= clock_timestamp()`

func (a *app) schedule(ctx context.Context) {
	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()
	for {
		work, cancel := context.WithTimeout(ctx, 10*time.Second)
		err := a.expire(work)
		if err == nil {
			_, err = a.db.ExecContext(work, dropExpiredSessions)
		}
		cancel()
		if err != nil && ctx.Err() == nil {
			log.Printf("автозакрытие тестов: %v", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (a *app) cleanup(ctx context.Context, apply bool) error {
	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: !apply})
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var exists bool
	if err := tx.QueryRowContext(ctx, "SELECT to_regclass('quiz_live') IS NOT NULL").Scan(&exists); err != nil {
		return err
	}
	var count int64
	if exists {
		// Older installations lack assignment_id. Reading it from the row JSON covers both schemas.
		const stale = ` FROM quiz_live l WHERE to_jsonb(l)->>'assignment_id' IS NULL
			AND updated_at < clock_timestamp() - interval '1 day'`
		if apply {
			result, err := tx.ExecContext(ctx, "DELETE"+stale)
			if err != nil {
				return err
			}
			count, err = result.RowsAffected()
			if err != nil {
				return err
			}
		} else if err := tx.QueryRowContext(ctx, "SELECT count(*)"+stale).Scan(&count); err != nil {
			return err
		}
	}
	var sessions int64
	if err := tx.QueryRowContext(ctx, "SELECT to_regclass('quiz_admin_sessions') IS NOT NULL").Scan(&exists); err != nil {
		return err
	}
	if exists {
		const expired = ` FROM quiz_admin_sessions WHERE expires_at <= clock_timestamp()`
		if apply {
			result, err := tx.ExecContext(ctx, "DELETE"+expired)
			if err != nil {
				return err
			}
			if sessions, err = result.RowsAffected(); err != nil {
				return err
			}
		} else if err := tx.QueryRowContext(ctx, "SELECT count(*)"+expired).Scan(&sessions); err != nil {
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	fmt.Printf("Устаревшие записи старого мониторинга — %d\n", count)
	fmt.Printf("Просроченные сеансы администратора — %d\n", sessions)
	if !apply {
		fmt.Println("Для удаления повторите команду с --apply")
	}
	return nil
}

type attempt struct {
	Position, Total, Score int
	Status string
	Questions []question
	Deadline time.Time
}

type attemptView struct {
	Status string `json:"status"`
	Position int `json:"position"`
	Total int `json:"total"`
	Score int `json:"score"`
	Seconds int `json:"seconds"`
	Text string `json:"text,omitempty"`
	Choices []string `json:"choices,omitempty"`
}

func (s attempt) view(now time.Time) attemptView {
	v := attemptView{Status: s.Status, Position: s.Position, Total: s.Total, Score: s.Score}
	if s.Status == inProgress {
		q := s.Questions[s.Position-1]
		v.Text, v.Choices = q.Text, q.Choices
		v.Seconds = max(0, int((s.Deadline.Sub(now)+time.Second-1)/time.Second))
	}
	return v
}

type attemptAction struct {
	Operation string `json:"operation"`
	Token string `json:"token"`
	Assignment int64 `json:"assignment"`
	Name string `json:"name"`
	Group string `json:"group"`
	Consent string `json:"consent"`
	Rules bool `json:"rules"`
	Position int `json:"position"`
	Choice *int `json:"choice"`
	Reason string `json:"reason"`
}

// cheatReasons are the violations the student page reports; anything else is stored as "other".
var cheatReasons = map[string]string{
	"tab":        "Уход со страницы (другая вкладка или свёрнутый браузер)",
	"window":     "Переключение на другое окно или всплывающее окно поверх теста",
	"split":      "Разделение экрана или уменьшение окна (второе приложение рядом, плавающее окно)",
	"screenshot": "Снимок экрана",
	"gesture":    "Жест тремя пальцами на телефоне (снимок экрана)",
	"copy":       "Копирование или вырезание текста",
	"paste":      "Вставка текста",
	"menu":       "Вызов контекстного меню (правый клик)",
	"print":      "Печать страницы",
	"devtools":   "Попытка открыть инструменты разработчика",
	"other":      "Нарушение правил тестирования",
}

func cheatReason(code string) string {
	if text, ok := cheatReasons[code]; ok {
		return text
	}
	return cheatReasons["other"]
}

func loadAttempt(ctx context.Context, tx *sql.Tx, hash string, assignment int64) (attempt, error) {
	var s attempt
	var bank []byte
	err := tx.QueryRowContext(ctx, `SELECT question, total, status, deadline, question_set
		FROM quiz_live WHERE session_id=$1 AND assignment_id=$2 FOR UPDATE`, hash, assignment).
		Scan(&s.Position, &s.Total, &s.Status, &s.Deadline, &bank)
	if err != nil {
		return s, err
	}
	return s, json.Unmarshal(bank, &s.Questions)
}

func (a *app) advance(ctx context.Context, req attemptAction) (attemptView, error) {
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return attemptView{}, err
	}
	defer tx.Rollback()
	var group string
	var expires time.Time
	var closedAt sql.NullTime
	var bank []byte
	err = tx.QueryRowContext(ctx, `SELECT group_code,closes_at,closed_at,questions FROM quiz_assignments
		WHERE id=$1 FOR SHARE`, req.Assignment).Scan(&group, &expires, &closedAt, &bank)
	if errors.Is(err, sql.ErrNoRows) {
		return attemptView{}, problem{404, "Тест не найден"}
	}
	if err != nil {
		return attemptView{}, err
	}
	hash := digest(req.Token)
	s, err := loadAttempt(ctx, tx, hash, req.Assignment)
	found := err == nil
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return attemptView{}, err
	}
	var now time.Time
	if err := tx.QueryRowContext(ctx, "SELECT clock_timestamp()").Scan(&now); err != nil {
		return attemptView{}, err
	}
	ended := closedAt.Valid || !now.Before(expires)
	if !found {
		if req.Operation != "start" {
			return attemptView{}, problem{404, "Попытка не найдена"}
		}
		if req.Group != group {
			return attemptView{}, problem{400, "Выберите тест своей группы"}
		}
		if ended {
			return attemptView{}, problem{409, "Тест для этой группы уже закрыт"}
		}
		consent := consentText()
		if req.Consent == "" || !req.Rules {
			return attemptView{}, problem{400, "Подтвердите согласие и ознакомление с правилами"}
		}
		if digest(consent) != req.Consent {
			return attemptView{}, problem{412, "Текст согласия обновился. Ознакомьтесь с ним и подтвердите согласие заново."}
		}
		name := normalize(req.Name)
		if !validLength(name, 160) {
			return attemptView{}, problem{400, "Укажите ФИО"}
		}
		if err := json.Unmarshal(bank, &s.Questions); err != nil {
			return attemptView{}, err
		}
		shuffleQuestions(s.Questions)
		s.Position, s.Total, s.Status = 1, len(s.Questions), inProgress
		s.Deadline = deadline(now, expires)
		questions, err := json.Marshal(s.Questions)
		if err != nil {
			return attemptView{}, err
		}
		var id string
		err = tx.QueryRowContext(ctx, `INSERT INTO quiz_live
			(session_id,name,group_code,question,total,seconds_left,status,updated_at,assignment_id,name_norm,
			started_at,deadline,question_set,consent_at,consent_text)
			VALUES ($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$7,$10,$11,$7,$12)
			ON CONFLICT DO NOTHING RETURNING session_id`,
			hash, name, group, s.Total, s.view(now).Seconds, s.Status, now, req.Assignment,
			strings.ToLower(name), s.Deadline, string(questions), consent).Scan(&id)
		if errors.Is(err, sql.ErrNoRows) {
			s, err = loadAttempt(ctx, tx, hash, req.Assignment)
			if errors.Is(err, sql.ErrNoRows) {
				return attemptView{}, problem{409, "Попытка для этого ФИО и теста уже зарегистрирована"}
			}
		}
		if err != nil {
			return attemptView{}, err
		}
	} else if s.Status == inProgress {
		var finishedAt any
		switch {
		case ended:
			s.Status = closed
			finishedAt = expires
			if closedAt.Valid {
				finishedAt = closedAt.Time
			}
		case req.Operation == "flag":
			s.Status = flagged
			finishedAt = now
			if _, err := tx.ExecContext(ctx, `UPDATE quiz_live SET cheat_reason=$2 WHERE session_id=$1`,
				hash, cheatReason(req.Reason)); err != nil {
				return attemptView{}, err
			}
		case !now.Before(s.Deadline) || (req.Operation == "answer" && req.Position == s.Position):
			q := s.Questions[s.Position-1]
			var choice *int
			if now.Before(s.Deadline) {
				choice = req.Choice
			}
			if choice != nil && (*choice < 0 || *choice >= len(q.Choices)) {
				return attemptView{}, problem{400, "Вариант ответа не найден"}
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO quiz_answers(session_id,question,choice,correct)
				VALUES ($1,$2,$3,$4)`, hash, s.Position, choice, choice != nil && *choice == q.Correct); err != nil {
				return attemptView{}, err
			}
			if s.Position == s.Total {
				s.Status, finishedAt = completed, now
			} else {
				s.Position++
				s.Deadline = deadline(now, expires)
			}
		}
		if _, err := tx.ExecContext(ctx, `UPDATE quiz_live SET question=$2,deadline=$3,seconds_left=$4,status=$5,
			finished_at=$6,updated_at=$7 WHERE session_id=$1`,
			hash, s.Position, s.Deadline, s.view(now).Seconds, s.Status, finishedAt, now); err != nil {
			return attemptView{}, err
		}
	}
	if s.Status != inProgress && s.Status != flagged {
		if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM quiz_answers WHERE session_id=$1 AND correct", hash).Scan(&s.Score); err != nil {
			return attemptView{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return attemptView{}, err
	}
	return s.view(now), nil
}

func deadline(now, expires time.Time) time.Time {
	next := now.Add(questionSeconds * time.Second)
	if expires.Before(next) {
		return expires
	}
	return next
}
