<script>
  import { createEventDispatcher, onMount } from 'svelte'
  import maplibregl from 'maplibre-gl'
  import Papa from 'papaparse'
  import stopsUrl from '../../datasets/static_gtfs/stops.txt?url'
  import torontoBoundaryUrl from '../../datasets/toronto_shape/toronto_boundary.geojson?url'
  import scarboroughDaUrl from '../../datasets/scarborough_da/Income_Proport_FeaturesToJSO.geojson?url'
  import { areaNameByRegionId, regionColorMap, torontoDefaultColor } from './regions.js'
  import KDBush from 'kdbush'
  import {
    fetchTravelTimesForStops,
    fetchRouteForStop,
    SCARBOROUGH_DESTINATION,
    ARRIVAL_TIME_ISO,
    MAX_TRAVEL_TIME_SECONDS,
  } from './api/traveltime.js'

  export let selectedRegion = 'all'
  export let hoveredRegion = null
  export let isCentroidVizEnabled = false

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
  const DESTINATION_SOURCE_ID = 'scarborough-destination'
  const DESTINATION_LAYER_ID = 'scarborough-destination-circle'
  const DESTINATION_LABEL_LAYER_ID = 'scarborough-destination-label'
  const ROUTE_SOURCE_ID = 'scarborough-route'
  const ROUTE_LAYER_ID = 'scarborough-route-line'
  const ROUTE_OUTLINE_LAYER_ID = 'scarborough-route-outline'
  const SELECTED_STOP_SOURCE_ID = 'scarborough-selected-stop'
  const SELECTED_STOP_LAYER_ID = 'scarborough-selected-stop-circle'
  const DA_SOURCE_ID = 'scarborough-da'
  const DA_FILL_LAYER_ID = 'scarborough-da-fill'
  const DA_OUTLINE_LAYER_ID = 'scarborough-da-outline'
  const DA_CENTROID_SOURCE_ID = 'scarborough-da-centroids'
  const DA_CENTROID_LAYER_ID = 'scarborough-da-centroids-circle'
  const SCARBOROUGH_AREA_NAME = 'SCARBOROUGH'
  const TRAVEL_TIME_MINUTES_PROP = 'scarborough_travel_time_minutes'
  const SENIORS_METRIC_PROP = 'seniors_metric'
  const TRAVEL_TIME_STATUS_PROP = 'scarborough_travel_time_status'
  const TRAVEL_TIME_BUCKET_PROP = 'scarborough_travel_time_bucket'
  const TRAVEL_TIME_SECONDS_PROP = 'scarborough_travel_time_seconds'
  const travelTimeRamp = [
    { minutes: 0, color: '#16a34a', label: '0-15 min' },
    { minutes: 15, color: '#22c55e', label: '15-30 min' },
    { minutes: 30, color: '#84cc16', label: '30-45 min' },
    { minutes: 45, color: '#facc15', label: '45-60 min' },
    { minutes: 60, color: '#f97316', label: '60-75 min' },
    { minutes: 75, color: '#ef4444', label: '75-90 min' },
  ]
  const travelTimeLegendUnreachable = { color: '#334155', label: 'Unreachable (>90 min)' }
  const travelTimeCacheKey = `traveltime:scarborough-da:${ARRIVAL_TIME_ISO}`
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
  const emptyFeatureCollection = {
    type: 'FeatureCollection',
    features: [],
  }
  const routeModeColors = {
    walking: '#0ea5e9',
    public_transport: '#f97316',
    transit: '#f97316',
    driving: '#facc15',
    bicycle: '#22c55e',
    change: '#6b21a8',
    transfer: '#6b21a8',
    waiting: '#94a3b8',
    unknown: '#1f2937',
  }

  const dispatch = createEventDispatcher()

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
  let travelTimeStatus = {
    state: 'inactive',
    message: 'Select the Scarborough region to view travel times.',
  }
  let travelTimeSummary = null
  let travelTimesActive = false
  let travelTimesRequested = false
  let showLegend = false
  let selectedStop = null
  let routeStatus = {
    state: 'idle',
    message: 'Select a stop to view a route to Kennedy Station.',
  }
  let routeSummary = null
  let routeInFlightStopId = null
  let hoveredStopId = null
  let daGeoJSON = null
  let daCentroidCollection = null
  let selectedDa = null
  let selectedDaFeatureId = null
  let seniorsMetricMin = null
  let seniorsMetricMax = null

  const viewportPadding = 56

  let handleDaClickOnMap
  let handleDaMouseEnter
  let handleDaMouseLeave

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
          id: row.stop_id,
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

  const loadScarboroughDa = async () => {
    const response = await fetch(scarboroughDaUrl)
    return response.json()
  }

  const getDaIdentifier = (properties) => {
    if (!properties) return null
    const candidates = [
      properties['Scarborough_Clip.DAUID'],
      properties.DAUID,
      properties.daId,
      properties.da_id,
      properties.DAUID_L,
      properties.dauid,
    ]

    for (const value of candidates) {
      if (value !== undefined && value !== null && `${value}`.length) {
        return `${value}`
      }
    }

    return null
  }

  const buildRegionColorExpression = () => {
    const expression = ['match', ['get', 'AREA_NAME']]

    for (const [areaName, color] of Object.entries(regionColorMap)) {
      expression.push(areaName, color)
    }

    expression.push(torontoDefaultColor)
    return expression
  }

  const buildSeniorsMetricColorExpression = (fallbackColor = '#2563eb') => {
    if (seniorsMetricMin === null || seniorsMetricMax === null || seniorsMetricMin === seniorsMetricMax) {
      return fallbackColor
    }

    const interpolate = [
      'interpolate',
      ['linear'],
      ['coalesce', ['get', SENIORS_METRIC_PROP], 0],
      seniorsMetricMin,
      '#16a34a', // green
      (seniorsMetricMin + seniorsMetricMax) / 2,
      '#facc15', // yellow
      seniorsMetricMax,
      '#ef4444', // red
    ]

    return [
      'case',
      ['==', ['get', TRAVEL_TIME_STATUS_PROP], 'unreachable'],
      travelTimeLegendUnreachable.color,
      ['has', SENIORS_METRIC_PROP],
      interpolate,
      fallbackColor,
    ]
  }

  const buildTravelTimeColorExpression = (fallbackColor = '#2563eb') => {
    const interpolate = ['interpolate', ['linear'], ['coalesce', ['get', TRAVEL_TIME_MINUTES_PROP], 0]]

    for (const stop of travelTimeRamp) {
      interpolate.push(stop.minutes, stop.color)
    }

    return [
      'case',
      ['==', ['get', TRAVEL_TIME_STATUS_PROP], 'unreachable'],
      travelTimeLegendUnreachable.color,
      ['has', TRAVEL_TIME_MINUTES_PROP],
      interpolate,
      fallbackColor,
    ]
  }

  const buildRadiusExpression = (useTravelTimes) => {
    const isHovered = ['boolean', ['feature-state', 'hovered'], false]

    if (useTravelTimes) {
      return [
        'interpolate',
        ['linear'],
        ['zoom'],
        10,
        ['case', isHovered, 4.39, 3.38],
        14,
        ['case', isHovered, 7.8, 6],
        16,
        ['case', isHovered, 11.7, 9],
      ]
    }

    return [
      'interpolate',
      ['linear'],
      ['zoom'],
      10,
      ['case', isHovered, 2.1, 1.5],
      14,
      ['case', isHovered, 6.3, 4.5],
      16,
      ['case', isHovered, 8.4, 7.5],
    ]
  }

  const buildRouteColorExpression = () => {
    const expression = ['match', ['coalesce', ['get', 'mode'], ['get', 'type']]]

    for (const [mode, color] of Object.entries(routeModeColors)) {
      expression.push(mode, color)
    }

    expression.push('#ef4444')
    return expression
  }

  const destinationFeature = {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [
        SCARBOROUGH_DESTINATION.coords.lng,
        SCARBOROUGH_DESTINATION.coords.lat,
      ],
    },
    properties: {
      id: SCARBOROUGH_DESTINATION.id,
      name: SCARBOROUGH_DESTINATION.label,
    },
  }

  const destinationFeatureCollection = {
    type: 'FeatureCollection',
    features: [destinationFeature],
  }

  const updateStopsVisualization = () => {
    if (!mapLoaded || !map?.getLayer(STOPS_LAYER_ID)) return

    map.setPaintProperty(STOPS_LAYER_ID, 'circle-color', '#2563eb')
    map.setPaintProperty(STOPS_LAYER_ID, 'circle-radius', buildRadiusExpression(false))
    map.setPaintProperty(STOPS_LAYER_ID, 'circle-opacity', 0.8)
    map.setPaintProperty(STOPS_LAYER_ID, 'circle-stroke-width', 1)
    map.setPaintProperty(STOPS_LAYER_ID, 'circle-stroke-color', '#ffffff')
  }

  const updateDaCentroidVisualization = () => {
    if (!mapLoaded || !map?.getLayer(DA_CENTROID_LAYER_ID)) return

    const hasTravelTimes = travelTimesActive && Boolean(travelTimeSummary)
    const useSeniorsMetric = seniorsMetricMin !== null && seniorsMetricMax !== null

    const color = useSeniorsMetric
      ? buildSeniorsMetricColorExpression('#1d4ed8')
      : hasTravelTimes
      ? buildTravelTimeColorExpression('#1d4ed8')
      : '#1d4ed8'

    const opacity = hasTravelTimes
      ? ['case', ['has', TRAVEL_TIME_MINUTES_PROP], 0.9, 0.45]
      : 0.45

    map.setPaintProperty(DA_CENTROID_LAYER_ID, 'circle-color', color)
    map.setPaintProperty(DA_CENTROID_LAYER_ID, 'circle-opacity', opacity)
  }

  const emitDaUpdate = () => {
    dispatch('daupdate', {
      da: selectedDa,
    })
  }

  const setDaFeatureState = (featureId, selected) => {
    if (!map?.getSource(DA_CENTROID_SOURCE_ID) || !featureId) return
    try {
      map.setFeatureState({ source: DA_CENTROID_SOURCE_ID, id: featureId }, { selected })
    } catch (error) {
      // ignore - feature may not be present in current source data yet
    }
  }

  const clearSelectedDa = ({ silent = false } = {}) => {
    if (selectedDaFeatureId) {
      setDaFeatureState(selectedDaFeatureId, false)
    }
    selectedDaFeatureId = null
    selectedDa = null
    if (!silent) {
      emitDaUpdate()
    }
    updateDaCentroidVisualization()
  }

  const selectDaFeature = (feature, { silent = false } = {}) => {
    if (!feature) {
      clearSelectedDa({ silent })
      return
    }

    const featureId = feature.id ?? feature?.properties?.id
    const props = { ...(feature?.properties ?? {}) }
    if (!featureId) {
      if (!silent) emitDaUpdate()
      return
    }

    const canonicalId = props.daId ?? getDaIdentifier(props) ?? featureId

    if (selectedDaFeatureId && selectedDaFeatureId !== featureId) {
      setDaFeatureState(selectedDaFeatureId, false)
    }

    setDaFeatureState(featureId, true)
    selectedDaFeatureId = featureId

    selectedDa = {
      featureId,
      id: canonicalId,
      label: props.name ?? canonicalId,
      travelTimeMinutes: props[TRAVEL_TIME_MINUTES_PROP] ?? null,
      travelTimeSeconds: props[TRAVEL_TIME_SECONDS_PROP] ?? null,
      travelTimeStatus: props[TRAVEL_TIME_STATUS_PROP] ?? null,
      rawProperties: props,
      seniorsProportion: props['Scarborough_Clip.SeniorsProportion'],
      coordinates: feature?.geometry?.coordinates ?? null,
    }

    if (!silent) {
      emitDaUpdate()
    }
    updateDaCentroidVisualization()
  }

  const getCachedTravelTimes = () => {
    if (typeof window === 'undefined') return null
    try {
      const raw = window.sessionStorage?.getItem(travelTimeCacheKey)
      if (!raw) return null
      const parsed = JSON.parse(raw)
      if (parsed?.arrivalTime !== ARRIVAL_TIME_ISO) return null
      if (!parsed?.records) return null
      return parsed
    } catch (error) {
      console.warn('Failed to parse cached TravelTime payload', error)
      return null
    }
  }

  const setCachedTravelTimes = (data) => {
    if (typeof window === 'undefined') return
    try {
      window.sessionStorage?.setItem(travelTimeCacheKey, JSON.stringify(data))
    } catch (error) {
      console.warn('Unable to cache TravelTime payload', error)
    }
  }

  const emitTravelTimeUpdate = () => {
    dispatch('traveltimeupdate', {
      status: travelTimeStatus,
      summary: travelTimeSummary,
    })
  }

  const setTravelTimeStatus = (nextStatus) => {
    travelTimeStatus = nextStatus
    emitTravelTimeUpdate()
  }

  const setTravelTimeSummary = (nextSummary) => {
    travelTimeSummary = nextSummary
    if (!nextSummary) {
      showLegend = false
      clearDaTravelTimeData()
    }
    updateDaCentroidVisualization()
    emitTravelTimeUpdate()
  }

  const composeSuccessMessage = (summary) =>
    `Travel times ready for ${summary.reachable} of ${summary.totalStops} areas (${summary.unreachable.length} unreachable).`

  const updateSuccessStatusFromSummary = (summary) => {
    if (!summary || !travelTimesActive) return
    setTravelTimeStatus({
      state: 'success',
      message: composeSuccessMessage(summary),
    })
  }

  const emitRouteUpdate = () => {
    dispatch('routeupdate', {
      status: routeStatus,
      summary: routeSummary,
      stop: selectedStop,
    })
  }

  const setSelectedRouteStop = (stop) => {
    selectedStop = stop
    emitRouteUpdate()
  }

  const setRouteStatus = (nextStatus) => {
    routeStatus = nextStatus
    emitRouteUpdate()
  }

  const setRouteSummary = (nextSummary) => {
    routeSummary = nextSummary
    emitRouteUpdate()
  }

  const clearRoute = ({ preserveStop = false, statusMessage = 'Select a stop to view a route to Kennedy Station.' } = {}) => {
    routeInFlightStopId = null
    updateRouteSourceData(emptyFeatureCollection)
    updateSelectedStopSource(null)
    if (!preserveStop) {
      setSelectedRouteStop(null)
    }
    setRouteSummary(null)
    setRouteStatus({ state: 'idle', message: statusMessage })
  }

  const clearHoveredStop = () => {
    if (!map || hoveredStopId === null) return
    try {
      map.setFeatureState({ source: STOPS_SOURCE_ID, id: hoveredStopId }, { hovered: false })
    } catch (error) {
      // ignore - feature may no longer exist in current source data
    }
    hoveredStopId = null
  }

  const setHoveredStop = (stopId) => {
    if (!map || stopId === hoveredStopId) return

    if (hoveredStopId !== null) {
      clearHoveredStop()
    }

    if (stopId === null) return

    try {
      map.setFeatureState({ source: STOPS_SOURCE_ID, id: stopId }, { hovered: true })
      hoveredStopId = stopId
    } catch (error) {
      hoveredStopId = null
    }
  }

  const loadRouteForStop = async (stop) => {
    if (!stop?.id || !Number.isFinite(stop?.lat) || !Number.isFinite(stop?.lng)) {
      setRouteStatus({ state: 'error', message: 'Invalid stop selected for routing.' })
      return
    }

    const highlightFeature = {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [stop.lng, stop.lat],
      },
      properties: {
        id: stop.id,
        name: stop.name ?? stop.id,
      },
    }

    setSelectedRouteStop(stop)
    setRouteSummary(null)
    updateRouteSourceData(emptyFeatureCollection)
    updateSelectedStopSource(highlightFeature)
    routeInFlightStopId = stop.id

    setRouteStatus({
      state: 'loading',
      message: `Fetching route from ${stop.name ?? stop.id}…`,
    })

    try {
      const result = await fetchRouteForStop(stop)

      if (routeInFlightStopId !== stop.id) {
        return
      }

      const features = result?.geojson?.features ?? []
      const hasFallbackGeometry = features.some((feature) => feature?.properties?.fallback)

      if (features.length) {
        updateRouteSourceData(result.geojson)
      } else {
        updateRouteSourceData(emptyFeatureCollection)
      }

      setRouteSummary(result)

      const minutes = Number.isFinite(result?.travelTimeSeconds)
        ? Math.round(result.travelTimeSeconds / 60)
        : null
      const distanceKm = Number.isFinite(result?.distanceMeters)
        ? Math.round((result.distanceMeters / 1000) * 10) / 10
        : null

      const segments = []
      if (minutes !== null) segments.push(`${minutes} min`)
      if (distanceKm !== null) segments.push(`${distanceKm} km`)

      setRouteStatus({
        state: 'success',
        message:
          segments.length > 0
            ? `Route ready (${segments.join(', ')}).`
            : features.length
            ? hasFallbackGeometry
              ? 'Route ready (straight-line path).'
              : 'Route ready.'
            : 'Route ready (no path returned).',
      })
    } catch (error) {
      if (routeInFlightStopId !== stop.id) {
        return
      }

      console.error('Failed to load TravelTime route', error)
      updateRouteSourceData(emptyFeatureCollection)
      setRouteSummary(null)
      setRouteStatus({
        state: 'error',
        message: error?.message ?? 'Route request failed.',
      })
    } finally {
      if (routeInFlightStopId === stop.id) {
        routeInFlightStopId = null
      }
    }
  }

  const applyTravelTimesToDaCentroids = (records) => {
    if (!daCentroidCollection?.features?.length) return

    const recordsMap = new Map(Object.entries(records ?? {}))

    if (!daCentroidCollection?.features?.length) {
      updateDaCentroidVisualization()
      return
    }

    let minMetric = Infinity
    let maxMetric = -Infinity

    const updatedFeatures = daCentroidCollection.features.map((feature) => {
      if (!feature?.properties) return feature
      const id = feature.properties.id
      const record = recordsMap.get(id)

      const nextProperties = { ...(feature.properties ?? {}) }

      // Clear old metric value
      delete nextProperties[SENIORS_METRIC_PROP]

      if (record) {
        const minutes = Number.isFinite(record.travelTimeMinutes)
          ? Math.round(record.travelTimeMinutes * 10) / 10
          : null

        nextProperties[TRAVEL_TIME_STATUS_PROP] = record.status
        nextProperties[TRAVEL_TIME_SECONDS_PROP] = record.travelTimeSeconds
        nextProperties[TRAVEL_TIME_MINUTES_PROP] = minutes
        nextProperties[TRAVEL_TIME_BUCKET_PROP] = record.bucket

        const seniorsProportion = feature.properties['Scarborough_Clip.SeniorsProportion']
        if (minutes !== null && Number.isFinite(seniorsProportion)) {
          const metric = minutes * seniorsProportion
          nextProperties[SENIORS_METRIC_PROP] = metric
          if (metric < minMetric) minMetric = metric
          if (metric > maxMetric) maxMetric = metric
        }

      } else {
        delete nextProperties[TRAVEL_TIME_STATUS_PROP]
        delete nextProperties[TRAVEL_TIME_SECONDS_PROP]
        delete nextProperties[TRAVEL_TIME_MINUTES_PROP]
        delete nextProperties[TRAVEL_TIME_BUCKET_PROP]
      }

      return {
        ...feature,
        properties: nextProperties,
      }
    })

    seniorsMetricMin = minMetric === Infinity ? null : minMetric
    seniorsMetricMax = maxMetric === -Infinity ? null : maxMetric

    daCentroidCollection = {
      ...daCentroidCollection,
      features: updatedFeatures,
    }

    const centroidSource = map?.getSource(DA_CENTROID_SOURCE_ID)
    if (centroidSource) {
      centroidSource.setData(daCentroidCollection)
    }

    if (selectedDaFeatureId) {
      const nextFeature = daCentroidCollection.features.find((feature) => {
        const featureId = feature.id ?? feature?.properties?.id
        return featureId === selectedDaFeatureId
      })

      if (nextFeature) {
        selectDaFeature(nextFeature, { silent: false })
      } else {
        clearSelectedDa()
      }
    } else {
      updateDaCentroidVisualization()
    }
  }

  const clearDaTravelTimeData = () => {
    clearSelectedDa({ silent: true })

    seniorsMetricMin = null
    seniorsMetricMax = null

    if (daCentroidCollection?.features) {
      const clearedCentroids = daCentroidCollection.features.map((feature) => {
        const properties = { ...(feature?.properties ?? {}) }
        delete properties[TRAVEL_TIME_STATUS_PROP]
        delete properties[TRAVEL_TIME_SECONDS_PROP]
        delete properties[TRAVEL_TIME_MINUTES_PROP]
        delete properties[TRAVEL_TIME_BUCKET_PROP]
        delete properties[SENIORS_METRIC_PROP]
        return {
          ...feature,
          properties,
        }
      })

      daCentroidCollection = {
        ...daCentroidCollection,
        features: clearedCentroids,
      }

      const centroidSource = map?.getSource(DA_CENTROID_SOURCE_ID)
      if (centroidSource) {
        centroidSource.setData(daCentroidCollection)
      }
    }

    updateDaCentroidVisualization()
    emitDaUpdate()
  }

  const requestTravelTimesIfReady = () => {
    if (!travelTimesActive) return
    if (travelTimesRequested) return
    if (!daCentroidCollection?.features?.length) return

    travelTimesRequested = true
    loadScarboroughTravelTimes()
      .catch(() => {})
      .finally(() => {
        updateDaCentroidVisualization()
      })
  }

  const loadScarboroughTravelTimes = async () => {
    if (!fullStopsGeoJSON?.features?.length) {
      setTravelTimeStatus({
        state: 'error',
        message: 'Stop data is unavailable for TravelTime requests.',
      })
      travelTimesRequested = false
      return
    }

    if (!daCentroidCollection?.features?.length) {
      setTravelTimeSummary(null)
      setTravelTimeStatus({
        state: 'empty',
        message: 'No dissemination areas available for TravelTime requests.',
      })
      travelTimesRequested = false
      return
    }

    const cached = getCachedTravelTimes()
    if (cached) {
      applyTravelTimesToDaCentroids(cached.records)
      setTravelTimeSummary(cached)
      setTravelTimeStatus({
        state: 'cached',
        message: `Loaded cached travel times for ${cached.reachable ?? 0} of ${cached.totalStops ?? 0} areas.`,
      })
      updateDaCentroidVisualization()
      return
    }

    const centroids = daCentroidCollection.features

    setTravelTimeStatus({
      state: 'loading',
      message: `Requesting travel times for ${centroids.length} dissemination areas…`,
    })

    try {
      const result = await fetchTravelTimesForStops(centroids, {
        batchSize: 100,
        onProgress: ({ batchIndex, totalBatches, stage }) => {
          const batchNumber = batchIndex + 1
          setTravelTimeStatus({
            state: 'loading',
            message:
              stage === 'completed'
                ? `Completed batch ${batchNumber} of ${totalBatches}…`
                : `Requesting batch ${batchNumber} of ${totalBatches}…`,
          })
        },
      })

      setTravelTimeSummary(result)
      applyTravelTimesToDaCentroids(result.records)
      setCachedTravelTimes(result)
      updateSuccessStatusFromSummary(result)
      updateDaCentroidVisualization()
    } catch (error) {
      console.error('Failed to load TravelTime data', error)
      travelTimesRequested = false
      setTravelTimeStatus({
        state: 'error',
        message: error?.message ?? 'TravelTime API request failed.',
      })
    }
  }

  const handleTravelTimeActivation = (shouldEnable) => {
    if (travelTimesActive === shouldEnable) return

    travelTimesActive = shouldEnable

    if (!shouldEnable) {
      travelTimesRequested = false
      setTravelTimeSummary(null)
      setTravelTimeStatus({
        state: 'inactive',
        message: 'Select the Scarborough region to view travel times.',
      })
      clearRoute({ preserveStop: false, statusMessage: 'Select a stop to view a route to Kennedy Station.' })
      return
    }

    updateDaCentroidVisualization()

    if (travelTimeSummary) {
      updateSuccessStatusFromSummary(travelTimeSummary)
    }

    requestTravelTimesIfReady()
  }

  emitTravelTimeUpdate()
  emitRouteUpdate()
  emitDaUpdate()

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

  const centroidOfRing = (ring) => {
    if (!Array.isArray(ring) || ring.length < 3) {
      return { area: 0, centroid: [0, 0] }
    }

    let twiceArea = 0
    let cx = 0
    let cy = 0

    for (let i = 0; i < ring.length - 1; i += 1) {
      const [x0, y0] = ring[i]
      const [x1, y1] = ring[i + 1]
      const cross = x0 * y1 - x1 * y0
      twiceArea += cross
      cx += (x0 + x1) * cross
      cy += (y0 + y1) * cross
    }

    const area = twiceArea / 2
    if (area === 0) {
      return { area: 0, centroid: ring[0] ?? [0, 0] }
    }

    return {
      area,
      centroid: [cx / (3 * twiceArea), cy / (3 * twiceArea)],
    }
  }

  const centroidOfPolygon = (rings) => {
    if (!Array.isArray(rings) || !rings.length) return { centroid: null, area: 0 }

    let totalArea = 0
    let sumX = 0
    let sumY = 0

    for (let i = 0; i < rings.length; i += 1) {
      const { area, centroid } = centroidOfRing(rings[i])
      if (!Number.isFinite(area) || !Number.isFinite(centroid?.[0]) || !Number.isFinite(centroid?.[1])) {
        continue
      }

      totalArea += area
      sumX += centroid[0] * area
      sumY += centroid[1] * area
    }

    if (totalArea === 0) {
      const bounds = computeGeometryBounds({ type: 'Polygon', coordinates: rings })
      if (!bounds) return { centroid: null, area: 0 }
      const [[minX, minY], [maxX, maxY]] = bounds
      return {
        centroid: [(minX + maxX) / 2, (minY + maxY) / 2],
        area: 0,
      }
    }

    return {
      centroid: [sumX / totalArea, sumY / totalArea],
      area: totalArea,
    }
  }

  const computeDisseminationAreaCentroids = (geojson) => {
    if (!geojson?.features) return emptyFeatureCollection

    const centroidFeatures = []

    geojson.features.forEach((feature, index) => {
      const canonicalId = getDaIdentifier(feature?.properties) ?? `${index}`
      const travelId = `da-${canonicalId}`
      const geometry = feature?.geometry

      if (!geometry) return

      let centroid = null

      if (geometry.type === 'Polygon') {
        const { centroid: polygonCentroid } = centroidOfPolygon(geometry.coordinates)
        centroid = polygonCentroid
      } else if (geometry.type === 'MultiPolygon') {
        let totalArea = 0
        let sumX = 0
        let sumY = 0

        for (const polygon of geometry.coordinates ?? []) {
          const { centroid: polygonCentroid, area } = centroidOfPolygon(polygon)
          if (!polygonCentroid || area === 0) continue
          totalArea += area
          sumX += polygonCentroid[0] * area
          sumY += polygonCentroid[1] * area
        }

        if (totalArea !== 0) {
          centroid = [sumX / totalArea, sumY / totalArea]
        }
      }

      if (!centroid) {
        const bounds = computeGeometryBounds(geometry)
        if (bounds) {
          const [[minX, minY], [maxX, maxY]] = bounds
          centroid = [(minX + maxX) / 2, (minY + maxY) / 2]
        }
      }

      if (!centroid || !Number.isFinite(centroid[0]) || !Number.isFinite(centroid[1])) {
        return
      }

      centroidFeatures.push({
        type: 'Feature',
        id: travelId,
        geometry: {
          type: 'Point',
          coordinates: centroid,
        },
        properties: {
          ...(feature?.properties ?? {}),
          id: travelId,
          daId: canonicalId,
          name: feature?.properties?.NAME ?? canonicalId,
        },
      })
    })

    return {
      type: 'FeatureCollection',
      features: centroidFeatures,
    }
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

    if (hoveredStopId !== null) {
      try {
        map.setFeatureState({ source: STOPS_SOURCE_ID, id: hoveredStopId }, { hovered: true })
      } catch (error) {
        hoveredStopId = null
      }
    }
  }

  const updateRouteSourceData = (geojson) => {
    const routeSource = map?.getSource(ROUTE_SOURCE_ID)
    if (!routeSource) return
    routeSource.setData(geojson ?? emptyFeatureCollection)
  }

  const updateSelectedStopSource = (feature) => {
    const selectedSource = map?.getSource(SELECTED_STOP_SOURCE_ID)
    if (!selectedSource) return

    if (feature) {
      selectedSource.setData({
        type: 'FeatureCollection',
        features: [feature],
      })
    } else {
      selectedSource.setData(emptyFeatureCollection)
    }
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
      handleTravelTimeActivation(false)
      return
    }

    if (!areaName) {
      updateStopsDataset(null)
      handleTravelTimeActivation(false)
      return
    }

    map.setFilter('toronto-region-highlight-fill', ['==', ['get', 'AREA_NAME'], areaName])
    map.setFilter('toronto-region-highlight-outline', ['==', ['get', 'AREA_NAME'], areaName])
    map.setLayoutProperty('toronto-region-highlight-fill', 'visibility', 'visible')
    map.setLayoutProperty('toronto-region-highlight-outline', 'visibility', 'visible')
    map.setPaintProperty('toronto-boundary-fill', 'fill-opacity', 0.08)
    map.setPaintProperty('toronto-region-highlight-fill', 'fill-opacity', 0.05)
    map.setPaintProperty('toronto-region-highlight-outline', 'line-opacity', 0.85)
    updateStopsDataset(areaName)

    if (areaName === SCARBOROUGH_AREA_NAME) {
      handleTravelTimeActivation(true)
    } else {
      handleTravelTimeActivation(false)
    }

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
        const [boundaryGeoJSON, stopsGeoJSON, regionsGeoJSON, scarboroughDaGeoJSON] = await Promise.all([
          loadBoundary(),
          loadStops(),
          loadRegions(),
          loadScarboroughDa(),
        ])

        regionColorExpression = buildRegionColorExpression()
        daGeoJSON = scarboroughDaGeoJSON

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

        if (daGeoJSON) {
          daCentroidCollection = computeDisseminationAreaCentroids(daGeoJSON)

          map.addSource(DA_SOURCE_ID, {
            type: 'geojson',
            data: daGeoJSON,
          })

          map.addLayer({
            id: DA_FILL_LAYER_ID,
            type: 'fill',
            source: DA_SOURCE_ID,
            paint: {
              'fill-color': '#94a3b8',
              'fill-opacity': 0.18,
            },
          })

          map.addLayer({
            id: DA_OUTLINE_LAYER_ID,
            type: 'line',
            source: DA_SOURCE_ID,
            paint: {
              'line-color': '#475569',
              'line-width': 1,
              'line-opacity': 0.45,
            },
          })

          map.addSource(DA_CENTROID_SOURCE_ID, {
            type: 'geojson',
            data: daCentroidCollection ?? emptyFeatureCollection,
          })

          map.addLayer({
            id: DA_CENTROID_LAYER_ID,
            type: 'circle',
            source: DA_CENTROID_SOURCE_ID,
            paint: {
              'circle-radius': [
                'interpolate',
                ['linear'],
                ['zoom'],
                10,
                ['case', ['boolean', ['feature-state', 'selected'], false], 6, 3.5],
                14,
                ['case', ['boolean', ['feature-state', 'selected'], false], 9, 6],
                16,
                ['case', ['boolean', ['feature-state', 'selected'], false], 12, 8.5],
              ],
              'circle-color': '#1d4ed8',
              'circle-opacity': 0.45,
              'circle-stroke-color': '#ffffff',
              'circle-stroke-width': ['case', ['boolean', ['feature-state', 'selected'], false], 2.2, 1.1],
            },
          })

          handleDaClickOnMap = (event) => {
            const feature = event?.features?.[0]
            if (!feature) return
            selectDaFeature(feature)
          }

          handleDaMouseEnter = () => {
            map.getCanvas().style.cursor = 'pointer'
          }

          handleDaMouseLeave = () => {
            map.getCanvas().style.cursor = ''
          }

          map.on('click', DA_CENTROID_LAYER_ID, handleDaClickOnMap)
          map.on('mouseenter', DA_CENTROID_LAYER_ID, handleDaMouseEnter)
          map.on('mouseleave', DA_CENTROID_LAYER_ID, handleDaMouseLeave)

          updateDaCentroidVisualization()
          requestTravelTimesIfReady()
        }

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
            'circle-radius': buildRadiusExpression(false),
            'circle-color': '#2563eb',
            'circle-opacity': 0.8,
            'circle-stroke-width': 1,
            'circle-stroke-color': '#ffffff',
          },
        })

        mapLoaded = true
        updateStopsVisualization()
        updateDaCentroidVisualization()

        map.addSource(ROUTE_SOURCE_ID, {
          type: 'geojson',
          data: emptyFeatureCollection,
        })

        map.addLayer({
          id: ROUTE_OUTLINE_LAYER_ID,
          type: 'line',
          source: ROUTE_SOURCE_ID,
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
          },
          paint: {
            'line-color': '#0f172a',
            'line-opacity': 0.25,
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 5, 14, 8, 16, 11],
          },
        })

        map.addLayer({
          id: ROUTE_LAYER_ID,
          type: 'line',
          source: ROUTE_SOURCE_ID,
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
          },
          paint: {
            'line-color': buildRouteColorExpression(),
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 14, 6.5, 16, 9],
            'line-opacity': 0.9,
          },
        })

        map.addSource(SELECTED_STOP_SOURCE_ID, {
          type: 'geojson',
          data: emptyFeatureCollection,
        })

        map.addLayer({
          id: SELECTED_STOP_LAYER_ID,
          type: 'circle',
          source: SELECTED_STOP_SOURCE_ID,
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 5.5, 14, 8, 16, 11],
            'circle-color': '#ef4444',
            'circle-opacity': 0.95,
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff',
          },
        })

        map.addSource(DESTINATION_SOURCE_ID, {
          type: 'geojson',
          data: destinationFeatureCollection,
        })

        map.addLayer({
          id: DESTINATION_LAYER_ID,
          type: 'circle',
          source: DESTINATION_SOURCE_ID,
          paint: {
            'circle-radius': 13,
            'circle-color': '#dc2626',
            'circle-opacity': 0.95,
            'circle-stroke-width': 2.5,
            'circle-stroke-color': '#ffffff',
          },
        })

        map.addLayer({
          id: DESTINATION_LABEL_LAYER_ID,
          type: 'symbol',
          source: DESTINATION_SOURCE_ID,
          layout: {
            'text-field': SCARBOROUGH_DESTINATION.label,
            'text-font': ['Inter Medium', 'Arial Unicode MS Bold'],
            'text-offset': [0, 1.6],
            'text-size': 14,
            'text-anchor': 'top',
          },
          paint: {
            'text-color': '#b91c1c',
            'text-halo-color': '#ffffff',
            'text-halo-width': 1.5,
          },
        })

        const handleStopClickOnMap = (event) => {
          const feature = event?.features?.[0]
          if (!feature) return

          const coords = feature?.geometry?.coordinates
          if (!Array.isArray(coords) || coords.length < 2) return

          const stop = {
            id: feature?.properties?.id ?? feature?.properties?.stop_id,
            name: feature?.properties?.name ?? feature?.properties?.stop_name ?? feature?.properties?.id,
            lat: coords[1],
            lng: coords[0],
          }

          if (!stop.id || !Number.isFinite(stop.lat) || !Number.isFinite(stop.lng)) {
            return
          }

          loadRouteForStop(stop)
        }

        map.on('click', STOPS_LAYER_ID, handleStopClickOnMap)

        map.on('mouseenter', STOPS_LAYER_ID, () => {
          map.getCanvas().style.cursor = 'pointer'
        })

        map.on('mousemove', STOPS_LAYER_ID, (event) => {
          const feature = event?.features?.[0]
          if (!feature) return
          const stopId = feature.id ?? feature?.properties?.id
          if (!stopId) return
          setHoveredStop(stopId)
        })

        map.on('mouseleave', STOPS_LAYER_ID, () => {
          map.getCanvas().style.cursor = ''
          clearHoveredStop()
        })

        regionMetadata = calculateRegionMetadata(regionsGeoJSON)

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
      if (handleDaClickOnMap) {
        map?.off('click', DA_CENTROID_LAYER_ID, handleDaClickOnMap)
        handleDaClickOnMap = null
      }
      if (handleDaMouseEnter) {
        map?.off('mouseenter', DA_CENTROID_LAYER_ID, handleDaMouseEnter)
        handleDaMouseEnter = null
      }
      if (handleDaMouseLeave) {
        map?.off('mouseleave', DA_CENTROID_LAYER_ID, handleDaMouseLeave)
        handleDaMouseLeave = null
      }
      map?.remove()
    }
  })

  $: if (mapLoaded) {
    updateHoverState(hoveredRegion)
  }

  $: if (mapLoaded) {
    updateSelectedRegionState(selectedRegion)
  }

  $: if (mapLoaded && map.getLayer(DA_CENTROID_LAYER_ID)) {
    map.setLayoutProperty(DA_CENTROID_LAYER_ID, 'visibility', isCentroidVizEnabled ? 'visible' : 'none');
  }
