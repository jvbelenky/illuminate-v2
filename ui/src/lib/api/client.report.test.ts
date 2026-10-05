import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { postSessionReportPdf } from './client';

describe('postSessionReportPdf', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('POSTs the request as JSON and returns the PDF blob', async () => {
    // Node's Response stringifies a Blob body ("[object Blob]"); pass raw bytes instead
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), { status: 200, headers: { 'content-type': 'application/pdf' } })
    );
    const blob = await postSessionReportPdf({ meta: { title: 'T', client: '', prepared_by: '', notes: '' }, pathogens: ['Human coronavirus'], options: { include_lamp_appendix: true, include_methodology: true, page_size: 'auto' }, images: {} });
    expect(blob.size).toBe(4);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/session\/report\/pdf$/);
    expect(init?.method).toBe('POST');
    const contentType = Object.entries(init?.headers as Record<string, string>).find(([k]) => k.toLowerCase() === 'content-type')?.[1];
    expect(contentType).toMatch(/application\/json/);
    expect(JSON.parse(init?.body as string).pathogens).toEqual(['Human coronavirus']);
  });

  it('allows the PDF render minutes, not the 30 s given to ordinary requests', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), { status: 200, headers: { 'content-type': 'application/pdf' } })
    );
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    await postSessionReportPdf({ meta: { title: 'T', client: '', prepared_by: '', notes: '' }, pathogens: ['Human coronavirus'], options: { include_lamp_appendix: true, include_methodology: true, page_size: 'auto' }, images: {} });
    expect(timeoutSpy).toHaveBeenCalledTimes(1);
    expect(timeoutSpy.mock.calls[0][0]).toBeGreaterThanOrEqual(300_000);
  });

  it('surfaces the backend detail on an error response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: "No inactivation data for 'Foo' at the lamps' wavelengths" }), { status: 422, headers: { 'content-type': 'application/json' } })
    );
    await expect(postSessionReportPdf({ meta: { title: 'T', client: '', prepared_by: '', notes: '' }, pathogens: ['Foo'], options: { include_lamp_appendix: true, include_methodology: true, page_size: 'auto' }, images: {} })).rejects.toThrow(/No inactivation data for 'Foo'/);
  });
});
