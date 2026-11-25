import type { WindowEntry } from "./contract"

/** How a window is shown in the picker, and what `/appshot <query>` matches against. */
export function windowLabel(win: WindowEntry): string {
  return win.title ? `${win.app} — ${win.title}` : win.app
}

export interface AppshotArgs {
  /** Lowercased search text, empty for "the front-most other window". */
  query: string
  /** `--text` was given anywhere in the argument. */
  text: boolean
}

/** Parses the argument of `/appshot [--text] [query]`. */
export function parseArgs(input: string | undefined): AppshotArgs {
  const raw = (input ?? "").trim()
  const text = /(^|\s)--text(\s|$)/.test(raw)
  const query = raw.replace(/(^|\s)--text(?=\s|$)/g, " ").trim().toLowerCase()
  return { query, text }
}

/**
 * The window `/appshot` attaches: the first one whose label contains the query,
 * or with no query the front-most other window, i.e. the app you just came from.
 */
export function pickWindow(list: readonly WindowEntry[], query: string): WindowEntry | undefined {
  return query ? list.find((w) => windowLabel(w).toLowerCase().includes(query)) : list[0]
}
