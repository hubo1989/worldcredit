# Design System Inspired by Solutions Treatment Center

## 1. Visual Theme & Atmosphere

Solutions Treatment Center's design embodies therapeutic warmth, healing hope, and professional compassion. The visual system combines a deep, grounded navy foundation with calming sky blues, creating an environment that feels both trustworthy and approachable. Layered imagery of nature, wellness rituals, and human connection reinforces the center's holistic approach to mental health treatment. The typography leans toward clean, readable Open Sans with generous spacing, fostering clarity and reducing cognitive load for visitors navigating sensitive mental health topics. Green accent elements symbolize growth and renewal, while the overall palette—dominated by cool tones—evokes serenity and safety.

**Key Characteristics**

- Deep navy foundation (`#030059`) providing trust and stability
- Soft sky blue accents (`#7AADFF`, `#A2C6FF`) creating calm and accessibility
- Human-centered imagery layered with nature and wellness symbolism
- Clean, spacious typography reducing overwhelm
- Green accent tones representing healing and growth
- Professional yet compassionate visual language
- High contrast between text and backgrounds for readability
- Warm, inviting component styling with rounded edges

## 2. Color Palette & Roles

### Primary
- **Deep Navy** (`#030059`): Primary brand color for headings, core UI elements, and dominant backgrounds; establishes trust and therapeutic authority
- **Primary Blue** (`#7AADFF`): Secondary primary for interactive states, hover effects, and accent sections; bridges deep navy with calming sky tones

### Accent Colors
- **Light Sky Blue** (`#A2C6FF`): Tertiary accent for subtle highlights, secondary backgrounds, and supporting UI; very light, non-intrusive
- **Teal Accent** (`#007CBA`): Alternative accent for CTAs and healing-related sections; professional and approachable
- **Purple Accent** (`#7A00DF`): Rare accent used for special emphasis or spiritual/holistic messaging elements

### Interactive
- **CTA Blue** (`#A2C6FF`): Button and link backgrounds for primary calls-to-action; light, inviting tone
- **Link Navy** (`#030059`): Text links maintaining visual hierarchy; underlined for accessibility
- **Hover State Light** (`#0073AA`): Interactive hover color for secondary interactions and focus states

### Neutral Scale
- **Text Dark** (`#333333`): Primary text color for body copy, labels, and standard content; warm dark grey
- **Text Black** (`#000000`): High-contrast text for headings and emphasis when maximum readability needed
- **Text Light** (`#111111`): Rare near-black for very subtle emphasis or alt text
- **Text Medium** (`#636363`): Secondary text for captions, metadata, and de-emphasized content
- **Surface Neutral** (`#FFFFFF`): Primary surface and container background; clinical cleanliness
- **Border Light** (`#DDDDDD`): Subtle borders between sections; low visual weight
- **Border Medium** (`#D2D2D2`): Standard borders around input fields and container edges
- **Border Dark** (`#CCCCCC`): Stronger borders when definition needed; rare usage

### Surface & Borders
- **White Surface** (`#FFFFFF`): Primary card, container, and modal backgrounds; clinical and clean
- **Light Border** (`#DDDDDD`): Dividers and subtle container outlines maintaining visual separation without harshness

### Semantic / Status
- **Error Red** (`#CF2E2E`): Error states, validation messages, and alerts indicating problems
- **Warning Yellow** (`#FCB900`): Warning states, cautions, and non-critical alerts

## 3. Typography Rules

### Font Family
**Primary:** Open Sans (sans-serif stack: `Open Sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`)
**Secondary:** Helvetica (system stack: `Helvetica, Arial, sans-serif`)

### Hierarchy

| Role | Font | Size | Weight | Line Height | Letter Spacing | Notes |
|------|------|------|--------|-------------|----------------|-------|
| Display (H1) | Open Sans | 32px | 300 | 51.2px | 0px | Hero section titles; large, airy, light weight |
| Heading 2 (H2) | Open Sans | 24px | 300 | 38.4px | 0px | Section titles, major content headers |
| Heading 3 (H3) | Open Sans | 16px | 400 | 24px | 0px | Subsection titles, card headers |
| Span Emphasis | Open Sans | 22px | 400 | 37.7px | 0px | Highlighted callout text, taglines |
| Body Standard | Open Sans | 16px | 400 | 25.6px | 0px | Primary body text, paragraphs, descriptions |
| Body Small | Open Sans | 14px | 400 | 21px | 0px | List items, secondary content, captions |
| Label / Form | Open Sans | 16px | 700 | 20.8px | 0px | Form labels, emphasis text |
| Button | Helvetica | 14px | 400 | 20px | 0px | Button text, minimal weight |
| Link | Open Sans | 16px | 400 | 16px | 0px | Inline links; underline applied via text-decoration |

