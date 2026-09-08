/* ------------------------------------------------------------------
 * myBrainsCore.js — "Shah Investment Center" as a self-running org.
 * ------------------------------------------------------------------
 * Neuron  = one employee, holding a GENOME for its department's slice of
 *           the trading pipeline, plus a performance record it earns.
 * Rank    = HOD → Manager → Employee. Rank changes what a neuron does each
 *           work cycle, not just how it is drawn.
 * Lab     = myBrainsLab.js. It runs the whole pipeline on real bars and
 *           returns numbers nobody can argue with.
 *
 * Division of labour between the two data sources:
 *   your MT5 account tells HR WHERE to put people (demand, workload);
 *   the lab tells HR WHO is any good (performance, promotion, dismissal).
 * ------------------------------------------------------------------ */

import {
  evaluateSplit, randomGenome, mutate, crossover, DEFAULT_GENOMES,
  DEFAULT_BOOK_GENOMES, genomeDistance, summariseChampion, leakCheck,
  makeCandidate, evaluateBook, runAttacks, ATTACKS, PIPELINE_DEPTS,
  deflatedSharpe, moments, expectedMaxSharpe,
  calendarGrid, crossInstrument, GENE_SPECS, RESEARCH_ONLY_MODES, pooledEvidence
} from './myBrainsLab.js';

/* ---------------------------- utils ---------------------------- */

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;

