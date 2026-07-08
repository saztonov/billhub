-- Миграция 0016: независимый этап согласования «РП» (stage 3) вместо под-этапа «ОМТС РП».
--
-- Контекст:
--   Ранее «ОМТС РП» — под-этап ОМТС: одно глобальное ответственное лицо (settings.omts_rp_config)
--   дополнительно согласовывало заявки по объектам из settings.omts_rp_sites (approval_decisions
--   с stage_order=2, department_id='omts', is_omts_rp=true; current_stage оставался 2).
--   Теперь РП — отдельный этап 3 (department_id='rp', значение добавлено миграцией 0015)
--   с назначениями «объект -> сотрудник» в таблице rp_stage_assignees (один сотрудник на объект).
--
-- Без top-level BEGIN/COMMIT — runner оборачивает миграцию в транзакцию (ADR-0002).
-- Идемпотентность: IF NOT EXISTS / ON CONFLICT / условия в WHERE.

-- 1. Таблица назначений этапа РП
CREATE TABLE IF NOT EXISTS public.rp_stage_assignees (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    construction_site_id uuid NOT NULL UNIQUE
        REFERENCES public.construction_sites(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.rp_stage_assignees IS 'Назначения этапа согласования «РП»: строго один сотрудник на объект строительства (UNIQUE по объекту)';

CREATE INDEX IF NOT EXISTS idx_rp_stage_assignees_user ON public.rp_stage_assignees (user_id);

-- 2. Перенос текущих настроек: ответственный (omts_rp_config) назначается на каждый объект
--    из списка двойного согласования (omts_rp_sites); битые ссылки отфильтровываются.
INSERT INTO public.rp_stage_assignees (construction_site_id, user_id)
SELECT sid::uuid, (c.value->>'responsible_user_id')::uuid
FROM public.settings c
JOIN public.settings s ON s.key = 'omts_rp_sites'
CROSS JOIN LATERAL jsonb_array_elements_text(s.value->'site_ids') AS sid
WHERE c.key = 'omts_rp_config'
  AND c.value->>'responsible_user_id' IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = (c.value->>'responsible_user_id')::uuid)
  AND EXISTS (SELECT 1 FROM public.construction_sites cs WHERE cs.id = sid::uuid)
ON CONFLICT (construction_site_id) DO NOTHING;

-- 3. Статус approv_omts_rp -> approv_rp: переименование in-place, id строки не меняется,
--    поэтому payment_requests.status_id и previous_status_id (заявки на доработке с этапа РП)
--    остаются валидными; visible_roles/цвет/порядок наследуются.
UPDATE public.statuses
SET code = 'approv_rp', name = 'На согласовании РП'
WHERE entity_type = 'payment_request' AND code = 'approv_omts_rp';

-- 4. Конвертация висящих pending-решений под-этапа «ОМТС РП» в этап 3 «РП».
--    Сброс is_omts_rp — чтобы активное решение отображалось как «РП»; approved/rejected
--    историю не трогаем (легаси-записи продолжают отображаться как «ОМТС РП»).
UPDATE public.approval_decisions
SET stage_order = 3, department_id = 'rp', is_omts_rp = false
WHERE status = 'pending' AND is_omts_rp = true;

-- 5. Текущая стадия заявок с pending-решением этапа РП: 2 -> 3. Без этого шага матчинг решения
--    по current_stage не найдёт pending и заявка «залипнет» (класс проблемы миграции 0014).
--    Покрывает и заявки на доработке: их pending также конвертирован шагом 4.
UPDATE public.payment_requests pr
SET current_stage = 3
WHERE pr.current_stage = 2
  AND EXISTS (
      SELECT 1 FROM public.approval_decisions ad
      WHERE ad.payment_request_id = pr.id
        AND ad.status = 'pending'
        AND ad.department_id = 'rp'
  );

-- Settings-ключи omts_rp_config/omts_rp_sites намеренно НЕ удаляются (deprecated, страховка
-- при откате кода); удаление — отдельной cleanup-миграцией после стабилизации релиза.
