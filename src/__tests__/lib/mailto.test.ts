// The email comes from the client, so the mailto URI must open the address that is displayed —
// characters the backend's email validation allows ('%', '+') must not be decoded by the mail client.
import { describe, it, expect } from 'vitest'

import { mailtoHref } from '../../lib/mailto'

describe('mailtoHref', () => {
  it('leaves an ordinary address readable', () => {
    expect(mailtoHref('laura.gomez@correo.com')).toBe('mailto:laura.gomez@correo.com')
  })

  it('encodes a literal % so the mail client cannot decode it into another address', () => {
    const href = mailtoHref('ana%40evil.com@x.co')
    expect(href).toBe('mailto:ana%2540evil.com@x.co')
    expect(decodeURIComponent(href.slice('mailto:'.length))).toBe('ana%40evil.com@x.co')
  })

  it('encodes characters that would start a query or fragment', () => {
    expect(mailtoHref('a+b?c#d@x.co')).toBe('mailto:a%2Bb%3Fc%23d@x.co')
  })
})
