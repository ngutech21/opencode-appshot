# opencode-appshot

Codex-style "appshots" for **OpenCode Desktop on macOS**: attach a screenshot **and the readable
text** of any other app's window to your next prompt.

- **Appshot pill** above the composer → pick a window from the list → the PNG and its text get attached.
- **`/appshot`** → attaches the front-most other window (the app you just came from).
  `/appshot safari` → the first window whose app or title matches.

> Uses the experimental Desktop GUI plugin API (OpenCode ≥ 2.2). Plugins can't add items to the
> composer's **+** menu yet, so this uses a composer pill plus a slash command (see "Upstream" below).

## How it works

```
renderer (setup)                 main process (main)              appshot-helper (Swift)
ComposerPill / /appshot  ──Ipc──▶  ctx.provide(Appshot)  ──spawn──▶  list | permissions | capture
composer.attach(file/quote) ◀───  writes .opencode/appshots/   ◀── PNG via screencapture -l
                                                                    text via AXUIElement tree
```

1. The window list comes from `CGWindowListCopyWindowInfo`, refreshed whenever OpenCode regains focus.
   OpenCode's own windows are filtered out.
2. `screencapture -l <windowID>` grabs the window, even when other windows partly cover it.
3. The helper finds the matching Accessibility window (by frame, then by title) and walks its tree
   (up to 8,000 nodes or 200k characters). That includes content scrolled out of view.
   It sets `AXManualAccessibility` so Chrome and Electron apps expose their tree.
4. Files go to `<project>/.opencode/appshots/`, because composer file parts must be workspace paths.
   The PNG is always attached. If the text is short, it's added as a quote. If it's long, the `.md` file is attached instead.

## Build & install (on a Mac)

```sh
pnpm install
pnpm build             # universal Swift helper → bin/, plugin bundle → dist/
```

Then add the plugin to `~/.config/opencode/opencode.json` (the desktop app only reads plugins from
`opencode.json(c)`):

```jsonc
{
  "plugin": ["/absolute/path/to/opencode-appshot"]
}
```

Restart OpenCode Desktop. Check **Settings → Extensions → Plugins**.

### Permissions

On the first run, open the pill and pick **Grant Screen Recording…** and then **Grant Accessibility…**.
macOS gives both permissions to **OpenCode**, the app that runs the helper, not to the helper itself.
After granting Screen Recording, restart OpenCode.

| Permission        | Needed for                                  |
|-------------------|---------------------------------------------|
| Screen Recording  | the screenshot, and window titles in the list |
| Accessibility     | the window text (optional, image-only without it) |

## v1 checklist — verify first

- [ ] **Does the model see the attached PNG as an image?** `ComposerFile` is documented as a
      workspace file part, and nothing says images are supported. If OpenCode only sends text for
      file parts, image delivery needs another route. One option is a server-plugin part that turns the
      PNG into an image message part. Test this before anything else.
- [ ] The relative `imagePath` resolves in `composer.attach`. If not, try an absolute path.
- [ ] Local-path entry in `plugin` loads the GUI part (otherwise `pnpm pack` and install the tarball).
- [ ] Icon names (`photo`, `outline-photo`, `outline-text`) render as expected.
- [ ] TCC prompts are attributed to OpenCode when the helper is spawned from Electron's main process.

## Known limitations / v2 ideas

- `screencapture` subprocess → ScreenCaptureKit (`SCScreenshotManager`) for better speed and control.
- AX text is plain and heuristic. Some apps (games, canvas UIs, some Java apps) expose little or no text.
- Captured text is untrusted content: it's attached as a *quote* so the model treats it as
  quoted material, but prompt-injection-style text in captured windows is still possible.
- Window picker thumbnails using a pill `menu` (custom JSX popover) in place of plain `rows`.
- Move captures to a cleanup-on-send location. Add `.opencode/appshots/` to your projects' `.gitignore` meanwhile.

## Upstream

There's no `MenuItem` menu for the composer's **+** attach menu yet. The SDK only has `session.panel`,
`server.add` and `server.row`. Proposed issue for opencode:

> **GUI plugins: allow `MenuItem` entries in the composer's + (attach) menu**
>
> Plugins can attach files, notes and quotes with `composer.attach`, but the only entry points
> next to the composer are slash commands and `ComposerPill`. A `menu: "composer.attach"` item
> (`{ id, title, icon, order, run(screen) }`) would let attachment sources such as screenshots,
> issue trackers or clipboard history appear where users already look.
> Example plugin: opencode-appshot.

Once that exists, the pill becomes one `ctx.add(MenuItem, …)` call that opens the same window list.
