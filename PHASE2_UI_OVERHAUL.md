# UI/UX Overhaul Design Document

---

## Vision

A video room that feels alive. Dark, warm, built around the metaphor of fire and gathered humans. The vibe is pre-corporate internet — something strange and human that shouldn't exist but does. Crafted, not polished. Present, not performant.

Every person in the room is a different chemical element burning. The fire metaphor doesn't break under per-person color — it explains it.

---

## Design Language

### Base Aesthetic

- **Background:** Deep charcoal, near-black. Not pure black — something with warmth in it. `#1a1510` range.
- **Ambient tone:** Ember and amber. The room glows as if lit by fire. Subtle warm gradients radiate from the center of the layout.
- **Typography:** One font, slightly humanist — nothing geometric or corporate. Warm off-white, never pure white.
- **Borders and dividers:** Don't exist. Separation comes from glow, shadow, and depth — not lines.
- **Motion principle:** Everything that appears, grows. Everything that disappears, dims. Nothing snaps. Physics-based spring easing throughout.
- **No modals. No spinners. No toast notifications.** State changes are ambient moments.

### Per-Person Fire Colors (Fire Salt Palette)

Each user's display name is hashed to one of these elements. Same name → same color, every time.

| Element | Color | Hex approx |
|---|---|---|
| Copper | Teal-green | `#3EB489` |
| Potassium | Violet | `#9B59B6` |
| Lithium | Crimson | `#C0392B` |
| Sodium | Amber-yellow | `#E67E22` |
| Cesium | Pale blue | `#5DADE2` |
| Boron | Bright green | `#27AE60` |
| Rubidium | Red-violet | `#8E44AD` |
| Strontium | Scarlet | `#E74C3C` |

Eight elements, eight seats. Hash algo: `djb2` or equivalent on the display name string, mod 8. Color is assigned at name-entry time and previewed immediately.

When used as glow, border, or pulse: use the color at reduced opacity (0.3–0.6) so it reads as fire-tinged light, not a UI indicator.

---

## Landing Page

### Layout

Full-screen dark canvas. Faint ambient fire glow from center — a very subtle radial warm light, not an actual flame illustration. The circle of 8 seats is visible but dim, like shapes around a campfire.

No header. No logo at load. Just the room, waiting.

### Interaction Flow

1. A single text input fades in, centered. Placeholder: *"what do they call you?"* — lowercase, intimate.
2. User types their name. Input is debounced (~400ms).
3. On debounce resolve: the user's fire color blooms softly from the input field outward — a brief radial pulse in their element color. The input border takes on that color glow.
4. Two buttons fade in beneath the input:
   - **"take a seat"** — lit in the user's fire color. Glowing, alive. Disabled and visually dim if all 8 seats are taken.
   - **"join the audience"** — muted, secondary. Warm off-white, no color glow.
5. If all seats are taken, "take a seat" shows as dim with a small ambient label: *"circle is full"* — no modal, no alert.
6. Pressing either button: the whole landing fades out and the room fades in. Not a route change feeling — a *curtain rising* feeling.

### Empty Seat Visualization (Landing)

The 8 seat positions in the circle glow faintly if occupied — each in their occupant's color. Empty seats are barely visible, cool dark shapes. This communicates the room state before the user even joins.

---

## Views

Two views, toggleable. A small, minimal toggle lives in the top right — icon only, no label.

### Grid View (default)

Standard responsive video grid. The layout engine always finds the most space-efficient beautiful arrangement for 1–8 tiles:

| Count | Layout |
|---|---|
| 1 | Single tile, centered, large |
| 2 | Side by side |
| 3 | 2 top, 1 centered below |
| 4 | 2×2 |
| 5 | 3 top, 2 centered below |
| 6 | 3×2 |
| 7 | 4 top, 3 below |
| 8 | 4×2 |

Layout transitions are animated — tiles physically reflow with spring physics when someone joins or leaves. New tile blooms in. Vacated position collapses smoothly, others redistribute.

### Circle View

Tiles arranged in an arc/ring. Equal angular spacing. Same tile components, same animations — just arranged around a center point. The center of the circle is empty intentional space. The audience doesn't have tiles here — only participants occupy the circle.

**Switching between views:** tiles animate from their grid positions to their circle positions (and back). Not a crossfade — a physical repositioning. Use FLIP animation technique for smooth layout-to-layout transitions.

---

## Video Tiles

### Anatomy

Each tile:
- Video feed (or presence state if camera off)
- Glow ring border in user's fire color
- Name label — small, bottom left, semi-transparent dark pill
- Audio pulse on the glow ring when speaking

No other UI on the tile by default. Controls reveal on hover.

### Tile Lifecycle Animations

**On join (camera on):**
The tile's space in the grid opens first — other tiles shift to make room. Then a soft orb of the user's fire color pulses once from the center of that space, expands, and resolves into the video feed blooming in. Duration ~600ms.

**On join (camera off):**
Same bloom, but resolves into the presence state (see below) rather than video.

**On leave:**
Tile's glow dims, video fades, tile collapses inward to a point and disappears. Other tiles reflow. Duration ~400ms.

**Camera toggle off:**
Video feed cross-fades to presence state. Glow ring briefly pulses the user's color — acknowledging the change.

**Camera toggle on:**
Presence state cross-fades to video. Same pulse.

### Audio Reactivity

When a participant speaks, their glow ring **breathes outward** — a soft radial pulse at roughly the rhythm of their voice. Implemented via Web Audio API `AnalyserNode` on their local stream, or approximated with a simple volume threshold + CSS animation trigger. Must be subtle — perceptible but not distracting.

