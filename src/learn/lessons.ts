/**
 * The course, as data. Each lesson: one idea, one small interactive ("widget"), a predict-then-check
 * question, a "try this" prompt and a takeaway. The lesson shell (shell.ts) renders them.
 *
 * Every predict answer is checked against the engine in tests/lessons.test.ts, so the text can't
 * drift from what the numbers actually do.
 */

export type WidgetId = 'timeline' | 'returns' | 'feeRate' | 'stepDown' | 'feeDrag' | 'whoPays';

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
  // ---------------------------------------------------------------- Parts 3–5 (coming next)
  { slug: 'carry-basics', part: 3, title: 'Carry: capital back, then a split', ready: false },
  { slug: 'the-hurdle', part: 3, title: 'The hurdle (preferred return)', ready: false },
  { slug: 'the-catch-up', part: 3, title: 'The catch-up', ready: false },
  { slug: 'accrued-carry', part: 3, title: 'Carry on unsold assets', ready: false },
  { slug: 'compounding', part: 3, title: 'Compounding conventions (optional)', ready: false },
  { slug: 'european-vs-american', part: 4, title: 'European vs American', ready: false },
  { slug: 'clawback', part: 4, title: 'Clawback', ready: false },
  { slug: 'gross-to-net', part: 5, title: 'Gross to net', ready: false },
  { slug: 'net-to-gross', part: 5, title: 'Net to gross, with public data', ready: false },
];

export const READY = LESSONS.filter((l) => l.ready);
export const lessonBySlug = (slug: string) => LESSONS.find((l) => l.slug === slug);
export const lessonNumber = (slug: string) => LESSONS.findIndex((l) => l.slug === slug) + 1;
