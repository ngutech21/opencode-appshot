import { mkdtemp, mkdir, readFile, readdir, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { MainContext } from "@opencode/plugin/gui/main"
import type { WindowEntry } from "../src/contract"
import * as helper from "../src/helper"

const FAKE = path.resolve(__dirname, "fixtures/fake-helper.sh")

type PluginSource = { type: "local"; path: string } | { type: "package"; target: string }

function context(opts: { helperPath?: string; source?: PluginSource; list?: () => Promise<unknown> } = {}) {
  const log = vi.fn()
  const list = opts.list ?? (async () => ({ data: opts.source ? [{ id: "opencode-appshot", source: opts.source }] : [] }))
  const ctx = {
    id: "opencode-appshot",
    options: opts.helperPath ? { helperPath: opts.helperPath } : {},
    client: { plugin: { list } },
    log: { write: log },
  } as unknown as MainContext
  return { ctx, log }
}

const win: WindowEntry = { id: 42, pid: 501, app: "Google Chrome", title: "Docs: Plan", x: 1, y: 2, width: 300, height: 400 }

let work: string
let argsFile: string
const ROOT = tmpdir()
const ENV = ["TMPDIR", "XDG_CACHE_HOME", "FAKE_HELPER_ARGS", "FAKE_HELPER_EXIT", "FAKE_HELPER_STDERR", "FAKE_HELPER_STDOUT"]
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]))

beforeEach(async () => {
  work = await mkdtemp(path.join(ROOT, "appshot-test-"))
  argsFile = path.join(work, "args")
  for (const k of ENV) delete process.env[k]
  process.env.TMPDIR = work
  process.env.FAKE_HELPER_ARGS = argsFile
})

afterEach(async () => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  await rm(work, { recursive: true, force: true })
})

/** Argument lists of every helper call so far. */
async function calls(): Promise<string[][]> {
  const raw = await readFile(argsFile, "utf8").catch(() => "")
  return raw.split("\n\n").filter(Boolean).map((c) => c.split("\n"))
}

function reply(value: unknown) {
  process.env.FAKE_HELPER_STDOUT = JSON.stringify(value)
}

describe("locating the helper", () => {
  it("rejects calls before init()", async () => {
    // A fresh module, so no earlier test has called init().
    vi.resetModules()
    const fresh = await import("../src/helper")
    await expect(fresh.permissions(false)).rejects.toThrow("before init()")
  })

  it("uses the helperPath option", async () => {
    helper.init(context({ helperPath: FAKE }).ctx)
    reply({ screenRecording: true, accessibility: true })
    await expect(helper.permissions(false)).resolves.toEqual({ screenRecording: true, accessibility: true })
  })

  it("finds bin/appshot-helper in a local plugin directory", async () => {
    const dir = path.join(work, "plugin")
    await mkdir(path.join(dir, "bin"), { recursive: true })
    await symlink(FAKE, path.join(dir, "bin", "appshot-helper"))
    helper.init(context({ source: { type: "local", path: dir } }).ctx)
    reply([])
    await expect(helper.listWindows(1)).resolves.toEqual([])
  })

  it("finds the helper in OpenCode's package cache, adding @latest to a bare name", async () => {
    process.env.XDG_CACHE_HOME = path.join(work, "cache")
    const bin = path.join(work, "cache", "opencode", "packages", "opencode-appshot@latest", "node_modules", "opencode-appshot", "bin")
    await mkdir(bin, { recursive: true })
    await symlink(FAKE, path.join(bin, "appshot-helper"))
    helper.init(context({ source: { type: "package", target: "opencode-appshot" } }).ctx)
    reply([])
    await expect(helper.listWindows(1)).resolves.toEqual([])
  })

  it("lists every path it tried when the helper is missing", async () => {
    const missing = path.join(work, "nope")
    helper.init(context({ helperPath: missing, source: { type: "local", path: work } }).ctx)
    const err = await helper.permissions(false).catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toContain(missing)
    expect((err as Error).message).toContain(path.join(work, "bin", "appshot-helper"))
    expect((err as Error).message).toContain('Set "helperPath"')
  })

  it("logs a failing plugin list and retries on the next call", async () => {
    let fail = true
    const dir = path.join(work, "plugin")
    await mkdir(path.join(dir, "bin"), { recursive: true })
    await symlink(FAKE, path.join(dir, "bin", "appshot-helper"))
    const { ctx, log } = context({
      list: async () => {
        if (fail) throw new Error("server not ready")
        return { data: [{ id: "opencode-appshot", source: { type: "local", path: dir } }] }
      },
    })
    helper.init(ctx)
    reply([])
    await expect(helper.listWindows(1)).rejects.toThrow("appshot-helper not found")
    expect(log).toHaveBeenCalledWith("warn", "appshot: plugin list failed", { error: "Error: server not ready" })
    fail = false
    await expect(helper.listWindows(1)).resolves.toEqual([])
  })
})

