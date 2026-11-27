# Duo SSH Design Language

> Repository-wide UI rules for all editors and coding agents, required by [`AGENTS.md`](../AGENTS.md). Follow the direction in [interface checklist](design/interface-checklist.md). The former Graphite Glass palette is documented as an implementation record, not the current visual target.

## Mandatory for every UI change
- Apply this design language to new screens, incremental features, and small fixes alike. Follow the [mandatory checklist](design/interface-checklist.md#强制执行每次界面改动) before delivery.
- Settings use aligned label/control rows, shared segmented choices for a few short mutually exclusive options, and shared switches for booleans. Keep numeric values and units in one rounded control; put reset actions beside the group title.
- Prefer clear grouping and control states over explanations. Omit persistent small-print descriptions of routine behavior, defaults, or keyboard operations; do not replace removed helper text with another explanatory line. Show necessary feedback when errors occur or an irreversible risk needs confirmation.
- Check affected light/dark palettes, narrow layouts, keyboard focus, disabled/error states, and persistence behavior. Report the actual verification performed; a successful build alone does not establish visual correctness.

## Intent
- Build a polished Windows/macOS developer tool with a calm, approachable shape language and clear workspace hierarchy.
- Keep task content, predictable interaction, and fast feedback prominent while giving controls and groups enough room to breathe.

## Use the existing system
- Reuse shared UI components from `src/ui/`, layout primitives, and tokens/classes in `src/theme/global.css`.
- Use semantic CSS variables for color, spacing, radius, and material. Do not introduce literal colors in components. Keep the custom app palette separate from the light/dark appearance axis and from terminal color schemes.
- Use the existing `Icon` component with outlined, single-color 16px or 18px icons for actions and folders. File-type identities use the bundled Seti symbols through `FileEntryIcon`, as requested for the editor; keep those symbols consistent across file trees, file tabs, breadcrumbs and file lists. Do not introduce other filled or decorative iconography.

## Layout and hierarchy
- Prefer the desktop structure: title bar, compact toolbar, activity/sidebar navigation, main content, and status feedback.
- Keep trees, tables, split views, toolbars, context menus, and inline forms where they serve the workflow. Group related actions near the content they affect.
- Use a consistent spacing scale, readable type hierarchy, concise labels, and deliberate gutters. Give page-level groups more breathing room without making terminal, editor, and file rows wasteful.
- Prefer soft, coherent corner geometry: rounded toolbars, inputs, tabs, selections, dialogs, and page-level surfaces. Use nested radii and consistent insets; avoid a screen made of hard-edged rectangular blocks or a stack of unrelated cards. Small data cells and dense rows may remain simple for legibility.
- Separate regions primarily through surface tone, spacing, and subtle borders. Avoid thick outlines, heavy shadows, oversized hero areas, and decorative cards.
- Avoid unnecessary helper labels and explanations. Let grouping, alignment, control labels, and visible states explain the interface; keep copy when it changes a decision, prevents a mistake, or communicates a non-obvious consequence.

## Color and material direction
- Use the default soft mineral surfaces, sea-glass interaction color, and restrained warm detail as the visual baseline. Custom app colors must update surfaces, text, borders, and states together; do not tint only the accent.
- Treat appearance (light/dark/system), app palette, and terminal color scheme as distinct settings. Every app palette needs light and dark token variants, accessible state colors, and a solid-surface fallback.
- Glass may add depth to stable chrome, navigation, menus, and overlays. Keep it restrained and legible; terminal, Monaco, remote desktops, and long scrolling content remain stable, near-opaque surfaces. Do not stack blur layers without a clear hierarchy.

## Controls and states
- In settings, use the shared `SettingsSwitch` for on/off controls. Align labels on the left and switches on the right. Use a selector or segmented control for mutually exclusive choices.
- Toolbar actions are transparent until hover. Use filled primary actions only for the single most important action in a focused workflow.
- Make hover, focus, disabled, loading, selected, error, and destructive states visually distinct without relying on color alone.
- Add accessible labels for icon-only buttons; preserve keyboard navigation and native text-selection/context-menu behavior where appropriate.
- Confirm destructive or irreversible actions, and keep cancellation/close actions visible in dialogs.

## Motion
- Keep transitions subtle and functional (about 150ms): opacity, color, or small positional changes only.
- Do not use bounce, scale, large movement, or animation that delays input.

## Design check
- Before finishing UI work, ask: Is the main task visible first? Do the curves, spacing, and surfaces feel coherent? Can the user understand available actions and states? Does the result work across palettes, appearances, window sizes, and reduced transparency?
