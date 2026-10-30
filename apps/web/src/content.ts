import DOMPurify from 'dompurify'
import type { EditorData } from './types'

export function remoteEmojiHtml(emoji: { id: string; url: string; name: string }) {
  const image = document.createElement('img')
  image.src = emoji.url
  image.alt = emoji.name
  image.title = emoji.name
  image.dataset.remoteEmoji = emoji.id
  return image.outerHTML
}

export function inlineRemoteEmojiBlocks(body: EditorData) {
  const blocks: EditorData['blocks'] = []
  for (const block of body.blocks) {
    if (block.type !== 'emoji' || !block.data.remote || !block.data.emojiId) {
      blocks.push({ ...block, data: { ...block.data } })
      continue
    }
    const image = remoteEmojiHtml({
      id: String(block.data.emojiId),
      url: String(block.data.url),
      name: String(block.data.name ?? ''),
    })
    const previous = blocks[blocks.length - 1]
    if (previous?.type === 'paragraph') previous.data.text = String(previous.data.text || '') + image
    else blocks.push({ ...block, type: 'paragraph', data: { text: image } })
  }
  return { ...body, blocks }
}

export interface ListItem {
  content?: string
  text?: string
  items?: Array<ListItem | string>
  meta?: { checked?: boolean }
}

function inlineFragment(value: unknown) {
  return DOMPurify.sanitize(String(value ?? ''), {
    ALLOWED_TAGS: [
      'b',
      'strong',
      'i',
      'em',
      'a',
      'code',
      'mark',
      'span',
      'br',
      'u',
      's',
      'sub',
      'sup',
      'img',
    ],
    ALLOWED_ATTR: [
      'href',
      'target',
      'rel',
      'class',
      'data-spoiler',
      'src',
      'alt',
      'title',
      'data-remote-emoji',
      'data-content-lock',
      'data-lock-state',
    ],
    RETURN_DOM_FRAGMENT: true,
  })
}

export function inlineHtml(value: unknown) {
  const fragment = inlineFragment(value)
  fragment.querySelectorAll('img').forEach((image) => {
    if (
      !image.hasAttribute('data-remote-emoji') ||
      !/^\/uploads\/[^/]+$/.test(image.getAttribute('src') || '')
    ) {
      image.remove()
      return
    }
    image.className = 'remote-inline-emoji'
    image.loading = 'lazy'
    image.title = image.alt
  })
  fragment.querySelectorAll('[data-spoiler]').forEach((element) => {
    element.setAttribute('tabindex', '0')
    element.setAttribute('role', 'button')
    element.setAttribute('aria-label', '显示剧透文字')
    element.setAttribute('aria-expanded', 'false')
  })
  fragment.querySelectorAll('[data-lock-state="locked"]').forEach((element) => {
    element.setAttribute('tabindex', '0')
    element.setAttribute('role', 'button')
    element.setAttribute('aria-label', element.textContent || '内容已锁定')
  })
  const container = document.createElement('div')
  container.append(fragment)
  return container.innerHTML
}

export function previewText(value: unknown) {
  const fragment = inlineFragment(value)
  fragment
    .querySelectorAll('img[data-remote-emoji]')
    .forEach((image) => image.replaceWith(`[${image.getAttribute('alt') || '表情'}]`))
  fragment.querySelectorAll('[data-spoiler]').forEach((element) => element.replaceWith('[剧透]'))
  fragment.querySelectorAll('[data-content-lock]').forEach((element) => element.replaceWith('[隐藏内容]'))
  return fragment.textContent || ''
}
