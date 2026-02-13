-- Миграция 004: подсчёт страниц PDF-файлов

ALTER TABLE payment_request_files ADD COLUMN page_count integer NULL;
