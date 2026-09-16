import Clutter from 'gi://Clutter';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Soup from 'gi://Soup';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const MEME_FOLDERS_KEY = 'meme-folders';
const ONLINE_SEARCH_ENABLED_KEY = 'online-search-enabled';
const ONLINE_PROVIDER_KEY = 'online-provider';
const GIPHY_API_KEY_KEY = 'giphy-api-key';
const ONLINE_RESULT_LIMIT_KEY = 'online-result-limit';
const GIPHY_RATING_KEY = 'giphy-rating';
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);
const MAX_SCAN_DEPTH = 8;
const MAX_MEMES = 1000;
const MAX_VISIBLE_MEMES = 50;
const MAX_ONLINE_RESULTS = 25;
const IMGFLIP_MEMES_URL = 'https://api.imgflip.com/get_memes?type=gif,image';
const GIPHY_SEARCH_URL = 'https://api.giphy.com/v1/gifs/search';
const LOG_PREFIX = '[Meme Selector]';
const CLIPBOARD_TYPE = St.ClipboardType.CLIPBOARD;
const DEFAULT_SAVE_FOLDER = GLib.build_filenamev([GLib.get_home_dir(), 'Pictures', 'Memes']);
const ONLINE_PROVIDERS = new Map([
    ['imgflip', 'Imgflip'],
    ['giphy', 'GIPHY'],
]);

function fileExtension(name) {
    const index = name.lastIndexOf('.');
    return index === -1 ? '' : name.slice(index).toLowerCase();
}

function fileTitle(name) {
    const index = name.lastIndexOf('.');
    return index === -1 ? name : name.slice(0, index);
}

function loadImageAsPngBytes(path) {
    const pixbuf = GdkPixbuf.Pixbuf.new_from_file(path);
    const [success, contents] = pixbuf.save_to_bufferv('png', [], []);

    if (!success)
        return null;

    return GLib.Bytes.new(contents);
}

function imageBytesToPngBytes(bytes) {
    const stream = Gio.MemoryInputStream.new_from_bytes(bytes);

    try {
        const pixbuf = GdkPixbuf.Pixbuf.new_from_stream(stream, null);
        const [success, contents] = pixbuf.save_to_bufferv('png', [], []);

        if (!success)
            return null;

        return GLib.Bytes.new(contents);
    } finally {
        stream.close(null);
    }
}

function queryForOnlineSearch(query) {
    return query.trim().slice(0, 50);
}

function settingProvider(settings) {
    const provider = settings.get_string(ONLINE_PROVIDER_KEY);
    return ONLINE_PROVIDERS.has(provider) ? provider : 'imgflip';
}

function providerTitle(provider) {
    return ONLINE_PROVIDERS.get(provider) ?? 'Imgflip';
}

function settingRating(settings) {
    const rating = settings.get_string(GIPHY_RATING_KEY);
    return ['g', 'pg', 'pg-13', 'r'].includes(rating) ? rating : 'g';
}

function settingLimit(settings) {
    return Math.max(1, Math.min(MAX_ONLINE_RESULTS, settings.get_int(ONLINE_RESULT_LIMIT_KEY)));
}

function buildGiphySearchUrl(settings, query) {
    const params = [
        ['api_key', settings.get_string(GIPHY_API_KEY_KEY).trim()],
        ['q', query],
        ['limit', settingLimit(settings).toString()],
        ['rating', settingRating(settings)],
        ['lang', 'en'],
    ];
    const queryString = params
        .map(([key, value]) => `${key}=${GLib.Uri.escape_string(value, null, false)}`)
        .join('&');

    return `${GIPHY_SEARCH_URL}?${queryString}`;
}

function bytesToString(bytes) {
    return new TextDecoder().decode(bytes.get_data());
}

function mimeTypeForUrl(url) {
    const path = url.split('?')[0].toLowerCase();

    if (path.endsWith('.gif'))
        return 'image/gif';

    if (path.endsWith('.png'))
        return 'image/png';

    return 'image/jpeg';
}

function extensionForMimeType(mimeType) {
    if (mimeType === 'image/gif')
        return '.gif';

    if (mimeType === 'image/png')
        return '.png';

    return '.jpg';
}

