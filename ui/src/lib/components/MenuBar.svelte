<script lang="ts">
	import { theme, type Theme } from '$lib/stores/theme';

	interface Props {
		onNewProject: () => void;
		onSave: () => void;
		onLoad: () => void;
		onAddLamp: () => void;
		onAddZone: () => void;
		onShowDisplaySettings: () => void;
		onShowHelp: () => void;
		onShowAbout: () => void;
		leftPanelCollapsed: boolean;
		rightPanelCollapsed: boolean;
		onToggleLeftPanel: () => void;
		onToggleRightPanel: () => void;
	}

	let {
		onNewProject,
		onSave,
		onLoad,
		onAddLamp,
		onAddZone,
		onShowDisplaySettings,
		onShowHelp,
		onShowAbout,
		leftPanelCollapsed,
		rightPanelCollapsed,
		onToggleLeftPanel,
		onToggleRightPanel
	}: Props = $props();

	type MenuId = 'file' | 'edit' | 'view' | 'help' | null;
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

	// Keyboard shortcuts
	function handleKeydown(event: KeyboardEvent) {
		// Close on escape
		if (event.key === 'Escape') {
			closeMenus();
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

	// Menu ordering for left/right navigation
	const menuOrder: MenuId[] = ['file', 'edit', 'view', 'help'];

	function handleMenuKeydown(event: KeyboardEvent) {
		if (!activeMenu) return;

		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			const dropdown = document.querySelector('.menu-bar-item.active .menu-dropdown');
			if (!dropdown) return;
			const items = Array.from(dropdown.querySelectorAll('[role="menuitem"]:not(.disabled)')) as HTMLElement[];
			if (items.length === 0) return;

			const focused = document.activeElement as HTMLElement;
			let idx = items.indexOf(focused);

			if (event.key === 'ArrowDown') {
				idx = idx < items.length - 1 ? idx + 1 : 0;
			} else {
				idx = idx > 0 ? idx - 1 : items.length - 1;
			}
			items[idx].focus();
		}

		if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
			event.preventDefault();
			const currentIdx = menuOrder.indexOf(activeMenu);
			if (currentIdx === -1) return;

			let nextIdx: number;
			if (event.key === 'ArrowRight') {
				nextIdx = (currentIdx + 1) % menuOrder.length;
			} else {
				nextIdx = (currentIdx - 1 + menuOrder.length) % menuOrder.length;
			}
			activeMenu = menuOrder[nextIdx];
			activeSubmenu = null;

			// Focus the first item in the new dropdown after it renders
			requestAnimationFrame(() => {
				const dropdown = document.querySelector('.menu-bar-item.active .menu-dropdown');
				if (!dropdown) return;
				const firstItem = dropdown.querySelector('[role="menuitem"]:not(.disabled)') as HTMLElement;
				firstItem?.focus();
			});
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
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="menu-dropdown" onkeydown={handleMenuKeydown}>
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
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="menu-dropdown" onkeydown={handleMenuKeydown}>
					<div class="menu-item" onclick={(e) => handleMenuAction(onAddLamp, e)} onkeydown={(e) => e.key === 'Enter' && handleMenuAction(onAddLamp)} role="menuitem" tabindex="0">
						<span>Add Lamp</span>
					</div>
					<div class="menu-item" onclick={(e) => handleMenuAction(onAddZone, e)} onkeydown={(e) => e.key === 'Enter' && handleMenuAction(onAddZone)} role="menuitem" tabindex="0">
						<span>Add Zone</span>
					</div>
					<div class="menu-separator"></div>
					<div class="menu-item" onclick={(e) => handleMenuAction(onShowDisplaySettings, e)} onkeydown={(e) => e.key === 'Enter' && handleMenuAction(onShowDisplaySettings)} role="menuitem" tabindex="0">
						<span>Display Settings...</span>
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
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="menu-dropdown" onkeydown={handleMenuKeydown}>
					<!-- Theme submenu -->
					<div
						class="menu-item has-submenu"
						onmouseenter={() => activeSubmenu = 'theme'}
						onmouseleave={() => activeSubmenu = null}
						role="menuitem"
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
				</div>
			{/if}
		</div>

		<!-- Help Menu -->
		<div class="menu-bar-item" class:active={activeMenu === 'help'}>
			<span onclick={() => toggleMenu('help')} onkeydown={(e) => e.key === 'Enter' && toggleMenu('help')} role="button" tabindex="0">
				Help
			</span>
			{#if activeMenu === 'help'}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="menu-dropdown" onkeydown={handleMenuKeydown}>
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

	<div class="menu-title">Illuminate v2</div>

	<div class="menu-right"></div>
</nav>
