// The helper's stdout is a JSON contract with src/helper.ts and the Ipc
// schemas. These samples mirror what native/appshot-helper prints.
import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import { Permissions, Shot, WindowEntry } from "../src/contract"

describe("helper JSON contract", () => {
  it("accepts a `list` entry, with and without bundleId", () => {
    const decode = Schema.decodeUnknownSync(Schema.Array(WindowEntry))
    const list = [
      { id: 42, pid: 501, app: "Safari", bundleId: "com.apple.Safari", title: "Apple", x: 0, y: 25, width: 1280, height: 800 },
      { id: 43, pid: 502, app: "Terminal", title: "", x: 10.5, y: 20, width: 640, height: 480 },
    ]
    expect(decode(list)).toEqual(list)
  })

  it("rejects a `list` entry with a missing field", () => {
    const decode = Schema.decodeUnknownSync(WindowEntry)
    expect(() => decode({ id: 42, pid: 501, app: "Safari", x: 0, y: 0, width: 1, height: 1 })).toThrow()
  })

  it("accepts `permissions` output", () => {
    const decode = Schema.decodeUnknownSync(Permissions)
    expect(decode({ screenRecording: true, accessibility: false })).toEqual({ screenRecording: true, accessibility: false })
    expect(() => decode({ screenRecording: "yes", accessibility: false })).toThrow()
  })

  it("accepts a Shot with and without textPath", () => {
    const decode = Schema.decodeUnknownSync(Shot)
    expect(decode({ imagePath: "/tmp/a.png", text: "", truncated: false })).toEqual({ imagePath: "/tmp/a.png", text: "", truncated: false })
    expect(decode({ imagePath: "/tmp/a.png", textPath: "/tmp/a.md", text: "hi", truncated: true }).textPath).toBe("/tmp/a.md")
  })
})