function sanitizeFileName(name) {
    const sanitized = name
        .trim()
        .replace(/\.[^.]+$/, '')
        .replace(/[^A-Za-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);

    return sanitized || 'meme';
}

function uniqueSavePath(directoryPath, baseName, extension) {
    let candidate = GLib.build_filenamev([directoryPath, `${baseName}${extension}`]);
    let index = 2;

    while (GLib.file_test(candidate, GLib.FileTest.EXISTS)) {
        candidate = GLib.build_filenamev([directoryPath, `${baseName}-${index}${extension}`]);
        index++;
    }

    return candidate;
}

function saveOnlineMemeBytes(meme, bytes) {
    const directory = Gio.File.new_for_path(DEFAULT_SAVE_FOLDER);

    if (!directory.query_exists(null))
        directory.make_directory_with_parents(null);

    const path = uniqueSavePath(
        DEFAULT_SAVE_FOLDER,
        sanitizeFileName(meme.name),
        extensionForMimeType(meme.mimeType)
    );

    GLib.file_set_contents(path, bytes.get_data());
    return path;
}

function parseImgflipResults(payload, query, limit) {
    const response = JSON.parse(payload);
    const searchText = query.toLowerCase();

    if (!response.success || !Array.isArray(response.data?.memes))
        return [];

    return response.data.memes
        .filter(result => result.name?.toLowerCase().includes(searchText))
        .filter(result => result.url?.startsWith('https://'))
        .slice(0, limit)
        .map(result => ({
            title: result.name,
            name: result.name,
            url: result.url,
            mimeType: mimeTypeForUrl(result.url),
            source: 'Imgflip',
        }));
}

function parseGiphyResults(payload) {
    const response = JSON.parse(payload);

    if (!Array.isArray(response.data))
        return [];

    return response.data
        .map(result => {
            const image = result.images?.original ?? result.images?.downsized;
            const url = image?.url;

            if (!url?.startsWith('https://'))
                return null;

            return {
                title: result.title || 'GIPHY result',
                name: result.title || result.id || 'GIPHY result',
                url,
                mimeType: mimeTypeForUrl(url),
                source: 'GIPHY',
            };
        })
        .filter(result => result !== null);
}

function fetchBytes(session, url, cancellable, callback) {
    const message = Soup.Message.new('GET', url);

    if (!message) {
        callback(null, new Error('Invalid URL'));
        return;
    }

    session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable, (source, result) => {
        try {
            const bytes = source.send_and_read_finish(result);
            const status = message.get_status();

            if (status < 200 || status >= 300) {
                callback(null, new Error(`HTTP ${status}`));
                return;
            }

            callback(bytes, null);
        } catch (error) {
            callback(null, error);
        }
    });
}

function scanDirectory(path, memes, seen, depth = 0) {
    if (depth > MAX_SCAN_DEPTH || memes.length >= MAX_MEMES)
        return;

    const directory = Gio.File.new_for_path(path);
    let enumerator = null;

    try {
        enumerator = directory.enumerate_children(
            'standard::name,standard::type',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
            null
        );

        let info = null;
        while ((info = enumerator.next_file(null)) !== null) {
            if (memes.length >= MAX_MEMES)
                break;

            const name = info.get_name();
            const child = directory.get_child(name);
            const childPath = child.get_path();

            if (!childPath || seen.has(childPath))
                continue;

            if (info.get_file_type() === Gio.FileType.DIRECTORY) {
                scanDirectory(childPath, memes, seen, depth + 1);
                continue;
            }

            if (info.get_file_type() !== Gio.FileType.REGULAR)
                continue;

            if (!IMAGE_EXTENSIONS.has(fileExtension(name)))
                continue;

            seen.add(childPath);
            memes.push({
                title: fileTitle(name),
                name,
                path: childPath,
            });
        }
    } catch (error) {
        log(`${LOG_PREFIX} Could not scan ${path}: ${error.message}`);
    } finally {
        try {
            enumerator?.close(null);
        } catch (error) {
            log(`${LOG_PREFIX} Could not close ${path}: ${error.message}`);
        }
    }
}

