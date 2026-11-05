import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loginSchema } from './login-schema'

describe('the sign-in checks (PLAN-V7 D1)', () => {
  it('stay out of login-form.ts, which every first visit loads, so zod comes only with the form', () => {
    const form = readFileSync(resolve(import.meta.dirname, 'login-form.ts'), 'utf8')
    expect(form).not.toMatch(/from ['"]zod['"]/)
  })

  it('still ask for both fields, and trim the login', () => {
    const none = { identifier: ' ', password: 'x', keepSignedIn: false }
    expect(loginSchema.safeParse(none).success).toBe(false)
    expect(loginSchema.safeParse({ ...none, identifier: 'a', password: '' }).success).toBe(false)
    const ok = loginSchema.parse({ identifier: '  demo ', password: 'x', keepSignedIn: true })
    expect(ok.identifier).toBe('demo')
  })
})
