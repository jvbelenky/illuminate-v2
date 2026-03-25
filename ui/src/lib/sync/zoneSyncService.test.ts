import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the API client
vi.mock('$lib/api/client', () => ({
  updateSessionZone: vi.fn(),
}));

import { syncZoneToBackend } from './zoneSyncService';
import { updateSessionZone } from '$lib/api/client';

const mockUpdateSessionZone = vi.mocked(updateSessionZone);

describe('zoneSyncService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('syncZoneToBackend', () => {
    it('returns success with empty computedValues for empty partial', async () => {
      const result = await syncZoneToBackend('zone-1', {});
      expect(result.success).toBe(true);
      expect(result.zoneId).toBe('zone-1');
      expect(result.computedValues).toEqual({});
      expect(mockUpdateSessionZone).not.toHaveBeenCalled();
    });

    it('sends basic properties', async () => {
      mockUpdateSessionZone.mockResolvedValue({
        success: true,
        zone_id: 'zone-1',
      } as any);

      await syncZoneToBackend('zone-1', { name: 'Test Zone', enabled: true, dose: false, hours: 8, height: 1.5 });
      expect(mockUpdateSessionZone).toHaveBeenCalledWith('zone-1', {
        name: 'Test Zone',
        enabled: true,
        dose: false,
        hours: 8,
        height: 1.5,
      });
    });

    it('sends num_points when provided', async () => {
      mockUpdateSessionZone.mockResolvedValue({
        success: true,
        zone_id: 'zone-1',
        num_x: 10,
        num_y: 15,
        x_spacing: 0.5,
        y_spacing: 0.3,
      } as any);

      const result = await syncZoneToBackend('zone-1', { num_x: 10, num_y: 15 });
      expect(mockUpdateSessionZone).toHaveBeenCalledWith('zone-1', {
        num_x: 10,
        num_y: 15,
      });
      expect(result.computedValues).toEqual({
        num_x: 10,
        num_y: 15,
        x_spacing: 0.5,
        y_spacing: 0.3,
      });
    });

    it('sends spacing when provided', async () => {
      mockUpdateSessionZone.mockResolvedValue({
        success: true,
        zone_id: 'zone-1',
        num_x: 20,
        num_y: 30,
        x_spacing: 0.5,
        y_spacing: 0.3,
      } as any);

      const result = await syncZoneToBackend('zone-1', { x_spacing: 0.5, y_spacing: 0.3 });
      expect(mockUpdateSessionZone).toHaveBeenCalledWith('zone-1', {
        x_spacing: 0.5,
        y_spacing: 0.3,
      });
      expect(result.computedValues).toEqual({
        num_x: 20,
        num_y: 30,
        x_spacing: 0.5,
        y_spacing: 0.3,
      });
    });

    it('sends both num_points and spacing when both provided', async () => {
      mockUpdateSessionZone.mockResolvedValue({
        success: true,
        zone_id: 'zone-1',
        num_x: 10,
        x_spacing: 0.5,
      } as any);

      await syncZoneToBackend('zone-1', { num_x: 10, x_spacing: 0.5 });
      expect(mockUpdateSessionZone).toHaveBeenCalledWith('zone-1', {
        num_x: 10,
        x_spacing: 0.5,
      });
    });

    it('returns empty computedValues when no grid params sent', async () => {
      mockUpdateSessionZone.mockResolvedValue({
        success: true,
        zone_id: 'zone-1',
      } as any);

      const result = await syncZoneToBackend('zone-1', { name: 'Updated' });
      expect(result.computedValues).toEqual({});
    });

    it('returns success from API response', async () => {
      mockUpdateSessionZone.mockResolvedValue({
        success: true,
        zone_id: 'zone-1',
      } as any);

      const result = await syncZoneToBackend('zone-1', { name: 'Test' });
      expect(result.success).toBe(true);
    });

    it('propagates API errors', async () => {
      mockUpdateSessionZone.mockRejectedValue(new Error('API error'));
      await expect(syncZoneToBackend('zone-1', { name: 'Test' })).rejects.toThrow('API error');
    });

    it('includes sentUpdates in result', async () => {
      mockUpdateSessionZone.mockResolvedValue({
        success: true,
        zone_id: 'zone-1',
      } as any);

      const partial = { name: 'My Zone', dose: true };
      const result = await syncZoneToBackend('zone-1', partial);
      expect(result.sentUpdates).toBe(partial);
    });

    it('handles volume zone with z spacing', async () => {
      mockUpdateSessionZone.mockResolvedValue({
        success: true,
        zone_id: 'zone-1',
        num_x: 10,
        num_y: 10,
        num_z: 10,
      } as any);

      const result = await syncZoneToBackend('zone-1', { x_spacing: 0.1, y_spacing: 0.2, z_spacing: 0.3 });
      expect(mockUpdateSessionZone).toHaveBeenCalledWith('zone-1', {
        x_spacing: 0.1,
        y_spacing: 0.2,
        z_spacing: 0.3,
      });
      expect(result.computedValues).toEqual({
        num_x: 10,
        num_y: 10,
        num_z: 10,
      });
    });
  });
});
