// Play-as-a-nation: the player leads one nation. Budget priorities nudge the simulation every month;
// events arrive with choices; goals give a score.
import { rel, setRel, addNews, warBetween, computeAggregates, computeAdjacency, pairKey } from './world.js';
import { declareWar, endWar } from './sim.js';
import { clamp } from './util.js';

export const POLICIES = {
  economy: { label: 'Economy', desc: 'Faster development and income' },
  army: { label: 'Army', desc: 'Stronger military, more feared' },
  welfare: { label: 'Welfare', desc: 'Stability and population growth' },
  diplomacy: { label: 'Diplomacy', desc: 'Neighbours like you more' },
};

export function startGame(W, nationId, difficulty = 'normal') {
  const n = W.nations[nationId];
  W.game = {
    nation: nationId, start: W.month, difficulty, budget: { economy: 30, army: 25, welfare: 30, diplomacy: 15 },
    events: [], log: [], approval: 0.6, score: 0, lastEvent: W.month, ended: null,
    goals: makeGoals(W, n), start0: { pop: n.pop, gdp: n.gdp, cells: n.cells, rank: rankOf(W, n, 'gdp') },
  };
  addNews(W, `You now lead ${n.name}.`, 'info', [nationId]);
  return W.game;
}
export const rankOf = (W, n, k) => 1 + W.nations.filter((x) => x && x.alive && x[k] > n[k]).length;

function makeGoals(W, n) {
  const gr = rankOf(W, n, 'gdp');
  return [
    { id: 'gdp', text: gr > 10 ? 'Grow your economy by 50%' : 'Grow your economy by 25%', target: gr > 10 ? 1.5 : 1.25 },
    { id: 'stab', text: 'Keep stability above 50% for 10 years', years: 10 },
    { id: 'rank', text: gr > 1 ? `Climb into the top ${Math.max(1, Math.ceil(gr / 2))} economies` : 'Stay the #1 economy', target: Math.max(1, Math.ceil(gr / 2)) },
    { id: 'land', text: 'Hold more land than you started with', target: 1.0001 },
  ];
}

// Effects of the budget, applied every simulated month (before the main tick).
export function gameTick(W) {
  const G = W.game; if (!G || G.ended) return;
  const n = W.nations[G.nation];
  if (!n || !n.alive) { G.ended = { won: false, text: `${n ? n.name : 'Your nation'} has fallen. Game over.` }; addNews(W, G.ended.text, 'war', [G.nation]); return; }
  const B = G.budget, f = (k) => B[k] / 100;
  // economy: development drifts up in your land
  const boost = (f('economy') - 0.25) * 0.0009;
  if (boost) for (const i of W.land) if (W.owner[i] === n.id) W.dev[i] = clamp(W.dev[i] + boost * (1 - W.dev[i]), 0.005, 1);
  n.armyBonus = 0.6 + 1.8 * f('army');
  n.bonus = (n.bonus || 0) * 0.9 + (f('welfare') - 0.25) * 0.08 - (f('army') > 0.4 ? (f('army') - 0.4) * 0.05 : 0);
  if (W.month % 3 === 0) for (const q of W.neighbors[n.id] || []) setRel(W, n.id, q, clamp(rel(W, n.id, q) + (f('diplomacy') - 0.15) * 4, -100, 100));
  // approval follows stability and the economy
  G.approval = clamp(G.approval * 0.97 + 0.03 * (0.25 + 0.55 * n.stab + 0.4 * (f('welfare') - 0.2)), 0, 1);
  // goals
  const yrs = (W.month - G.start) / 12;
  for (const g of G.goals) {
    if (g.done) continue;
    if (g.id === 'gdp' && n.gdp >= G.start0.gdp * g.target) done(g);
    if (g.id === 'stab') { if (n.stab < 0.5) g.since = W.month; else if (W.month - (g.since ?? G.start) >= g.years * 12) done(g); }
    if (g.id === 'rank' && rankOf(W, n, 'gdp') <= g.target && yrs > 1) done(g);
    if (g.id === 'land' && n.cells >= G.start0.cells * g.target + 20 && yrs > 1) done(g);
  }
  function done(g) { g.done = W.month; G.score += 100; addNews(W, `Goal reached: ${g.text}!`, 'info', [n.id]); }
  if (W.month % 12 === 0) G.score += Math.round(10 * n.stab + 5 * G.approval);
  if (n.gov === 'Republic' && G.approval < 0.18 && W.rng() < 0.02) { G.ended = { won: false, text: `Voters have thrown you out of office in ${n.name}. Game over.` }; addNews(W, G.ended.text, 'election', [n.id]); }
  if (n.gov !== 'Republic' && n.stab < 0.08 && W.rng() < 0.03) { G.ended = { won: false, text: `A revolution topples your government in ${n.name}. Game over.` }; addNews(W, G.ended.text, 'coup', [n.id]); }
  if (!G.ended && G.goals.every((g) => g.done)) { G.ended = { won: true, text: `Every goal achieved — ${n.name} prospers under your rule!` }; G.score += 300; }
  // new events every ~4-8 months
  if (!G.ended && !G.events.length && W.month - G.lastEvent >= 4 && W.rng() < 0.25) { const e = makeEvent(W, n); if (e) { G.events.push(e); G.lastEvent = W.month; } }
}

