# Plan: Restyle Presenton with Evri Branding

## Context

Rebrand the Presenton UI to use Evri's brand identity (from Brandfetch). Evri uses **blue (#007BC4)** as primary, **turquoise (#53EFEF)** as accent, **dark navy (#00014D)** as dark, and **Poppins** as the typeface.

## Evri Brand Assets

| Element | Value |
|---------|-------|
| Primary (Lochmara) | `#007BC4` → HSL `202 100% 38%` |
| Accent (Turquoise) | `#53EFEF` → HSL `180 83% 63%` |
| Dark (Stratos) | `#00014D` → HSL `239 100% 15%` |
| Font | Poppins (Google Fonts) |
| Logo SVG | `cdn.brandfetch.io/iddnldpfyE/theme/dark/logo.svg` |
| Icon | `cdn.brandfetch.io/iddnldpfyE/w/400/h/400/theme/dark/icon.jpeg` |

## Changes

### 1. Download & replace logo assets
- Download Evri logos → replace `servers/nextjs/public/Logo.png` and `servers/nextjs/public/logo-white.png`
- Download Evri icon → replace `servers/nextjs/app/icon1.svg`
- Update `alt` text from "Presenton" → "Evri" in 5 files

### 2. Font: Inter/Instrument Sans/Roboto → Poppins
- **`servers/nextjs/app/layout.tsx`** — Replace font imports with `Poppins` from `next/font/google`
- **`servers/nextjs/app/globals.css`** — Update body font-family
- **`servers/nextjs/tailwind.config.ts`** — Replace fontFamily entries with `poppins`
- Replace `font-instrument_sans`, `font-inter`, `font-roboto` class usages → `font-poppins`

### 3. Theme variables (`servers/nextjs/app/globals.css`)
Update `:root` CSS variables:
- `--primary: 202 100% 38%` (Evri Blue)
- `--primary-foreground: 0 0% 100%` (white)
- `--accent: 180 83% 63%` (Evri Turquoise)
- `--accent-foreground: 239 100% 15%` (navy)
- `--ring: 202 100% 38%`
- `::selection` background → Evri blue

### 4. Add Evri colors to Tailwind config
Add to `tailwind.config.ts` `theme.extend.colors`:
```ts
evri: { blue: '#007BC4', turquoise: '#53EFEF', navy: '#00014D' }
```

### 5. Replace hardcoded blue/indigo classes → Evri colors
Systematic replacement across ~25 component files:
- `blue-600`/`blue-700` → `evri-blue`
- `blue-50`/`blue-100` → `evri-blue/5`, `evri-blue/10`
- `blue-200`/`blue-300` → `evri-blue/20`, `evri-blue/30`
- `blue-800` → `evri-navy`
- `indigo-*` → `evri-blue` or `evri-navy`
- Gradients: `from-blue-600 to-indigo-600` → `from-evri-blue to-evri-navy`
- Focus rings: `focus:ring-blue-200` → `focus:ring-evri-blue/20`

**Key files:** Home.tsx, Header.tsx, SettingPage.tsx, ConfigurationSelects.tsx, OutlineContent.tsx, TemplateSelection.tsx, EmptyStateView.tsx, TiptapText.tsx, ImageEditor.tsx, LoadingStates.tsx, CodexConfig.tsx, AnthropicConfig.tsx, OpenAIConfig.tsx, GoogleConfig.tsx, CustomConfig.tsx, LLMSelection.tsx, ConfigurationInitializer.tsx, not-found.tsx, and custom-template components

### 6. Update brand text
- Tagline in Home.tsx → "Evri Presentations" or similar
- Alt text on logos → "Evri"

## Verification
- `cd servers/nextjs && npm run build` — confirm no build errors
- Visual check that colors, fonts, and logos are Evri-branded
