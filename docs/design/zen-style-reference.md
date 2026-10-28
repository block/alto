# Zen visual rules for Alto

Research reference, 2026-10-28. Zen source is pinned to [7133db8][zen-revision]; Alto's starting point is checkpoint 3740b84 on jm/vertical-tabs. This document proposes subsequent design passes. It does not change the running interface.

Zen extends Firefox, so its appearance comes from inherited controls, Zen overrides, platform rules, and preferences. The values below are representative source values, not a universal specification supplied by Zen. “Alto proposal” identifies our interpretation and proposed adaptation.

## Design direction

My interpretation of Zen's implementation is that a visibly colored window frame can coexist with restrained controls. Most controls share an ink color and acquire a light surface on interaction. Selection, primary actions, and floating panels receive progressively stronger treatment. Typography and alignment carry much of the hierarchy.

For Alto, retain the approved accent glass, rounded composer, rounded tabs, and shared horizontal/vertical tab styling. Extend the control rules component by component.

## Color and material

**Zen implementation.** The theme derives related surface, border, and foreground colors from its primary accent. Dialog and address-field surfaces receive little color. [Theme colors][zen-colors] Toolbar hover and press use approximately 7% and 10% contrasting ink. These percentages belong to toolbar controls; other button contexts differ. [Toolbar states][zen-toolbar-states]

**Alto proposal.** Separate decorative color from actionable color. A bright workspace hue can remain noticeable in the glass while an action uses a darker or lighter version of that hue for readable text.

| Role | Alto rule |
| --- | --- |
| Frame | Keep the current accent wash over native material. Derive the opaque fallback from the same hue and surface family. |
| Content | Keep a stable reading surface related to the frame's palette. |
| Raised | Use for the composer and floating panels. A selected tab can use a translucent version appropriate to the frame. |
| Recessed | Use for user bubbles and embedded regions that need separation without another shadow. |
| Interaction | Define hover, press, selected, and open fills for each surface context. Reuse those roles across components. |
| Ink | Use primary, supporting, and disabled levels with consistent meanings. Enabled controls on glass need sufficient contrast against varying backdrops. |
| Action | Derive a readable action color from the accent. Do not reuse the raw decorative tint indiscriminately. |
| Status | Preserve distinct error, warning, success, and activity meanings independently of the workspace hue. |

Paint the window tint once. Repeated opaque fills or blur layers inside tabs and toolbars would obscure the material we just established. Menu and dialog readability should come from their own surface, rather than increasingly darkening the entire window.

## Fonts and hierarchy

**Zen implementation.** macOS chrome uses SF Pro with system fallbacks; Windows uses Segoe UI. [Platform fonts][zen-fonts] The packaged Junicode serif is used for large branding titles. [Brand typography][zen-branding] Ordinary buttons use weight 500, with 600 on prominent accent actions. [Button typography][zen-buttons]

**Alto proposal.** Use the existing native UI font throughout navigation, toolbars, forms, and dialogs. Preserve the conversation's reading sizes and code font. Reserve a display serif, if ever adopted, for a deliberate branding or welcome screen.

The following is an Alto scale to evaluate, not a font scale extracted from Zen:

| Role | Starting treatment |
| --- | --- |
| Metadata and keyboard hints | 11–12px, regular, supporting ink |
| Tabs, menu items, compact controls | 12–13px, regular; medium for selected items or action labels |
| Conversation body | Retain the current reading size and line height |
| Composer | Retain its current typography and shape |
| Section headings | 14–16px, medium or semibold, with spacing that establishes the section |

Use 400, 500, and 600 as the main weight steps. Avoid making every navigation label semibold. Establish hierarchy through size, spacing, and selection before adding more weight or reducing opacity.

## Buttons

**Zen implementation.** Zen distinguishes faint secondary fills, transparent ghost actions, tonal dialog primaries, and prominent accent actions. Large accent buttons constrain accent lightness in OKLCH, a color space that exposes lightness separately from hue. Generic press feedback scales to 0.98; some toolbar icons use 0.95. These are different component treatments. [Button roles][zen-buttons], [toolbar overrides][zen-toolbar]

