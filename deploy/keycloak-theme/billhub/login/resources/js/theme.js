/*
 * BillHub login-тема: инжект hero-колонки (СУ_10 + «Портал для согласования поставок»)
 * и переключателя light/dark (правый верхний угол). Тему храним в localStorage; дефолт —
 * системная (prefers-color-scheme). Тема применяется через data-theme на <html>.
 *
 * Скрипт добавляется через theme.properties (scripts=js/theme.js) и не трогает FreeMarker —
 * поэтому не может сломать поток входа.
 */
;(function () {
  'use strict'

  var STORAGE_KEY = 'billhub-theme'
  var root = document.documentElement

  function systemTheme() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
  }

  function stored() {
    try {
      return localStorage.getItem(STORAGE_KEY)
    } catch (e) {
      return null
    }
  }

  function apply(theme) {
    root.setAttribute('data-theme', theme)
    var btn = document.querySelector('.billhub-theme-toggle')
    if (btn) {
      btn.textContent = theme === 'dark' ? '☀' : '☾' // ☀ / ☾
      btn.setAttribute('aria-label', theme === 'dark' ? 'Светлая тема' : 'Тёмная тема')
    }
  }

  function setTheme(theme) {
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch (e) {
      /* ignore */
    }
    apply(theme)
  }

  // Ранняя установка темы (до отрисовки), чтобы не мигало.
  apply(stored() || systemTheme())

  function injectHero() {
    if (document.querySelector('.billhub-hero')) return
    var hero = document.createElement('div')
    hero.className = 'billhub-hero'
    hero.innerHTML =
      '<div>' +
      '<div class="billhub-hero__logo">СУ_10</div>' +
      '<div class="billhub-hero__tag">Генеральный подрядчик</div>' +
      '</div>' +
      '<div class="billhub-hero__title">Портал для согласования поставок</div>'
    document.body.appendChild(hero)
  }

  function injectToggle() {
    if (document.querySelector('.billhub-theme-toggle')) return
    var btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'billhub-theme-toggle'
    btn.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'
      setTheme(next)
    })
    document.body.appendChild(btn)
    apply(root.getAttribute('data-theme') || systemTheme())
  }

  function init() {
    injectHero()
    injectToggle()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
