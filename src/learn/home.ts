import { href } from '../ui/router';
import { LESSONS, PARTS, READY } from './lessons';
import { isDone } from './progress';

/** The landing page: what this is, and three ways in. */
export function renderHome(root: HTMLElement): void {
  const doneCount = READY.filter((l) => isDone(l.slug)).length;
  const nextLesson = READY.find((l) => !isDone(l.slug));
  const learnHref = href({ view: 'learn', lesson: (nextLesson ?? READY[0]!).slug });
  const learnLabel = doneCount === 0 ? 'Start with lesson 1' : nextLesson ? `Continue: ${nextLesson.title}` : 'Review the lessons';

  root.innerHTML = `
    <section class="hero">
      <h1>How do private equity funds get paid?</h1>
      <p>Investors in a private equity fund pay the manager in two ways: a yearly <strong>management fee</strong>, and a share of the
        profits called <strong>carried interest</strong>, the performance fee. Fee Explorer walks you through both, one idea at a time,
        with small interactive examples you can change and see what happens.</p>
    </section>

    <div class="doors">
      <a class="door primary" href="${learnHref}">
        <span class="door-title">Learn</span>
        <span>A short course: ${READY.length} lessons so far, ${LESSONS.length} planned. Each one is a single idea, a small interactive and a takeaway.</span>
        <span class="door-cta">${learnLabel} →</span>
      </a>
      <a class="door" href="${href({ view: 'explore' })}">
        <span class="door-title">Explore</span>
        <span>The full playground: every term, chart and preset at once, including funds rebuilt from public pension data.</span>
        <span class="door-cta">Open the playground →</span>
      </a>
      <a class="door" href="${href({ view: 'hood' })}">
        <span class="door-title">Under the hood</span>
        <span>How a fund system might configure, calculate and store all of this: pipeline stages, JSON, tables and re-runs.</span>
        <span class="door-cta">See the pipeline →</span>
      </a>
    </div>

    <section class="panel course-map">
      <h2>The course</h2>
      <div class="map">${PARTS.map(
        (p) => `<div><h3>Part ${p.n}. ${p.title}</h3><ol>${LESSONS.filter((l) => l.part === p.n)
          .map((l) => `<li>${l.ready ? `<a href="${href({ view: 'learn', lesson: l.slug })}">${l.title}</a>${isDone(l.slug) ? ' ✓' : ''}` : `${l.title} <span class="soon">soon</span>`}</li>`)
          .join('')}</ol></div>`,
      ).join('')}</div>
    </section>

    <p class="hint footnote">A personal learning project. All funds are synthetic, except two rebuilt from a public pension's published figures
      (with sources). Not investment advice.</p>`;
}
