# canvas.json reference

`.design/canvas/<canvas-id>/canvas.json` describes one canvas. The folder name is the canvas id: letters, digits, `-` and `_`, starting with a letter or digit. Every object is strict: an unknown key is an error, which catches typos such as `"sectons"`. `design check` reports problems with their path, for example `pages[0].sections[1].items[2].src`; the viewer shows the same list and still renders every item that is valid.

## Canvas

```json
{
  "title": "Onboarding",
  "description": "Sign-up flow for the mobile app, v2.",
  "system": true,
  "theme": "light",
  "pages": [ ... ]
}
```

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `title` | string, required | | Name in the viewer and on the home page. |
| `description` | string | | One line under the title. |
| `system` | boolean | `true` | Inject the design system stylesheet (Tailwind v4 + tokens) into every screen. Items can override it. |
| `theme` | `"light"` \| `"dark"` | follows the viewer | Theme screens open in. |
| `pages` | array, at least one | | Pages, in menu order. |
| `$schema` | string | | Ignored; allowed for editors. |

## Page

A page holds either `sections` (automatic layout) or `items` (free layout), never both.

```json
{
  "id": "flow",
  "title": "Flow",
  "description": "Happy path from invite to first project.",
  "sections": [ ... ]
}
```

| Key | Type | Meaning |
| --- | --- | --- |
| `id` | id, required | Unique within the canvas. Used in URLs and in `go('<page>/<screen>')`. |
| `title` | string, required | Shown in the page switcher. |
| `description` | string | Shown with the page. |
| `sections` | array | Rows laid out top to bottom. |
| `items` | array | Free layout: items placed at their own `x`/`y`. |

### Sections (automatic layout)

Sections stack vertically. Items in a section sit in one row, left to right, top-aligned; `columns` wraps the row into a grid.

```json
{
  "id": "sign-up",
  "title": "Sign up",
  "description": "Email first, password on the next step.",
  "columns": 4,
  "items": [ ... ]
}
```

| Key | Type | Meaning |
| --- | --- | --- |
| `id` | id | Defaults to `section-<n>`. |
| `title` | string | Large heading above the row. |
| `description` | string, Markdown | Text under the heading. |
| `columns` | integer 1-50 | Wrap after this many items. |
| `items` | array, required | The row. |

### Free layout

Items in a page's `items` array take `x` and `y` in canvas pixels (the top-left corner at 100% zoom). An item without coordinates is placed to the right of the previous one. Use free layout for moodboards and diagrams; use sections for everything else, because they need no arithmetic.

## Items

An item without `type` is a screen. Every item may carry an `id`; without one, it is derived from the file name (`screens/SignUp.tsx` becomes `sign-up`, `screens/landing/index.html` becomes `landing`). Ids are unique across the whole canvas; when two derived ids collide the second one becomes `name-2` with a warning, so give an explicit `id` whenever the same file appears twice.

### Screen

```json
{ "src": "screens/SignUp.tsx", "device": "phone" }
{ "id": "sign-up-error", "src": "screens/SignUp.tsx", "device": "phone", "title": "Sign up, error", "props": { "error": "This email is already registered" } }
{ "src": "screens/landing/index.html", "device": "desktop", "height": "auto" }
```

| Key | Type | Meaning |
| --- | --- | --- |
| `type` | `"screen"` | Optional. |
| `src` | path, required | Relative to the canvas folder. `.tsx`, `.jsx`, `.ts`, `.js`, `.mjs` are module screens; `.html`, `.htm` are HTML screens. A file outside `.design` works but warns. |
| `id` | id | See above. |
| `title` | string | Label above the frame. Default: the file name, humanized. |
| `description` | string | Shown in the layer list and play mode. |
| `device` | preset | Frame size (table below). Default `desktop`. |
| `width` | integer 80-8000 | Frame width in CSS pixels; overrides the device. |
| `height` | integer 80-40000 or `"auto"` | Frame height; `"auto"` grows the frame to the content. |
| `props` | object | Passed to the screen component as React props. |
| `theme` | `"light"` \| `"dark"` | Pin this screen's theme; the viewer toggle no longer changes it. |
| `system` | boolean | Override the canvas `system` setting for this screen. |
| `x`, `y` | number | Free-layout position. |

