<script lang="ts">
	import { theme, type Theme } from '$lib/stores/theme';
	import type { ZoneDisplayMode } from '$lib/types/project';

	interface Props {
		projectName: string;
		onRenameProject: (name: string) => void;
		onNewProject: () => void;
		onSave: () => void;
		onLoad: () => void;
		onAddLamp: () => void;
		onAddZone: () => void;
		onShowDisplaySettings: () => void;
		onShowAudit: () => void;
		onShowHelp: () => void;
		onShowCite: () => void;
		onShowAbout: () => void;
		leftPanelCollapsed: boolean;
		rightPanelCollapsed: boolean;
		showDimensions: boolean;
		showPhotometricWebs: boolean;
		onToggleLeftPanel: () => void;
		onToggleRightPanel: () => void;
		onToggleShowDimensions: () => void;
		onToggleShowPhotometricWebs: () => void;
		currentZoneDisplayMode: ZoneDisplayMode | null;
		onSetAllZonesDisplayMode: (mode: ZoneDisplayMode) => void;
	}

	let {
		projectName,
		onRenameProject,
		onNewProject,
		onSave,
		onLoad,
		onAddLamp,
		onAddZone,
		onShowDisplaySettings,
		onShowAudit,
		onShowHelp,
		onShowCite,
		onShowAbout,
		leftPanelCollapsed,
		rightPanelCollapsed,
		showDimensions,
		showPhotometricWebs,
		onToggleLeftPanel,
		onToggleRightPanel,
		onToggleShowDimensions,
		onToggleShowPhotometricWebs,
		currentZoneDisplayMode,
		onSetAllZonesDisplayMode
	}: Props = $props();

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
					activeSubmenu = 'theme';
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
					activeSubmenu = 'theme';
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

		const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
		const modifier = isMac ? event.metaKey : event.ctrlKey;

		if (modifier) {
			switch (event.key.toLowerCase()) {
				case 'n':
					event.preventDefault();
					onNewProject();
					break;
				case 'o':
					event.preventDefault();
					onLoad();
					break;
				case 's':
					event.preventDefault();
					onSave();
					break;
			}
		}

		if (event.key === 'F1') {
			event.preventDefault();
			onShowHelp();
		}
	}

	const modKey = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0 ? '⌘' : 'Ctrl';
</script>

<svelte:window onkeydown={handleKeydown} onclick={handleClickOutside} />

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
						<span class="shortcut">{modKey}+N</span>
					</div>
					<div class="menu-item" onclick={(e) => handleMenuAction(onLoad, e)} onkeydown={(e) => e.key === 'Enter' && handleMenuAction(onLoad)} role="menuitem" tabindex="0">
						<span>Open...</span>
						<span class="shortcut">{modKey}+O</span>
					</div>
					<div class="menu-separator"></div>
					<div class="menu-item" onclick={(e) => handleMenuAction(onSave, e)} onkeydown={(e) => e.key === 'Enter' && handleMenuAction(onSave)} role="menuitem" tabindex="0">
						<span>Save</span>
						<span class="shortcut">{modKey}+S</span>
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
					<div class="menu-separator"></div>
					<div class="menu-item" onclick={(e) => handleMenuAction(onToggleLeftPanel, e)} onkeydown={(e) => e.key === 'Enter' && handleMenuAction(onToggleLeftPanel)} role="menuitem" tabindex="0">
						<span class="checkmark">{!leftPanelCollapsed ? '✓' : ''}</span>
						<span>Show Left Panel</span>
					</div>
					<div class="menu-item" onclick={(e) => handleMenuAction(onToggleRightPanel, e)} onkeydown={(e) => e.key === 'Enter' && handleMenuAction(onToggleRightPanel)} role="menuitem" tabindex="0">
						<span class="checkmark">{!rightPanelCollapsed ? '✓' : ''}</span>
						<span>Show Right Panel</span>
					</div>
					<div class="menu-item" onclick={(e) => handleMenuAction(onToggleShowDimensions, e)} onkeydown={(e) => e.key === 'Enter' && handleMenuAction(onToggleShowDimensions)} role="menuitem" tabindex="0">
						<span class="checkmark">{showDimensions ? '✓' : ''}</span>
						<span>Show Dimensions</span>
					</div>
					<div class="menu-item" onclick={(e) => handleMenuAction(onToggleShowPhotometricWebs, e)} onkeydown={(e) => e.key === 'Enter' && handleMenuAction(onToggleShowPhotometricWebs)} role="menuitem" tabindex="0">
						<span class="checkmark">{showPhotometricWebs ? '✓' : ''}</span>
						<span>Show Photometric Webs</span>
					</div>
					<div class="menu-separator"></div>
					<!-- Calc Zone Display Mode submenu -->
					<div
						class="menu-item has-submenu"
						onmouseenter={() => activeSubmenu = 'zoneDisplay'}
						onmouseleave={() => activeSubmenu = null}
						role="menuitem"
						tabindex="0"
					>
						<span>Calc Zone Display</span>
						{#if activeSubmenu === 'zoneDisplay'}
							<div class="menu-submenu">
								<div class="menu-item" onclick={(e) => { onSetAllZonesDisplayMode('heatmap'); handleMenuAction(() => {}, e); }} onkeydown={(e) => e.key === 'Enter' && onSetAllZonesDisplayMode('heatmap')} role="menuitem" tabindex="0">
									<span class="checkmark">{currentZoneDisplayMode === 'heatmap' ? '✓' : ''}</span>
									<span>All Heatmap</span>
								</div>
								<div class="menu-item" onclick={(e) => { onSetAllZonesDisplayMode('numeric'); handleMenuAction(() => {}, e); }} onkeydown={(e) => e.key === 'Enter' && onSetAllZonesDisplayMode('numeric')} role="menuitem" tabindex="0">
									<span class="checkmark">{currentZoneDisplayMode === 'numeric' ? '✓' : ''}</span>
									<span>All Numeric</span>
								</div>
								<div class="menu-item" onclick={(e) => { onSetAllZonesDisplayMode('markers'); handleMenuAction(() => {}, e); }} onkeydown={(e) => e.key === 'Enter' && onSetAllZonesDisplayMode('markers')} role="menuitem" tabindex="0">
									<span class="checkmark">{currentZoneDisplayMode === 'markers' ? '✓' : ''}</span>
									<span>All Markers</span>
								</div>
							</div>
						{/if}
					</div>
					<div class="menu-separator"></div>
					<div class="menu-item" onclick={(e) => handleMenuAction(onShowDisplaySettings, e)} onkeydown={(e) => e.key === 'Enter' && handleMenuAction(onShowDisplaySettings)} role="menuitem" tabindex="0">
						<span>Display Settings...</span>
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
						<span class="shortcut">F1</span>
					</div>
					<div class="menu-separator"></div>
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
