// The address comes from the client, so it is percent-encoded before going into the URI:
// a literal '%', '?', '&' or '#' in the local part would otherwise be decoded or parsed by the
// mail client and the compose window would open on a different address than the one displayed.
// '@' is kept readable — it is the separator, not data.
export function mailtoHref(email: string): string {
  return `mailto:${encodeURIComponent(email).replace(/%40/g, '@')}`
}

// Pragmatic shape check: something@domain.tld, no spaces. The address is typed by the client
// over WhatsApp, so it may be malformed — we show it anyway but never offer it as a mailto link.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email.trim())
}
