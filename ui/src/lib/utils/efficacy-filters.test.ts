/**
 * Tests for efficacy filter utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  parseTableResponse,
  filterData,
  computeStats,
  getUniqueCategories,
  getCategoryColor,
  sortData,
  exportToCSV,
  type EfficacyRow,
  type EfficacyFilters,
} from './efficacy-filters';

// Sample data for tests
const sampleColumns = ['category', 'species', 'strain', 'wavelength', 'k1', 'k2', 'medium', 'each_uv', 'seconds_to_99'];

const sampleRows: unknown[][] = [
  ['Virus', 'SARS-CoV-2', 'Alpha', 222, 0.5, 0.1, 'Aerosol', 3.5, 120],
  ['Bacteria', 'E. coli', 'K-12', 254, 0.3, null, 'Surface', 2.0, 180],
  ['Virus', 'Influenza A', 'H1N1', 222, 0.4, 0.05, 'Aerosol', 4.0, 100],
  ['Fungi', 'Aspergillus', 'niger', 222, 0.1, null, 'Aerosol', 1.5, 300],
];

describe('parseTableResponse', () => {
  it('parses valid response correctly', () => {
    const result = parseTableResponse(sampleColumns, sampleRows);

    expect(result).toHaveLength(4);
    expect(result[0]).toEqual({
      category: 'Virus',
      species: 'SARS-CoV-2',
      strain: 'Alpha',
      wavelength: 222,
      k1: 0.5,
      k2: 0.1,
      medium: 'Aerosol',
      each_uv: 3.5,
      seconds_to_99: 120,
    });
  });

  it('handles null k2 values', () => {
    const result = parseTableResponse(sampleColumns, sampleRows);

    expect(result[1].k2).toBeNull();
    expect(result[3].k2).toBeNull();
  });

  it('handles empty rows', () => {
    const result = parseTableResponse(sampleColumns, []);
    expect(result).toHaveLength(0);
  });

  it('handles missing column values', () => {
    const incompleteRows = [['Virus', 'Test']]; // Missing most columns
    const result = parseTableResponse(sampleColumns, incompleteRows);

    expect(result[0].category).toBe('Virus');
    expect(result[0].species).toBe('Test');
    expect(result[0].wavelength).toBe(0); // Default for missing number
  });
});

describe('filterData', () => {
  const data = parseTableResponse(sampleColumns, sampleRows);

  it('returns all data with no filters', () => {
    const result = filterData(data, {});
    expect(result).toHaveLength(4);
  });

  it('filters by medium', () => {
    const result = filterData(data, { medium: 'Aerosol' });
    expect(result).toHaveLength(3);
    expect(result.every(r => r.medium === 'Aerosol')).toBe(true);
  });

  it('filters by category', () => {
    const result = filterData(data, { category: 'Virus' });
    expect(result).toHaveLength(2);
    expect(result.every(r => r.category === 'Virus')).toBe(true);
  });

  it('filters by wavelength', () => {
    const result = filterData(data, { wavelength: 222 });
    expect(result).toHaveLength(3);
    expect(result.every(r => r.wavelength === 222)).toBe(true);
  });

  it('filters by species search (case insensitive)', () => {
    const result = filterData(data, { speciesSearch: 'coli' });
    expect(result).toHaveLength(1);
    expect(result[0].species).toBe('E. coli');
  });

  it('filters by strain search', () => {
    const result = filterData(data, { speciesSearch: 'H1N1' });
    expect(result).toHaveLength(1);
    expect(result[0].species).toBe('Influenza A');
  });

  it('combines multiple filters', () => {
    const result = filterData(data, {
      medium: 'Aerosol',
      category: 'Virus',
    });
    expect(result).toHaveLength(2);
  });

  it('handles "All" filter value', () => {
    const result = filterData(data, { medium: 'All' });
    expect(result).toHaveLength(4);
  });

  it('handles wavelength 0 as "no filter"', () => {
    const result = filterData(data, { wavelength: 0 });
    expect(result).toHaveLength(4);
  });

  it('handles empty search string', () => {
    const result = filterData(data, { speciesSearch: '  ' });
    expect(result).toHaveLength(4);
  });
});

describe('computeStats', () => {
  it('computes stats correctly for multiple values', () => {
    const data: EfficacyRow[] = [
      { category: 'A', species: 'a', strain: '', wavelength: 222, k1: 0.1, k2: null, medium: 'Aerosol', each_uv: 1, seconds_to_99: 100 },
      { category: 'B', species: 'b', strain: '', wavelength: 222, k1: 0.1, k2: null, medium: 'Aerosol', each_uv: 2, seconds_to_99: 100 },
      { category: 'C', species: 'c', strain: '', wavelength: 222, k1: 0.1, k2: null, medium: 'Aerosol', each_uv: 3, seconds_to_99: 100 },
      { category: 'D', species: 'd', strain: '', wavelength: 222, k1: 0.1, k2: null, medium: 'Aerosol', each_uv: 4, seconds_to_99: 100 },
      { category: 'E', species: 'e', strain: '', wavelength: 222, k1: 0.1, k2: null, medium: 'Aerosol', each_uv: 5, seconds_to_99: 100 },
    ];

    const stats = computeStats(data);

    expect(stats.min).toBe(1);
    expect(stats.max).toBe(5);
    expect(stats.median).toBe(3);
    expect(stats.count).toBe(5);
  });

  it('computes median for even count', () => {
    const data: EfficacyRow[] = [
      { category: 'A', species: 'a', strain: '', wavelength: 222, k1: 0.1, k2: null, medium: 'Aerosol', each_uv: 1, seconds_to_99: 100 },
      { category: 'B', species: 'b', strain: '', wavelength: 222, k1: 0.1, k2: null, medium: 'Aerosol', each_uv: 2, seconds_to_99: 100 },
      { category: 'C', species: 'c', strain: '', wavelength: 222, k1: 0.1, k2: null, medium: 'Aerosol', each_uv: 3, seconds_to_99: 100 },
      { category: 'D', species: 'd', strain: '', wavelength: 222, k1: 0.1, k2: null, medium: 'Aerosol', each_uv: 4, seconds_to_99: 100 },
    ];

    const stats = computeStats(data);
    expect(stats.median).toBe(2.5); // Average of 2 and 3
  });

  it('returns zeros for empty data', () => {
    const stats = computeStats([]);

    expect(stats.min).toBe(0);
    expect(stats.max).toBe(0);
    expect(stats.median).toBe(0);
    expect(stats.count).toBe(0);
  });

  it('handles single value', () => {
    const data: EfficacyRow[] = [
      { category: 'A', species: 'a', strain: '', wavelength: 222, k1: 0.1, k2: null, medium: 'Aerosol', each_uv: 5, seconds_to_99: 100 },
    ];

    const stats = computeStats(data);

    expect(stats.min).toBe(5);
    expect(stats.max).toBe(5);
    expect(stats.median).toBe(5);
    expect(stats.count).toBe(1);
  });

  it('handles NaN and Infinity values', () => {
    const data: EfficacyRow[] = [
      { category: 'A', species: 'a', strain: '', wavelength: 222, k1: 0.1, k2: null, medium: 'Aerosol', each_uv: NaN, seconds_to_99: 100 },
      { category: 'B', species: 'b', strain: '', wavelength: 222, k1: 0.1, k2: null, medium: 'Aerosol', each_uv: Infinity, seconds_to_99: 100 },
      { category: 'C', species: 'c', strain: '', wavelength: 222, k1: 0.1, k2: null, medium: 'Aerosol', each_uv: 5, seconds_to_99: 100 },
    ];

    const stats = computeStats(data);

    expect(stats.count).toBe(1); // Only valid value counted
    expect(stats.median).toBe(5);
  });
});

describe('getUniqueCategories', () => {
  const data = parseTableResponse(sampleColumns, sampleRows);

  it('returns unique categories', () => {
    const categories = getUniqueCategories(data);
    expect(categories).toEqual(['Bacteria', 'Fungi', 'Virus']);
  });

  it('returns sorted categories', () => {
    const categories = getUniqueCategories(data);
    const sorted = [...categories].sort();
    expect(categories).toEqual(sorted);
  });

  it('returns empty array for empty data', () => {
    const categories = getUniqueCategories([]);
    expect(categories).toEqual([]);
  });
});

describe('getCategoryColor', () => {
  it('returns color for Virus', () => {
    expect(getCategoryColor('Virus')).toBe('#e94560');
  });

  it('returns color for Bacteria', () => {
    expect(getCategoryColor('Bacteria')).toBe('#4ade80');
  });

  it('returns color for Fungi', () => {
    expect(getCategoryColor('Fungi')).toBe('#60a5fa');
  });

  it('returns color for Protozoa', () => {
    expect(getCategoryColor('Protozoa')).toBe('#fbbf24');
  });

  it('returns fallback color for unknown category', () => {
    expect(getCategoryColor('Unknown')).toBe('#a0a0a0');
  });
});

describe('sortData', () => {
  const data = parseTableResponse(sampleColumns, sampleRows);

  it('sorts by string column ascending', () => {
    const sorted = sortData(data, 'species', true);
    expect(sorted[0].species).toBe('Aspergillus');
    expect(sorted[sorted.length - 1].species).toBe('SARS-CoV-2');
  });

  it('sorts by string column descending', () => {
    const sorted = sortData(data, 'species', false);
    expect(sorted[0].species).toBe('SARS-CoV-2');
    expect(sorted[sorted.length - 1].species).toBe('Aspergillus');
  });

  it('sorts by number column ascending', () => {
    const sorted = sortData(data, 'each_uv', true);
    expect(sorted[0].each_uv).toBe(1.5);
    expect(sorted[sorted.length - 1].each_uv).toBe(4.0);
  });

  it('sorts by number column descending', () => {
    const sorted = sortData(data, 'each_uv', false);
    expect(sorted[0].each_uv).toBe(4.0);
    expect(sorted[sorted.length - 1].each_uv).toBe(1.5);
  });

  it('handles null values in sort', () => {
    const sorted = sortData(data, 'k2', true);
    // Nulls should be sorted to end for ascending
    expect(sorted[sorted.length - 1].k2).toBeNull();
    expect(sorted[sorted.length - 2].k2).toBeNull();
  });

  it('does not mutate original array', () => {
    const original = [...data];
    sortData(data, 'species', true);
    expect(data).toEqual(original);
  });
});

describe('exportToCSV', () => {
  const data = parseTableResponse(sampleColumns, sampleRows);

  it('includes header row', () => {
    const csv = exportToCSV(data);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('Category,Species,Strain,Wavelength (nm),k1 (cm²/mJ),k2,Medium,eACH-UV,Time to 99% (s)');
  });

  it('includes data rows', () => {
    const csv = exportToCSV(data);
    const lines = csv.split('\n');
    expect(lines.length).toBe(5); // 1 header + 4 data rows
  });

  it('handles null k2 values', () => {
    const csv = exportToCSV(data);
    const lines = csv.split('\n');
    // Second data row (E. coli) has null k2
    expect(lines[2]).toContain('E. coli');
    // Should have empty string for null k2
    const parts = lines[2].split(',');
    expect(parts[5]).toBe(''); // k2 column
  });

  it('escapes commas in values', () => {
    const dataWithComma: EfficacyRow[] = [
      { category: 'Virus', species: 'Test, species', strain: '', wavelength: 222, k1: 0.1, k2: null, medium: 'Aerosol', each_uv: 1, seconds_to_99: 100 },
    ];
    const csv = exportToCSV(dataWithComma);
    expect(csv).toContain('"Test, species"');
  });

  it('escapes quotes in values', () => {
    const dataWithQuote: EfficacyRow[] = [
      { category: 'Virus', species: 'Test "quoted" species', strain: '', wavelength: 222, k1: 0.1, k2: null, medium: 'Aerosol', each_uv: 1, seconds_to_99: 100 },
    ];
    const csv = exportToCSV(dataWithQuote);
    expect(csv).toContain('"Test ""quoted"" species"');
  });

  it('returns only header for empty data', () => {
    const csv = exportToCSV([]);
    const lines = csv.split('\n');
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain('Category');
  });
});