**Alto proposal.**

| Role | Appearance and use |
| --- | --- |
| Primary | Filled, readable action color; one visually dominant action within a local task, such as Send or an approval decision. |
| Secondary | Faint neutral fill, medium text, restrained hover and press. Useful for adjacent alternatives. |
| Ghost | Transparent at rest; quiet interaction fill. Use for routine toolbar, copy, close, and overflow actions. |
| Toggle or open trigger | Persistent selected fill while enabled or while its popover remains open. Its state must remain visible after the pointer leaves. |
| Destructive | Semantic danger ink or fill according to consequence. Keep the same geometry and type as neighboring controls. |

Keep Alto's pill geometry for short buttons. A useful starting density is 32px compact targets and approximately 34–36px regular buttons, with shared horizontal padding and icon gaps. These dimensions are proposals for Alto, not Zen-wide defaults.

Every button should have an explicit state contract:

| State | Rule |
| --- | --- |
| Rest | Clear label or icon; hierarchy visible without hover |
| Hover | Immediate fill and readable ink, with stable geometry |
| Press | Stronger fill; optional restrained scale feedback |
| Keyboard focus | Visible outline independent of hover and selection |
| Selected or open | Persistent state fill |
| Disabled | Visibly unavailable; no hover or press feedback |
| Busy | Stable width and label alignment; reserved space for activity feedback |

## Tabs, groups, and navigation rows

**Zen implementation.** Sidebar tab backgrounds use a 14px radius in their context, with 2px block margins. [Vertical tabs][zen-tabs] Secondary row actions appear on hover. [Tab actions][zen-tab-actions] Selection uses a mostly neutral translucent plate and a small shadow. [Selected surface][zen-selection]

**Alto proposal.** Keep the approved rounded tabs and shared appearance code for both orientations. Use regular weight for ordinary tabs and medium for the selected tab. Selection should be persistent and stronger than hover; group labels should establish membership without becoming another set of competing filled buttons.

Reveal secondary actions on keyboard focus as well as hover. Reserve their space so titles and counts do not move when actions appear. Keep active, running, unread, and grouped states distinguishable: they communicate different things.

## Icons

**Zen implementation.** Toolbar glyphs are generally 16px, with a 17px macOS override. A common toolbar rule derives icon fill from 70% current ink. [Icon sizing][zen-icons], [toolbar overrides][zen-toolbar]

**Alto proposal.** Retain one coherent glyph family. Normalize optical size, stroke weight, baseline, and icon-to-label spacing. Use inherited control ink so icons and labels respond together. Keep a comfortable target around a small glyph; increasing the glyph is not the only way to make the control easier to hit.

Avoid applying opacity to an entire control when only the icon needs optical adjustment: that also weakens text, focus rings, and state fills.

## Corners, spacing, and alignment

**Zen implementation.** Corners vary by role: common toolbar overrides use 8px, menu rows 5px, sidebar tab backgrounds 14px, and dialogs a larger radius. Native outer corners have platform overrides. Inner corners are derived from outer geometry and separation. [Toolbar][zen-toolbar], [menus][zen-menus], [native radius][zen-native-radius], [nested radius][zen-nested-radius] The default content separation is 8px. [Spacing preference][zen-spacing]

**Alto proposal.** Preserve the rounded shape the user selected, including the composer and tabs. Adopt the relationship between containers and inset controls: inner rounding should fit the available bounds and inset. Small controls naturally become pills; larger surfaces retain visible rounded corners.

Use a small shared spacing scale, initially 2, 4, 8, 12, 16, and 24px, for internal gaps and gutters. This is an Alto proposal; Zen does not use a strict version of that scale everywhere. Reuse existing content gutters and title alignment. Align icon centers, text baselines, and trailing actions within each row family.

## Fields, search, and toggles

**Zen implementation.** The address field uses a quiet enclosing surface, stable internal padding, and contextual actions. [Omnibox][zen-fields] Toggle fills reuse button tokens, with an accent-derived on state. [Toggle patch][zen-toggles]