### Principles
- **Light weight hierarchy:** Use weight 300–400; reserve 700 only for form labels and critical emphasis
- **Generous line height:** Maintain 1.5–1.6× multiplier for readability and reduced cognitive load
- **Accessibility first:** Minimum 16px for body text; always maintain sufficient contrast (`#333333` text on `#FFFFFF` backgrounds)
- **Therapeutic tone:** Avoid heavy, aggressive typography; favor clarity and calm over drama
- **Consistent baseline:** All text aligns to 8px grid for rhythm and visual harmony

## 4. Component Stylings

### Buttons

#### Primary Button
- **Background:** `#A2C6FF`
- **Text Color:** `#FFFFFF`
- **Font:** Open Sans, 14px, weight 700
- **Padding:** `0px 20px`
- **Height:** 40px
- **Border Radius:** `3px`
- **Border:** None
- **Box Shadow:** None
- **Hover State:** Background `#7AADFF`, cursor pointer
- **Focus State:** Outline `2px solid #030059`, offset `2px`
- **Disabled State:** Background `#CCCCCC`, color `#636363`, cursor not-allowed

#### Secondary Button
- **Background:** Transparent
- **Text Color:** `#030059`
- **Font:** Open Sans, 14px, weight 400
- **Padding:** `0px 20px`
- **Height:** 40px
- **Border Radius:** `3px`
- **Border:** `1px solid #030059`
- **Box Shadow:** None
- **Hover State:** Background `#A2C6FF` at 20% opacity, border color `#7AADFF`
- **Focus State:** Outline `2px solid #030059`
- **Active State:** Background `#A2C6FF`

#### Ghost Button
- **Background:** Transparent
- **Text Color:** `#FFFFFF`
- **Font:** Open Sans, 14px, weight 400
- **Padding:** `0px 20px`
- **Height:** 40px
- **Border Radius:** `3px`
- **Border:** None
- **Box Shadow:** None
- **Hover State:** Background `rgba(162, 198, 255, 0.2)`, color `#FFFFFF`

### Cards & Containers

#### Standard Card
- **Background:** `#FFFFFF`
- **Text Color:** `#333333`
- **Font:** Open Sans, 16px, weight 400
- **Padding:** `24px`
- **Border Radius:** `5px`
- **Border:** `1px solid #DDDDDD`
- **Box Shadow:** `0px 2px 4px rgba(0, 0, 0, 0.08)`
- **Line Height:** 25.6px
- **Min Height:** Auto (content-driven)

#### Featured Card / Callout
- **Background:** `#A2C6FF`
- **Text Color:** `#FFFFFF`
- **Font:** Open Sans, 18px, weight 400
- **Padding:** `24px`
- **Border Radius:** `10px`
- **Border:** None
- **Box Shadow:** `0px 4px 8px rgba(0, 0, 0, 0.12)`

#### Info Box
- **Background:** `#F5F8FF` (light blue tint)
- **Text Color:** `#333333`
- **Padding:** `20px 24px`
- **Border Radius:** `5px`
- **Border:** `1px solid #A2C6FF`
- **Border Left:** `4px solid #7AADFF` (accent stripe)

### Inputs & Forms

#### Text Input
- **Background:** `#FFFFFF`
- **Text Color:** `#333333`
- **Font:** Open Sans, 16px, weight 400
- **Padding:** `8px 12px`
- **Height:** 40px
- **Border Radius:** `5px`
- **Border:** `1px solid #CCCCCC`
- **Box Shadow:** None
- **Focus State:** Border `1px solid #7AADFF`, box-shadow `0px 0px 0px 3px rgba(122, 173, 255, 0.1)`
- **Error State:** Border `1px solid #CF2E2E`, background tint `rgba(207, 46, 46, 0.02)`

