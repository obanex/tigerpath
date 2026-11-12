// Non-building map features. These are FALLBACKS: when public/data/tu-campus.json
// (TU's official campus map data, see scripts/fetch-tu.mjs) is present, the app
// uses TU's parking areas and shuttle lines instead. Safety features (emergency phones, AEDs) are deliberately NOT
// invented here: they come only from verified sources (OpenStreetMap import or
// the university's own data), so the map never shows a phone that isn't there.

export const PARKING = [
  { id: 'P-UG', name: 'Union Garage', lat: 39.39303, lng: -76.61256, kind: 'garage',
    permits: ['core', 'faculty-staff', 'visitor'], ev: true, accessible: true,
    note: 'Parking & Transportation Services office on the ground level.' },
  { id: 'P-WVG', name: 'West Village Garage', lat: 39.39505, lng: -76.62070, kind: 'garage',
    permits: ['resident', 'overflow', 'visitor'], ev: false, accessible: true },
  { id: 'P-TTG', name: 'Towsontown Garage', lat: 39.39606, lng: -76.60930, kind: 'garage',
    permits: ['core', 'faculty-staff'], ev: false, accessible: true },
  { id: 'P-GG', name: 'Glen Garage', lat: 39.39090, lng: -76.60694, kind: 'garage',
    permits: ['resident', 'core'], ev: false, accessible: true },
];

// TU's permit types (letters on TU's map: C, O, R, F).
export const PERMIT_LABELS = {
  core: 'Core', overflow: 'Overflow', resident: 'Resident', 'faculty-staff': 'Faculty / Staff', visitor: 'Visitor (pay)',
};

// Shuttle data is a SAMPLE showing the data shape, used only without TU's data.
export const SHUTTLES = [
  { id: 'sample-loop', name: 'Campus Loop (sample)', color: '#ffbb00', sample: true,
    stops: [
      { name: 'University Union', lat: 39.39330, lng: -76.61160 },
      { name: 'Towsontown Garage', lat: 39.39580, lng: -76.60930 },
      { name: 'Residence Tower', lat: 39.39600, lng: -76.60740 },
      { name: 'Stephens Hall', lat: 39.39220, lng: -76.60640 },
      { name: 'Glen Towers', lat: 39.39200, lng: -76.61040 },
      { name: 'SECU Arena', lat: 39.38770, lng: -76.61660 },
      { name: 'West Village Commons', lat: 39.39360, lng: -76.61790 },
    ] },
];

export const LIVE_SHUTTLE_URL = 'https://www.towson.edu/parking/shuttle/';

// Construction / closures: dated so they expire automatically.
export const CLOSURES = [
  // { id, name, until: '2027-05-01', polygon: [[lat,lng],...], blocksPaths: true }
];

// Emergency phones / AEDs: filled from OpenStreetMap import or university data.
export const SAFETY = [];
