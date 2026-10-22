<script lang="ts">
	import type { PlotLevelsSource, PlotView, ZonePlotSettings } from '$lib/types/project';
	import {
		addLevel,
		limitLevels,
		PERCENT_PRESETS,
		setLevelLabel,
		MAX_LEVELS,
		planeViews,
		removeLevel,
		roundSig,
		setLevelColor,
		setLevelValue,
		type ColorScale,
		type LevelList,
		type LimitSet,
		type ResolvedPlotSettings,
		type ZoneKind,
	} from '$lib/utils/plotScale';

	interface Props {
		kind: ZoneKind;
		settings: ResolvedPlotSettings;
		/** The scale in force, for the levels and colors it resolved to. */
		scale: ColorScale;
		/** The zone's limits, for the Limits and percentage presets. */
		limits?: LimitSet | null;
		unitLabel: string;
		/** What the plot is titled when no custom title is set. */
		defaultTitle: string;
		onChange: (partial: Partial<ZonePlotSettings>) => void;
	}

	let { kind, settings, scale, limits = null, unitLabel, defaultTitle, onChange }: Props = $props();

	const VIEW_LABELS: Record<PlotView, string> = { heatmap: 'Heatmap', contours: 'Contours', iso: 'Iso' };
	const views = $derived<PlotView[]>(kind === 'plane' ? planeViews() : ['iso']);
	const banded = $derived(scale.levels !== null);
	const list = $derived<LevelList>({ levels: scale.levels ?? [], colors: settings.colors, labels: settings.labels });
	const percentPresets = $derived(PERCENT_PRESETS.filter((p) => limits?.named.some((l) => l.name === p.limit)));

	/** A preset keeps the number of levels shown; the limits set their own. */
	function choosePreset(source: PlotLevelsSource) {
		const levelCount = list.levels.length || settings.levelCount;
		if (source === 'auto') {
			onChange({ levelsSource: 'auto', levelCount, colors: [], labels: [] });
			return;
		}
		const set = limitLevels({ levelsSource: source, levelCount }, limits);
		if (set) onChange({ levelsSource: source, levelCount, levels: set.levels, colors: [], labels: [...set.labels] });
	}

	/** A level edit pins the list as typed-in levels. */
	function setList(next: LevelList) {
		onChange({ levelsSource: 'custom', levels: next.levels, colors: next.colors, labels: next.labels });
	}

	function commitValue(index: number, input: HTMLInputElement) {
		const value = parseFloat(input.value);
		if (Number.isFinite(value) && value > 0 && value !== list.levels[index]) {
			setList(setLevelValue(list, index, value));
		} else {
			input.value = String(roundSig(list.levels[index], 4));
		}
	}

	function commitDecimals(input: HTMLInputElement) {
		const value = parseInt(input.value, 10);
		if (Number.isInteger(value) && value >= 0 && value <= 6) onChange({ decimals: value });
		else input.value = String(settings.decimals);
	}
</script>