function loadMemes(folderPaths) {
    const memes = [];
    const seen = new Set();

    for (const folderPath of folderPaths)
        scanDirectory(folderPath, memes, seen);

    return memes.sort((left, right) => left.name.localeCompare(right.name));
}

const MemeSearchMenuItem = GObject.registerClass(
class MemeSearchMenuItem extends PopupMenu.PopupBaseMenuItem {
    _init(onChanged, onOnlineSearch) {
        super._init({
            activate: false,
            can_focus: false,
            style_class: 'meme-selector-search-item',
        });

        this._entry = new St.Entry({
            hint_text: 'Search memes',
            can_focus: true,
            track_hover: true,
            x_expand: true,
            style_class: 'meme-selector-search-entry',
        });

        this.add_child(this._entry);

        this._textChangedId = this._entry.clutter_text.connect('text-changed', () => {
            onChanged(this._entry.clutter_text.get_text());
        });

        this._keyPressId = this._entry.clutter_text.connect('key-press-event', (_actor, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                this._entry.clutter_text.set_text('');
                return Clutter.EVENT_STOP;
            }

            const keySymbol = event.get_key_symbol();
            const isEnter = keySymbol === Clutter.KEY_Return ||
                keySymbol === Clutter.KEY_KP_Enter;
            const isCtrl = (event.get_state() & Clutter.ModifierType.CONTROL_MASK) !== 0;

            if (isEnter && isCtrl) {
                onOnlineSearch(this._entry.clutter_text.get_text());
                return Clutter.EVENT_STOP;
            }

            return Clutter.EVENT_PROPAGATE;
        });
    }

    focus() {
        this._entry.grab_key_focus();
    }

    destroy() {
        if (this._textChangedId) {
            this._entry.clutter_text.disconnect(this._textChangedId);
            this._textChangedId = 0;
        }

        if (this._keyPressId) {
            this._entry.clutter_text.disconnect(this._keyPressId);
            this._keyPressId = 0;
        }

        super.destroy();
    }
});

const MemeFileMenuItem = GObject.registerClass(
class MemeFileMenuItem extends PopupMenu.PopupBaseMenuItem {
    _init(meme, onActivated) {
        super._init({
            style_class: 'meme-selector-file-item',
        });

        const icon = new St.Icon({
            gicon: new Gio.FileIcon({
                file: Gio.File.new_for_path(meme.path),
            }),
            icon_size: 40,
            style_class: 'meme-selector-thumbnail',
        });

        const labels = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style_class: 'meme-selector-labels',
        });

        labels.add_child(new St.Label({
            text: meme.title,
            x_expand: true,
            style_class: 'meme-selector-title',
        }));
        labels.add_child(new St.Label({
            text: GLib.path_get_basename(meme.path),
            x_expand: true,
            style_class: 'meme-selector-subtitle',
        }));

        this.add_child(icon);
        this.add_child(labels);
        this.connect('activate', () => onActivated(meme));
    }
});

const MemeOnlineMenuItem = GObject.registerClass(
class MemeOnlineMenuItem extends PopupMenu.PopupBaseMenuItem {
    _init(meme, onActivated, onSave) {
        super._init({
            style_class: 'meme-selector-file-item',
        });

        this.add_child(new St.Icon({
            icon_name: 'image-x-generic-symbolic',
            icon_size: 40,
            style_class: 'meme-selector-thumbnail',
        }));

        const labels = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style_class: 'meme-selector-labels',
        });

        labels.add_child(new St.Label({
            text: meme.title,
            x_expand: true,
            style_class: 'meme-selector-title',
        }));
        labels.add_child(new St.Label({
            text: meme.source,
            x_expand: true,
            style_class: 'meme-selector-subtitle',
        }));

        this.add_child(labels);

        const saveButton = new St.Button({
            child: new St.Icon({
                icon_name: 'document-save-symbolic',
                style_class: 'system-status-icon',
            }),
            can_focus: true,
            accessible_name: `Save ${meme.name}`,
            style_class: 'meme-selector-save-button',
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: false,
        });

        saveButton.connect('clicked', () => onSave(meme));
        this.add_child(saveButton);
        this.connect('activate', () => onActivated(meme));
    }
});

