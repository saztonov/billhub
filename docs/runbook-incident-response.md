# Runbook — реагирование на инциденты (post-cutover)

Действия incident-команды при срабатывании алерта в первые 24 часа и далее (план Iteration 10,
«Post-cutover»). Источник алертов — `scripts/post-cutover/24h-monitoring.sh` (пороги = мониторы
Iteration 7, `server/src/services/observability/monitors.ts`) + external uptime monitoring.

**Контакты команды:** см. [migration-inventory.md §10](migration-inventory.md). Канал инцидента — там же.

## Общий алгоритм

1. **Зафиксировать** время и текст алерта (в канал инцидента).
2. **Классифицировать** severity (таблица ниже).
3. **Диагностировать** по соответствующему разделу.
4. **Решение fix-forward vs rollback** — по критериям [ADR-0006](adr/0006-rollback-procedure.md)
   (см. также [runbook-rollback.md](runbook-rollback.md)).
5. **Эскалация** при необходимости (DBA / Yandex Cloud support / Cloud.ru support — §10 инвентаря).
6. **Пост-фактум** — запись в журнал инцидентов, при необходимости — в week-1-report.

## Severity и реакция

| Severity | Признак | Реакция |
|---|---|---|
| SEV-1 (критично) | портал недоступен; нельзя создать/согласовать заявку; OCR стоит; утечка ПДн | немедленно вся команда; кандидат на rollback (ADR-0006) |
| SEV-2 (высокий) | деградация p95; рост 5xx <5%; dead jobs; алерт conn>80% | диагностика, fix-forward; rollback если не купируется 30+ мин |
| SEV-3 (средний) | шум в логах, медленный отдельный endpoint, единичные 5xx | fix-forward в рабочем порядке |

## Плейбуки по алертам

### uptime: /health/live или /health/ready != 200
- `/health/live` != 200 → процесс упал/недоступен. Проверить `docker compose ps`, логи backend,
  перезапустить контейнер. Если не поднимается — **SEV-1**, кандидат на rollback.
- `/health/ready` != 200 → деградация зависимости. Тело ответа показывает, что именно (`database`/
  `migrations`/`redis`/`s3`). Перейти в соответствующий плейбук ниже.

### db conn high (> 80% conn_limit, > 24 из 30)
- Проверить `SELECT count(*),state FROM pg_stat_activity WHERE usename='billhub_runtime' GROUP BY state`.
- Idle-in-transaction → утечка пула; перезапустить worker/backend. Лавина соединений → проверить нагрузку,
  не выросло ли число процессов. Связано с ADR-0005 connection budget (pool.max=10×2+reserve).
- Эскалация DBA, если приближается к hard-лимиту кластера.

### dead jobs detected (> 0 за час)
- `SELECT id,type,attempts,last_error FROM jobs_log WHERE status='dead' AND created_at>now()-interval '1 hour'`.
- OCR dead → проверить OpenRouter доступность/ключ, watchdog. File-processing dead → проверить S3/Redis.
- Переотправить задачи после устранения причины; зафиксировать корневую причину.

### s3 error-rate high (> 5%/мин) / monitor-алерт в audit_log
- `SELECT * FROM audit_log WHERE event_type='s3_error_rate_high' ORDER BY created_at DESC LIMIT 5`.
- Проверить доступность Cloud.ru S3 (HEAD bucket), credentials, allowlist IP новой VPS, throttling.
- Эскалация Cloud.ru support при стороннем сбое.

### error_logs spike (> порога за окно)
- `SELECT message,count(*) FROM error_logs WHERE created_at>now()-interval '30 minutes' GROUP BY message ORDER BY 2 DESC`.
- Сгруппировать по типу; отделить шум от регрессии. Регрессия в бизнес-флоу (approvals/OCR/files) →
  кандидат на rollback при блокировке бизнеса.

### retention: партиция audit_log текущего месяца отсутствует
- Проверить BullMQ recurring job `retention` (`plugins/maintenance.ts`, 03:00). Запустить обслуживание
  партиций вручную; убедиться, что создаётся партиция следующего месяца. SEV-3 (не блокирует бизнес).

## Когда инициировать rollback

Любой из критериев [ADR-0006](adr/0006-rollback-procedure.md):
- критичная функциональная регрессия (нельзя создать заявку / согласовать / OCR стоит);
- утечка данных (ПДн в логах/Sentry; чужие файлы видны);
- p95 > 5 с в течение 30+ мин при нормальной нагрузке;
- «database unreachable» 30+ мин без видимой причины.

Не-критичные проблемы — **fix-forward** (rollback — крайняя мера, особенно Сценарий C). Процедура —
[runbook-rollback.md](runbook-rollback.md).

## Связанные документы

- [runbook-rollback.md](runbook-rollback.md) · [ADR-0006](adr/0006-rollback-procedure.md) · [ADR-0005](adr/0005-rpo-rto.md)
- [migration-cutover.md](migration-cutover.md) · [migration-inventory.md](migration-inventory.md) (контакты §10)
- `scripts/post-cutover/24h-monitoring.sh`, `scripts/post-cutover/week-1-report.sh`
