/**
 * The shared "is typing" check (PLAN-V22 T3-1): a key in a text box, a select, editable text or
 * an input method is typing; a key on a button, a checkbox or the page is not.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { isTyping } from './is-typing'

function keyOn(
  target: EventTarget | null,
  init: Partial<Pick<KeyboardEvent, 'isComposing' | 'key'>> = {},
) {
  return { target, isComposing: init.isComposing ?? false, key: init.key ?? 'v' }
}

function made<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string> = {},
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value)
  document.body.append(element)
  return element
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('isTyping', () => {
  it.each(['text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date'])(
    'is true in an input of type %s',
    (type) => {
      expect(isTyping(keyOn(made('input', { type })))).toBe(true)
    },
  )

  it.each(['checkbox', 'radio', 'button', 'submit', 'range', 'color', 'file'])(
    'is false on an input of type %s, which takes no typed text',
    (type) => {
      expect(isTyping(keyOn(made('input', { type })))).toBe(false)
    },
  )

  it('is true in a text area and a select', () => {
    expect(isTyping(keyOn(made('textarea')))).toBe(true)
    expect(isTyping(keyOn(made('select')))).toBe(true)
  })

  it('is true in editable text, and inside it', () => {
    const editor = made('div', { contenteditable: 'true' })
    const inside = document.createElement('span')
    editor.append(inside)
    expect(isTyping(keyOn(editor))).toBe(true)
    expect(isTyping(keyOn(inside))).toBe(true)
    expect(isTyping(keyOn(made('div', { contenteditable: '' })))).toBe(true)
    expect(isTyping(keyOn(made('div', { contenteditable: 'plaintext-only' })))).toBe(true)
  })

  it('is false in text that says it is not editable', () => {
    expect(isTyping(keyOn(made('div', { contenteditable: 'false' })))).toBe(false)
  })

  it('is false on a button, a link, the page and nothing', () => {
    expect(isTyping(keyOn(made('button')))).toBe(false)
    expect(isTyping(keyOn(made('a', { href: '#here' })))).toBe(false)
    expect(isTyping(keyOn(document.body))).toBe(false)
    expect(isTyping(keyOn(null))).toBe(false)
  })

  it('is true while an input method builds a word, wherever the focus is', () => {
    expect(isTyping(keyOn(document.body, { isComposing: true }))).toBe(true)
    // Chrome names the key "Process" for the first key of a word.
    expect(isTyping(keyOn(document.body, { key: 'Process' }))).toBe(true)
  })
})
