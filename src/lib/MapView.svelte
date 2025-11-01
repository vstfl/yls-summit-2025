<script>
  import { onMount } from 'svelte'
  import maplibregl from 'maplibre-gl'
  import Papa from 'papaparse'
  import stopsUrl from '../../datasets/static_gtfs/stops.txt?url'
  import torontoBoundaryUrl from '../../datasets/toronto_shape/toronto_boundary.geojson?url'
  import { areaNameByRegionId, regionColorMap, torontoDefaultColor } from './regions.js'
  import KDBush from 'kdbush'

  export let selectedRegion = 'all'
  export let hoveredRegion = null

  const municipalitiesGeojsonUrl = new URL(
    '../../datasets/scarborough_shape/Former Municipality Boundaries Data - 4326.geojson',
    import.meta.url,
  ).href

  const center = [-79.35, 43.7]
  const zoom = 10
  const defaultPitch = 0
  const defaultBearing = 0
  const styleUrl =
    'https://api.maptiler.com/maps/dataviz/style.json?key=vSAPZeUq4M8frH3zY1zN'

  const REGION_SOURCE_ID = 'toronto-regions'
  const BOUNDARY_SOURCE_ID = 'toronto-boundary'
  const STOPS_SOURCE_ID = 'toronto-stops'
  const STOPS_LAYER_ID = 'toronto-stops-circle'

  let map
  let mapContainer
  let mapLoaded = false
  let regionMetadata = {}
  let regionColorExpression = []
  let lastAppliedHover = null
  let lastAppliedSelection = null
  let lastAppliedStopsArea = null
  let torontoBounds = null
  let regionGeometries = {}
  let fullStopsGeoJSON = null
  let stopsIndex = null
  let regionStopsCache = {}

  const viewportPadding = 56

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

  const loadRegions = async () => {
    const response = await fetch(municipalitiesGeojsonUrl)
    return response.json()
  }

  const buildRegionColorExpression = () => {
    const expression = ['match', ['get', 'AREA_NAME']]

    for (const [areaName, color] of Object.entries(regionColorMap)) {
      expression.push(areaName, color)
    }

    expression.push(torontoDefaultColor)
    return expression
  }

  const computeGeometryBounds = (geometry) => {
    if (!geometry?.coordinates) return null

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    const visit = (coords) => {
      if (!Array.isArray(coords)) return

      if (coords.length === 0) return

      const first = coords[0]

      if (typeof first === 'number') {
        const [x, y] = coords

        if (!Number.isFinite(x) || !Number.isFinite(y)) return

        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
        return
      }

      for (const coordinate of coords) {
        visit(coordinate)
      }
    }

    visit(geometry.coordinates)

    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
      return null
    }

    return [
      [minX, minY],
      [maxX, maxY],
    ]
  }

  const calculateRegionMetadata = (geojson) => {
    const metadata = {}
    regionGeometries = {}

    if (!geojson?.features) return metadata

    for (const feature of geojson.features) {
      const areaName = feature?.properties?.AREA_NAME
      if (!areaName) continue

      const bounds = computeGeometryBounds(feature.geometry)
      if (!bounds) continue

      regionGeometries[areaName] = feature.geometry

      const [[minX, minY], [maxX, maxY]] = bounds
      metadata[areaName] = {
        bbox: bounds,
        center: [(minX + maxX) / 2, (minY + maxY) / 2],
      }
    }

    return metadata
  }

  const buildStopsIndex = (geojson) => {
    fullStopsGeoJSON = geojson
    lastAppliedStopsArea = null
    regionStopsCache = {}

    const features = geojson?.features ?? []
    if (!features.length) {
      stopsIndex = null
      return
    }

    const index = new KDBush(features.length)

    for (let i = 0; i < features.length; i += 1) {
      const coords = features[i]?.geometry?.coordinates
      index.add(coords[0], coords[1])
    }

    stopsIndex = index.finish()
  }

  const pointOnSegment = (x, y, x1, y1, x2, y2) => {
    const squaredLength = (x2 - x1) ** 2 + (y2 - y1) ** 2
    if (squaredLength === 0) {
      return x === x1 && y === y1
    }

    const cross = (x - x1) * (y2 - y1) - (y - y1) * (x2 - x1)
    if (Math.abs(cross) > 1e-12) return false

    const dot = (x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)
    if (dot < 0) return false

    if (dot > squaredLength) return false

    return true
  }

  const pointInRing = (ring, x, y) => {
    if (!Array.isArray(ring) || ring.length < 2) return false
    let inside = false

    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const xi = ring[i][0]
      const yi = ring[i][1]
      const xj = ring[j][0]
      const yj = ring[j][1]

      if (pointOnSegment(x, y, xi, yi, xj, yj)) return true

      if (yi === yj) continue

      const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
      if (intersects) inside = !inside
    }

    return inside
  }

  const pointInPolygon = (rings, point) => {
    if (!Array.isArray(rings) || !rings.length) return false

    const [x, y] = point

    if (!pointInRing(rings[0], x, y)) return false

    for (let i = 1; i < rings.length; i += 1) {
      if (pointInRing(rings[i], x, y)) return false
    }

    return true
  }

  const pointInGeometry = (geometry, point) => {
    if (!geometry) return false

    if (geometry.type === 'Polygon') {
      return pointInPolygon(geometry.coordinates, point)
    }

    if (geometry.type === 'MultiPolygon') {
      for (const polygon of geometry.coordinates ?? []) {
        if (pointInPolygon(polygon, point)) return true
      }
      return false
    }

    return false
  }

  const buildRegionStopsCollection = (areaName) => {
    if (!areaName || !fullStopsGeoJSON) {
      return fullStopsGeoJSON
    }

    if (regionStopsCache[areaName]) {
      return regionStopsCache[areaName]
    }

    const metadata = regionMetadata[areaName]
    const geometry = regionGeometries[areaName]

    if (!metadata?.bbox || !geometry) {
      regionStopsCache[areaName] = fullStopsGeoJSON
      return fullStopsGeoJSON
    }

    const [[minX, minY], [maxX, maxY]] = metadata.bbox
    const candidateIndexes = stopsIndex ? stopsIndex.range(minX, minY, maxX, maxY) : []

    const candidates = stopsIndex
      ? candidateIndexes
          .map((index) => fullStopsGeoJSON.features[index])
          .filter(Boolean)
      : fullStopsGeoJSON.features

    const filteredFeatures = []

    for (const feature of candidates) {
      const coords = feature?.geometry?.coordinates
      if (!coords) continue
      if (pointInGeometry(geometry, coords)) {
        filteredFeatures.push(feature)
      }
    }

    const collection = {
      type: 'FeatureCollection',
      features: filteredFeatures,
    }

    regionStopsCache[areaName] = collection
    return collection
  }

  const updateStopsDataset = (areaName) => {
    const stopsSource = map?.getSource(STOPS_SOURCE_ID)
    if (!stopsSource || !fullStopsGeoJSON) return

    const normalizedArea = areaName ?? null
    if (normalizedArea === lastAppliedStopsArea) return

    lastAppliedStopsArea = normalizedArea

    const collection = normalizedArea ? buildRegionStopsCollection(normalizedArea) : fullStopsGeoJSON

    stopsSource.setData(collection)
  }

  const resetCamera = (animate = true) => {
    if (!map) return

    if (torontoBounds) {
      const fitOptions = {
        padding: viewportPadding,
        duration: animate ? 700 : 0,
        pitch: defaultPitch,
        bearing: defaultBearing,
      }

      map.fitBounds(torontoBounds, fitOptions)
      return
    }

    const cameraState = {
      center,
      zoom,
      pitch: defaultPitch,
      bearing: defaultBearing,
    }

    if (animate) {
      map.easeTo({ ...cameraState, duration: 700 })
    } else {
      map.jumpTo(cameraState)
    }
  }

  const updateHoverState = (currentHover) => {
    if (!map?.getLayer('toronto-regions-fill')) return
    if (currentHover === lastAppliedHover) return

    lastAppliedHover = currentHover

    const areaName = areaNameByRegionId[currentHover]
    const shouldShow = Boolean(currentHover && currentHover !== 'all' && areaName)
    const visibility = shouldShow ? 'visible' : 'none'

    map.setLayoutProperty('toronto-regions-fill', 'visibility', visibility)
    map.setLayoutProperty('toronto-regions-outline', 'visibility', visibility)

    if (shouldShow && areaName) {
      const opacityExpression = ['case', ['==', ['get', 'AREA_NAME'], areaName], 0.65, 0.4]
      map.setPaintProperty('toronto-regions-fill', 'fill-opacity', opacityExpression)
    } else {
      map.setPaintProperty('toronto-regions-fill', 'fill-opacity', 0.45)
    }
  }

  const updateSelectedRegionState = (currentSelection, { animate = true } = {}) => {
    if (!map?.getLayer('toronto-region-highlight-fill')) return

    const areaName = areaNameByRegionId[currentSelection]

    if (currentSelection === lastAppliedSelection && mapLoaded) {
      updateStopsDataset(areaName)
      return
    }

    lastAppliedSelection = currentSelection

    if (currentSelection === 'all') {
      map.setLayoutProperty('toronto-region-highlight-fill', 'visibility', 'none')
      map.setLayoutProperty('toronto-region-highlight-outline', 'visibility', 'none')
      map.setPaintProperty('toronto-boundary-fill', 'fill-opacity', 0.18)
      updateStopsDataset(null)
      resetCamera(animate)
      return
    }

    if (!areaName) {
      updateStopsDataset(null)
      return
    }

    map.setFilter('toronto-region-highlight-fill', ['==', ['get', 'AREA_NAME'], areaName])
    map.setFilter('toronto-region-highlight-outline', ['==', ['get', 'AREA_NAME'], areaName])
    map.setLayoutProperty('toronto-region-highlight-fill', 'visibility', 'visible')
    map.setLayoutProperty('toronto-region-highlight-outline', 'visibility', 'visible')
    map.setPaintProperty('toronto-boundary-fill', 'fill-opacity', 0.08)
    updateStopsDataset(areaName)

    const metadata = regionMetadata[areaName]

    if (metadata?.bbox) {
      const fitOptions = {
        padding: viewportPadding,
        duration: animate ? 700 : 0,
        pitch: defaultPitch,
        bearing: defaultBearing,
      }
      map.fitBounds(metadata.bbox, fitOptions)
    }
  }

  onMount(() => {
    map = new maplibregl.Map({
      container: mapContainer,
      style: styleUrl,
      center,
      zoom,
      pitch: defaultPitch,
      bearing: defaultBearing,
    })

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')

    const handleResize = () => map?.resize()
    window.addEventListener('resize', handleResize)

    map.on('load', async () => {
      try {
        const [boundaryGeoJSON, stopsGeoJSON, regionsGeoJSON] = await Promise.all([
          loadBoundary(),
          loadStops(),
          loadRegions(),
        ])

        regionColorExpression = buildRegionColorExpression()

        const boundaryFeatures = boundaryGeoJSON?.features ?? []
        const boundaryGeometry = boundaryFeatures.length > 0 ? boundaryFeatures[0].geometry : boundaryGeoJSON?.geometry
        const computedBounds = boundaryGeometry ? computeGeometryBounds(boundaryGeometry) : null
        if (computedBounds) {
          torontoBounds = computedBounds
        }

        map.addSource(BOUNDARY_SOURCE_ID, {
          type: 'geojson',
          data: boundaryGeoJSON,
        })

        map.addLayer({
          id: 'toronto-boundary-fill',
          type: 'fill',
          source: BOUNDARY_SOURCE_ID,
          paint: {
            'fill-color': torontoDefaultColor,
            'fill-opacity': 0.18,
          },
        })

        map.addLayer({
          id: 'toronto-boundary-outline',
          type: 'line',
          source: BOUNDARY_SOURCE_ID,
          paint: {
            'line-color': '#64748b',
            'line-width': 1,
            'line-opacity': 0.6,
          },
        })

        map.addSource(REGION_SOURCE_ID, {
          type: 'geojson',
          data: regionsGeoJSON,
          promoteId: '_id',
        })

        map.addLayer({
          id: 'toronto-regions-fill',
          type: 'fill',
          source: REGION_SOURCE_ID,
          layout: {
            visibility: 'none',
          },
          paint: {
            'fill-color': regionColorExpression,
            'fill-opacity': 0.45,
          },
        })

        map.addLayer({
          id: 'toronto-regions-outline',
          type: 'line',
          source: REGION_SOURCE_ID,
          layout: {
            visibility: 'none',
          },
          paint: {
            'line-color': '#475569',
            'line-width': 1,
            'line-opacity': 0.75,
          },
        })

        map.addLayer({
          id: 'toronto-region-highlight-fill',
          type: 'fill',
          source: REGION_SOURCE_ID,
          layout: {
            visibility: 'none',
          },
          paint: {
            'fill-color': regionColorExpression,
            'fill-opacity': 0.55,
          },
        })

        map.addLayer({
          id: 'toronto-region-highlight-outline',
          type: 'line',
          source: REGION_SOURCE_ID,
          layout: {
            visibility: 'none',
          },
          paint: {
            'line-color': regionColorExpression,
            'line-width': 2,
            'line-opacity': 0.9,
          },
        })

        map.addSource(STOPS_SOURCE_ID, {
          type: 'geojson',
          data: stopsGeoJSON,
        })

        buildStopsIndex(stopsGeoJSON)

        map.addLayer({
          id: STOPS_LAYER_ID,
          type: 'circle',
          source: STOPS_SOURCE_ID,
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2, 14, 6, 16, 10],
            'circle-color': '#2563eb',
            'circle-opacity': 0.8,
            'circle-stroke-width': 1,
            'circle-stroke-color': '#ffffff',
          },
        })

        regionMetadata = calculateRegionMetadata(regionsGeoJSON)
        mapLoaded = true

        if (torontoBounds) {
          map.fitBounds(torontoBounds, {
            padding: viewportPadding,
            duration: 0,
            pitch: defaultPitch,
            bearing: defaultBearing,
          })
        }

        updateSelectedRegionState(selectedRegion, { animate: false })
        updateHoverState(hoveredRegion)
      } catch (error) {
        console.error('Failed to load map data', error)
      }
    })

    return () => {
      window.removeEventListener('resize', handleResize)
      map?.remove()
    }
  })

  $: if (mapLoaded) {
    updateHoverState(hoveredRegion)
  }

  $: if (mapLoaded) {
    updateSelectedRegionState(selectedRegion)
  }
</script>

<div class="relative h-full w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg">
  <div bind:this={mapContainer} class="absolute inset-0" role="presentation"></div>
</div>
