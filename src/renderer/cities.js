'use strict';
/*
 * The curated city list, shared by the settings picker and the config migration in the
 * main process. Loaded as a plain script in the renderer and required in main, the same
 * dual pattern timelogic.js uses.
 */

// [IANA zone, city, country]. Several cities share one zone (Seoul / Daegu / Busan), so
// preset <option> values are indexes into this array rather than zone ids.
const CITIES = [
  ['Asia/Seoul', 'Seoul', 'South Korea'],
  ['Asia/Seoul', 'Daegu', 'South Korea'],
  ['Asia/Seoul', 'Busan', 'South Korea'],
  ['Asia/Tokyo', 'Tokyo', 'Japan'],
  ['Asia/Tokyo', 'Osaka', 'Japan'],
  ['Asia/Shanghai', 'Beijing', 'China'],
  ['Asia/Shanghai', 'Shanghai', 'China'],
  ['Asia/Hong_Kong', 'Hong Kong', 'Hong Kong'],
  ['Asia/Taipei', 'Taipei', 'Taiwan'],
  ['Asia/Singapore', 'Singapore', 'Singapore'],
  ['Asia/Bangkok', 'Bangkok', 'Thailand'],
  ['Asia/Ho_Chi_Minh', 'Ho Chi Minh City', 'Vietnam'],
  ['Asia/Jakarta', 'Jakarta', 'Indonesia'],
  ['Asia/Manila', 'Manila', 'Philippines'],
  ['Asia/Kolkata', 'Delhi', 'India'],
  ['Asia/Kolkata', 'Mumbai', 'India'],
  ['Asia/Kathmandu', 'Kathmandu', 'Nepal'],
  ['Asia/Dubai', 'Dubai', 'United Arab Emirates'],
  ['Asia/Tehran', 'Tehran', 'Iran'],
  ['Asia/Jerusalem', 'Jerusalem', 'Israel'],
  ['Europe/Istanbul', 'Istanbul', 'Turkey'],
  ['Europe/Moscow', 'Moscow', 'Russia'],
  ['Europe/London', 'London', 'United Kingdom'],
  ['Europe/Dublin', 'Dublin', 'Ireland'],
  ['Europe/Lisbon', 'Lisbon', 'Portugal'],
  ['Europe/Madrid', 'Madrid', 'Spain'],
  ['Europe/Madrid', 'Barcelona', 'Spain'],
  ['Europe/Paris', 'Paris', 'France'],
  ['Europe/Brussels', 'Brussels', 'Belgium'],
  ['Europe/Amsterdam', 'Amsterdam', 'Netherlands'],
  ['Europe/Berlin', 'Berlin', 'Germany'],
  ['Europe/Berlin', 'Munich', 'Germany'],
  ['Europe/Zurich', 'Zurich', 'Switzerland'],
  ['Europe/Rome', 'Rome', 'Italy'],
  ['Europe/Vienna', 'Vienna', 'Austria'],
  ['Europe/Prague', 'Prague', 'Czechia'],
  ['Europe/Warsaw', 'Warsaw', 'Poland'],
  ['Europe/Stockholm', 'Stockholm', 'Sweden'],
  ['Europe/Oslo', 'Oslo', 'Norway'],
  ['Europe/Copenhagen', 'Copenhagen', 'Denmark'],
  ['Europe/Helsinki', 'Helsinki', 'Finland'],
  ['Europe/Athens', 'Athens', 'Greece'],
  ['Europe/Kyiv', 'Kyiv', 'Ukraine'],
  ['Africa/Cairo', 'Cairo', 'Egypt'],
  ['Africa/Lagos', 'Lagos', 'Nigeria'],
  ['Africa/Nairobi', 'Nairobi', 'Kenya'],
  ['Africa/Johannesburg', 'Johannesburg', 'South Africa'],
  ['America/New_York', 'New York', 'United States'],
  ['America/Chicago', 'Chicago', 'United States'],
  ['America/Denver', 'Denver', 'United States'],
  ['America/Phoenix', 'Phoenix', 'United States'],
  ['America/Los_Angeles', 'Los Angeles', 'United States'],
  ['America/Los_Angeles', 'San Francisco', 'United States'],
  ['America/Los_Angeles', 'Seattle', 'United States'],
  ['America/Anchorage', 'Anchorage', 'United States'],
  ['Pacific/Honolulu', 'Honolulu', 'United States'],
  ['America/Toronto', 'Toronto', 'Canada'],
  ['America/Toronto', 'Montreal', 'Canada'],
  ['America/Vancouver', 'Vancouver', 'Canada'],
  ['America/Mexico_City', 'Mexico City', 'Mexico'],
  ['America/Bogota', 'Bogota', 'Colombia'],
  ['America/Lima', 'Lima', 'Peru'],
  ['America/Santiago', 'Santiago', 'Chile'],
  ['America/Sao_Paulo', 'Sao Paulo', 'Brazil'],
  ['America/Argentina/Buenos_Aires', 'Buenos Aires', 'Argentina'],
  ['Australia/Perth', 'Perth', 'Australia'],
  ['Australia/Brisbane', 'Brisbane', 'Australia'],
  ['Australia/Adelaide', 'Adelaide', 'Australia'],
  ['Australia/Sydney', 'Sydney', 'Australia'],
  ['Australia/Melbourne', 'Melbourne', 'Australia'],
  ['Pacific/Auckland', 'Auckland', 'New Zealand'],
  ['UTC', 'UTC', ''], // no country, so it shows as just UTC
];

/**
 * How a place is written wherever the user sees it: the widget subtitle and the picker
 * option use this exact string, so the two always read the same.
 */
function cityDisplay(zone, city, country) {
  return country ? `${country}/${city}` : city;
}

/** The display string for a zone that is not in the curated list. */
function zoneDisplay(zone) {
  const parts = String(zone).split("/");
  const city = (parts.pop() || zone).replace(/_/g, " ");
  return parts.length ? `${parts[0]}/${city}` : city;
}

/** Country for a zone, from the curated table. Null for zones it does not cover. */
function countryOfZone(zone) {
  const entry = CITIES.find(([z]) => z === zone);
  return entry ? entry[2] : null;
}

/** City segment of a zone id, e.g. America/Argentina/Buenos_Aires -> Buenos Aires. */
function zoneCity(zone) {
  return (String(zone).split("/").pop() || zone).replace(/_/g, " ");
}

/**
 * The subtitle a widget draws, and the text the picker lists: Country/Name. `name` is
 * whatever the user typed, so renaming swaps only the last segment. Zones the curated
 * table does not cover have no country, and show the name alone.
 */
function subtitleFor(zone, name) {
  const city = (name || "").trim() || zoneCity(zone);
  const country = countryOfZone(zone);
  return country ? `${country}/${city}` : city;
}

if (typeof module !== "undefined") {
  module.exports = { CITIES, cityDisplay, zoneDisplay, countryOfZone, zoneCity, subtitleFor };
}
