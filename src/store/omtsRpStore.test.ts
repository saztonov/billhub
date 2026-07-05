import { describe, it, expect, beforeEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw-server'
import { useOmtsRpStore } from './omtsRpStore'

const BASE = '' // VITE_API_URL не задан в тестах → '' (relative)

/**
 * Тесты стора ОМТС РП.
 * Фиксируют контракт с backend: список объектов приходит как { id, name },
 * а изменение списка выполняется через PUT /api/omts-rp/sites с { action, siteId }.
 */
describe('omtsRpStore', () => {
  beforeEach(() => {
    useOmtsRpStore.setState({
      sites: [],
      responsibleUserId: null,
      omtsUsers: [],
      isLoading: false,
      error: null,
    })
  })

  it('fetchSites сохраняет объекты в форме { id, name }', async () => {
    server.use(
      http.get(`${BASE}/api/omts-rp/sites`, () =>
        HttpResponse.json([
          { id: 'site-1', name: 'Объект А' },
          { id: 'site-2', name: 'Объект Б' },
        ]),
      ),
    )

    await useOmtsRpStore.getState().fetchSites()
    const s = useOmtsRpStore.getState()

    expect(s.sites).toEqual([
      { id: 'site-1', name: 'Объект А' },
      { id: 'site-2', name: 'Объект Б' },
    ])
    expect(s.isLoading).toBe(false)
    expect(s.error).toBeNull()
  })

  it('addSite отправляет PUT с { action: "add", siteId }', async () => {
    let putBody: unknown = null
    server.use(
      http.put(`${BASE}/api/omts-rp/sites`, async ({ request }) => {
        putBody = await request.json()
        return HttpResponse.json({ success: true })
      }),
      // addSite после PUT перезапрашивает список
      http.get(`${BASE}/api/omts-rp/sites`, () => HttpResponse.json([])),
    )

    await useOmtsRpStore.getState().addSite('site-1')

    expect(putBody).toEqual({ action: 'add', siteId: 'site-1' })
  })

  it('removeSite отправляет PUT с { action: "remove", siteId }', async () => {
    let putBody: unknown = null
    server.use(
      http.put(`${BASE}/api/omts-rp/sites`, async ({ request }) => {
        putBody = await request.json()
        return HttpResponse.json({ success: true })
      }),
      // removeSite после PUT перезапрашивает список
      http.get(`${BASE}/api/omts-rp/sites`, () => HttpResponse.json([])),
    )

    await useOmtsRpStore.getState().removeSite('site-2')

    expect(putBody).toEqual({ action: 'remove', siteId: 'site-2' })
  })
})
