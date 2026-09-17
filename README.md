# Meme Selector

Version 1.0.0 is the first published release and supports GNOME Shell 50.

Browse meme images from selected folders in the GNOME top bar, search by file
name, and copy a meme to the clipboard.

## Features

- Scan one or more local folders recursively.
- Search local `.jpg`, `.jpeg`, and `.png` files.
- Optionally search Imgflip or GIPHY online.
- Save online results to `~/Pictures/Memes`.
- Configure folders, provider, result limits, and GIPHY settings in Preferences.

Online search is disabled by default. Imgflip needs no API key; GIPHY requires
a GIPHY API key entered in Preferences. Clipboard access is used only when you
choose to copy a meme.

## Install

This release supports GNOME Shell 50. See [CHANGELOG.md](CHANGELOG.md) for
the release notes.

Install the package from `dist/`:

```bash
gnome-extensions install --force \
  dist/meme-selector@willdo.shell-extension.zip
gnome-extensions enable meme-selector@willdo
```

Open Preferences to add your meme folders:

```bash
gnome-extensions prefs meme-selector@willdo
```

On Wayland, log out and back in if GNOME Shell does not discover the extension
immediately.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
