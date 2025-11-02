const API_URL = 'https://api.traveltimeapp.com/v4/time-filter'
const ROUTES_API_URL = 'https://api.traveltimeapp.com/v4/routes'
const DESTINATION_ID = 'kennedy-station'

export const SCARBOROUGH_DESTINATION = {
  id: DESTINATION_ID,
  coords: {
    lat: 43.7324073,
    lng: -79.267185,
  },
  label: 'Kennedy Station',
}

export const ARRIVAL_TIME_ISO = '2025-11-03T08:00:00-05:00'
export const MAX_TRAVEL_TIME_SECONDS = 5400

const DEFAULT_BATCH_SIZE = 100
const MAX_RETRY_ATTEMPTS = 4
const BASE_RETRY_DELAY_MS = 750
const ROUTE_CACHE_PREFIX = `traveltime-route:${DESTINATION_ID}:${ARRIVAL_TIME_ISO}:`

const appId = import.meta.env.VITE_TRAVELTIME_APP_ID
const apiKey = import.meta.env.VITE_TRAVELTIME_API_KEY

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const buildLocationsPayload = (stopsChunk) => {
  const locations = [
    {
      id: SCARBOROUGH_DESTINATION.id,
      coords: { ...SCARBOROUGH_DESTINATION.coords },
    },
  ]

  for (const stop of stopsChunk) {
    locations.push({
      id: stop.id,
      coords: {
        lat: stop.lat,
        lng: stop.lng,
      },
    })
  }

  return locations
}

const buildArrivalSearch = (stopsChunk, batchIndex) => ({
  id: `scarborough-summit-${batchIndex}`,
  arrival_location_id: SCARBOROUGH_DESTINATION.id,
  departure_location_ids: stopsChunk.map((stop) => stop.id),
  transportation: {
    type: 'public_transport',
  },
  arrival_time: ARRIVAL_TIME_ISO,
  travel_time: MAX_TRAVEL_TIME_SECONDS,
  properties: ['travel_time'],
})

const classifyTravelTime = (seconds) => {
  if (!Number.isFinite(seconds)) return null
  const minutes = seconds / 60

  if (minutes <= 15) return '0-15 min'
  if (minutes <= 30) return '15-30 min'
  if (minutes <= 45) return '30-45 min'
  if (minutes <= 60) return '45-60 min'
  if (minutes <= 75) return '60-75 min'
  if (minutes <= 90) return '75-90 min'
  return '> 90 min'
}

const normalizeStops = (features = []) => {
  const normalized = []

  for (const feature of features) {
    const id = feature?.properties?.id ?? feature?.properties?.stop_id
    const name = feature?.properties?.name ?? feature?.properties?.stop_name
    const coords = feature?.geometry?.coordinates

    if (!id || !coords || coords.length < 2) continue

    const [lng, lat] = coords

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue

    normalized.push({
      id,
      name: name ?? id,
      lat,
      lng,
    })
  }

  return normalized
}

const requestMatrixBatch = async (stopsChunk, batchIndex, attempt = 1) => {
  if (!appId || !apiKey) {
    throw new Error('TravelTime credentials are not configured. Set VITE_TRAVELTIME_APP_ID and VITE_TRAVELTIME_API_KEY.')
  }

  const payload = {
    locations: buildLocationsPayload(stopsChunk),
    arrival_searches: [buildArrivalSearch(stopsChunk, batchIndex)],
  }

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Application-Id': appId,
      'X-Api-Key': apiKey,
    },
    body: JSON.stringify(payload),
  })

  if (response.status === 429 && attempt < MAX_RETRY_ATTEMPTS) {
    const delay = BASE_RETRY_DELAY_MS * attempt
    await sleep(delay)
    return requestMatrixBatch(stopsChunk, batchIndex, attempt + 1)
  }

  if (!response.ok) {
    const message = await response.text().catch(() => '')
    throw new Error(`TravelTime request failed with ${response.status}: ${message}`)
  }

  return response.json()
}