#### Label
- **Font:** Open Sans, 16px, weight 700
- **Color:** `#333333`
- **Margin Bottom:** `8px`
- **Display:** Block

#### Placeholder Text
- **Color:** `#636363`
- **Font Style:** Italic
- **Opacity:** 0.7

### Navigation

#### Top Navigation Bar
- **Background:** `#7AADFF`
- **Height:** 40px
- **Padding:** `0px 32px`
- **Display:** Flex, align-items center
- **Font:** Open Sans, 14px, weight 400
- **Text Color:** `#FFFFFF`

#### Navigation Link
- **Color:** `#FFFFFF`
- **Font:** Open Sans, 16px, weight 400
- **Padding:** `0px 20px`
- **Height:** 40px
- **Line Height:** 40px
- **Text Decoration:** None
- **Hover State:** Background `rgba(255, 255, 255, 0.1)`, transition 200ms ease
- **Active State:** Background `#030059`

#### Navigation Link (Dark Theme)
- **Color:** `#030059`
- **Hover State:** Color `#7AADFF`, text-decoration underline

### Links

#### Inline Text Link
- **Background:** Transparent
- **Text Color:** `#030059`
- **Font:** Open Sans, 16px, weight 400
- **Text Decoration:** Underline
- **Padding:** `0px`
- **Border:** None
- **Hover State:** Color `#7AADFF`, text-decoration underline-dashed
- **Focus State:** Outline `2px solid #030059`

#### Link Button (Primary CTA Link)
- **Background:** `#A2C6FF`
- **Text Color:** `#FFFFFF`
- **Font:** Open Sans, 14px, weight 700
- **Padding:** `0px 20px`
- **Height:** 40px
- **Line Height:** 40px
- **Border Radius:** `3px`
- **Border:** None
- **Text Decoration:** None
- **Hover State:** Background `#7AADFF`
- **Focus State:** Outline `2px solid #030059`

### Badges & Status Indicators

#### Badge (Default)
- **Background:** `#A2C6FF`
- **Text Color:** `#030059`
- **Font:** Open Sans, 12px, weight 700
- **Padding:** `4px 12px`
- **Border Radius:** `12px`
- **Border:** None

#### Badge (Error)
- **Background:** `#CF2E2E`
- **Text Color:** `#FFFFFF`
- **Font:** Open Sans, 12px, weight 700
- **Padding:** `4px 12px`
- **Border Radius:** `12px`

#### Badge (Warning)
- **Background:** `#FCB900`
- **Text Color:** `#030059`
- **Font:** Open Sans, 12px, weight 700
- **Padding:** `4px 12px`
- **Border Radius:** `12px`

## 5. Layout Principles

### Spacing System

**Base Unit:** 4px

**Scale:**
- `4px`: Micro spacing, internal component padding
- `8px`: Tight spacing, adjacent elements
- `12px`: Standard padding, form inputs
- `16px`: Comfortable spacing, component margins
- `20px`: Section breathing room
- `24px`: Card internal padding
- `32px`: Major section spacing
- `40px`: Full section separation

**Usage Context:**
- Components use `8px`–`12px` internally
- Section containers use `24px` padding minimum
- Major sections separated by `32px`–`40px` margins
- Forms and cards use `24px` internal padding
- List items use `8px` between entries

### Grid & Container

**Max Width:** `1200px` (standard content container)

**Column Strategy:**
- Desktop: 12-column grid, 8px gutters
- Tablet (768px–1024px): 8-column grid, 6px gutters
- Mobile (<768px): Single column, full width with `16px` side padding

**Section Patterns:**
- Hero sections: full-width with centered content max-width `1200px`
- Content sections: contained within `1200px`, centered on viewport
- Sidebar layouts: main content 70%, sidebar 30% (tablet: stacked)
- Two-column content: 50/50 split on desktop, stacked on tablet

### Whitespace Philosophy

Whitespace is therapeutic—it reduces cognitive load and supports emotional safety. Every section breathes with `24px`–`40px` vertical spacing. Cards and containers maintain internal `24px` padding minimum. Text-heavy sections use 1.6× line-height and generous margins between paragraphs. Navigation and UI chrome use tighter spacing (`8px`–`12px`) to stay unobtrusive. Visual hierarchy is achieved through space, weight, and color—never through visual noise or crowding.

