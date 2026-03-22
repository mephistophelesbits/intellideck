# Cyberpunk Neon Dark Theme — Design Spec

**Date:** 2026-03-22
**Status:** Approved
**Scope:** Replace the `stitch-dark` color tokens with a Cyberpunk Neon palette

---

## Overview

Replace the warm red-orange palette of the existing `stitch-dark` theme ("Reader Studio") with a techno-gamer Cyberpunk Neon palette — electric cyan accent on deep blue-black backgrounds, with violet-tinted borders.

The theme `id` remains `'stitch-dark'` so all existing user settings continue to resolve correctly without migration.

---

## Color Token Changes

All changes are in `lib/settings-store.ts`, in the `themes` array, `stitch-dark` object.

| Token | Old Value | New Value | Notes |
|---|---|---|---|
| `name` | `'Reader Studio (Dark)'` | `'Cyberpunk Neon (Dark)'` | Display name only |
| `background` | `'#09090f'` | `'#0a0a12'` | Near-black, blue tint |
| `backgroundSecondary` | `'#222226'` | `'#12121f'` | Dark blue-black for cards/nav |
| `backgroundTertiary` | `'rgba(33, 20, 19, 0.7)'` | `'#050510'` | Deep near-black for reading panel — deliberately darker to create depth contrast |
| `foreground` | `'#ffffff'` | `'#e0e0ff'` | Slightly blue-tinted white |
| `foregroundSecondary` | `'#88888a'` | `'#8888aa'` | Muted blue-grey for metadata |
| `accent` | `'#e8482c'` | `'#00e5ff'` | Electric cyan — primary interactive colour |
| `accentHover` | `'#ef6042'` | `'#33eeff'` | Lighter cyan on hover |
| `accentForeground` | _(not set)_ | `'#000000'` | Black text on cyan buttons for legibility |
| `border` | `'#362928'` | `'#1e1e3a'` | Deep violet border |
| `isDark` | `true` | `true` | Unchanged |
| `fontFamily` | `'var(--font-dm-sans), sans-serif'` | `'var(--font-dm-sans), sans-serif'` | Unchanged |

---

## Design Rationale

- **Electric cyan `#00e5ff`** is the signature gamer accent — highly saturated, high contrast against dark backgrounds, universally associated with cyberpunk/sci-fi UI aesthetics.
- **Deep violet borders `#1e1e3a`** reinforce the cool-toned palette without competing with the cyan accent.
- **`backgroundTertiary: '#050510'`** is intentionally the darkest surface — used for the inline reading column and overlays — creating clear visual depth hierarchy (columns sit above the reading panel).
- **`accentForeground: '#000000'`** is required because white text on `#00e5ff` fails WCAG AA contrast; black passes.
- The theme `id` is preserved to avoid breaking persisted user preferences.

---

## Affected File

- `lib/settings-store.ts` — update the `stitch-dark` entry in the `themes` array (lines ~35–48)

No other files need to change. All theme-consuming components reference CSS variables set by `ThemeProvider.tsx`, which reads from `themes` by id.

---

## Out of Scope

- The `stitch-light` theme is unchanged.
- No CSS variable names change.
- No font or layout changes.
