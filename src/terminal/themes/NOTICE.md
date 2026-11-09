# Terminal palette notices

The built-in Nord palette uses the colors from [Nord v0.2.0](https://github.com/nordtheme/nord/releases/tag/v0.2.0), created by Sven Greb. The application maps Nord colors to the xterm 16-color ANSI slots and supplies its own cursor and selection colors.

The built-in Solarized Dark and Solarized Light palettes use the colors and mode mapping from [Solarized v1.0.0beta2](https://github.com/altercation/solarized/releases/tag/v1.0.0beta2), created by Ethan Schoonover. The application maps the Solarized palette to xterm ANSI slots and supplies its own cursor and selection colors.

The built-in Catppuccin Mocha and Catppuccin Latte palettes use the complete terminal mapping from the [Catppuccin Kitty port](https://github.com/catppuccin/kitty/tree/main/themes). The application starts from the upstream ANSI slots and supplies its inactive-selection color.

The built-in Tokyo Night and Tokyo Night Day palettes use the terminal mapping from [TokyoNight's Alacritty extras](https://github.com/folke/tokyonight.nvim/tree/main/extras/alacritty). The application starts from the upstream ANSI slots and supplies cursor and selection colors.

The built-in Gruvbox Dark and Gruvbox Light palettes use the official medium-contrast palette and terminal ANSI mapping from [Gruvbox](https://github.com/morhetz/gruvbox). The application supplies cursor and selection colors.

The Graphite Dark, Graphite Light, Graphite Contrast, and Porcelain White palettes are original Duo SSH palettes.

## Writable-directory accent adaptation

All built-in palettes adapt ANSI green / bright green (slots 2 / 10) to a blue, cyan, purple or amber accent from the same palette. Linux `ls` commonly uses slot 2 as the background for other-writable directories. This also changes all text and other backgrounds using these ANSI slots. Other ANSI slots and upstream background / foreground colors remain as documented below. Saved custom palettes retain their literal colors and are never remapped.

## Screenshot gallery palettes

The 18 additional gallery presets start from upstream background, foreground, cursor and all 16 ANSI slots. Duo SSH supplies cursor text, low-contrast active/inactive selection colors, and preserves each cell’s foreground when selected. The renderer's minimum-contrast protection may adjust low-contrast text against its cell background.

Sixteen palettes are sourced from [Gogh's theme data at revision 3277da1a295142cd8664e0657c5a3c2a44cc520a](https://github.com/Gogh-Co/Gogh/blob/3277da1a295142cd8664e0657c5a3c2a44cc520a/data/themes.json). Copyright (c) 2024 Gogh. Used under the [MIT License](https://github.com/Gogh-Co/Gogh/blob/3277da1a295142cd8664e0657c5a3c2a44cc520a/LICENSE-MIT), reproduced below.

The two Base2Tone Light palettes are sourced from [Base2Tone-iterm2 at revision 693baf6ec5ce4858f01aa3b1a81c0851c2b617e3](https://github.com/atelierbram/Base2Tone-iterm2/tree/693baf6ec5ce4858f01aa3b1a81c0851c2b617e3/ColorPresets). Copyright (c) 2016 Bram de Haan. Used under the MIT License, reproduced below.

Upstream author credits:

| Palette | Author |
| --- | --- |
| Light Owl | zasdaym (https://github.com/zasdaym) |
| OneHalfLight | sonph (https://github.com/sonph) |
| PencilLight | mattly (https://github.com/mattly/iterm-colors-pencil) |
| Piatto Light | kovv (https://github.com/kovv) |
| AtomOneLight | iamstarkov (https://github.com/iamstarkov) |
| ayu_light | alebcay (https://github.com/alebcay) |
| base2tone-heath-light | Bram de Haan |
| base2tone-morning-light | Bram de Haan |
| 3024 Night | 0x3024 (https://github.com/0x3024) |
| Belafonte Night | idleberg (https://github.com/idleberg) |
| Night Owl | zasdaym (https://github.com/zasdaym) |
| NightLion v1 | Curvve Media (http://www.curvve.com/blog/category/themes/) |
| NightLion v2 | Curvve Media (http://www.curvve.com/blog/category/themes/) |
| TokyoNight Storm | folke (https://github.com/folke/tokyonight.nvim) |
| Tomorrow Night | Chris Kempson (http://chriskempson.com) |
| Tomorrow Night Blue | Chris Kempson (http://chriskempson.com) |
| Tomorrow Night Bright | Chris Kempson (http://chriskempson.com) |
| Tomorrow Night Eighties | Chris Kempson (http://chriskempson.com) |

## Nord

Copyright © 2016-present Sven Greb. Licensed under the MIT License.

## Solarized

Copyright © 2011 Ethan Schoonover. Licensed under the MIT License.

## Catppuccin

Copyright © 2021 Catppuccin. Licensed under the MIT License.

## Tokyo Night

Copyright © 2020-present folke. Licensed under the Apache License, Version 2.0. See [the upstream license](https://github.com/folke/tokyonight.nvim/blob/main/LICENSE).

## Gruvbox

Copyright © 2013-2025 Pavel Pertsev. Licensed under the MIT/X11 License.

## MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the “Software”), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
