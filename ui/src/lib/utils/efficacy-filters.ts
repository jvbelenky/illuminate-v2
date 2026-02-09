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
  resistant_fraction: number;
  medium: string;
  condition: string;
  reference: string;
  link: string;
  each_uv: number;
  seconds_to_99: number;
}

export interface EfficacyFilters {
  medium?: string;
  category?: string;
  wavelength?: number;
  speciesSearch?: string;
  conditionSearch?: string;
}

export interface EfficacyStats {
  median: number;
  min: number;
  max: number;
  count: number;
}

/**
 * Map from guv-calcs column names to our field names.
 * Also supports the legacy lowercase names for backward compatibility.
 */
const COLUMN_ALIASES: Record<string, string> = {
  // guv-calcs names
  'Category': 'category',
  'Species': 'species',
  'Strain': 'strain',
  'wavelength [nm]': 'wavelength',
  'k1 [cm2/mJ]': 'k1',
  'k2 [cm2/mJ]': 'k2',
  '% resistant': 'resistant_fraction',
  'Medium': 'medium',
  'Condition': 'condition',
  'Reference': 'reference',
  'Link': 'link',
  'eACH-UV': 'each_uv',
  'Seconds to 99% inactivation': 'seconds_to_99',
  // legacy names (from old backend format)
  'category': 'category',
  'species': 'species',
  'strain': 'strain',
  'wavelength': 'wavelength',
  'k1': 'k1',
  'k2': 'k2',
  'medium': 'medium',
  'each_uv': 'each_uv',
  'seconds_to_99': 'seconds_to_99',
};

/**
 * Parse the raw API table response into typed rows.
 * Handles both guv-calcs column names and legacy lowercase names.
 */
export function parseTableResponse(columns: string[], rows: unknown[][]): EfficacyRow[] {
  // Build index map from our field names to column positions
  const fieldIndices: Record<string, number> = {};
  columns.forEach((col, idx) => {
    const field = COLUMN_ALIASES[col];
    if (field && !(field in fieldIndices)) {
      fieldIndices[field] = idx;
    }
  });

  const getVal = (row: unknown[], field: string): unknown => {
    const idx = fieldIndices[field];
    return idx !== undefined ? row[idx] : undefined;
  };

  // Clean string values: convert null/None/undefined to empty string
  const cleanStr = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = String(v).trim();
    if (s === 'None' || s === 'null' || s === 'undefined') return '';
    return s;
  };

  return rows.map(row => {
    // Parse % resistant: could be a string like "5%" or a number like 0.05 or 5
    const resistantRaw = getVal(row, 'resistant_fraction');
    let resistantFraction = 0;
    if (resistantRaw !== null && resistantRaw !== undefined && resistantRaw !== '') {
      const str = String(resistantRaw).trim();
      if (str.endsWith('%')) {
        resistantFraction = parseFloat(str) / 100;
      } else {
        const num = parseFloat(str);
        // Values > 1 are likely percentages
        resistantFraction = num > 1 ? num / 100 : num;
      }
      if (isNaN(resistantFraction)) resistantFraction = 0;
    }

    return {
      category: cleanStr(getVal(row, 'category')),
      species: cleanStr(getVal(row, 'species')),
      strain: cleanStr(getVal(row, 'strain')),
      wavelength: Number(getVal(row, 'wavelength') ?? 0),
      k1: Number(getVal(row, 'k1') ?? 0),
      k2: (() => {
        const v = getVal(row, 'k2');
        if (v === null || v === undefined || v === '' || v === ' ') return null;
        const n = Number(v);
        return isNaN(n) ? null : n;
      })(),
      resistant_fraction: resistantFraction,
      medium: cleanStr(getVal(row, 'medium')),
      condition: cleanStr(getVal(row, 'condition')),
      reference: cleanStr(getVal(row, 'reference')),
      link: cleanStr(getVal(row, 'link')),
      each_uv: Number(getVal(row, 'each_uv') ?? 0),
      seconds_to_99: Number(getVal(row, 'seconds_to_99') ?? 0)
    };
  });
}

/**
 * Filter efficacy data based on the provided filters.
 * All filtering is case-insensitive for text searches.
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

    // Filter by condition search (case-insensitive partial match)
    if (filters.conditionSearch && filters.conditionSearch.trim() !== '') {
      const search = filters.conditionSearch.toLowerCase().trim();
      if (!row.condition.toLowerCase().includes(search)) {
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
 * Generate a composite key for unique row identification.
 */
export function getRowKey(row: EfficacyRow): string {
  return `${row.species}|${row.strain}|${row.wavelength}|${row.condition}`;
}

/**
 * Export filtered data as CSV.
 */
export function exportToCSV(data: EfficacyRow[], logLabel?: string): string {
  const timeHeader = logLabel ? `Time to ${logLabel} (s)` : 'Time to 99% (s)';
  const headers = [
    'Category', 'Species', 'Strain', 'Wavelength (nm)',
    'k1 (cm\u00b2/mJ)', 'k2', '% Resistant',
    'Medium', 'Condition', 'Reference', 'Link',
    'eACH-UV', timeHeader
  ];

  const rows = data.map(row => [
    row.category,
    row.species,
    row.strain,
    row.wavelength,
    row.k1,
    row.k2 ?? '',
    row.resistant_fraction > 0 ? (row.resistant_fraction * 100).toFixed(1) + '%' : '',
    row.medium,
    row.condition,
    row.reference,
    row.link,
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
