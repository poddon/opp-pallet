# База теста ОПП на Synology

Результаты теста, «живое» отслеживание, админ-панель и страница статистики могут храниться
в PostgreSQL на вашем Synology вместо Supabase.

Пока в `synology-config.js` не вписан адрес NAS, сайт пишет в прежнюю базу — ничего не ломается.

Что понадобится: Synology с DSM 7.2, пакеты **Container Manager** и **Web Station**.

---

## 1. PostgreSQL в Container Manager

1. **Центр пакетов** → установите **Container Manager**.
2. **File Station** → создайте папку `docker/opp-db`.
3. **Container Manager → Проект → Создать**:
   - Имя: `opp-db`, путь: `docker/opp-db`, источник: «Создать docker-compose.yml».
   - Вставьте (пароль `СменитеПароль` замените на свой):

```yaml
services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: opp
      POSTGRES_USER: opp
      POSTGRES_PASSWORD: СменитеПароль
      TZ: Europe/Moscow
    ports:
      - "127.0.0.1:5432:5432"
    volumes:
      - ./data:/var/lib/postgresql/data
```

4. **Далее → Готово.** Через минуту контейнер `opp-db-db-1` будет «Работает».

`127.0.0.1` — база доступна только самому NAS, из интернета её не видно. Порт 5432 на роутере **не открывайте**.
Таблицы создавать не нужно: `api.php` создаст их сам при первом запросе.

## 2. Web Station с PHP

1. **Центр пакетов** → установите **Web Station**, при установке согласитесь на **PHP 8.2**.
2. **Web Station → Настройки скриптового языка → PHP → Создать профиль** (или «Правка» существующего):
   - Версия PHP 8.2.
   - Вкладка **Расширения**: отметьте `pgsql` и `pdo_pgsql`. Сохранить.
3. **Web Station → Веб-портал → Создать → Портал веб-службы → Сервер по умолчанию (default server)**,
   профиль PHP — тот, что вы настроили выше.

## 3. Файлы сайта на NAS

1. Скачайте папку `test` из GitHub (ветка `gh-pages`): **Code → Download ZIP**, распакуйте и возьмите папку `test`.
2. **File Station → web** → создайте папку `opp` и скопируйте в неё **всё содержимое** папки `test`.
3. В папке `web/opp` скопируйте `api-config.example.php` → **`api-config.php`** и откройте его
   (правый клик → «Открыть с помощью Text Editor»):
   - `OPP_PG_PASS` — пароль из шага 1.
   - `OPP_ADMINS` — для каждого администратора вставьте **SHA-256 его пароля** вместо `ВСТАВЬТЕ_SHA256_ПАРОЛЯ`.
     Посчитать: https://emn178.github.io/online-tools/sha256.html — вводите пароль, копируете строку из 64 символов.
     Пароль должен быть тот же, которым администратор входит на сайте (латиницей).
4. Сохраните.

**Проверка в локальной сети:** откройте `http://IP-NAS/opp/api.php?action=health`

| Ответ | Что значит |
|---|---|
| `{"ok":true,"db":"postgresql","server":"synology"}` | Всё работает |
| `no_config` | Нет файла `api-config.php` |
| `no_pgsql` | Не включены расширения `pgsql`, `pdo_pgsql` в профиле PHP |
| `db` | Неверный пароль/порт в `api-config.php` или контейнер не запущен |
| Скачивается файл / видно текст `<?php` | Портал не привязан к профилю PHP (шаг 2.3) |

Тест уже можно проходить прямо с NAS: `http://IP-NAS/opp/` — сайт сам найдёт `api.php`.

## 4. Доступ из интернета по HTTPS (нужно, чтобы работал сайт на GitHub)

Сайт `poddon.github.io` открыт по HTTPS, поэтому и NAS должен отвечать по **HTTPS с настоящим сертификатом**.

1. **Панель управления → Внешний доступ → DDNS → Добавить**: поставщик **Synology**,
   имя, например, `opp-test` → получится `opp-test.synology.me`. Отметьте
   «Получить сертификат от Let's Encrypt». ОК.
2. На **роутере** пробросьте порты **443** (и **80** — для продления сертификата) на IP NAS.
   Если NAS в сети колледжа — попросите об этом администратора сети.
3. **Панель управления → Безопасность → Сертификат**: сертификат `opp-test.synology.me` должен быть «по умолчанию».
4. Проверьте с телефона на мобильном интернете: `https://opp-test.synology.me/opp/api.php?action=health`.

## 5. Переключить сайт на Synology

В GitHub откройте `test/synology-config.js` (ветка `gh-pages`) → карандаш «Edit» и впишите адрес:

```js
window.OPP_DB_URL = "https://opp-test.synology.me/opp/api.php";
```

**Commit changes.** Через 1–2 минуты все новые результаты пойдут на NAS.

Чтобы вернуться на Supabase — снова сделайте строку пустой: `window.OPP_DB_URL = "";`.

## Где смотреть данные

- На сайте: вход администратора → таблица, «живое» отслеживание, Excel.
- `statistics.html` — статистика и выгрузки.
- Напрямую в базе: Container Manager → контейнер `opp-db-db-1` → **Терминал** → `psql -U opp opp` →
  `SELECT * FROM quiz_results ORDER BY id DESC;`

| Таблица | Что хранит |
|---|---|
| `quiz_results` | результаты (в том числе «СПИСЫВАНИЕ») |
| `quiz_live` | кто сейчас проходит тест |
| `fio_done`, `fio_grants` | одна попытка на ФИО и разрешения однофамильцам |
| `module_access` | открыт ли тест |

**Резервная копия:** Hyper Backup → папка `docker/opp-db`.

## Важно

- Старые результаты из Supabase сами не переносятся. Перед переключением скачайте их в Excel на `statistics.html`.
- `api-config.php` с паролями **не загружайте на GitHub** (он уже в `.gitignore`).
