// Main-process only. Node built-ins are imported lazily so this module is safe to
// evaluate in the renderer too (the host evaluates the whole bundle in both).
import type { Permissions, Shot, WindowEntry } from "./contract"

const MAX_INLINE_TEXT = 12_000

async function helperPath(): Promise<string> {
  const path = await import("node:path")
  // dist/gui-experimental.cjs -> ../bin/appshot-helper
  return path.join(__dirname, "..", "bin", "appshot-helper")
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

export async function capture(win: WindowEntry, directory: string): Promise<Shot> {
  const path = await import("node:path")
  const fs = await import("node:fs/promises")

  // Composer file parts must be workspace paths, so captures live in the project.
  const dir = path.join(directory, ".opencode", "appshots")
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
    imagePath: path.relative(directory, imagePath),
    textPath: textPath ? path.relative(directory, textPath) : undefined,
    text: text.length > MAX_INLINE_TEXT ? "" : text,
    truncated: result.truncated,
  }
}
