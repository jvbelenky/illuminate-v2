import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import MenuBar from './MenuBar.svelte';

describe('MenuBar', () => {
  const defaultProps = {
    isMobile: false,
    projectName: 'Untitled Project',
    onRenameProject: vi.fn(),
    onNewProject: vi.fn(),
    onSave: vi.fn(),
    onLoad: vi.fn(),
    onAddLamp: vi.fn(),
    onAddZone: vi.fn(),
    onShowReflectanceSettings: vi.fn(),
    onShowFileManager: vi.fn(),
    onShowSettings: vi.fn(),
    onShowAudit: vi.fn(),
    onShowExploreData: vi.fn(),
    onShowSpectrumViewer: vi.fn(),
    onShowExport: vi.fn(),
    onShowHelp: vi.fn(),
    onShowCite: vi.fn(),
    onShowAbout: vi.fn(),
    onOpenSettingsDisplay: vi.fn(),
    showDimensions: true,
    showPhotometricWebs: true,
    showGrid: true,
    showXYZMarker: true,
    showLampLabels: false,
    showCalcPointLabels: false,
    colormap: 'plasma',
    precision: 2,
    onToggleShowDimensions: vi.fn(),
    onToggleShowPhotometricWebs: vi.fn(),
    onToggleShowGrid: vi.fn(),
    onToggleShowXYZMarker: vi.fn(),
    onToggleShowLampLabels: vi.fn(),
    onToggleShowCalcPointLabels: vi.fn(),
    onSetColormap: vi.fn(),
    onSetPrecision: vi.fn(),
    currentZoneDisplayMode: null,
    onSetAllZonesDisplayMode: vi.fn(),
    globalHeatmapNormalization: false,
    onToggleGlobalHeatmapNormalization: vi.fn(),
  };

  it('renders menu bar', () => {
    const { container } = render(MenuBar, { props: defaultProps });
    expect(container.querySelector('.menu-bar')).toBeTruthy();
  });

  it('renders File menu', () => {
    render(MenuBar, { props: defaultProps });
    expect(screen.getByText('File')).toBeTruthy();
  });

  it('renders Edit menu', () => {
    render(MenuBar, { props: defaultProps });
    expect(screen.getByText('Edit')).toBeTruthy();
  });

  it('renders View menu', () => {
    render(MenuBar, { props: defaultProps });
    expect(screen.getByText('View')).toBeTruthy();
  });

  it('renders Help menu', () => {
    render(MenuBar, { props: defaultProps });
    expect(screen.getByText('Help')).toBeTruthy();
  });

  it('opens dropdown on menu click', async () => {
    const { container } = render(MenuBar, { props: defaultProps });
    await fireEvent.click(screen.getByText('File'));
    expect(container.querySelector('.menu-dropdown')).toBeTruthy();
  });

  it('shows New Project in File menu', async () => {
    render(MenuBar, { props: defaultProps });
    await fireEvent.click(screen.getByText('File'));
    expect(screen.getByText('New Project')).toBeTruthy();
  });

  it('shows Add Lamp in Edit menu', async () => {
    render(MenuBar, { props: defaultProps });
    await fireEvent.click(screen.getByText('Edit'));
    expect(screen.getByText('Add Lamp')).toBeTruthy();
  });

  it('renders app title', () => {
    const { container } = render(MenuBar, { props: defaultProps });
    expect(container.querySelector('.menu-title')).toBeTruthy();
  });
});