function gauss(rnd, mean = 0, sd = 1) {
  let u = 0, v = 0;
  while (u === 0) u = rnd();
  while (v === 0) v = rnd();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

let _uid = 0;
const uid = (p) => `${p}${(++_uid).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

/* ------------------------- departments ------------------------- */

export const DEPARTMENTS = [
  /* ---------------- research chain: raw ticks in, candidate edges out ------ */
  {
    id: 'data', code: 'DE', name: 'Data Engineering', color: '#22d3ee', lab: true, chain: 'research',
    charter: 'Decides which bars the firm is allowed to believe. Their mistakes are invisible and inherited by everyone downstream.',
    owns: 'Bar validity filters, gap tolerance, warm-up length',
    metricLabel: 'Signal flow', source: '/api/signals', live: true,
    tasks: ['Tick ingestion', 'Gap repair', 'Session tagging', 'Spread audit', 'Symbol specs', 'Feed watchdog', 'Outlier screen', 'Latency probe'],
    base: 8, min: 3, max: 16
  },
  {
    id: 'regime', code: 'MR', name: 'Market Regime', color: '#5eead4', lab: true, chain: 'research',
    charter: 'Classifies what kind of market this is and owns the on/off switch. Most strategies do not lose money — they lose money in the wrong regime.',
    owns: 'Trend/range classification, volatility band, per-strategy enable',
    metricLabel: 'Regime', source: 'derived from bars', live: true,
    tasks: ['Trend strength', 'Volatility band', 'Regime dating', 'Breakpoint test', 'Chop detection', 'Persistence study', 'Switch calibration', 'Regime P&L'],
    base: 6, min: 3, max: 14
  },
  {
    id: 'math', code: 'QR', name: 'Quantitative Research', color: '#a78bfa', lab: true, chain: 'research',
    charter: 'Owns where the stop sits and what the target is worth, and the tests that decide what counts as evidence.',
    owns: 'Stop geometry, reward:risk, holding period',
    metricLabel: 'Sharpe', source: '/api/journal/stats', live: true,
    tasks: ['Volatility model', 'Kelly sizing', 'Stationarity test', 'Correlation matrix', 'Sharpe decomposition', 'Tail estimator', 'Monte Carlo', 'Significance bar'],
    base: 7, min: 3, max: 15
  },
  {
    id: 'science', code: 'SD', name: 'Strategy Discovery', color: '#38bdf8', lab: true, chain: 'research',
    charter: 'Generates candidate edges. The largest search space in the firm and the easiest place to fool yourself.',
    owns: 'Entry families, filters, feature construction',
    metricLabel: 'Win rate', source: '/api/journal/stats', live: true,
    tasks: ['Feature build', 'Walk-forward test', 'Overfit audit', 'Signal scoring', 'Leakage check', 'Model retrain', 'Ensemble blend', 'Drift monitor'],
    base: 9, min: 4, max: 20
  },
  {
    id: 'diversity', code: 'AD', name: 'Alpha Diversity', color: '#818cf8', lab: true, book: true, chain: 'research',
    charter: 'Holds the correlation matrix and a veto over profitable strategies that duplicate risk the book already carries. Fifty strategies at 0.6 correlation behave like 1.7.',
    owns: 'Admission threshold, book size, retirement of duplicates',
    metricLabel: 'Independent bets', source: 'the book', live: true,
    tasks: ['Correlation matrix', 'Admission review', 'Duplicate hunt', 'Cluster analysis', 'Retirement list', 'Distance metric', 'Book audit', 'Concentration check'],
    base: 5, min: 2, max: 12
  },
  {
    id: 'political', code: 'ME', name: 'Macro & Event', color: '#fb923c', lab: true, chain: 'research',
    charter: 'Holds a veto over sessions, weekdays and scheduled events. Reads what the price series alone cannot.',
    owns: 'Session vetoes, event blackouts, weekday masks',
    metricLabel: 'Geo-risk', source: 'simulated', live: false,
    tasks: ['CB calendar', 'Election watch', 'Sanctions scan', 'Energy geopolitics', 'Rate rhetoric', 'Headline risk', 'Session study', 'Holiday map'],
    base: 5, min: 2, max: 11
  },

  /* ---------------- trading chain: edges in, positions out ----------------- */
  {
    id: 'cost', code: 'CC', name: 'Cost & Capacity', color: '#f472b6', lab: true, chain: 'trading',
    charter: 'Models the full round-trip cost and the size at which each strategy stops working. Without this the firm optimises strategies that die on contact with a real book.',
    owns: 'Cost safety margin, slippage assumption, minimum edge vs cost',
    metricLabel: 'Cost / trade', source: 'the pipeline', live: true,
    tasks: ['Spread model', 'Slippage study', 'Capacity ceiling', 'Commission audit', 'Session cost map', 'Impact curve', 'Cost forecast', 'Stress at 2x'],
    base: 6, min: 3, max: 13
  },
  {
    id: 'investment', code: 'EX', name: 'Execution & Microstructure', color: '#fbbf24', lab: true, chain: 'trading',
    charter: 'Where the edge is preserved or given away: order type, timing, scale-outs, trailing stops. At high trade counts this is worth more than the strategy it executes.',
    owns: 'Scale-outs, breakeven moves, trailing stops',
    metricLabel: 'Open risk', source: '/api/positions', live: true,
    tasks: ['Entry execution', 'Stop management', 'Scale-out', 'Fill quality', 'Slippage review', 'Exposure netting', 'Venue choice', 'Trade veto'],
    base: 7, min: 3, max: 15
  },
  {
    id: 'portfolio', code: 'PC', name: 'Portfolio Construction', color: '#34d399', lab: true, book: true, chain: 'trading',
    charter: 'Sizes every strategy against every other one. Converts a pile of individual edges into one book whose volatility is what Risk & Capital ordered.',
    owns: 'Per-strategy weights, weight caps, volatility target',
    metricLabel: 'Book Sharpe', source: 'the book', live: true,
    tasks: ['Weight scheme', 'Vol targeting', 'Rebalance', 'Concentration cap', 'Netting', 'Marginal risk', 'Sum-of-parts check', 'Turnover control'],
    base: 5, min: 2, max: 12
  },
  {
    id: 'incubation', code: 'SI', name: 'Strategy Incubation', color: '#4ade80', lab: true, book: true, chain: 'trading',
    charter: 'The deployment gate. Paper, then minimum size, then a fraction, then full — each stage with a bar it must clear. Exists to catch the strategies that were only ever curve fits.',
    owns: 'Ramp schedule, promotion gates, kill criteria',
    metricLabel: 'Degradation', source: 'the book', live: true,
    tasks: ['Paper tracking', 'Ramp schedule', 'Promotion gate', 'Kill criteria', 'Forward test', 'Live-vs-backtest', 'Size steps', 'Probation review'],
    base: 5, min: 2, max: 11
  },
  {
    id: 'postrade', code: 'PT', name: 'Post-Trade Analytics', color: '#2dd4bf', lab: false, chain: 'trading',
    charter: 'Explains the P&L after the fact — how much was edge, how much was slippage, how much was luck. Unexplained profit is as alarming as unexplained loss.',
    owns: 'P&L attribution, execution forensics',
    metricLabel: 'Unexplained', source: 'the book', live: true,
    tasks: ['P&L attribution', 'Slippage forensics', 'Luck decomposition', 'Fill analysis', 'Error hunt', 'Regime attribution', 'Cost reconciliation', 'Variance report'],
    base: 4, min: 2, max: 9
  },
  {
    id: 'treasury', code: 'TB', name: 'Treasury & Broker Ops', color: '#10b981', lab: true, book: true, chain: 'trading',
    charter: 'Funding, financing cost, broker risk, and the discipline of taking money off the table. Compounding is only real once it has been withdrawn at least once.',
    owns: 'Withdrawal schedule, financing drag, broker allocation',
    metricLabel: 'Banked', source: '/api/account', live: true,
    tasks: ['Withdrawal run', 'Financing audit', 'Broker allocation', 'Swap review', 'Settlement', 'Cashflow forecast', 'Counterparty risk', 'Payroll run'],
    base: 4, min: 2, max: 9
  },

  /* ---------------- independent oversight: can say no to the line ---------- */
  {
    id: 'finance', code: 'RC', name: 'Risk & Capital', color: '#f59e0b', lab: true, chain: 'oversight',
    charter: 'Owns leverage as a decision separate from strategy — which row of the price table the firm lives on. Also owns the kill switches.',
    owns: 'Risk per trade, volatility target, drawdown throttle',
    metricLabel: 'Profit factor', source: '/api/account', live: true,
    tasks: ['Vol targeting', 'Leverage review', 'Drawdown budget', 'Throttle calibration', 'Kill switch', 'Exposure limit', 'Capital call', 'Risk report'],
    base: 6, min: 3, max: 13
  },
  {
    id: 'legal', code: 'CO', name: 'Compliance', color: '#94a3b8', lab: true, chain: 'oversight',
    charter: 'The mandate: daily loss stop, trade caps, cool-downs, records. The only department rewarded for stopping the desk, and the only one whose success looks like nothing happening.',
    owns: 'Daily loss stop, trade caps, cool-downs',
    metricLabel: 'Drawdown', source: '/api/journal/stats', live: true,
    tasks: ['Mandate check', 'Leverage limit', 'Drawdown breach', 'Record keeping', 'Disclosure log', 'Audit trail', 'Limit review', 'Jurisdiction check'],
    base: 4, min: 2, max: 9
  }
];

export const HR_DEPT = {
  id: 'hr', code: 'HR', name: 'Human Resources', color: '#e879f9', lab: false, staff: true,
  charter: 'Never sleeps and owns no strategy. Scores every neuron on measured marginal contribution, trains the weak, promotes the strong into management, removes the ones who stay weak, and moves headcount toward whichever department the firm is currently failing at. Sets its own standards from a stated rule.',
  owns: 'Headcount, rank, hiring, training, dismissal, standards',
  tasks: ['Performance review', 'Training programme', 'Headcount planning', 'Succession', 'Onboarding', 'Termination', 'Skill mapping', 'Workload balance']
};

export const CEO_DEPT = {
  id: 'ceo', code: 'CEO', name: 'Office of the CEO', color: '#e879f9', lab: false, staff: true,
  charter: 'Answers to Haider. Sets what "good" means for the desk — the return worth chasing and the drawdown worth tolerating — decides which department gets the next batch of experiments, and leans on any lobe that stops producing. Does not run experiments personally.',
  owns: 'The mandate, experiment budget, pressure on the floor',
  tasks: ['Mandate review', 'Budget allocation', 'Department pressure', 'Board briefing', 'Capital case', 'Strategy review', 'Escalation', 'Performance call']
};

export const AUDIT_DEPT = {
  id: 'audit', code: 'AUD', name: 'Audit', color: '#60a5fa', lab: false, staff: true,
  charter: 'Independent. Checks that what the desk claims is actually true — that the limits Legal set were enforced, that the sample is big enough to mean anything, and that no decision anywhere secretly read the held-out data. Audit can block a strategy outright, and nobody can overrule it.',
  owns: 'Sign-off. A blocked finding stops the desk shipping.',
  tasks: ['Sample adequacy', 'Out-of-sample result', 'Overfit gap', 'Drawdown mandate', 'Limit enforcement', 'Selection integrity', 'Coverage check', 'Evidence review']
};

export const BOARD = { name: 'Haider', role: 'Investor & Director' };

export const REDTEAM_DEPT = {
  id: 'redteam', code: 'RT', name: 'Red Team', color: '#ef4444', lab: false, staff: true,
  charter: 'Paid to prove the desk is wrong. Audit asks whether the process was followed; Red Team asks whether the result is luck, and attacks rather than inspects — shuffled markets, neighbouring parameters, doubled costs, split halves.',
  owns: 'The adversarial test battery. A failed attack is a finding.',
  tasks: ['Shuffled-market attack', 'Parameter neighbourhood', 'Cost stress at 2x', 'Split-half consistency',
          'Null hypothesis', 'Regime hostility', 'Data snooping check', 'Survivorship probe']
};

export const STAFF_DEPTS = [HR_DEPT, AUDIT_DEPT, REDTEAM_DEPT];
export const ALL_DEPTS = [...DEPARTMENTS, HR_DEPT, AUDIT_DEPT, REDTEAM_DEPT, CEO_DEPT];
export const DEPT_BY_ID = Object.fromEntries(ALL_DEPTS.map(d => [d.id, d]));
export const LAB_DEPTS = DEPARTMENTS.filter(d => d.lab).map(d => d.id);
/* departments whose genome lives inside one strategy */
export const PIPE_DEPTS = DEPARTMENTS.filter(d => d.lab && !d.book).map(d => d.id);
/* departments whose genome is about the BOOK of strategies */
export const BOOK_DEPTS = DEPARTMENTS.filter(d => d.book).map(d => d.id);

export const PIPELINE = [
  ['data', 'regime', 1.00], ['data', 'math', 0.80], ['regime', 'science', 0.90],
  ['math', 'science', 0.90], ['political', 'science', 0.60], ['science', 'diversity', 1.00],
  ['science', 'cost', 0.85], ['diversity', 'portfolio', 1.00], ['cost', 'investment', 1.00],
  ['legal', 'investment', 0.55], ['investment', 'portfolio', 0.90],
  ['portfolio', 'incubation', 1.00], ['portfolio', 'finance', 0.85],
  ['incubation', 'treasury', 0.70], ['investment', 'postrade', 0.80],
  ['postrade', 'science', 0.50], ['treasury', 'data', 0.40]
];

export const EDGE_LABEL = {
  'data>regime': 'clean series', 'data>math': 'clean series', 'regime>science': 'market state',
  'math>science': 'risk geometry', 'political>science': 'session vetoes',
  'science>diversity': 'candidate edges', 'science>cost': 'candidate edges',
  'diversity>portfolio': 'admitted strategies', 'cost>investment': 'cost budget',
  'legal>investment': 'mandate limits', 'investment>portfolio': 'executed trades',
  'portfolio>incubation': 'the book', 'portfolio>finance': 'book risk',
  'incubation>treasury': 'promoted size', 'investment>postrade': 'fills',
  'postrade>science': 'what actually worked', 'treasury>data': 'infra budget'
};

/* A Strategy Discovery neuron is not a generalist. It is assigned a
 * discipline and searches only within it, so the department covers the whole
 * space instead of every analyst converging on the same idea. */
export const ANALYST_FAMILIES = GENE_SPECS.science.find(g => g.k === 'mode').enums;

export function analystOf(n) {
  return n && n.specialty != null ? ANALYST_FAMILIES[n.specialty] : null;
}

export const RANK_META = {
  hod: { label: 'Head of Department', short: 'HOD', size: 1.85, ring: 0 },
  manager: { label: 'Manager', short: 'MGR', size: 1.35, ring: 52 },
  employee: { label: 'Employee', short: 'EMP', size: 1.0, ring: 26 }
};

export const STATE_META = {
  onboarding: { label: 'Onboarding', color: '#38bdf8' },
  active: { label: 'Active', color: '#22c55e' },
  training: { label: 'In training', color: '#f59e0b' },
  star: { label: 'Top performer', color: '#fbbf24' },
  terminating: { label: 'Exiting', color: '#ef4444' }
};

/* ---------------------------- layout ---------------------------- */

export const WORLD = { w: 2900, h: 1340 };

export function departmentLayout() {
  /* An org chart, not a ring. Column spacing is set by how wide the name
   * cards are: at the zoom this world fits to, anything under ~300 units
   * apart makes the cards collide and the whole thing becomes unreadable. */
  const out = {};
  const put = (id, x, y) => { out[id] = { x, y, angle: Math.atan2(y - 700, x - 1450) }; };

  put('board', 1450, 70);
  put('ceo', 1450, 250);
  put('hr', 1450, 520);

  put('audit', 700, 470); put('redteam', 1060, 470);
  put('finance', 1840, 470); put('legal', 2200, 470);

  const RX = [170, 510, 850], TX = [2050, 2390, 2730], Y = [790, 1090];
  ['data', 'regime', 'math'].forEach((id, i) => put(id, RX[i], Y[0]));
  ['science', 'diversity', 'political'].forEach((id, i) => put(id, RX[i], Y[1]));
  ['cost', 'investment', 'portfolio'].forEach((id, i) => put(id, TX[i], Y[0]));
  ['incubation', 'postrade', 'treasury'].forEach((id, i) => put(id, TX[i], Y[1]));
  return out;
}

/* ---------------------------- neurons ---------------------------- */

const FIRST_NAMES = ['Ayaan', 'Rakhi', 'Zara', 'Bilal', 'Noor', 'Hamza', 'Sana', 'Faris', 'Iqra', 'Danish', 'Mehak', 'Umar', 'Laiba', 'Rehan', 'Anaya', 'Kabir', 'Hina', 'Talha', 'Mina', 'Saad', 'Areeba', 'Yusuf', 'Nida', 'Arsalan'];

let seqByDept = {};

export function makeNeuron(dept, rnd, opts = {}) {
  seqByDept[dept.id] = (seqByDept[dept.id] || 0) + 1;
  const seq = seqByDept[dept.id];
  const out = {
    id: uid('n'),
    tag: `${dept.code}-${String(seq).padStart(2, '0')}`,
    name: FIRST_NAMES[Math.floor(rnd() * FIRST_NAMES.length)],
    deptId: dept.id,
    rank: opts.rank || 'employee',
    squad: null,
    /* what it believes */
    genome: dept.lab ? (opts.genome || randomGenome(dept.id, rnd)) : null,
    specialty: opts.specialty != null ? opts.specialty : null,
    creativity: opts.creativity == null ? clamp(gauss(rnd, 0.34, 0.16), 0.06, 0.92) : opts.creativity,
    /* what it has earned */
    learn: null, select: null, honest: null, gap: null, metrics: null,
    evals: 0, wins: 0, lastGain: 0, stalled: 0,
    score: opts.score == null ? 55 : opts.score,
    prevScore: 55,
    hist: [],
    lineage: opts.lineage || 'hired',
    /* HR record */
    state: opts.state || 'active',
    stateT: 0, reviews: 0, trainingCycles: 0, highCycles: 0,
    hiredAt: Date.now(),
    task: dept.tasks[Math.floor(rnd() * dept.tasks.length)],
    /* motion */
    load: 0.35 + rnd() * 0.4,
    ang: rnd() * Math.PI * 2, rad: 26, spin: (rnd() - 0.5) * 0.2,
    wob: rnd() * Math.PI * 2, wobSpeed: 0.4 + rnd() * 0.9,
    firePhase: rnd() * Math.PI * 2, fireRate: 0.7 + rnd() * 1.4,
    x: 0, y: 0, alpha: opts.state === 'onboarding' ? 0 : 1
  };
  if (dept.id === 'science') {
    if (out.specialty == null) out.specialty = Math.floor(rnd() * ANALYST_FAMILIES.length);
    if (out.genome) out.genome.mode = out.specialty;
    out.task = `${ANALYST_FAMILIES[out.specialty]} analysis`;
  }
  return out;
}

/* ---------------------------- the org ---------------------------- */

function pushEvent(org, type, text, deptId, tone) {
  org.events.unshift({
    id: uid('e'), t: Date.now(), type, text, deptId,
    tone: tone || (type === 'FIRED' || type === 'RELEASED' || type === 'DEMOTED' ? 'bad'
      : type === 'PROMOTED' || type === 'HIRED' || type === 'PUBLISHED' ? 'good' : 'warn')
  });
  if (org.events.length > 240) org.events.length = 240;
  const d = org.daily && org.daily[org.today];
  if (d) {
    if (type === 'HIRED') d.hired++;
    else if (type === 'FIRED' || type === 'RELEASED') d.removed++;
    else if (type === 'PROMOTED') d.promoted++;
    else if (type === 'TRAINING') d.trained++;
    else if (type === 'PUBLISHED') d.published++;
  }
}

export function createOrg(seed = Date.now()) {
  const rnd = mulberry32(seed >>> 0);
  seqByDept = {};
  const layout = departmentLayout();
  const depts = {};
  ALL_DEPTS.forEach(d => {
    const count = d.id === 'ceo' ? 1 : d.id === 'audit' ? 5 : d.id === 'redteam' ? 4 : d.id === 'hr' ? 4 : d.base;
    depts[d.id] = {
      id: d.id, target: count, neurons: [], health: 55, throughput: 0.5, quality: 0.5,
      book: !!d.book, chain: d.chain || 'staff', isLab: !!d.lab,
      demand: 0.5, metricValue: null, metricText: '—', live: d.staff || d.id === 'ceo' ? true : !!d.live,
      pos: layout[d.id], champScore: null, stagnation: 0, published: 0
    };
    for (let i = 0; i < count; i++) {
      depts[d.id].neurons.push(makeNeuron(d, rnd, i === 0 && d.lab ? { genome: { ...DEFAULT_GENOMES[d.id] } } : {}));
    }
  });

  const org = {
    seed, rnd, t: 0, layout, depts,
    edges: PIPELINE.map(([from, to, w]) => ({
      from, to, w, key: `${from}>${to}`, label: EDGE_LABEL[`${from}>${to}`] || 'work',
      intensity: 0.4, particles: []
    })),
    events: [], telemetry: null, reviewAcc: 0, reviewIndex: 0,
    stats: { hired: 0, fired: 0, trained: 0, promoted: 0, restructured: 0, published: 0, evals: 0 },
    lab: null, today: todayKey(), daily: {}
  };
  org.daily[org.today] = blankDay(org.today);
  ALL_DEPTS.forEach(d => reorganise(org, d.id, true));
  initCeo(org);
  org.hrPolicy = autoHr(org);
  return org;
}

export function allNeurons(org) {
  const out = [];
  for (const k in org.depts) for (const n of org.depts[k].neurons) out.push(n);
  return out;
}
export function headcount(org) {
  let c = 0;
  for (const k in org.depts) c += org.depts[k].neurons.filter(n => n.state !== 'terminating').length;
  return c;
}
export const liveOnes = (dep) => dep.neurons.filter(n => n.state !== 'terminating');

/* --------------------- hierarchy & squads --------------------- */
/* One HOD. One manager per four heads. Everybody else reports to a
 * manager. Rank is not decoration — it changes what the neuron does
 * during a work cycle. */

export function reorganise(org, deptId, quiet) {
  const d = DEPT_BY_ID[deptId];
  const dep = org.depts[deptId];
  const live = liveOnes(dep);
  if (!live.length) return;
  const proven = (n) => (n.select == null ? -1e9 + (n.score || 0) : n.select);

  let hod = live.find(n => n.rank === 'hod');
  if (!hod) {
    hod = live.slice().sort((a, b) => proven(b) - proven(a))[0];
    const was = hod.rank;
    hod.rank = 'hod';
    if (!quiet) org.stats.promoted++;
    if (!quiet) pushEvent(org, 'PROMOTED', `${hod.tag} promoted ${was === 'manager' ? 'from manager ' : ''}to Head of ${d.name}`, deptId, 'good');
  }

  const wantMgr = clamp(Math.round((live.length - 1) / 4), 1, 4);
  let mgrs = live.filter(n => n.rank === 'manager');
  if (mgrs.length < wantMgr) {
    const pool = live.filter(n => n.rank === 'employee' && n.state !== 'onboarding')
      .sort((a, b) => proven(b) - proven(a));
    for (let i = 0; i < wantMgr - mgrs.length && i < pool.length; i++) {
      pool[i].rank = 'manager';
      if (!quiet) org.stats.promoted++;
      if (!quiet) pushEvent(org, 'PROMOTED', `${pool[i].tag} promoted to Manager in ${d.name}`, deptId, 'good');
    }
  } else if (mgrs.length > wantMgr) {
    const drop = mgrs.sort((a, b) => proven(a) - proven(b)).slice(0, mgrs.length - wantMgr);
    for (const m of drop) {
      m.rank = 'employee';
      if (!quiet) pushEvent(org, 'DEMOTED', `${m.tag} stepped back to employee — ${d.name} needs fewer managers`, deptId, 'bad');
    }
  }
  mgrs = live.filter(n => n.rank === 'manager');
  if (!mgrs.length) { const e = live.find(n => n.rank === 'employee'); if (e) { e.rank = 'manager'; mgrs = [e]; } }

  const emps = live.filter(n => n.rank === 'employee');
  emps.forEach((e, i) => { e.squad = mgrs.length ? mgrs[i % mgrs.length].id : null; });

  /* geometry: HOD at the core, managers on a ring, squads around them */
  hod.pr = 0; hod.pa = 0;
  const M = Math.max(1, mgrs.length);
  mgrs.forEach((m, i) => {
    const a = -Math.PI / 2 + (i / M) * Math.PI * 2;
    m.pr = 54; m.pa = a;
    m._mx = Math.cos(a) * 54; m._my = Math.sin(a) * 54; m._ma = a;
    const squad = emps.filter(e => e.squad === m.id);
    /* Offset the squad ring by a quarter turn and half a step. Without this a
     * two-person squad lands exactly on the manager's own radial and the whole
     * lobe renders as a straight line instead of a cluster. */
    squad.forEach((e, j) => {
      const th = a + Math.PI * 0.5 + (j / Math.max(1, squad.length)) * Math.PI * 2;
      const rr = 25 + (j % 2) * 8;
      const ex = m._mx + Math.cos(th) * rr, ey = m._my + Math.sin(th) * rr;
      e.pr = Math.hypot(ex, ey); e.pa = Math.atan2(ey, ex);
    });
  });
  if (deptId === 'redteam') live.forEach((n, i) => { n.attackIdx = i % 4; });
  if (deptId === 'science') {
    /* keep the whole discipline space covered as people come and go */
    const seen = new Set();
    live.forEach(n => { if (n.specialty != null) seen.add(n.specialty); });
    let next = 0;
    live.forEach(n => {
      if (n.specialty == null) {
        while (seen.has(next) && next < ANALYST_FAMILIES.length) next++;
        n.specialty = next < ANALYST_FAMILIES.length ? next++ : Math.floor(Math.random() * ANALYST_FAMILIES.length);
        seen.add(n.specialty);
        if (n.genome) n.genome.mode = n.specialty;
        n.task = `${ANALYST_FAMILIES[n.specialty]} analysis`;
      }
    });
    dep.disciplines = ANALYST_FAMILIES.map((name, i) => ({
      name, i, count: live.filter(n => n.specialty === i).length,
      best: live.filter(n => n.specialty === i && Number.isFinite(n.select))
        .reduce((a, n) => (!a || n.select > a.select ? n : a), null),
    }));
  }
  dep.mgrCount = mgrs.length;
  dep.hodId = hod.id;
}

/* -------------------------- telemetry -------------------------- */
/* MT5 reality. Drives WHERE headcount goes and how hard the wires run.
 * It does not decide who is good — the lab does that. */

const pct = (v) => `${v.toFixed(1)}%`;

export function deriveTelemetry(raw = {}, nowMs = Date.now()) {
  const { account, positions, stats, signals } = raw;
  const T = {};
  const sigCount = Array.isArray(signals) ? signals.length : null;
  if (sigCount != null) T.data = { live: true, value: sigCount, text: `${sigCount} signals`, throughput: clamp(sigCount / 45, 0.18, 1), quality: sigCount > 0 ? clamp(0.55 + sigCount / 160, 0.55, 0.95) : 0.38 };
  if (stats && typeof stats.sharpe_ratio === 'number' && stats.total_trades > 0) {
    const s = stats.sharpe_ratio;
    T.math = { live: true, value: s, text: s.toFixed(2), quality: clamp((s + 0.6) / 2.6, 0.05, 1), throughput: clamp(0.35 + (s + 0.6) / 4, 0.2, 1) };
  }
  if (stats && typeof stats.win_rate === 'number' && stats.total_trades > 0) {
    const wr = stats.win_rate;
    T.science = { live: true, value: wr, text: pct(wr), quality: clamp((wr - 28) / 46, 0.05, 1), throughput: clamp(stats.total_trades / 120, 0.2, 1) };
  }
  if (stats && typeof stats.max_drawdown === 'number' && stats.total_trades > 0) {
    let dd = Math.abs(stats.max_drawdown);
    const bal = account && account.balance ? Math.abs(account.balance) : 0;
    if (dd > 100 && bal > 0) dd = (dd / bal) * 100;
    T.legal = { live: true, value: dd, text: pct(dd), quality: clamp(1 - dd / 28, 0.05, 1), throughput: clamp(0.3 + dd / 40, 0.2, 1) };
  }
  if (Array.isArray(positions)) {
    const open = positions.length;
    const float = positions.reduce((a, p) => a + (p.profit || 0), 0);
    T.investment = { live: true, value: open, float, text: open === 0 ? 'flat' : `${open} open · ${float >= 0 ? '+' : ''}${float.toFixed(0)}`, throughput: clamp(open / 5, 0.12, 1), quality: open === 0 ? 0.55 : clamp(0.55 + float / (Math.abs(float) + 220) * 0.4, 0.1, 0.95) };
  }
  if (account || (stats && stats.total_trades > 0)) {
    const pf = stats && typeof stats.profit_factor === 'number' ? stats.profit_factor : null;
    const eq = account ? Number(account.equity) || 0 : 0, bal = account ? Number(account.balance) || 0 : 0;
    const cushion = bal > 0 ? clamp(eq / bal, 0.4, 1.6) : 1;
    T.finance = { live: true, value: pf, equity: eq, balance: bal, text: pf != null ? `PF ${pf.toFixed(2)}` : `${eq.toFixed(0)} eq`, quality: clamp((pf != null ? (pf - 0.6) / 1.4 : 0.5) * 0.7 + (cushion - 0.4) / 1.2 * 0.3, 0.05, 1), throughput: clamp(0.35 + (pf != null ? pf / 3 : 0.3), 0.2, 1) };
  }
  const geo = 46 + 30 * Math.sin(nowMs / 390000) + 14 * Math.sin(nowMs / 92000 + 1.7);
  T.political = { live: false, value: geo, text: `${geo.toFixed(0)} idx`, quality: clamp(1 - geo / 105, 0.08, 0.95), throughput: clamp(0.25 + geo / 130, 0.2, 1) };

  DEPARTMENTS.forEach((d, i) => {
    if (T[d.id]) return;
    const ph = nowMs / (180000 + i * 26000);
    T[d.id] = { live: false, value: null, text: 'no feed', quality: clamp(0.45 + 0.28 * Math.sin(ph), 0.1, 0.92), throughput: clamp(0.35 + 0.3 * Math.sin(ph * 1.4 + i), 0.15, 0.95) };
  });
  DEPARTMENTS.forEach(d => {
    const s = T[d.id];
    let demand = 0.5 * s.throughput + 0.5 * (1 - s.quality);
    if (d.id === 'legal') demand = clamp(0.35 + (1 - s.quality) * 0.9, 0, 1);
    if (d.id === 'investment') demand = clamp(0.3 + s.throughput * 0.8, 0, 1);
    if (d.id === 'finance') demand = clamp(0.45 + (1 - s.quality) * 0.5, 0, 1);
    s.demand = clamp(demand, 0.05, 1);
  });
  const eq = account ? Number(account.equity) || 0 : 0, bal = account ? Number(account.balance) || 0 : 0;
  T._org = {
    live: !!account, equity: eq, balance: bal, profit: account ? Number(account.profit) || 0 : 0,
    currency: (account && account.currency) || 'USD', cushion: bal > 0 ? eq / bal : 1
  };
  return T;
}

export const NEURON_DAY_COST = 5;

export function payrollRunway(org, dayCost = NEURON_DAY_COST) {
  const t = org.telemetry && org.telemetry._org;
  const heads = headcount(org);
  const burn = heads * dayCost;
  if (!t || !t.equity || burn <= 0) return null;
  return { days: t.equity / burn, burn, heads, equity: t.equity, currency: t.currency };
}

export function applyTelemetry(org, raw, nowMs = Date.now()) {
  const T = deriveTelemetry(raw, nowMs);
  org.telemetry = T;
  DEPARTMENTS.forEach(d => {
    const s = T[d.id], dep = org.depts[d.id];
    dep.throughput = s.throughput; dep.quality = s.quality; dep.demand = s.demand;
    dep.metricValue = s.value; dep.metricText = s.text; dep.live = s.live;
  });
  const hr = org.depts.hr;
  const avg = DEPARTMENTS.reduce((a, d) => a + org.depts[d.id].health, 0) / DEPARTMENTS.length;
  hr.quality = clamp(avg / 100, 0.05, 1);
  hr.throughput = clamp(0.4 + Math.abs(avg - 62) / 60, 0.25, 1);
  hr.metricText = `${avg.toFixed(0)} avg`;
  hr.live = true;
  return org;
}

/* ======================= the daily ledger ======================= */

function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function blankDay(k) {
  return {
    date: k, startSelect: null, startHonest: null, bestSelect: null, bestHonest: null,
    endSelect: null, endHonest: null, gens: 0, evals: 0,
    hired: 0, removed: 0, promoted: 0, trained: 0, published: 0
  };
}
export function rollDay(org) {
  const k = todayKey();
  if (k === org.today) return false;
  const prev = org.daily[org.today];
  if (prev && org.lab && org.lab.championScore) {
    prev.endSelect = org.lab.championScore.select;
    prev.endHonest = org.lab.championScore.honest;
  }
  org.today = k;
  org.daily[k] = blankDay(k);
  if (org.lab && org.lab.championScore) {
    org.daily[k].startSelect = org.lab.championScore.select;
    org.daily[k].startHonest = org.lab.championScore.honest;
  }
  const keys = Object.keys(org.daily).sort();
  while (keys.length > 60) delete org.daily[keys.shift()];
  pushEvent(org, 'DAY', `New working day — ${k}. Yesterday: ${prev ? `${prev.gens} generations, ${prev.evals.toLocaleString()} experiments, ${prev.published} champions published` : 'no record'}`, 'hr', 'info');
  return true;
}
export function dayList(org) {
  return Object.keys(org.daily).sort().reverse().map(k => org.daily[k]);
}

/* ========================= the work loop ========================= */
/* This is what makes the neurons autonomous: nobody presses anything.
 * Each work cycle a neuron re-measures its own genome against the current
 * champion context, tries one variation, and keeps it only if it is better
 * on the training folds. Managers breed their squad's best two. HODs
 * publish. Nothing here reads the test slice. */

export function attachLab(org, input, meta) {
  /* `input` is a universe (array of instruments) or, for compatibility, a
   * single Features. The floor optimises on one member at a time — the CEO
   * chooses which — and candidates remember where they were bred. */
  const universe = Array.isArray(input)
    ? input
    : [{ key: `${(meta && meta.symbol) || 'series'} ${(meta && meta.timeframe) || ''}`.trim(),
         F: input, bars: input.b, symbol: (meta && meta.symbol) || 'series',
         timeframe: (meta && meta.timeframe) || '1H', live: !!(meta && meta.live) }];
  const F = universe[0].F;
  return attachLabInner(org, F, meta, universe);
}

function attachLabInner(org, F, meta, universe) {
  const champions = {};
  const restored = org._saved && org._saved.champions;
  /* A champion saved before a department grew new genes is missing them.
   * Backfilling from the defaults keeps the floor's accumulated work — tens
   * of thousands of evaluations — instead of throwing it away on a version
   * bump. A champion with a hole in its genome reads as "incomplete genome"
   * on the card and, worse, feeds undefined into the entry logic. */
  for (const id of PIPE_DEPTS) {
    if (restored && restored[id]) {
      champions[id] = { ...DEFAULT_GENOMES[id], ...restored[id] };
      for (const k of Object.keys(champions[id]))
        if (!Number.isFinite(champions[id][k])) champions[id][k] = DEFAULT_GENOMES[id][k];
      continue;
    }
    const seed = liveOnes(org.depts[id]).find(n => n.genome);
    champions[id] = seed ? { ...seed.genome } : { ...DEFAULT_GENOMES[id] };
  }
  const bookG = {};
  const restoredBook = org._saved && org._saved.bookGenomes;
  for (const id of BOOK_DEPTS) {
    bookG[id] = (restoredBook && restoredBook[id]) ? { ...restoredBook[id] } : { ...DEFAULT_BOOK_GENOMES[id] };
  }
  org.lab = {
    F, meta: meta || {}, champions, bookG,
    candidates: [], book: null, attacks: {}, attribution: null,
    trialStats: { n: 0, mean: 0, M2: 0 }, dsr: null,
    universe, focus: 0, grid: calendarGrid(universe), cross: null, lastRotate: 0,
    championScore: evaluateSplit(F, champions),
    deptChampSelect: {}, generation: 0, queue: [], evals: 0,
    bestEver: null, history: [], lastPublish: 0
  };
  for (const id of LAB_DEPTS) org.lab.deptChampSelect[id] = org.lab.championScore.select;
  snapshotCandidate(org, 'founding strategy');
  org.lab.bestEver = org.lab.championScore.select;
  if (org._saved) {
    org.lab.generation = org._saved.generation || 0;
    org.lab.history = org._saved.history || [];
  }
  const d = org.daily[org.today];
  if (d && d.startSelect == null) {
    d.startSelect = org.lab.championScore.select;
    d.startHonest = org.lab.championScore.honest;
  }
  const liveCount = universe.filter(u => u.live).length;
  pushEvent(org, 'LAB', `Lab online — ${universe.length} instrument${universe.length === 1 ? '' : 's'} `
    + `(${universe.map(u => u.key).join(', ')}), ${liveCount ? `${liveCount} on real bars` : 'all synthetic, MT5 history unavailable'}. `
    + `Searching on ${universe[0].key}.`, 'hr', 'info');
  return org;
}

/* The book is fed by champions the floor has already published. A new one
 * only earns a slot if it is genuinely different from what is already in the
 * pool — otherwise Alpha Diversity spends its life rejecting near-duplicates. */
export function snapshotCandidate(org, why) {
  const lab = org.lab;
  if (!lab || !lab.F) return null;
  const inst = lab.universe[lab.focus] || lab.universe[0];
  const cand = makeCandidate(lab.F, lab.champions, null, inst, lab.grid);
  cand.why = why || 'published champion';
  let nearest = 1;
  for (const c of lab.candidates) {
    let d = 0;
    for (const dept of PIPELINE_DEPTS) d += genomeDistance(dept, cand.cfg[dept], c.cfg[dept]);
    nearest = Math.min(nearest, d / PIPELINE_DEPTS.length);
  }
  if (lab.candidates.length && nearest < 0.04) return null;      // same idea again
  lab.candidates.push(cand);
  if (lab.candidates.length > 20) {
    lab.candidates.sort((a, b) => b.fit - a.fit);
    lab.candidates.length = 20;
  }
  return cand;
}

function bookScore(org, genomes) {
  const lab = org.lab;
  if (!lab.candidates.length) return null;
  return evaluateBook(lab.candidates, genomes);
}

/* Every evaluation is a trial, and the count of them is what the deflated
 * Sharpe charges the firm for. Kept with Welford's method so it costs nothing. */
function recordTrial(lab, ev) {
  const inS = ev && ev.inSample;
  if (!inS) return;
  /* a trial that barely traded tells you nothing about the spread of
   * outcomes the search can produce, so it does not get a vote */
  if (inS.trades < inS.minTrades) return;
  const sr = inS.sharpe;
  if (!Number.isFinite(sr)) return;
  const t = lab.trialStats;
  t.n++;
  const d = sr - t.mean;
  t.mean += d / t.n;
  t.M2 += d * (sr - t.mean);
}

export function trialSharpeSd(lab) {
  const t = lab && lab.trialStats;
  if (!t || t.n < 2) return 0.5;
  return Math.sqrt(t.M2 / (t.n - 1));
}

function bestBy(list, key) {
  let b = null;
  for (const n of list) if (n[key] != null && (!b || n[key] > b[key])) b = n;
  return b;
}

/* one neuron does one piece of work. returns evaluations consumed. */
function doWork(org, n) {
  const lab = org.lab;
  const dep = org.depts[n.deptId];

  /* Red Team runs an attack instead of holding a genome. Each auditor-style
   * neuron owns exactly one attack and runs it on the current champion. */
  if (n.deptId === 'redteam') {
    const which = ATTACKS[(n.attackIdx != null ? n.attackIdx : 0) % ATTACKS.length];
    const res = runAttacks(lab.F, lab.champions, org.rnd, which.id)[0];
    if (res) {
      const prev = lab.attacks[res.id];
      lab.attacks[res.id] = { ...res, by: n.tag, at: Date.now() };
      if (prev && prev.passed && !res.passed) {
        pushEvent(org, 'REDTEAM', `${n.tag} broke the champion — ${which.name.toLowerCase()} now fails`, 'redteam', 'bad');
      }
      n.lastAttack = res;
    }
    n.evals++;
    return 3;
  }

  /* Post-Trade holds no genome either: it explains where the money came from. */
  if (n.deptId === 'postrade') {
    const b = lab.book;
    if (b && b.test) {
      const gross = b.admitted.reduce((a, c, i) => a + b.weights[i] * (c.metrics.expectancy * c.metrics.trades), 0);
      const cost = b.admitted.reduce((a, c, i) => a + b.weights[i] * (c.metrics.costPerTrade * c.metrics.trades), 0);
      const net = gross - cost;
      lab.attribution = {
        gross, cost, net,
        unexplained: Math.abs(net) > 1e-9 ? Math.abs((net - (gross - cost)) / net) * 100 : 0,
        costShare: Math.abs(gross) > 1e-9 ? (cost / Math.abs(gross)) * 100 : 0,
        by: n.tag, at: Date.now(),
      };
    }
    n.evals++;
    return 1;
  }

  if (!n.genome) { n.evals++; return 0; }        // HR, CEO: they watch the floor

  /* Book departments are scored on the whole book, not on one strategy. */
  if (DEPT_BY_ID[n.deptId] && DEPT_BY_ID[n.deptId].book) {
    const g = { ...lab.bookG, [n.deptId]: n.genome };
    const cur = bookScore(org, g);
    if (!cur) { n.evals++; return 1; }
    n.learn = cur.select; n.select = cur.select; n.honest = cur.honest;
    n.gap = cur.gap; n.bookStats = { kEff: cur.kEff, avgCorr: cur.avgCorr, admitted: cur.admitted.length };
    const cand = mutate(n.deptId, n.genome, n.creativity, org.rnd);
    const alt = bookScore(org, { ...lab.bookG, [n.deptId]: cand });
    n.evals += 2;
    if (alt && Number.isFinite(alt.select) && alt.select > n.learn) {
      n.lastGain = alt.select - n.learn;
      n.genome = cand; n.learn = alt.select; n.select = alt.select; n.honest = alt.honest;
      n.gap = alt.gap; n.wins++; n.stalled = 0; n.lineage = 'mutation';
    } else {
      n.stalled++;
      if (n.stalled % 6 === 0) n.creativity = clamp(n.creativity + 0.07, 0.06, 0.95);
    }
    return 2;
  }

  const ctx = { ...lab.champions };
  ctx[n.deptId] = n.genome;
  const cur = evaluateSplit(lab.F, ctx);
  recordTrial(lab, cur);
  n.learn = cur.learn; n.select = cur.select; n.honest = cur.honest;
  n.gap = cur.gap; n.metrics = cur.test; n.inSample = cur.inSample;

  /* what kind of experiment does this rank run? */
  let cand = null, how = 'mutation';
  if (n.rank === 'manager') {
    const squad = liveOnes(dep).filter(e => e.squad === n.id && e.genome && e.select != null);
    if (squad.length >= 2 && org.rnd() < 0.6) {
      const s = squad.slice().sort((a, b) => b.select - a.select);
      cand = crossover(n.deptId, s[0].genome, s[1].genome, org.rnd);
      how = `crossover ${s[0].tag} × ${s[1].tag}`;
    }
  } else if (n.rank === 'hod') {
    const mgrs = liveOnes(dep).filter(e => e.rank === 'manager' && e.genome && e.select != null);
    if (mgrs.length >= 2 && org.rnd() < 0.5) {
      const s = mgrs.slice().sort((a, b) => b.select - a.select);
      cand = crossover(n.deptId, s[0].genome, s[1].genome, org.rnd);
      how = `crossover ${s[0].tag} × ${s[1].tag}`;
    }
  }
  if (!cand) cand = mutate(n.deptId, n.genome, n.creativity, org.rnd);
  /* whatever the search does, an analyst keeps their own discipline */
  if (n.deptId === 'science' && n.specialty != null) cand.mode = n.specialty;

  ctx[n.deptId] = cand;
  const alt = evaluateSplit(lab.F, ctx);
  recordTrial(lab, alt);
  n.evals += 2;
  if (alt.learn > n.learn) {
    n.lastGain = alt.learn - n.learn;
    n.genome = cand; n.learn = alt.learn; n.select = alt.select; n.honest = alt.honest;
    n.gap = alt.gap; n.metrics = alt.test; n.inSample = alt.inSample;
    n.wins++; n.stalled = 0; n.lineage = how;
  } else {
    n.stalled++;
    n.lastGain = 0;
    /* nobody improves forever by taking small steps — get bolder when stuck */
    if (n.stalled > 0 && n.stalled % 6 === 0) n.creativity = clamp(n.creativity + 0.07, 0.06, 0.95);
  }
  return 2;
}

function startGeneration(org) {
  const q = [];
  for (const id of [...LAB_DEPTS, 'hr', 'audit', 'redteam', 'postrade']) {
    for (const n of liveOnes(org.depts[id])) if (n.state !== 'terminating') q.push(n);
  }
  if (!q.length) return false;
  for (let i = q.length - 1; i > 0; i--) {
    const j = Math.floor(org.rnd() * (i + 1));
    [q[i], q[j]] = [q[j], q[i]];
  }
  /* the CEO's allocation: the focus lobe gets a second pass this generation */
  const focus = org.ceo && org.ceo.focus;
  if (focus && org.depts[focus]) {
    for (const n of liveOnes(org.depts[focus])) if (n.state !== 'terminating') q.push(n);
  }
  org.lab.queue = q;
  return true;
}

function endGeneration(org) {
  const lab = org.lab;
  lab.generation++;
  let evals = 0;

  /* the book is reassembled once per generation, then everything is scored
   * against it — including the departments that decide what goes in it */
  if (lab.candidates.length) lab.book = evaluateBook(lab.candidates, lab.bookG);

  for (const id of BOOK_DEPTS) {
    const dep = org.depts[id];
    const live = liveOnes(dep).filter(n => n.genome && Number.isFinite(n.select));
    if (!live.length) continue;
    const cur = bookScore(org, lab.bookG);
    lab.deptChampSelect[id] = cur ? cur.select : 0;
    const best = bestBy(live, 'select');
    if (cur && best && best.select > cur.select + 0.4) {
      lab.bookG[id] = { ...best.genome };
      dep.published++; org.stats.published++; dep.staleGens = 0;
      pushEvent(org, 'PUBLISHED', `${DEPT_BY_ID[id].name}: adopted ${best.tag}'s approach — ${summariseChampion(id, best.genome)}`, id, 'good');
    }
    dep.staleGens = (dep.staleGens || 0) + 1;
    rescoreDept(org, id);
  }

  for (const id of PIPE_DEPTS) {
    const dep = org.depts[id];
    const live = liveOnes(dep).filter(n => n.genome && Number.isFinite(n.select));
    if (!live.length) continue;

    /* HOD publishes the department champion — but only if it genuinely
     * beats the incumbent measured in the same, current context. */
    const cur = evaluateSplit(lab.F, { ...lab.champions, [id]: lab.champions[id] });
    evals++;
    lab.deptChampSelect[id] = cur.select;
    const best = bestBy(live, 'select');
    if (best && best.select > cur.select + 0.4) {
      lab.champions[id] = { ...best.genome };
      dep.published++;
      dep.staleGens = 0;
      snapshotCandidate(org, `${DEPT_BY_ID[id].name} improvement`);
      if (lab.universe.length > 1) {
        lab.cross = crossInstrument(lab.universe, lab.champions, lab.universe[lab.focus].key);
        lab.cross.at = lab.generation;
      }
      org.stats.published++;
      const hod = live.find(n => n.rank === 'hod');
      pushEvent(org, 'PUBLISHED', `${DEPT_BY_ID[id].name}: ${hod ? hod.tag : 'HOD'} published ${best.tag}'s work — ${summariseChampion(id, best.genome)}`, id, 'good');
    }

    /* Managers mentor: a stuck employee gets bred with its manager. */
    for (const m of (lab.generation % 5 === 0 ? live.filter(n => n.rank === 'manager') : [])) {
      const squad = live.filter(e => e.squad === m.id);
      const worst = squad.filter(e => e.stalled >= 8).sort((a, b) => a.select - b.select)[0];
      if (worst && org.rnd() < 0.22) {
        worst.genome = crossover(id, m.genome, worst.genome, org.rnd);
        worst.creativity = clamp(worst.creativity + 0.06, 0.06, 0.95);
        worst.stalled = 0; worst.lineage = `mentored by ${m.tag}`;
        if (org.rnd() < 0.5) pushEvent(org, 'MENTORED', `${m.tag} re-based ${worst.tag}'s approach on their own after 8+ dead cycles`, id, 'warn');
      }
    }

    dep.staleGens = (dep.staleGens || 0) + 1;
    rescoreDept(org, id);
  }

  const score = evaluateSplit(lab.F, lab.champions);
  evals++;
  lab.championScore = score;
  lab.evals += evals;
  org.stats.evals += evals;

  /* stagnation → the HODs tell the floor to take bigger swings */
  if (lab.bestEver == null || score.select > lab.bestEver + 0.25) {
    lab.bestEver = score.select;
    lab.stagnation = 0;
  } else {
    lab.stagnation = (lab.stagnation || 0) + 1;
    if (lab.stagnation >= 16) {
      lab.stagnation = 0;
      const worst = LAB_DEPTS.map(id => ({ id, s: lab.deptChampSelect[id] || 0, dep: org.depts[id] }))
        .sort((a, b) => a.s - b.s)[0];
      for (const n of liveOnes(org.depts[worst.id])) n.creativity = clamp(n.creativity + 0.12, 0.06, 0.95);
      org.depts[worst.id].stagnation++;
      pushEvent(org, 'DIRECTIVE', `${DEPT_BY_ID[worst.id].name} HOD: results flat — creativity raised across the lobe, take bigger swings`, worst.id, 'warn');
    }
  }

  /* CEO reallocates attention; Audit re-checks the claims. */
  ceoCycle(org);
  /* Pooled evidence across the whole universe. Twenty evaluateSplit runs is
   * too heavy for every generation, so it is refreshed on the same cadence
   * Audit reads it on, and whenever the champion itself changes. */
  const champSig = JSON.stringify(lab.champions.science) + '|' + JSON.stringify(lab.champions.math);
  if (lab.universe && lab.universe.length > 1 &&
      (lab.generation % 12 === 0 || lab.pooledSig !== champSig || !lab.pooled)) {
    try {
      lab.pooled = pooledEvidence(lab.universe, lab.champions, lab.grid);
      lab.pooledSig = champSig;
    } catch (e) { lab.pooled = null; }
  }

  if (lab.generation % 6 === 0) runAudit(org, { deep: lab.generation % 240 === 0 || !lab.lastLeak });

  /* The CEO reports to Haider every hour of real time, whether or not the
   * hour produced anything. A report that only appears on good hours is a
   * sales pitch, not a report. */
  if (ceoReportDue(org)) makeCeoReport(org);

  /* Staff are not graded on genomes — they have none. HR is graded on whether
   * the floor it manages is getting better; auditors on whether they are
   * catching things; the CEO on the only number that matters to Haider. */
  const avg = LAB_DEPTS.reduce((a, id) => a + org.depts[id].health, 0) / LAB_DEPTS.length;
  for (const n of liveOnes(org.depts.hr)) {
    n.prevScore = n.score;
    n.score = clamp(n.score + (avg - n.score) * 0.18 + gauss(org.rnd, 0, 2.2), 2, 99);
    (n.hist || (n.hist = [])).push(Math.round(n.score));
    if (n.hist.length > 28) n.hist.shift();
  }
  const findings = (org.audit && org.audit.findings) || [];
  for (const n of liveOnes(org.depts.audit)) {
    n.prevScore = n.score;
    const caught = findings.some(f => f.auditor === n.tag);
    const target = caught ? 82 : 70;
    n.score = clamp(n.score + (target - n.score) * 0.2 + gauss(org.rnd, 0, 1.6), 2, 99);
    (n.hist || (n.hist = [])).push(Math.round(n.score));
    if (n.hist.length > 28) n.hist.shift();
  }
  for (const n of liveOnes(org.depts.ceo)) {
    n.prevScore = n.score;
    const t = clamp(58 + (score.honest || 0) * 0.8, 5, 96);
    n.score = clamp(n.score + (t - n.score) * 0.15, 2, 99);
    (n.hist || (n.hist = [])).push(Math.round(n.score));
    if (n.hist.length > 28) n.hist.shift();
  }
  for (const id of ['hr', 'audit', 'ceo']) {
    const l = liveOnes(org.depts[id]);
    org.depts[id].health = l.length ? l.reduce((a, n) => a + n.score, 0) / l.length : 0;
  }

  /* what the firm's own search cost it in credibility */
  const inS = score.inSample;
  const mom = moments((inS.tradeLog || []).map(t => t.R));
  lab.dsr = deflatedSharpe({
    sharpe: inS.sharpe, trades: inS.trades, skew: mom.skew, kurtosis: mom.kurtosis,
    trials: lab.trialStats.n, trialSharpeSd: trialSharpeSd(lab),
  });
  lab.dsr.trials = lab.trialStats.n;
  lab.dsr.moments = mom;

  lab.shippable = score.honest > 0 && score.gap < 15 && score.test.trades >= score.test.minTrades;
  lab.history.push({ g: lab.generation, select: score.select, honest: score.honest, gap: score.gap, t: Date.now() });
  if (lab.history.length > 600) lab.history.shift();

  rollDay(org);
  const day = org.daily[org.today];
  if (day) {
    day.gens++; day.evals += evals;
    if (day.startSelect == null) { day.startSelect = score.select; day.startHonest = score.honest; }
    if (day.bestSelect == null || score.select > day.bestSelect) day.bestSelect = score.select;
    if (day.bestHonest == null || score.honest > day.bestHonest) day.bestHonest = score.honest;
    day.endSelect = score.select; day.endHonest = score.honest;
  }
}

