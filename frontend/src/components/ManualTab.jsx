import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  BookOpen, Compass, Eye, Radar, BarChart3, ShieldCheck, AlertTriangle,
  Target, Layers, HelpCircle, Search, ChevronRight, Bot, Users, Calendar, Bell
} from 'lucide-react';

/* ------------------------------------------------------------------
 * ManualTab — how to run Shah Investment Center.
 * ------------------------------------------------------------------
 * Written for Haider, who is the investor and director, not the quant.
 * Every rule here is stated in the words a person would use out loud, and
 * every number that appears in the app is explained in terms of what it
 * should make him DO, not what formula produced it.
 *
 * The organising idea: a manual nobody reads is worthless, so this is built
 * to be scanned. Left rail to jump, one idea per block, the important
 * sentence first, and the honest caveats in plain sight rather than buried
 * in footnotes.
 * ------------------------------------------------------------------ */

const C = {
  bg: '#0b0e14', panel: '#11151d', panel2: '#161b25', line: '#222836',
  ink: '#e6e9ef', dim: '#8b949e', faint: '#6e7681',
  good: '#22c55e', warn: '#eab308', bad: '#ef4444', cool: '#38bdf8',
  gold: '#fbbf24',
};

const SECTIONS = [
  { id: 'start', label: 'Start here', icon: Compass },
  { id: 'daily', label: 'Your 5-minute routine', icon: Calendar },
  { id: 'reports', label: 'Your hourly report', icon: Bell },
  { id: 'org', label: 'Who does what', icon: Users },
  { id: 'brains', label: 'Reading MyBrains', icon: Eye },
  { id: 'activity', label: 'Reading BrainsActivity', icon: Radar },
  { id: 'perf', label: 'Reading BrainsPerformance', icon: BarChart3 },
  { id: 'numbers', label: 'The numbers that matter', icon: Target },
  { id: 'audit', label: 'When Audit blocks', icon: ShieldCheck },
  { id: 'robot', label: 'The robot', icon: Bot },
  { id: 'book', label: 'The book', icon: Layers },
  { id: 'truth', label: 'What this cannot do', icon: AlertTriangle },
  { id: 'faq', label: 'Quick answers', icon: HelpCircle },
];

/* ---------- building blocks ---------- */

const H = ({ children, sub }) => (
  <div style={{ marginBottom: 18 }}>
    <div style={{ fontSize: 21, fontWeight: 800, color: C.ink, letterSpacing: -0.3 }}>{children}</div>
    {sub && <div style={{ fontSize: 13, color: C.dim, marginTop: 5, lineHeight: 1.6, maxWidth: 700 }}>{sub}</div>}
  </div>
);

const P = ({ children }) => (
  <p style={{ fontSize: 13.5, color: '#c2c8d2', lineHeight: 1.75, margin: '0 0 13px', maxWidth: 720 }}>{children}</p>
);

const Lead = ({ children }) => (
  <p style={{ fontSize: 15, color: C.ink, lineHeight: 1.7, margin: '0 0 16px', maxWidth: 720, fontWeight: 600 }}>{children}</p>
);

const Card = ({ children, tone, title, icon: Icon }) => {
  const col = tone === 'good' ? C.good : tone === 'bad' ? C.bad : tone === 'warn' ? C.warn : C.cool;
  return (
    <div style={{
      background: C.panel2, border: '1px solid ' + C.line, borderLeft: '3px solid ' + col,
      borderRadius: 7, padding: '13px 16px', margin: '0 0 12px', maxWidth: 720,
    }}>
      {title && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 7 }}>
          {Icon && <Icon size={14} color={col} />}
          <span style={{ fontSize: 12, fontWeight: 800, color: col, letterSpacing: 0.4, textTransform: 'uppercase' }}>{title}</span>
        </div>
      )}
      <div style={{ fontSize: 13, color: '#c2c8d2', lineHeight: 1.7 }}>{children}</div>
    </div>
  );
};

