/**
 * Links that come from the backend (a source address, a website) are never trusted. A link is
 * shown only when it is a plain web address. `javascript:`, `data:`, `vbscript:` and every other
 * scheme give `null`, so the caller shows the text and no link.
 *
 * The rules match the backend's `safe_http_url` (engine/backend/core/sanitize.py): the scheme is
 * http or https, there is a host, no user name or password, no space or control character, and at
 * most 500 characters. The backend already filters what it stores. This is the second check, in
 * the place where the link is drawn.
 */

const MAX_URL_LENGTH = 500
const MAX_DOMAIN_LENGTH = 100

/** True for a space, a control character (C0 or C1) or any other whitespace. */
function hasBlankOrControl(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code <= 0x20 || (code >= 0x7f && code <= 0x9f) || /\s/u.test(char)) {
      return true
    }
  }
  return false
}

/**
 * Returns the address as a clean absolute http or https URL, or `null` when it is anything else.
 * Safe to put in an `href`.
 */
export function safeHref(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URL_LENGTH) {
    return null
  }
  if (hasBlankOrControl(value)) {
    return null
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null
  }
  if (url.hostname === '' || url.username !== '' || url.password !== '') {
    return null
  }
  return url.href
}

/**
 * The host to show next to a link, like `afr.com`. A leading `www.` is dropped. Returns `null`
 * when the value is not a safe link. Internationalised names stay in their `xn--` form, which is
 * the honest spelling of what the link opens.
 */
export function hostOf(value: unknown): string | null {
  const href = safeHref(value)
  if (href === null) {
    return null
  }
  return new URL(href).hostname.replace(/^www\./, '')
}

const DOMAIN_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i

/**
 * A website is stored as a bare domain (`acme.com.au`). This builds `https://acme.com.au` from it,
 * or returns `null` when the text is not a plain domain.
 */
export function websiteHref(domain: unknown): string | null {
  if (typeof domain !== 'string' || domain.length > MAX_DOMAIN_LENGTH) {
    return null
  }
  if (!DOMAIN_PATTERN.test(domain)) {
    return null
  }
  return safeHref(`https://${domain}`)
}