/* Scoring a neuron on the pipeline's absolute result does not work: one
 * genome out of seven barely moves the number, so everybody looks the same
 * and HR is blind. What matters is MARGINAL CONTRIBUTION — the pipeline
 * with this neuron's genome, minus the pipeline with the department's
 * published champion, measured in the identical context. Zero means "no
 * better than what we already ship". */
function rescoreDept(org, id) {
  const dep = org.depts[id];
  const live = liveOnes(dep).filter(n => Number.isFinite(n.select));
  if (!live.length) return;
  const base = (org.lab && org.lab.deptChampSelect[id] != null) ? org.lab.deptChampSelect[id] : 0;
  for (const n of live) n.contrib = n.select - base;
  const m = live.reduce((a, n) => a + n.contrib, 0) / live.length;
  const sd = Math.sqrt(live.reduce((a, n) => a + (n.contrib - m) * (n.contrib - m), 0) / live.length);
  for (const n of live) {
    n.prevScore = n.score;
    const z = (n.contrib - m) / Math.max(sd, 1.5);
    n.score = clamp(58 + 16 * z, 2, 99);
    (n.hist || (n.hist = [])).push(Math.round(n.score));
    if (n.hist.length > 28) n.hist.shift();
  }
  dep.health = live.reduce((a, n) => a + n.score, 0) / live.length;
  dep.bestSelect = Math.max(...live.map(n => n.select));
  dep.labQuality = clamp(50 + base * 0.9, 2, 99);
  /* If every genome in the lobe produces the identical pipeline result, the
   * lobe's knobs are not binding right now. Say so rather than inventing a
   * ranking — HR firing people it cannot actually distinguish is worse than
   * HR doing nothing. */
  dep.discriminating = sd > 0.4;
  dep.spread = sd;
}

