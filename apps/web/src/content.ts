import DOMPurify from 'dompurify'

export interface ListItem {
  content?: string
  text?: string
  items?: Array<ListItem | string>
  meta?: { checked?: boolean }
}

function inlineFragment(value: unknown) {
  return DOMPurify.sanitize(String(value ?? ''), {
    ALLOWED_TAGS: ['b', 'strong', 'i', 'em', 'a', 'code', 'mark', 'span', 'br', 'u', 's', 'sub', 'sup'],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'data-spoiler'],
    RETURN_DOM_FRAGMENT: true,
  })
}

export function inlineHtml(value: unknown) {
  const fragment = inlineFragment(value)
  fragment.querySelectorAll('[data-spoiler]').forEach((element) => {
    element.setAttribute('tabindex', '0')
    element.setAttribute('role', 'button')
    element.setAttribute('aria-label', '显示剧透文字')
    element.setAttribute('aria-expanded', 'false')
  })
  const container = document.createElement('div')
  container.append(fragment)
  return container.innerHTML
}

export function previewText(value: unknown) {
  const fragment = inlineFragment(value)
  fragment.querySelectorAll('[data-spoiler]').forEach((element) => element.replaceWith('[剧透]'))
  return fragment.textContent || ''
}