**Alto proposal.** Let the field container own its background, rounding, and focus treatment. Inner text inputs should not add another rounded border. Apply the same rule to search, rename fields, model pickers, and settings controls.

Keep the composer's existing shape and editing behavior. Use the accent action role for checked or enabled controls; use the shared neutral control treatment when off. Labels and help text should follow the same typography rules as buttons and menus.

## Menus, popovers, tooltips, and dialogs

**Zen implementation.** Menu geometry includes 8px vertical and 14px horizontal row padding, 2px by 4px row margins, and a reserved icon column. macOS panel corners are 10px, or 12px under its Tahoe condition. [Menu geometry][zen-menus] Dialogs add a fine edge and a soft shadow, with larger corners. [Dialog surface][zen-dialogs]

**Alto proposal.** Build one floating-panel family, with menu rows that share button hover, focus, disabled, and selected treatments. Align labels, icons, checkmarks, submenus, and keyboard hints into stable columns. Keep that alignment for items without icons.

Use supporting ink for shortcuts and descriptions. Separate groups with spacing and a subtle divider. Tooltips should use the same surface and caption typography at a smaller density. Dialogs can have more elevation and padding than anchored menus while retaining the same palette and action hierarchy.

## Elevation and edges

**Alto proposal from Zen's selected-tab and dialog treatments.** Use elevation where it explains a relationship: a selected tab, an anchored popup, a modal, or the main pane above the glass. Ordinary buttons and every message do not need their own shadows.

Keep the existing light pane shadow. Use one edge treatment per boundary, avoiding stacked outlines, borders, and shadows that recreate the stray pixel line. In dark mode a restrained highlight edge can clarify a floating surface without a heavy black shadow.

## Motion and responsiveness

**Zen implementation.** Common controls use roughly 100–200ms transitions; contextual address-field actions fade over 150ms. Dialog entry uses 300ms with a 10px translation. Reduced-motion handling exists in several components but is not uniform across every rule. [Toolbar motion][zen-toolbar], [field disclosure][zen-fields], [dialog timing][zen-dialogs], [dialog keyframes][zen-motion]

**Alto proposal.** Preserve immediate tab hover painting, which addressed the sluggish pointer feedback. Add movement only where it clarifies an action: a restrained press, panel appearance, or group expansion. Avoid animating every fill while the pointer crosses a long list.

Use short opacity or transform transitions for optional polish, keep layout stable, and apply reduced-motion behavior consistently. Disclosure must work for keyboard users too.

## Applying the rules to Alto-specific content

Zen's browser chrome does not prescribe an Alto conversation design. The following are adaptations:

- Conversation cards, approval requests, and tool results should reuse the content, raised, recessed, border, and status roles.
- Code blocks, diffs, terminals, and tables should retain appropriate text density and semantic coloring. Their controls can share the common button language.
- Badges should use quiet surfaces unless they convey actionable status. A workspace accent should not overwrite error or approval meaning.
- Empty states and onboarding can use more expressive typography. Ordinary conversation and navigation should remain consistent.
- Loading indicators should occupy stable space and use the same supporting ink or status roles as nearby content.

Preserve visible keyboard focus even where individual Zen overrides suppress it. Test legibility over both light and dark backdrops, along with the opaque material fallback.

## Suggested adoption order

1. **Buttons, typography, and icons.** Normalize roles and states across pane toolbars, tab tools, composer actions, approval actions, and settings. Keep both tab orientations on shared rules.
2. **Fields and floating panels.** Unify search, pickers, menus, tooltips, and dialogs around the same surfaces, gutters, and state contract.
3. **Spacing and component geometry.** Align row families, action slots, nested corners, and panel insets while preserving the approved rounded composer and tabs.
4. **Optional motion and content details.** Add restrained feedback, then harmonize badges, tool cards, tables, and empty states.

Each pass should be reviewed across light and dark themes, several accent hues, horizontal and vertical tabs, and split panes. Interaction changes should preserve keyboard operation, immediate hover response, and active composer state.