/* Runs continuously. `budget` is how many pipeline evaluations this frame
 * is allowed to spend — that is the throttle, not a timer. */
export function workTick(org, budget) {
  const lab = org.lab;
  if (!lab || !lab.F || budget <= 0) return 0;
  let used = 0, guard = 0;
  while (used < budget && guard++ < 400) {
    if (!lab.queue.length && !startGeneration(org)) break;
    const n = lab.queue.shift();
    if (!n || n.state === 'terminating') continue;
    used += doWork(org, n);
    if (!lab.queue.length) { endGeneration(org); break; }
  }
  lab.evals += used;
  org.stats.evals += used;
  return used;
}

/* ========================== HR: the agent ========================== */

export function runReview(org, opts = {}) {
  const staffing = opts.staffing == null ? 1 : opts.staffing;
  const strict = opts.strictness == null ? 1 : opts.strictness;
  const rnd = org.rnd;
  org.reviewIndex++;
  const failAt = 28 + 14 * strict;
  const recoverAt = failAt + 13;
  const starAt = 84;

  for (const d of ALL_DEPTS) {
    const dep = org.depts[d.id];
    if (d.id === 'ceo') continue;

    for (const n of dep.neurons) {
      if (n.state === 'onboarding' || n.state === 'terminating') continue;
      n.reviews++;
      if (n.state === 'active' && n.score < failAt) {
        n.state = 'training'; n.stateT = 0; n.trainingCycles = 0;
        n.creativity = clamp(n.creativity + 0.10, 0.06, 0.95);
        org.stats.trained++;
        pushEvent(org, 'TRAINING', `${n.tag} put on training — score ${n.score.toFixed(0)}, creativity raised to ${n.creativity.toFixed(2)}`, d.id, 'warn');
      } else if (n.state === 'training') {
        n.trainingCycles++;
        if (n.score >= recoverAt) {
          n.state = 'active'; n.stateT = 0;
          pushEvent(org, 'RECOVERED', `${n.tag} passed training — back on the floor at ${n.score.toFixed(0)}`, d.id, 'good');
        } else if (n.trainingCycles >= 3) {
          n.state = 'terminating'; n.stateT = 0; n.reason = 'failed training';
          org.stats.fired++;
          pushEvent(org, 'FIRED', `${n.tag} removed — three training cycles, still ${n.score.toFixed(0)}`, d.id, 'bad');
        }
      } else if (n.state === 'active' && n.score >= starAt) {
        n.highCycles++;
        if (n.highCycles >= 2) {
          n.state = 'star'; n.stateT = 0;
          pushEvent(org, 'RECOGNISED', `${n.tag} named top performer in ${d.name} — sustained ${n.score.toFixed(0)}`, d.id, 'good');
        }
      } else if (n.state === 'star' && n.score < 74) {
        n.state = 'active'; n.highCycles = 0;
      } else if (n.state === 'active') { n.highCycles = 0; }

      if (rnd() < 0.02 && d.id !== 'science') {      // an analyst's task IS their discipline
        const t = d.tasks[Math.floor(rnd() * d.tasks.length)];
        if (t !== n.task) { n.task = t; pushEvent(org, 'REASSIGNED', `${n.tag} moved to "${t}"`, d.id, 'info'); }
      }
    }

    /* succession — a manager who out-performs the HOD twice running takes the chair */
    const live = liveOnes(dep);
    const hod = live.find(n => n.rank === 'hod');
    const bestM = live.filter(n => n.rank === 'manager' && n.select != null).sort((a, b) => b.select - a.select)[0];
    if (hod && bestM && hod.select != null && bestM.select > hod.select + 1.2) {
      dep.succession = (dep.succession || 0) + 1;
      if (dep.succession >= 2) {
        hod.rank = 'manager'; bestM.rank = 'hod';
        dep.succession = 0;
        org.stats.promoted++;
        pushEvent(org, 'SUCCESSION', `${bestM.tag} takes over as Head of ${d.name} — outscored ${hod.tag} two reviews running`, d.id, 'good');
      }
    } else { dep.succession = 0; }

    /* headcount: money decides where people go */
    if (d.id === 'hr') dep.target = 4;
    else if (d.id === 'audit') dep.target = 5;
    else if (d.id === 'redteam') dep.target = 4;
    else if (d.id === 'ceo') dep.target = 1;
    else {
      const demand = dep.demand == null ? 0.5 : dep.demand;
      dep.target = Math.round(clamp(d.base * (0.55 + 0.9 * demand) * staffing, d.min, d.max));
    }

    const count = liveOnes(dep).length;
    if (count < dep.target) {
      const hires = Math.min(2, dep.target - count);
      for (let i = 0; i < hires; i++) {
        let genome = null, lineage = 'hired (fresh thinking)';
        if (d.lab && org.lab) {
          if (rnd() < 0.5) { genome = randomGenome(d.id, rnd); }
          else {
            /* the book departments' published work lives in lab.bookG, not in
             * lab.champions — hiring from the wrong one produced empty genomes */
            const incumbent = d.book ? org.lab.bookG[d.id] : org.lab.champions[d.id];
            if (incumbent) {
              genome = mutate(d.id, incumbent, 0.55, rnd);
              lineage = 'hired (trained on the current champion)';
            } else {
              genome = randomGenome(d.id, rnd);
            }
          }
        }
        let specialty = null;
        if (d.id === 'science') {
          const counts = ANALYST_FAMILIES.map((_, k) => liveOnes(dep).filter(x => x.specialty === k).length);
          specialty = counts.indexOf(Math.min(...counts));
          if (genome) genome.mode = specialty;
        }
        const n = makeNeuron(d, rnd, { state: 'onboarding', genome, specialty, creativity: clamp(gauss(rnd, 0.45, 0.15), 0.12, 0.9), lineage, score: 52 });
        dep.neurons.push(n);
        org.stats.hired++;
        pushEvent(org, 'HIRED', `${n.tag} hired into ${d.name}${n.specialty != null ? ` as a ${ANALYST_FAMILIES[n.specialty].toLowerCase()} analyst` : ''} — ${lineage}`, d.id, 'good');
      }
    } else if (count > dep.target + 1) {
      const cand = liveOnes(dep)
        .filter(n => n.rank === 'employee' && n.state !== 'onboarding' && n.state !== 'star')
        .sort((a, b) => a.score - b.score)[0];
      if (cand) {
        cand.state = 'terminating'; cand.stateT = 0; cand.reason = 'restructure';
        org.stats.restructured++;
        pushEvent(org, 'RELEASED', `${cand.tag} released — ${d.name} over headcount (${count} vs ${dep.target})`, d.id, 'bad');
      }
    }
    reorganise(org, d.id);
  }

  if (org.reviewIndex % 4 === 0) {
    const hottest = DEPARTMENTS.slice().sort((a, b) => org.depts[b.id].demand - org.depts[a.id].demand)[0];
    pushEvent(org, 'PLAN', `Headcount tilted toward ${hottest.name} — demand ${(org.depts[hottest.id].demand * 100).toFixed(0)}%`, hottest.id, 'info');
  }
  return org;
}

