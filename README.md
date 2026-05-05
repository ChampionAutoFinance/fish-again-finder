# Fish Again Finder

Firefox extension and launcher for automatically clicking the newest on-screen `Fish Again` button.

## What it does

- Scans buttons, links, inputs, `[role="button"]`, clickable elements, and tabbable elements.
- Matches visible text, `aria-label`, `title`, and input `value`.
- Highlights matching controls with a green outline.
- Highlights the newest on-screen matching control with a blue outline.
- Has a floating Start/Pause panel on the page.
- Lets you move and resize the panel.
- Lets you change the click interval from the panel.
- Clicks the newest on-screen matching button.
- Scrolls to the bottom after each click.
- Shows the number of matches in the extension badge and popup. While running, the badge says `ON`.
- Watches page changes so dynamically loaded buttons are detected.
- Tries to inject itself into the active tab from the popup if the extension was loaded after the page.

## Download Packages

- Mac: `fish-again-finder-mac.zip`
- Windows: `fish-again-finder-windows.zip`
- Firefox extension package: `fish-again-finder-extension.xpi`

See `INSTALL.md` for setup steps.

## Load in Firefox

1. Open Firefox.
2. Go to `about:debugging#/runtime/this-firefox`.
3. Click `Load Temporary Add-on`.
4. Select `manifest.json` from this folder.
5. Open the target page and click the extension icon to scan again if needed.

Temporary add-ons stay loaded until Firefox is closed.
