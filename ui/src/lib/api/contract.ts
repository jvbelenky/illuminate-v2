/**
 * Adoption layer for the generated OpenAPI contract.
 *
 * `api-types.ts` (generated from `api/openapi.json` via Task 4) is the source
 * of truth for backend response/request shapes. Rather than importing the
 * verbose `components['schemas'][...]` lookups directly throughout the
 * codebase, this module centralizes a small set of aliases that hand-written
 * types are being migrated to use, one slice at a time.
 *
 * Only alias a schema here once it has been verified to match (or
 * intentionally diverge from, with a comment at the point of use) the
 * hand-written type it is replacing.
 */

import type { components } from './generated/api-types';

/**
 * Photobiological safety standard used for lamp compliance checks.
 * Mirrors `SessionRoomConfig.standard` from the generated schema, which is
 * required (non-nullable) and carries the identical literal union to what
 * was previously hand-written in `ui/src/lib/types/project.ts`.
 */
export type GuvStandard = components['schemas']['SessionRoomConfig']['standard'];

/**
 * Response after adding a zone to the session (`POST /session/zones`), as
 * declared in the OpenAPI schema. See `AddZoneResponse` in
 * `ui/src/lib/api/client.ts` for the frontend-facing alias, which overrides
 * `state_hashes` to a more precise type than this raw generated shape.
 */
export type AddZoneResponse = components['schemas']['AddZoneResponse'];

/**
 * Response after updating a zone in the session (`PATCH /session/zones/{id}`),
 * as declared in the OpenAPI schema. See `SessionZoneUpdateResponse` in
 * `ui/src/lib/api/client.ts` for the frontend-facing alias, which overrides
 * `state_hashes` and `message` relative to this raw generated shape.
 */
export type SessionZoneUpdateResponse = components['schemas']['SessionZoneUpdateResponse'];
