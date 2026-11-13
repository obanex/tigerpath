// Photos of campus places. Each one shows with its credit: Wikimedia Commons photos carry
// `credit`, `license` and `source` (their open licenses require the credit); the others carry
// `creator` and/or `rights` (the copyright holder). `pos` is the CSS object-position that keeps
// the subject in frame when a card crops the photo.

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

  // by Obanex Francois
  'stephens-clock': { file: 'stephens-clock.jpg', alt: 'The clock tower of Stephens Hall above the trees', pos: '50% 35%', creator: 'Obanex Francois' },
  'burdick-hall': { file: 'burdick-hall.jpg', alt: 'Burdick Hall, with its “Push What’s Possible” banner', pos: '50% 50%', creator: 'Obanex Francois' },
  'burdick-banner': { file: 'burdick-banner.jpg', alt: 'The glass front of Burdick Hall up close', pos: '40% 50%', creator: 'Obanex Francois' },
  'burdick-walk': { file: 'burdick-walk.jpg', alt: 'The brick walkway up to Burdick Hall', pos: '60% 40%', creator: 'Obanex Francois' },
  'cook-library': { file: 'cook-library.jpg', alt: 'Albert S. Cook Library, with the tiger statue by the path', pos: '50% 60%', creator: 'Obanex Francois' },
  'cook-tiger': { file: 'cook-tiger.jpg', alt: 'The tiger statue outside Cook Library', pos: '45% 50%', creator: 'Obanex Francois' },
  'cook-stacks': { file: 'cook-stacks.jpg', alt: 'An aisle of bookshelves inside Cook Library', pos: '50% 50%', creator: 'Obanex Francois' },
  'cook-stacks-red': { file: 'cook-stacks-red.jpg', alt: 'Shelves of bound journals inside Cook Library', pos: '50% 50%', creator: 'Obanex Francois' },
  'freedom-square': { file: 'freedom-square.jpg', alt: 'The Freedom Square chalkboard wall, covered in messages', pos: '45% 50%', creator: 'Obanex Francois' },

  // © Towson University (used with permission), © The Towerlight
  '7800-york-road': { file: '7800-york-road.jpg', alt: '7800 York Road, with the TU logo on its corner', pos: '55% 60%', creator: 'Lauren Castellana', rights: 'Towson University' },
  'administration': { file: 'administration.jpg', alt: 'The Administration Building and its flags', pos: '40% 40%', creator: 'Lauren Castellana', rights: 'Towson University' },
  'center-for-the-arts': { file: 'center-for-the-arts.jpg', alt: 'The Center for the Arts lit up at sunset', pos: '35% 55%', rights: 'Towson University' },
  'hawkins-hall': { file: 'hawkins-hall.jpg', alt: 'Hawkins Hall behind autumn trees', pos: '50% 45%', rights: 'Towson University' },
  'health-professions': { file: 'health-professions.jpg', alt: 'The Health Professions Building across the lawn', pos: '50% 50%', rights: 'Towson University' },
  'lecture-hall': { file: 'lecture-hall.jpg', alt: 'The Lecture Hall and its outdoor stairs', pos: '40% 45%', rights: 'Towson University' },
  'liberal-arts': { file: 'liberal-arts.jpg', alt: 'The Liberal Arts Building behind a row of flags', pos: '45% 45%', rights: 'Towson University' },
  'linthicum-hall': { file: 'linthicum-hall.jpg', alt: 'The entrance of Linthicum Hall', pos: '50% 40%', rights: 'Towson University' },
  'media-center': { file: 'media-center.jpg', alt: 'The Media Center lobby with its neon sign', pos: '50% 40%', rights: 'The Towerlight' },
};

/** Building id → photo keys, the first one leads (cards, the place page header). */
export const BUILDING_PHOTOS = {
  ST: ['stephens-clock', 'stephens-hall'], US: ['unitas-stadium'], AR: ['secu-arena'], UU: ['university-union'], GA: ['glen-snow'],
  BU: ['burdick-hall', 'burdick-banner', 'burdick-walk'], CK: ['cook-library', 'cook-tiger', 'cook-stacks', 'cook-stacks-red'],
  FS: ['freedom-square'], YR: ['7800-york-road'], AD: ['administration'], CA: ['center-for-the-arts'], HH: ['hawkins-hall'],
  HP: ['health-professions'], LH: ['lecture-hall'], LA: ['liberal-arts'], LI: ['linthicum-hall'], MC: ['media-center'],
};

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
