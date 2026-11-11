// Hall Cup: weekly step competition between residence halls (plus commuters).
// Halls are ranked by average steps per walker so big halls don't win on size,
// and a hall needs 3+ walkers to be ranked (so no one's own count can be inferred).

export const COMMUTERS = { id: 'COMMUTE', name: 'Commuters' };
export const MIN_WALKERS = 3;

export function teamOptions(buildings) {
  return [...buildings.filter((b) => b.category === 'residence').map((b) => ({ id: b.id, name: b.name })).sort((a, b) => a.name.localeCompare(b.name)), COMMUTERS];
}

/** rows from hall_leaderboard(): [{ hall, walkers, total_steps, avg_steps }] */
export function rankRows(rows, { names = {}, mine = null } = {}) {
  let rank = 0;
  return (rows ?? []).map((r) => {
    const ranked = r.walkers >= MIN_WALKERS && r.avg_steps != null;
    return {
      hall: r.hall, name: names[r.hall] ?? r.hall, walkers: r.walkers,
      avg: ranked ? r.avg_steps : null, total: ranked ? Number(r.total_steps) : null,
      rank: ranked ? ++rank : null, needs: ranked ? 0 : MIN_WALKERS - r.walkers, mine: r.hall === mine,
    };
  }).sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || b.walkers - a.walkers);
}
