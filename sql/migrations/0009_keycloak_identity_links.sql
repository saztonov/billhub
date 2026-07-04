-- Миграция 0009: связь идентичностей Keycloak с пользователями BillHub (OIDC, BFF).
--
-- Контекст: аутентификация переводится на корпоративный Keycloak (realm su10) по
-- redirect-потоку (Authorization Code + PKCE), паттерн BFF. Идентичность из Keycloak
-- резолвится в стабильный внутренний public.users.id через таблицу связей — так users.id
-- (и ~29 FK на него + вся история) остаётся неизменным, а subject Keycloak может меняться
-- (напр. при переходе на AD-федерацию появится новый provider/subject для того же users.id).
--
-- Ключ steady-state — (provider, subject). email_at_link — снимок email на момент привязки:
-- устойчивый якорь для однократной email-привязки (первый вход) и для сверки/диагностики,
-- НЕ уникален. provider: 'keycloak-local' сейчас; 'keycloak-ad' при подключении AD.
--
-- Доступ к порталу моделируется группами Keycloak (billhub-pending/billhub-active), роль и
-- контрагент — в public.users; эта таблица отвечает только за маппинг subject -> users.id.
--
-- Без top-level BEGIN/COMMIT — runner оборачивает миграцию в транзакцию (ADR-0002).
-- Идемпотентность — через IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS public.user_identity_links (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider      text NOT NULL,
  subject       text NOT NULL,
  email_at_link text,
  linked_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz
);

-- Рабочий ключ steady-state: одна идентичность провайдера — один пользователь.
CREATE UNIQUE INDEX IF NOT EXISTS uidx_user_identity_links_provider_subject
  ON public.user_identity_links (provider, subject);

CREATE INDEX IF NOT EXISTS idx_user_identity_links_user_id
  ON public.user_identity_links (user_id);

-- Для one-time email-привязки и сверки (email_at_link не уникален — это снимок).
CREATE INDEX IF NOT EXISTS idx_user_identity_links_email_lower
  ON public.user_identity_links (lower(email_at_link));
