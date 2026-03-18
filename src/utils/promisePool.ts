/** Выполняет массив задач с ограничением параллельности, возвращает результаты в исходном порядке */
export async function promisePool<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length)
  let nextIndex = 0

  async function runWorker(): Promise<void> {
    while (nextIndex < tasks.length) {
      const idx = nextIndex++
      results[idx] = await tasks[idx]()
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    () => runWorker(),
  )

  await Promise.all(workers)
  return results
}
