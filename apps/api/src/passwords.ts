import { availableParallelism } from 'node:os'
import { createRequire } from 'node:module'
import { Worker } from 'node:worker_threads'
import { createHash } from 'node:crypto'

type Job = {
  operation: 'hash' | 'compare'
  password: string
  value: number | string
  resolve: (value: string | boolean) => void
  reject: (error: Error) => void
}
type Slot = { worker: Worker; job?: Job }
const slots = new Set<Slot>()
const queue: Job[] = []
const workerLimit = Math.min(2, availableParallelism())
const bcryptPath = createRequire(import.meta.url).resolve('bcryptjs')
const passwordPrefix = '$forum-sha256$v1$'
const digest = (password: string) => createHash('sha256').update(password, 'utf8').digest('base64')

// Keep the existing bcrypt implementation and hash format off the request thread.
const workerSource = `
  const { parentPort, workerData } = require('node:worker_threads');
  const bcrypt = require(workerData);
  parentPort.on('message', ({ operation, password, value }) => {
    try {
      parentPort.postMessage({ result: operation === 'hash'
        ? bcrypt.hashSync(password, value) : bcrypt.compareSync(password, value) });
    } catch (error) {
      parentPort.postMessage({ error: error.message });
    }
  });
`

function drain() {
  while (queue.length) {
    let slot = [...slots].find((slot) => !slot.job)
    if (!slot) {
      if (slots.size >= workerLimit) return
      slot = {
        worker: new Worker(workerSource, {
          eval: true,
          workerData: bcryptPath,
        }),
      }
      const current = slot
      slots.add(current)
      current.worker.on('message', (message: { result: string | boolean; error?: string }) => {
        const job = current.job!
        current.job = undefined
        current.worker.unref()
        if (message.error) job.reject(new Error(message.error))
        else job.resolve(message.result)
        drain()
      })
      const failed = (error: Error) => {
        if (!slots.delete(current)) return
        current.job?.reject(error)
        drain()
      }
      current.worker.on('error', failed)
      current.worker.on('exit', (code) => failed(new Error(`Password worker exited (${code})`)))
    }
    slot.job = queue.shift()!
    slot.worker.ref()
    const { operation, password, value } = slot.job
    slot.worker.postMessage({ operation, password, value })
  }
}

function run(operation: Job['operation'], password: string, value: number | string) {
  if (queue.length >= 64)
    return Promise.reject(Object.assign(new Error('密码服务繁忙，请稍后重试'), { statusCode: 503 }))
  return new Promise<string | boolean>((resolve, reject) => {
    queue.push({ operation, password, value, resolve, reject })
    drain()
  })
}

export async function closePasswordWorkers() {
  const error = new Error('Password service closed')
  for (const job of queue.splice(0)) job.reject(error)
  const workers = [...slots]
  slots.clear()
  await Promise.all(
    workers.map(({ worker, job }) => {
      job?.reject(error)
      return worker.terminate()
    }),
  )
}

export default {
  // Mark prehashed passwords so legacy bcrypt accounts retain their original verification.
  hash: async (password: string, cost: number) => passwordPrefix + await run('hash', digest(password), cost),
  compare: (password: string, hash: string) => hash.startsWith(passwordPrefix)
    ? run('compare', digest(password), hash.slice(passwordPrefix.length)) as Promise<boolean>
    : run('compare', password, hash) as Promise<boolean>,
}
