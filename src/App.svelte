<script>
  import MapView from './lib/MapView.svelte'
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
      <label for="region-select" class="text-sm font-semibold uppercase text-slate-500">Region</label>
      <select
        id="region-select"
        class="w-full rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
      >
        <option value="all">All</option>
        <option value="scarborough">Scarborough</option>
      </select>
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
    <MapView />
  </section>
</main>