function pickNeighbor(W, n, pred) { const nb = (W.neighbors[n.id] || []).filter((q) => W.nations[q] && W.nations[q].alive && pred(W.nations[q])); return nb.length ? W.nations[nb[Math.floor(W.rng() * nb.length)]] : null; }

function makeEvent(W, n) {
  const r = W.rng, list = [];
  const rival = pickNeighbor(W, n, (q) => rel(W, n.id, q.id) < -15 && !warBetween(W, n.id, q.id));
  const friend = pickNeighbor(W, n, (q) => rel(W, n.id, q.id) > 15);
  const enemyAtWar = W.wars.find((w) => w.a === n.id || w.b === n.id);
  if (rival) list.push({ w: 3, ev: { kind: 'border', title: `Border incident with ${rival.name}`, text: `Troops from ${rival.name} crossed into a border town. Your generals want a response.`, other: rival.id,
    options: [{ label: 'Declare war', act: 'war' }, { label: 'Send a firm protest', act: 'protest' }, { label: 'Let it go', act: 'calm' }] } });
  if (friend && !(n.bloc && n.bloc === friend.bloc)) list.push({ w: 2, ev: { kind: 'alliance', title: `${friend.name} proposes an alliance`, text: `${friend.name} wants a defensive pact: each defends the other if attacked.`, other: friend.id,
    options: [{ label: 'Accept', act: 'ally' }, { label: 'Decline politely', act: 'decline' }] } });
  if (enemyAtWar) { const o = W.nations[enemyAtWar.a === n.id ? enemyAtWar.b : enemyAtWar.a]; list.push({ w: 3, ev: { kind: 'peace', title: `${o.name} offers peace`, text: `After ${Math.max(1, Math.round((W.month - enemyAtWar.start) / 12))} year(s) of war, ${o.name} sends envoys.`, other: o.id, war: true,
    options: [{ label: 'Accept peace', act: 'peace' }, { label: 'Fight on', act: 'fight' }] } }); }
  list.push({ w: 2, ev: { kind: 'economy', title: 'Economic boom or bust?', text: 'Advisers say the economy is overheating. Raise interest rates, or ride the boom?',
    options: [{ label: 'Raise rates (safer)', act: 'cool' }, { label: 'Ride the boom', act: 'boom' }] } });
  list.push({ w: 2, ev: { kind: 'protest', title: 'Mass protests in the capital', text: 'Crowds demand reforms. How do you respond?',
    options: [{ label: 'Promise reforms', act: 'reform' }, { label: 'Crack down', act: 'crack' }, { label: 'Ignore them', act: 'ignore' }] } });
  list.push({ w: 1, ev: { kind: 'disaster', title: 'Earthquake relief', text: 'A strong earthquake hit one of your provinces. Spend heavily on relief?',
    options: [{ label: 'Full relief effort', act: 'relief' }, { label: 'Minimal help', act: 'norelief' }] } });
  if (n.gov === 'Republic') list.push({ w: 1, ev: { kind: 'election', title: 'Call an early election?', text: `Your approval is ${Math.round(W.game.approval * 100)}%. An early vote could renew your mandate — or end it.`,
    options: [{ label: 'Call it', act: 'snap' }, { label: 'Not now', act: 'none' }] } });
  const tot = list.reduce((s, x) => s + x.w, 0); let k = r() * tot;
  for (const x of list) { k -= x.w; if (k <= 0) return { ...x.ev, m: W.month }; }
  return list[0].ev;
}

