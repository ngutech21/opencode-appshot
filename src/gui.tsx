import { createSignal } from "solid-js"
import { Command, ComposerPill, Plugin, type ComposerPillRow, type ComposerPillView } from "@opencode/plugin/gui"
import { Appshot, type Permissions, type WindowEntry } from "./contract"
import * as helper from "./helper"

const MAX_ROWS = 12

export default Plugin.define({
  setup(ctx) {
    const api = ctx.main(Appshot)
    const [windows, setWindows] = createSignal<readonly WindowEntry[]>([])
    const [perms, setPerms] = createSignal<Permissions>()
    const [busy, setBusy] = createSignal(false)
    const [error, setError] = createSignal<string>()

    const refresh = async () => {
      try {
        const p = await api.permissions()
        setPerms(p)
        setWindows(p.screenRecording ? await api.listWindows() : [])
        setError(undefined)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    }

    // The window list only matters when the user comes back to OpenCode, so refresh
    // on focus instead of polling. That's also exactly when "the last app" changes.
    void refresh()
    const onFocus = () => void refresh()
    window.addEventListener("focus", onFocus)

    async function shoot(win: WindowEntry) {
      const screen = ctx.screen.current()
      const session = ctx.sessions.current()
      if (!screen || !session) return
      setBusy(true)
      try {
        const shot = await api.capture({ window: win, directory: session.directory })
        const composer = screen.composer
        composer.attach({ type: "file", path: shot.imagePath, preview: `${win.app} screenshot` })
        if (shot.text && composer.quotable()) {
          composer.attach({
            type: "quote",
            commentID: crypto.randomUUID(),
            text: shot.text,
            source: { label: win.app, icon: "outline-text", subject: `the ${win.app} window "${win.title}"` },
          })
        } else if (shot.textPath) {
          composer.attach({ type: "file", path: shot.textPath, preview: `${win.app} text` })
        }
        composer.focus()
        setError(undefined)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    }

    function label(win: WindowEntry) {
      return win.title ? `${win.app} — ${win.title}` : win.app
    }

    ctx.add(ComposerPill, {
      id: "appshot",
      show: (): ComposerPillView => {
        const p = perms()
        const rows: ComposerPillRow[] = []

        if (p && (!p.screenRecording || !p.accessibility)) {
          rows.push({
            id: "permissions",
            label: !p.screenRecording ? "Grant Screen Recording…" : "Grant Accessibility (for window text)…",
            icon: "shield",
            tone: "warning",
            run: () => void api.requestPermissions().then(setPerms),
          })
        }
        for (const win of windows().slice(0, MAX_ROWS)) {
          rows.push({
            id: `w${win.id}`,
            label: label(win),
            icon: "outline-photo",
            detail: `${Math.round(win.width)}×${Math.round(win.height)}`,
            run: () => void shoot(win),
          })
        }
        rows.push({ id: "refresh", label: "Refresh window list", icon: "refresh", run: () => void refresh() })

        const err = error()
        return {
          label: busy() ? "Capturing…" : "Appshot",
          icon: "photo",
          tone: err ? "danger" : p && !p.screenRecording ? "warning" : undefined,
          title: err ? `Appshot — ${err}` : "Attach a window",
          rows,
        }
      },
    })

    ctx.add(Command, (): Command => ({
      id: "attach",
      title: "Appshot: attach a window",
      description: "Screenshot and text of another app's window",
      keywords: "screenshot window capture appshot",
      section: "prompt",
      slash: { name: "appshot", arguments: true },
      enabled: !!ctx.sessions.current(),
      run: async (input) => {
        await refresh()
        const q = (input ?? "").trim().toLowerCase()
        const list = windows()
        // No argument: the front-most other window, i.e. the app you just came from.
        const win = q ? list.find((w) => label(w).toLowerCase().includes(q)) : list[0]
        if (win) await shoot(win)
        else setError(q ? `No window matches "${q}"` : "No other windows on screen")
      },
    }))

    return () => window.removeEventListener("focus", onFocus)
  },

  main(ctx) {
    helper.init(ctx)
    ctx.provide(Appshot, {
      listWindows: () => helper.listWindows(process.pid),
      capture: ({ window, directory }) => helper.capture(window, directory),
      permissions: () => helper.permissions(false),
      requestPermissions: () => helper.permissions(true),
    })
  },
})