const MemeSelectorIndicator = GObject.registerClass(
class MemeSelectorIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'MemeSelector');

        this._extension = extension;
        this._destroyed = false;
        this._settings = extension.getSettings();
        this._memes = [];
        this._onlineResults = [];
        this._onlineQuery = '';
        this._onlineStatus = null;
        this._onlineSearchInProgress = false;
        this._onlineSearchSerial = 0;
        this._focusIdleId = 0;
        this._searchText = '';
        this._items = [];

        this._hbox = new St.BoxLayout({
            style_class: 'panel-status-menu-box meme-selector-hbox',
        });

        this._icon = new St.Icon({
            icon_name: 'face-laugh-symbolic',
            style_class: 'system-status-icon',
        });

        this._hbox.add_child(this._icon);
        this._hbox.add_child(PopupMenu.arrowIcon(St.Side.BOTTOM));
        this.add_child(this._hbox);

        this._searchItem = new MemeSearchMenuItem(searchText => {
            const nextSearchText = searchText.toLowerCase();
            const nextOnlineQuery = queryForOnlineSearch(searchText);

            if (nextOnlineQuery !== this._onlineQuery) {
                this._onlineResults = [];
                this._onlineStatus = null;
            }

            this._searchText = nextSearchText;
            this._render();
        }, searchText => {
            this._searchOnline(searchText);
        });
        this.menu.addMenuItem(this._searchItem);

        this._section = new PopupMenu.PopupMenuSection();
        this._scrollViewMenuSection = new PopupMenu.PopupMenuSection();
        this._scrollView = new St.ScrollView({
            style_class: 'meme-selector-menu-section',
            overlay_scrollbars: true,
        });
        this._scrollView.add_child(this._section.actor);
        this._scrollViewMenuSection.actor.add_child(this._scrollView);
        this.menu.addMenuItem(this._scrollViewMenuSection);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._preferencesItem = new PopupMenu.PopupMenuItem('Preferences');
        this._preferencesItem.insert_child_at_index(new St.Icon({
            icon_name: 'preferences-system-symbolic',
            style_class: 'meme-selector-menu-icon',
            y_align: Clutter.ActorAlign.CENTER,
        }), 0);
        this._preferencesItem.connect('activate', () => {
            this._extension.openPreferences();
        });
        this._preferencesItem.visible = Main.sessionMode.allowSettings;
        this.menu.addMenuItem(this._preferencesItem);

        this._openChangedId = this.menu.connect('open-state-changed', (_menu, open) => {
            if (!open)
                return;

            this._refresh();
            if (this._focusIdleId)
                GLib.Source.remove(this._focusIdleId);

            this._focusIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._focusIdleId = 0;
                if (!this._destroyed)
                    this._searchItem.focus();
                return GLib.SOURCE_REMOVE;
            });
        });

        this._settingsChangedId = this._settings.connect(`changed::${MEME_FOLDERS_KEY}`, () => {
            this._refresh();
        });
        this._onlineSettingsChangedIds = [
            ONLINE_SEARCH_ENABLED_KEY,
            ONLINE_PROVIDER_KEY,
            GIPHY_API_KEY_KEY,
            ONLINE_RESULT_LIMIT_KEY,
            GIPHY_RATING_KEY,
        ].map(key => this._settings.connect(`changed::${key}`, () => {
            this._clearOnlineResults();
            this._render();
        }));

        this._refresh();
    }

    destroy() {
        this._destroyed = true;
        this._onlineSearchSerial++;

        if (this._focusIdleId) {
            GLib.Source.remove(this._focusIdleId);
            this._focusIdleId = 0;
        }

        if (this._openChangedId) {
            this.menu.disconnect(this._openChangedId);
            this._openChangedId = 0;
        }

        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }

        for (const id of this._onlineSettingsChangedIds ?? [])
            this._settings.disconnect(id);
        this._onlineSettingsChangedIds = [];

        this._clearItems();
        this._settings = null;

        super.destroy();
    }

    _refresh() {
        const folders = this._settings.get_strv(MEME_FOLDERS_KEY);
        this._memes = loadMemes(folders);
        this._render();
    }

    _clearItems() {
        for (const item of this._items)
            item.destroy();

        this._items = [];
    }

    _addStatus(text) {
        const item = new PopupMenu.PopupMenuItem(text, {
            activate: false,
            can_focus: false,
        });

        this._section.addMenuItem(item);
        this._items.push(item);
    }

    _addSeparator() {
        const item = new PopupMenu.PopupSeparatorMenuItem();

        this._section.addMenuItem(item);
        this._items.push(item);
    }

    _addLocalResult(meme) {
        const item = new MemeFileMenuItem(meme, selectedMeme => {
            this.menu.close();
            this._extension.copyMemeToClipboard(selectedMeme);
        });

        this._section.addMenuItem(item);
        this._items.push(item);
    }

    _addOnlineResult(meme) {
        const item = new MemeOnlineMenuItem(meme, selectedMeme => {
            this.menu.close();
            this._extension.copyMemeToClipboard(selectedMeme);
        }, selectedMeme => {
            this._extension.saveOnlineMeme(selectedMeme);
        });

        this._section.addMenuItem(item);
        this._items.push(item);
    }

    _clearOnlineResults() {
        this._onlineResults = [];
        this._onlineStatus = null;
        this._onlineSearchInProgress = false;
        this._onlineSearchSerial++;
    }

    _searchOnline(searchText) {
        const query = queryForOnlineSearch(searchText);
        const provider = settingProvider(this._settings);

        this._clearOnlineResults();
        this._onlineQuery = query;

        if (!query) {
            this._onlineStatus = 'Type a search term first';
            this._render();
            return;
        }

        if (!this._settings.get_boolean(ONLINE_SEARCH_ENABLED_KEY)) {
            this._onlineStatus = 'Enable online search in Preferences';
            this._render();
            return;
        }

        if (provider === 'giphy' && !this._settings.get_string(GIPHY_API_KEY_KEY).trim()) {
            this._onlineStatus = 'Add a GIPHY API key in Preferences';
            this._render();
            return;
        }

        const serial = ++this._onlineSearchSerial;
        this._onlineSearchInProgress = true;
        this._render();

        this._extension.searchOnline(this._settings, query, (results, error) => {
            if (this._destroyed || serial !== this._onlineSearchSerial)
                return;

            this._onlineSearchInProgress = false;
            this._onlineResults = results ?? [];
            this._onlineStatus = error
                ? `${providerTitle(provider)} search failed`
                : (this._onlineResults.length === 0 ? `No ${providerTitle(provider)} results` : null);
            this._render();
        });
    }

    _render() {
        this._clearItems();

        const folders = this._settings.get_strv(MEME_FOLDERS_KEY);
        const localMatches = this._memes.filter(meme => {
            if (!this._searchText)
                return true;

            return meme.name.toLowerCase().includes(this._searchText) ||
                meme.path.toLowerCase().includes(this._searchText);
        });
        let hasResults = false;

        for (const meme of localMatches.slice(0, MAX_VISIBLE_MEMES)) {
            this._addLocalResult(meme);
            hasResults = true;
        }

        if (localMatches.length > MAX_VISIBLE_MEMES)
            this._addStatus(`Showing ${MAX_VISIBLE_MEMES} of ${localMatches.length} local matches`);

        if (this._onlineSearchInProgress) {
            if (hasResults)
                this._addSeparator();

            this._addStatus(`Searching ${providerTitle(settingProvider(this._settings))}...`);
            hasResults = true;
        } else if (this._onlineResults.length > 0) {
            if (hasResults)
                this._addSeparator();

            this._addStatus(`${providerTitle(settingProvider(this._settings))}: ${this._onlineQuery}`);
            for (const meme of this._onlineResults)
                this._addOnlineResult(meme);

            hasResults = true;
        } else if (this._onlineStatus) {
            if (hasResults)
                this._addSeparator();

            this._addStatus(this._onlineStatus);
            hasResults = true;
        }

        if (hasResults)
            return;

        if (folders.length === 0) {
            this._addStatus('Add meme folders in Preferences');
        } else if (this._memes.length === 0) {
            this._addStatus('No JPG, JPEG, or PNG memes found');
        } else {
            this._addStatus('No matching memes');
        }
    }
});

