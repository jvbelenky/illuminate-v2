/**
 * MSW handlers for mocking API endpoints in tests.
 */

import { http, HttpResponse } from 'msw';

const API_BASE = 'http://localhost:8000/api/v1';

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

  // Calculate
  http.post(`${API_BASE}/session/calculate`, () => {
    return HttpResponse.json({
      success: true,
      calculated_at: new Date().toISOString(),
      mean_fluence: 5.0,
      zones: {},
    });
  }),

  // Standard zones
  http.post(`${API_BASE}/standard-zones`, () => {
    return HttpResponse.json({
      zones: [
        {
          zone_id: 'WholeRoomFluence',
          name: 'Whole Room Fluence',
          zone_type: 'volume',
          x_min: 0, x_max: 5,
          y_min: 0, y_max: 5,
          z_min: 0, z_max: 3,
          num_x: 25, num_y: 25, num_z: 25,
          dose: false,
          hours: 8,
          show_values: false,
        },
        {
          zone_id: 'EyeLimits',
          name: 'Eye Dose (8 Hours)',
          zone_type: 'plane',
          height: 1.7,
          x_min: 0, x_max: 5,
          y_min: 0, y_max: 5,
          x_spacing: 0.1, y_spacing: 0.1,
          dose: true,
          hours: 8,
          vert: true,
          horiz: false,
          fov_vert: 80,
          show_values: false,
        },
        {
          zone_id: 'SkinLimits',
          name: 'Skin Dose (8 Hours)',
          zone_type: 'plane',
          height: 1.7,
          x_min: 0, x_max: 5,
          y_min: 0, y_max: 5,
          x_spacing: 0.1, y_spacing: 0.1,
          dose: true,
          hours: 8,
          vert: false,
          horiz: true,
          fov_vert: 180,
          show_values: false,
        },
      ],
    });
  }),
];

// Handler for simulating session expiration
export const sessionExpiredHandler = http.all(`${API_BASE}/session/*`, () => {
  return new HttpResponse('No active session', { status: 400 });
});

export { API_BASE };