// Apply the player's choice. Returns a one-line outcome.
export function resolveEvent(W, choice) {
  const G = W.game, e = G.events.shift(); if (!e) return '';
  const n = W.nations[G.nation], o = e.other ? W.nations[e.other] : null, r = W.rng;
  let out = '';
  switch (choice) {
    case 'war': declareWar(W, n.id, o.id); G.approval += 0.05; out = `You declared war on ${o.name}.`; break;
    case 'protest': setRel(W, n.id, o.id, rel(W, n.id, o.id) - 10); G.approval += 0.02; out = `${o.name} is offended, but backs off.`; break;
    case 'calm': setRel(W, n.id, o.id, rel(W, n.id, o.id) + 6); G.approval -= 0.04; out = 'Tensions ease, but hawks call you weak.'; break;
    case 'ally': {
      if (o.bloc) n.bloc = o.bloc; else if (n.bloc) o.bloc = n.bloc; else { const id = W.blocs.length; W.blocs.push({ id, name: `${n.name}–${o.name} Pact`, color: [80 + ((id * 70) % 170), 160, 210] }); n.bloc = o.bloc = id; }
      setRel(W, n.id, o.id, Math.max(rel(W, n.id, o.id), 70)); addNews(W, `${n.name} and ${o.name} sign an alliance.`, 'alliance', [n.id, o.id]); out = `${o.name} is now your ally.`; break;
    }
    case 'decline': setRel(W, n.id, o.id, rel(W, n.id, o.id) - 5); out = `${o.name} is disappointed.`; break;
    case 'peace': { const w = warBetween(W, n.id, o.id); if (w) endWar(W, w, `${n.name} and ${o.name} make peace.`); out = 'The guns fall silent.'; G.approval += 0.04; break; }
    case 'fight': n.exh = clamp(n.exh + 0.05, 0, 1); out = 'The war goes on.'; break;
    case 'cool': n.bonus = (n.bonus || 0) + 0.05; out = 'Growth slows but the economy stays steady.'; break;
    case 'boom': if (r() < 0.55) { for (const i of W.land) if (W.owner[i] === n.id) W.dev[i] = clamp(W.dev[i] + 0.02, 0, 1); out = 'The gamble pays off — a boom!'; G.approval += 0.06; }
      else { for (const i of W.land) if (W.owner[i] === n.id) W.dev[i] = clamp(W.dev[i] - 0.025, 0.005, 1); n.stab = clamp(n.stab - 0.08, 0, 1); out = 'The bubble bursts into a recession.'; G.approval -= 0.08; } break;
    case 'reform': n.stab = clamp(n.stab + 0.06, 0, 1); G.approval += 0.06; for (const i of W.land) if (W.owner[i] === n.id) W.lean[i] = clamp(W.lean[i] - 0.03, -1, 1); out = 'The crowds go home hopeful.'; break;
    case 'crack': n.stab = clamp(n.stab + (r() < 0.5 ? 0.04 : -0.1), 0, 1); G.approval -= 0.08; if (n.gov === 'Republic' && r() < 0.15) { n.gov = 'Autocracy'; out = 'The crackdown turns your republic into an autocracy.'; } else out = 'The streets are cleared — by force.'; break;
    case 'ignore': n.stab = clamp(n.stab - 0.05, 0, 1); G.approval -= 0.04; out = 'The protests simmer on.'; break;
    case 'relief': for (const i of W.land) if (W.owner[i] === n.id) W.dev[i] = clamp(W.dev[i] - 0.004, 0.005, 1); G.approval += 0.07; n.stab = clamp(n.stab + 0.03, 0, 1); out = 'Your relief effort is praised.'; break;
    case 'norelief': G.approval -= 0.07; out = 'Survivors feel abandoned.'; break;
    case 'snap': { const won = r() < G.approval + 0.15; if (won) { G.approval = Math.min(1, G.approval + 0.15); n.stab = clamp(n.stab + 0.05, 0, 1); out = 'You win a fresh mandate!'; } else { G.ended = { won: false, text: `You lost the early election in ${n.name}. Game over.` }; out = G.ended.text; } break; }
    default: out = 'Noted.';
  }
  G.approval = clamp(G.approval, 0, 1);
  G.log.unshift({ m: W.month, title: e.title, out }); if (G.log.length > 60) G.log.length = 60;
  computeAggregates(W);
  return out;
}

export function endGame(W) { W.game = null; }
