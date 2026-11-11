// Search over buildings, departments, aliases and amenities, with typo
// tolerance and room-number parsing ("LA 4310" -> Liberal Arts, 4th floor).

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
    name: norm(item.name),
    words: norm(item.name).split(' '),
    aliases: (item.aliases ?? []).map(norm),
    depts: (item.depts ?? []).map(norm),
    amen: (item.amenities ?? []).map(norm),
  }));
}

function scoreToken(t, e) {
  let s = 0;
  if (e.code === t) s = Math.max(s, 100);
  if (e.name.startsWith(t)) s = Math.max(s, 80);
  if (e.words.some((w) => w.startsWith(t))) s = Math.max(s, 60);
  if (e.aliases.some((a) => a === t)) s = Math.max(s, 75);
  if (e.aliases.some((a) => a.split(' ').some((w) => w.startsWith(t)))) s = Math.max(s, 50);
  if (e.depts.some((d) => d.split(' ').some((w) => w.startsWith(t)))) s = Math.max(s, 40);
  if (e.amen.some((a) => a.startsWith(t))) s = Math.max(s, 35);
  if (s === 0 && t.length >= 4) {
    const max = t.length >= 7 ? 2 : 1;
    const pool = [...e.words, ...e.aliases.flatMap((a) => a.split(' ')), ...e.depts.flatMap((d) => d.split(' '))];
    if (pool.some((w) => lev(t, w.slice(0, t.length + 1), max) <= max)) s = 25;
  }
  return s;
}

/** Returns [{ item, score, room? }] best first. Every query token must match something. */
export function search(index, query, limit = 8) {
  const q = norm(query);
  if (!q) return [];
  const room = parseRoom(query);
  if (room) {
    const hit = index.find((e) => e.code === room.code.toLowerCase());
    if (hit) return [{ item: hit.item, score: 1000, room }];
  }
  const tokens = q.split(' ');
  const out = [];
  for (const e of index) {
    let total = 0;
    for (const t of tokens) {
      const s = scoreToken(t, e);
      if (!s) { total = 0; break; }
      total += s;
    }
    if (total) out.push({ item: e.item, score: total + (e.name === q ? 50 : 0) });
  }
  return out.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name)).slice(0, limit);
}
