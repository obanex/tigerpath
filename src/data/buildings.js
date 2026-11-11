// Towson University buildings.
//
// IMPORTANT: coordinates are APPROXIMATE seed values. Correct them with the
// built-in editor (open the app with ?edit=1, drag pins, export JSON) or by
// running `npm run fetch-osm`, which pulls real footprints from OpenStreetMap.
//
// Fields
//   id        building code used on schedules (e.g. "LA" in "LA 4310")
//   name      official name
//   aliases   extra search terms (old names, nicknames, abbreviations)
//   category  academic | residence | dining | athletics | services | parking | landmark
//   lat/lng   main entrance (approximate)
//   depts     departments / offices inside
//   amenities searchable tags (printing, study, food, accessible-entrance, ...)
//   hours     optional weekly hours, see src/lib/hours.js (verified:false = placeholder)

export const BUILDINGS = [
  // ---------- Academic ----------
  { id: 'AD', name: 'Administration Building', category: 'academic', lat: 39.38973, lng: -76.60838,
    depts: ["President's Office", 'Provost', 'Human Resources'], amenities: ['accessible-entrance'] },
  { id: 'ST', name: 'Stephens Hall', category: 'academic', lat: 39.3922, lng: -76.6087,
    aliases: ['Old Main', 'CBE', 'business school'],
    depts: ['College of Business & Economics', 'Stephens Hall Theatre'], amenities: ['study', 'printing'] },
  { id: 'VB', name: 'Van Bokkelen Hall', category: 'academic', lat: 39.3915, lng: -76.6098,
    depts: ['Communication Sciences & Disorders'], amenities: [] },
  { id: 'LH', name: 'Lecture Hall', category: 'academic', lat: 39.3911, lng: -76.6088, amenities: [] },
  { id: 'MC', name: 'Media Center', category: 'academic', lat: 39.3921, lng: -76.6110,
    aliases: ['mass comm', 'WMJF', 'TV studio'],
    depts: ['Mass Communication', 'Electronic Media & Film'], amenities: ['printing'] },
  { id: 'CA', name: 'Center for the Arts', category: 'academic', lat: 39.3926, lng: -76.6127,
    aliases: ['fine arts', 'CFA', 'theatre', 'music', 'art gallery'],
    depts: ['College of Fine Arts & Communication', 'Music', 'Theatre Arts', 'Dance', 'Art + Design'],
    amenities: ['gallery', 'accessible-entrance'] },
  { id: 'LA', name: 'Liberal Arts Building', category: 'academic', lat: 39.3934, lng: -76.6106,
    aliases: ['CLA', 'liberal arts'], depts: ['College of Liberal Arts', 'History', 'English', 'Philosophy'],
    amenities: ['study', 'printing', 'accessible-entrance'] },
  { id: 'HH', name: 'Hawkins Hall', category: 'academic', lat: 39.3941, lng: -76.6094,
    aliases: ['COE', 'education'], depts: ['College of Education'], amenities: ['food'] },
  { id: 'LI', name: 'Linthicum Hall', category: 'academic', lat: 39.3940, lng: -76.6083, amenities: [] },
  { id: 'PY', name: 'Psychology Building', category: 'academic', lat: 39.3947, lng: -76.6101,
    aliases: ['psych'], depts: ['Psychology'], amenities: [] },
  { id: 'SM', name: 'Smith Hall', category: 'academic', lat: 39.3951, lng: -76.6109,
    depts: ['Fisher College of Science & Mathematics'], amenities: [] },
  { id: 'SC', name: 'Science Complex', category: 'academic', lat: 39.3956, lng: -76.6126,
    aliases: ['new science', 'planetarium', 'chemistry', 'biology', 'physics'],
    depts: ['Biological Sciences', 'Chemistry', 'Physics, Astronomy & Geosciences', 'Planetarium'],
    amenities: ['study', 'accessible-entrance', 'food'] },
  { id: 'HP', name: 'Health Professions Building', category: 'academic', lat: 39.3946, lng: -76.6140,
    aliases: ['CHP', 'nursing', 'health professions'],
    depts: ['College of Health Professions', 'Nursing', 'Occupational Therapy'], amenities: ['accessible-entrance'] },
  { id: 'YR', name: '7800 York Road', category: 'academic', lat: 39.3910, lng: -76.6061,
    aliases: ['York Road building', 'computer science', 'CS', 'cosc'],
    depts: ['Computer & Information Sciences', 'Mathematics'], amenities: ['printing'] },
  { id: 'CK', name: 'Albert S. Cook Library', category: 'academic', lat: 39.39368, lng: -76.60670,
    aliases: ['library', 'Cook', 'LIB'], depts: ['Library', 'Writing Center', 'Special Collections'],
    amenities: ['study', 'printing', 'computers', 'food', 'accessible-entrance', 'restroom'],
    hours: { verified: false, mon: '07:30-24:00', tue: '07:30-24:00', wed: '07:30-24:00', thu: '07:30-24:00',
      fri: '07:30-18:00', sat: '10:00-18:00', sun: '12:00-24:00' } },

  // ---------- Student services ----------
  { id: 'UU', name: 'University Union', category: 'services', lat: 39.3930, lng: -76.6079,
    aliases: ['Union', 'student union', 'bookstore', 'University Store', 'UStore'],
    depts: ['Student Activities', 'University Store', 'OneCard Office', 'Center for Student Diversity'],
    amenities: ['food', 'printing', 'study', 'atm', 'restroom', 'accessible-entrance'],
    hours: { verified: false, mon: '07:00-23:00', tue: '07:00-23:00', wed: '07:00-23:00', thu: '07:00-23:00',
      fri: '07:00-23:00', sat: '10:00-23:00', sun: '10:00-23:00' } },
  { id: 'ES', name: 'Enrollment Services Center', category: 'services', lat: 39.3955, lng: -76.6086,
    aliases: ['admissions', 'registrar', 'financial aid', 'bursar', 'ESC'],
    depts: ['Admissions', 'Registrar', 'Financial Aid', "Bursar's Office"], amenities: ['accessible-entrance'],
    hours: { verified: false, mon: '08:30-16:30', tue: '08:30-16:30', wed: '08:30-16:30', thu: '08:30-16:30', fri: '08:30-16:30' } },
  { id: 'DH', name: 'Dowell Health Center', category: 'services', lat: 39.3900, lng: -76.6112,
    aliases: ['health center', 'counseling', 'doctor', 'clinic'],
    depts: ['Health Center', 'Counseling Center'], amenities: ['accessible-entrance'] },
  { id: 'GS', name: 'General Services', category: 'services', lat: 39.3965, lng: -76.6068,
    aliases: ['facilities'], depts: ['Facilities Management'], amenities: [] },

  // ---------- Athletics & recreation ----------
  { id: 'BU', name: 'Burdick Hall', category: 'athletics', lat: 39.3905, lng: -76.6143,
    aliases: ['gym', 'campus rec', 'recreation center', 'fitness'],
    depts: ['Campus Recreation', 'Kinesiology'], amenities: ['gym', 'restroom', 'accessible-entrance'] },
  { id: 'TC', name: 'Towson Center', category: 'athletics', lat: 39.3911, lng: -76.6156,
    depts: ['Athletics Administration'], amenities: [] },
  { id: 'AR', name: 'SECU Arena', category: 'athletics', lat: 39.3899, lng: -76.6160,
    aliases: ['arena', 'basketball'], amenities: ['accessible-entrance'] },
  { id: 'US', name: 'Johnny Unitas Stadium', category: 'athletics', lat: 39.3884, lng: -76.6150,
    aliases: ['stadium', 'football', 'Unitas'], amenities: [] },

  // ---------- Residence halls ----------
  { id: 'RT', name: 'Residence Tower', category: 'residence', lat: 39.3948, lng: -76.6071, amenities: ['laundry'] },
  { id: 'NH', name: 'Newell Hall', category: 'residence', lat: 39.3902, lng: -76.6071, amenities: ['laundry'] },
  { id: 'RH', name: 'Richmond Hall', category: 'residence', lat: 39.3907, lng: -76.6076, amenities: ['laundry'] },
  { id: 'GT', name: 'Glen Towers', category: 'residence', lat: 39.3964, lng: -76.6111,
    aliases: ['the Glen', 'Glen complex', 'Tower A', 'Tower B', 'Tower C', 'Tower D'], amenities: ['laundry'] },
  { id: 'WV', name: 'West Village Residence Halls', category: 'residence', lat: 39.3928, lng: -76.6182,
    aliases: ['West Village', 'WV'], amenities: ['laundry'] },

  // ---------- Dining ----------
  { id: 'NDH', name: 'Newell Dining Hall', category: 'dining', lat: 39.3898, lng: -76.6077,
    aliases: ['Newell', 'dining hall'], amenities: ['food', 'meal-swipe'],
    hours: { verified: false, mon: '07:00-21:00', tue: '07:00-21:00', wed: '07:00-21:00', thu: '07:00-21:00',
      fri: '07:00-20:00', sat: '10:00-20:00', sun: '10:00-21:00' } },
  { id: 'GDH', name: 'Glen Dining Hall', category: 'dining', lat: 39.3959, lng: -76.6100,
    aliases: ['Glen dining'], amenities: ['food', 'meal-swipe'],
    hours: { verified: false, mon: '07:00-24:00', tue: '07:00-24:00', wed: '07:00-24:00', thu: '07:00-24:00',
      fri: '07:00-21:00', sat: '10:00-21:00', sun: '10:00-24:00' } },
  { id: 'WVC', name: 'West Village Commons', category: 'dining', lat: 39.3921, lng: -76.6170,
    aliases: ['WV Commons', 'commons'], amenities: ['food', 'meal-swipe', 'study'],
    hours: { verified: false, mon: '07:00-22:00', tue: '07:00-22:00', wed: '07:00-22:00', thu: '07:00-22:00',
      fri: '07:00-20:00', sat: '10:00-20:00', sun: '10:00-22:00' } },

  // ---------- Landmarks ----------
  { id: 'FS', name: 'Freedom Square', category: 'landmark', lat: 39.3933, lng: -76.6071,
    aliases: ['quad', 'plaza'], amenities: [] },
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
