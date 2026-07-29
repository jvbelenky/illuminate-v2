# Readable client-minted entity IDs

**Date:** 2026-07-23 (reconciled 2026-07-28 at implementation)
**Status:** Implemented

## Problem

Calc-zone IDs are opaque UUIDs (`crypto.randomUUID()`), e.g.
`3f2a1c9e-…`. They surface in the UI (data attributes, the zone-stats
table's `zone.name || zone.id` fallback), in exported `.guv` files, and
in logs, where they read as "super long and ugly." Lamp IDs regressed to
the same UUID form. We want short, human-readable, sensible IDs.

The UUID scheme was introduced today-ish in commit `3c4b8a0`
("feat: client-minted IDs") and **never shipped to production**, so there
is no persisted data with UUID-shaped lamp/zone IDs to migrate or remain
backward-compatible with.

## Decisions

Three design questions were settled during brainstorming:

1. **ID format:** neutral, type-agnostic — `zone-1`, `zone-2`, … for all
   zone types; `lamp-1`, `lamp-2`, … for lamps. A single global counter
   per entity kind.
2. **Scope:** both zones and lamps (both currently mint UUIDs).
3. **ID authority:** stay **client-authoritative** (Bundle B). The
   frontend mints the ID from the current store state and the backend
   obeys it (409 on collision), exactly as today — only the *string* the
   frontend produces changes (UUID → `zone-N` / `lamp-N`).

### Why neutral prefix (not `plane-N` / `volume-N`)

A calc zone's type is intrinsic in guv-calcs — `CalcPlane`, `CalcVol`,
`CalcPoint` are distinct classes and a plane cannot become a volume in
place. illuminate models a "change type" affordance by re-sending the
**same** ID for a recreated zone (commit `3c4b8a0`, "zone type change
preserves identity"), so cached results and the open editor need no
remap. A **neutral** prefix means that reused ID never misdescribes the
zone after a type change — `zone-1` is valid whether it's a plane, volume,
or point. A type-descriptive ID (`plane-1`) would lie after a conversion
unless we also re-minted the ID (dropping results and resurrecting the
delete/recreate/remap machinery that `3c4b8a0` removed). Neutral avoids
that entire tension.

### Why client-authoritative is retained

Commit `83f8c35` deleted the `session.lamp_id_map` / `session.zone_id_map`
dual indexes. That was safe because of one invariant: **the ID the
frontend holds equals the key in `room.lamps` / `room.calc_zones`**, so
lookups go direct with no drift-prone translation table. Client-minting
(frontend chooses the string, backend obeys) keeps that invariant
trivially. It also keeps the door open to **optimistic UI** later — a
zone/lamp can be rendered the instant it's created because its permanent
ID is known synchronously, before the network round-trip. This change
does **not** implement optimistic UI; it only preserves the ability.

Backend-assigned IDs (the rejected "Bundle A") would also satisfy
`83f8c35` via adopt-the-response-ID, but would foreclose optimistic UI
(ID known only after the await) and move the naming source into
guv-calcs. Bundle B keeps everything in the frontend with no guv-calcs
change.

## Design

### guv-calcs
**No change.** The frontend always supplies an explicit ID on add and
copy, so the guv-calcs registry never auto-generates lamp/zone IDs in
illuminate's flow. The registry's own `base_id`/increment scheme remains
for notebook/scripting users and is untouched.

This was re-confirmed at implementation time. guv-calcs' native scheme is
PascalCase class-name base with `-N` from 2 (`Lamp`, `Lamp-2`; `CalcPlane`,
`CalcPlane-2`, `CalcVol` — `scene_registry.py:66-81`), which differs from
`lamp-N`/`zone-N` on three axes: case, counter start, and whether the zone base
is type-descriptive. Only the third matters — a type-descriptive zone ID would
misdescribe a zone after a plane→volume change (see above) — and it is
illuminate-specific, since a notebook user constructs a new object instead of
converting one. Changing guv-calcs to match would mean a release plus a dep bump
to fix defaults that never fire in illuminate's flow, so it was rejected. A
separate cleanup of guv-calcs' own scheme (neutral zone base, always-suffix so
there is no bare-base special case, and so an ID never equals the default
`name`) may be worth doing on its own terms.

### New helper — `ui/src/lib/utils/entityId.ts`

```ts
export function nextEntityId(existingIds: Iterable<string>, prefix: 'zone' | 'lamp'): string {
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  let max = 0;
  for (const id of existingIds) {
    const m = re.exec(id);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return `${prefix}-${max + 1}`;
}
```

Implemented at `ui/src/lib/utils/entityId.ts`.

- Pure, unit-testable, no store/network dependency.
- Scans current IDs, returns `{prefix}-{max+1}` (so `zone-1` when none exist).
- Deleted IDs leave gaps and are **not** reused — a new zone never
  inherits a deleted zone's ID (and thus never its stale results).
- Standard-zone IDs (`EyeLimits`, `SkinLimits`, `WholeRoomFluence`) don't
  match the pattern and are ignored by the count.

### Frontend — `ui/src/lib/stores/project.ts`

- **`addZone`** (~`:1959`): replace `crypto.randomUUID()` with
  `nextEntityId(get({ subscribe }).zones.map(z => z.id), 'zone')`.
- **`addLamp`** (~`:1802`): replace with
  `nextEntityId(get({ subscribe }).lamps.map(l => l.id), 'lamp')`.
- **`copyZone`** (~`:1997`): mint the new ID client-side
  (`nextEntityId(current.zones.map(z => z.id), 'zone')`) and pass it to
  the copy endpoint; store the copy under that ID (adopt-own-ID, not
  `response.zone_id`).
- **`copyLamp`** (~`:1934`): same with the `'lamp'` prefix.
- **Type-change path:** unchanged — it already re-sends the same ID.
- Keep the existing 409-on-collision warning as a safety net.
- Remove UUID-specific comments; keep the client-authoritative framing.

### Backend — copy endpoints become client-authoritative

To keep copies as clean `zone-N` / `lamp-N` (instead of the registry's
two-level `zone-3-2` increment), the copy endpoints accept an optional
client-supplied target ID and assign it to the copy before registering,
with `on_collision="error"` (409 on collision) — matching the add path.

- `api/api/v1/zone_session_routers.py` `copy_session_zone`: accept
  optional `new_id`; assign to `copy` before `add_calc_zone(..., on_collision="error")`.
- `api/api/v1/lamp_session_routers.py` `copy_session_lamp`: same for lamps.
- Frontend API client (`copySessionZone` / `copySessionLamp`) passes the
  minted ID.

This also makes copy consistent with add (both client-authoritative),
removing the last backend-authoritative-ID exception and aligning with
the "IDs are client-authoritative" convention in `CLAUDE.md`.

### API contract

Adding the optional `new_id` to the copy endpoints changes the OpenAPI
schema. Run `make generate-api` and alias the regenerated type in
`ui/src/lib/api/contract.ts` per the contract convention — never
hand-write the request type. CI's `contract` job gates on this.

### Concurrent minting (found during implementation)

`addZone`/`addLamp` mint from store state, `await` the network, and only then
write the store. UUIDs could never collide without coordination; a derived
counter can. Two adds issued before the first response lands read identical
state, mint the same ID, and the second 409s — reachable by double-clicking
"Add Zone" on a slow connection.

Fixed with an in-flight reservation set (`reservedEntityIds` in
`createProjectStore`): the ID is reserved synchronously at mint time and
released in a `finally`. `nextEntityId` is passed store IDs ∪ reservations.

This set is an **allocator, not a cache** — "`zone-3` is taken" exists nowhere
else until the response lands — so it must not be cleared by the
init/reinit/load protocol. A cached monotonic counter was rejected: O(1), but it
must be re-seeded on init, `.guv` load, reinit-after-timeout, and replay
boundary, and missing any one silently mints colliding IDs. Scanning a few dozen
strings cannot go stale. The reservation set becomes redundant if optimistic UI
ever lands.

### Custom lamp definition IDs — out of scope

`lampLibrary.ts` mints definition IDs with `crypto.randomUUID()` and keeps doing
so. Unlike lamp/zone IDs these are a surrogate key with no human-facing role:
never displayed (the manager modal uses `def.id` only for identity comparisons),
never sent to the backend (`custom_lamp_id` is stripped from every payload),
absent from `.guv` files, and re-minted on load because definitions are
re-derived by **content hash**, not ID (`linkLoadedCustomLamps`). Readability
buys nothing, and a counter would add a cross-project collision class that does
not exist today.

## Removal (per "fully remove the crypto UUID version")

- No `crypto.randomUUID()` remains for lamp/zone IDs (the two call sites
  above are the only ones; `crypto.randomUUID()` stays for `sessionId`,
  file IDs, and sync-error IDs, which are unrelated).
- No back-compat path for UUID-shaped lamp/zone IDs — the scheme never
  shipped. `nextEntityId` tolerates non-matching legacy IDs anyway (they
  simply don't affect the counter), but we don't add migration code.

## Tests

- **New:** unit tests for `nextEntityId` — empty set → `zone-1`; existing
  `zone-1`,`zone-3` → `zone-4` (gap tolerated, no reuse); non-matching IDs
  (standard-zone names, arbitrary strings) ignored; `lamp` prefix.
- **Update:** `ui/src/lib/stores/project.test.ts` assertions that expect
  `/^test-uuid-/` for added lamp/zone IDs → `/^zone-\d+$/` and
  `/^lamp-\d+$/`. The copy-verification test → expect the minted ID.
- Keep the `crypto.randomUUID` mock in `ui/src/lib/test/setup.ts` (still
  used by sessionState / fileStore / syncErrors).
- **Backend:** tests for the copy endpoints honoring `new_id` and 409ing
  on a colliding `new_id`.
- Run `pnpm test:run` (ui) and the API suite; `pnpm check` must stay at
  zero errors.

## Changelog

Add a user-facing line to `CHANGELOG.md` `[Unreleased]`: calc-zone and
lamp IDs are now short and readable (`zone-1`, `lamp-1`) instead of UUIDs.

## Out of scope

- **Optimistic UI** — preserved as possible, not implemented here.
  `addZone` / `addLamp` stay `await`-then-insert.
- **Default names** (`CalcZone1`, `Lamp 1`) — independent of IDs, unchanged.
- **guv-calcs** — no changes.
