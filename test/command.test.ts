import { describe, expect, it } from "vitest"
import { parseArgs, pickWindow, windowLabel } from "../src/command"
import type { WindowEntry } from "../src/contract"

const win = (app: string, title: string, id = 1): WindowEntry => ({
  id, pid: 100 + id, app, title, x: 0, y: 0, width: 800, height: 600,
})

describe("parseArgs", () => {
  it.each([
    [undefined, "", false],
    ["", "", false],
    ["   ", "", false],
    ["Safari", "safari", false],
    ["--text", "", true],
    ["--text safari", "safari", true],
    ["safari --text", "safari", true],
    ["google  --text   chrome", "google chrome", true],
    // Only the standalone flag counts.
    ["--textual", "--textual", false],
    ["my--text", "my--text", false],
  ])("parses %j", (input, query, text) => {
    expect(parseArgs(input)).toEqual({ query, text })
  })
})

describe("windowLabel", () => {
  it("joins app and title", () => {
    expect(windowLabel(win("Safari", "Apple"))).toBe("Safari — Apple")
  })
  it("falls back to the app name", () => {
    expect(windowLabel(win("Finder", ""))).toBe("Finder")
  })
})

describe("pickWindow", () => {
  const list = [win("Safari", "Apple", 1), win("Google Chrome", "Docs", 2), win("Finder", "", 3)]

  it("takes the front-most window without a query", () => {
    expect(pickWindow(list, "")?.id).toBe(1)
  })
  it("matches the app name", () => {
    expect(pickWindow(list, "chrome")?.id).toBe(2)
  })
  it("matches the title", () => {
    expect(pickWindow(list, "docs")?.id).toBe(2)
  })
  it("matches across app and title", () => {
    expect(pickWindow(list, "safari — apple")?.id).toBe(1)
  })
  it("returns undefined when nothing matches", () => {
    expect(pickWindow(list, "xcode")).toBeUndefined()
  })
  it("returns undefined for an empty list", () => {
    expect(pickWindow([], "")).toBeUndefined()
  })
})
