<script>
  import { onMount } from 'svelte'
  import MapView from './lib/MapView.svelte'
  import { regionOptions, regionById, regionColorMap } from './lib/regions.js'

  let dropdownRef
  let isMenuOpen = false
  let selectedRegion = 'all'
  let hoveredRegion = null
  const regionLabelId = 'region-dropdown-label'
  const regionButtonId = 'region-dropdown-button'

  const closeMenu = () => {
    isMenuOpen = false
    hoveredRegion = null
  }

  const handleOutsideClick = (event) => {
    if (dropdownRef && !dropdownRef.contains(event.target)) {
      closeMenu()
    }
  }

  const handleEscapeKey = (event) => {
    if (event.key === 'Escape') {
      closeMenu()
    }
  }

  onMount(() => {
    document.addEventListener('click', handleOutsideClick)
    document.addEventListener('keydown', handleEscapeKey)

    return () => {
      document.removeEventListener('click', handleOutsideClick)
      document.removeEventListener('keydown', handleEscapeKey)
    }
  })

  const selectOption = (option) => {
    if (option.disabled) return
    selectedRegion = option.id
    closeMenu()
  }

  const handleOptionFocus = (option) => {
    hoveredRegion = option.id === 'all' ? null : option.id
  }

  $: selectedOption = regionById[selectedRegion]
</script>

<main class="flex h-full w-full flex-1 flex-col gap-6 p-6 lg:flex-row lg:gap-10">
  <section class="flex w-full max-w-4xl flex-none flex-col gap-8 rounded-2xl border border-slate-200 bg-white p-8 text-left shadow-lg lg:w-[40rem] lg:h-full">
    <div class="space-y-3">
      <p class="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">YLS Summit 2025</p>
      <h1 class="text-3xl font-bold text-slate-900 sm:text-4xl">
        Equitable Bus Stop Allocation Case Study
      </h1>
    </div>

    <div class="space-y-2">
      <label for={regionButtonId} id={regionLabelId} class="text-sm font-semibold uppercase text-slate-500">Region</label>
      <div class="relative" bind:this={dropdownRef}>
        <button
          type="button"
          id={regionButtonId}
          class="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          aria-haspopup="listbox"
          aria-expanded={isMenuOpen}
          aria-labelledby={`${regionLabelId} ${regionButtonId}`}
          on:click|stopPropagation={() => {
            isMenuOpen = !isMenuOpen
          }}
        >
          <span>{selectedOption?.label ?? 'Select a region'}</span>
          <svg class={`h-4 w-4 text-slate-400 transition ${isMenuOpen ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path
              fill-rule="evenodd"
              d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 10.715l3.71-3.484a.75.75 0 1 1 1.04 1.08l-4.24 3.985a.75.75 0 0 1-1.04 0l-4.24-3.985a.75.75 0 0 1 .02-1.06Z"
              clip-rule="evenodd"
            />
          </svg>
        </button>

        {#if isMenuOpen}
          <div
            class="absolute z-20 mt-2 w-full rounded-xl border border-slate-200 bg-white p-1 shadow-lg"
            role="presentation"
            tabindex="-1"
            on:click|stopPropagation
            on:mouseleave={() => (hoveredRegion = null)}
          >
            {#each regionOptions as option}
              <button
                type="button"
                class={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-sm transition ${
                  option.disabled
                    ? 'cursor-not-allowed bg-slate-50 text-slate-400'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
                aria-disabled={option.disabled}
                aria-pressed={option.id === selectedRegion}
                on:mouseenter={() => handleOptionFocus(option)}
                on:focus={() => handleOptionFocus(option)}
                on:click={() => selectOption(option)}
              >
                <span class="flex items-center gap-2">
                  {#if option.areaName}
                    <span
                      class="h-3 w-3 rounded-full"
                      style={`background-color: ${regionColorMap[option.areaName]}; opacity: ${
                        option.disabled ? 0.4 : 1
                      };`}
                      aria-hidden="true"
                    ></span>
                  {/if}
                  {option.label}
                </span>

                {#if option.id === selectedRegion}
                  <svg class="h-4 w-4 text-blue-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path
                      fill-rule="evenodd"
                      d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-7.25 9.5a.75.75 0 0 1-1.142.06l-3.25-3.5a.75.75 0 1 1 1.098-1.022l2.628 2.832 6.74-8.833a.75.75 0 0 1 1.033-.089Z"
                      clip-rule="evenodd"
                    />
                  </svg>
                {/if}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <div class="space-y-2">
      <h2 class="text-sm font-semibold uppercase text-slate-500">Stack</h2>
      <div class="flex flex-wrap gap-2 text-xs font-medium text-slate-600">
        <span class="rounded-full bg-slate-100 px-3 py-1">Svelte</span>
        <span class="rounded-full bg-slate-100 px-3 py-1">Tailwind</span>
        <span class="rounded-full bg-slate-100 px-3 py-1">MapLibre</span>
        <span class="rounded-full bg-slate-100 px-3 py-1">Apache ECharts</span>
      </div>
    </div>
  </section>

  <section class="flex-1 min-h-[360px] overflow-hidden">
    <MapView {selectedRegion} {hoveredRegion} />
  </section>
</main>
