/**
 * What is on screen when the rep speaks (PLAN-V22 T3-1, the contract part 1's `on_page`): a
 * command that names no company uses this one, like "log a call with Jo" on a company's page. Read
 * from the address, so it needs nothing from the page: a company's own page, the company open in
 * Companies' panel, or a pre-read. Today's rows (choice 8) come with T2-2.
 */
import type { AssistantOnPage } from '@/api/types'
import { MEETINGS_PATH } from '../paths'

/**
 * The old addresses under Companies (`old-addresses.ts`), on their way to the new ones: no company
 * there. Written here, not read from that file: this one loads late, and reaching into the first
 * visit's own files from here splits them into files of their own, which makes the first visit
 * bigger. A test checks the two agree.
 */
export const MOVED_UNDER_COMPANIES: readonly string[] = ['meetings', 'call-logs', 'activity']

function decoded(part: string): string | null {
  try {
    const value = decodeURIComponent(part).trim()
    return value === '' ? null : value
  } catch {
    return null
  }
}

/** What the address shows, or null when it shows no one thing. */
export function onPageOf(pathname: string, search = ''): AssistantOnPage | null {
  const path = pathname.replace(/\/+$/, '')
  const company = /^\/companies\/([^/]+)/.exec(path)?.[1]
  if (company && MOVED_UNDER_COMPANIES.includes(company)) return null
  if (company && path === `/companies/${company}`) {
    const key = decoded(company)
    return key ? { company_key: key } : null
  }
  if (path === '/companies') {
    const open = new URLSearchParams(search).get('company')?.trim()
    return open ? { company_key: open } : null
  }
  if (path.startsWith(`${MEETINGS_PATH}/`)) {
    const form = path.slice(MEETINGS_PATH.length + 1)
    if (form.includes('/')) return null
    const id = decoded(form)
    return id ? { form_id: id } : null
  }
  return null
}
