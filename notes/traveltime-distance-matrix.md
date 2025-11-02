# TravelTime Distance Matrix Integration Plan

## Objective
- Compute public-transit travel times from every filtered Scarborough bus stop to a single destination (Kennedy Station, 43.7324073, -79.267185) using the TravelTime Distance Matrix API.
- Feed the resulting durations into the front-end for mapping and analytics (e.g., visualizing the destination as a red marker plus stop-specific time choropleths or labels).

## TravelTime API Recap
- Endpoint: `POST https://api.traveltimeapp.com/v4/time-filter` (aka TravelTime Distance Matrix API).
- Authentication: requires `X-Application-Id` and `X-Api-Key` headers.
- Primary resource: `arrival_searches` or `departure_searches`, each defining a set of sources and destinations.
- Response payload: contains matrices of `travel_time` (seconds), plus optional metadata like `distance`, `fares`, `route` when enabled.
- Supported transport modes include `public_transport`, `bus`, `train`, etc. For Scarborough bus stops we use `public_transport` (combines buses and other transit modes available in TravelTime coverage).
- Time constraints:
  - `travel_time` per search capped at 5400 seconds (90 minutes).
  - Each individual search currently limits up to 2000 `source` IDs × 2000 `destination` IDs; large batches can hit payload-size and rate limits, so chunking is mandatory.
- Rate limits: vary by plan; default free tier is typically ~10 requests per minute and 2,500 per day. Confirm with the account dashboard before large runs.

## Data Requirements
- **Scarborough bus stop dataset** with at least: unique identifier, latitude, longitude, optional stop name. (We already have filtered GTFS data—confirm final schema.)
- **Destination point**: Kennedy Station at `(lat: 43.7324073, lng: -79.267185)`.
- Optional: operating hours or service windows if we need to test different travel times (AM peak vs off-peak).

## Inputs & Decisions
- TravelTime credentials supplied (Application ID `d6e5f227` plus its API key). Store both outside source control, e.g., `.env` keys `VITE_TRAVELTIME_APP_ID` and `VITE_TRAVELTIME_API_KEY`.
- Arrival framing confirmed: use `arrival_time` to answer “arrive at Kennedy Station by 8:00 AM Eastern on Monday, 2025-11-03.” We serialize the request as `2025-11-03T08:00:00-05:00` (Toronto in standard time) and stay within TravelTime’s typical ±few-week timetable support window.
- Transportation mode locked to `public_transport` so the API can consider buses plus connecting transit routes in Scarborough.
- Maximum allowed `travel_time` per request: 5400 seconds (90 minutes). Stops requiring longer travel will be treated as unreachable and logged in the UI.
- Still needed: confirmation of acceptable quota usage/rate-limit headroom and any guidance on caching or persistence of TravelTime responses.

## Request Shape (conceptual)
```http
POST /v4/time-filter HTTP/1.1
Host: api.traveltimeapp.com
X-Application-Id: <APP_ID>
X-Api-Key: <API_KEY>
Content-Type: application/json

{
  "arrival_searches": [
    {
      "id": "kennedy-station",
      "arrival_location_id": "kennedy-station",
      "departure_location_ids": ["stop-001", "stop-002", "stop-003"],
      "transportation": { "type": "public_transport" },
      "arrival_time": "2025-11-03T08:00:00-05:00",
      "travel_time": 5400,
      "properties": ["travel_time"]
    }
  ],
  "locations": [
    {"id": "kennedy-station", "coords": {"lat": 43.7324073, "lng": -79.267185}},
    {"id": "stop-001", "coords": {"lat": 43.7770, "lng": -79.2500}},
    {"id": "stop-002", "coords": {"lat": 43.7700, "lng": -79.2600}},
    {"id": "stop-003", "coords": {"lat": 43.7800, "lng": -79.2700}}
  ]
}
```
- Switch to `departure_searches` if the UX should answer "leave at" instead of "arrive by".
- Add `properties` such as `"distance"`, `"fares"`, or `"route"` if needed (note: each increases payload size and request cost).

## Handling Thousands of Stops
- Chunk the bus stop list into batches that respect API limits (e.g., 100 stops per request here) and parallelize cautiously to stay under rate limits.
- Track retries with exponential backoff on HTTP 429/5xx responses; optionally fall back to cached results when limits are hit.
- Persist raw responses (or normalized rows) to avoid re-querying the same matrix when only the map view changes.
- Normalize result structure: each record = `{stop_id, stop_name, travel_time_seconds, arrival_time, request_id}`.
- Log unreachable stops (TravelTime omits them) and surface them in the UI for monitoring.

## Implementation Outline
1. **Configuration**: load TravelTime credentials + runtime parameters (arrival time, max travel time, mode) from environment.
2. **Data preparation**: read filtered bus stops, validate coordinates, attach unique IDs.
3. **Batch dispatcher**:
   - Group stops into request payloads below the 2000-location ceiling (apply a tighter limit—100 stops—to stay safe).
   - Serialize JSON, fire POST requests, await responses.
4. **Response processing**:
   - Map TravelTime `results` back to stop IDs and compute derived metrics (minutes, categories, buckets for legend).
   - Handle missing `travel_time` entries (mark as unreachable or > threshold).
5. **Storage/caching**:
   - Cache responses in browser session storage (and optionally persistent storage) to avoid replays during a session.
6. **Integration with UI**:
   - Update map layers to color Scarborough stops by travel time, highlight the destination, and expose a legend/status overlay.
   - Provide legend breakpoints (e.g., 0–15, 15–30, …, 75–90 minutes) consistent with the color ramp.
7. **Testing & Monitoring**:
   - Unit tests around payload construction and response parsing.
   - Integration test hitting TravelTime once credentials available (guarded to avoid excessive quota use).
   - Logging/alerting for rate-limit hits and other API errors.

## Routes API Usage
- A user-initiated click on a stop triggers `POST https://api.traveltimeapp.com/v4/routes` with the stop as origin and Kennedy Station as the `arrival_location_id`, targeting the same arrival window (2025-11-03T08:00:00-05:00) and `public_transport` mode.
- Responses are cached per-stop in `sessionStorage` to avoid re-fetching identical itineraries during a session.
- Each route’s `parts` list is normalised into GeoJSON features and rendered as coloured line segments (falling back to a direct origin→destination line if TravelTime omits geometry), while metadata (travel time, distance, departure/arrival) is surfaced in the info panel.

## Tooling & Libraries
- Server-side or client-side fetch layer (Node `fetch`, Axios, or TravelTime official SDK). Current implementation uses browser `fetch` with batching and retry logic.
- Date/time handling via `Intl.DateTimeFormat` or a helper library if more advanced scheduling is needed.
- Optional queue worker if we need to refresh matrices on a schedule or for multiple destinations.

## Next Steps
- Confirm acceptable daily quota usage and whether responses can be persisted server-side.
- Decide if we need additional `properties` (e.g., fares) that might influence visualization.
- Add automated tests or mocked responses so the CI build can run without counting against the quota.
