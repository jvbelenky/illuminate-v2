/**
 * Readable, client-minted entity ids.
 *
 * IDs are client-authoritative (see CLAUDE.md): the frontend mints the string
 * and the backend obeys it, 409ing on a collision. These ids surface in the UI,
 * in logs, and in saved .guv files, so they're short and readable rather than
 * UUIDs.
 *
 * The prefix is deliberately type-neutral for zones. A calc zone keeps its id
 * across a plane/volume/point type change, so a type-descriptive id (`plane-1`)
 * would misdescribe the zone after a conversion.
 */

/**
 * Return the next free `{prefix}-{n}` id, given the ids already in use.
 *
 * Scans for the highest `{prefix}-{n}` and returns n+1, so `zone-1` when none
 * exist. Ids that don't match the pattern are ignored — that covers the
 * standard zones (`EyeLimits`, `SkinLimits`, `WholeRoomFluence`) and any legacy
 * guv-calcs ids (`CalcPlane-2`, `ushio_b1`) loaded from an old .guv file.
 *
 * Gaps left by deletions are not filled: a new entity never inherits a deleted
 * entity's id, and so never inherits its stale cached results.
 */
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
