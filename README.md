# opencode-appshot

Codex-style "appshots" for **OpenCode Desktop on macOS**: attach a screenshot **and the readable
text** of any other app's window to your next prompt.

- **Appshot pill** above the composer → pick a window from the list → its screenshot gets attached.
  Turn on **Include window text** in the same menu to also attach the window's Accessibility text.
- **`/appshot`** → attaches the front-most other window (the app you just came from).
  `/appshot safari` → the first window whose app or title matches.
  `/appshot --text safari` → the same, with the window's text.

> Uses the experimental Desktop GUI plugin API (OpenCode ≥ 2.2). Plugins can't add items to the
> composer's **+** menu yet, so this uses a composer pill plus a slash command (see "Upstream" below).

## How it works

```
renderer (setup)                 main process (main)              appshot-helper (Swift)
ComposerPill / /appshot  ──Ipc──▶  ctx.provide(Appshot)  ──spawn──▶  list | permissions | capture
composer.attach(file/quote) ◀───  writes $TMPDIR/opencode-appshot/ ◀── PNG via screencapture -l
                                                                    text via AXUIElement tree
```

1. The window list comes from `CGWindowListCopyWindowInfo`, refreshed whenever OpenCode regains focus.
   OpenCode's own windows are filtered out.
2. `screencapture -l <windowID>` grabs the window, even when other windows partly cover it.
   The helper then shrinks it so its longest side is at most 1568 px. Vision models scale larger
   images down anyway, so full Retina captures only cost extra tokens.
3. The helper finds the matching Accessibility window (by frame, then by title) and walks its tree
   (up to 8,000 nodes or 200k characters). That includes content scrolled out of view.
   It sets `AXManualAccessibility` so Chrome and Electron apps expose their tree.
4. Files go to `$TMPDIR/opencode-appshot/`, like Codex's pasted images, so nothing lands in your project.
   OpenCode copies the image into the message when it's sent, and macOS clears old temp files on its own.
   The PNG is always attached. The text is read only when asked for (`--no-text` skips the walk otherwise).
   If it's short, it's added as a quote. If it's long, the `.md` file is attached instead.

## Build & install (on a Mac)

```sh
pnpm install
pnpm build             # universal Swift helper → bin/, plugin bundle → dist/
```

Then add the plugin to `~/.config/opencode/opencode.json` (the desktop app only reads plugins from
`opencode.json(c)`):

```jsonc
{
  "plugins": ["/absolute/path/to/opencode-appshot"]
}
```

Restart OpenCode Desktop. Check **Settings → Extensions → Plugins**.

The plugin finds `bin/appshot-helper` through the plugin's install location. If the pill reports
`appshot-helper not found`, point it at the binary yourself:

```jsonc
{
  "plugins": [{ "package": "/absolute/path/to/opencode-appshot", "options": { "helperPath": "/absolute/path/to/opencode-appshot/bin/appshot-helper" } }]
}
```

### Permissions

On the first run, open the pill and pick **Grant Screen Recording…** and then **Grant Accessibility…**.
macOS gives both permissions to **OpenCode**, the app that runs the helper, not to the helper itself.
After granting Screen Recording, restart OpenCode.

| Permission        | Needed for                                  |
|-------------------|---------------------------------------------|
| Screen Recording  | the screenshot, and window titles in the list |
| Accessibility     | the window text (only with **Include window text** or `--text`) |

## v1 checklist — verify first

- [x] **Does the model see the attached PNG as an image?** Yes. OpenCode inlines the workspace PNG
      into the message's `files` as `image/jpeg`, and a vision-capable model describes its pixels.
- [x] The relative `imagePath` resolves in `composer.attach`.
- [x] Local-path entry in `plugins` loads the GUI part.
- [ ] Icon names (`photo`, `outline-photo`, `outline-text`) render as expected.
- [x] TCC prompts are attributed to OpenCode when the helper is spawned from Electron's main process.

## Known limitations / v2 ideas

- The sent message shows no thumbnail for the capture. The image does reach the model, but OpenCode
  only draws thumbnails for files stored inline (`source.type: "inline"`, as a pasted image is).
  `composer.attach` takes a file path, so the file is stored as a `file://` URI and gets no
  thumbnail. The plugin API has no way to attach an inline image yet; this needs an upstream change.
- `screencapture` subprocess → ScreenCaptureKit (`SCScreenshotManager`) for better speed and control.
- AX text is plain and heuristic. Some apps (games, canvas UIs, some Java apps) expose little or no text.
- Captured text is untrusted content: it's attached as a *quote* so the model treats it as
  quoted material, but prompt-injection-style text in captured windows is still possible.
- Window picker thumbnails using a pill `menu` (custom JSX popover) in place of plain `rows`.

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

Images attached by a plugin get no thumbnail in the sent message. This is tracked upstream in
[anomalyco/opencode#61229](https://github.com/anomalyco/opencode/issues/61229) (path-based images
show filename cards in sent messages). Draft comment for that issue, adding the plugin case:

> Adding a related case from a GUI plugin, on OpenCode Desktop 2.4.x (macOS), `@opencode/plugin` 2.4.1.
>
> A plugin that attaches a workspace image with `composer.attach` gets an even weaker result than
> the filename card described here: the sent message shows **nothing**, neither a thumbnail nor a card.
>
> ```ts
> screen.composer.attach({ type: "file", path: ".opencode/appshots/shot.png" })
> ```
>
> The model does receive the image. The stored message has it in `files`, but `metadata.attachments`
> stays empty, so there's nothing for the timeline to render:
>
> ```jsonc
> "metadata": { "attachments": [], "comments": [] },
> "files": [{
>   "mime": "image/jpeg",
>   "name": "shot.png",
>   "source": { "type": "uri", "uri": "file:///…/.opencode/appshots/shot.png" },
>   "data": "…"
> }]
> ```
>
> For comparison, an image pasted into the same composer is stored with `source: { "type": "inline" }`
> and gets a thumbnail.
>
> When this gets picked up, could the fix render image entries from `files` (not only
> `metadata.attachments`)? That would cover plugin-attached images too. Alternatively, a way for
> `composer.attach` to add an image the way a paste does (inline bytes) would let plugins
> opt into the thumbnail themselves.
>
> Use case: a plugin that attaches a screenshot of another app's window. Without the thumbnail,
> users can't tell from the timeline whether a screenshot was sent or which window it showed.
