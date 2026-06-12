import type { LayoutState } from '@rekurt/openkline-core';

/**
 * URL-safe base64 encoder for chart layout states. Strips padding and
 * replaces `+`/`/` with `-`/`_` so the result fits in a query param
 * without percent-encoding.
 */
export function encodeLayoutState(state: LayoutState): string {
  const json = JSON.stringify(state);
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeLayoutState(encoded: string): LayoutState | null {
  try {
    // Restore padding + standard base64 alphabet.
    let b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) b64 += '=';
    const json = decodeURIComponent(escape(atob(b64)));
    const parsed = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) return null;
    if (parsed.version !== 1) return null;
    return parsed as LayoutState;
  } catch {
    return null;
  }
}

/** Build a shareable URL with the layout state in the `state` query parameter. */
export function buildShareUrl(state: LayoutState): string {
  const encoded = encodeLayoutState(state);
  const url = new URL(window.location.href);
  url.searchParams.set('state', encoded);
  return url.toString();
}

/** Pull the initial layout state from the current URL, if any. */
export function readStateFromUrl(): LayoutState | null {
  const param = new URLSearchParams(window.location.search).get('state');
  if (!param) return null;
  return decodeLayoutState(param);
}
