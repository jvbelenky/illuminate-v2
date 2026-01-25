/**
 * Client-side filtering and statistics for efficacy data.
 * All filtering is done in the browser for instant interactivity.
 */

export interface EfficacyRow {
  category: string;
  species: string;
  strain: string;
  wavelength: number;
  k1: number;
  k2: number | null;
  medium: string;
  each_uv: number;
  seconds_to_99: number;
}

export interface EfficacyFilters {
  medium?: string;
  category?: string;
  wavelength?: number;
  speciesSearch?: string;
}

export interface EfficacyStats {
  median: number;
  min: number;
  max: number;
  count: number;
}

/**
 * Parse the raw API table response into typed rows.
 * The API returns columns: ['category', 'species', 'strain', 'wavelength', 'k1', 'k2', 'medium', 'each_uv', 'seconds_to_99']
 */
export function parseTableResponse(columns: string[], rows: unknown[][]): EfficacyRow[] {
  const categoryIdx = columns.indexOf('category');
  const speciesIdx = columns.indexOf('species');
  const strainIdx = columns.indexOf('strain');
  const wavelengthIdx = columns.indexOf('wavelength');
  const k1Idx = columns.indexOf('k1');
  const k2Idx = columns.indexOf('k2');
  const mediumIdx = columns.indexOf('medium');
  const eachUvIdx = columns.indexOf('each_uv');
  const secondsTo99Idx = columns.indexOf('seconds_to_99');

  return rows.map(row => ({
    category: String(row[categoryIdx] ?? ''),
    species: String(row[speciesIdx] ?? ''),
    strain: String(row[strainIdx] ?? ''),
    wavelength: Number(row[wavelengthIdx] ?? 0),
    k1: Number(row[k1Idx] ?? 0),
    k2: row[k2Idx] !== null && row[k2Idx] !== undefined ? Number(row[k2Idx]) : null,
    medium: String(row[mediumIdx] ?? ''),
    each_uv: Number(row[eachUvIdx] ?? 0),
    seconds_to_99: Number(row[secondsTo99Idx] ?? 0)
  }));
}

/**
 * Filter efficacy data based on the provided filters.
 * All filtering is case-insensitive for the species search.
 */
export function filterData(data: EfficacyRow[], filters: EfficacyFilters): EfficacyRow[] {
  return data.filter(row => {
    // Filter by medium
    if (filters.medium && filters.medium !== 'All' && row.medium !== filters.medium) {
      return false;
    }

    // Filter by category
    if (filters.category && filters.category !== 'All' && row.category !== filters.category) {
      return false;
    }

    // Filter by wavelength
    if (filters.wavelength && filters.wavelength !== 0 && row.wavelength !== filters.wavelength) {
      return false;
    }

    // Filter by species search (case-insensitive partial match on species or strain)
    if (filters.speciesSearch && filters.speciesSearch.trim() !== '') {
      const search = filters.speciesSearch.toLowerCase().trim();
      const speciesMatch = row.species.toLowerCase().includes(search);
      const strainMatch = row.strain.toLowerCase().includes(search);
      if (!speciesMatch && !strainMatch) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Compute statistics for the eACH-UV values in the filtered data.
 */
export function computeStats(data: EfficacyRow[]): EfficacyStats {
  if (data.length === 0) {
    return { median: 0, min: 0, max: 0, count: 0 };
  }

  const values = data.map(row => row.each_uv).filter(v => !isNaN(v) && isFinite(v));

  if (values.length === 0) {
    return { median: 0, min: 0, max: 0, count: 0 };
  }

  // Sort for median calculation
  const sorted = [...values].sort((a, b) => a - b);

  const min = sorted[0];
  const max = sorted[sorted.length - 1];

  // Calculate median
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];

  return {
    median,
    min,
    max,
    count: values.length
  };
}

/**
 * Get unique categories from the data.
 */
export function getUniqueCategories(data: EfficacyRow[]): string[] {
  const categories = new Set(data.map(row => row.category));
  return Array.from(categories).sort();
}

/**
 * Category colors for the swarm plot.
 * Uses distinct colors for each pathogen category.
 */
const CATEGORY_COLORS: Record<string, string> = {
  'Virus': '#e94560',
  'Bacteria': '#4ade80',
  'Fungi': '#60a5fa',
  'Protozoa': '#fbbf24',
  'Prion': '#a855f7',
  'Algae': '#14b8a6'
};

/**
 * Get color for a category.
 */
export function getCategoryColor(category: string): string {
  return CATEGORY_COLORS[category] || '#a0a0a0';
}

/**
 * Sort data by a column.
 */
export function sortData(
  data: EfficacyRow[],
  column: keyof EfficacyRow,
  ascending: boolean
): EfficacyRow[] {
  return [...data].sort((a, b) => {
    const aVal = a[column];
    const bVal = b[column];

    // Handle nulls
    if (aVal === null && bVal === null) return 0;
    if (aVal === null) return ascending ? 1 : -1;
    if (bVal === null) return ascending ? -1 : 1;

    // Compare values
    if (typeof aVal === 'number' && typeof bVal === 'number') {
      return ascending ? aVal - bVal : bVal - aVal;
    }

    // String comparison
    const aStr = String(aVal);
    const bStr = String(bVal);
    return ascending ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
  });
}

/**
 * Export filtered data as CSV.
 */
export function exportToCSV(data: EfficacyRow[]): string {
  const headers = ['Category', 'Species', 'Strain', 'Wavelength (nm)', 'k1 (cm²/mJ)', 'k2', 'Medium', 'eACH-UV', 'Time to 99% (s)'];

  const rows = data.map(row => [
    row.category,
    row.species,
    row.strain,
    row.wavelength,
    row.k1,
    row.k2 ?? '',
    row.medium,
    row.each_uv.toFixed(2),
    row.seconds_to_99.toFixed(1)
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => {
      // Escape cells that contain commas or quotes
      const cellStr = String(cell);
      if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
        return `"${cellStr.replace(/"/g, '""')}"`;
      }
      return cellStr;
    }).join(','))
  ].join('\n');

  return csvContent;
}
