# Login-тема Keycloak «billhub»

Брендированная страница входа BillHub (дизайн `temp/design/08-su10-light-hero.png` /
`07-su10-dark.png`): hero-колонка СУ_10 «Портал для согласования поставок» слева, карточка
формы справа, переключатель light/dark в правом верхнем углу. Реальный вход/SSO — на
`auth.su10.ru` (BFF/OIDC), поэтому форма живёт в Keycloak, а не в React-SPA.

## Структура

```
login/
  theme.properties            # parent=keycloak.v2, styles=css/styles.css, scripts=js/theme.js
  resources/css/styles.css    # брендинг + light/dark (CSS-переменные, [data-theme])
  resources/js/theme.js       # инжект hero-колонки и тумблера темы (без правки FreeMarker)
```

Тема построена на CSS+JS поверх базовой `keycloak.v2` — **без переопределения FreeMarker**,
поэтому не может «сломать» поток входа и устойчива к смене версии Keycloak. Тумблер темы
хранит выбор в `localStorage`, дефолт — системная (`prefers-color-scheme`).

## Деплой (общий Keycloak контура su10)

1. Скопировать каталог темы на хост Keycloak:
   `/opt/keycloak/themes/billhub/` (том или запечь в оптимизированный образ, см.
   `EstiMat/deploy/infra-keycloak/README.md`, §19).
2. Перезапуск Keycloak (при запечённом образе — пересборка `kc.sh build` + `up -d`).
3. В админ-консоли: клиент `billhub` → Advanced/Login settings → **Login theme = billhub**.

## Проверка (ОБЯЗАТЕЛЬНО на тестовом realm до su10)

Точную посадку карточки и совместимость CSS-селекторов с фактической версией `keycloak.v2`
(KC 26.1) проверить на тестовом realm (rollout в `docs/keycloak-billhub.md`). При смещении
карточки/полей — донастроить селекторы в `resources/css/styles.css` (там оставлены
fallback-селекторы `pf-v5-*`/`pf-c-*`/`#kc-*`).
