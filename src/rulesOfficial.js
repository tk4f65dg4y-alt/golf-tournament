const Anthropic = require('@anthropic-ai/sdk');
const { RULES, COURSES, findMatch, findPlayer, shotsFor } = require('./data');
const { matchAllocations } = require('../public/js/golf-logic');

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

const LOCAL_RULES_TEXT = RULES.map((r) => `- ${r.title} ${r.text}`).join('\n');

function matchContextText(matchId) {
  const match = findMatch(matchId);
  if (!match) return '';
  const course = COURSES[match.courseId];
  const courseHoles = course.holes.slice(0, match.holeCount);
  const sideAPlayers = match.sideA.map(findPlayer);
  const sideBPlayers = match.sideB.map(findPlayer);
  const allocPlayers = [...sideAPlayers, ...sideBPlayers].map((p) => ({ id: p.id, shots: shotsFor(p, match.courseId) }));
  const allocations = matchAllocations(allocPlayers, courseHoles);

  const shotsLine = (players) =>
    players
      .map((p) => {
        const holes = Object.entries(allocations[p.id]).filter(([, n]) => n > 0).map(([h, n]) => (n > 1 ? `${h}(x${n})` : h));
        return `${p.name}${holes.length ? ` gets a shot on holes ${holes.join(', ')}` : ' plays scratch (no shots)'}`;
      })
      .join('; ');

  return `The question is about Match ${match.id}: ${match.format === 'singles' ? 'a singles match' : 'a fourball (better ball) match'} on ${course.name} (${match.holeCount} holes). ${sideAPlayers.map((p) => p.name).join(' & ')} vs ${sideBPlayers.map((p) => p.name).join(' & ')}. Shot allocation for this match: ${shotsLine(sideAPlayers)}; ${shotsLine(sideBPlayers)}.`;
}

const SYSTEM_PROMPT = `You are "The Rules Official" for The Aldenham Cup — a friendly one-day golf tournament between two teams of four friends (Team Casey and Team Reggel). Players ask you quick rules questions or disputes from out on the course, usually on their phone between shots.

Ground every answer in these LOCAL RULES first — they override the standard Rules of Golf whenever they differ:
${LOCAL_RULES_TEXT}

Where the local rules don't cover something, apply the standard Rules of Golf as you understand them.

How to answer:
- Give a clear, direct ruling — what happens, what (if any) penalty applies. Lead with the answer, not a preamble.
- Keep it SHORT: 2-4 sentences. Someone is standing in a fairway waiting for this.
- Cite which local rule applies by name when one does (e.g. "Under Lateral drops...").
- If the situation is genuinely ambiguous or not covered by these rules or the Rules of Golf, say so plainly rather than inventing a ruling.
- Always close with a short reminder that this is guidance, not the final word: the two captains settle disputes on the spot per the "Disputes" rule, and if they can't agree the hole is halved.
- Plain text only — no markdown headers, no bullet lists, this renders as plain prose in the app.`;

/**
 * @param {string} question
 * @param {number|null} matchId
 * @returns {Promise<string>} the ruling text
 */
async function askRulesOfficial(question, matchId) {
  const anthropic = getClient();
  if (!anthropic) {
    const err = new Error('The Rules Official is not configured yet — ask a captain to add ANTHROPIC_API_KEY.');
    err.notConfigured = true;
    throw err;
  }

  const context = matchId ? matchContextText(matchId) : '';
  const userContent = context ? `${context}\n\nQuestion: ${question}` : question;

  const response = await anthropic.messages.create({
    model: 'claude-opus-5',
    max_tokens: 1024,
    thinking: { type: 'adaptive' },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }]
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  return textBlock ? textBlock.text.trim() : "Couldn't reach a ruling — try rephrasing the question.";
}

module.exports = { askRulesOfficial };
