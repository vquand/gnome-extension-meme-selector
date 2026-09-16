# Meme Selector GNOME Extension

Adds a GNOME top-bar meme picker. Configure local folders in the extension
preferences, search by filename, and copy a selected image to the clipboard.

Online search is optional and disabled by default. Imgflip works without an API
key; GIPHY requires a user-provided API key. Downloaded online results are
saved to `~/Pictures/Memes` when requested.

This release targets GNOME Shell 50. Clipboard access occurs only for the
user-requested copy action, and is declared for GNOME Extensions review.

Install the release ZIP from the `dist/` directory with:

```sh
gnome-extensions install --force dist/meme-selector@willdo.shell-extension.zip
gnome-extensions enable meme-selector@willdo
```
