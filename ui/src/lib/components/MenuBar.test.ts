import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import MenuBar from './MenuBar.svelte';

describe('MenuBar', () => {
  const defaultProps = {
    projectName: 'Untitled Project',
    onRenameProject: vi.fn(),
    onNewProject: vi.fn(),
    onSave: vi.fn(),
    onLoad: vi.fn(),
    onAddLamp: vi.fn(),
    onAddZone: vi.fn(),
    onShowDisplaySettings: vi.fn(),
    onShowHelp: vi.fn(),
    onShowAbout: vi.fn(),
    leftPanelCollapsed: false,
    rightPanelCollapsed: false,
    onToggleLeftPanel: vi.fn(),
    onToggleRightPanel: vi.fn(),
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
