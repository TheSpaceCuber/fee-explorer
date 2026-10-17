/**
 * The course, as data. Each lesson: one idea, one small interactive ("widget"), a predict-then-check
 * question, a "try this" prompt and a takeaway. The lesson shell (shell.ts) renders them.
 *
 * Every predict answer is checked against the engine in tests/lessons.test.ts, so the text can't
 * drift from what the numbers actually do.
 */

export type WidgetId =
  | 'timeline' | 'returns' | 'feeRate' | 'stepDown' | 'feeDrag' | 'whoPays'
  | 'carrySplit' | 'hurdle' | 'catchUp' | 'accrued' | 'compounding';

export interface Predict {
  question: string;
  options: string[];
  /** Index of the right option. */
  answer: number;
  /** Shown after answering, right or wrong. */
  explain: string;
}

export interface Lesson {
  slug: string;
  part: number;
  title: string;
  ready: boolean;
  /** Paragraphs (simple HTML: <strong>, <em>). */
  intro?: string[];
  predict?: Predict;
  widget?: WidgetId;
  tryThis?: string;
  takeaway?: string;
}

export const PARTS: { n: number; title: string }[] = [
  { n: 1, title: 'Basics' },
  { n: 2, title: 'Management fees' },
  { n: 3, title: 'Performance fees (carry)' },
  { n: 4, title: 'Fund structures' },
  { n: 5, title: 'Putting it together' },
];

