// Photos of campus places, from Wikimedia Commons under open licenses. Each one shows with
// its credit (the licenses require it); `pos` is the CSS object-position that keeps the
// subject in frame when a card crops the photo.

export const PHOTOS = {
  'stephens-sun': { file: 'stephens-sun.jpg', alt: 'Stephens Hall with the tiger statue in front', pos: '50% 72%',
    credit: 'Katie Simmons-Barth Photography', license: 'CC BY 2.0', source: 'https://commons.wikimedia.org/wiki/File:Towson_University_Sun_on_Stephen%27s_Hall_(16668411069).jpg' },
  'stephens-hall': { file: 'stephens-hall.jpg', alt: 'Stephens Hall across the lawn', pos: '55% 45%',
    credit: 'Baltimore Heritage', license: 'CC0', source: 'https://commons.wikimedia.org/wiki/File:Stephens_Hall_(1912;_Douglas_H._Thomas_Jr.,_architect),_Towson_University,_8000_York_Road,_Towson,_MD_21252_(53148142706).jpg' },
  'unitas-stadium': { file: 'unitas-stadium.jpg', alt: 'Johnny Unitas Stadium during a game', pos: '35% 50%',
    credit: 'Anc516', license: 'CC BY-SA 3.0', source: 'https://commons.wikimedia.org/wiki/File:JohnnyUnitasStadium2013.jpg' },
  'secu-arena': { file: 'secu-arena.jpg', alt: 'A basketball game in SECU Arena, with gold seats', pos: '60% 40%',
    credit: 'Gregory Koch', license: 'CC BY-SA 4.0', source: 'https://commons.wikimedia.org/wiki/File:SECUArena.JPG' },
  'university-union': { file: 'university-union.jpg', alt: 'The University Union entrance', pos: '30% 50%',
    credit: 'Wikimedia Commons contributor', license: 'CC BY-SA 3.0', source: 'https://commons.wikimedia.org/wiki/File:TUUnivUnion.JPG' },
  'glen-snow': { file: 'glen-snow.jpg', alt: 'Trees in the Glen in winter', pos: '50% 50%',
    credit: 'Katie Simmons-Barth Photography', license: 'CC BY 2.0', source: 'https://commons.wikimedia.org/wiki/File:Towson_University_glen_snow_(16095534344).jpg' },
};

/** Building id → photo key. */
export const BUILDING_PHOTOS = { ST: 'stephens-hall', US: 'unitas-stadium', AR: 'secu-arena', UU: 'university-union', GA: 'glen-snow' };

/**
 * A few words about places with a story, beyond what TU's data says (who, when, what to look for).
 * Places not listed here get a description built from their category and offices.
 */
export const PLACE_STORIES = {
  ST: { about: 'Towson’s historic signature building, recognizable by its tower. Built in 1912 and designed by architect Douglas H. Thomas Jr., it’s home to the College of Business & Economics today.',
    facts: [['Built', '1912 · architect Douglas H. Thomas Jr.']] },
  UU: { about: 'The center of student life: Student Activities, the University Store, the OneCard office and the Center for Student Diversity, with food from Chick-fil-A, Dunkin’ and the Food Market.' },
  CK: { about: 'TU’s main library: study spaces, computers and printing, the Writing Center and Special Collections, and a Starbucks.' },
  US: { about: 'Where the Tigers play football, a short walk south of Burdick Hall and next to SECU Arena.', facts: [['Teams', 'Tigers football']] },
  AR: { about: 'Where the Tigers play basketball, right next to Johnny Unitas Stadium.' },
  GA: { about: 'The Glen Arboretum is a wooded garden right in the middle of campus, with paths between Glen Towers and the academic buildings.' },
};
