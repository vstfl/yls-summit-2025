<script>
  import { onMount } from 'svelte'
  import maplibregl from 'maplibre-gl'
  import Papa from 'papaparse'
  import stopsUrl from '../../datasets/static_gtfs/stops.txt?url'
  import torontoBoundaryUrl from '../../datasets/toronto_shape/toronto_boundary.geojson?url'

  const center = [-79.25, 43.76]
  const zoom = 11
  const styleUrl =
    'https://api.maptiler.com/maps/dataviz/style.json?key=vSAPZeUq4M8frH3zY1zN'

  let map
  let mapContainer

  const loadStops = async () => {
    const response = await fetch(stopsUrl)
    const csv = await response.text()
    const { data } = Papa.parse(csv, { header: true, skipEmptyLines: true })

    const features = data
      .map((row) => {
        const lat = Number.parseFloat(row.stop_lat)
        const lon = Number.parseFloat(row.stop_lon)

        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null

        return {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [lon, lat],
          },
          properties: {
            id: row.stop_id,
            name: row.stop_name,
          },
        }
      })
      .filter(Boolean)

    return {
      type: 'FeatureCollection',
      features,
    }
  }

  const loadBoundary = async () => {
    const response = await fetch(torontoBoundaryUrl)
    return response.json()
  }

  onMount(() => {
    map = new maplibregl.Map({
      container: mapContainer,
      style: styleUrl,
      center,
      zoom,
      pitch: 35,
      bearing: -10,
    })

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')

    const handleResize = () => map?.resize()
    window.addEventListener('resize', handleResize)

    map.on('load', async () => {
      try {
        const [boundaryGeoJSON, stopsGeoJSON] = await Promise.all([
          loadBoundary(),
          loadStops(),
        ])

        map.addSource('toronto-boundary', {
          type: 'geojson',
          data: boundaryGeoJSON,
        })

        map.addLayer({
          id: 'toronto-boundary-fill',
          type: 'fill',
          source: 'toronto-boundary',
          paint: {
            'fill-color': '#94a3b8',
            'fill-opacity': 0.18,
          },
        })

        map.addLayer({
          id: 'toronto-boundary-outline',
          type: 'line',
          source: 'toronto-boundary',
          paint: {
            'line-color': '#64748b',
            'line-width': 1,
            'line-opacity': 0.6,
          },
        })

        map.addSource('toronto-stops', {
          type: 'geojson',
          data: stopsGeoJSON,
        })

        map.addLayer({
          id: 'toronto-stops-circle',
          type: 'circle',
          source: 'toronto-stops',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2, 14, 6, 16, 10],
            'circle-color': '#2563eb',
            'circle-opacity': 0.8,
            'circle-stroke-width': 1,
            'circle-stroke-color': '#ffffff',
          },
        })
      } catch (error) {
        console.error('Failed to load map data', error)
      }
    })

    return () => {
      window.removeEventListener('resize', handleResize)
      map?.remove()
    }
  })
</script>

<div class="relative h-full w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg">
  <div bind:this={mapContainer} class="absolute inset-0" role="presentation"></div>
</div>
