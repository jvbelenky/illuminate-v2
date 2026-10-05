import { describe, it, expect, vi } from 'vitest';
import { captureReportImages, captureThumbnails, reportIsoLevels, type SceneCaptureApi } from './reportCapture';

function fakeApi() {
  const calls: string[] = [];
  const canvas = { width: 800, height: 600, toDataURL: vi.fn(() => 'data:image/png;base64,AAAA') } as unknown as HTMLCanvasElement;
  const camera = { position: [1, 2, 3] as [number, number, number], target: [0, 0, 0] as [number, number, number] };
  const api: SceneCaptureApi = {
    canvas: () => canvas,
    prepare: () => { calls.push('prepare'); },
    restore: () => { calls.push('restore'); },
    getCamera: () => ({ position: [...camera.position] as [number, number, number], target: [...camera.target] as [number, number, number] }),
    setCamera: (s) => { calls.push(`setCamera:${s.position.join(',')}`); },
    setViewImmediate: (v) => { calls.push(`view:${v}`); },
    setVisibility: (o) => { calls.push(`vis:${o ? JSON.stringify(o) : 'null'}`); },
    setIsoSettings: (o) => { calls.push(`iso:${o ? JSON.stringify(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.customLevels]))) : 'null'}`); },
    render: () => { calls.push('render'); },
  };
  return { api, calls, canvas };
}

describe('captureReportImages', () => {
  it('captures cover (preset), plan and one image per volume, then restores camera and visibility', async () => {
    const { api, calls } = fakeApi();
    const out = await captureReportImages(api, {
      coverView: 'iso-front-left', volumes: [{ id: 'WholeRoomFluence', mean: 0.4237 }, { id: 'breath', mean: 1.2 }],
      lampIds: ['L1'], colormap: 'plasma',
    });
    expect(Object.keys(out)).toEqual(['cover', 'volume:WholeRoomFluence', 'volume:breath']);
    expect(calls).toContain('view:iso-front-left');
    // no plan capture: the server draws the plan
    expect(calls).not.toContain('view:top');
    // the cover keeps the user's visibility but drops the photometric webs
    expect(calls).toContain('vis:{"hidePhotometricWebs":true}');
    // a volume capture shows that zone even if the user had hidden it
    expect(calls).toContain('vis:{"lampIds":["L1"],"zoneIds":["breath"],"objectIds":[],"hidePhotometricWebs":true}');
    // each volume is drawn with report levels (½×, 1×, 2× its mean), then the user's settings return
    expect(calls).toContain('iso:{"WholeRoomFluence":[0.21,0.42,0.85]}');
    expect(calls).toContain('iso:{"breath":[0.6,1.2,2.4]}');
    expect(calls.at(-3)).toBe('vis:null');
    expect(calls.at(-2)).toBe('iso:null');
    expect(calls.at(-1)).toBe('render');
    expect(calls.filter(c => c === 'setCamera:1,2,3').length).toBe(1);
  });

  it('keeps the current camera for coverView=current and never calls a preset for the cover', async () => {
    const { api, calls } = fakeApi();
    await captureReportImages(api, { coverView: 'current', volumes: [], lampIds: [], colormap: 'plasma' });
    expect(calls.filter(c => c.startsWith('view:'))).toEqual([]);
  });

  it('restores on failure', async () => {
    const { api, calls, canvas } = fakeApi();
    (canvas.toDataURL as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => { throw new Error('boom'); });
    await expect(captureReportImages(api, { coverView: 'current', volumes: [], lampIds: [], colormap: 'plasma' })).rejects.toThrow('boom');
    expect(calls).toContain('restore');
    expect(calls.at(-3)).toBe('vis:null');
    expect(calls.at(-2)).toBe('iso:null');
    expect(calls.some(c => c.startsWith('setCamera:'))).toBe(true);
  });

  it('rejects when there is no canvas', async () => {
    const { api } = fakeApi();
    const noCanvas = { ...api, canvas: () => null };
    await expect(captureReportImages(noCanvas, { coverView: 'current', volumes: [], lampIds: [], colormap: 'plasma' })).rejects.toThrow(/3D view/);
  });
});