const chunkStops = (stops, batchSize) => {
  const chunks = []
  for (let index = 0; index < stops.length; index += batchSize) {
    chunks.push(stops.slice(index, index + batchSize))
  }
  return chunks
}

const mergeBatchResult = (accumulator, batchResponse) => {
  const results = batchResponse?.results ?? []

  for (const result of results) {
    const locations = result?.locations ?? []
    for (const location of locations) {
      const stopId = location?.id
      const travelTimeSeconds = location?.properties?.[0]?.travel_time

      if (!stopId) continue

      accumulator.records[stopId] = {
        status: 'reachable',
        travelTimeSeconds,
        travelTimeMinutes: Number.isFinite(travelTimeSeconds) ? travelTimeSeconds / 60 : null,
        bucket: classifyTravelTime(travelTimeSeconds),
      }
    }

    for (const unreachableId of result?.unreachable ?? []) {
      accumulator.records[unreachableId] = {
        status: 'unreachable',
        travelTimeSeconds: null,
        travelTimeMinutes: null,
        bucket: null,
      }
      accumulator.unreachable.add(unreachableId)
    }
  }
}

export const fetchTravelTimesForStops = async (features, { batchSize = DEFAULT_BATCH_SIZE, onProgress } = {}) => {
  const normalizedStops = normalizeStops(features)
  if (!normalizedStops.length) {
    return {
      records: {},
      unreachable: [],
      totalStops: 0,
      requestedAt: new Date().toISOString(),
      arrivalTime: ARRIVAL_TIME_ISO,
      destination: SCARBOROUGH_DESTINATION,
    }
  }

  const chunks = chunkStops(normalizedStops, batchSize)
  const accumulator = {
    records: {},
    unreachable: new Set(),
  }

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]
    if (typeof onProgress === 'function') {
      onProgress({
        batchIndex: index,
        completedBatches: index,
        totalBatches: chunks.length,
        stage: 'requesting',
      })
    }

    const response = await requestMatrixBatch(chunk, index)
    mergeBatchResult(accumulator, response)

    if (typeof onProgress === 'function') {
      onProgress({
        batchIndex: index,
        completedBatches: index + 1,
        totalBatches: chunks.length,
        stage: 'completed',
      })
    }
  }

  const reachableCount = Object.values(accumulator.records).filter((entry) => entry.status === 'reachable').length

  return {
    records: accumulator.records,
    unreachable: Array.from(accumulator.unreachable),
    totalStops: normalizedStops.length,
    reachable: reachableCount,
    requestedAt: new Date().toISOString(),
    arrivalTime: ARRIVAL_TIME_ISO,
    destination: SCARBOROUGH_DESTINATION,
  }
}

const decodePolyline = (polyline) => {
  if (typeof polyline !== 'string' || !polyline.length) return []

  let index = 0
  const len = polyline.length
  const coordinates = []
  let lat = 0
  let lng = 0

  while (index < len) {
    let shift = 0
    let result = 0
    let byte

    do {
      byte = polyline.charCodeAt(index) - 63
      index += 1
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)

    const deltaLat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1
    lat += deltaLat

    shift = 0
    result = 0

    do {
      byte = polyline.charCodeAt(index) - 63
      index += 1
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)

    const deltaLng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1
    lng += deltaLng

    coordinates.push([lng / 1e5, lat / 1e5])
  }

  return coordinates
}