Steps 1–3 now use shared appearance and geometry roles. Compact rows are 32px,
two-line choices are 52px, icon/action slots are 24px, and panel/dialog insets are
12px/24px. Both tab orientations reserve trailing actions without shifting their
titles. Settings, search, and pickers fit the available pane and scroll in short
windows. The approved rounded tabs, composer, and accent glass remain intact.
Step 4 remains an optional subsequent pass.

[zen-revision]: https://github.com/zen-browser/desktop/tree/7133db8aee16c3cdf042307e9e11071359d92851
[zen-colors]: https://github.com/zen-browser/desktop/blob/7133db8aee16c3cdf042307e9e11071359d92851/src/zen/common/styles/zen-theme.css#L22-L121
[zen-toolbar-states]: https://github.com/zen-browser/desktop/blob/7133db8aee16c3cdf042307e9e11071359d92851/src/zen/common/styles/zen-theme.css#L167-L188
[zen-fonts]: https://github.com/zen-browser/desktop/blob/7133db8aee16c3cdf042307e9e11071359d92851/src/zen/common/styles/zen-theme.css#L291-L306
[zen-branding]: https://github.com/zen-browser/desktop/blob/7133db8aee16c3cdf042307e9e11071359d92851/src/zen/common/styles/zen-branding.css#L7-L29
[zen-buttons]: https://github.com/zen-browser/desktop/blob/7133db8aee16c3cdf042307e9e11071359d92851/src/zen/common/styles/zen-buttons.css#L13-L153
[zen-toolbar]: https://github.com/zen-browser/desktop/blob/7133db8aee16c3cdf042307e9e11071359d92851/src/zen/common/styles/zen-single-components.css#L185-L215
[zen-tabs]: https://github.com/zen-browser/desktop/blob/7133db8aee16c3cdf042307e9e11071359d92851/src/zen/tabs/zen-tabs/vertical-tabs.css#L259-L394
[zen-tab-actions]: https://github.com/zen-browser/desktop/blob/7133db8aee16c3cdf042307e9e11071359d92851/src/zen/tabs/zen-tabs/vertical-tabs.css#L712-L733
[zen-selection]: https://github.com/zen-browser/desktop/blob/7133db8aee16c3cdf042307e9e11071359d92851/src/zen/spaces/zen-workspaces.css#L394-L399
[zen-icons]: https://github.com/zen-browser/desktop/blob/7133db8aee16c3cdf042307e9e11071359d92851/src/zen/common/styles/zen-theme.css#L159-L175
[zen-native-radius]: https://github.com/zen-browser/desktop/blob/7133db8aee16c3cdf042307e9e11071359d92851/src/zen/common/zenThemeModifier.js#L112-L144
[zen-nested-radius]: https://github.com/zen-browser/desktop/blob/7133db8aee16c3cdf042307e9e11071359d92851/src/zen/common/styles/zen-theme.css#L282-L288
[zen-spacing]: https://github.com/zen-browser/desktop/blob/7133db8aee16c3cdf042307e9e11071359d92851/prefs/zen/theme.yaml#L5-L9
[zen-fields]: https://github.com/zen-browser/desktop/blob/7133db8aee16c3cdf042307e9e11071359d92851/src/zen/common/styles/zen-omnibox.css#L19-L172
[zen-toggles]: https://github.com/zen-browser/desktop/blob/7133db8aee16c3cdf042307e9e11071359d92851/src/toolkit/content/widgets/moz-toggle/moz-toggle-tokens-css.patch#L6-L14
[zen-menus]: https://github.com/zen-browser/desktop/blob/7133db8aee16c3cdf042307e9e11071359d92851/src/zen/common/styles/zen-popup.css#L10-L78
[zen-dialogs]: https://github.com/zen-browser/desktop/blob/7133db8aee16c3cdf042307e9e11071359d92851/src/zen/common/styles/zen-panels/dialog.css#L6-L32
[zen-motion]: https://github.com/zen-browser/desktop/blob/7133db8aee16c3cdf042307e9e11071359d92851/src/zen/common/styles/zen-animations.css#L92-L135
