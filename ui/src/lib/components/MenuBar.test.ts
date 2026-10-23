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
    onSaveAs: vi.fn(),
    onLoad: vi.fn(),
    onAddLamp: vi.fn(),
    onAddZone: vi.fn(),
    onAddObject: vi.fn(),
    onShowReflectanceSettings: vi.fn(),
    onShowLampManager: vi.fn(),
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
    onShowGettingStarted: vi.fn(),
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

  it('offers Save As in the File menu', async () => {
    const onSaveAs = vi.fn();
    render(MenuBar, { props: { ...defaultProps, onSaveAs } });
    await fireEvent.click(screen.getByText('File'));
    await fireEvent.click(screen.getByText('Save As...'));
    expect(onSaveAs).toHaveBeenCalled();
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

  it('disables Show Floor Plan Image when there is no floor plan image', async () => {
    render(MenuBar, { props: { ...defaultProps, hasFloorPlanImage: false } });
    await fireEvent.click(screen.getByText('View'));
    const item = screen.getByRole('menuitem', { name: /Show Floor Plan Image/i });
    expect(item.getAttribute('aria-disabled')).toBe('true');
  });

  describe('workspace layout', () => {
    const labels = ['Side by side', 'Stacked', '2D large + 3D inset', '3D large + 2D inset'];

    async function openLayout() {
      await fireEvent.click(screen.getByText('View'));
      await fireEvent.mouseEnter(screen.getByText('Layout').closest('.has-submenu') as HTMLElement);
    }

    it('View › Layout lists the four layouts with a check on the current one', async () => {
      render(MenuBar, {
        props: { ...defaultProps, workspaceLayout: 'stack', onSetWorkspaceLayout: vi.fn(), onSwapViews: vi.fn() }
      });
      await openLayout();
      for (const l of labels) expect(screen.getByText(l)).toBeTruthy();
      const checked = screen.getAllByRole('menuitem').filter((el) => el.textContent?.includes('✓'));
      expect(checked.map((el) => el.textContent?.replace('✓', '').trim())).toContain('Stacked');
      expect(screen.getByText('Stacked').parentElement?.textContent).toContain('✓');
      expect(screen.getByText('Side by side').parentElement?.textContent).not.toContain('✓');
    });

    it('picking a layout calls onSetWorkspaceLayout and closes the menu', async () => {
      const onSetWorkspaceLayout = vi.fn();
      const { container } = render(MenuBar, {
        props: { ...defaultProps, workspaceLayout: 'side', onSetWorkspaceLayout, onSwapViews: vi.fn() }
      });
      await openLayout();
      await fireEvent.click(screen.getByText('2D large + 3D inset'));
      expect(onSetWorkspaceLayout).toHaveBeenCalledWith('pip-2d');
      expect(container.querySelector('.menu-dropdown')).toBeNull();
    });

    it('Swap views calls onSwapViews', async () => {
      const onSwapViews = vi.fn();
      render(MenuBar, {
        props: { ...defaultProps, workspaceLayout: 'side', onSetWorkspaceLayout: vi.fn(), onSwapViews }
      });
      await fireEvent.click(screen.getByText('View'));
      await fireEvent.click(screen.getByText('Swap views'));
      expect(onSwapViews).toHaveBeenCalled();
    });

    it('is absent without onSetWorkspaceLayout', async () => {
      render(MenuBar, { props: defaultProps });
      await fireEvent.click(screen.getByText('View'));
      expect(screen.queryByText('Layout')).toBeNull();
      expect(screen.queryByText('Swap views')).toBeNull();
    });

    it('the mobile menu offers the same entries', async () => {
      const onSetWorkspaceLayout = vi.fn();
      const onSwapViews = vi.fn();
      render(MenuBar, {
        props: { ...defaultProps, isMobile: true, workspaceLayout: 'stack', onSetWorkspaceLayout, onSwapViews }
      });
      await fireEvent.click(screen.getByLabelText('Open menu'));
      await fireEvent.click(screen.getByText('View'));
      for (const l of labels) expect(screen.getByText(l)).toBeTruthy();
      expect(screen.getByText('Stacked').parentElement?.textContent).toContain('✓');
      await fireEvent.click(screen.getByText('3D large + 2D inset'));
      expect(onSetWorkspaceLayout).toHaveBeenCalledWith('pip-3d');
    });

    it('the mobile menu Swap views calls onSwapViews', async () => {
      const onSwapViews = vi.fn();
      render(MenuBar, {
        props: { ...defaultProps, isMobile: true, workspaceLayout: 'side', onSetWorkspaceLayout: vi.fn(), onSwapViews }
      });
      await fireEvent.click(screen.getByLabelText('Open menu'));
      await fireEvent.click(screen.getByText('View'));
      await fireEvent.click(screen.getByText('Swap views'));
      expect(onSwapViews).toHaveBeenCalled();
    });
  });
});
