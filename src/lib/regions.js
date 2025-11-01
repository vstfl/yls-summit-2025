const baseRegions = [
  { id: 'all', label: 'Full Toronto', areaName: null, disabled: false },
  { id: 'scarborough', label: 'Scarborough', areaName: 'SCARBOROUGH', disabled: false },
  { id: 'etobicoke', label: 'Etobicoke', areaName: 'ETOBICOKE', disabled: true },
  { id: 'north-york', label: 'North York', areaName: 'NORTH YORK', disabled: true },
  { id: 'east-york', label: 'East York', areaName: 'EAST YORK', disabled: true },
  { id: 'toronto', label: 'Old Toronto', areaName: 'TORONTO', disabled: true },
  { id: 'york', label: 'York', areaName: 'YORK', disabled: true },
]

const SATURATION = 62
const LIGHTNESS = 60
const MIN_HUE_DISTANCE = 38

const stringToHue = (input) => {
  if (!input) return 0
  let hash = 0
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 37 + input.charCodeAt(index)) % 360
  }
  return hash
}

const hslToHex = (h, s, l) => {
  const saturation = s / 100
  const lightness = l / 100

  const chroma = saturation * Math.min(lightness, 1 - lightness)
  const k = (n) => (n + h / 30) % 12
  const convert = (n) =>
    lightness - chroma * Math.max(Math.min(k(n) - 3, 9 - k(n), 1), -1)

  const channelToHex = (value) => {
    const channel = Math.round(value * 255)
    return channel.toString(16).padStart(2, '0')
  }

  const r = channelToHex(convert(0))
  const g = channelToHex(convert(8))
  const b = channelToHex(convert(4))

  return `#${r}${g}${b}`
}

const usedHues = []

const distanceBetweenHues = (a, b) => {
  const diff = Math.abs(a - b) % 360
  return Math.min(diff, 360 - diff)
}

const nextDistinctHue = (seed) => {
  let hue = seed
  for (let attempts = 0; attempts < 12; attempts += 1) {
    const isDistinct = usedHues.every((usedHue) => distanceBetweenHues(hue, usedHue) >= MIN_HUE_DISTANCE)
    if (isDistinct) break
    hue = (hue + MIN_HUE_DISTANCE) % 360
  }
  usedHues.push(hue)
  return hue
}

const computeRegionColor = (areaName) => {
  const seedHue = stringToHue(areaName)
  const hue = nextDistinctHue(seedHue)
  return hslToHex(hue, SATURATION, LIGHTNESS)
}

export const regionOptions = baseRegions

export const regionById = regionOptions.reduce((accumulator, region) => {
  accumulator[region.id] = region
  return accumulator
}, {})

export const areaNameByRegionId = regionOptions.reduce((accumulator, region) => {
  if (region.areaName) {
    accumulator[region.id] = region.areaName
  }
  return accumulator
}, {})

export const regionColorMap = regionOptions.reduce((accumulator, region) => {
  if (region.areaName) {
    accumulator[region.areaName] = computeRegionColor(region.areaName)
  }
  return accumulator
}, {})

export const torontoDefaultColor = '#94a3b8'
