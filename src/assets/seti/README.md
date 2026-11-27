# Seti file icons

Bundled from the Seti File Icon Theme shipped with Visual Studio Code 1.148.0,
theme version 10.0.0, VS Code commit `661626d0e72f97806550790a98fb87116c9db825`.
Source: https://github.com/microsoft/vscode/tree/661626d0e72f97806550790a98fb87116c9db825/extensions/theme-seti
Original Seti UI project: https://github.com/jesseweed/seti-ui
License: MIT; copyright/permission notices are retained in
`public/licenses/seti.txt`, copied into the application bundle by Vite.

The font and JSON associations are unmodified. `src/sftp/fileIconTheme.ts` adds
filename-to-language fallback associations because Duo SSH does not load VS Code
language extensions. Folder/expanded-folder and symlink overlays remain Duo SSH
controls. No executable extension code is bundled.

SHA-256:
- `seti.woff`: `b127762058f89b37b08d76185e3b0558f5c28859e39a3840a27cb28b9739d6e2`
- `vs-seti-icon-theme.json`: `bbc6de399ac76b43a986237ae86dc714d0fee2df906924cba495d442b9a0066c`
