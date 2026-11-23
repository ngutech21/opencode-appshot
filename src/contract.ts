import { Schema } from "effect"
import { Ipc } from "@opencode/plugin/gui"

/** An on-screen window another app owns, front-most first. */
export const WindowEntry = Schema.Struct({
  id: Schema.Number,
  pid: Schema.Number,
  app: Schema.String,
  bundleId: Schema.optional(Schema.String),
  title: Schema.String,
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
})
export type WindowEntry = typeof WindowEntry.Type

export const Permissions = Schema.Struct({
  screenRecording: Schema.Boolean,
  accessibility: Schema.Boolean,
})
export type Permissions = typeof Permissions.Type

export const Shot = Schema.Struct({
  /** Absolute path of the window's PNG, in the temp folder. */
  imagePath: Schema.String,
  /** Absolute path of a Markdown file with the window's accessibility text. */
  textPath: Schema.optional(Schema.String),
  /** The extracted text (possibly empty). */
  text: Schema.String,
  /** True when the text hit the helper's size limit. */
  truncated: Schema.Boolean,
})
export type Shot = typeof Shot.Type

/** The plugin's id is its package name; Ipc ids must sit under it. */
export const Appshot = Ipc.define({
  id: "opencode-appshot.capture",
  methods: {
    listWindows: { output: Schema.Array(WindowEntry) },
    capture: {
      input: Schema.Struct({ window: WindowEntry }),
      output: Shot,
    },
    permissions: { output: Permissions },
    requestPermissions: { output: Permissions },
  },
})