describe("running the helper", () => {
  beforeEach(() => helper.init(context({ helperPath: FAKE }).ctx))

  it("passes the pid to exclude to `list`", async () => {
    reply([win])
    await expect(helper.listWindows(1234)).resolves.toEqual([win])
    expect(await calls()).toEqual([["list", "--exclude-pid", "1234"]])
  })

  it("adds --prompt only when asked", async () => {
    reply({ screenRecording: false, accessibility: false })
    await helper.permissions(false)
    await helper.permissions(true)
    expect(await calls()).toEqual([["permissions"], ["permissions", "--prompt"]])
  })

  it("reports stderr when the helper fails", async () => {
    process.env.FAKE_HELPER_EXIT = "2"
    process.env.FAKE_HELPER_STDERR = "  window 42 is gone \n"
    await expect(helper.listWindows(1)).rejects.toThrow("appshot-helper list failed: window 42 is gone")
  })

  it("rejects output that isn't JSON", async () => {
    process.env.FAKE_HELPER_STDOUT = "not json"
    await expect(helper.permissions(false)).rejects.toThrow("appshot-helper permissions returned invalid JSON")
  })
})

describe("capture", () => {
  beforeEach(() => helper.init(context({ helperPath: FAKE }).ctx))

  it("writes into $TMPDIR/opencode-appshot and passes the window to the helper", async () => {
    reply({ text: "", truncated: false, matched: true })
    const shot = await helper.capture(win, false)

    const dir = path.join(work, "opencode-appshot")
    expect(path.dirname(shot.imagePath)).toBe(dir)
    expect(path.basename(shot.imagePath)).toMatch(/^\d{4}-\d{2}-\d{2}T[\d-]+Z-google-chrome\.png$/)
    expect(shot).toEqual({ imagePath: shot.imagePath, textPath: undefined, text: "", truncated: false })

    const [args] = await calls()
    expect(args).toEqual([
      "capture",
      "--window-id", "42",
      "--pid", "501",
      "--title", "Docs: Plan",
      "--frame", "1,2,300,400",
      "--out", shot.imagePath,
      "--no-text",
    ])
    expect(await readdir(dir)).toEqual([]) // no .md without text
  })

  it("asks for text without --no-text and writes it to a Markdown file", async () => {
    reply({ text: "  Hello\nWorld  \n", truncated: true, matched: true })
    const shot = await helper.capture(win, true)

    expect((await calls())[0]).not.toContain("--no-text")
    expect(shot.text).toBe("Hello\nWorld")
    expect(shot.truncated).toBe(true)
    expect(shot.textPath).toBe(shot.imagePath.replace(/\.png$/, ".md"))
    const md = await readFile(shot.textPath!, "utf8")
    expect(md).toMatch(/^# Google Chrome — Docs: Plan\n\n_Accessibility text captured .+ \(truncated\)\._\n\nHello\nWorld\n$/)
  })

  it("leaves the title out of the heading when the window has none", async () => {
    reply({ text: "x", truncated: false, matched: true })
    const shot = await helper.capture({ ...win, title: "" }, true)
    const md = await readFile(shot.textPath!, "utf8")
    expect(md.split("\n")[0]).toBe("# Google Chrome")
    expect(md).not.toContain("(truncated)")
  })

  it("keeps long text in the file only", async () => {
    const long = "a".repeat(12_001)
    reply({ text: long, truncated: false, matched: true })
    const shot = await helper.capture(win, true)
    expect(shot.text).toBe("")
    expect(await readFile(shot.textPath!, "utf8")).toContain(long)
  })

  it("inlines text up to the limit", async () => {
    const edge = "a".repeat(12_000)
    reply({ text: edge, truncated: false, matched: true })
    expect((await helper.capture(win, true)).text).toBe(edge)
  })

  it("slugs the app name for the file name", async () => {
    reply({ text: "", truncated: false, matched: false })
    const name = (app: string) => helper.capture({ ...win, app }, false).then((s) => path.basename(s.imagePath).replace(/^.*Z-/, ""))
    expect(await name("Café Ünïcode  App!")).toBe("cafe-unicode-app.png")
    expect(await name("日本語")).toBe("window.png")
    expect(await name("x".repeat(60))).toBe(`${"x".repeat(40)}.png`)
  })
})
