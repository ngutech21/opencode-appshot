# Changelog

## [0.2.0](https://github.com/ngutech21/opencode-appshot/compare/v0.1.0...v0.2.0) (2026-11-27)


### ⚠ BREAKING CHANGES

* **gui:** the Ipc `capture` input requires a `text` boolean.
* **helper:** the Ipc `capture` input no longer takes `directory`, and the returned imagePath/textPath are absolute.

### Features

* **gui:** attach the screenshot only, window text on request ([1877f78](https://github.com/ngutech21/opencode-appshot/commit/1877f7821fa277c636cc35150ba20d839b700b9c))
* **helper:** shrink screenshots to 1568 px on the longest side ([01736a7](https://github.com/ngutech21/opencode-appshot/commit/01736a739dc4c6fefc30513dcffed49203b8df23))
* **helper:** store captures in the temp folder instead of the project ([c02d07d](https://github.com/ngutech21/opencode-appshot/commit/c02d07df0a122ee0034310f6566c2b444fbe711a))


### Bug Fixes

* **gui:** collapse the spaces --text leaves in /appshot queries ([6a1426e](https://github.com/ngutech21/opencode-appshot/commit/6a1426e63a4aa6b6f4101a6b89f5dcd96d617408))
* **helper:** locate the helper binary without __dirname ([21ee9ca](https://github.com/ngutech21/opencode-appshot/commit/21ee9ca8c760d73d22e3edd1c62639151ce4a4ad))