describe('report capture encoding', () => {
  function stubOffscreenCanvas() {
    const ctx = { fillRect: vi.fn(), drawImage: vi.fn(), fillStyle: '', imageSmoothingEnabled: false, imageSmoothingQuality: '' };
    const off = { width: 0, height: 0, getContext: vi.fn(() => ctx), toDataURL: vi.fn(() => 'data:image/jpeg;base64,/9j/') };
    const spy = vi.spyOn(document, 'createElement').mockImplementation(() => off as unknown as HTMLCanvasElement);
    return { ctx, off, restore: () => spy.mockRestore() };
  }

  it('encodes report views as JPEG composited on white, upscaled to the minimum width', async () => {
    const { api } = fakeApi();
    const { ctx, off, restore } = stubOffscreenCanvas();
    try {
      const out = await captureReportImages(api, { coverView: 'current', volumes: [], lampIds: [], colormap: 'plasma' });
      expect(out.cover).toBe('data:image/jpeg;base64,/9j/');
      expect(off.width).toBe(1600);
      expect(off.height).toBe(1200);
      // a transparent capture would turn black in JPEG; the page it lands on is white
      expect(ctx.fillStyle).toBe('#ffffff');
      expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 1600, 1200);
      expect(off.toDataURL).toHaveBeenCalledWith('image/jpeg', 0.9);
    } finally {
      restore();
    }
  });

  it('goes through the offscreen canvas for JPEG even when no upscale is needed', async () => {
    const { api, canvas } = fakeApi();
    const { off, restore } = stubOffscreenCanvas();
    try {
      const out = await captureReportImages(api, { coverView: 'current', volumes: [], lampIds: [], colormap: 'plasma', minWidth: 800 });
      expect(out.cover).toBe('data:image/jpeg;base64,/9j/');
      expect(off.width).toBe(800);
      expect(canvas.toDataURL).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('falls back to the PNG the canvas gives when no 2D context is available', async () => {
    const { api, canvas } = fakeApi();
    const out = await captureReportImages(api, { coverView: 'current', volumes: [], lampIds: [], colormap: 'plasma' });
    expect(out.cover).toBe('data:image/png;base64,AAAA');
    expect(canvas.toDataURL).toHaveBeenCalledWith('image/png');
  });

  it('keeps thumbnails as transparent PNG', async () => {
    const { api } = fakeApi();
    const { off, restore } = stubOffscreenCanvas();
    try {
      off.toDataURL.mockImplementation(((type: string) => `data:${type};base64,x`) as never);
      const t = await captureThumbnails(api, ['current'], 160);
      expect(t.current).toBe('data:image/png;base64,x');
      expect(off.toDataURL).toHaveBeenCalledWith('image/png');
    } finally {
      restore();
    }
  });
});

describe('captureThumbnails', () => {
  it('renders each requested view and restores the camera', async () => {
    const { api, calls } = fakeApi();
    const t = await captureThumbnails(api, ['current', 'iso-front-left', 'top', 'front'], 160);
    expect(Object.keys(t)).toEqual(['current', 'iso-front-left', 'top', 'front']);
    expect(calls.filter(c => c.startsWith('view:'))).toEqual(['view:iso-front-left', 'view:top', 'view:front']);
    expect(calls).toContain('vis:{"hidePhotometricWebs":true}');
    expect(calls.at(-3)).toBe('vis:null');
  });
});

describe('reportIsoLevels', () => {
  it('is half, once and twice the mean at two significant figures', () => {
    expect(reportIsoLevels(0.4237)).toEqual([0.21, 0.42, 0.85]);
    expect(reportIsoLevels(12.5)).toEqual([6.3, 13, 25]);
  });
  it('is empty without a usable mean', () => {
    expect(reportIsoLevels(0)).toEqual([]);
    expect(reportIsoLevels(null)).toEqual([]);
    expect(reportIsoLevels(Number.NaN)).toEqual([]);
  });
});