const normalizeRouteCoordinates = (rawCoords) => {
  if (!rawCoords) return []

  if (typeof rawCoords === 'string') {
    return decodePolyline(rawCoords).map(([lng, lat]) => [lng, lat])
  }

  if (Array.isArray(rawCoords)) {
    if (!rawCoords.length) return []

    if (rawCoords.every((value) => Number.isFinite(value))) {
      const [first, second] = rawCoords
      if (!Number.isFinite(first) || !Number.isFinite(second)) return []
      const isLatFirst = Math.abs(first) <= 90 && Math.abs(second) > 90
      const lng = isLatFirst ? second : first
      const lat = isLatFirst ? first : second
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return []
      return [[lng, lat]]
    }

    // Flatten nested coordinate arrays
    if (Array.isArray(rawCoords[0])) {
      const flattened = []

      for (const entry of rawCoords) {
        const nested = normalizeRouteCoordinates(entry)
        if (nested.length) {
          flattened.push(...nested)
        }
      }

      if (flattened.length) return flattened
    }

    const coordinates = []

    for (const entry of rawCoords) {
      if (!entry) continue

      if (Array.isArray(entry) && entry.length >= 2) {
        const [first, second] = entry
        const isLatFirst = Math.abs(first) <= 90 && Math.abs(second) > 90
        const lng = isLatFirst ? second : first
        const lat = isLatFirst ? first : second

        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          coordinates.push([lng, lat])
        }
        continue
      }

      if (typeof entry === 'object') {
        const lat = entry.lat ?? entry.latitude ?? entry.y ?? entry[0]
        const lng = entry.lng ?? entry.lon ?? entry.longitude ?? entry.x ?? entry[1]

        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          coordinates.push([lng, lat])
        }
      }
    }

    return coordinates
  }

  if (typeof rawCoords === 'object') {
    if (Array.isArray(rawCoords.coordinates)) {
      return normalizeRouteCoordinates(rawCoords.coordinates)
    }
    if (Array.isArray(rawCoords.path)) {
      return normalizeRouteCoordinates(rawCoords.path)
    }
    if (Array.isArray(rawCoords.points)) {
      return normalizeRouteCoordinates(rawCoords.points)
    }
    if (Array.isArray(rawCoords.coords)) {
      return normalizeRouteCoordinates(rawCoords.coords)
    }
    if (typeof rawCoords.polyline === 'string') {
      return normalizeRouteCoordinates(rawCoords.polyline)
    }
  }

  return []
}

const collectCoordinateCandidates = (part) => {
  const candidates = [
    part?.polyline,
    part?.coordinates,
    part?.coords,
    part?.path,
    part?.points,
    part?.geometry,
    part?.geometry?.coordinates,
    part?.line?.geometry,
    part?.line?.polyline,
    part?.directions?.geometry,
    part?.directions?.path,
    part?.directions?.points,
  ]

  if (Array.isArray(part?.directions?.parts)) {
    for (const directionPart of part.directions.parts) {
      candidates.push(
        directionPart?.polyline,
        directionPart?.path,
        directionPart?.points,
        directionPart?.coordinates,
        directionPart?.coords,
        directionPart?.geometry,
      )
    }
  }

  return candidates
}

const normalizeRouteParts = (parts = []) => {
  const features = []

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    let coordinates = []

    for (const candidate of collectCoordinateCandidates(part)) {
      const normalized = normalizeRouteCoordinates(candidate)
      if (normalized.length >= 2) {
        coordinates = normalized
        break
      }
    }

    if (!coordinates.length) continue

    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates,
      },
      properties: {
        index,
        mode: part?.mode ?? part?.type ?? 'unknown',
        type: part?.type ?? 'unknown',
        travelTimeSeconds: part?.travel_time ?? part?.duration,
        distanceMeters: part?.distance ?? null,
      },
    })
  }

  return features
}

const buildRouteFeatureCollection = (route = {}, partsFeatures = [], stop) => {
  if (partsFeatures.length) {
    return partsFeatures
  }

  const routeCandidates = [
    route?.polyline,
    route?.path,
    route?.coordinates,
    route?.coords,
    route?.points,
    route?.geometry,
    route?.geometry?.coordinates,
    route?.lineString,
  ]

  for (const candidate of routeCandidates) {
    const normalized = normalizeRouteCoordinates(candidate)
    if (normalized.length >= 2) {
      return [
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: normalized,
          },
          properties: {
            index: 0,
            mode: route?.mode ?? 'route',
            type: route?.type ?? 'route',
            travelTimeSeconds: route?.travel_time ?? route?.duration ?? null,
            distanceMeters: route?.distance ?? null,
          },
        },
      ]
    }
  }

  if (stop && Number.isFinite(stop?.lng) && Number.isFinite(stop?.lat)) {
    return [
      {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [stop.lng, stop.lat],
            [SCARBOROUGH_DESTINATION.coords.lng, SCARBOROUGH_DESTINATION.coords.lat],
          ],
        },
        properties: {
          index: 0,
          mode: 'fallback',
          type: 'fallback',
          travelTimeSeconds: route?.travel_time ?? route?.duration ?? null,
          distanceMeters: route?.distance ?? null,
          fallback: true,
        },
      },
    ]
  }

  return []
}