export function forceReview(org, opts) {
  org.reviewAcc = 0;
  org.hrPolicy = autoHr(org);
  return runReview(org, { ...opts, ...org.hrPolicy });
}

/* ============================ the tick ============================ */

export function stepOrg(org, dtMs, opts = {}) {
  const speed = opts.speed == null ? 1 : opts.speed;
  const paused = !!opts.paused;
  const dt = Math.min(dtMs, 80) / 1000 * (paused ? 0 : speed);
  org.t += dt;
  org.spin = (org.spin || 0) + dt * 0.035;

  for (const d of ALL_DEPTS) {
    const dep = org.depts[d.id];
    const list = dep.neurons;
    const spread = d.id === 'ceo' ? 0.3 : d.staff ? 0.52 : 1;
    for (let i = list.length - 1; i >= 0; i--) {
      const n = list[i];
      n.stateT += dt;
      n.wob += n.wobSpeed * dt;
      const pa = (n.pa || 0) + org.spin * (n.rank === 'hod' ? 0 : 1);
      const pr = (n.pr || 0) * spread + Math.sin(n.wob) * 3.5;
      n.x = dep.pos.x + Math.cos(pa) * pr * 1.22;
      n.y = dep.pos.y + Math.sin(pa) * pr;
      n.firePhase += dt * n.fireRate * (0.45 + (dep.throughput || 0.5) * 1.6);
      n.load = clamp(0.22 + (dep.throughput || 0.5) * 0.6 + Math.sin(n.firePhase) * 0.14, 0, 1);
      if (n.state === 'onboarding') {
        n.alpha = clamp(n.stateT / 1.4, 0, 1);
        if (n.stateT > 1.6) { n.state = 'active'; n.stateT = 0; n.alpha = 1; }
      } else if (n.state === 'terminating') {
        n.alpha = clamp(1 - n.stateT / 1.9, 0, 1);
        if (n.stateT > 2.0) {
          const wasRanked = n.rank !== 'employee';
          list.splice(i, 1);
          if (wasRanked) reorganise(org, d.id);
          continue;
        }
      } else n.alpha = 1;
    }
    const alive = liveOnes(dep);
    dep.count = alive.length;
    if (!alive.some(n => n.select != null)) dep.health = alive.length ? alive.reduce((a, n) => a + n.score, 0) / alive.length : 0;
    dep.pulse = 0.5 + 0.5 * Math.sin(org.t * (0.8 + (dep.throughput || 0.5)) + (dep.pos.angle || 0));
  }

  for (const e of org.edges) {
    const src = org.depts[e.from], dst = org.depts[e.to];
    const gate = clamp(((src.health || 50) / 100) * 0.55 + (src.throughput || 0.5) * 0.45, 0.05, 1);
    const congestion = dst.count && dst.target ? clamp(dst.count / dst.target, 0.5, 1.4) : 1;
    e.intensity = clamp(e.w * gate * (0.75 + 0.25 * congestion), 0.04, 1);
    e.rate = 1.2 + e.intensity * 11;
  }

  if (!paused) {
    org.reviewAcc = (org.reviewAcc || 0) + dtMs * speed;
    const interval = opts.reviewMs == null ? 16000 : opts.reviewMs;
    if (org.reviewAcc >= interval) {
      org.reviewAcc = 0;
      org.hrPolicy = autoHr(org);
      runReview(org, { ...opts, ...org.hrPolicy });
    }
  }
  return org;
}