export default class MemeSelectorExtension extends Extension {
    enable() {
        this._enabled = true;
        this._networkCancellable = new Gio.Cancellable();
        this._session = new Soup.Session();
        this._indicator = new MemeSelectorIndicator(this);
        Main.panel.addToStatusArea('memeSelector', this._indicator, 2);
    }

    disable() {
        this._enabled = false;
        this._indicator?.destroy();
        this._indicator = null;
        this._networkCancellable?.cancel();
        this._networkCancellable = null;
        this._session?.abort();
        this._session = null;
    }

    searchOnline(settings, query, callback) {
        const provider = settingProvider(settings);
        const url = provider === 'giphy'
            ? buildGiphySearchUrl(settings, query)
            : IMGFLIP_MEMES_URL;

        fetchBytes(this._session, url, this._networkCancellable, (bytes, error) => {
            if (!this._enabled)
                return;

            if (error) {
                logError(error, `${LOG_PREFIX} ${providerTitle(provider)} search failed`);
                callback(null, error);
                return;
            }

            try {
                const payload = bytesToString(bytes);
                const results = provider === 'giphy'
                    ? parseGiphyResults(payload)
                    : parseImgflipResults(payload, query, settingLimit(settings));

                callback(results, null);
            } catch (parseError) {
                logError(parseError, `${LOG_PREFIX} Could not parse ${providerTitle(provider)} response`);
                callback(null, parseError);
            }
        });
    }

