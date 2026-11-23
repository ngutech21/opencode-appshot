// Main-process only. Node built-ins are imported lazily so this module is safe to
// evaluate in the renderer too (the host evaluates the whole bundle in both).
import type { MainContext } from "@opencode/plugin/gui/main"
import type { Permissions, Shot, WindowEntry } from "./contract"

const MAX_INLINE_TEXT = 12_000
const HELPER = ["bin", "appshot-helper"] as const

let located: Promise<string> | undefined
let locateWith: MainContext | undefined

/** Must be called from `main` before any helper call. */
export function init(ctx: MainContext): void {
  locateWith = ctx
  located = undefined
}

// The host evaluates the bundle from a code string, so there is no __dirname.
// Find the package directory through the server's plugin list instead.
async function locate(ctx: MainContext): Promise<string> {
  const path = await import("node:path")
  const fs = await import("node:fs/promises")
  const os = await import("node:os")

  const tried: string[] = []
  const usable = async (file: string) => {
    tried.push(file)
    return fs.access(file, fs.constants.X_OK).then(() => true, () => false)
  }

  // 1. Explicit override: "options": { "helperPath": "/abs/path/appshot-helper" }
  const override = ctx.options.helperPath
  if (typeof override === "string" && override && (await usable(override))) return override

  // 2. Where the server loaded the plugin from.
  const candidates: string[] = []
  try {
    const { data } = await ctx.client.plugin.list()
    const self = data.find((p) => p.id === ctx.id)
    if (self?.source.type === "local") {
      candidates.push(path.join(self.source.path, ...HELPER))
    } else if (self?.source.type === "package") {
      const cache = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache")
      const target = self.source.target
      for (const spec of new Set([target, target.includes("@", 1) ? target : `${target}@latest`])) {
        candidates.push(path.join(cache, "opencode", "packages", spec, "node_modules", ctx.id, ...HELPER))
      }
    }
  } catch (err) {
    ctx.log.write("warn", "appshot: plugin list failed", { error: String(err) })
  }
  for (const file of candidates) if (await usable(file)) return file

  throw new Error(
    `appshot-helper not found (tried ${tried.join(", ") || "nothing"}). ` +
      `Set "helperPath" in the plugin's options.`,
  )
}

function helperPath(): Promise<string> {
  if (!locateWith) return Promise.reject(new Error("appshot helper used before init()"))
  located ??= locate(locateWith).catch((err) => {
    located = undefined // retry on the next call, e.g. after the server comes up
    throw err
  })
  return located
}

async function run<T>(args: string[]): Promise<T> {
  const { execFile } = await import("node:child_process")
  const bin = await helperPath()
  return new Promise<T>((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 64 * 1024 * 1024, timeout: 20_000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`appshot-helper ${args[0]} failed: ${stderr.trim() || err.message}`))
      try {
        resolve(JSON.parse(stdout) as T)
      } catch {
        reject(new Error(`appshot-helper ${args[0]} returned invalid JSON`))
      }
    })
  })
}

export function listWindows(excludePid: number): Promise<WindowEntry[]> {
  return run<WindowEntry[]>(["list", "--exclude-pid", String(excludePid)])
}

export function permissions(prompt: boolean): Promise<Permissions> {
  return run<Permissions>(prompt ? ["permissions", "--prompt"] : ["permissions"])
}

function slug(s: string): string {
  return (
    s
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .toLowerCase()
      .slice(0, 40) || "window"
  )
}

export async function capture(win: WindowEntry, withText: boolean): Promise<Shot> {
  const path = await import("node:path")
  const fs = await import("node:fs/promises")
  const os = await import("node:os")

  // Like Codex, keep captures out of the project: OpenCode copies the image into the
  // message when it is sent, and macOS clears old files from the temp folder.
  const dir = path.join(os.tmpdir(), "opencode-appshot")
  await fs.mkdir(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const base = path.join(dir, `${stamp}-${slug(win.app)}`)
  const imagePath = `${base}.png`

  const result = await run<{ text: string; truncated: boolean; matched: boolean }>([
    "capture",
    "--window-id", String(win.id),
    "--pid", String(win.pid),
    "--title", win.title,
    "--frame", `${win.x},${win.y},${win.width},${win.height}`,
    "--out", imagePath,
    ...(withText ? [] : ["--no-text"]),
  ])

  let textPath: string | undefined
  const text = result.text.trim()
  if (text) {
    textPath = `${base}.md`
    const header = `# ${win.app}${win.title ? ` — ${win.title}` : ""}\n\n` +
      `_Accessibility text captured ${new Date().toLocaleString()}${result.truncated ? " (truncated)" : ""}._\n\n`
    await fs.writeFile(textPath, header + text + "\n", "utf8")
  }

  return {
    imagePath,
    textPath,
    text: text.length > MAX_INLINE_TEXT ? "" : text,
    truncated: result.truncated,
  }
}
