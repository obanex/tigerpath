// Accessibility features that OpenStreetMap doesn't have yet for Towson:
// ramps, elevators, accessible entrances and automatic doors.
//
// Add them with the editor (open the app with ?edit=1 → "Accessibility" tools),
// ideally with Accessibility & Disability Services or Facilities, then download
// accessibility.js and replace this file. Better still, also add them to
// OpenStreetMap so every map app benefits.
//
// Each feature:
//   { type: 'entrance' | 'ramp' | 'elevator' | 'automatic-door',
//     lat, lng,
//     building: 'LA',            // building code, for entrances/elevators/doors
//     note: 'North side, off Towson Way',
//     verified: '2026-11-11' }   // date someone checked it in person
//
// Accessible routing sends ♿ users to a building's accessible entrance when one
// is listed here, instead of the building's center.

export const ACCESS_FEATURES = [];

export const OFFICIAL_ACCESS_MAP_URL = 'https://www.towson.edu/maps/documents/campus-map_accessibility.pdf';

export const ACCESS_TYPES = {
  entrance: { label: 'Accessible entrance', icon: '♿' },
  ramp: { label: 'Ramp', icon: '↗' },
  elevator: { label: 'Elevator', icon: '⇅' },
  'automatic-door': { label: 'Automatic door', icon: '⇆' },
};