<div class="plot-settings">
	<div class="setting">
		<label class="setting-label" for="plot-title">Title</label>
		<input
			id="plot-title"
			type="text"
			class="title-input"
			value={settings.title ?? ''}
			placeholder={defaultTitle}
			onchange={(e) => onChange({ title: e.currentTarget.value.trim() || undefined })}
		/>
	</div>

	{#if views.length > 1}
		<div class="setting">
			<span class="setting-label" id="plot-view-label">View</span>
			<div class="seg" role="group" aria-labelledby="plot-view-label">
				{#each views as view (view)}
					<button type="button" class:active={settings.view === view} aria-pressed={settings.view === view} onclick={() => onChange({ view })}>
						{VIEW_LABELS[view]}
					</button>
				{/each}
			</div>
		</div>
	{/if}

	{#if banded}
		<div class="setting">
			<div class="levels-head">
				<span class="setting-label">Levels ({unitLabel})</span>
				<select class="preset-select" aria-label="Level preset" value={settings.levelsSource} onchange={(e) => choosePreset(e.currentTarget.value as PlotLevelsSource)}>
					<option value="auto">Auto</option>
					{#if limits}
						<option value="limits">Limits</option>
						{#each percentPresets as preset (preset.source)}
							<option value={preset.source}>% {preset.limit}</option>
						{/each}
					{/if}
					{#if settings.levelsSource === 'custom'}
						<option value="custom" disabled>Custom</option>
					{/if}
				</select>
			</div>
			<div class="level-list">
				<div class="level-row level-head" aria-hidden="true">
					<span class="swatch-space"></span>
					<span class="col-name">Name</span>
					<span class="col-value">Value</span>
					<span class="remove-space"></span>
				</div>
				{#each list.levels as level, i (`${i}-${level}`)}
					<div class="level-row">
						<input
							type="color"
							class="level-swatch"
							value={scale.colors[i]}
							aria-label="Color for level {roundSig(level, 4)}"
							onchange={(e) => onChange({ colors: setLevelColor(list, i, e.currentTarget.value).colors })}
						/>
						<input
							type="text"
							class="level-label"
							value={list.labels[i] ?? ''}
							placeholder={String(roundSig(level, 4))}
							aria-label="Name for level {i + 1}"
							onchange={(e) => onChange({ labels: setLevelLabel(list, i, e.currentTarget.value).labels })}
						/>
						<input
							type="number"
							class="level-value"
							step="any"
							min="0"
							value={roundSig(level, 4)}
							aria-label="Level {i + 1}"
							onchange={(e) => commitValue(i, e.currentTarget)}
						/>
						<button
							type="button"
							class="level-remove"
							title="Remove level"
							aria-label="Remove level {roundSig(level, 4)}"
							disabled={list.levels.length <= 1}
							onclick={() => setList(removeLevel(list, i))}
						>&times;</button>
					</div>
				{/each}
			</div>
			{#if list.levels.length < MAX_LEVELS}
				<button type="button" class="add-level" onclick={() => setList(addLevel(list, scale.range.max))}>+ Add level</button>
			{/if}
		</div>
	{/if}

	{#if settings.view === 'contours'}
		<label class="check-row">
			<input type="checkbox" checked={settings.filled} onchange={(e) => onChange({ filled: e.currentTarget.checked })} />
			<span>Filled bands</span>
		</label>
	{/if}

	<div class="setting inline">
		<label class="setting-label" for="plot-decimals">Decimals</label>
		<input id="plot-decimals" type="number" class="decimals" min="0" max="6" step="1" value={settings.decimals} onchange={(e) => commitDecimals(e.currentTarget)} />
	</div>
</div>

<style>
	.plot-settings {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
	}

	.setting {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	.setting.inline {
		flex-direction: row;
		align-items: center;
		justify-content: space-between;
	}

	.setting-label {
		display: block;
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}

	.seg {
		display: flex;
		gap: var(--spacing-xs);
	}

	.seg button {
		flex: 1 1 0;
		min-width: 0;
		padding: 5px 2px;
		background: var(--color-bg);
		border: 2px solid var(--color-bg);
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
	}

	.seg button:hover:not(.active):not(:disabled) {
		border-color: var(--color-border);
		color: var(--color-text);
	}

	.seg button.active {
		background: var(--color-bg-tertiary);
		border-color: var(--color-highlight);
		color: var(--color-text);
	}

	.seg button:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.levels-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--spacing-xs);
		flex-wrap: wrap;
	}

	.preset-select {
		width: auto;
		padding: 2px 6px;
		font-size: var(--font-size-xs);
	}

	.level-list {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.level-row {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
	}

	.level-swatch {
		width: 26px;
		height: 26px;
		flex: none;
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: none;
		cursor: pointer;
	}

	.level-swatch::-webkit-color-swatch-wrapper {
		padding: 2px;
	}

	.level-swatch::-webkit-color-swatch {
		border: none;
		border-radius: 2px;
	}

	.level-swatch::-moz-color-swatch {
		border: none;
		border-radius: 2px;
	}

	.level-head {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}

	.swatch-space {
		width: 26px;
		flex: none;
	}

	.remove-space {
		width: 26px;
		flex: none;
	}

	.col-name {
		flex: 1;
		min-width: 0;
		padding-left: var(--spacing-sm);
	}

	.col-value {
		flex: none;
		width: 4.2rem;
		text-align: right;
		padding-right: var(--spacing-sm);
	}

	.level-label {
		flex: 1;
		min-width: 0;
		padding: 4px var(--spacing-sm);
		font-size: var(--font-size-sm);
	}

	.level-value {
		flex: none;
		width: 4.2rem;
		padding: 4px var(--spacing-sm);
		font-size: var(--font-size-sm);
		text-align: right;
	}

	.level-remove {
		width: 26px;
		flex: none;
		text-align: center;
		background: none;
		border: none;
		color: var(--color-text-muted);
		font-size: 1.05rem;
		line-height: 1;
		padding: 2px 0;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	.level-remove:hover:not(:disabled) {
		color: var(--color-text);
		background: var(--color-bg-tertiary);
	}

	.level-remove:disabled {
		opacity: 0.3;
		cursor: default;
	}

	.add-level {
		align-self: flex-start;
		margin-top: 2px;
		background: none;
		border: 1px dashed var(--color-border);
		color: var(--color-text-muted);
		border-radius: var(--radius-sm);
		padding: 3px 10px;
		font-size: var(--font-size-sm);
		cursor: pointer;
	}

	.add-level:hover {
		background: none;
		color: var(--color-text);
		border-color: var(--color-text-muted);
	}

	.check-row {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		cursor: pointer;
	}

	.title-input {
		padding: 4px var(--spacing-sm);
		font-size: var(--font-size-sm);
	}

	.decimals {
		width: 4.5rem;
		padding: 4px;
		text-align: center;
		font-size: var(--font-size-sm);
	}
</style>
