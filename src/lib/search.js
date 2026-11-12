// Search over buildings, departments, aliases and amenities, with typo
// tolerance and room-number parsing ("LA 4310" -> Liberal Arts, 4th floor).
// Everyday words map onto the words in the data ("coffee" finds Starbucks), and
// question words are skipped, so "where do I pay tuition" finds the Bursar.

/** Everyday word -> words that appear in names, departments, food or amenities. */
const SYNONYMS = {
  coffee: ['starbucks', 'dunkin', 'einstein', 'cafe'], cafe: ['starbucks', 'dunkin', 'einstein', 'cafe'],
  tuition: ['bursar'], bill: ['bursar'], bills: ['bursar'], pay: ['bursar'], payment: ['bursar'],
  bathroom: ['restroom'], bathrooms: ['restroom'], toilet: ['restroom'], washroom: ['restroom'], restrooms: ['restroom'],
  workout: ['gym', 'recreation'], fitness: ['gym', 'recreation'], exercise: ['gym', 'recreation'],
  eat: ['food', 'dining'], lunch: ['food', 'dining'], dinner: ['food', 'dining'], breakfast: ['food', 'dining'], snack: ['food'],
  doctor: ['health'], clinic: ['health'], nurse: ['health'], sick: ['health'],
  therapy: ['counseling'], therapist: ['counseling'], counselor: ['counseling'],
  print: ['printing'], printer: ['printing'], books: ['bookstore'], textbooks: ['bookstore'],
  car: ['parking'], park: ['parking'], cash: ['atm'], wash: ['laundry'],
};
/** Words that only make a question ("where is", "how do I get to"). */
const STOP = new Set(['where', 'wheres', 'is', 'are', 'the', 'a', 'an', 'do', 'does', 'i', 'can', 'to', 'find', 'how', 'my',
  'for', 'get', 'of', 'in', 'on', 'at', 'near', 'nearest', 'closest', 'me', 'what', 'which', 'some', 'want', 'need', 'go']);

const norm = (s) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

function lev(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** "LA 4310", "la4310", "ST-102B" -> { code, room, floor } */
export function parseRoom(q) {
  const m = q.trim().match(/^([A-Za-z]{2,3})\s*[-.]?\s*([0-9]{3,4})([A-Za-z]?)$/);
  if (!m) return null;
  const digits = m[2];
  const floor = digits.length === 4 ? Number(digits[0]) : Number(digits[0]);
  return { code: m[1].toUpperCase(), room: digits + m[3].toUpperCase(), floor: floor === 0 ? 'Basement' : floor };
}

export function createIndex(items) {
  return items.map((item) => ({
    item,
    code: norm(item.id),
    official: norm(item.tu?.code ?? ''), // TU's own building code, when it differs
    name: norm(item.name),
    words: norm(item.name).split(' '),
    aliases: (item.aliases ?? []).map(norm),
    depts: (item.depts ?? []).map(norm),
    amen: (item.amenities ?? []).map(norm),
    food: (item.food ?? []).map(norm),
  }));
}

/** [score, why]: why says what matched when it isn't the name ({ kind: 'dept' | 'food' | 'amenity', text }). */
function scoreToken(t, e) {
  let s = 0, why = null;
  const hit = (score, w) => { s = Math.max(s, score); if (w) why ??= w; };
  const wordIn = (list) => list.findIndex((x) => x.split(' ').some((w) => w.startsWith(t)));
  const byName = e.code === t || e.official === t || e.words.some((w) => w.startsWith(t));
  if (e.code === t || e.official === t) hit(100);
  if (e.name.startsWith(t)) hit(80);
  if (e.words.some((w) => w.startsWith(t))) hit(60);
  if (e.aliases.some((a) => a === t)) hit(75);
  if (wordIn(e.aliases) >= 0) hit(50);
  const f = wordIn(e.food); if (f >= 0) hit(45, { kind: 'food', text: e.item.food[f] });
  const d = wordIn(e.depts); if (d >= 0) hit(40, { kind: 'dept', text: e.item.depts[d] });
  const a = e.amen.findIndex((x) => x.startsWith(t)); if (a >= 0) hit(35, { kind: 'amenity', text: e.item.amenities[a] });
  if (s === 0 && t.length >= 4) {
    const max = t.length >= 7 ? 2 : 1;
    const pool = [...e.words, ...e.aliases.flatMap((x) => x.split(' ')), ...e.depts.flatMap((x) => x.split(' '))];
    if (pool.some((w) => lev(t, w.slice(0, t.length + 1), max) <= max)) s = 25;
  }
  return [s, byName ? null : why];
}
/** The best of the token itself and its everyday-word synonyms ("park" finds parking before Schuerholz Park). */
function scoreWord(t, e) {
  return (SYNONYMS[t] ?? []).map((w) => scoreToken(w, e)).reduce((best, r) => (r[0] > best[0] ? r : best), scoreToken(t, e));
}

/** Returns [{ item, score, room?, why? }] best first. Every query word (question words aside) must match something. */
export function search(index, query, limit = 8) {
  const q = norm(query);
  if (!q) return [];
  const room = parseRoom(query);
  if (room) {
    const c = room.code.toLowerCase();
    const hit = index.find((e) => e.official === c) ?? index.find((e) => e.code === c);
    if (hit) return [{ item: hit.item, score: 1000, room }];
  }
  const words = q.split(' ');
  const tokens = words.filter((t) => !STOP.has(t));
  if (!tokens.length) tokens.push(...words);
  const out = [];
  for (const e of index) {
    let total = 0, why = null;
    for (const t of tokens) {
      const [s, w] = scoreWord(t, e);
      if (!s) { total = 0; break; }
      total += s; why ??= w;
    }
    // ties go to main campus buildings, and to the parking most visitors can use
    if (total) out.push({ item: e.item, score: total + (e.name === q ? 50 : 0) - (e.item.extra ? 5 : 0) + (e.item.boost ?? 0), why });
  }
  return out.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name)).slice(0, limit);
}
