<main class="mx-auto flex min-h-screen max-w-5xl flex-col gap-16 py-12">
  <section class="space-y-6 text-center">
    <p class="text-sm uppercase tracking-[0.3em] text-slate-400">YLS Summit 2025</p>
    <h1 class="text-4xl font-bold text-white sm:text-5xl">
      Equitable Bus Stop Allocation Case Study
    </h1>
    <p class="mx-auto max-w-3xl text-lg text-slate-300">
      A focused prototype exploring how data-informed tooling can help transit agencies
      make equitable stop allocation decisions for Scarborough, Toronto.
    </p>
    <div class="flex flex-wrap justify-center gap-3 text-sm">
      <span class="rounded-full bg-slate-800 px-4 py-2 text-slate-200">Tailwind CSS</span>
      <span class="rounded-full bg-slate-800 px-4 py-2 text-slate-200">Svelte</span>
      <span class="rounded-full bg-slate-800 px-4 py-2 text-slate-200">MapLibre</span>
      <span class="rounded-full bg-slate-800 px-4 py-2 text-slate-200">Apache ECharts</span>
    </div>
  </section>

  <section class="grid gap-8 lg:grid-cols-2">
    <div class="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
      <h2 class="text-xl font-semibold text-white">What this demo illustrates</h2>
      <ul class="space-y-3 text-left text-slate-300">
        <li>
          <strong class="font-semibold text-white">Data integration:</strong> Combine
          demographic, ridership, and GTFS layers to spotlight equity gaps.
        </li>
        <li>
          <strong class="font-semibold text-white">Equitable heuristics:</strong> Surface
          transparent metrics that guide stop spacing and investments.
        </li>
        <li>
          <strong class="font-semibold text-white">Interactive storytelling:</strong>
          Communicate insights quickly for a 6-minute pitch format.
        </li>
      </ul>
    </div>

    <div class="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 text-left">
      <h2 class="text-xl font-semibold text-white">Next technical steps</h2>
      <ol class="mt-4 space-y-3 text-slate-300">
        <li>Wire MapLibre to display Scarborough stops and demographic layers.</li>
        <li>Use Apache ECharts for equity score visualizations.</li>
        <li>Iterate on Tailwind-powered UI states to guide the case study narrative.</li>
      </ol>
    </div>
  </section>
</main>

<style>
  main {
    height: 100%;
  }
</style>
