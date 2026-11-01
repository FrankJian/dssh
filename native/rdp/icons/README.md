# RDP client icon

Graphite glass, silver monitor and overlapping ice-blue screens, coordinated with
the Duo SSH application icon. Original artwork generated with imagegen.

- `rdp.png`: 1024px transparent master, embedded into the macOS worker for its Dock
  and application-switcher icon. No adjacent image file is required at runtime.
- `rdp.ico`: multi-resolution Windows executable, taskbar and window icon.

To regenerate Windows sizes after replacing the master:

```sh
pnpm tauri icon native/rdp/icons/rdp.png --output .cache/rdp/icon-formats
cp .cache/rdp/icon-formats/icon.ico native/rdp/icons/rdp.ico
```

Run `pnpm rdp:build` to embed changes; Tauri HMR cannot update the native worker.
