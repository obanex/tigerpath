// Towson University buildings.
//
// Coordinates are building centroids from OpenStreetMap footprints (many traced
// from TU engineering drawings), fetched 2026-11-11 by the "Fetch OpenStreetMap
// data" workflow. Fine-tune any pin with the editor (open the app with ?edit=1).
//
// Fields
//   id        building code used on schedules (e.g. "LA" in "LA 4310")
//   name      official name
//   aliases   extra search terms (old names, nicknames, abbreviations)
//   category  academic | residence | dining | athletics | services | parking | landmark
//   lat/lng   location
//   depts     departments / offices inside
//   amenities searchable tags (printing, study, food, accessible-entrance, ...)
//   food      named food spots inside (from OpenStreetMap)
//   note      status shown on the building card (renovations, closures)
//   hours     optional weekly hours, see src/lib/hours.js (verified:false = placeholder)

export const BUILDINGS = [
  // ---------- Academic ----------
  { id: 'AD', name: 'Administration Building', category: 'academic', lat: 39.38949, lng: -76.60628,
    depts: ["President's Office", 'Provost', 'Human Resources'], amenities: ['accessible-entrance'] },
  { id: 'ST', name: 'Stephens Hall', category: 'academic', lat: 39.39249, lng: -76.60603,
    aliases: ['Old Main', 'CBE', 'business school'],
    depts: ['College of Business & Economics', 'Stephens Hall Theatre'], amenities: ['study', 'printing'] },
  { id: 'VB', name: 'Van Bokkelen Hall', category: 'academic', lat: 39.39270, lng: -76.60700,
    depts: ['Communication Sciences & Disorders'], amenities: [] },
  { id: 'LH', name: 'Lecture Hall', category: 'academic', lat: 39.39403, lng: -76.60847, amenities: [] },
  { id: 'MC', name: 'Media Center', category: 'academic', lat: 39.39334, lng: -76.60707,
    aliases: ['mass comm', 'WMJF', 'TV studio'],
    depts: ['Mass Communication', 'Electronic Media & Film'], amenities: ['printing'] },
  { id: 'CA', name: 'Center for the Arts', category: 'academic', lat: 39.39202, lng: -76.61264,
    aliases: ['fine arts', 'CFA', 'theatre', 'music', 'art gallery'],
    depts: ['College of Fine Arts & Communication', 'Music', 'Theatre Arts', 'Dance', 'Art + Design'],
    amenities: ['gallery', 'accessible-entrance'] },
  { id: 'LA', name: 'Liberal Arts Building', category: 'academic', lat: 39.39505, lng: -76.60899,
    aliases: ['CLA', 'liberal arts', 'College of Liberal Arts Building'],
    depts: ['College of Liberal Arts', 'History', 'English', 'Philosophy'],
    amenities: ['study', 'printing', 'accessible-entrance'] },
  { id: 'HH', name: 'Hawkins Hall', category: 'academic', lat: 39.39412, lng: -76.60945,
    aliases: ['COE', 'education'], depts: ['College of Education'], amenities: [] },
  { id: 'LI', name: 'Linthicum Hall', category: 'academic', lat: 39.39438, lng: -76.60796, amenities: [] },
  { id: 'PY', name: 'Psychology Building', category: 'academic', lat: 39.39446, lng: -76.60899,
    aliases: ['psych'], depts: ['Psychology'], amenities: [] },
  { id: 'SM', name: 'Smith Hall', category: 'academic', lat: 39.39325, lng: -76.60879,
    depts: ['Fisher College of Science & Mathematics'], amenities: [],
    note: 'Under renovation (TU scheduled reopening for 2026) — check before you go.' },
  { id: 'SC', name: 'Science Complex', category: 'academic', lat: 39.39149, lng: -76.60603,
    aliases: ['new science', 'planetarium', 'chemistry', 'biology', 'physics'],
    depts: ['Biological Sciences', 'Chemistry', 'Physics, Astronomy & Geosciences', 'Planetarium'],
    amenities: ['study', 'accessible-entrance'] },
  { id: 'HP', name: 'Health Professions Building', category: 'academic', lat: 39.39498, lng: -76.60647,
    aliases: ['CHP', 'nursing', 'Health Professions'],
    depts: ['College of Health Professions', 'Nursing', 'Occupational Therapy'], amenities: ['accessible-entrance'] },
  { id: 'YR', name: '7800 York Road', category: 'academic', lat: 39.39075, lng: -76.60603,
    aliases: ['York Road building', 'computer science', 'CS', 'cosc'],
    depts: ['Computer & Information Sciences', 'Mathematics'], amenities: ['printing'] },
  { id: 'CK', name: 'Albert S. Cook Library', category: 'academic', lat: 39.39361, lng: -76.60665,
    aliases: ['library', 'Cook', 'LIB', 'Starbucks'], depts: ['Library', 'Writing Center', 'Special Collections'],
    amenities: ['study', 'printing', 'computers', 'food', 'accessible-entrance', 'restroom'], food: ['Starbucks'],
    hours: { verified: false, mon: '07:30-24:00', tue: '07:30-24:00', wed: '07:30-24:00', thu: '07:30-24:00',
      fri: '07:30-18:00', sat: '10:00-18:00', sun: '12:00-24:00' } },

  // ---------- Student services ----------
  { id: 'UU', name: 'University Union', category: 'services', lat: 39.39366, lng: -76.61116,
    aliases: ['Union', 'student union', 'bookstore', 'University Store', 'UStore', 'Chick-fil-A', 'Paws', 'Food Market', 'Dunkin'],
    depts: ['Student Activities', 'University Store', 'OneCard Office', 'Center for Student Diversity'],
    amenities: ['food', 'printing', 'study', 'atm', 'restroom', 'accessible-entrance'],
    food: ['Chick-fil-A', "Dunkin'", 'Food Market', 'Paws Cafe'],
    hours: { verified: false, mon: '07:00-23:00', tue: '07:00-23:00', wed: '07:00-23:00', thu: '07:00-23:00',
      fri: '07:00-23:00', sat: '10:00-23:00', sun: '10:00-23:00' } },
  { id: 'ES', name: 'Enrollment Services Center', category: 'services', lat: 39.39481, lng: -76.61631,
    aliases: ['Enrollment Services', 'admissions', 'registrar', 'financial aid', 'bursar', 'ESC'],
    depts: ['Admissions', 'Registrar', 'Financial Aid', "Bursar's Office"], amenities: ['accessible-entrance'],
    hours: { verified: false, mon: '08:30-16:30', tue: '08:30-16:30', wed: '08:30-16:30', thu: '08:30-16:30', fri: '08:30-16:30' } },
  { id: 'WW', name: 'Health & Counseling Centers at Ward & West', category: 'services', lat: 39.39594, lng: -76.60704,
    aliases: ['Ward & West', 'Ward and West', 'health center', 'counseling', 'doctor', 'clinic', 'Dowell'],
    depts: ['Health Center', 'Counseling Center'], amenities: ['accessible-entrance'] },
  { id: 'GS', name: 'General Services', category: 'services', lat: 39.39639, lng: -76.61366,
    aliases: ['facilities'], depts: ['Facilities Management'], amenities: [] },
  { id: 'TM', name: '10 West Burke Avenue', category: 'services', lat: 39.39597, lng: -76.60483,
    aliases: ['West Burke'], amenities: [] },

  // ---------- Athletics & recreation ----------
  { id: 'BU', name: 'Burdick Hall', category: 'athletics', lat: 39.39515, lng: -76.61214,
    aliases: ['gym', 'campus rec', 'recreation center', 'fitness'],
    depts: ['Campus Recreation', 'Kinesiology'], amenities: ['gym', 'restroom', 'accessible-entrance'] },
  { id: 'TC', name: 'Towson Center', category: 'athletics', lat: 39.38653, lng: -76.61636,
    depts: ['Athletics Administration'], amenities: [] },
  { id: 'AR', name: 'SECU Arena', category: 'athletics', lat: 39.38733, lng: -76.61705,
    aliases: ['arena', 'basketball'], amenities: ['accessible-entrance'] },
  { id: 'US', name: 'Johnny Unitas Stadium', category: 'athletics', lat: 39.38854, lng: -76.61600,
    aliases: ['stadium', 'football', 'Unitas', 'Minnegan Field'], amenities: [] },
  { id: 'FH', name: 'Field House', category: 'athletics', lat: 39.38827, lng: -76.61718, amenities: [] },
  { id: 'SP', name: 'Schuerholz Park', category: 'athletics', lat: 39.39464, lng: -76.61323,
    aliases: ['baseball'], amenities: [] },

  // ---------- Residence halls ----------
  { id: 'RT', name: 'Residence Tower', category: 'residence', lat: 39.39624, lng: -76.60765, amenities: ['laundry'] },
  { id: 'NH', name: 'Newell Hall', category: 'residence', lat: 39.39393, lng: -76.60553, amenities: ['laundry'] },
  { id: 'RH', name: 'Richmond Hall', category: 'residence', lat: 39.39338, lng: -76.60573, amenities: ['laundry'] },
  { id: 'PH', name: 'Prettyman Hall', category: 'residence', lat: 39.39487, lng: -76.60528, amenities: ['laundry'] },
  { id: 'SH', name: 'Scarborough Hall', category: 'residence', lat: 39.39475, lng: -76.60458, amenities: ['laundry'] },
  { id: 'GT', name: 'Glen Towers', category: 'residence', lat: 39.39221, lng: -76.61012,
    aliases: ['the Glen', 'Glen complex', 'Tower A', 'Tower B', 'Tower C', 'Tower D'], amenities: ['laundry'] },
  { id: 'MI', name: 'Millennium Hall', category: 'residence', lat: 39.39388, lng: -76.61650, amenities: ['laundry'] },
  { id: 'BA', name: 'Barton House', category: 'residence', lat: 39.39491, lng: -76.61747,
    aliases: ['West Village'], amenities: ['laundry'] },
  { id: 'DO', name: 'Douglass House', category: 'residence', lat: 39.39502, lng: -76.61833,
    aliases: ['West Village'], amenities: ['laundry'] },
  { id: 'TU', name: 'Tubman House', category: 'residence', lat: 39.39459, lng: -76.61845,
    aliases: ['West Village'], amenities: ['laundry'] },
  { id: 'MA', name: 'Marshall Hall', category: 'residence', lat: 39.39516, lng: -76.61948,
    aliases: ['West Village'], amenities: ['laundry'] },
  { id: 'WV1', name: 'West Village 1', category: 'residence', lat: 39.39445, lng: -76.61750,
    aliases: ['Paca House', 'West Village'], amenities: ['laundry'] },
  { id: 'WV2', name: 'West Village 2', category: 'residence', lat: 39.39468, lng: -76.61993,
    aliases: ['Carroll Hall', 'West Village'], amenities: ['laundry'] },
  { id: 'TRA', name: 'Towson Run Apartments', category: 'residence', lat: 39.39441, lng: -76.61924,
    aliases: ['TRA', 'apartments'], amenities: ['laundry'] },

  // ---------- Dining ----------
  { id: 'NDH', name: 'Newell Dining Hall', category: 'dining', lat: 39.39411, lng: -76.60596,
    aliases: ['Newell', 'dining hall', 'Newell Den'], amenities: ['food', 'meal-swipe'], food: ['Newell Den'],
    hours: { verified: false, mon: '07:00-21:00', tue: '07:00-21:00', wed: '07:00-21:00', thu: '07:00-21:00',
      fri: '07:00-20:00', sat: '10:00-20:00', sun: '10:00-21:00' } },
  { id: 'GDH', name: 'Glen Dining Hall', category: 'dining', lat: 39.39231, lng: -76.60988,
    aliases: ['Glen dining'], amenities: ['food', 'meal-swipe'],
    hours: { verified: false, mon: '07:00-24:00', tue: '07:00-24:00', wed: '07:00-24:00', thu: '07:00-24:00',
      fri: '07:00-21:00', sat: '10:00-21:00', sun: '10:00-24:00' } },
  { id: 'WVC', name: 'West Village Commons', category: 'dining', lat: 39.39384, lng: -76.61814,
    aliases: ['WV Commons', 'commons', 'Panda Express', 'Einstein Bros'], amenities: ['food', 'meal-swipe', 'study'],
    food: ['Panda Express', 'Einstein Bros. Bagels'],
    hours: { verified: false, mon: '07:00-22:00', tue: '07:00-22:00', wed: '07:00-22:00', thu: '07:00-22:00',
      fri: '07:00-20:00', sat: '10:00-20:00', sun: '10:00-22:00' } },

  // ---------- Landmarks ----------
  // Freedom Square sits beneath the Lecture Hall (towson.edu/campus/landmarks/freedomsquare.html).
  { id: 'FS', name: 'Freedom Square', category: 'landmark', lat: 39.39376, lng: -76.60832,
    aliases: ['quad', 'plaza'], amenities: [] },
  { id: 'GA', name: 'Glen Arboretum', category: 'landmark', lat: 39.39264, lng: -76.60881,
    aliases: ['arboretum', 'garden'], amenities: [] },
];

export const CATEGORIES = {
  academic:  { label: 'Academic',   color: '#2563eb', icon: '🎓' },
  services:  { label: 'Services',   color: '#7c3aed', icon: '🏛️' },
  dining:    { label: 'Dining',     color: '#ea580c', icon: '🍽️' },
  residence: { label: 'Housing',    color: '#059669', icon: '🏠' },
  athletics: { label: 'Athletics',  color: '#dc2626', icon: '🏟️' },
  parking:   { label: 'Parking',    color: '#475569', icon: '🅿️' },
  landmark:  { label: 'Landmarks',  color: '#ca8a04', icon: '📍' },
};

export const AMENITY_LABELS = {
  study: 'Study space', printing: 'Printing', computers: 'Computer lab', food: 'Food',
  'accessible-entrance': 'Accessible entrance', restroom: 'Restrooms', atm: 'ATM', gym: 'Gym',
  laundry: 'Laundry', 'meal-swipe': 'Meal swipes', gallery: 'Gallery',
};
