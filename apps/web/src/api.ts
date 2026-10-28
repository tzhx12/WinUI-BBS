export interface ApiOptions {
  method?: string
  token?: string | null
  body?: unknown
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers = new Headers()
  if (options.token) headers.set('Authorization', `Bearer ${options.token}`)

  let body: BodyInit | undefined
  if (options.body instanceof FormData) {
    body = options.body
  } else if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify(options.body)
  }

  const response = await fetch(path, { method: options.method, headers, body })
  const payload = (await response.json().catch(() => ({}))) as { error?: string; message?: string }
  if (!response.ok) throw new ApiError(payload.message ?? payload.error ?? `请求失败 (${response.status})`, response.status)
  return payload as T
}

export function uploadForm(file: File) {
  const form = new FormData()
  form.append('file', file)
  return form
}
