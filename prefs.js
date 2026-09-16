import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const MEME_FOLDERS_KEY = 'meme-folders';
const ONLINE_SEARCH_ENABLED_KEY = 'online-search-enabled';
const ONLINE_PROVIDER_KEY = 'online-provider';
const GIPHY_API_KEY_KEY = 'giphy-api-key';
const ONLINE_RESULT_LIMIT_KEY = 'online-result-limit';
const GIPHY_RATING_KEY = 'giphy-rating';

function uniqueFolderPaths(paths) {
    const seen = new Set();
    const folders = [];

    for (const path of paths) {
        if (!path || seen.has(path))
            continue;

        seen.add(path);
        folders.push(path);
    }

    return folders;
}

export default class MemeSelectorPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        this._settings = this.getSettings();
        this._folderRows = [];

        const page = new Adw.PreferencesPage({
            title: 'Memes',
            icon_name: 'face-laugh-symbolic',
        });

        this._foldersGroup = new Adw.PreferencesGroup({
            title: 'Meme Folders',
            description: 'Folders are scanned recursively for JPG, JPEG, and PNG images.',
        });

        const addRow = new Adw.ActionRow({
            title: 'Add Folder',
            subtitle: 'Choose one or more local folders that contain meme images.',
        });
        const addButton = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            valign: Gtk.Align.CENTER,
        });

        addButton.connect('clicked', () => this._selectFolders(window));
        addRow.add_suffix(addButton);
        addRow.activatable_widget = addButton;

        this._foldersGroup.add(addRow);
        page.add(this._foldersGroup);

        const onlineGroup = new Adw.PreferencesGroup({
            title: 'Online Search',
            description: 'Ctrl+Enter searches the selected provider with the current query.',
        });

        const enabledRow = new Adw.SwitchRow({
            title: 'Enable Online Search',
        });
        this._settings.bind(
            ONLINE_SEARCH_ENABLED_KEY,
            enabledRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        onlineGroup.add(enabledRow);

        const providerRow = new Adw.ActionRow({
            title: 'Internet Provider',
        });
        const providerCombo = new Gtk.ComboBoxText({
            valign: Gtk.Align.CENTER,
        });

        providerCombo.append('imgflip', 'Imgflip');
        providerCombo.append('giphy', 'GIPHY');
        providerCombo.set_active_id(this._settings.get_string(ONLINE_PROVIDER_KEY) || 'imgflip');
        providerCombo.connect('changed', combo => {
            this._settings.set_string(ONLINE_PROVIDER_KEY, combo.get_active_id() ?? 'imgflip');
        });
        providerRow.add_suffix(providerCombo);
        onlineGroup.add(providerRow);

        const apiKeyRow = new Adw.PasswordEntryRow({
            title: 'GIPHY API Key',
            text: this._settings.get_string(GIPHY_API_KEY_KEY),
        });
        apiKeyRow.connect('notify::text', row => {
            this._settings.set_string(GIPHY_API_KEY_KEY, row.text.trim());
        });
        onlineGroup.add(apiKeyRow);

        const limitRow = new Adw.ActionRow({
            title: 'Online Result Limit',
        });
        const limitButton = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 25,
                step_increment: 1,
                page_increment: 5,
            }),
            numeric: true,
            valign: Gtk.Align.CENTER,
        });
        limitButton.set_value(this._settings.get_int(ONLINE_RESULT_LIMIT_KEY));
        limitButton.connect('value-changed', button => {
            this._settings.set_int(ONLINE_RESULT_LIMIT_KEY, button.get_value_as_int());
        });
        limitRow.add_suffix(limitButton);
        onlineGroup.add(limitRow);

        const ratingRow = new Adw.ActionRow({
            title: 'GIPHY Rating',
        });
        const ratingCombo = new Gtk.ComboBoxText({
            valign: Gtk.Align.CENTER,
        });

        for (const rating of ['g', 'pg', 'pg-13', 'r'])
            ratingCombo.append(rating, rating);

        ratingCombo.set_active_id(this._settings.get_string(GIPHY_RATING_KEY));
        ratingCombo.connect('changed', combo => {
            this._settings.set_string(GIPHY_RATING_KEY, combo.get_active_id() ?? 'g');
        });
        ratingRow.add_suffix(ratingCombo);
        onlineGroup.add(ratingRow);

        page.add(onlineGroup);
        window.add(page);

        this._changedId = this._settings.connect(`changed::${MEME_FOLDERS_KEY}`, () => {
            this._refreshFolderRows();
        });
        window.connect('close-request', () => {
            if (this._changedId) {
                this._settings.disconnect(this._changedId);
                this._changedId = 0;
            }

            return false;
        });

        this._refreshFolderRows();
    }

    _getFolders() {
        return this._settings.get_strv(MEME_FOLDERS_KEY);
    }

    _setFolders(paths) {
        this._settings.set_strv(MEME_FOLDERS_KEY, uniqueFolderPaths(paths));
    }

    _refreshFolderRows() {
        for (const row of this._folderRows)
            this._foldersGroup.remove(row);

        this._folderRows = [];

        for (const folderPath of this._getFolders()) {
            const row = new Adw.ActionRow({
                title: folderPath,
            });
            const removeButton = new Gtk.Button({
                icon_name: 'user-trash-symbolic',
                valign: Gtk.Align.CENTER,
            });

            removeButton.connect('clicked', () => {
                this._setFolders(this._getFolders().filter(path => path !== folderPath));
            });

            row.add_suffix(removeButton);
            row.activatable_widget = removeButton;
            this._foldersGroup.add(row);
            this._folderRows.push(row);
        }
    }

    _selectFolders(parent) {
        const dialog = new Gtk.FileChooserNative({
            title: 'Select Meme Folders',
            transient_for: parent,
            modal: true,
            action: Gtk.FileChooserAction.SELECT_FOLDER,
            accept_label: 'Add',
            cancel_label: 'Cancel',
        });

        dialog.set_select_multiple(true);
        dialog.connect('response', (chooser, response) => {
            if (response === Gtk.ResponseType.ACCEPT) {
                const selectedPaths = [];
                const files = chooser.get_files();

                for (let index = 0; index < files.get_n_items(); index++) {
                    const file = files.get_item(index);
                    const path = file instanceof Gio.File ? file.get_path() : null;

                    if (path)
                        selectedPaths.push(path);
                }

                this._setFolders([
                    ...this._getFolders(),
                    ...selectedPaths,
                ]);
            }

            chooser.destroy();
        });
        dialog.show();
    }
}
