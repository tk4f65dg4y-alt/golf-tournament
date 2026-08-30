// The Aldenham Cup — single source of truth for the day.
// This is the one file to edit before the day: player PINs, the draw, the
// two scorecards. Everything else derives from this.

const PLAYERS = [
  { id: 'casey', name: 'Casey', team: 'casey', isCaptain: true, shotsChurch: 0, shotsVillage: 0, pin: '1001' },
  { id: 'cooper', name: 'Cooper', team: 'casey', isCaptain: false, shotsChurch: 10, shotsVillage: 5, pin: '1002' },
  { id: 'milo', name: 'Milo', team: 'casey', isCaptain: false, shotsChurch: 15, shotsVillage: 8, pin: '1003' },
  { id: 'jamie', name: 'Jamie', team: 'casey', isCaptain: false, shotsChurch: 18, shotsVillage: 9, pin: '1004' },
  { id: 'reggel', name: 'Reggel', team: 'reggel', isCaptain: true, shotsChurch: 3, shotsVillage: 2, pin: '2001' },
  { id: 'danny', name: 'Danny', team: 'reggel', isCaptain: false, shotsChurch: 6, shotsVillage: 3, pin: '2002' },
  { id: 'coby', name: 'Coby', team: 'reggel', isCaptain: false, shotsChurch: 12, shotsVillage: 6, pin: '2003' },
  { id: 'solly', name: 'Solly', team: 'reggel', isCaptain: false, shotsChurch: 24, shotsVillage: 12, pin: '2004' }
];

const SPECTATOR = { id: 'spectator', name: 'Spectator', team: null, isCaptain: false, pin: '0000', readOnly: true };

const TEAMS = {
  casey: { id: 'casey', name: 'Team Casey', color: '#2C5282' },
  reggel: { id: 'reggel', name: 'Team Reggel', color: '#9B2C2C' }
};

const COURSES = {
  church: {
    id: 'church',
    name: 'Church Course',
    tees: 'yellow',
    par: 70,
    yards: 6092,
    holes: [
      { number: 1, par: 4, yards: 408, strokeIndex: 4 },
      { number: 2, par: 4, yards: 337, strokeIndex: 18 },
      { number: 3, par: 4, yards: 312, strokeIndex: 10 },
      { number: 4, par: 4, yards: 399, strokeIndex: 2 },
      { number: 5, par: 5, yards: 467, strokeIndex: 16 },
      { number: 6, par: 3, yards: 173, strokeIndex: 12 },
      { number: 7, par: 4, yards: 398, strokeIndex: 6 },
      { number: 8, par: 3, yards: 167, strokeIndex: 14 },
      { number: 9, par: 5, yards: 537, strokeIndex: 8 },
      { number: 10, par: 4, yards: 428, strokeIndex: 3 },
      { number: 11, par: 4, yards: 377, strokeIndex: 5 },
      { number: 12, par: 3, yards: 172, strokeIndex: 13 },
      { number: 13, par: 5, yards: 594, strokeIndex: 1 },
      { number: 14, par: 3, yards: 138, strokeIndex: 17 },
      { number: 15, par: 4, yards: 354, strokeIndex: 9 },
      { number: 16, par: 4, yards: 314, strokeIndex: 15 },
      { number: 17, par: 3, yards: 192, strokeIndex: 7 },
      { number: 18, par: 4, yards: 325, strokeIndex: 11 }
    ]
  },
  village: {
    id: 'village',
    name: 'The Village',
    tees: 'white',
    par: 33,
    yards: 2349,
    holes: [
      { number: 1, par: 4, yards: 338, strokeIndex: 7 },
      { number: 2, par: 4, yards: 324, strokeIndex: 3 },
      { number: 3, par: 3, yards: 125, strokeIndex: 6 },
      { number: 4, par: 4, yards: 299, strokeIndex: 8 },
      { number: 5, par: 3, yards: 210, strokeIndex: 2 },
      { number: 6, par: 4, yards: 272, strokeIndex: 5 },
      { number: 7, par: 3, yards: 112, strokeIndex: 9 },
      { number: 8, par: 4, yards: 312, strokeIndex: 4 },
      { number: 9, par: 4, yards: 357, strokeIndex: 1 }
    ]
  }
};

// points: every match is worth 1 (6 matches, 6 points total, per the brief).
const MATCHES = [
  { id: 1, session: 'morning', format: 'singles', courseId: 'church', holeCount: 18, teeGroup: 1, points: 1, sideA: ['casey'], sideB: ['reggel'] },
  { id: 2, session: 'morning', format: 'singles', courseId: 'church', holeCount: 18, teeGroup: 1, points: 1, sideA: ['milo'], sideB: ['coby'] },
  { id: 3, session: 'morning', format: 'singles', courseId: 'church', holeCount: 18, teeGroup: 2, points: 1, sideA: ['cooper'], sideB: ['danny'] },
  { id: 4, session: 'morning', format: 'singles', courseId: 'church', holeCount: 18, teeGroup: 2, points: 1, sideA: ['jamie'], sideB: ['solly'] },
  { id: 5, session: 'afternoon', format: 'fourball', courseId: 'village', holeCount: 9, teeGroup: 1, points: 1, sideA: ['casey', 'jamie'], sideB: ['reggel', 'solly'] },
  { id: 6, session: 'afternoon', format: 'fourball', courseId: 'village', holeCount: 9, teeGroup: 2, points: 1, sideA: ['cooper', 'milo'], sideB: ['danny', 'coby'] }
];

const SUDDEN_DEATH = { course: 'village', hole: 1, players: ['casey', 'reggel'] };

function findPlayer(id) {
  if (id === SPECTATOR.id) return SPECTATOR;
  return PLAYERS.find((p) => p.id === id) || null;
}

function findMatch(id) {
  return MATCHES.find((m) => m.id === Number(id)) || null;
}

function matchesForPlayer(playerId) {
  return MATCHES.filter((m) => m.sideA.includes(playerId) || m.sideB.includes(playerId));
}

/** Anyone in the match's group can score for anyone in it; captains can score any match. */
function canScoreMatch(user, match) {
  if (!user || user.readOnly) return false;
  if (user.isCaptain) return true;
  return match.sideA.includes(user.id) || match.sideB.includes(user.id);
}

function shotsFor(player, courseId) {
  if (!player) return 0;
  return courseId === 'church' ? player.shotsChurch : player.shotsVillage;
}

module.exports = { PLAYERS, SPECTATOR, TEAMS, COURSES, MATCHES, SUDDEN_DEATH, findPlayer, findMatch, matchesForPlayer, shotsFor, canScoreMatch };
