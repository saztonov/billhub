-- Миграция: Статус "Согласование ОМТС РП" + поля отслеживания срока ОМТС
-- Предыдущая миграция: нет (первая в папке)

-- 1. Новый статус "Согласование ОМТС РП"
INSERT INTO statuses (entity_type, code, name, color, is_active, display_order, visible_roles)
SELECT
  'payment_request',
  'approv_omts_rp',
  E'Согласование\nОМТС РП',
  'purple',
  true,
  display_order + 1,
  visible_roles
FROM statuses
WHERE entity_type = 'payment_request' AND code = 'approv_omts'
ON CONFLICT (entity_type, code) DO NOTHING;

-- Сдвигаем display_order для статусов после approv_omts (чтобы не было коллизий)
UPDATE statuses
SET display_order = display_order + 1
WHERE entity_type = 'payment_request'
  AND code != 'approv_omts_rp'
  AND display_order > (
    SELECT display_order FROM statuses
    WHERE entity_type = 'payment_request' AND code = 'approv_omts'
  );

-- 2. Новые поля в payment_requests для отслеживания срока ОМТС
ALTER TABLE payment_requests
  ADD COLUMN IF NOT EXISTS omts_entered_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS omts_approved_at timestamp with time zone;

-- 3. Бэкфил omts_entered_at: дата создания первого pending decision на этапе ОМТС
UPDATE payment_requests pr
SET omts_entered_at = sub.entered_at
FROM (
  SELECT
    ad.payment_request_id,
    MIN(ad.created_at) AS entered_at
  FROM approval_decisions ad
  WHERE ad.stage_order = 2
    AND ad.is_omts_rp = false
  GROUP BY ad.payment_request_id
) sub
WHERE pr.id = sub.payment_request_id
  AND pr.omts_entered_at IS NULL;

-- 4. Бэкфил omts_approved_at: дата согласования обычного ОМТС
UPDATE payment_requests pr
SET omts_approved_at = sub.approved_at
FROM (
  SELECT
    ad.payment_request_id,
    ad.decided_at AS approved_at
  FROM approval_decisions ad
  WHERE ad.stage_order = 2
    AND ad.department_id = 'omts'
    AND ad.is_omts_rp = false
    AND ad.status = 'approved'
    AND ad.decided_at IS NOT NULL
) sub
WHERE pr.id = sub.payment_request_id
  AND pr.omts_approved_at IS NULL;