When only `width` or only `height` is given, the other side comes from the `desktop` preset.

### URL

A live page served by something else, such as the app's own dev server.

```json
{ "type": "url", "url": "http://localhost:5173/settings", "title": "Settings today", "device": "desktop" }
```

| Key | Type | Meaning |
| --- | --- | --- |
| `url` | http(s) URL, required | Loaded as-is in the frame. |
| `id`, `title`, `description` | | As for screens. Title defaults to the URL. |
| `device`, `width`, `height` | | As for screens; `"auto"` is not measured for URL items. |
| `x`, `y` | number | Free-layout position. |

The page must allow being framed. The design system is not injected and `go()` is not available inside it.

### Note

Markdown on the canvas: annotations, the brief, rationale for an option, open questions.

```json
{ "type": "note", "text": "**Why phone-first:** 78% of sign-ups start on mobile.", "width": 320 }
{ "type": "note", "tone": "plain", "text": "# Directions", "width": 640 }
```

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `text` | Markdown, required | | Note content. |
| `tone` | `"note"` \| `"plain"` | `"note"` | `note` is a sticky card; `plain` is text straight on the canvas. |
| `width` | integer 80-4000 | 320 (`plain`: 560) | Width in canvas pixels; height follows the text. |
| `id`, `title`, `x`, `y` | | | As above. |

### Image

A reference image, moodboard tile, or the screenshot of a competitor the user supplied.

```json
{ "type": "image", "src": "assets/current-dashboard.png", "width": 720, "title": "Current dashboard" }
```

| Key | Type | Meaning |
| --- | --- | --- |
| `src` | path or http(s) URL, required | Paths are relative to the canvas folder. |
| `width` | integer 16-8000 | Display width; height keeps the aspect ratio. Default: natural size. |
| `id`, `title`, `description`, `x`, `y` | | As above. |

## Device presets

| `device` | Size |
| --- | --- |
| `phone` | 390 × 844 |
| `phone-sm` | 375 × 667 |
| `phone-lg` | 430 × 932 |
| `tablet` | 834 × 1194 |
| `tablet-landscape` | 1194 × 834 |
| `laptop` | 1280 × 800 |
| `desktop` (default) | 1440 × 900 |
| `wide` | 1920 × 1080 |

Frames never scale their content: a 1440 px design in a 390 px frame is cut off, not shrunk. Match the frame to what the screen is designed for.

## A complete example

```json
{
  "title": "Checkout",
  "description": "Guest checkout for the web shop.",
  "pages": [
    {
      "id": "flow",
      "title": "Flow",
      "sections": [
        {
          "title": "Guest checkout",
          "items": [
            { "src": "screens/Cart.tsx", "device": "desktop" },
            { "src": "screens/Shipping.tsx", "device": "desktop" },
            { "src": "screens/Payment.tsx", "device": "desktop" },
            { "type": "note", "text": "Payment reuses the saved address when the email is known." }
          ]
        },
        {
          "title": "Phone",
          "items": [
            { "id": "cart-phone", "src": "screens/Cart.tsx", "device": "phone" },
            { "id": "payment-phone", "src": "screens/Payment.tsx", "device": "phone" }
          ]
        }
      ]
    },
    {
      "id": "states",
      "title": "States",
      "sections": [
        {
          "title": "Cart",
          "items": [
            { "id": "cart-empty", "src": "screens/Cart.tsx", "title": "Empty", "props": { "items": [] } },
            { "id": "cart-error", "src": "screens/Cart.tsx", "title": "Out of stock", "props": { "error": "stock" } }
          ]
        }
      ]
    }
  ]
}
```

`go('payment')` from `Cart.tsx` moves to the Payment screen; `go('states/cart-empty')` moves to the other page.

## Viewer

`design preview` prints the viewer URL. The home page lists canvases and the design system; `/c/<canvas>` opens a canvas; `/c/<canvas>/play/<screen>` opens one screen full size; `/system` opens the design system.

On the canvas: drag the background or scroll to pan, pinch or ⌘/Ctrl + scroll to zoom, ⇧1 fits the page. Click a screen to interact with it (Esc leaves), Enter or double-click opens it in play mode. The screens theme toggle switches every frame between light and dark.
