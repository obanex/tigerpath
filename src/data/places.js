// Non-building map features. Like buildings.js these are APPROXIMATE seed
// values. Safety features (emergency phones, AEDs) are deliberately NOT
// invented here: they come only from verified sources (OpenStreetMap import or
// the university's own data), so the map never shows a phone that isn't there.

export const PARKING = [
  { id: 'P-UG', name: 'Union Garage', lat: 39.3925, lng: -76.6066, kind: 'garage',
    permits: ['commuter', 'faculty-staff', 'visitor'], ev: true, accessible: true,
    note: 'Parking & Transportation Services office on the ground level.' },
  { id: 'P-WVG', name: 'West Village Garage', lat: 39.3935, lng: -76.6190, kind: 'garage',
    permits: ['resident', 'commuter', 'visitor'], ev: false, accessible: true },
  { id: 'P-TTG', name: 'Towsontown Garage', lat: 39.3962, lng: -76.6090, kind: 'garage',
    permits: ['commuter', 'faculty-staff'], ev: false, accessible: true },
  { id: 'P-GG', name: 'Glen Garage', lat: 39.3970, lng: -76.6124, kind: 'garage',
    permits: ['resident', 'commuter'], ev: false, accessible: true },
];

export const PERMIT_LABELS = {
  commuter: 'Commuter', resident: 'Resident', 'faculty-staff': 'Faculty / Staff', visitor: 'Visitor (pay)',
};

// Shuttle data is a SAMPLE showing the data shape. Replace with the
// university's GTFS feed or TUTigerRide data before launch.
export const SHUTTLES = [
  { id: 'sample-loop', name: 'Campus Loop (sample)', color: '#ffbb00', sample: true,
    stops: [
      { name: 'University Union', lat: 39.3928, lng: -76.6083 },
      { name: 'Glen Towers', lat: 39.3961, lng: -76.6106 },
      { name: 'Science Complex', lat: 39.3958, lng: -76.6131 },
      { name: 'West Village', lat: 39.3925, lng: -76.6178 },
      { name: 'SECU Arena', lat: 39.3897, lng: -76.6152 },
      { name: 'Administration Bldg', lat: 39.3895, lng: -76.6090 },
    ] },
];

export const LIVE_SHUTTLE_URL = 'https://www.towson.edu/parking/shuttle/';

// Construction / closures: dated so they expire automatically.
export const CLOSURES = [
  // { id, name, until: '2027-05-01', polygon: [[lat,lng],...], blocksPaths: true }
];

// Emergency phones / AEDs: filled from OpenStreetMap import or university data.
export const SAFETY = [];
