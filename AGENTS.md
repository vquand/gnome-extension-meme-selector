# Maintainer Guide

This repository contains `meme-selector@willdo`, a GNOME Shell 50 extension.

## Source layout

- `extension.js`: top-bar menu, local search, and online search.
- `prefs.js`: Preferences window.
- `schemas/`: GSettings schema.
- `dist/`: published ZIP and checksum.

## Rules

- Keep Shell UI, signals, and asynchronous work inside the extension lifecycle.
- Treat folder contents, downloaded responses, and preference values as
  untrusted input; keep bounds on scans and online results.
- Clipboard access must remain limited to an explicit user copy action.
- Never commit API keys, selected folder lists, downloaded images, local paths,
  or generated schema caches.
- Keep `metadata.json` targeted to GNOME Shell 50.

## Checks

```bash
node --check extension.js
node --check prefs.js
glib-compile-schemas --strict --dry-run schemas
```

Build the release package with:

```bash
gnome-extensions pack --force --out-dir dist --extra-source=LICENSE \
  --schema=schemas/org.gnome.shell.extensions.meme-selector.gschema.xml \
  .
sha256sum dist/meme-selector@willdo.shell-extension.zip > dist/SHA256SUMS
```