### Border Radius Scale

- `3px`: Buttons, small interactive elements; minimal softening
- `5px`: Input fields, standard cards; subtle approachability
- `10px`: Featured cards, modal windows, image overlays; stronger softness
- `12px`: Badge elements, pills, rounded buttons
- `20px`: Large hero sections, container backgrounds (rare); maximum softness

## 6. Depth & Elevation

| Level | Treatment | Use |
|-------|-----------|-----|
| **Ground** | No shadow, `border: 1px solid #DDDDDD` | Default cards, section backgrounds, inputs |
| **Raised (Tier 1)** | `box-shadow: 0px 2px 4px rgba(0, 0, 0, 0.08)` | Standard interactive cards, hover state |
| **Elevated (Tier 2)** | `box-shadow: 0px 4px 8px rgba(0, 0, 0, 0.12)` | Featured cards, callout boxes, focus states |
| **Floating (Tier 3)** | `box-shadow: 0px 8px 16px rgba(0, 0, 0, 0.15)` | Modals, dropdowns, overlays |
| **Floating (Tier 4)** | `box-shadow: 0px 12px 24px rgba(0, 0, 0, 0.18)` | Tooltips, popovers, highest-priority overlays |

**Shadow Philosophy:** Shadows are subtle and warm-leaning (using pure black with low opacity). They serve to distinguish layers without creating visual heaviness or anxiety. The design avoids harsh, dark shadows that might feel clinical or cold. Elevation increases as content moves from static to interactive to modal. Motion and transitions (200ms ease) accompany shadow changes to reinforce depth shifts.

## 7. Do's and Don'ts

### Do

- Use `#030059` navy as the visual anchor for trust and authority; it appears in headings, CTAs, and core brand moments
- Combine `#7AADFF` and `#A2C6FF` blues to create calming, accessible experiences; these colors communicate safety
- Maintain minimum `16px` font size for all body text to reduce cognitive load for visitors in distress
- Apply `24px`–`40px` vertical spacing between major sections; whitespace is healing
- Use open, rounded borders (`5px` and `10px` radii) to soften interfaces and reduce anxiety
- Include green accent elements (`#00AA00` or similar, if expanded) to reinforce growth and renewal messaging
- Test all interactive elements for 4.5:1 minimum contrast ratio; healthcare interfaces must be maximally accessible
- Layer imagery (nature, wellness, human connection) behind or alongside text for emotional resonance
- Use Open Sans throughout for consistency; its readability supports vulnerable audiences
- Include clear, visible focus states (`2px solid #030059` outline, offset `2px`) for keyboard navigation

### Don't

- Avoid pure black (`#000000`) text except in rare emphasis scenarios; use `#333333` dark grey for comfort
- Don't use harsh reds or high-saturation colors for non-error states; maintain the calm palette
- Avoid shadows darker than `rgba(0, 0, 0, 0.18)` or heavy, dramatic depths; keep interfaces gentle
- Don't crowd content; every element needs breathing room—follow the `24px` minimum spacing guideline
- Avoid heavy font weights (700+) in body text; reserve bold for labels, CTAs, and emphasis only
- Don't use more than two accent colors in a single view; complexity increases anxiety
- Avoid rapid blink or flash animations; use smooth 200ms–400ms transitions instead
- Don't place critical information in color alone; always pair with text or icons for accessibility
- Avoid serif fonts; stick to Open Sans and system sans-serif stacks for consistency and readability
- Don't use extended shadows or 3D effects; maintain a clean, modern, therapeutic flatness

## 8. Responsive Behavior

### Breakpoints

| Name | Width | Key Changes |
|------|-------|-------------|
| **Mobile** | <576px | Single column, full-width, 16px side padding, font-sizes -2px, spacing -8px |
| **Tablet** | 576px–1024px | 2-column layouts, 8-column grid, 24px side padding, standard font-sizes, 80% of desktop spacing |
| **Desktop** | 1024px–1440px | 3+ columns, 12-column grid, 32px side padding, full typography scale, full spacing scale |
| **Large Desktop** | >1440px | Content max-width `1200px` centered, generous side margins, abundant whitespace |

