<script>
  import { onMount } from 'svelte'
  import MapView from './lib/MapView.svelte'
  import { regionOptions, regionById, regionColorMap } from './lib/regions.js'
  import {
    ARRIVAL_TIME_ISO,
    MAX_TRAVEL_TIME_SECONDS,
    SCARBOROUGH_DESTINATION,
  } from './lib/api/traveltime.js'

  let dropdownRef
  let equityDropdownRef
  let equityDetailDropdownRef
  let isMenuOpen = false
  let isEquityMenuOpen = false
  let isEquityDetailMenuOpen = false
  let selectedRegion = 'all'
  let hoveredRegion = null
  const regionLabelId = 'region-dropdown-label'
  const regionButtonId = 'region-dropdown-button'
  const maxTravelTimeMinutes = Math.round(MAX_TRAVEL_TIME_SECONDS / 60)
  const arrivalDateInstance = new Date(ARRIVAL_TIME_ISO)
  const arrivalDateFormatter = new Intl.DateTimeFormat('en-CA', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/Toronto',
  })
  const arrivalTimeFormatter = new Intl.DateTimeFormat('en-CA', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Toronto',
  })
  const arrivalDateLabel = `${arrivalDateFormatter.format(arrivalDateInstance)} at ${arrivalTimeFormatter.format(arrivalDateInstance)} ET`

  let travelTimeStatus = {
    state: 'inactive',
    message: 'Select a region to view travel times.',
  }
  let travelTimeSummary = null
  let isTravelTimeExpanded = false
  let routeStatus = {
    state: 'idle',
    message: 'Select a stop to view a route to Kennedy Station.',
  }
  let routeSummary = null
  let selectedStopInfo = null
  let isRouteExpanded = false
  let selectedEquityFactor = null
  let selectedEquityDetail = null
  let populationMode = 'proportional'
  let selectedDaInfo = null
  let isCentroidVizEnabled = false

  const equityOptions = [
    { id: 'age', label: 'Age', disabled: false },
    { id: 'family-status', label: 'Family Status', disabled: true },
    { id: 'income', label: 'Income', disabled: false },
    { id: 'employment', label: 'Employment', disabled: true },
    { id: 'disability', label: 'Disability', disabled: true },
    { id: 'commute-method', label: 'Commute Method', disabled: true },
  ]

  const equityDetailByFactor = {
    age: [
      { id: 'age-0-14', label: '0 to 14' },
      { id: 'age-15-64', label: '15 to 64' },
      { id: 'age-65-plus', label: '65+' },
    ],
    income: [
      { id: 'below-50k', label: 'Below $50k' },
      { id: 'above-50k', label: 'Above $50k' },
    ],
  }

  const equityLabelId = 'equity-dropdown-label'
  const equityButtonId = 'equity-dropdown-button'
  const equityDetailLabelId = 'equity-detail-dropdown-label'
  const equityDetailButtonId = 'equity-detail-dropdown-button'

  let isScarboroughActive = false

  const closeMenu = () => {
    isMenuOpen = false
    hoveredRegion = null
  }

  const handleOutsideClick = (event) => {
    if (dropdownRef && !dropdownRef.contains(event.target)) {
      closeMenu()
    }
    if (equityDropdownRef && !equityDropdownRef.contains(event.target)) {
      isEquityMenuOpen = false
    }
    if (equityDetailDropdownRef && !equityDetailDropdownRef.contains(event.target)) {
      isEquityDetailMenuOpen = false
    }
  }

  const handleEscapeKey = (event) => {
    if (event.key === 'Escape') {
      closeMenu()
      isEquityMenuOpen = false
      isEquityDetailMenuOpen = false
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

  const selectEquityFactor = (option) => {
    if (option.disabled) return
    selectedEquityFactor = option.id
    selectedEquityDetail = null
    isEquityMenuOpen = false
  }

  const selectEquityDetail = (option) => {
    selectedEquityDetail = option.id
    isEquityDetailMenuOpen = false
  }

  const handleDaUpdate = (event) => {
    const detail = event?.detail ?? {}
    selectedDaInfo = detail?.da ?? null
  }

  const handleTravelTimeUpdate = (event) => {
    const detail = event?.detail ?? {}
    if (detail.status) {
      travelTimeStatus = detail.status
    }
    if ('summary' in detail) {
      travelTimeSummary = detail.summary ?? null
    }
  }

  const handleRouteUpdate = (event) => {
    const detail = event?.detail ?? {}
    if (detail.status) {
      routeStatus = detail.status
    }
    if ('summary' in detail) {
      routeSummary = detail.summary ?? null
    }
    if ('stop' in detail) {
      selectedStopInfo = detail.stop ?? null
    }
  }

  const formatRouteTime = (isoString) => {
    if (!isoString) return null
    const date = new Date(isoString)
    if (Number.isNaN(date.getTime())) return null
    return arrivalTimeFormatter.format(date)
  }

  const formatDistanceKm = (meters) => {
    if (!Number.isFinite(meters)) return null
    return Math.round((meters / 1000) * 10) / 10
  }

  const toggleTravelTimePanel = () => {
    isTravelTimeExpanded = !isTravelTimeExpanded
  }

  const toggleRoutePanel = () => {
    isRouteExpanded = !isRouteExpanded
  }

  const setPopulationMode = (mode) => {
    populationMode = mode
  }

  $: isScarboroughActive = selectedRegion === 'scarborough'

  $: if (!isScarboroughActive) {
    selectedEquityFactor = null
    selectedEquityDetail = null
    isEquityMenuOpen = false
    isEquityDetailMenuOpen = false
  }

  $: selectedOption = regionById[selectedRegion]

  $: selectedEquityDetailLabel =
    selectedEquityFactor && selectedEquityDetail && equityDetailByFactor[selectedEquityFactor]
      ? equityDetailByFactor[selectedEquityFactor].find((option) => option.id === selectedEquityDetail)?.label ?? null
      : null

  const describeDaTravelTime = (info) => {
    if (!info) return 'Select a centroid'

    if (info.travelTimeStatus === 'unreachable') {
      return '>90 min (Unreachable)'
    }

    if (Number.isFinite(info.travelTimeMinutes)) {
      const minutes = Math.round(info.travelTimeMinutes * 10) / 10
      return `${minutes} min`
    }

    if (travelTimeStatus?.state === 'loading') {
      return 'Pending…'
    }

    return 'Unavailable'
  }
</script>

<main class="flex h-full min-h-0 w-full flex-1 flex-col gap-6 p-6 lg:flex-row lg:gap-10">
  <section class="flex min-h-0 w-full max-w-3xl flex-none flex-col gap-6 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-8 text-left shadow-lg lg:w-[30rem] lg:h-full lg:overflow-y-auto">
    <div class="space-y-2 border-b border-slate-200/70 pb-4">
      <p class="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">YLS Summit 2025</p>
      <h1 class="text-3xl font-bold text-slate-900 sm:text-4xl">
        Equitable Service Analysis Framework
      </h1>
    </div>

    <div class="space-y-3">
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

    {#if isScarboroughActive}
      <div class="flex flex-col gap-4 border-b border-slate-200/70 pb-4">
        <div class="space-y-2" bind:this={equityDropdownRef}>
          <label for={equityButtonId} id={equityLabelId} class="text-sm font-semibold uppercase text-slate-500">Equity Triage Factors</label>
          <div class="relative">
            <button
              type="button"
              id={equityButtonId}
              class="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              aria-haspopup="listbox"
              aria-expanded={isEquityMenuOpen}
              aria-labelledby={`${equityLabelId} ${equityButtonId}`}
              on:click|stopPropagation={() => {
                isEquityMenuOpen = !isEquityMenuOpen
                isEquityDetailMenuOpen = false
              }}
            >
              <span>
                {selectedEquityFactor
                  ? equityOptions.find((option) => option.id === selectedEquityFactor)?.label ?? 'Select a factor'
                  : 'Select a factor'}
              </span>
              <svg class={`h-4 w-4 text-slate-400 transition ${isEquityMenuOpen ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path
                  fill-rule="evenodd"
                  d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 10.715l3.71-3.484a.75.75 0 1 1 1.04 1.08l-4.24 3.985a.75.75 0 0 1-1.04 0l-4.24-3.985a.75.75 0 0 1 .02-1.06Z"
                  clip-rule="evenodd"
                />
              </svg>
            </button>

            {#if isEquityMenuOpen}
              <div
                class="absolute z-20 mt-2 w-full rounded-xl border border-slate-200 bg-white p-1 shadow-lg"
                role="presentation"
                tabindex="-1"
                on:click|stopPropagation
              >
                {#each equityOptions as option}
                  <button
                    type="button"
                    class={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-sm transition ${
                      option.disabled
                        ? 'cursor-not-allowed bg-slate-50 text-slate-400'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                    aria-disabled={option.disabled}
                    aria-pressed={option.id === selectedEquityFactor}
                    on:click={() => selectEquityFactor(option)}
                  >
                    <span>{option.label}</span>

                    {#if option.id === selectedEquityFactor}
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

        {#if selectedEquityFactor && equityDetailByFactor[selectedEquityFactor]}
          <div class="space-y-2" bind:this={equityDetailDropdownRef}>
            <label for={equityDetailButtonId} id={equityDetailLabelId} class="text-sm font-semibold uppercase text-slate-500">
              {equityOptions.find((option) => option.id === selectedEquityFactor)?.label} Details
            </label>
            <div class="relative">
              <button
                type="button"
                id={equityDetailButtonId}
                class="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                aria-haspopup="listbox"
                aria-expanded={isEquityDetailMenuOpen}
                aria-labelledby={`${equityDetailLabelId} ${equityDetailButtonId}`}
                on:click|stopPropagation={() => {
                  isEquityDetailMenuOpen = !isEquityDetailMenuOpen
                  isEquityMenuOpen = false
                }}
              >
                <span>
                  {selectedEquityDetail
                    ? equityDetailByFactor[selectedEquityFactor].find((option) => option.id === selectedEquityDetail)?.label ?? 'Select an option'
                    : 'Select an option'}
                </span>
                <svg class={`h-4 w-4 text-slate-400 transition ${isEquityDetailMenuOpen ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path
                    fill-rule="evenodd"
                    d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 10.715l3.71-3.484a.75.75 0 1 1 1.04 1.08l-4.24 3.985a.75.75 0 0 1-1.04 0l-4.24-3.985a.75.75 0 0 1 .02-1.06Z"
                    clip-rule="evenodd"
                  />
                </svg>
              </button>

              {#if isEquityDetailMenuOpen}
                <div
                  class="absolute z-20 mt-2 w-full rounded-xl border border-slate-200 bg-white p-1 shadow-lg"
                  role="presentation"
                  tabindex="-1"
                  on:click|stopPropagation
                >
                  {#each equityDetailByFactor[selectedEquityFactor] as option}
                    <button
                      type="button"
                      class={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-sm transition ${
                        option.id === selectedEquityDetail ? 'bg-blue-50 text-blue-600' : 'text-slate-700 hover:bg-slate-100'
                      }`}
                      aria-pressed={option.id === selectedEquityDetail}
                      on:click={() => selectEquityDetail(option)}
                    >
                      <span>{option.label}</span>

                      {#if option.id === selectedEquityDetail}
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
        {/if}
      </div>
    {/if}

    {#if selectedEquityFactor && selectedEquityDetail}
      <div class="space-y-3 border-t border-slate-200/70 pt-4">
        <h2 class="text-sm font-semibold uppercase text-slate-500">Dissemination Area Information</h2>
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Centroid Visualization</span>
          <div
            class="inline-flex items-center rounded-full border border-slate-200 bg-white p-1 text-xs font-semibold text-slate-500 shadow-sm"
            role="group"
            aria-label="Centroid visualization"
          >
            <button
              type="button"
              class={`rounded-full px-3 py-1 transition ${
                isCentroidVizEnabled
                  ? 'bg-blue-500 text-white shadow'
                  : 'text-slate-400 hover:text-slate-600'
              }`}
              on:click={() => (isCentroidVizEnabled = true)}
              aria-pressed={isCentroidVizEnabled}
            >
              On
            </button>
            <button
              type="button"
              class={`rounded-full px-3 py-1 transition ${
                !isCentroidVizEnabled
                  ? 'bg-blue-500 text-white shadow'
                  : 'text-slate-400 hover:text-slate-600'
              }`}
              on:click={() => (isCentroidVizEnabled = false)}
              aria-pressed={!isCentroidVizEnabled}
            >
              Off
            </button>
          </div>
        </div>

        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Population Mode</span>
          <div
            class="inline-flex items-center rounded-full border border-slate-200 bg-white p-1 text-xs font-semibold text-slate-500 shadow-sm"
            role="group"
            aria-label="Population mode"
          >
            <button
              type="button"
              class={`rounded-full px-3 py-1 transition ${
                populationMode === 'proportional'
                  ? 'bg-blue-500 text-white shadow'
                  : 'text-slate-400 hover:text-slate-600'
              }`}
              on:click={() => setPopulationMode('proportional')}
              aria-pressed={populationMode === 'proportional'}
            >
              Proportional
            </button>
            <button
              type="button"
              class={`rounded-full px-3 py-1 transition ${
                populationMode === 'total'
                  ? 'bg-blue-500 text-white shadow'
                  : 'text-slate-400 hover:text-slate-600'
              }`}
              on:click={() => setPopulationMode('total')}
              aria-pressed={populationMode === 'total'}
            >
              Total
            </button>
          </div>
        </div>

        {#if selectedDaInfo}
          <div class="rounded-lg border border-slate-200 bg-white p-4 text-xs text-slate-600 shadow-sm">
            <div class="flex items-center justify-between text-[11px] uppercase tracking-[0.25em] text-slate-400">
              <span>Selected Area</span>
              <span class="tracking-normal text-slate-600">{selectedDaInfo.label ?? selectedDaInfo.id}</span>
            </div>

            <dl class="mt-3 space-y-2">
              <div class="flex items-center justify-between">
                <dt class="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Travel Time</dt>
                <dd class="text-sm font-medium text-slate-800">{describeDaTravelTime(selectedDaInfo)}</dd>
              </div>

              {#if selectedDaInfo?.seniorsProportion !== undefined && selectedDaInfo?.seniorsProportion !== null}
                <div class="flex items-center justify-between">
                  <dt class="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Seniors Proportion</dt>
                  <dd class="text-sm font-medium text-slate-800">{Math.round(selectedDaInfo.seniorsProportion * 100)}%</dd>
                </div>
              {/if}

              {#if selectedEquityFactor === 'age' && selectedEquityDetailLabel}
                <div class="flex items-center justify-between">
                  <dt class="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Age {selectedEquityDetailLabel} Travel Time</dt>
                  <dd class="text-sm font-medium text-slate-800">{describeDaTravelTime(selectedDaInfo)}</dd>
                </div>
              {:else if selectedEquityFactor === 'income' && selectedEquityDetailLabel}
                <div class="flex items-center justify-between">
                  <dt class="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Income {selectedEquityDetailLabel} Travel Time</dt>
                  <dd class="text-sm font-medium text-slate-800">{describeDaTravelTime(selectedDaInfo)}</dd>
                </div>
              {/if}
            </dl>
          </div>
        {:else}
          <p class="text-xs text-slate-500">Click a centroid to view travel time details.</p>
        {/if}
      </div>
    {/if}

    <div class="space-y-2 border-t border-slate-200/70 pt-4">
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-semibold uppercase text-slate-500">Route to Kennedy Station</h2>
        <button
          type="button"
          class="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 shadow-sm transition hover:bg-slate-50"
          on:click={toggleRoutePanel}
          aria-expanded={isRouteExpanded}
        >
          {isRouteExpanded ? 'Hide' : 'Show'}
        </button>
      </div>

      {#if isRouteExpanded}
        <div class="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm">
          <p>{routeStatus.message}</p>

          {#if selectedStopInfo}
            <p class="mt-3 text-xs text-slate-500">
              Stop: <span class="font-medium text-slate-700">{selectedStopInfo.name}</span>
            </p>
          {/if}

          {#if routeSummary}
            <div class="mt-3 space-y-1 text-xs text-slate-500">
              {#if routeSummary.travelTimeSeconds}
                <p>Travel time: {Math.round(routeSummary.travelTimeSeconds / 60)} min</p>
              {/if}
              {#if routeSummary.distanceMeters}
                <p>Distance: {formatDistanceKm(routeSummary.distanceMeters)} km</p>
              {/if}
              {#if routeSummary.departureTime}
                <p>Depart: {formatRouteTime(routeSummary.departureTime)} ET</p>
              {/if}
              {#if routeSummary.arrivalTime}
                <p>Arrive: {formatRouteTime(routeSummary.arrivalTime)} ET</p>
              {/if}
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <div class="space-y-2">
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-semibold uppercase text-slate-500">TravelTime Status</h2>
        <button
          type="button"
          class="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 shadow-sm transition hover:bg-slate-50"
          on:click={toggleTravelTimePanel}
          aria-expanded={isTravelTimeExpanded}
        >
          {isTravelTimeExpanded ? 'Hide' : 'Show'}
        </button>
      </div>
      {#if isTravelTimeExpanded}
        <div class="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          <p>{travelTimeStatus.message}</p>
          <p class="mt-3 text-xs text-slate-500">
            Arrival: {arrivalDateLabel} • Max travel time {maxTravelTimeMinutes} min • Mode public_transport
          </p>
          <p class="mt-1 text-xs text-slate-500">
            Destination: {SCARBOROUGH_DESTINATION.label}
          </p>
          {#if travelTimeSummary && selectedRegion === 'scarborough'}
            <div class="mt-3 flex flex-wrap gap-3 text-xs text-slate-600">
              <span class="rounded-full bg-white px-3 py-1 shadow-sm">Reachable areas {travelTimeSummary.reachable}/{travelTimeSummary.totalStops}</span>
              <span class="rounded-full bg-white px-3 py-1 shadow-sm">Unreachable areas {travelTimeSummary.unreachable.length}</span>
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <div class="space-y-3">
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
    <MapView
      {selectedRegion}
      {hoveredRegion}
      {isCentroidVizEnabled}
      on:traveltimeupdate={handleTravelTimeUpdate}
      on:routeupdate={handleRouteUpdate}
      on:daupdate={handleDaUpdate}
    />
  </section>
</main>