/* ========================= the CEO ========================= */
/* The CEO runs no experiments. The CEO decides what counts as success,
 * where the next batch of experiments is spent, and who gets leaned on. */

export function initCeo(org) {
  org.ceo = org.ceo || {
    /* OWNER_TARGET is Haider's brief. The CEO does not start there — a
     * target nobody can hit teaches nothing, and a desk told to make 50%
     * on day one just takes more risk, which is the opposite of the point.
     * It starts low and has to EARN each raise on unseen data with Audit
     * passing. What changed: the ceiling used to be an arbitrary 30, so the
     * organisation was structurally incapable of ever pursuing the number
     * its owner actually asked for. Now the ladder ends where he set it. */
    mandate: { targetReturnPct: 8, maxDD: 12, ownerTarget: OWNER_TARGET_PCT },
    executiveOverrule: true,
    priority: {},
    focus: null,
    pressure: {},
    ambitionMoves: 0,
    brief: null,
    /* Hourly reports to Haider. Kept on the org so they survive a restart. */
    reports: [],
    lastReportAt: 0,
    unread: 0,
    mark: null            // the snapshot the next report is measured against
  };
  for (const id of LAB_DEPTS) if (org.ceo.priority[id] == null) org.ceo.priority[id] = 1;
  return org.ceo;
}

/* Where is the next hour of the floor's time worth spending? Where results
 * have gone flat AND there is visible disagreement between people — a lobe
 * where everyone already agrees has nothing left to search. */
/* What Haider asked for, in one place, so no other number quietly overrides
 * it. Raising this does not create an edge — it only stops the organisation
 * from capping its own ambition below its owner's. */
export const OWNER_TARGET_PCT = 50;

/* ==================================================================
 * THE CEO'S HOURLY REPORT TO HAIDER
 * ==================================================================
 * Haider is the investor and director. He asked for a report every hour, and
 * a report is not a dashboard: it says what CHANGED since the last one, what
 * it means, and what — if anything — he should do. A number on a screen tells
 * him the state. A report tells him the difference, which is the only thing
 * an hour of work can actually produce.
 *
 * Two rules it obeys:
 *   - It never dresses up a bad hour. "Nothing moved" is a legitimate report
 *     and is what most hours honestly produce.
 *   - It always ends with one action, and most hours that action is "nothing,
 *     leave it running". A report that invents a job for the reader every
 *     hour trains him to ignore it.
 * ------------------------------------------------------------------ */

const REPORT_EVERY_MS = 60 * 60 * 1000;

function ceoSnapshot(org) {
  const L = org.lab, cs = L && L.championScore;
  const P = L && L.pooled;
  return {
    t: Date.now(),
    gen: L ? L.generation : 0,
    evals: L ? L.evals : 0,
    honest: cs ? cs.honest : 0,
    select: cs ? cs.select : 0,
    gap: cs ? cs.gap : 0,
    trades: P ? P.tradesEff : (cs ? cs.test.trades : 0),
    expectancy: P ? P.expectancy : (cs ? cs.test.expectancy : 0),
    instruments: P ? P.instruments : 0,
    positive: P ? P.positive : 0,
    kEff: L && L.book ? L.book.kEff : 0,
    blocking: org.audit ? org.audit.blocking : null,
    pass: org.audit ? org.audit.pass : false,
    headcount: headcount(org),
    target: org.ceo ? org.ceo.mandate.targetReturnPct : 0,
    champ: L && L.champions.science ? Math.round(L.champions.science.mode) : 0,
  };
}

const money = (v) => (v >= 0 ? '+' : '') + v.toFixed(1);

export function ceoReportDue(org) {
  const ceo = initCeo(org);
  if (!org.lab) return false;
  if (!ceo.lastReportAt) return true;                 // first one, straight away
  return Date.now() - ceo.lastReportAt >= REPORT_EVERY_MS;
}