### Touch Targets

- **Minimum Size:** 40px × 40px for all interactive elements (buttons, links, inputs)
- **Spacing Between Targets:** Minimum 8px separation to prevent mis-taps
- **Button/Link Padding:** `0px 20px` horizontally, `0px 12px` vertically (40px height total)
- **Icon Buttons:** 40px × 40px with centered icon
- **Form Inputs:** 40px height minimum, `8px 12px` padding
- **Checkbox/Radio:** 24px × 24px hit area with label extension
- **Mobile Navigation:** 44px–56px height for touch comfort

### Collapsing Strategy

- **Hero Sections:** Full viewport height on desktop (min 400px), 60vh on tablet, 50vh on mobile
- **Navigation:** Horizontal bar on desktop/tablet, collapsible hamburger menu <768px with overlay
- **Two-Column Layouts:** Side-by-side on desktop (70/30), single column stacked on tablet/mobile (main content first)
- **Image Grid:** 3 columns on desktop, 2 on tablet, 1 on mobile
- **Form Labels:** Beside inputs on desktop, stacked above on mobile
- **Typography:** Maintain 16px minimum body text across all breakpoints; reduce headings by max 20% on mobile
- **Spacing:** Reduce margins by 20% on tablet, 40% on mobile; padding remains consistent for internal components
- **Cards:** 1 column mobile, 2 columns tablet, 3 columns desktop
- **Sidebar Widgets:** Full-width stacked on mobile, floated right on tablet/desktop with 32px gutter

## 9. Agent Prompt Guide

### Quick Color Reference

- **Primary CTA:** CTA Blue (`#A2C6FF`) for button backgrounds; white text (`#FFFFFF`)
- **Primary Heading Text:** Deep Navy (`#030059`)
- **Body Text:** Text Dark (`#333333`)
- **Link Text:** Link Navy (`#030059`), underlined
- **Background:** White Surface (`#FFFFFF`) for cards and containers
- **Secondary Background:** Light Sky Blue (`#A2C6FF`) for featured sections
- **Navigation Bar:** Primary Blue (`#7AADFF`) background with white text
- **Border:** Border Light (`#DDDDDD`) for subtle separation
- **Error State:** Error Red (`#CF2E2E`)
- **Warning State:** Warning Yellow (`#FCB900`)
- **Focus Outline:** Deep Navy (`#030059`), `2px solid`, offset `2px`
- **Hover State:** Primary Blue (`#7AADFF`) for interactive lightening
- **Disabled State:** Border Dark (`#CCCCCC`) with Text Medium (`#636363`)

### Iteration Guide

1. **Start with the navy (`#030059`) and sky blues (`#7AADFF`, `#A2C6FF`):** These three colors form the backbone; all layouts should use navy for headings/anchors and blues for interactive/accent zones.

2. **Set typography to Open Sans, 16px minimum body, 1.6× line-height:** All text must maintain readability and calm; avoid compressed spacing that increases cognitive load.

3. **Apply 24px–40px vertical spacing between major sections:** Whitespace is therapeutic; never crowd content.

4. **Use 5px–10px border radius on cards and containers:** Softness reduces anxiety; avoid sharp corners.

5. **Ensure 4.5:1 contrast minimum for all text:** Test `#030059` on `#FFFFFF` (passes), `#333333` on `#FFFFFF` (passes), `#FFFFFF` on `#7AADFF` (passes).

6. **Make all interactive elements 40px height minimum with clear focus states:** Include `2px solid #030059` outlines for keyboard navigation.

7. **Layer imagery (nature, wellness, people) to reinforce healing messaging:** Images should communicate hope, connection, and growth.

8. **Use subtle shadows (`0px 2px 4px rgba(0, 0, 0, 0.08)` base level):** Avoid harsh depths; keep interfaces gentle and approachable.

9. **Adopt a calm, compassionate tone in all messaging:** Pair visual design with language that reduces shame and increases hope.

10. **Test responsive layouts at 576px, 768px, 1024px, 1440px breakpoints:** Ensure no content breaks, touch targets remain 40px, and typography remains readable across devices.