</script>

<div class="relative h-full w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg">
  {#if travelTimesActive && travelTimeSummary}
    <div class="pointer-events-none absolute bottom-4 right-4 z-20 flex flex-col items-end gap-3 text-xs text-slate-600">
      <div class="pointer-events-auto">
        <button
          type="button"
          class="flex items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-600 shadow transition hover:bg-white"
          on:click|stopPropagation={() => (showLegend = !showLegend)}
          aria-expanded={showLegend}
          aria-controls="scarborough-travel-legend"
        >
          <span>Travel Time Legend</span>
          <svg class={`h-3.5 w-3.5 transition ${showLegend ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path
              fill-rule="evenodd"
              d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 10.715l3.71-3.484a.75.75 0 1 1 1.04 1.08l-4.24 3.985a.75.75 0 0 1-1.04 0l-4.24-3.985a.75.75 0 0 1 .02-1.06Z"
              clip-rule="evenodd"
            />
          </svg>
        </button>

        {#if showLegend}
          <div
            id="scarborough-travel-legend"
            class="mt-3 w-64 rounded-xl border border-slate-200 bg-white/95 p-4 text-left shadow"
          >
            <div class="space-y-2">
              {#each travelTimeRamp as stop}
                <div class="flex items-center gap-2 text-[11px]">
                  <span class="h-3 w-3 flex-none rounded-full" style={`background-color: ${stop.color};`}></span>
                  <span>{stop.label}</span>
                </div>
              {/each}
              <div class="flex items-center gap-2 text-[11px]">
                <span class="h-3 w-3 flex-none rounded-full" style={`background-color: ${travelTimeLegendUnreachable.color};`}></span>
                <span>{travelTimeLegendUnreachable.label}</span>
              </div>
              <p class="pt-2 text-[11px] text-slate-500">
                Destination: {SCARBOROUGH_DESTINATION.label}
              </p>
              <p class="text-[11px] text-slate-500">
                Arrival: {arrivalDateLabel} • Max {maxTravelTimeMinutes} min
              </p>
            </div>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <div bind:this={mapContainer} class="absolute inset-0" role="presentation"></div>
</div>
