# Footprint Editor Implementation Plan

**Spec:** `docs/superpowers/specs/2026-10-03-footprint-editor-design.md`

1. **PlanCanvas extraction.** Move the canvas (view, grid, snapping, drawing, dragging, keyboard, context layers) from `FloorPlanModal.svelte` into `PlanCanvas.svelte` with `bind:draft`, `bind:drawing`, `bind:selectedIndex`, a `tool` prop (`edit` | `draw` | `custom`), `underlay` / `overlay` / `hud` snippets for host layers, host callbacks (`onCustomClick`, `onCustomMove`, `onBackgroundPointerDown`), and exported methods (`fitView`, `zoomBy`, `startDraw`, `finishDraw`, `cancelDraw`, `pointerToRoom`, `toScreen`, `snapAngle`, `snapOffset`, `focus`). All 35 `FloorPlanModal.test.ts` tests and `e2e/tests/room.spec.ts` stay green.
2. **Backend.** `SessionObjectUpdate.shape` / `.vertices`; PATCH rebuilds the object in place; tests; `make generate-api`.
3. **Store.** `updateObject` sends shape/vertices; tests.
4. **FootprintModal** + entry points in `+page.svelte` and `ObjectEditor.svelte`; component tests.
5. **e2e** in `objects.spec.ts`; changelog; full test runs.
