import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const library = new URL('../../../node_modules/winuionweb/', import.meta.url)

function pointerInput() {
  const listeners = new Map()
  const timers = new Map()
  let sequence = 0
  const document = {
    documentElement: { classList: new Set() },
    addEventListener(type, handler, capture = false) {
      const handlers = listeners.get(type) ?? []
      handlers.push({ handler, capture })
      listeners.set(type, handlers)
    },
  }
  document.documentElement.classList.contains = (value) => document.documentElement.classList.has(value)
  document.documentElement.classList.remove = (value) => document.documentElement.classList.delete(value)
  class MouseEvent {
    constructor(type, options = {}) {
      Object.assign(this, { type, defaultPrevented: false, isTrusted: false }, options)
    }
    preventDefault() {
      this.defaultPrevented = true
    }
    stopImmediatePropagation() {
      this.stopped = true
    }
  }
  class Node {
    isConnected = true
    contains(other) {
      return this === other
    }
    dispatchEvent(event) {
      event.target = this
      const handlers = listeners.get(event.type) ?? []
      for (const { handler, capture } of handlers) if (capture) handler(event)
      if (!event.stopped) this.onEvent?.(event)
      for (const { handler, capture } of handlers) if (!capture && !event.stopped) handler(event)
      return !event.defaultPrevented
    }
  }
  const window = {
    addEventListener() {},
    setTimeout(callback) {
      timers.set(++sequence, callback)
      return sequence
    },
    clearTimeout(id) {
      timers.delete(id)
    },
  }
  const source = readFileSync(new URL('src/components/pointerInput.ts', library), 'utf8')
  const exports = {}
  runInNewContext(ts.transpile(source, { module: ts.ModuleKind.CommonJS }), {
    document,
    window,
    Node,
    MouseEvent,
    exports,
    Date,
    Math,
  })
  exports.installPointerInput()
  const target = new Node()
  return {
    target,
    send(type, options = {}) {
      const event = new MouseEvent(type, {
        pointerId: 1,
        pointerType: 'touch',
        isPrimary: true,
        button: 0,
        clientX: 20,
        clientY: 20,
        detail: 1,
        ...options,
      })
      target.dispatchEvent(event)
      return event
    },
    longPress() {
      for (const [id, callback] of [...timers]) {
        timers.delete(id)
        callback()
      }
    },
  }
}

test('the installed candidate identifies its fixed upstream source', () => {
  const metadata = JSON.parse(readFileSync(new URL('package.json', library), 'utf8'))
  assert.equal(metadata.version, '0.2.0-forum.1')
  assert.equal(metadata.forumUpstream.revision, '692d0a76dad3fa92515bc50db44ed626d83b695e')
})

test('ordinary inputs, links and editable content keep native context menus', () => {
  const input = pointerInput()
  assert.equal(input.send('contextmenu', { isTrusted: true }).defaultPrevented, false)
})

test('an unhandled touch long-press does not swallow a link or input click', () => {
  const input = pointerInput()
  input.send('pointerdown')
  input.longPress()
  input.send('pointerup')
  assert.equal(input.send('click').defaultPrevented, false)
})

test('a custom long-press menu suppresses only the following pointer click', () => {
  const input = pointerInput()
  input.target.onEvent = (event) => {
    if (event.type === 'contextmenu') event.preventDefault()
  }
  input.send('pointerdown')
  input.longPress()
  input.send('pointerup')
  assert.equal(input.send('click', { detail: 0 }).defaultPrevented, false)
  assert.equal(input.send('click').defaultPrevented, true)
  assert.equal(input.send('click').defaultPrevented, false)
})

test('a native handled context event cancels the duplicate long-press request', () => {
  const input = pointerInput()
  let menus = 0
  input.target.onEvent = (event) => {
    if (event.type === 'contextmenu') {
      menus++
      event.preventDefault()
    }
  }
  input.send('pointerdown')
  input.send('contextmenu', { isTrusted: true })
  input.longPress()
  assert.equal(menus, 1)
  assert.equal(input.send('click').defaultPrevented, true)
})

test('a scrolling touch cancels the long-press timer', () => {
  const input = pointerInput()
  let menus = 0
  input.target.onEvent = (event) => {
    if (event.type === 'contextmenu') menus++
  }
  input.send('pointerdown')
  input.send('pointermove', { clientY: 40 })
  input.longPress()
  assert.equal(menus, 0)
  assert.equal(input.send('click').defaultPrevented, false)
})

test('touch panning forwards only the unconsumed delta through nested scroll regions', () => {
  const source = readFileSync(new URL('src/components/pointerDragTouchScroll.ts', library), 'utf8')
  const exports = {}
  runInNewContext(ts.transpile(source, { module: ts.ModuleKind.CommonJS }), { exports, Math })
  const inner = { scrollTop: 90, scrollHeight: 200, clientHeight: 100 }
  const outer = { scrollTop: 20, scrollHeight: 700, clientHeight: 200 }
  exports.scrollByTouchDelta([inner, outer], 40)
  assert.equal(inner.scrollTop, 100)
  assert.equal(outer.scrollTop, 50)
  exports.scrollByTouchDelta([inner, outer], -180)
  assert.equal(inner.scrollTop, 0)
  assert.equal(outer.scrollTop, 0)
})