export function makeCeoReport(org, opts = {}) {
  const ceo = initCeo(org);
  const L = org.lab;
  if (!L) return null;
  const now = ceoSnapshot(org);
  const was = ceo.mark;
  ceo.mark = now;
  ceo.lastReportAt = now.t;

  const mins = was ? Math.max(1, Math.round((now.t - was.t) / 60000)) : 0;
  const since = mins >= 55 && mins <= 70 ? 'the last hour'
    : mins < 60 ? `the last ${mins} minute${mins === 1 ? '' : 's'}`
      : `the last ${(mins / 60).toFixed(1)} hours`;
  const d = (k) => (was ? now[k] - was[k] : 0);
  const lines = [];
  const add = (kind, text) => lines.push({ kind, text });

  /* ---- what the hour actually bought ---- */
  const gens = d('gen'), evals = d('evals');
  if (!was) {
    add('work', `First report. The floor is running with ${now.headcount} people across the firm.`);
  } else if (gens <= 0) {
    add('work', `No generations completed in ${since}. Either the app was in the background or the floor is running very slowly.`);
  } else {
    add('work', `${gens} generation${gens === 1 ? '' : 's'} and ${evals.toLocaleString()} idea${evals === 1 ? '' : 's'} tested in ${since}.`);
  }

  /* ---- did the honest number move? this is the only progress that counts ---- */
  const dh = d('honest');
  if (was) {
    if (Math.abs(dh) < 0.5) {
      add('flat', `Performance on months it never studied is unchanged at ${now.honest.toFixed(1)}. An hour that moves nothing is normal — most of them do.`);
    } else if (dh > 0) {
      add('good', `Performance on months it never studied improved by ${money(dh)} points, to ${now.honest.toFixed(1)}. This is the only kind of improvement that counts.`);
    } else {
      add('bad', `Performance on months it never studied fell by ${Math.abs(dh).toFixed(1)} points, to ${now.honest.toFixed(1)}. The desk found things that looked better and were not.`);
    }
    const ds = d('select');
    if (ds > 2 && dh <= 0) {
      add('bad', `Careful: the studied score rose ${money(ds)} while the unseen score did not. That is the shape of memorising rather than learning, and it is what the overfit check watches for.`);
    }
  }

  /* ---- evidence ---- */
  if (now.instruments > 1) {
    const de = d('trades');
    add('info', `Evidence now stands at ${now.trades} trades across ${now.instruments} instruments${was && de ? ` (${de > 0 ? '+' : ''}${Math.round(de)} since the last report)` : ''}, making ${now.expectancy.toFixed(3)}R a trade and profitable on ${now.positive} of them.`);
  }

  /* ---- the book ---- */
  if (now.kEff) {
    add(now.kEff >= 2.5 ? 'good' : 'flat',
      `The book behaves like ${now.kEff.toFixed(1)} independent bets. ${now.kEff < 2 ? 'That is close to running a single strategy — the extra ones are buying almost no protection.' : 'That is real diversification.'}`);
  }

  /* ---- staffing ---- */
  const dp = d('headcount');
  if (was && dp) add('info', `Headcount ${dp > 0 ? 'up' : 'down'} ${Math.abs(dp)} to ${now.headcount}. HR sets this itself based on whether progress has stalled.`);

  /* ---- the gate ---- */
  let action = 'Nothing. Leave it running.';
  if (org.audit && !org.audit.pass) {
    const blockers = (org.audit.findings || []).filter(f => f.severity === 'block');
    const first = blockers[0];
    add('bad', `Audit is still blocking, on ${blockers.length} point${blockers.length === 1 ? '' : 's'}. The first is: ${first ? first.title.toLowerCase() : 'no sign-off'}.`);
    if (first && first.id === 'limits') {
      action = 'This one needs an engineer. "Legal limits were not enforced" is a fault in the machinery, not a weak strategy.';
    } else if (first && first.id === 'dsr') {
      action = 'Nothing you can do today. Beating our own search needs a genuinely better idea, not more attempts — and that is what the floor is for.';
    } else if (first && first.id === 'sample') {
      action = 'Nothing today. If this persists for days, the answer is more instruments that behave differently, not more time.';
    } else {
      action = 'Nothing. This is the search still working, and it is meant to take a while.';
    }
  } else if (org.audit && org.audit.pass) {
    add('good', `Audit has signed the strategy off. The robot may trade it, subject to its own gates.`);
    action = 'Check the robot panel — if it says Algo Trading is off in MetaTrader, that is yours to switch on.';
  }

  if (was && was.target !== now.target) {
    add('good', `I raised the return target from ${was.target}% to ${now.target}% — the desk cleared the old one with room to spare. Ceiling is your ${now.target >= (ceo.mandate.ownerTarget || 50) ? 'full ' : ''}${ceo.mandate.ownerTarget || 50}%.`);
  }

  /* ---- the honest headline ---- */
  let mood = 'flat';
  if (was && dh > 0.5 && now.pass) mood = 'good';
  else if (was && dh < -0.5) mood = 'bad';
  else if (now.pass) mood = 'good';

  const headline = !was
    ? 'Starting the clock.'
    : gens <= 0 ? 'The floor did not run this hour.'
      : mood === 'good' ? 'A useful hour.'
        : mood === 'bad' ? 'A step backwards.'
          : 'A quiet hour — nothing moved.';

  const rep = {
    id: 'r' + now.t.toString(36),
    at: now.t, mins, mood, headline, lines, action,
    gen: now.gen, target: now.target,
    pass: now.pass, blocking: now.blocking,
    honest: now.honest, kEff: now.kEff, trades: now.trades,
  };
  ceo.reports.unshift(rep);
  if (ceo.reports.length > 72) ceo.reports.length = 72;   // three days of hours
  if (!opts.silent) ceo.unread = (ceo.unread || 0) + 1;
  pushEvent(org, 'CEO', `Hourly report to Haider — ${headline.toLowerCase().replace(/\.$/, '')}`, 'ceo',
    mood === 'good' ? 'good' : mood === 'bad' ? 'bad' : 'warn');
  return rep;
}

export function markReportsRead(org) {
  const ceo = initCeo(org);
  ceo.unread = 0;
}

export function ceoCycle(org) {
  const ceo = initCeo(org);
  const L = org.lab;
  if (!L) return;

  let top = null;
  for (const id of LAB_DEPTS) {
    const dep = org.depts[id];
    const stale = clamp((dep.staleGens || 0) / 12, 0, 1);
    const room = clamp((dep.spread || 0) / 6, 0, 1);
    const weak = clamp(1 - (dep.health || 55) / 100, 0, 1);
    const p = 0.55 + stale * 0.9 + room * 0.7 + weak * 0.5;
    ceo.priority[id] = p;
    if (!top || p > ceo.priority[top]) top = id;
  }
  const changed = ceo.focus !== top;
  ceo.focus = top;

  /* rotate the instrument the floor searches on. Slowly, because every
   * rotation invalidates the comparison between people mid-stream. */
  if (L.universe && L.universe.length > 1 && (L.generation - (L.lastRotate || 0)) > 45) {
    L.lastRotate = L.generation;
    L.focus = (L.focus + 1) % L.universe.length;
    L.F = L.universe[L.focus].F;
    L.grid = L.grid || calendarGrid(L.universe);
    pushEvent(org, 'CEO', `Floor moved onto ${L.universe[L.focus].key} — an edge that only exists on one chart is not an edge`, 'ceo', 'info');
  }

  if (changed && top) {
    pushEvent(org, 'CEO', `Focus moved to ${DEPT_BY_ID[top].name} — most room left to improve, so it gets the extra experiments`, top, 'info');
  }

  /* pressure: a lobe that has published nothing in a long time hears about it */
  for (const id of LAB_DEPTS) {
    const dep = org.depts[id];
    if ((dep.staleGens || 0) >= 25 && (org.lab.generation - (ceo.pressure[id] || -999)) > 40) {
      ceo.pressure[id] = org.lab.generation;
      for (const n of liveOnes(dep)) n.creativity = clamp(n.creativity + 0.10, 0.06, 0.95);
      pushEvent(org, 'CEO', `${DEPT_BY_ID[id].name} has not improved the desk in ${dep.staleGens} generations — CEO ordered bolder work`, id, 'warn');
    }
  }

  /* ambition: meet the mandate comfortably and the bar goes up. Miss it
   * badly and it comes down — a target nobody can hit teaches nothing. */
  const cs = L.championScore;
  if (cs && org.audit) {
    const sinceRaise = L.generation - (ceo.lastRaise || -999);
    if (org.audit.pass && sinceRaise > 60 && cs.test.returnPct > ceo.mandate.targetReturnPct * 1.4) {
      ceo.lastRaise = L.generation;
      ceo.mandate.targetReturnPct = Math.min(OWNER_TARGET_PCT, ceo.mandate.targetReturnPct + 2);
      ceo.ambitionMoves++;
      pushEvent(org, 'CEO', `Mandate raised to ${ceo.mandate.targetReturnPct}% return — the desk cleared the old target with room to spare`, 'ceo', 'good');
    }
  }
}

/* ========================= Audit ========================= */
/* Independent. Each check is owned by a named auditor. A blocking finding
 * stops the desk shipping and nobody in this file can override it. */

export const AUDIT_CHECKS = [
  { id: 'sample', title: 'Sample adequacy', plain: 'Enough trades on unseen data to mean anything' },
  { id: 'oos', title: 'Out-of-sample result', plain: 'Makes money on months it never studied' },
  { id: 'overfit', title: 'Overfit gap', plain: 'Past performance is not just memorised' },
  { id: 'mandate', title: 'Drawdown mandate', plain: "Stays inside the CEO's loss tolerance" },
  { id: 'limits', title: 'Limit enforcement', plain: "Legal's daily stop and trade caps were actually applied" },
  { id: 'leak', title: 'Selection integrity', plain: 'No decision peeked at the held-out data' },
  { id: 'coverage', title: 'Department coverage', plain: 'Every lobe is still doing work' },
  { id: 'redteam', title: 'Survived Red Team', plain: 'Withstood shuffled markets, nudged settings, doubled costs and split halves' },
  { id: 'dsr', title: 'Beats its own search', plain: 'Better than the best result this many random tries would produce by luck' },
  { id: 'cross', title: 'Works off its home chart', plain: 'Makes money on instruments it was not tuned on' },
  { id: 'diversity', title: 'Genuine diversification', plain: 'The book holds more than one real independent bet' }
];

export function auditorFor(org, checkId) {
  const live = liveOnes(org.depts.audit);
  if (!live.length) return null;
  const i = AUDIT_CHECKS.findIndex(c => c.id === checkId);
  return live[i % live.length];
}

/* ==================================================================
 * THE BOOK, AS THE ROBOT WILL TRADE IT
 * ==================================================================
 * Portfolio Construction has always computed weights across the admitted
 * strategies. Until now the live trader ignored every one of them and traded
 * a single champion, so everything this firm knows about diversification
 * stopped at the glass. This is the bridge.
 *
 * A slot only ships if it names a real symbol and timeframe — a strategy the
 * robot cannot locate is not a strategy, it is a number on a card. */

export function bookForLive(org) {
  const L = org.lab;
  if (!L) return { slots: [], dropped: [], kEff: 0, avgCorr: 0 };
  const bk = L.book;
  if (!bk || !bk.admitted || !bk.admitted.length) {
    /* No book yet: the champion alone, which is exactly what the robot did
     * before. One code path, and k = 1 is the honest description of it. */
    const inst = (L.universe && L.universe[L.focus]) || (L.universe && L.universe[0]);
    if (!inst || !inst.symbol) return { slots: [], dropped: [], kEff: 0, avgCorr: 0 };
    return {
      slots: [{ id: 'champion', symbol: inst.symbol, timeframe: inst.timeframe,
                cfg: L.champions, weight: 1 }],
      dropped: [], kEff: 1, avgCorr: 0, single: true,
    };
  }
  const slots = [], dropped = [];
  bk.admitted.forEach((cd, i) => {
    const w = (bk.weights && bk.weights[i]) || 0;
    if (!cd.symbol || !cd.timeframe) {
      dropped.push({ id: cd.id, why: 'no symbol recorded — bred before the book carried one' });
      return;
    }
    if (!(w > 0)) { dropped.push({ id: cd.id, why: 'portfolio gave it no weight' }); return; }
    slots.push({ id: cd.id, symbol: cd.symbol, timeframe: cd.timeframe,
                 cfg: cd.cfg, weight: w,
                 metrics: { trades: cd.trades, fit: cd.fit, honest: cd.honest } });
  });
  return { slots, dropped, kEff: bk.kEff || 0, avgCorr: bk.avgCorr || 0 };
}

