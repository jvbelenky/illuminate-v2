/**
 * MSW handlers for mocking API endpoints in tests.
 */

import { http, HttpResponse } from 'msw';

const API_BASE = 'http://localhost:8000/api/v1';

/** Minimal authoritative object state echo for the mock /session/objects routes. */
function mockObjectState(id: string, body: Record<string, unknown>) {
  return {
    id,
    name: (body.name as string | undefined) ?? id,
    shape: (body.shape as string | undefined) ?? 'box',
    width: (body.width as number | undefined) ?? 1,
    length: (body.length as number | undefined) ?? 1,
    height: (body.height as number | undefined) ?? 1,
    vertices: (body.vertices as number[][] | undefined) ?? null,
    x: (body.x as number | undefined) ?? 0,
    y: (body.y as number | undefined) ?? 0,
    z: (body.z as number | undefined) ?? 0,
    yaw: (body.yaw as number | undefined) ?? 0,
    pitch: (body.pitch as number | undefined) ?? 0,
    roll: (body.roll as number | undefined) ?? 0,
    reflectance: (body.reflectance as number | undefined) ?? 0,
    transmittance: (body.transmittance as number | undefined) ?? 0,
    face_properties: (body.face_properties as Record<string, { R: number; T: number }> | undefined) ?? {},
    face_spacings: {},
    face_num_points: {},
    enabled: (body.enabled as boolean | undefined) ?? true,
  };
}

export const handlers = [
  // Health check
  http.get(`${API_BASE}/health`, () => {
    return HttpResponse.json({ status: 'ok' });
  }),

  // Session init
  http.post(`${API_BASE}/session/init`, () => {
    return HttpResponse.json({
      success: true,
      message: 'Session initialized',
      lamp_count: 0,
      zone_count: 3,
    });
  }),

  // Session status
  http.get(`${API_BASE}/session/status`, () => {
    return HttpResponse.json({
      active: true,
      message: 'Session active',
      lamp_count: 0,
      zone_count: 3,
    });
  }),

  // Room update
  http.patch(`${API_BASE}/session/room`, () => {
    return HttpResponse.json({ success: true });
  }),

  // Lamp operations
  http.post(`${API_BASE}/session/lamps`, () => {
    return HttpResponse.json({ success: true, lamp_id: 'new-lamp-id' });
  }),

  http.patch(`${API_BASE}/session/lamps/:lampId`, () => {
    return HttpResponse.json({ success: true });
  }),

  http.delete(`${API_BASE}/session/lamps/:lampId`, () => {
    return HttpResponse.json({ success: true });
  }),

  // Zone operations
  http.post(`${API_BASE}/session/zones`, () => {
    return HttpResponse.json({ success: true, zone_id: 'new-zone-id' });
  }),

  http.patch(`${API_BASE}/session/zones/:zoneId`, () => {
    return HttpResponse.json({
      success: true,
      num_x: 25,
      num_y: 25,
      x_spacing: 0.1,
      y_spacing: 0.1,
    });
  }),

  http.delete(`${API_BASE}/session/zones/:zoneId`, () => {
    return HttpResponse.json({ success: true });
  }),

  // Object operations — echo the request as the authoritative state
  http.post(`${API_BASE}/session/objects`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const id = (body.id as string | undefined) ?? 'Object';
    return HttpResponse.json({ success: true, object_id: id, state: mockObjectState(id, body) });
  }),

  http.patch(`${API_BASE}/session/objects/:objectId`, async ({ request, params }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const id = params.objectId as string;
    return HttpResponse.json({ success: true, object_id: id, state: mockObjectState(id, body) });
  }),

  http.delete(`${API_BASE}/session/objects/:objectId`, () => {
    return HttpResponse.json({ success: true });
  }),

  http.post(`${API_BASE}/session/objects/:objectId/copy`, async ({ request, params }) => {
    const body = (await request.json().catch(() => ({}))) as { new_id?: string };
    const id = body.new_id ?? `${params.objectId as string}-copy`;
    return HttpResponse.json({ success: true, object_id: id, state: mockObjectState(id, {}) });
  }),

  http.get(`${API_BASE}/session/objects`, () => {
    return HttpResponse.json({ objects: [] });
  }),

  // Calculate
  http.post(`${API_BASE}/session/calculate`, () => {
    return HttpResponse.json({
      success: true,
      calculated_at: new Date().toISOString(),
      mean_fluence: 5.0,
      zones: {},
    });
  }),

];

// Handler for simulating session expiration
export const sessionExpiredHandler = http.all(`${API_BASE}/session/*`, () => {
  return new HttpResponse('No active session', { status: 400 });
});

export { API_BASE };
