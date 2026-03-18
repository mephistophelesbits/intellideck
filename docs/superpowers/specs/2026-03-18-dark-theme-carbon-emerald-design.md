# Dark Theme Redesign: Carbon + Emerald

**Date:** 2026-03-18
**Status:** Approved
**Scope:** Dark mode only — light theme untouched

---

## Problem

The existing dark theme (`stitch-dark`) uses blue-tinted backgrounds (`#0a0c12`, `#161b2a`) and a pure blue accent (`#1152d4`). The result is an overall blue cast that the user wants replaced.

---

## Solution

Replace the dark theme's color tokens with a **Carbon + Emerald** palette:
- **Base:** Pure black and neutral dark greys (no blue pigment)
- **Accents:** Emerald green (`#22c55e`) for interactive elements, highlights, and active states
- **Text:** Neutral grey foreground (no slate-blue tint)

---

## File Affected

`app/globals.css` — single source of truth for all theme tokens.

---

## Token Changes

### `.dark` CSS block

| Token | Old Value | New Value | Reason |
|---|---|---|---|
| `--background` | `#0a0c12` | `#0d0d0d` | Pure black, no blue tint |
| `--background-secondary` | `#161b2a` | `#141414` | Neutral dark grey surface |
| `--background-tertiary` | `rgba(22,27,42,0.7)` | `rgba(20,20,20,0.7)` | Neutral semi-transparent overlay |
| `--foreground-secondary` | `#94a3b8` | `#9ca3af` | Neutral grey, removes blue-slate tint |
| `--accent` | `#1152d4` | `#22c55e` | Emerald green replaces blue |
| `--accent-hover` | `#1e5fe8` | `#16a34a` | Deeper green on hover |
| `--accent-light` | `rgba(17,82,212,0.2)` | `rgba(34,197,94,0.15)` | Subtle emerald tint for highlights |
| `--border` | `#2d3446` | `#262626` | Neutral dark border, no blue |
| `--success` | `#10b981` | `#22c55e` | Unified with accent for consistency |

`--foreground`, `--error`, `--warning`, `--accent-foreground` are unchanged.

---

## Scrollbar CSS Changes

All hardcoded `rgba(17, 82, 212, ...)` values in dark-mode scrollbar rules replaced with `rgba(34, 197, 94, ...)` equivalents:

| Rule | Old | New |
|---|---|---|
| `.dark .column-scroll` thumb | `rgba(255,255,255,0.1)` | unchanged (neutral — keep) |
| `.dark .deck-scroll` thumb | `rgba(255,255,255,0.2)` | unchanged (neutral — keep) |
| `.deck-scroll` thumb (light) | `rgba(17,82,212,0.3)` | unchanged (light mode — skip) |

Only the dark-specific scrollbar overrides matter; most are already neutral white-rgba and need no change.

---

## Glass Card Shadow

| Rule | Old | New |
|---|---|---|
| `.glass-card` box-shadow | `rgba(17,82,212,0.05)` | `rgba(34,197,94,0.04)` |

---

## Out of Scope

- Light mode tokens — no changes
- Component-level hardcoded colors — all components use CSS variables, so token changes propagate automatically
- New theme variant — this replaces `.dark` in place; no new class added

---

## Testing Checklist

- [ ] Toggle dark mode — backgrounds are black/dark grey, no blue cast
- [ ] Hover over links, buttons, active states — green accent visible
- [ ] Column headers and settings dropdown — correct surface colors
- [ ] Scrollbars — neutral, no blue tinge
- [ ] Light mode — completely unchanged
