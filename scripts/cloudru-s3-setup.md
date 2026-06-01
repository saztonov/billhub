# Runbook: Cloud.ru S3 для BillHub (Этап 1, Iteration 8)

Операторский runbook создания S3-бакета `billhub-s3` в Cloud.ru Object Storage с allowlist на
статический IP VPS. Cloud.ru предоставляет S3-совместимый API (`@aws-sdk/client-s3`, presigned URL).

> **Принцип 1:** старый прод (Cloudflare R2) НЕ модифицируется. Этот бакет — новая инфраструктура.
> Реальная миграция файлов R2 → Cloud.ru (rclone, manifest-verify) — Iteration 9, не здесь.

Связанные документы:

- [docs/adr/0004-cutover-files-strategy.md](../docs/adr/0004-cutover-files-strategy.md) — стратегия cutover файлов.
- [.env.production.example](../.env.production.example) — S3-переменные.

---

## 1. Предпосылки

- Учётная запись Cloud.ru с доступом к Object Storage.
- `aws-cli` v2 на операторской машине (или на VPS).
- Статический публичный IP VPS: `NEW_VPS_IP`.

Профиль aws-cli для Cloud.ru (ключи — из Cloud.ru Console → Service accounts → Access keys):

```bash
aws configure set aws_access_key_id     "$S3_ACCESS_KEY" --profile cloudru
aws configure set aws_secret_access_key "$S3_SECRET_KEY" --profile cloudru
aws configure set region                ru-msk           --profile cloudru
export AWS_PROFILE=cloudru
ENDPOINT=https://s3.cloud.ru
```

---

## 2. Создание бакета

```bash
aws --endpoint-url "$ENDPOINT" s3api create-bucket --bucket billhub-s3

# Версионирование (защита от случайного перезаписывания/удаления ключей файлов).
aws --endpoint-url "$ENDPOINT" s3api put-bucket-versioning \
  --bucket billhub-s3 --versioning-configuration Status=Enabled

# Приватный доступ: публичного листинга/чтения быть не должно (файлы отдаются presigned URL).
aws --endpoint-url "$ENDPOINT" s3api put-public-access-block \
  --bucket billhub-s3 --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

Единственный бакет; файлы раскладываются по папкам контрагентов (см. `buildFileKey()` в
`server/src/routes/files.ts`). Префиксы ключей: `{counterparty}/`, `approval-decisions/`,
`{counterparty}/payment/`, `{counterparty}/contract/`, `founding-docs/`.

---

## 3. Allowlist (bucket policy по IP)

Ограничить доступ только статическим IP VPS. Политика запрещает любые операции, если
`aws:SourceIp` не входит в allowlist (исключение — операции под владельцем бакета).

```bash
cat > /tmp/billhub-s3-policy.json <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowOnlyFromVpsIp",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": [
        "arn:aws:s3:::billhub-s3",
        "arn:aws:s3:::billhub-s3/*"
      ],
      "Condition": {
        "NotIpAddress": { "aws:SourceIp": ["NEW_VPS_IP/32"] }
      }
    }
  ]
}
JSON
# Заменить NEW_VPS_IP на реальный статический IP VPS ПЕРЕД применением.
sed -i "s/NEW_VPS_IP/<реальный_ip>/" /tmp/billhub-s3-policy.json

aws --endpoint-url "$ENDPOINT" s3api put-bucket-policy \
  --bucket billhub-s3 --policy file:///tmp/billhub-s3-policy.json
```

> Если Cloud.ru не поддерживает `aws:SourceIp` в bucket policy — использовать сетевой allowlist
> на уровне проекта/сервисного аккаунта Cloud.ru Console. `OLD_VPS_IP` НЕ добавляется.

---

## 4. Тестовая загрузка/скачивание/удаление (проверка с VPS)

Выполнять **с VPS** (с того IP, что в allowlist):

```bash
echo "billhub s3 smoke $(date -u +%FT%TZ)" > /tmp/s3-smoke.txt

# PUT
aws --endpoint-url "$ENDPOINT" s3 cp /tmp/s3-smoke.txt s3://billhub-s3/_healthcheck/s3-smoke.txt
# HEAD bucket (то же, что делает /api/health/ready)
aws --endpoint-url "$ENDPOINT" s3api head-bucket --bucket billhub-s3 && echo "HEAD bucket OK"
# GET
aws --endpoint-url "$ENDPOINT" s3 cp s3://billhub-s3/_healthcheck/s3-smoke.txt /tmp/s3-smoke-back.txt
diff /tmp/s3-smoke.txt /tmp/s3-smoke-back.txt && echo "round-trip OK"
# presigned URL (15 мин) — проверка, что выдаётся валидная ссылка
aws --endpoint-url "$ENDPOINT" s3 presign s3://billhub-s3/_healthcheck/s3-smoke.txt --expires-in 900
# DELETE (чистка)
aws --endpoint-url "$ENDPOINT" s3 rm s3://billhub-s3/_healthcheck/s3-smoke.txt
```

Проверка из **другого** IP (не VPS) должна получать `403 AccessDenied` — подтверждение allowlist.

---

## 5. Переменные окружения backend

В `.env` на VPS (см. [.env.production.example](../.env.production.example)):

```
STORAGE_PROVIDER=cloudru
S3_ENDPOINT=https://s3.cloud.ru
S3_REGION=ru-msk
S3_ACCESS_KEY=<из Cloud.ru>
S3_SECRET_KEY=<из Cloud.ru>
S3_BUCKET=billhub-s3
```

`/api/health/ready` выполняет `HeadBucketCommand` (cached 30s) — после настройки бакета и allowlist
проба должна проходить, иначе backend в production не пройдёт startup-checks/ready.

---

## 6. Чек-лист (Operator Gate)

- [ ] Бакет `billhub-s3` создан, версионирование включено, public access заблокирован.
- [ ] Bucket policy / сетевой allowlist: доступ только с `NEW_VPS_IP/32`.
- [ ] Тестовый round-trip (PUT/GET/HEAD/presign/DELETE) с VPS — зелёный.
- [ ] Доступ с постороннего IP — `403`.
- [ ] S3-переменные прописаны в `.env` (права 600).
