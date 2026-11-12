// Self-guided campus tour — for prospective students, families and visitors.
//
// The route starts at the Enrollment Services Center, where Admissions runs
// campus tours. Descriptions use only facts already in TigerPath's building
// data or on towson.edu; Admissions should review and adjust the wording
// (just edit this file — the app picks it up on the next build).
//
// Each stop: { building: code in buildings.js, title?, text, lookFor? }

export const TOUR = {
  title: 'Self-guided campus tour',
  intro: 'Walk the heart of Towson University at your own pace — ten stops from Admissions to the sciences. Turn on your location and each stop opens as you arrive.',
  stops: [
    { building: 'ES', title: 'Enrollment Services Center',
      text: 'Start here. Admissions, Financial Aid, the Registrar and the Bursar are all in this building — the offices you’ll deal with most before your first day.',
      lookFor: 'The Admissions office, where TU’s guided campus tours begin.' },
    { building: 'WVC', title: 'West Village Commons',
      text: 'Dining and study space at the center of West Village, a neighborhood of residence halls on the west side of campus. Panda Express and Einstein Bros. Bagels are inside.',
      lookFor: 'The residence halls around you: Barton, Douglass, Tubman, Marshall, Harris and Barnes.' },
    { building: 'BU', title: 'Burdick Hall',
      text: 'Home of Campus Recreation — the student fitness center — and the Kinesiology department. Johnny Unitas Stadium and SECU Arena, where the Tigers play, are a short walk south.',
      lookFor: 'Schuerholz Park, TU’s baseball field, right next door.' },
    { building: 'UU', title: 'University Union',
      text: 'The center of student life: Student Activities, the University Store, the OneCard office and the Center for Student Diversity, with food from Chick-fil-A, Dunkin’ and the Food Market.',
      lookFor: 'Accessibility & Disability Services is here too, on the first floor.' },
    { building: 'CA', title: 'Center for the Arts',
      text: 'The College of Fine Arts & Communication: music, theatre, dance, and art + design, with performance spaces and an art gallery.',
      lookFor: 'Posters for upcoming concerts and shows — many are open to visitors.' },
    { building: 'GT', title: 'Glen Towers & the Glen',
      text: 'Four residence towers, A through D, next to Glen Dining Hall and the Glen Arboretum — a wooded garden right in the middle of campus.',
      lookFor: 'The Glen Arboretum’s paths between the towers and the academic buildings.' },
    { building: 'FS', title: 'Freedom Square',
      text: 'An open plaza beneath the Lecture Hall, set aside as a forum for campus civic discussion. Student organizations reserve it for events throughout the year.',
      lookFor: 'Stone benches where students meet between classes.' },
    { building: 'CK', title: 'Albert S. Cook Library',
      text: 'TU’s main library: study spaces, computers and printing, the Writing Center and Special Collections — and a Starbucks.',
      lookFor: 'Freedom Square and the Lecture Hall across the walkway.' },
    { building: 'ST', title: 'Stephens Hall',
      text: 'Towson’s historic signature building, recognizable by its tower. Today it’s home to the College of Business & Economics.',
      lookFor: 'The tower — it’s the building on many TU photos and logos.' },
    { building: 'SC', title: 'Science Complex',
      text: 'A modern home for the sciences: Biological Sciences, Chemistry, and Physics, Astronomy & Geosciences. That’s the end of the tour — thanks for visiting Towson!',
      lookFor: 'TigerPath’s Directions tab to find your way back, or to anywhere else on campus.' },
  ],
};
