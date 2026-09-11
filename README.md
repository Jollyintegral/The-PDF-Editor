# The-PDF-Editor

Simple, lightweight, completely free PDF editor. No accounts, no uploads, no bullshit — everything runs 100% locally in your browser.

## Free forever
its free

## Use it

Just open `index.html` in any modern browser, or visit the site (inactive at certain times). No install, no build step, works offline.

1. Open or drop in a PDF
2. Click any text to edit it in place — fonts, colors, and layout stay put
3. Select text to style just that part (bold, italic, underline, color, highlight, font, size)
4. Grab a box by its edges to move it, or nudge with arrow keys
5. Double-click empty space to add text
6. Ctrl+Z to undo, Ctrl+S to save

Work autosaves to your browser, and the library screen keeps recent documents so you can pick up where you left off.

## Privacy

Your files never leave your computer. There is no server, no tracking, no network calls for document processing (Google Fonts load only for the font picker, and the app works without them).

## Built with

- [pdf.js](https://github.com/mozilla/pdf.js) (Apache-2.0) for rendering — vendored in `vendor/`
- [pdf-lib](https://github.com/Hopding/pdf-lib) (MIT) for saving — vendored in `vendor/`
- Plain HTML/CSS/JS, zero build tools, zero dependencies to install

## License

Source-available freeware — free to use, and the code is visible so anyone can check it's clean. All rights stay with the author, see `LICENSE`.
