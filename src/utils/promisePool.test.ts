import { describe, it, expect, vi } from 'vitest'
import { promisePool } from './promisePool'

describe('promisePool', () => {
  it('возвращает результаты в исходном порядке', async () => {
    const tasks = [() => Promise.resolve(1), () => Promise.resolve(2), () => Promise.resolve(3)]
    const result = await promisePool(tasks, 2)
    expect(result).toEqual([1, 2, 3])
  })

  it('пустой массив задач возвращает пустой результат', async () => {
    const result = await promisePool<number>([], 4)
    expect(result).toEqual([])
  })

  it('concurrency=1 = последовательное выполнение', async () => {
    const order: number[] = []
    const tasks = [1, 2, 3].map((i) => async () => {
      await new Promise((r) => setTimeout(r, 5))
      order.push(i)
      return i
    })
    const result = await promisePool(tasks, 1)
    expect(result).toEqual([1, 2, 3])
    expect(order).toEqual([1, 2, 3])
  })

  it('concurrency > tasks.length работает корректно', async () => {
    const tasks = [() => Promise.resolve('a'), () => Promise.resolve('b')]
    const result = await promisePool(tasks, 10)
    expect(result).toEqual(['a', 'b'])
  })

  it('ограничивает реальный параллелизм заданным concurrency', async () => {
    let active = 0
    let maxActive = 0
    const tasks = Array.from({ length: 10 }, (_, i) => async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((r) => setTimeout(r, 10))
      active--
      return i
    })
    await promisePool(tasks, 3)
    expect(maxActive).toBeLessThanOrEqual(3)
  })

  it('пробрасывает первую же ошибку', async () => {
    const error = new Error('boom')
    const tasks = [() => Promise.resolve(1), () => Promise.reject(error), () => Promise.resolve(3)]
    await expect(promisePool(tasks, 2)).rejects.toThrow('boom')
  })

  it('каждая задача вызывается ровно один раз', async () => {
    const fn = vi.fn(() => Promise.resolve(42))
    const tasks = [fn, fn, fn]
    await promisePool(tasks, 2)
    expect(fn).toHaveBeenCalledTimes(3)
  })
})