    copyMemeToClipboard(meme) {
        if (meme.url) {
            this._copyOnlineMemeToClipboard(meme);
            return;
        }

        try {
            const bytes = loadImageAsPngBytes(meme.path);

            if (!bytes) {
                Main.notify('Meme Selector', `Could not read ${meme.name}`);
                return;
            }

            St.Clipboard.get_default().set_content(
                CLIPBOARD_TYPE,
                'image/png',
                bytes
            );
            Main.notify('Meme Selector', `Copied ${meme.name} as PNG`);
        } catch (error) {
            logError(error, `${LOG_PREFIX} Failed to copy ${meme.path}`);
            Main.notify('Meme Selector', `Could not copy ${meme.name}`);
        }
    }

    _copyOnlineMemeToClipboard(meme) {
        fetchBytes(this._session, meme.url, this._networkCancellable, (bytes, error) => {
            if (!this._enabled)
                return;

            if (error) {
                logError(error, `${LOG_PREFIX} Could not download ${meme.name}`);
                Main.notify('Meme Selector', `Could not copy ${meme.name}`);
                return;
            }

            let clipboardBytes = null;

            try {
                clipboardBytes = meme.mimeType === 'image/gif'
                    ? bytes
                    : imageBytesToPngBytes(bytes);
            } catch (conversionError) {
                logError(conversionError, `${LOG_PREFIX} Could not convert ${meme.name}`);
            }

            if (!clipboardBytes) {
                Main.notify('Meme Selector', `Could not copy ${meme.name}`);
                return;
            }

            St.Clipboard.get_default().set_content(
                CLIPBOARD_TYPE,
                meme.mimeType === 'image/gif' ? 'image/gif' : 'image/png',
                clipboardBytes
            );
            Main.notify('Meme Selector', `Copied ${meme.name} from ${meme.source}`);
        });
    }

    saveOnlineMeme(meme) {
        fetchBytes(this._session, meme.url, this._networkCancellable, (bytes, error) => {
            if (!this._enabled)
                return;

            if (error) {
                logError(error, `${LOG_PREFIX} Could not download ${meme.name}`);
                Main.notify('Meme Selector', `Could not save ${meme.name}`);
                return;
            }

            try {
                const path = saveOnlineMemeBytes(meme, bytes);
                Main.notify('Meme Selector', `Saved to ${path}`);
            } catch (saveError) {
                logError(saveError, `${LOG_PREFIX} Could not save ${meme.name}`);
                Main.notify('Meme Selector', `Could not save ${meme.name}`);
            }
        });
    }
}
