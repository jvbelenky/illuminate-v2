<script lang="ts">
	import { theme, type Theme } from '$lib/stores/theme';
	import type { ZoneDisplayMode } from '$lib/types/project';

	interface Props {
		isMobile: boolean;
		projectName: string;
		onRenameProject: (name: string) => void;
		onNewProject: () => void;
		onSave: () => void;
		onLoad: () => void;
		onAddLamp: () => void;
		onAddZone: () => void;
		onShowReflectanceSettings: () => void;
		onShowAudit: () => void;
		onShowExploreData: () => void;
		onShowHelp: () => void;
		onShowCite: () => void;
		onShowAbout: () => void;
		leftPanelCollapsed: boolean;
		rightPanelCollapsed: boolean;
		showDimensions: boolean;
		showPhotometricWebs: boolean;
		showGrid: boolean;
		showXYZMarker: boolean;
		colormap: string;
		precision: number;
		onToggleLeftPanel: () => void;
		onToggleRightPanel: () => void;
		onToggleShowDimensions: () => void;
		onToggleShowPhotometricWebs: () => void;
		onToggleShowGrid: () => void;
		onToggleShowXYZMarker: () => void;
		onSetColormap: (cm: string) => void;
		onSetPrecision: (p: number) => void;
		currentZoneDisplayMode: ZoneDisplayMode | null;
		onSetAllZonesDisplayMode: (mode: ZoneDisplayMode) => void;
		globalHeatmapNormalization: boolean;
		onToggleGlobalHeatmapNormalization: () => void;
	}

	let {
		isMobile,
		projectName,
		onRenameProject,
		onNewProject,
		onSave,
		onLoad,
		onAddLamp,
		onAddZone,
		onShowReflectanceSettings,
		onShowAudit,
		onShowExploreData,
		onShowHelp,
		onShowCite,
		onShowAbout,
		leftPanelCollapsed,
		rightPanelCollapsed,
		showDimensions,
		showPhotometricWebs,
		showGrid,
		showXYZMarker,
		colormap,
		precision,
		onToggleLeftPanel,
		onToggleRightPanel,
		onToggleShowDimensions,
		onToggleShowPhotometricWebs,
		onToggleShowGrid,
		onToggleShowXYZMarker,
		onSetColormap,
		onSetPrecision,
		currentZoneDisplayMode,
		onSetAllZonesDisplayMode,
		globalHeatmapNormalization,
		onToggleGlobalHeatmapNormalization
	}: Props = $props();

	const colormapOptions = [
		'plasma', 'viridis', 'magma', 'inferno', 'cividis',
		'plasma_r', 'viridis_r', 'magma_r', 'inferno_r', 'cividis_r'
	];

	const precisionOptions = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

	let editing = $state(false);
	let editValue = $state('');
	let inputEl = $state<HTMLInputElement | null>(null);

	function startEditing() {
		editValue = projectName;
		editing = true;
		requestAnimationFrame(() => {
			inputEl?.select();
		});
	}

	function commitEdit() {
		editing = false;
		const trimmed = editValue.trim();
		if (trimmed && trimmed !== projectName) {
			onRenameProject(trimmed);
		}
	}

	function cancelEdit() {
		editing = false;
	}

	function handleEditKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			commitEdit();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			cancelEdit();
		}
		event.stopPropagation();
	}

	// Mobile menu state
	let mobileMenuOpen = $state(false);
	let expandedSection = $state<string | null>(null);

	function toggleMobileMenu() {
		mobileMenuOpen = !mobileMenuOpen;
		if (!mobileMenuOpen) {
			expandedSection = null;
		}
	}

	function closeMobileMenu() {
		mobileMenuOpen = false;
		expandedSection = null;
	}

	function toggleSection(section: string) {
		expandedSection = expandedSection === section ? null : section;
	}

	function mobileAction(action: () => void) {
		action();
		closeMobileMenu();
	}

	function mobileToggle(action: () => void) {
		action();
	}

	function mobileSetTheme(newTheme: Theme) {
		theme.set(newTheme);
	}

	type MenuId = 'file' | 'edit' | 'view' | 'tools' | 'help' | null;
	let activeMenu = $state<MenuId>(null);
	let activeSubmenu = $state<string | null>(null);

	function toggleMenu(menuId: MenuId) {
		if (activeMenu === menuId) {
			activeMenu = null;
		} else {
			activeMenu = menuId;
		}
		activeSubmenu = null;
	}

	function closeMenus() {
		activeMenu = null;
		activeSubmenu = null;
	}

	function handleMenuAction(action: () => void, event?: MouseEvent) {
		event?.stopPropagation();
		action();
		closeMenus();
	}

	function handleToggleAction(action: () => void, event?: MouseEvent) {
		event?.stopPropagation();
		action();
	}

	function setTheme(newTheme: Theme) {
		theme.set(newTheme);
		closeMenus();
	}

	// Close menus when clicking outside
	function handleClickOutside(event: MouseEvent) {
		const target = event.target as HTMLElement;
		if (!target.closest('.menu-bar')) {
			closeMenus();
		}
	}

	// Menu ordering for left/right navigation
	const menuOrder: MenuId[] = ['file', 'edit', 'view', 'tools', 'help'];

	function switchMenu(direction: number) {
		const menuIdx = menuOrder.indexOf(activeMenu!);
		if (menuIdx === -1) return;
		const nextIdx = (menuIdx + direction + menuOrder.length) % menuOrder.length;
		activeMenu = menuOrder[nextIdx];
		activeSubmenu = null;

		requestAnimationFrame(() => {
			const dropdown = document.querySelector('.menu-bar-item.active > .menu-dropdown');
			if (!dropdown) return;
			const firstItem = dropdown.querySelector(':scope > [role="menuitem"]:not(.disabled)') as HTMLElement;
			firstItem?.focus();
		});
	}

	// Keyboard shortcuts + arrow key menu navigation
	function handleKeydown(event: KeyboardEvent) {
		// Close on escape
		if (event.key === 'Escape') {
			closeMenus();
			return;
		}

		// Arrow key navigation between top-level menu buttons when no dropdown is open
		if (!activeMenu && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
			const focused = document.activeElement as HTMLElement;
			const menuButton = focused?.closest('.menu-bar-item')?.querySelector('span[role="button"]');
			if (menuButton && focused === menuButton) {
				event.preventDefault();
				const buttons = Array.from(document.querySelectorAll('.menu-bar-item > span[role="button"]')) as HTMLElement[];
				const currentIdx = buttons.indexOf(focused);
				if (currentIdx === -1) return;
				const direction = event.key === 'ArrowRight' ? 1 : -1;
				const nextIdx = (currentIdx + direction + buttons.length) % buttons.length;
				buttons[nextIdx].focus();
				return;
			}
		}

		// Arrow key navigation when a menu is open
		// Only handle Enter when focus is on a menuitem (not a top-level menu button)
		const arrowKeys = ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'];
		const focused = document.activeElement as HTMLElement;
		const focusedIsMenuitem = focused?.getAttribute('role') === 'menuitem';
		if (activeMenu && (arrowKeys.includes(event.key) || (event.key === 'Enter' && focusedIsMenuitem))) {
			const submenuContainer = focused?.closest('.menu-submenu');

			// Submenu-aware navigation: handle keys when focus is inside a submenu
			if (submenuContainer) {
				event.preventDefault();
				const submenuItems = Array.from(submenuContainer.querySelectorAll('[role="menuitem"]')) as HTMLElement[];
				const currentIdx = submenuItems.indexOf(focused);

				if (event.key === 'ArrowDown') {
					const nextIdx = currentIdx < submenuItems.length - 1 ? currentIdx + 1 : 0;
					submenuItems[nextIdx].focus();
				} else if (event.key === 'ArrowUp') {
					const nextIdx = currentIdx > 0 ? currentIdx - 1 : submenuItems.length - 1;
					submenuItems[nextIdx].focus();
				} else if (event.key === 'Enter') {
					focused.click();
				} else if (event.key === 'ArrowLeft') {
					const dropdown = document.querySelector('.menu-bar-item.active > .menu-dropdown');
					const parentItem = dropdown?.querySelector('.has-submenu') as HTMLElement;
					activeSubmenu = null;
					parentItem?.focus();
				}
				// ArrowRight does nothing inside a submenu
				return;
			}

			event.preventDefault();

			const dropdown = document.querySelector('.menu-bar-item.active > .menu-dropdown');
			if (!dropdown) return;

			// Direct children only — excludes submenu items
			const items = Array.from(dropdown.querySelectorAll(':scope > [role="menuitem"]:not(.disabled)')) as HTMLElement[];
			if (items.length === 0) return;

			const currentIdx = items.indexOf(focused);

			if (event.key === 'ArrowDown') {
				const nextIdx = currentIdx < items.length - 1 ? currentIdx + 1 : 0;
				items[nextIdx].focus();
			} else if (event.key === 'ArrowUp') {
				const nextIdx = currentIdx > 0 ? currentIdx - 1 : items.length - 1;
				items[nextIdx].focus();
			} else if (event.key === 'Enter') {
				// If on a submenu trigger, open it; otherwise activate the item
				if (focused?.classList.contains('has-submenu')) {
					activeSubmenu = focused.dataset.submenu ?? null;
					requestAnimationFrame(() => {
						const submenu = focused.querySelector('.menu-submenu');
						if (!submenu) return;
						const firstItem = submenu.querySelector('[role="menuitem"]') as HTMLElement;
						firstItem?.focus();
					});
					return;
				}
				focused?.click();
			} else if (event.key === 'ArrowRight') {
				// If on a submenu trigger, open it
				if (focused?.classList.contains('has-submenu')) {
					activeSubmenu = focused.dataset.submenu ?? null;
					requestAnimationFrame(() => {
						const submenu = focused.querySelector('.menu-submenu');
						if (!submenu) return;
						const firstItem = submenu.querySelector('[role="menuitem"]') as HTMLElement;
						firstItem?.focus();
					});
					return;
				}
				switchMenu(1);
			} else if (event.key === 'ArrowLeft') {
				// If inside a submenu, close it and focus the parent trigger
				if (activeSubmenu) {
					const parentItem = dropdown.querySelector('.has-submenu') as HTMLElement;
					activeSubmenu = null;
					parentItem?.focus();
					return;
				}
				switchMenu(-1);
			}
			return;
		}

		if (event.key === 'F1') {
			event.preventDefault();
			onShowHelp();
		}
	}