export const LESSONS: Lesson[] = [
  // ---------------------------------------------------------------- Part 1
  {
    slug: 'whos-who',
    part: 1,
    title: "Who's who, and how money moves",
    ready: true,
    intro: [
      'A private equity fund has two sides. <strong>LPs</strong> (limited partners: pensions, insurers, endowments) provide the money. ' +
        'The <strong>GP</strong> (general partner) is the manager: it picks the companies, runs the fund, and charges fees.',
      'LPs don’t hand over their money on day one. They make a <strong>commitment</strong>, here $100m, and the GP draws it ' +
        'when it finds a deal, through <strong>capital calls</strong>. Years later, when it sells a company, the GP sends cash back ' +
        'as <strong>distributions</strong>. Whatever hasn’t been sold yet is the fund’s remaining value, its <strong>NAV</strong>.',
    ],
    predict: {
      question: 'Count money paid in as negative and money received as positive. When is the LP’s running total at its lowest?',
      options: ['At the first capital call', 'Just before the first distribution', 'At the very end of the fund'],
      answer: 1,
      explain:
        'Each capital call pushes the running total further down, until cash finally starts coming back. Plotted over time, it dips and ' +
        'then climbs: the famous <strong>J-curve</strong>.',
    },
    widget: 'timeline',
    tryThis: 'Switch on the running total and hover the bars. Notice the GP called $85m of the $100m commitment, not all of it.',
    takeaway: 'Money goes in through capital calls and comes back through distributions, years apart. Everything else in this course is about how that cash is shared.',
  },
  {
    slug: 'measuring-returns',
    part: 1,
    title: 'Measuring returns: DPI, TVPI and IRR',
    ready: true,
    intro: [
      'Three numbers summarise a fund for its LPs. <strong>DPI</strong> (distributions to paid-in) is the cash actually returned per $1 paid in. ' +
        '<strong>TVPI</strong> (total value to paid-in) adds what’s still held (NAV). Both are multiples: they ignore <em>when</em> money moved.',
      '<strong>IRR</strong> (internal rate of return) is the annual return that makes the cash flows add up, taking timing into account. ' +
        'Getting money back sooner raises it.',
    ],
    predict: {
      question: 'If every distribution arrived two years later, same amounts, what happens?',
      options: ['TVPI and IRR both fall', 'TVPI stays the same, IRR falls', 'TVPI falls, IRR stays the same'],
      answer: 1,
      explain:
        'TVPI only counts amounts, so it doesn’t move. IRR penalises waiting: the same money, later, is a lower annual return. That’s ' +
        'why both numbers are reported: TVPI says "how much", IRR says "how fast".',
    },
    widget: 'returns',
    tryThis: 'Drag the delay slider and watch which numbers move. How many points of IRR does a three-year wait cost, for exactly the same money?',
    takeaway: 'Multiples (DPI, TVPI) measure how much came back; IRR also measures how fast.',
  },
  // ---------------------------------------------------------------- Part 2
  {
    slug: 'the-management-fee',
    part: 2,
    title: 'The management fee',
    ready: true,
    intro: [
      'The GP charges a <strong>management fee</strong> to run the fund: salaries, offices, finding deals. It’s a percentage per year, ' +
        'typically around 2%, charged on the LPs’ <strong>commitments</strong>, whether or not the fund makes money.',
      'It’s usually billed every quarter, in advance: a quarter of the annual rate each time. (For now, carry is switched off: it ' +
        'arrives in Part 3.)',
    ],
    predict: {
      question: 'At 2% a year on a $100m commitment, how much is charged each quarter?',
      options: ['$0.5m', '$2m', '$0.2m'],
      answer: 0,
      explain: '2% of $100m is $2m a year. Billed quarterly, that’s $0.5m each quarter, every quarter, regardless of performance.',
    },
    widget: 'feeRate',
    tryThis: 'Move the rate to 1.5% and read the total. Over a fund’s life, small rate differences add up to millions.',
    takeaway: 'Management fees are charged on commitments, not profits: they’re paid in good years and bad.',
  },
  {
    slug: 'step-down',
    part: 2,
    title: 'The step-down',
    ready: true,
    intro: [
      'For the first few years, the <strong>investment period</strong>, the GP is busy finding deals, so the fee is on the full commitment. ' +
        'After that it mostly manages and sells what it owns, so the fee usually <strong>steps down</strong>: a lower rate, on a smaller base.',
      'That base is often <strong>invested capital</strong>: what was paid for the companies still held. Each time a company is sold, ' +
        'its cost drops out of the base, so the fee falls again.',
    ],
    predict: {
      question: 'After the investment period, the fee is a % of invested capital. When the fund sells a company, the next quarter’s fee…',
      options: ['goes up', 'goes down', 'stays the same'],
      answer: 1,
      explain: 'The company’s cost leaves invested capital, so the base shrinks and so does the fee. Look for the steps after each sale in the chart.',
    },
    widget: 'stepDown',
    tryThis: 'Switch the base after the investment period to "commitment". How much more would the LP pay?',
    takeaway: 'Fees usually step down after the investment period, and with an invested-capital base they shrink as deals are sold.',
  },
  {
    slug: 'fee-drag',
    part: 2,
    title: 'Fees are paid in, on top',
    ready: true,
    intro: [
      'LPs pay the fee by funding extra capital calls. So the fee counts as money they <strong>paid in</strong>, but it doesn’t buy any ' +
        'companies, so it earns nothing.',
      'That’s the gap between <strong>gross</strong> returns (what the deals made) and <strong>net</strong> returns (what the LP ' +
        'gets), often called <strong>fee drag</strong>.',
    ],
    predict: {
      question: 'The fee rises from 1% to 2%. The deals and their proceeds don’t change. The LP’s net multiple (TVPI)…',
      options: ['rises', 'falls', 'doesn’t change, because the fees come back'],
      answer: 1,
      explain:
        'The same proceeds are now spread over a bigger paid-in amount, so the multiple falls (and the IRR with it). The fee dollars are ' +
        'only "returned" in the sense that, in Part 3, they come back before the GP takes carry.',
    },
    widget: 'feeDrag',
    tryThis: 'Set the fee to 0%. Gross and net are then identical. Now slowly raise it and watch the gap open.',
    takeaway: 'Fees are paid in on top of the investment, so they pull net returns below the deals’ gross returns.',
  },
  {
    slug: 'who-pays-what',
    part: 2,
    title: 'Different LPs, different fees',
    ready: true,
    intro: [
      'Not every LP pays the same fee. Large commitments often get a <strong>size discount</strong>. Early or strategic investors may ' +
        'negotiate a <strong>side letter</strong> with a lower rate. And the GP usually invests some of its own money (the ' +
        '<strong>GP commitment</strong>), which pays no fee at all.',
      'All four partners below invest in exactly the same deals, in proportion to their commitments. Only the fees differ.',
    ],
    predict: {
      question: 'Which partner ends up with the highest net IRR?',
      options: ['The pension, the largest LP', 'The insurer, which has a side letter', 'The GP’s own commitment'],
      answer: 2,
      explain:
        'The GP commitment pays no management fee, so it earns the deals’ gross return. In Part 3 you’ll see it pays no carry either. ' +
        'Among the LPs, lower fees mean a higher net IRR.',
    },
    widget: 'whoPays',
    tryThis: 'Turn off the size discount, then raise the side-letter cut. Can the insurer overtake the pension?',
    takeaway: 'Same deals, different fees, different net returns. That’s why each partner’s numbers are calculated separately.',
  },
  // ---------------------------------------------------------------- Part 3
  {
    slug: 'carry-basics',
    part: 3,
    title: 'Carry: capital back, then a split',
    ready: true,
    intro: [
      'The GP’s big reward isn’t the fee. It’s <strong>carried interest</strong> ("carry"): a share of the profits, typically 20%. ' +
        'In a closed-ended fund, carry <em>is</em> the performance fee.',
      'Carry is paid through a <strong>distribution waterfall</strong>: each distribution flows down a series of tiers, in order. The simplest ' +
        'version has two. First the LPs get back all the capital they put in (<strong>return of capital</strong>). Whatever is left is profit, ' +
        'split 80/20 between LPs and GP.',
      'Management fees are switched off again in this part, so every change you see comes from carry. Part 5 puts everything together.',
    ],
    predict: {
      question: 'The LP put in $85m. Distributions are $20m, $45m, $60m and $50m. With 20% carry, which distribution pays the GP its first carry dollar?',
      options: ['The first one, $20m in 2023', 'The third one, $60m in 2026', 'Only the last one, at the end of the fund'],
      answer: 1,
      explain:
        'The first two add up to $65m, still short of the $85m the LP put in, so they all go to the LP. The third one finishes returning ' +
        'capital ($20m), and the remaining $40m is profit, split 80/20.',
    },
    widget: 'carrySplit',
    tryThis: 'Hover the bars to see each tier. Then set the carry rate to 30%: which distributions change, and which don’t?',
    takeaway: 'Carry is a share of profit, paid only after the LPs have their capital back. The first distributions go entirely to the LPs.',
  },
  {
    slug: 'the-hurdle',
    part: 3,
    title: 'The hurdle (preferred return)',
    ready: true,
    intro: [
      'Most funds add a <strong>hurdle</strong>, also called the <strong>preferred return</strong> or "pref": before the GP earns any carry, ' +
        'the LPs must get their capital back <em>plus</em> a minimum return, typically 8% a year.',
      'Think of a savings account in the LP’s name that pays 8%. Every capital call is a deposit, every payment to the LP a withdrawal. ' +
        'Until the account is empty, all the cash goes to the LP. That’s the new middle tier: capital, then pref, then the split.',
    ],
    predict: {
      question: 'Add an 8% hurdle (and nothing else yet). Compared with no hurdle, the GP’s carry is…',
      options: ['higher', 'lower', 'the same'],
      answer: 1,
      explain:
        'The pref is paid to the LP before anything is split, and the GP gets no carry on it. So the GP takes 20% of a smaller pot, and ends ' +
        'up with less than 20% of the total profit. The next lesson shows how most funds give it back.',
    },
    widget: 'hurdle',
    tryThis: 'Step through the 2026 distribution. Step 0 shows how much pref the "savings account" has built up by then. Then raise the hurdle to 12%.',
    takeaway: 'The hurdle protects the LPs’ minimum return: no carry until they have their capital plus, say, 8% a year.',
  },
  {
    slug: 'the-catch-up',
    part: 3,
    title: 'The catch-up',
    ready: true,
    intro: [
      'With a hurdle alone, the GP gets 20% of the profit <em>above</em> the hurdle, which is less than 20% of all the profit. Most funds fix ' +
        'this with a <strong>catch-up</strong>: after the pref, the GP takes most or all of the next dollars until it has caught up to 20% of ' +
        'everything paid out so far. Then the 80/20 split resumes.',
      'A 100% ("full") catch-up gives the GP every dollar in that tier. The ILPA model agreement uses 80%: 80 cents of each dollar to the ' +
        'GP, 20 to the LP. It takes longer, but ends in the same place.',
    ],
    predict: {
      question: 'With an 8% hurdle and a 100% catch-up, if the fund does well, what share of the total profit does the GP end up with?',
      options: ['Less than 20%', 'Exactly 20%', 'More than 20%'],
      answer: 1,
      explain:
        'The catch-up exists precisely to bring the GP up to its 20%, no more. The hurdle then only <em>delays</em> carry, it doesn’t ' +
        'reduce it, as long as the fund makes enough to get past the catch-up.',
    },
    widget: 'catchUp',
    tryThis: 'Switch between None and 100% and watch the green catch-up slice appear. Then press Play on the step-through to see the GP catch up.',
    takeaway: 'The catch-up lets the GP get back to its full carry rate after the pref, so the hurdle changes the timing of carry, not the total.',
  },
  {
    slug: 'accrued-carry',
    part: 3,
    title: 'Carry on unsold assets',
    ready: true,
    intro: [
      'Funds don’t sell everything at once. While companies are still held, their value (the NAV) includes profit the GP would take ' +
        'carry on if they were sold today. That’s <strong>accrued carry</strong>: earned on paper, not yet paid.',
      'So an LP’s statement shows the NAV <strong>net</strong> of accrued carry: what the LP would actually get if everything were sold ' +
        'at today’s value. TVPI and IRR use that net figure.',
    ],
    predict: {
      question: 'At the end of 2027 the fund still holds companies worth $40m. On the LP’s statement, its share of that value is…',
      options: ['$40m, the full value', 'less than $40m', 'nothing until the companies are sold'],
      answer: 1,
      explain:
        'If the companies were sold for $40m, the waterfall would give part of it to the GP as carry. The statement deducts that accrued ' +
        'carry, so the LP sees less than $40m.',
    },
    widget: 'accrued',
    tryThis: 'Set the NAV to $0: TVPI then equals DPI. Now raise it: how much of each extra $1m of value goes to the GP?',
    takeaway: 'Unsold value carries a GP share too. LP statements show NAV net of that accrued carry.',
  },
  {
    slug: 'compounding',
    part: 3,
    title: 'Compounding conventions (optional)',
    ready: true,
    intro: [
      'The fine print: how does the 8% grow? With <strong>simple</strong> interest, only the capital earns it. With <strong>compound</strong> ' +
        'interest, unpaid pref earns pref too, so more is owed. Compounding more often (quarterly, daily) adds a little more on top.',
      'It sounds like a detail, but over years of unpaid pref it moves real money from the GP to the LPs, which is why the LPA wording ' +
        '("compounded annually") gets negotiated.',
    ],
    predict: {
      question: 'Switch from simple interest to annual compounding. The pref paid to the LP…',
      options: ['goes up', 'goes down', 'stays the same'],
      answer: 0,
      explain:
        'Once the pref isn’t paid straight away, compounding charges pref on the unpaid pref as well. More pref owed means more paid to ' +
        'the LP before the split, and (with no catch-up) less carry.',
    },
    widget: 'compounding',
    tryThis: 'Raise the hurdle to 12%. Does the gap between simple and daily grow or shrink? Why?',
    takeaway: 'Compound pref means more is owed to LPs before carry. "Compounded annually" is the most common wording.',
  },
  // ---------------------------------------------------------------- Parts 4–5 (coming next)
  { slug: 'european-vs-american', part: 4, title: 'European vs American', ready: false },
  { slug: 'clawback', part: 4, title: 'Clawback', ready: false },
  { slug: 'gross-to-net', part: 5, title: 'Gross to net', ready: false },
  { slug: 'net-to-gross', part: 5, title: 'Net to gross, with public data', ready: false },
];

export const READY = LESSONS.filter((l) => l.ready);
export const lessonBySlug = (slug: string) => LESSONS.find((l) => l.slug === slug);
export const lessonNumber = (slug: string) => LESSONS.findIndex((l) => l.slug === slug) + 1;