Active speaker tile scales up ~2–3% with a smooth spring transition. Scale returns when they stop speaking. Only one tile scales at a time (loudest speaker wins).

### Camera-Off Presence State

Not a gray box. Not initials on black.

A slow, generative ambient animation in the user's fire color — particles drifting, or a soft fluid simulation, or simply a very slow radial pulse. Their initial sits centered in warm off-white. The tile feels like the person is still *there*.

Implementation options (pick one):
- CSS `@keyframes` radial pulse on the color at varying opacities — simplest, still beautiful
- Canvas-based particle drift — more alive, medium complexity
- `hue-rotate` animated on a base fire gradient — cheap and fits the aesthetic

---

## Chat

### Desktop — Grid View

Overlay panel on the right side of the screen. Semi-transparent dark background (`rgba` over the grid), not a solid sidebar. The grid is visible beneath it, slightly dimmed. Width ~280px.

Panel slides in from the right on a toggle (keyboard shortcut + a small icon button). Default state: visible on desktop if screen width allows, collapsed on smaller screens.

### Desktop — Circle View

Same behavior. The circle leaves natural space at the edges — chat panel doesn't fight for space.

### Mobile — Both Views

Chat overlays the full bottom portion of the screen. Triggered by a tap. When open, it covers roughly the bottom 50% of the screen. Contrasting bright treatment — not dark-on-dark. Warm white or light amber background, dark text. The contrast is intentional: chat is a different mode of presence than watching video.

Dismisses by swiping down or tapping the video area above.

### Message Animations

- New messages slide in from the bottom with spring easing — not linear, has a slight overshoot and settle.
- Timestamp fades in on hover/tap only. Keeps the feed clean.
- Each message bubble has a very subtle left border in the sender's fire color.
- Sender name is in their fire color.

### Input

- Single-line input at the bottom of the chat panel.
- On focus: input border glows in the local user's fire color. Input expands very slightly in height.
- On send: message animates upward from the input into the feed. Input clears with a quick flash of the fire color.
- Enter to send. Shift+enter for newline (probably unnecessary given the context, but correct behavior).

### Join / Leave Events

Not toast notifications. When someone joins: a small ambient line appears in the chat feed — their name in their fire color, followed by *"joined the circle"* or *"joined the audience"* in muted text. It fades in gently, no bounce, no icon. When someone leaves: same treatment, *"left"*. These are woven into the chat feed, not floating above it.

### Floating Emoji Reactions

A simple emoji picker (6–8 options max, the classics) accessible via a `+` button near the chat input. Sending an emoji causes it to float upward from the bottom of the video grid, drifting slightly left or right, fading out over ~2 seconds. Multiple reactions stack naturally. This is the only thing that crosses the video canvas intentionally — and it's ephemeral.

---

## Seat Bar / Room State Indicator

A minimal persistent element — not a sidebar, not a panel. A thin horizontal strip or a floating pill near the bottom of the screen showing:

- 8 small fire-colored dots representing seats. Occupied = lit in their color. Empty = dim cool gray.
- Audience count as a small number with a soft icon.

On hover: expands slightly to show names. On click of an empty seat dot (if user is audience): triggers the seat-claim flow — a gentle confirmation that doesn't break immersion. No modal. Perhaps the dot pulses their color and they click it again to confirm, or a small inline label appears: *"step into the circle?"* with a single confirm tap.

---

## Transitions and Page Feel

**Initial page load:** Black. Then the ambient fire glow breathes in over ~1 second. Then the input fades in. Nothing is instant.

**Entering the room:** Landing fades to black, room fades in from black. ~500ms each. Feels like walking through a door.

**View toggle (grid ↔ circle):** FLIP animation. Each tile knows its current position and its target position. They move simultaneously with spring physics. Duration ~500ms.

**All state changes:** No hard cuts. Everything transitions. If something appears, it fades or grows in. If something disappears, it fades or shrinks out.

---

## Explicit Anti-Patterns (Do Not Do)

- No loading spinners — use skeleton states pulsing in the user's fire color
- No modals — every decision is inline or ambient
- No toast notifications — join/leave events live in the chat feed
- No hard borders or dividers — depth via glow and shadow only
- No pure black (`#000`) or pure white (`#fff`) anywhere
- No linear easing on any animation — always spring or ease-in-out minimum
- No flat gray for camera-off state — always the user's presence color
- No snap transitions on the grid layout — always physically animated reflow

---

## Implementation Notes

### Color Hashing
```typescript
function hashNameToColor(name: string): FireColor {
  let hash = 5381
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 33) ^ name.charCodeAt(i)
  }
  return FIRE_COLORS[Math.abs(hash) % FIRE_COLORS.length]
}
```

### Audio Detection (speaking indicator)
```typescript
const analyser = audioContext.createAnalyser()
mediaStreamSource.connect(analyser)
// Poll getByteFrequencyData at ~30fps
// Threshold RMS > 0.01 = speaking
// Debounce the speaking state by ~200ms to avoid flicker
```

### FLIP Animation Pattern (view toggle)
```typescript
// First: record current positions of all tiles
// Last: apply new layout class, record new positions
// Invert: apply transforms to put tiles back at old positions
// Play: remove transforms (transition does the rest)
```

### Grid Layout Engine
Compute the optimal tile arrangement purely in JS based on participant count. Apply as CSS grid template columns/rows. Animate the transition using FLIP — not CSS grid auto-placement, which doesn't animate.

### Spring Easing
Use `react-spring` or implement CSS `transition: all 500ms cubic-bezier(0.34, 1.56, 0.64, 1)` for the characteristic overshoot-and-settle feel throughout.