const emptyFeatureCollection = {
  type: 'FeatureCollection',
  features: [],
}

const getCachedRoute = (stopId) => {
  if (typeof window === 'undefined') return null

  try {
    const raw = window.sessionStorage?.getItem(`${ROUTE_CACHE_PREFIX}${stopId}`)
    if (!raw) return null
    return JSON.parse(raw)
  } catch (error) {
    console.warn('Failed to read cached route payload', error)
    return null
  }
}

const setCachedRoute = (stopId, data) => {
  if (typeof window === 'undefined') return

  try {
    window.sessionStorage?.setItem(`${ROUTE_CACHE_PREFIX}${stopId}`, JSON.stringify(data))
  } catch (error) {
    console.warn('Unable to cache route payload', error)
  }
}

const parseRouteResponse = (data, stop) => {
  const result = data?.results?.[0]
  const location = result?.locations?.[0]
  const properties = location?.properties?.[0]

  if (!properties) {
    throw new Error('Route properties missing from TravelTime response.')
  }

  const travelTimeSeconds = properties?.travel_time ?? null
  const distanceMeters = properties?.distance ?? null
  const route = properties?.route ?? {}
  const parts = route?.parts ?? []
  const departureTime = route?.departure_time ?? null
  const arrivalTime = route?.arrival_time ?? result?.arrival_time ?? null

  const partsFeatures = normalizeRouteParts(parts)
  const features = buildRouteFeatureCollection(route, partsFeatures, stop)

  const summary = {
    stop: stop
      ? {
          id: stop.id,
          name: stop.name ?? stop.id,
          lat: stop.lat,
          lng: stop.lng,
        }
      : null,
    stopId: stop?.id,
    travelTimeSeconds,
    distanceMeters,
    departureTime,
    arrivalTime,
    parts,
    geojson: features.length
      ? {
          type: 'FeatureCollection',
          features,
        }
      : emptyFeatureCollection,
  }

  return summary
}

export const fetchRouteForStop = async (stop) => {
  if (!stop?.id || !Number.isFinite(stop?.lat) || !Number.isFinite(stop?.lng)) {
    throw new Error('Invalid stop provided for route request.')
  }

  const cached = getCachedRoute(stop.id)
  if (cached) {
    return cached
  }

  if (!appId || !apiKey) {
    throw new Error('TravelTime credentials are not configured. Set VITE_TRAVELTIME_APP_ID and VITE_TRAVELTIME_API_KEY.')
  }

  const payload = {
    locations: [
      {
        id: stop.id,
        coords: {
          lat: stop.lat,
          lng: stop.lng,
        },
      },
      {
        id: SCARBOROUGH_DESTINATION.id,
        coords: { ...SCARBOROUGH_DESTINATION.coords },
      },
    ],
    arrival_searches: [
      {
        id: `route-${stop.id}`,
        arrival_location_id: SCARBOROUGH_DESTINATION.id,
        departure_location_ids: [stop.id],
        transportation: {
          type: 'public_transport',
        },
        arrival_time: ARRIVAL_TIME_ISO,
        properties: ['travel_time', 'distance', 'route'],
      },
    ],
  }

  const response = await fetch(ROUTES_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Application-Id': appId,
      'X-Api-Key': apiKey,
    },
    body: JSON.stringify(payload),
  })

  if (response.status === 429) {
    throw new Error('TravelTime rate limit exceeded for routes API.')
  }

  if (!response.ok) {
    const message = await response.text().catch(() => '')
    throw new Error(`TravelTime routes request failed with ${response.status}: ${message}`)
  }

  const parsed = parseRouteResponse(await response.json(), stop)
  setCachedRoute(stop.id, parsed)
  return parsed
}
