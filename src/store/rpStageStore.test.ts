import { describe, it, expect, beforeEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw-server'
import { useRpStageStore } from './rpStageStore'

const BASE = '' // VITE_API_URL не задан в тестах → '' (relative)

/**
 * Тесты стора этапа «РП».
 * Фиксируют контракт с backend: назначения приходят как { id, userId, userFullName,
 * userEmail, userDepartment, siteId, siteName }; добавление — POST /api/rp-stage/assignees
 * с { siteId, userId }; удаление — DELETE /api/rp-stage/assignees/:id;
 * свои объекты — GET /api/rp-stage/my → { siteIds }.
 */
describe('rpStageStore', () => {
  beforeEach(() => {
    useRpStageStore.setState({
      assignees: [],
      candidates: [],
      mySiteIds: [],
      myLoaded: false,
      isLoading: false,
      error: null,
    })
  })

  it('fetchAssignees сохраняет назначения', async () => {
    server.use(
      http.get(`${BASE}/api/rp-stage/assignees`, () =>
        HttpResponse.json([
          {
            id: 'a-1',
            userId: 'u-1',
            userFullName: 'Иванов Иван',
            userEmail: 'ivanov@example.com',
            userDepartment: 'shtab',
            siteId: 'site-1',
            siteName: 'Объект А',
          },
        ]),
      ),
    )

    await useRpStageStore.getState().fetchAssignees()
    const s = useRpStageStore.getState()

    expect(s.assignees).toEqual([
      {
        id: 'a-1',
        userId: 'u-1',
        userFullName: 'Иванов Иван',
        userEmail: 'ivanov@example.com',
        userDepartment: 'shtab',
        siteId: 'site-1',
        siteName: 'Объект А',
      },
    ])
    expect(s.isLoading).toBe(false)
    expect(s.error).toBeNull()
  })

  it('addAssignee отправляет POST с { siteId, userId } и перезапрашивает список', async () => {
    let postBody: unknown = null
    server.use(
      http.post(`${BASE}/api/rp-stage/assignees`, async ({ request }) => {
        postBody = await request.json()
        return HttpResponse.json({ success: true }, { status: 201 })
      }),
      http.get(`${BASE}/api/rp-stage/assignees`, () => HttpResponse.json([])),
    )

    await useRpStageStore.getState().addAssignee('site-1', 'u-1')

    expect(postBody).toEqual({ siteId: 'site-1', userId: 'u-1' })
  })

  it('addAssignee пробрасывает ошибку конфликта (объект занят)', async () => {
    server.use(
      http.post(`${BASE}/api/rp-stage/assignees`, () =>
        HttpResponse.json({ error: 'На объект уже назначен сотрудник РП' }, { status: 409 }),
      ),
    )

    await expect(useRpStageStore.getState().addAssignee('site-1', 'u-1')).rejects.toThrow()
    expect(useRpStageStore.getState().error).toBeTruthy()
  })

  it('removeAssignee отправляет DELETE по id назначения', async () => {
    let deletedUrl: string | null = null
    server.use(
      http.delete(`${BASE}/api/rp-stage/assignees/:id`, ({ request }) => {
        deletedUrl = new URL(request.url).pathname
        return HttpResponse.json({ success: true })
      }),
      http.get(`${BASE}/api/rp-stage/assignees`, () => HttpResponse.json([])),
    )

    await useRpStageStore.getState().removeAssignee('a-2')

    expect(deletedUrl).toBe('/api/rp-stage/assignees/a-2')
  })

  it('fetchMy сохраняет siteIds и выставляет myLoaded', async () => {
    server.use(
      http.get(`${BASE}/api/rp-stage/my`, () =>
        HttpResponse.json({ siteIds: ['site-1', 'site-3'] }),
      ),
    )

    await useRpStageStore.getState().fetchMy()
    const s = useRpStageStore.getState()

    expect(s.mySiteIds).toEqual(['site-1', 'site-3'])
    expect(s.myLoaded).toBe(true)
    expect(s.isAssigneeOf('site-1')).toBe(true)
    expect(s.isAssigneeOf('site-2')).toBe(false)
  })
})
