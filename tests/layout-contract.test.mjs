import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const extensionSource = await readFile(new URL('../extension.js', import.meta.url), 'utf8');
const stylesheet = await readFile(new URL('../stylesheet.css', import.meta.url), 'utf8');

test('menu layout reserves scrollbar space inside a fixed-width panel', () => {
    assert.match(stylesheet, /\.meme-selector-menu\s*\{[\s\S]*?width:\s*38em;/);
    assert.match(stylesheet, /\.meme-selector-menu\s*\{[\s\S]*?min-width:\s*38em;/);
    assert.match(stylesheet, /\.meme-selector-menu\s*\{[\s\S]*?max-width:\s*38em;/);
    assert.match(extensionSource, /overlay_scrollbars:\s*false/);
});

test('meme titles ellipsize by default and wrap while the result is hovered', () => {
    assert.match(extensionSource, /Pango\.EllipsizeMode\.END/);
    assert.match(extensionSource, /Pango\.EllipsizeMode\.NONE/);
    assert.match(extensionSource, /setTitleExpanded\(label,\s*item\.hover\)/);
});