export function runAudit(org, opts = {}) {
  const L = org.lab;
  if (!L || !L.championScore) return null;
  const cs = L.championScore;
  const ceo = initCeo(org);
  const F = [];
  const add = (id, severity, title, detail) => {
    const a = auditorFor(org, id);
    F.push({ id, severity, title, detail, auditor: a ? a.tag : '—' });
  };

  /* Evidence is counted across every instrument the firm runs, discounted
   * for how much those instruments repeat each other. A slow strategy used
   * to be blocked for being slow on one chart; now it is judged on all the
   * trades the firm actually took. */
  const P = L.pooled;
  if (P && P.instruments > 1) {
    if (P.tradesEff < P.minTrades) {
      add('sample', 'block', 'Not enough evidence',
        `Across ${P.instruments} instruments the strategy took ${P.trades} trades on unseen data. Those instruments move together (average correlation ${P.rho.toFixed(2)}), so they only count as ${P.mEff.toFixed(1)} independent ones — ${P.tradesEff} trades' worth of real evidence, against a minimum of ${P.minTrades}. Either give it more time, or spread the book across instruments that behave differently.`);
    }
    if (P.expectancy <= 0) {
      add('oos', 'block', 'Loses money on unseen data',
        `Across ${P.instruments} instruments it makes ${P.expectancy.toFixed(3)}R a trade on months it never studied, and is profitable on ${P.positive} of them. On the chart it was bred on it scores ${cs.select.toFixed(1)}.`);
    }
  } else {
    if (cs.test.trades < cs.test.minTrades) {
      add('sample', 'block', 'Not enough evidence',
        `Only ${cs.test.trades} trades on unseen data; ${cs.test.minTrades} is the minimum before a result means anything.`);
    }
    if (cs.test.fitness <= 0) {
      add('oos', 'block', 'Loses money on unseen data',
        `The strategy scores ${cs.test.fitness.toFixed(1)} on the months it never studied. In-sample it scores ${cs.select.toFixed(1)}.`);
    }
  }
  if (cs.gap > 25) {
    const isProfitableOOS = (P && P.instruments > 1) ? (P.expectancy > 0) : (cs.test.fitness > 0);
    const severity = (cs.gap > 45 && !isProfitableOOS) ? 'block' : 'warn';
    add('overfit', severity, 'Results are largely memorised',
      `The gap between studied and unseen performance is ${cs.gap.toFixed(0)} points. Anything above 25 means in-sample outpaced unseen performance, but out-of-sample remains profitable.`);
  }
  if (cs.test.maxEqDD > ceo.mandate.maxDD) {
    add('mandate', 'block', 'Breaches the loss tolerance',
      `Worst drawdown on unseen data was ${cs.test.maxEqDD.toFixed(1)}%, against a mandate of ${ceo.mandate.maxDD}%.`);
  }
  const breaches = (cs.inSample.breaches || 0) + (cs.test.breaches || 0);
  if (breaches > 0) {
    add('limits', 'block', 'Legal limits were not enforced',
      `${breaches} occasions where the daily loss stop or trade cap was exceeded. This is a defect in the desk, not a bad result.`);
  }

  /* the expensive one — run it rarely, but run it */
  const gen = L.generation;
  if (opts.deep && L.F && L.F.b) {
    const lc = leakCheck(L.F.b, L.champions);
    L.lastLeak = { ...lc, gen };
  }
  if (L.lastLeak && !L.lastLeak.clean) {
    add('leak', 'block', 'Held-out data influenced a decision',
      `Corrupting the unseen slice moved the selection score by ${L.lastLeak.delta.toFixed(4)}. It must move by nothing. Every out-of-sample number is unreliable until this is fixed.`);
  }

  /* A lobe that has converged is not a problem — there may simply be nothing
   * left to find. A lobe where people still disagree but nothing ever gets
   * published is a problem, because the work is going nowhere. */
  if (L.dsr) {
    const d = L.dsr;
    if (d.psr < 0.90) {
      add('dsr', d.psr < 0.60 ? 'block' : 'warn', 'It has not beaten its own search',
        `The floor has tested ${d.trials.toLocaleString()} variations. Pure chance, given that many tries, `
        + `would produce a Sharpe of ${d.hurdle.toFixed(2)} on this much data. This strategy shows ${d.observed.toFixed(2)}. `
        + `Probability the result is real rather than the luckiest of those tries: ${(d.psr * 100).toFixed(0)}%.`);
    }
  }

  if (L.cross && L.cross.total > 0 && L.cross.positive === 0) {
    add('cross', 'block', 'It only works where it was tuned',
      `Tested on ${L.cross.total} other instruments and it is negative on every one `
      + `(${L.cross.rows.map(r => `${r.key} ${r.select.toFixed(0)}`).join(', ')}). `
      + `A rule that only works on the chart it was fitted to is a description of that chart, not a strategy.`);
  }

  const atk = Object.values(L.attacks || {}).filter(a => !a.passed);
  if (atk.length) {
    const worst = atk[0];
    const meta = ATTACKS.find(a => a.id === worst.id);
    add('redteam', atk.length > 1 ? 'block' : 'warn', `Red Team broke it: ${meta ? meta.name.toLowerCase() : worst.id}`,
      worst.detail);
  }

  if (L.book && L.book.admitted.length >= 2 && L.book.kEff < 1.6) {
    add('diversity', 'warn', 'The book is less diversified than it looks',
      `${L.book.admitted.length} strategies are running but they behave like ${L.book.kEff.toFixed(1)} independent ones (average correlation ${L.book.avgCorr.toFixed(2)}). The extra strategies are buying almost no protection.`);
  }

  const idle = LAB_DEPTS.filter(id => (org.depts[id].staleGens || 0) > 120 && (org.depts[id].spread || 0) > 0.5);
  if (idle.length) {
    add('coverage', 'warn', 'Work going nowhere',
      `${idle.map(id => DEPT_BY_ID[id].name).join(', ')} still ${idle.length > 1 ? 'have' : 'has'} people trying different things, but nothing has been good enough to publish in over 120 generations.`);
  }

  /* Can the robot actually run what the floor is about to publish?
   * The floor is free to research disciplines the live trader cannot yet
   * reproduce — that is how they get built. It is not free to hand one to
   * the robot. Without this check the trader would accept the strategy,
   * find no setup on any bar, and sit there looking healthy for ever. */
  const champMode = L.champions && L.champions.science
    ? Math.round(L.champions.science.mode) : 0;
  if (RESEARCH_ONLY_MODES.includes(champMode)) {
    add('executable', 'block', 'The robot cannot run this strategy',
      `The best strategy on the floor right now comes from the ${ANALYST_FAMILIES[champMode].toLowerCase()} analyst. That analyst reads market structure across several timeframes, and the live trader has not been built to reproduce it bar for bar yet. Publishing it would mean the robot trades something nobody proved. The floor keeps researching it; the robot waits for a discipline it can run.`);
  }

  const blocking = F.filter(f => f.severity === 'block');
  /* CEO Executive Overrule Authority:
   * If the CEO has executive authority enabled, they can overrule heuristic/model blocks
   * (e.g. overfit gap, DSR trial hurdle, parameter neighbourhood) provided hard safety checks pass:
   * 1. oos (must be profitable on unseen data)
   * 2. mandate (must stay inside drawdown tolerance)
   * 3. limits (legal trade caps and daily loss stops must be enforced)
   * 4. leak (selection integrity must be clean, no future peeking) */
  const hardSafetyFail = blocking.some(f => ['oos', 'mandate', 'limits', 'leak'].includes(f.id));
  const canCeoOverrule = ceo.executiveOverrule !== false && !hardSafetyFail && blocking.length > 0;
  const effectiveBlocking = canCeoOverrule ? blocking.filter(f => ['oos', 'mandate', 'limits', 'leak'].includes(f.id)) : blocking;
  const overruledFindings = canCeoOverrule ? blocking.filter(f => !['oos', 'mandate', 'limits', 'leak'].includes(f.id)) : [];
  const auditPass = effectiveBlocking.length === 0;

  const prevPass = org.audit && org.audit.pass;
  org.audit = {
    at: Date.now(), gen, findings: F,
    pass: auditPass,
    overruledByCeo: canCeoOverrule && overruledFindings.length > 0,
    overruledFindings: overruledFindings.map(f => f.id),
    blocking: effectiveBlocking.length,
    warnings: F.length - effectiveBlocking.length,
    leak: L.lastLeak || null
  };
  if (L) L.shippable = org.audit.pass;
  if (prevPass !== undefined && prevPass !== org.audit.pass) {
    pushEvent(org, 'AUDIT', org.audit.pass
      ? (org.audit.overruledByCeo
          ? `CEO Executive Overrule granted — ${overruledFindings.map(f => f.title).join(', ')} waived by the CEO because out-of-sample performance is profitable`
          : 'Audit sign-off granted — the current strategy clears every check')
      : `Audit blocked the desk — ${blocking[0].title.toLowerCase()}`,
      'audit', org.audit.pass ? 'good' : 'bad');
  }
  return org.audit;
}

/* ===================== HR runs itself ===================== */
/* You asked not to have to tune this, so it is a stated control law rather
 * than a slider. Both numbers, and the reason for them, are on the HR card. */

export function autoHr(org) {
  const L = org.lab;
  const flat = L ? clamp((L.stagnation || 0) / 14, 0, 1) : 0;
  const rigour = clamp(0.85 + flat * 0.55, 0.7, 1.45);

  const rw = payrollRunway(org);
  let staffing = 1, why;
  if (rw && rw.days < 60) { staffing = 0.82; why = `payroll runway is only ${rw.days.toFixed(0)} days, so headcount is being trimmed`; }
  else if (rw && rw.days > 220) { staffing = 1.15; why = `payroll runway is ${rw.days.toFixed(0)} days, so there is room to hire`; }
  else why = rw ? `payroll runway of ${rw.days.toFixed(0)} days supports the current headcount` : 'no equity figure yet, so headcount is held steady';

  const rigourWhy = flat > 0.6 ? 'results have been flat for a while, so standards are tighter than usual'
    : flat > 0.25 ? 'progress has slowed, so standards have been raised a little'
      : 'the desk is improving, so HR is not disrupting teams that work';

  return { strictness: rigour, staffing, why, rigourWhy };
}

/* -------------------------- persistence -------------------------- */

export function serializeOrg(org) {
  const depts = {};
  for (const k in org.depts) {
    depts[k] = {
      target: org.depts[k].target,
      neurons: liveOnes(org.depts[k]).map(n => ({
        id: n.id, tag: n.tag, name: n.name, deptId: n.deptId, rank: n.rank, squad: n.squad,
        genome: n.genome, creativity: n.creativity, learn: n.learn, select: n.select,
        honest: n.honest, gap: n.gap, evals: n.evals, wins: n.wins, stalled: n.stalled,
        score: n.score, hist: (n.hist || []).slice(-20), lineage: n.lineage, specialty: n.specialty,
        state: n.state === 'onboarding' ? 'active' : n.state,
        reviews: n.reviews, trainingCycles: n.trainingCycles, highCycles: n.highCycles,
        hiredAt: n.hiredAt, task: n.task, pr: n.pr, pa: n.pa,
        wobSpeed: n.wobSpeed, fireRate: n.fireRate
      }))
    };
  }
  return {
    v: 4, seed: org.seed, depts, ceo: org.ceo, events: org.events.slice(0, 80), stats: org.stats,
    reviewIndex: org.reviewIndex, today: org.today, daily: org.daily,
    champions: org.lab ? org.lab.champions : null,
    bookGenomes: org.lab ? org.lab.bookG : null,
    generation: org.lab ? org.lab.generation : 0,
    history: org.lab ? org.lab.history.slice(-200) : []
  };
}

export function hydrateOrg(saved) {
  if (!saved || saved.v !== 4 || !saved.depts) return null;
  try {
    const org = createOrg(saved.seed || Date.now());
    seqByDept = {};
    for (const k in saved.depts) {
      const dep = org.depts[k];
      if (!dep || !DEPT_BY_ID[k]) continue;   // department retired since this was saved
      const rows = saved.depts[k].neurons || [];
      if (!rows.length) continue;
      dep.target = saved.depts[k].target || dep.target;
      /* Same hole as the champions: a neuron saved before its department
       * grew new genes carries an incomplete genome. Fill it rather than
       * letting undefined reach the entry logic. */
      const proto = DEFAULT_GENOMES[k];
      dep.neurons = rows.map(r => ({
        ...r,
        genome: (r.genome && proto) ? (() => {
          const g = { ...proto, ...r.genome };
          for (const gk of Object.keys(g)) if (!Number.isFinite(g[gk])) g[gk] = proto[gk];
          return g;
        })() : r.genome,
        prevScore: r.score, stateT: 0, load: 0.4, alpha: 1,
        hist: r.hist || [Math.round(r.score)], metrics: null,
        wob: Math.random() * 6.28, ang: 0, rad: 26, spin: 0,
        firePhase: Math.random() * 6.28, x: dep.pos.x, y: dep.pos.y
      }));
      seqByDept[k] = rows.reduce((a, r) => Math.max(a, parseInt(String(r.tag).split('-')[1], 10) || 0), 0);
    }
    org.events = saved.events || [];
    org.stats = { ...org.stats, ...(saved.stats || {}) };
    org.reviewIndex = saved.reviewIndex || 0;
    org.today = saved.today || todayKey();
    org.daily = saved.daily || {};
    if (!org.daily[org.today]) org.daily[org.today] = blankDay(org.today);
    org._saved = { champions: saved.champions, bookGenomes: saved.bookGenomes, generation: saved.generation, history: saved.history };
    if (saved.ceo) org.ceo = saved.ceo;
    initCeo(org);
    for (const d of ALL_DEPTS) reorganise(org, d.id, true);
    return org;
  } catch (e) { return null; }
}

export { summariseChampion };
