import type { EditorData } from './types'

export const emojiLimit = 1000

export interface DraftAsset {
  id: string
  file: Blob
  name: string
}
export interface Draft {
  body: EditorData
  assets: DraftAsset[]
  metadata: Record<string, unknown>
}
let database: Promise<IDBDatabase> | undefined
function open() {
  return (database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('winui-bbs-drafts', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('drafts')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error('无法打开浏览器草稿存储'))
  }))
}
export async function readDraft(key: string): Promise<Draft | undefined> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const request = db.transaction('drafts').objectStore('drafts').get(key)
    request.onsuccess = () => resolve(request.result as Draft | undefined)
    request.onerror = () => reject(new Error('无法读取浏览器草稿'))
  })
}
export async function writeDraft(key: string, value?: Draft) {
  const db = await open()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('drafts', 'readwrite')
    const store = tx.objectStore('drafts')
    if (value) store.put(value, key)
    else store.delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(new Error('浏览器草稿保存失败，请检查可用空间'))
    tx.onabort = () => reject(new Error('浏览器草稿保存失败'))
  })
}

export function contentSize(body: EditorData) {
  let inlineEmojis = 0
  function count(value: unknown, key = ''): number {
    if (typeof value === 'string') {
      if (!['text', 'content', 'caption', 'code', ''].includes(key)) return 0
      if (key === 'code') return Array.from(value).length
      const element = document.createElement('div')
      element.innerHTML = value
      inlineEmojis += element.querySelectorAll('img').length
      return Array.from(element.textContent || '').length
    }
    if (Array.isArray(value)) return value.reduce((sum, item) => sum + count(item), 0)
    if (value && typeof value === 'object')
      return Object.entries(value).reduce((sum, [k, v]) => sum + count(v, k), 0)
    return 0
  }
  return {
    characters: body.blocks.reduce((sum, b) => sum + count(b.data), 0),
    images: body.blocks.filter((b) => b.type === 'image').length,
    emojis: body.blocks.filter((b) => b.type === 'emoji').length + inlineEmojis,
  }
}
