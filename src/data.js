// The Aldenham Cup — single source of truth for the players and courses.
// This is the one file to edit for player PINs and the two scorecards.
// Matches are no longer fixed here -- any of the 8 players can start a new
// one against any combination of the others, at any time (see
// src/matchData.js) -- so the database, not this file, is the source of
// truth for who's playing whom.

const PLAYERS = [
  { id: 'casey', name: 'Casey', isCaptain: true, shotsChurch: 0, shotsVillage: 0, pin: '1001' },
  { id: 'cooper', name: 'Cooper', isCaptain: false, shotsChurch: 10, shotsVillage: 5, pin: '1002' },
  { id: 'milo', name: 'Milo', isCaptain: false, shotsChurch: 15, shotsVillage: 8, pin: '1003' },
  { id: 'jamie', name: 'Jamie', isCaptain: false, shotsChurch: 18, shotsVillage: 9, pin: '1004' },
  { id: 'reggel', name: 'Reggel', isCaptain: true, shotsChurch: 3, shotsVillage: 2, pin: '2001' },
  { id: 'danny', name: 'Danny', isCaptain: false, shotsChurch: 6, shotsVillage: 3, pin: '2002' },
  { id: 'coby', name: 'Coby', isCaptain: false, shotsChurch: 12, shotsVillage: 6, pin: '2003' },
  { id: 'solly', name: 'Solly', isCaptain: false, shotsChurch: 24, shotsVillage: 12, pin: '2004' }
];

// No PIN -- see routes/auth.js, which logs anyone hitting /login/spectator
// straight in without ever rendering the PIN screen.
const SPECTATOR = { id: 'spectator', name: 'Spectator', isCaptain: false, pin: null, readOnly: true };

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

// Single source of truth for both the static Rules page and the Rules
// Official's system prompt — edit here, both surfaces stay in sync.
const RULES = [
  { title: 'No mulligans.', text: 'None. Not off the first tee, not anywhere, not for anyone. Your first swing is your score.' },
  { title: 'Ball declaring.', text: 'On the first tee of each round, everyone states his make and number out loud. No two players in a group carry the same ball. Play a wrong ball and you lose the hole.' },
  { title: 'Lateral drops.', text: 'Allowed. Out of bounds, lost, or in a hazard, drop within two clublengths of where it crossed, no nearer the hole, one shot penalty. Nobody walks back to the tee. Three minutes to look, then drop and move on.' },
  { title: 'Preferred lies.', text: 'On the fairway only, within six inches, no nearer the hole. Play it as it lies in the rough, and that includes the semi.' },
  { title: 'Gimmes.', text: 'Only if your opponent gives it. Say it out loud and do not pick up until you have heard it. A putt taken without being conceded is a hole lost if the other player calls it.' },
  { title: 'Tees.', text: 'Yellows on the Church in the morning, whites on the Village after lunch.' },
  { title: 'Bunkers.', text: 'Rake them. Genuinely.' },
  { title: 'Pace.', text: 'Ready golf within your match. Lose a clear hole on the group ahead and you wave through or speed up.' },
  { title: 'Shots.', text: 'Printed for every match. Check it on the tee, not on the green.' },
  { title: 'Disputes.', text: 'The two captains settle it on the spot. If they cannot agree, the hole is halved and everyone moves on.' },
  { title: 'Scoring.', text: "Each match keeps its own state. Agree it out loud walking off every green so there is no argument on the 17th." }
];

function findPlayer(id) {
  if (id === SPECTATOR.id) return SPECTATOR;
  return PLAYERS.find((p) => p.id === id) || null;
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

module.exports = { PLAYERS, SPECTATOR, COURSES, RULES, findPlayer, shotsFor, canScoreMatch };