</script>

<svelte:window onkeydown={handleKeydown} onclick={handleClickOutside} />

{#if isMobile}
<!-- Mobile menu bar -->
<nav class="menu-bar">
	<div class="menu-left">
		<button class="mobile-hamburger" onclick={toggleMobileMenu} aria-label="Open menu">
			<svg width="18" height="18" viewBox="0 0 18 18" fill="none">
				<rect y="3" width="18" height="2" rx="1" fill="currentColor"/>
				<rect y="8" width="18" height="2" rx="1" fill="currentColor"/>
				<rect y="13" width="18" height="2" rx="1" fill="currentColor"/>
			</svg>
		</button>
	</div>

	<div class="menu-title">
		{#if editing}
			<input
				bind:this={inputEl}
				bind:value={editValue}
				onblur={commitEdit}
				onkeydown={handleEditKeydown}
				class="menu-title-input"
				spellcheck="false"
			/>
		{:else}
			<span
				class="menu-title-text"
				onclick={startEditing}
				onkeydown={(e) => e.key === 'Enter' && startEditing()}
				role="button"
				tabindex="0"
				title="Click to rename project"
			>{projectName}.guv</span>
		{/if}
	</div>

	<div class="menu-right"><a class="app-name" href="https://www.github.com/jvbelenky/illuminate-v2" target="_blank" rel="noopener noreferrer">Illuminate v2</a></div>
</nav>

<!-- Mobile menu overlay -->
{#if mobileMenuOpen}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="mobile-menu-backdrop" onclick={closeMobileMenu} onkeydown={(e) => e.key === 'Escape' && closeMobileMenu()}></div>
	<nav class="mobile-menu-overlay" role="navigation" aria-label="Main menu">
		<div class="mobile-menu-header">
			<span class="mobile-menu-heading">Menu</span>
			<button class="mobile-menu-close" onclick={closeMobileMenu} aria-label="Close menu">
				<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
					<path d="M5 5L15 15M15 5L5 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
				</svg>
			</button>
		</div>

		<div class="mobile-menu-sections">
			<!-- File -->
			<div class="mobile-menu-section">
				<button class="mobile-section-header" onclick={() => toggleSection('file')}>
					<span>File</span>
					<span class="mobile-chevron" class:expanded={expandedSection === 'file'}></span>
				</button>
				{#if expandedSection === 'file'}
					<div class="mobile-section-items">
						<button class="mobile-menu-item" onclick={() => mobileAction(onNewProject)}>New Project</button>
						<button class="mobile-menu-item" onclick={() => mobileAction(onLoad)}>Open...</button>
						<button class="mobile-menu-item" onclick={() => mobileAction(onSave)}>Save</button>
					</div>
				{/if}
			</div>

			<!-- Edit -->
			<div class="mobile-menu-section">
				<button class="mobile-section-header" onclick={() => toggleSection('edit')}>
					<span>Edit</span>
					<span class="mobile-chevron" class:expanded={expandedSection === 'edit'}></span>
				</button>
				{#if expandedSection === 'edit'}
					<div class="mobile-section-items">
						<button class="mobile-menu-item" onclick={() => mobileAction(onAddLamp)}>Add Lamp</button>
						<button class="mobile-menu-item" onclick={() => mobileAction(onAddZone)}>Add Zone</button>
						<button class="mobile-menu-item" onclick={() => mobileAction(onShowReflectanceSettings)}>Reflectance Settings...</button>
					</div>
				{/if}
			</div>

			<!-- View -->
			<div class="mobile-menu-section">
				<button class="mobile-section-header" onclick={() => toggleSection('view')}>
					<span>View</span>
					<span class="mobile-chevron" class:expanded={expandedSection === 'view'}></span>
				</button>
				{#if expandedSection === 'view'}
					<div class="mobile-section-items">
						<div class="mobile-subsection-label">Theme</div>
						<button class="mobile-menu-item" onclick={() => mobileSetTheme('light')}>
							<span class="checkmark">{$theme === 'light' ? '✓' : ''}</span>
							<span>Light</span>
						</button>
						<button class="mobile-menu-item" onclick={() => mobileSetTheme('dark')}>
							<span class="checkmark">{$theme === 'dark' ? '✓' : ''}</span>
							<span>Dark</span>
						</button>

						<div class="mobile-subsection-label">Colormap</div>
						{#each colormapOptions as cm}
							<button class="mobile-menu-item" onclick={() => mobileToggle(() => onSetColormap(cm))}>
								<span class="checkmark">{colormap === cm ? '✓' : ''}</span>
								<span>{cm}</span>
							</button>
						{/each}

						<div class="mobile-subsection-label">Heatmap Scale</div>
						<button class="mobile-menu-item" onclick={() => mobileToggle(() => { if (globalHeatmapNormalization) onToggleGlobalHeatmapNormalization(); })}>
							<span class="checkmark">{!globalHeatmapNormalization ? '✓' : ''}</span>
							<span>Local</span>
						</button>
						<button class="mobile-menu-item" onclick={() => mobileToggle(() => { if (!globalHeatmapNormalization) onToggleGlobalHeatmapNormalization(); })}>
							<span class="checkmark">{globalHeatmapNormalization ? '✓' : ''}</span>
							<span>Global</span>
						</button>

						<div class="mobile-subsection-label">Decimal Precision</div>
						{#each precisionOptions as p}
							<button class="mobile-menu-item" onclick={() => mobileToggle(() => onSetPrecision(p))}>
								<span class="checkmark">{precision === p ? '✓' : ''}</span>
								<span>{p}</span>
							</button>
						{/each}

						<div class="mobile-item-separator"></div>
						<button class="mobile-menu-item" onclick={() => mobileToggle(onToggleShowDimensions)}>
							<span class="checkmark">{showDimensions ? '✓' : ''}</span>
							<span>Show Dimensions</span>
						</button>
						<button class="mobile-menu-item" onclick={() => mobileToggle(onToggleShowGrid)}>
							<span class="checkmark">{showGrid ? '✓' : ''}</span>
							<span>Show Grid</span>
						</button>
						<button class="mobile-menu-item" onclick={() => mobileToggle(onToggleShowPhotometricWebs)}>
							<span class="checkmark">{showPhotometricWebs ? '✓' : ''}</span>
							<span>Show Photometric Webs</span>
						</button>
						<button class="mobile-menu-item" onclick={() => mobileToggle(onToggleShowXYZMarker)}>
							<span class="checkmark">{showXYZMarker ? '✓' : ''}</span>
							<span>Show XYZ Marker</span>
						</button>

						<div class="mobile-subsection-label">Calc Zone Display</div>
						<button class="mobile-menu-item" onclick={() => mobileToggle(() => onSetAllZonesDisplayMode('heatmap'))}>
							<span class="checkmark">{currentZoneDisplayMode === 'heatmap' ? '✓' : ''}</span>
							<span>All Heatmap</span>
						</button>
						<button class="mobile-menu-item" onclick={() => mobileToggle(() => onSetAllZonesDisplayMode('numeric'))}>
							<span class="checkmark">{currentZoneDisplayMode === 'numeric' ? '✓' : ''}</span>
							<span>All Numeric</span>
						</button>
						<button class="mobile-menu-item" onclick={() => mobileToggle(() => onSetAllZonesDisplayMode('markers'))}>
							<span class="checkmark">{currentZoneDisplayMode === 'markers' ? '✓' : ''}</span>
							<span>All Markers</span>
						</button>
					</div>
				{/if}
			</div>

			<!-- Tools -->
			<div class="mobile-menu-section">
				<button class="mobile-section-header" onclick={() => toggleSection('tools')}>
					<span>Tools</span>
					<span class="mobile-chevron" class:expanded={expandedSection === 'tools'}></span>
				</button>
				{#if expandedSection === 'tools'}
					<div class="mobile-section-items">
						<button class="mobile-menu-item" onclick={() => mobileAction(onShowAudit)}>Design Audit...</button>
						<button class="mobile-menu-item" onclick={() => mobileAction(onShowExploreData)}>Explore Data...</button>
					</div>
				{/if}
			</div>

			<!-- Help -->
			<div class="mobile-menu-section">
				<button class="mobile-section-header" onclick={() => toggleSection('help')}>
					<span>Help</span>
					<span class="mobile-chevron" class:expanded={expandedSection === 'help'}></span>
				</button>
				{#if expandedSection === 'help'}
					<div class="mobile-section-items">
						<button class="mobile-menu-item" onclick={() => mobileAction(onShowHelp)}>Help Topics</button>
						<button class="mobile-menu-item" onclick={() => mobileAction(onShowCite)}>How To Cite</button>
						<button class="mobile-menu-item" onclick={() => mobileAction(onShowAbout)}>About Illuminate</button>
					</div>
				{/if}
			</div>
		</div>
	</nav>
{/if}

{:else}
<!-- Desktop menu bar -->
<nav class="menu-bar">
	<div class="menu-left">
		<!-- File Menu -->
		<div class="menu-bar-item" class:active={activeMenu === 'file'}>
			<span onclick={() => toggleMenu('file')} onkeydown={(e) => e.key === 'Enter' && toggleMenu('file')} role="button" tabindex="0">
				File
			</span>
			{#if activeMenu === 'file'}
				<div class="menu-dropdown" role="menu">
					<div class="menu-item" onclick={(e) => handleMenuAction(onNewProject, e)} onkeydown={(e) => e.key === 'Enter' && handleMenuAction(onNewProject)} role="menuitem" tabindex="0">
						<span>New Project</span>
					</div>
					<div class="menu-item" onclick={(e) => handleMenuAction(onLoad, e)} onkeydown={(e) => e.key === 'Enter' && handleMenuAction(onLoad)} role="menuitem" tabindex="0">
						<span>Open...</span>
					</div>
					<div class="menu-separator"></div>
					<div class="menu-item" onclick={(e) => handleMenuAction(onSave, e)} onkeydown={(e) => e.key === 'Enter' && handleMenuAction(onSave)} role="menuitem" tabindex="0">
						<span>Save</span>
					</div>
				</div>
			{/if}
		</div>

		<!-- Edit Menu -->
		<div class="menu-bar-item" class:active={activeMenu === 'edit'}>
			<span onclick={() => toggleMenu('edit')} onkeydown={(e) => e.key === 'Enter' && toggleMenu('edit')} role="button" tabindex="0">
				Edit
			</span>
			{#if activeMenu === 'edit'}
				<div class="menu-dropdown" role="menu">
					<div class="menu-item" onclick={(e) => handleMenuAction(onAddLamp, e)} onkeydown={(e) => e.key === 'Enter' && handleMenuAction(onAddLamp)} role="menuitem" tabindex="0">
						<span>Add Lamp</span>
					</div>
					<div class="menu-item" onclick={(e) => handleMenuAction(onAddZone, e)} onkeydown={(e) => e.key === 'Enter' && handleMenuAction(onAddZone)} role="menuitem" tabindex="0">
						<span>Add Zone</span>
					</div>
					<div class="menu-separator"></div>
					<div class="menu-item" onclick={(e) => handleMenuAction(onShowReflectanceSettings, e)} onkeydown={(e) => e.key === 'Enter' && handleMenuAction(onShowReflectanceSettings)} role="menuitem" tabindex="0">
						<span>Reflectance Settings...</span>
					</div>
				</div>
			{/if}
		</div>

		<!-- View Menu -->
		<div class="menu-bar-item" class:active={activeMenu === 'view'}>
			<span onclick={() => toggleMenu('view')} onkeydown={(e) => e.key === 'Enter' && toggleMenu('view')} role="button" tabindex="0">
				View
			</span>
			{#if activeMenu === 'view'}
				<div class="menu-dropdown" role="menu">
					<!-- Theme submenu -->
					<div
						class="menu-item has-submenu"
						data-submenu="theme"
						onmouseenter={() => activeSubmenu = 'theme'}
						onmouseleave={() => activeSubmenu = null}
						role="menuitem"
						tabindex="0"
					>
						<span>Theme</span>
						{#if activeSubmenu === 'theme'}
							<div class="menu-submenu">
								<div class="menu-item" onclick={() => setTheme('light')} onkeydown={(e) => e.key === 'Enter' && setTheme('light')} role="menuitem" tabindex="0">
									<span class="checkmark">{$theme === 'light' ? '✓' : ''}</span>
									<span>Light</span>
								</div>
								<div class="menu-item" onclick={() => setTheme('dark')} onkeydown={(e) => e.key === 'Enter' && setTheme('dark')} role="menuitem" tabindex="0">
									<span class="checkmark">{$theme === 'dark' ? '✓' : ''}</span>
									<span>Dark</span>
								</div>
							</div>
						{/if}
					</div>
					<!-- Colormap submenu -->
					<div
						class="menu-item has-submenu"
						data-submenu="colormap"
						onmouseenter={() => activeSubmenu = 'colormap'}
						onmouseleave={() => activeSubmenu = null}
						role="menuitem"
						tabindex="0"
					>
						<span>Colormap</span>
						{#if activeSubmenu === 'colormap'}
							<div class="menu-submenu">
								{#each colormapOptions as cm}
									<div class="menu-item" onclick={(e) => handleToggleAction(() => onSetColormap(cm), e)} onkeydown={(e) => e.key === 'Enter' && handleToggleAction(() => onSetColormap(cm))} role="menuitem" tabindex="0">
										<span class="checkmark">{colormap === cm ? '✓' : ''}</span>
										<span>{cm}</span>
									</div>
								{/each}
							</div>
						{/if}
					</div>
					<!-- Heatmap Scale submenu -->
					<div
						class="menu-item has-submenu"
						data-submenu="heatmapScale"
						onmouseenter={() => activeSubmenu = 'heatmapScale'}
						onmouseleave={() => activeSubmenu = null}
						role="menuitem"
						tabindex="0"
					>
						<span>Heatmap Scale</span>
						{#if activeSubmenu === 'heatmapScale'}
							<div class="menu-submenu">
								<div class="menu-item" onclick={(e) => handleToggleAction(() => { if (globalHeatmapNormalization) onToggleGlobalHeatmapNormalization(); }, e)} onkeydown={(e) => e.key === 'Enter' && handleToggleAction(() => { if (globalHeatmapNormalization) onToggleGlobalHeatmapNormalization(); })} role="menuitem" tabindex="0">
									<span class="checkmark">{!globalHeatmapNormalization ? '✓' : ''}</span>
									<span>Local</span>
								</div>
								<div class="menu-item" onclick={(e) => handleToggleAction(() => { if (!globalHeatmapNormalization) onToggleGlobalHeatmapNormalization(); }, e)} onkeydown={(e) => e.key === 'Enter' && handleToggleAction(() => { if (!globalHeatmapNormalization) onToggleGlobalHeatmapNormalization(); })} role="menuitem" tabindex="0">
									<span class="checkmark">{globalHeatmapNormalization ? '✓' : ''}</span>
									<span>Global</span>
								</div>
							</div>
						{/if}
					</div>
					<!-- Decimal Precision submenu -->
					<div
						class="menu-item has-submenu"
						data-submenu="precision"
						onmouseenter={() => activeSubmenu = 'precision'}
						onmouseleave={() => activeSubmenu = null}
						role="menuitem"
						tabindex="0"
					>
						<span>Decimal Precision</span>
						{#if activeSubmenu === 'precision'}
							<div class="menu-submenu">
								{#each precisionOptions as p}
									<div class="menu-item" onclick={(e) => handleToggleAction(() => onSetPrecision(p), e)} onkeydown={(e) => e.key === 'Enter' && handleToggleAction(() => onSetPrecision(p))} role="menuitem" tabindex="0">
										<span class="checkmark">{precision === p ? '✓' : ''}</span>
										<span>{p}</span>
									</div>
								{/each}
							</div>
						{/if}
					</div>
					<div class="menu-separator"></div>
					<div class="menu-item" onclick={(e) => handleToggleAction(onToggleLeftPanel, e)} onkeydown={(e) => e.key === 'Enter' && handleToggleAction(onToggleLeftPanel)} role="menuitem" tabindex="0">
						<span class="checkmark">{!leftPanelCollapsed ? '✓' : ''}</span>
						<span>Show Left Panel</span>
					</div>
					<div class="menu-item" onclick={(e) => handleToggleAction(onToggleRightPanel, e)} onkeydown={(e) => e.key === 'Enter' && handleToggleAction(onToggleRightPanel)} role="menuitem" tabindex="0">
						<span class="checkmark">{!rightPanelCollapsed ? '✓' : ''}</span>
						<span>Show Right Panel</span>
					</div>
					<div class="menu-separator"></div>
					<div class="menu-item" onclick={(e) => handleToggleAction(onToggleShowDimensions, e)} onkeydown={(e) => e.key === 'Enter' && handleToggleAction(onToggleShowDimensions)} role="menuitem" tabindex="0">
						<span class="checkmark">{showDimensions ? '✓' : ''}</span>
						<span>Show Dimensions</span>
					</div>
					<div class="menu-item" onclick={(e) => handleToggleAction(onToggleShowGrid, e)} onkeydown={(e) => e.key === 'Enter' && handleToggleAction(onToggleShowGrid)} role="menuitem" tabindex="0">
						<span class="checkmark">{showGrid ? '✓' : ''}</span>
						<span>Show Grid</span>
					</div>
					<div class="menu-item" onclick={(e) => handleToggleAction(onToggleShowPhotometricWebs, e)} onkeydown={(e) => e.key === 'Enter' && handleToggleAction(onToggleShowPhotometricWebs)} role="menuitem" tabindex="0">
						<span class="checkmark">{showPhotometricWebs ? '✓' : ''}</span>
						<span>Show Photometric Webs</span>
					</div>
					<div class="menu-item" onclick={(e) => handleToggleAction(onToggleShowXYZMarker, e)} onkeydown={(e) => e.key === 'Enter' && handleToggleAction(onToggleShowXYZMarker)} role="menuitem" tabindex="0">
						<span class="checkmark">{showXYZMarker ? '✓' : ''}</span>
						<span>Show XYZ Marker</span>
					</div>
					<div class="menu-separator"></div>
					<!-- Calc Zone Display Mode submenu -->
					<div
						class="menu-item has-submenu"
						data-submenu="zoneDisplay"
						onmouseenter={() => activeSubmenu = 'zoneDisplay'}
						onmouseleave={() => activeSubmenu = null}
						role="menuitem"
						tabindex="0"
					>
						<span>Calc Zone Display</span>
						{#if activeSubmenu === 'zoneDisplay'}
							<div class="menu-submenu">
								<div class="menu-item" onclick={(e) => handleToggleAction(() => onSetAllZonesDisplayMode('heatmap'), e)} onkeydown={(e) => e.key === 'Enter' && handleToggleAction(() => onSetAllZonesDisplayMode('heatmap'))} role="menuitem" tabindex="0">
									<span class="checkmark">{currentZoneDisplayMode === 'heatmap' ? '✓' : ''}</span>
									<span>All Heatmap</span>
								</div>
								<div class="menu-item" onclick={(e) => handleToggleAction(() => onSetAllZonesDisplayMode('numeric'), e)} onkeydown={(e) => e.key === 'Enter' && handleToggleAction(() => onSetAllZonesDisplayMode('numeric'))} role="menuitem" tabindex="0">
									<span class="checkmark">{currentZoneDisplayMode === 'numeric' ? '✓' : ''}</span>
									<span>All Numeric</span>
								</div>
								<div class="menu-item" onclick={(e) => handleToggleAction(() => onSetAllZonesDisplayMode('markers'), e)} onkeydown={(e) => e.key === 'Enter' && handleToggleAction(() => onSetAllZonesDisplayMode('markers'))} role="menuitem" tabindex="0">
									<span class="checkmark">{currentZoneDisplayMode === 'markers' ? '✓' : ''}</span>
									<span>All Markers</span>
								</div>
							</div>
						{/if}
					</div>
				</div>
			{/if}
		</div>

		<!-- Tools Menu -->
		<div class="menu-bar-item" class:active={activeMenu === 'tools'}>
			<span onclick={() => toggleMenu('tools')} onkeydown={(e) => e.key === 'Enter' && toggleMenu('tools')} role="button" tabindex="0">
				Tools
			</span>
			{#if activeMenu === 'tools'}
				<div class="menu-dropdown" role="menu">
					<div class="menu-item" onclick={(e) => handleMenuAction(onShowAudit, e)} onkeydown={(e) => e.key === 'Enter' && handleMenuAction(onShowAudit)} role="menuitem" tabindex="0">
						<span>Design Audit...</span>
					</div>
					<div class="menu-item" onclick={(e) => handleMenuAction(onShowExploreData, e)} onkeydown={(e) => e.key === 'Enter' && handleMenuAction(onShowExploreData)} role="menuitem" tabindex="0">
						<span>Explore Data...</span>
					</div>
				</div>
			{/if}
		</div>

		<!-- Help Menu -->
		<div class="menu-bar-item" class:active={activeMenu === 'help'}>
			<span onclick={() => toggleMenu('help')} onkeydown={(e) => e.key === 'Enter' && toggleMenu('help')} role="button" tabindex="0">
				Help
			</span>
			{#if activeMenu === 'help'}
				<div class="menu-dropdown" role="menu">
					<div class="menu-item" onclick={(e) => handleMenuAction(onShowHelp, e)} onkeydown={(e) => e.key === 'Enter' && handleMenuAction(onShowHelp)} role="menuitem" tabindex="0">
						<span>Help Topics</span>
					</div>
					<div class="menu-separator"></div>
					<div class="menu-item" onclick={(e) => handleMenuAction(onShowCite, e)} onkeydown={(e) => e.key === 'Enter' && handleMenuAction(onShowCite)} role="menuitem" tabindex="0">
						<span>How To Cite</span>
					</div>
					<div class="menu-item" onclick={(e) => handleMenuAction(onShowAbout, e)} onkeydown={(e) => e.key === 'Enter' && handleMenuAction(onShowAbout)} role="menuitem" tabindex="0">
						<span>About Illuminate</span>
					</div>
				</div>
			{/if}
		</div>
	</div>

	<div class="menu-title">
		{#if editing}
			<input
				bind:this={inputEl}
				bind:value={editValue}
				onblur={commitEdit}
				onkeydown={handleEditKeydown}
				class="menu-title-input"
				spellcheck="false"
			/>
		{:else}
			<span
				class="menu-title-text"
				onclick={startEditing}
				onkeydown={(e) => e.key === 'Enter' && startEditing()}
				role="button"
				tabindex="0"
				title="Click to rename project"
			>{projectName}.guv</span>
		{/if}
	</div>

	<div class="menu-right"><a class="app-name" href="https://www.github.com/jvbelenky/illuminate-v2" target="_blank" rel="noopener noreferrer">Illuminate v2</a></div>
</nav>
{/if}