const Steps = ({ items }) => (
  <div style={{ maxWidth: 720, margin: '0 0 16px' }}>
    {items.map((it, i) => (
      <div key={i} style={{ display: 'flex', gap: 13, marginBottom: 13 }}>
        <div style={{
          flexShrink: 0, width: 24, height: 24, borderRadius: 12, background: '#1c2230',
          border: '1px solid ' + C.line, color: C.cool, fontSize: 11.5, fontWeight: 800,
          display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 1,
        }}>{i + 1}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink, marginBottom: 3 }}>{it.t}</div>
          <div style={{ fontSize: 12.5, color: C.dim, lineHeight: 1.65 }}>{it.d}</div>
        </div>
      </div>
    ))}
  </div>
);

const Rows = ({ head, rows }) => (
  <div style={{ maxWidth: 760, margin: '0 0 16px', overflowX: 'auto' }}>
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 480 }}>
      <thead>
        <tr>{head.map((h, i) => (
          <th key={i} style={{
            textAlign: 'left', padding: '7px 11px', color: C.faint, fontWeight: 700,
            fontSize: 10.5, letterSpacing: 0.5, textTransform: 'uppercase',
            borderBottom: '1px solid ' + C.line, whiteSpace: 'nowrap',
          }}>{h}</th>))}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((cell, j) => (
              <td key={j} style={{
                padding: '9px 11px', borderBottom: '1px solid #1a1f2b', verticalAlign: 'top',
                color: j === 0 ? C.ink : '#c2c8d2', fontWeight: j === 0 ? 700 : 400, lineHeight: 1.6,
              }}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const Focus = ({ children }) => (
  <div style={{
    background: 'linear-gradient(90deg, rgba(251,191,36,0.10), rgba(251,191,36,0.02))',
    border: '1px solid rgba(251,191,36,0.25)', borderRadius: 7,
    padding: '13px 16px', margin: '4px 0 16px', maxWidth: 720,
  }}>
    <div style={{ fontSize: 10.5, fontWeight: 800, color: C.gold, letterSpacing: 0.5, marginBottom: 6 }}>
      WHERE TO FOCUS
    </div>
    <div style={{ fontSize: 13.5, color: '#e8dcc0', lineHeight: 1.7 }}>{children}</div>
  </div>
);

const Term = ({ children }) => (
  <span style={{ color: C.ink, fontWeight: 700, background: '#1c2230', padding: '1px 5px', borderRadius: 3 }}>{children}</span>
);

/* ---------- sections ---------- */

function Start() {
  return (
    <>
      <H sub="What you actually own, in one page.">Start here</H>
      <Lead>
        You own a research firm, not a trading robot. The robot is the last and
        smallest part of it.
      </Lead>
      <P>
        Shah Investment Center is a simulated investment company with eighteen
        departments and around eighty-seven staff. They work continuously while
        the app is open: inventing trading strategies, testing them, arguing
        about whether the results are real, and letting go of the people whose
        ideas do not work.
      </P>
      <P>
        Only when a strategy survives all of that does it reach the robot, which
        trades it on your configured demo account — and no other account.
      </P>
      <Card tone="warn" title="The single most important idea" icon={AlertTriangle}>
        Almost anything can be made to look profitable on data it has already
        seen. The entire firm exists to tell the difference between a strategy
        that <em>found</em> something and one that <em>memorised</em> the past.
        When the app says something is blocked or unproven, that is the
        expensive part of this system working — not failing.
      </Card>
      <Focus>
        If you read nothing else: look at the banner at the top left of{' '}
        <Term>MyBrains</Term>. It says in one sentence whether the desk is ready
        to trade and, if not, exactly what is missing. Everything else in this
        manual is detail behind that one sentence.
      </Focus>
    </>
  );
}

function Daily() {
  return (
    <>
      <H sub="You are the director. You should not need more than five minutes a day.">
        Your 5-minute routine
      </H>
      <Steps items={[
        { t: 'Open MyBrains and read the top-left banner.',
          d: 'Green means the desk has something audited and the robot may trade it. Red names the one thing standing in the way. If it is red, that sentence is your whole answer for the day.' },
        { t: 'Glance at the robot panel on the right.',
          d: 'It shows the account, today’s profit and loss, and whether anything is stopping it. "Algo Trading is switched off in MetaTrader" is the most common one, and it is fixed by clicking the Algo Trading button in MetaTrader until it turns green.' },
        { t: 'Check "Does it work on months it never studied?"',
          d: 'This is the only performance number worth your attention. Everything else can be made to look good. If this is negative, the desk has not found anything yet, however impressive the rest of the screen looks.' },
        { t: 'Open BrainsPerformance if any trade closed.',
          d: 'Left is what is open right now. Right is what has finished, with filters for today, this week, this month and longer. Judge over months, never over days.' },
        { t: 'Read the latest CEO report if you want the detail.',
          d: 'First tab on the right-hand panel in MyBrains. One report an hour, saying what changed and whether it needs anything from you. A badge shows how many you have not read.' },
        { t: 'Leave it running.',
          d: 'The floor improves by running generations. Closing the app stops the research. Nothing here needs you in order to work.' },
      ]} />
      <Focus>
        Resist the urge to intervene daily. This firm improves over thousands of
        generations, and the numbers move meaningfully over weeks. Checking it
        hourly will teach you nothing except how noisy short samples are.
      </Focus>
    </>
  );
}

function Reports() {
  return (
    <>
      <H sub="Your CEO writes to you once an hour, whether or not the hour went well.">
        Your hourly report
      </H>
      <Lead>
        Find it in MyBrains, first tab on the right-hand panel. A number tells
        you the state. A report tells you the difference, which is the only
        thing an hour of work can actually produce.
      </Lead>
      <P>
        Each report says what changed since the last one, what it means, and —
        at the bottom, under <Term>YOU</Term> — what you should do about it.
        Most hours that will say "nothing, leave it running", and that is a
        real answer rather than a filler one.
      </P>
      <Rows
        head={['Headline', 'What it means']}
        rows={[
          ['A useful hour', 'Performance on unseen data improved. This is the only kind of progress that counts.'],
          ['A quiet hour — nothing moved', 'Normal. Most hours produce this, and a firm that claimed progress every hour would be lying.'],
          ['A step backwards', 'The desk found things that looked better and were not. Also normal, and not a reason to intervene.'],
          ['The floor did not run this hour', 'The app was in the background or closed. Research only happens while it is open.'],
        ]} />
      <Card tone="warn" title="The line worth reading twice" icon={AlertTriangle}>
        If a report says <em>"the studied score rose while the unseen score did
        not"</em>, that is the shape of memorising rather than learning. It is
        the single most important warning this firm produces, and it is why the
        overfit check exists.
      </Card>
      <Focus>
        Read the headline and the <Term>YOU</Term> line. That is the whole
        report for most hours. The bullets in between are there for the hours
        when something actually happened.
      </Focus>
    </>
  );
}

function Org() {
  return (
    <>
      <H sub="Eighteen departments. You only need to recognise about six of them.">
        Who does what
      </H>
      <P>
        Every department owns one piece of a single trading decision. They are
        scored on whether their piece makes the whole thing better — not on
        looking busy.
      </P>
      <Rows
        head={['Department', 'Owns', 'When it matters to you']}
        rows={[
          ['Strategy Discovery', 'The entry decision itself — the moment to buy or sell.', 'This is the department whose name appears on your champion strategy.'],
          ['Quantitative Research', 'Stop distance, target, how long a trade is held.', 'Sets how much each trade can lose.'],
          ['Market Regime', 'Whether this is the right kind of market for the idea.', 'Most strategies do not lose money — they lose it in the wrong market.'],
          ['Risk & Capital', 'How much of the account each trade risks.', 'The number you would care most about if this were real money.'],
          ['Compliance', 'Daily loss stop, maximum trades a day, cool-down after a loss.', 'The hard limits nothing is allowed to breach.'],
          ['Audit', 'Whether the desk followed its own rules and the result is believable.', 'The gate. Nothing trades without its sign-off.'],
          ['Red Team', 'Paid to prove the desk’s own work is luck.', 'Attacks strategies rather than inspecting them.'],
          ['Portfolio Construction', 'How to split money across several strategies at once.', 'The route to bigger returns without bigger risk.'],
          ['Human Resources', 'Hiring, training and letting staff go.', 'Runs itself. You never set this.'],
          ['Office of the CEO', 'What "good" means, and who gets pushed.', 'Reports to you. Sets the return target.'],
        ]} />
      <Card tone="good" title="Ranks" icon={Users}>
        Each department has a <Term>Head of Department</Term>,{' '}
        <Term>Managers</Term> and <Term>Employees</Term>. Employees try new
        ideas, managers breed the best two in their team, and the HOD publishes
        whatever beats the current champion. Staff who keep failing are trained
        once, then let go.
      </Card>
    </>
  );
}

function Brains() {
  return (
    <>
      <H sub="The org chart, and the briefing panel down the right-hand side.">
        Reading MyBrains
      </H>
      <Lead>The briefing panel is the report. The diagram is just where the work happens.</Lead>
      <Rows
        head={['What you see', 'What it means']}
        rows={[
          ['The banner, top left', 'Ready or not ready, and the single reason why. Start here every time.'],
          ['ACCOUNT / TODAY / PEOPLE / AUDIT', 'Balance, today’s change, headcount, and how many audit findings are blocking.'],
          ['Glowing dots', 'Staff. Bigger and brighter means better performing. Colour shows whether they are new, active, in training, a top performer, or on the way out.'],
          ['Flowing lines between clusters', 'Work moving between departments. Decorative — nothing to read into.'],
          ['"What the desk is trying right now"', 'The current champion, department by department, in plain words. This is your strategy, described. The "exact settings" button switches to the precise numbers if you ever want them.'],
          ['"Your move", under the banner', 'What you should actually do about the verdict above. Usually nothing.'],
          ['"The book"', 'How many strategies are running and how independent they really are.'],
          ['"Does it work on months it never studied?"', 'THE number. See The numbers that matter.'],
          ['"Could this just be luck?"', 'Compares the result against what pure luck would produce after so many attempts.'],
          ['"Tried on N instruments it was never tuned on"', 'The harshest honest test available. A real edge should work on more than the chart it was born on.'],
          ['"What your CEO is doing"', 'The current return target, where effort is going, and what Audit is blocking.'],
          ['Menu button', 'Every setting, in one place. You should not need it.'],
        ]} />
      <Focus>
        Two lines decide everything: <Term>Does it work on months it never
        studied?</Term> and <Term>Could this just be luck?</Term> If the first
        is negative, or the second says luck would do better, nothing else on
        the screen counts — no matter how good it looks.
      </Focus>
    </>
  );
}

function ActivityS() {
  return (
    <>
      <H sub="Twenty instruments, and how close each one is to a trade.">
        Reading BrainsActivity
      </H>
      <P>
        The left column lists every instrument the firm is watching, sorted by
        how close each is to firing. Click one and the right side shows the six
        gates a trade has to pass.
      </P>
      <Rows
        head={['Gate', 'The question it asks']}
        rows={[
          ['Data Engineering', 'Is this bar even usable — not a dead flat bar, not a broken gap?'],
          ['Market Regime', 'Is this the kind of market this strategy is for?'],
          ['Strategy Discovery', 'Is there actually a setup right now?'],
          ['Macro & Event', 'Is this a session and a weekday we are willing to trade?'],
          ['Cost & Capacity', 'Is the move worth more than the spread and slippage it costs?'],
          ['Compliance', 'Are we still inside the daily loss stop and the trade cap?'],
        ]} />
      <Card tone="warn" title="Read the labels precisely" icon={AlertTriangle}>
        <Term>BUY signal</Term> means the analyst has found a setup but a gate
        is still shut. <Term>BUY ready</Term> means every gate is open at the
        same moment on the same closed bar. Only the second one is a trade.
        A signal on its own is not permission.
      </Card>
      <P>
        <Term>How sure we are</Term> multiplies two things: how many gates are
        open, and how likely the underlying strategy is to be real. A perfect
        setup on an unproven strategy is still a low number, and that is
        deliberate.
      </P>
      <Focus>
        If most instruments sit at four or five of six for days, look at which
        department is named as holding them. That is where the firm is
        bottlenecked — usually Macro &amp; Event vetoing a session, or Strategy
        Discovery simply not finding setups.
      </Focus>
    </>
  );
}

function Perf() {
  return (
    <>
      <H sub="Open trades on the left, finished trades on the right.">
        Reading BrainsPerformance
      </H>
      <P>
        Filters across the top: Today, This week, This month, Last 3 months,
        Last 6 months, and a custom date range. Below them, the summary row.
      </P>
      <Rows
        head={['Number', 'What it tells you', 'Careful of']}
        rows={[
          ['Net P/L', 'Money made or lost in the period.', 'Meaningless under about thirty trades.'],
          ['Trades', 'How many finished, and the win/loss split.', 'A small count makes every other number noise.'],
          ['Win rate', 'Share of trades that made money.', 'A high win rate with a poor profit factor means the losses are large.'],
          ['Profit factor', 'Money won divided by money lost. Above 1 is profitable.', 'Below about 1.2 is not much margin once costs move.'],
          ['Avg win / Avg loss', 'Typical size of each.', 'If the average loss exceeds the stop, something is not being respected.'],
          ['Worst drawdown', 'The deepest fall from a peak in the period.', 'The number that actually decides whether you could live with this.'],
        ]} />
      <Focus>
        Judge on <Term>worst drawdown</Term> first and profit second. Anyone can
        show a good month. What matters is the worst stretch you would have had
        to sit through without switching it off.
      </Focus>
    </>
  );
}

function Numbers() {
  return (
    <>
      <H sub="Four numbers. Everything else is supporting detail.">
        The numbers that matter
      </H>

      <Card tone="cool" title="1. Does it work on months it never studied?" icon={Target}>
        The desk studies most of the history. The last slice is locked away and{' '}
        <strong>no decision is ever allowed to touch it</strong>. This is the
        result on that locked slice.
        <div style={{ marginTop: 8, color: C.dim }}>
          Positive and close to the studied result: promising. Positive but far
          below it: partly memorised. Negative: nothing has been found yet.
        </div>
      </Card>

      <Card tone="cool" title="2. Could this just be luck?" icon={Target}>
        Try ten thousand strategies and the best one looks excellent by
        accident. This works out how good the best of that many tries would look
        from luck alone, and shows it beside the real result.
        <div style={{ marginTop: 8, color: C.dim }}>
          If "luck would give" is higher than "this shows", the strategy is
          worse than random searching, however good the raw number appears.
          This is the hardest gate in the building, and it is meant to be.
        </div>
      </Card>

      <Card tone="cool" title="3. Tried on instruments it was never tuned on" icon={Target}>
        The same rules applied to instruments the strategy was never fitted to.
        A real edge travels. A memorised one does not.
        <div style={{ marginTop: 8, color: C.dim }}>
          "Makes money on 0 of 19" is about as clear a verdict as this firm can
          produce.
        </div>
      </Card>

      <Card tone="cool" title="4. How many real bets are on" icon={Layers}>
        Running five strategies that all do the same thing is running one
        strategy with extra steps. The firm reports how many{' '}
        <em>independent</em> bets the book actually holds.
        <div style={{ marginTop: 8, color: C.dim }}>
          Five strategies behaving like 1.2 independent ones means the extra
          four are buying almost no protection.
        </div>
      </Card>

      <Focus>
        These four are in order of importance. A strategy that fails number one
        is not worth discussing. One that passes number one but fails number two
        has probably been found by luck. Number four decides whether this firm
        can ever reach an ambitious return target at all.
      </Focus>
    </>
  );
}

function Audit() {
  return (
    <>
      <H sub="Audit blocking is normal, and usually correct.">When Audit blocks</H>
      <Lead>
        A blocking finding does not mean something is broken. It means the desk
        has not yet proved its case.
      </Lead>
      <Rows
        head={['Finding', 'What it means', 'What to do']}
        rows={[
          ['Not enough evidence', 'Too few trades on unseen data — counted across all instruments and discounted for how much they repeat each other.', 'Wait, or add instruments that behave differently.'],
          ['Loses money on unseen data', 'Profitable on what it studied, not on what it did not.', 'Wait. This is the search still working.'],
          ['Results are largely memorised', 'A wide gap between studied and unseen performance.', 'Wait. HR raises standards on its own.'],
          ['It has not beaten its own search', 'The result is no better than luck would give after this many attempts.', 'The hardest to clear. Needs a genuinely better idea, not more attempts.'],
          ['Breaches the loss tolerance', 'Worst drawdown exceeded the CEO’s mandate.', 'Wait, or accept a larger drawdown in the CEO mandate.'],
          ['Legal limits were not enforced', 'A limit was exceeded during testing.', 'This one is a defect, not a bad result. It should never appear.'],
          ['The robot cannot run this strategy', 'The floor is championing a discipline the live trader cannot reproduce.', 'Nothing. It is protecting you from trading something untested.'],
          ['Red Team broke it', 'The strategy failed an attack it should have survived.', 'Wait. Red Team is doing its job.'],
        ]} />
      <Card tone="bad" title="The one finding that is a real fault" icon={AlertTriangle}>
        <strong>"Legal limits were not enforced."</strong> Every other finding is
        the firm reporting honestly about a weak strategy. This one says the
        machinery itself misbehaved. If you ever see it, it needs fixing in the
        code — it is not something to wait out.
      </Card>
      <Focus>
        Do not go looking for a way to switch Audit off. The value of this
        system is precisely that it refuses. A version without these checks
        would be showing you a beautiful profit curve right now and quietly
        losing your money later.
      </Focus>
    </>
  );
}

function Robot() {
  return (
    <>
      <H sub="Configured Demo account only.">The robot</H>
      <P>
        Every five seconds the robot asks one question: is there any reason{' '}
        <em>not</em> to trade? It needs eight answers to be no.
      </P>
      <Steps items={[
        { t: 'Switched on in the app', d: 'The toggle in MyBrains.' },
        { t: 'Right account, and it is a demo', d: 'It refuses to trade a live account. There is no override.' },
        { t: 'Market open', d: 'Not Saturday, not Sunday, and flat before the Friday close so nothing is carried over the weekend gap.' },
        { t: 'A strategy is published and Audit signed it off', d: 'No sign-off, no trading.' },
        { t: 'The sign-off is under 24 hours old', d: 'Open MyBrains to let the floor re-check it.' },
        { t: 'The trader can reproduce the strategy', d: 'It will not trade a discipline that has not been proved to behave identically in both engines.' },
        { t: 'Inside today’s loss stop and trade cap', d: 'Counted across the whole book, not per strategy.' },
        { t: 'A setup exists on the last closed bar', d: 'All gates open at the same moment on the same bar.' },
      ]} />
      <Card tone="warn" title="Most common reason it is idle" icon={Bot}>
        "Algo Trading is switched off in MetaTrader." Click the Algo Trading
        button in MetaTrader until it is green. The robot cannot do this for
        you.
      </Card>
      <Card tone="good" title="An open trade is always managed" icon={ShieldCheck}>
        Even while Audit blocks new entries, anything already open is managed to
        its exit. Abandoning a live position because a check failed would be
        worse than the check failing.
      </Card>
    </>
  );
}

function Book() {
  return (
    <>
      <H sub="Why several strategies at once is the whole game.">The book</H>
      <Lead>
        One good strategy has a ceiling. Several genuinely different ones share
        the same risk budget and beat it.
      </Lead>
      <P>
        If you run several strategies that do not move together, each can take a
        smaller share of the risk and the combined result is steadier than any
        one of them alone. That steadiness is what lets a return target rise
        without the risk rising with it. It is the only honest route to an
        ambitious number.
      </P>
      <P>
        The catch is the word <em>different</em>. Five strategies that all buy
        the same breakout on five correlated currency pairs are one strategy
        wearing five outfits. The firm measures this and reports it as{' '}
        <Term>behave like N independent bets</Term>.
      </P>
      <Rows
        head={['You see', 'It means']}
        rows={[
          ['5 strategies, behave like 4.4', 'Genuinely diversified. This is what you want.'],
          ['5 strategies, behave like 1.2', 'One bet with extra steps. The other four add complexity and no protection.'],
          ['Correlation 0.2 or below', 'Healthy — these strategies really are different.'],
          ['Correlation 0.8 or above', 'They are the same bet. Alpha Diversity should be rejecting more.'],
        ]} />
      <Card tone="cool" title="How the money is split" icon={Layers}>
        Each strategy in the book takes a share of the risk, and the shares add
        up to one. The whole book therefore risks exactly what a single strategy
        used to. That is deliberately cautious: it gives you the
        diversification for free without increasing exposure. Turning that
        steadiness into a larger return is a separate decision, and should only
        be taken once the book has proved itself.
      </Card>
      <Focus>
        This is where your attention is worth the most. The firm is currently
        far better at finding one strategy than at finding several different
        ones. Anything that increases the number of genuinely independent bets
        moves the target closer. Another variation on the same idea does not.
      </Focus>
    </>
  );
}

function Truth() {
  return (
    <>
      <H sub="The honest limits, stated plainly.">What this cannot do</H>
      <Card tone="bad" title="It cannot invent an edge that is not there" icon={AlertTriangle}>
        The firm can test millions of variations. Testing is not the same as
        finding. If the market offers no edge in the data it is given, no amount
        of running produces one — it simply keeps reporting honestly that it has
        not found anything.
      </Card>
      <Card tone="bad" title="It cannot see fundamentals yet" icon={AlertTriangle}>
        There are staff labelled for fundamental analysis, but no interest-rate,
        positioning or economic-calendar data behind them. Until that data is
        connected, every strategy in the building is a variation on price and
        volatility — which is exactly why they correlate with each other.
      </Card>
      <Card tone="bad" title="A demo account is not a live account" icon={AlertTriangle}>
        Demo fills are optimistic. Real spreads widen at exactly the moments
        strategies want to trade. Costs here are deliberately assumed to be
        worse than quoted, but a demo result should still be treated as the best
        case.
      </Card>
      <Card tone="warn" title="Past results, even honest ones, are not a promise" icon={AlertTriangle}>
        A strategy that passes every check in this building has cleared a high
        bar. It has not been guaranteed. Markets change, and the firm is built
        to notice that and re-test rather than to assume.
      </Card>
      <Focus>
        The most valuable thing in this application is not the strategy search.
        It is the machinery that refuses to let a bad strategy through. Judge
        the firm by how honestly it reports, not by how good the numbers look.
      </Focus>
    </>
  );
}

function Faq() {
  const qs = [
    ['Nothing has traded for days. Is it broken?',
      'Almost certainly not. Check the MyBrains banner — it names the reason. The usual answers are that Audit is blocking, or Algo Trading is off in MetaTrader.'],
    ['Audit has four blocks. Should I be worried?',
      'No. That is the normal state until a strategy proves itself. The one to worry about is "Legal limits were not enforced", which is a defect rather than a weak result.'],
    ['Why does it say the strategy loses money?',
      'Because on data it had never seen, it did. That is the honest result. The alternative — showing you the flattering studied number — is how people lose money.'],
    ['Can I make it trade more often?',
      'You could, and it would almost certainly make things worse. Frequency without an edge just pays more spread.'],
    ['Should I put real money on this?',
      'Not until a strategy holds up on unseen data, beats the luck hurdle, and works on instruments it was never tuned on — and then only with money you can afford to lose entirely.'],
    ['Do I need to keep the app open?',
      'Yes, for research. The floor only runs while the app is running. The robot is separate and follows its own gates.'],
    ['What is my one job here?',
      'Read the banner, keep it running, and push for more genuinely different strategies rather than better versions of the same one.'],
  ];
  return (
    <>
      <H sub="The questions worth having a straight answer to.">Quick answers</H>
      {qs.map(([q, a], i) => (
        <div key={i} style={{ marginBottom: 15, maxWidth: 720 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink, marginBottom: 5 }}>{q}</div>
          <div style={{ fontSize: 13, color: '#c2c8d2', lineHeight: 1.7 }}>{a}</div>
        </div>
      ))}
    </>
  );
}

const BODY = {
  start: Start, daily: Daily, reports: Reports, org: Org, brains: Brains, activity: ActivityS,
  perf: Perf, numbers: Numbers, audit: Audit, robot: Robot, book: Book,
  truth: Truth, faq: Faq,
};

export default function ManualTab() {
  const [active, setActive] = useState('start');
  const [q, setQ] = useState('');
  const bodyRef = useRef(null);

  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = 0; }, [active]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return SECTIONS;
    return SECTIONS.filter(x => x.label.toLowerCase().includes(s));
  }, [q]);

  const Body = BODY[active] || Start;
  const idx = SECTIONS.findIndex(s => s.id === active);
  const next = SECTIONS[idx + 1];

  return (
    <div style={{ display: 'flex', height: '100%', background: C.bg, color: C.ink, overflow: 'hidden' }}>

      {/* left rail */}
      <div style={{
        width: 244, flexShrink: 0, borderRight: '1px solid ' + C.line,
        background: C.panel, display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: '15px 16px 12px', borderBottom: '1px solid ' + C.line }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <BookOpen size={16} color={C.cool} />
            <span style={{ fontSize: 14, fontWeight: 800 }}>Operating Manual</span>
          </div>
          <div style={{ fontSize: 11, color: C.faint, marginTop: 4 }}>Shah Investment Center</div>
          <div style={{ position: 'relative', marginTop: 11 }}>
            <Search size={12} color={C.faint} style={{ position: 'absolute', left: 9, top: 8 }} />
            <input
              value={q} onChange={e => setQ(e.target.value)} placeholder="Find a section"
              style={{
                width: '100%', boxSizing: 'border-box', padding: '6px 9px 6px 26px',
                background: '#0d1017', border: '1px solid ' + C.line, borderRadius: 5,
                color: C.ink, fontSize: 11.5, outline: 'none',
              }} />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 8px 20px' }}>
          {shown.map(s => {
            const on = s.id === active;
            const Icon = s.icon;
            return (
              <div key={s.id} onClick={() => setActive(s.id)} style={{
                display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px',
                borderRadius: 6, cursor: 'pointer', marginBottom: 2,
                background: on ? '#1b2534' : 'transparent',
                borderLeft: '2px solid ' + (on ? C.cool : 'transparent'),
              }}>
                <Icon size={13} color={on ? C.cool : C.faint} />
                <span style={{ fontSize: 12.5, fontWeight: on ? 700 : 500, color: on ? C.ink : C.dim }}>
                  {s.label}
                </span>
              </div>
            );
          })}
          {!shown.length && (
            <div style={{ padding: 12, fontSize: 11.5, color: C.faint }}>No section matches that.</div>
          )}
        </div>
      </div>

      {/* body */}
      <div ref={bodyRef} style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ padding: '30px 44px 70px', maxWidth: 880, margin: '0 auto' }}>
          <Body />
          {next && (
            <div onClick={() => setActive(next.id)} style={{
              marginTop: 30, paddingTop: 18, borderTop: '1px solid ' + C.line,
              display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer',
            }}>
              <span style={{ fontSize: 11, color: C.faint, fontWeight: 700, letterSpacing: 0.4 }}>NEXT</span>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: C.cool }}>{next.label}</span>
              <ChevronRight size={14} color={C.cool} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
