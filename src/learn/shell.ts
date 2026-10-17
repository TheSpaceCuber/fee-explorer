import type { FundInput } from '../engine';
import { href } from '../ui/router';
import { LESSONS, PARTS, READY, lessonBySlug, lessonNumber, type Lesson } from './lessons';
import { isDone, markDone } from './progress';
import { WIDGETS } from './widgets';

/**
 * The lesson page: a sidebar listing every part and lesson (✓ done, ● current, "soon" for lessons
 * not written yet), and the lesson itself. Widget settings and predict answers are remembered while
 * the page is open, so going Back and Next again doesn't reset them.
 */

const widgetParams = new Map<string, unknown>();
const predictions = new Map<string, number>();

export interface LearnHandlers {
  /** Open a lesson's fund in the full Explore view. */
  openInExplore: (input: FundInput, name: string) => void;
}

export function renderLearn(root: HTMLElement, slug: string | null, h: LearnHandlers): void {
  // No lesson in the URL: continue where you left off, or start at lesson 1.
  const lesson = (slug && lessonBySlug(slug)) || READY.find((l) => !isDone(l.slug)) || READY[0]!;
  if (!lesson.ready) {
    root.innerHTML = layout(lesson, `<h2>${lesson.title}</h2><p>This lesson is coming soon. <a href="${href({ view: 'learn', lesson: READY.at(-1)!.slug })}">Back to the latest lesson</a></p>`);
    return;
  }

  const i = READY.indexOf(lesson);
  const prev = READY[i - 1];
  const next = READY[i + 1] ?? LESSONS.find((l) => !l.ready && LESSONS.indexOf(l) > LESSONS.indexOf(lesson));
  const part = PARTS.find((p) => p.n === lesson.part)!;

  root.innerHTML = layout(
    lesson,
    `<p class="crumb">Part ${part.n} · ${part.title} · Lesson ${lessonNumber(lesson.slug)} of ${LESSONS.length}</p>
    <h2 id="lesson-title" tabindex="-1">${lesson.title}</h2>
    ${(lesson.intro ?? []).map((p) => `<p>${p}</p>`).join('')}
    ${lesson.predict ? `<section class="predict" aria-labelledby="predict-q"></section>` : ''}
    ${
      lesson.widget
        ? `<section class="widget panel" aria-label="Interactive example">
            <p class="widget-head"><span class="live-dot" aria-hidden="true"></span>Interactive: every number updates as soon as you change a control</p>
            <div id="widget"></div>
          </section>`
        : ''
    }
    ${lesson.tryThis ? `<p class="try"><strong>Try this:</strong> ${lesson.tryThis}</p>` : ''}
    ${lesson.takeaway ? `<div class="takeaway"><strong>Takeaway</strong><p>${lesson.takeaway}</p></div>` : ''}
    <nav class="lesson-pager" aria-label="Lesson navigation">
      ${prev ? `<a class="pager-btn" href="${href({ view: 'learn', lesson: prev.slug })}">◀ ${prev.title}</a>` : '<span></span>'}
      ${lesson.widget ? '<button class="link-btn" id="open-explore">Open this fund in Explore</button>' : ''}
      ${
        next
          ? next.ready
            ? `<a class="pager-btn primary" id="next" href="${href({ view: 'learn', lesson: next.slug })}">${next.title} ▶</a>`
            : `<span class="pager-btn disabled" id="next" aria-disabled="true">Next: ${next.title} (coming soon)</span>`
          : `<a class="pager-btn primary" href="${href({ view: 'explore' })}">Course complete: try everything in Explore ▶</a>`
      }
    </nav>`,
  );

  // Finishing a lesson = moving on from it.
  root.querySelector('#next')?.addEventListener('click', () => markDone(lesson.slug));
  if (!next?.ready) markDone(lesson.slug); // last available lesson: reaching it counts

  if (lesson.predict) renderPredict(root.querySelector('.predict')!, lesson);

  if (lesson.widget) {
    const widget = WIDGETS[lesson.widget];
    const mount = root.querySelector<HTMLElement>('#widget')!;
    const draw = () => {
      if (!widgetParams.has(lesson.slug)) widgetParams.set(lesson.slug, widget.init());
      const before = cardValues(mount);
      widget.render(mount, widgetParams.get(lesson.slug), (p: unknown) => {
        widgetParams.set(lesson.slug, p);
        draw();
      });
      flashChanged(mount, before);
    };
    draw();
    root.querySelector('#open-explore')?.addEventListener('click', () =>
      h.openInExplore(widget.input(widgetParams.get(lesson.slug)), `Lesson ${lessonNumber(lesson.slug)}: ${lesson.title}`),
    );
  }
}

/** Each metric card's current value, keyed by its label. */
function cardValues(root: HTMLElement): Map<string, string> {
  return new Map([...root.querySelectorAll<HTMLElement>('.tile[data-key]')].map((t) => [t.dataset.key!, t.querySelector('.t-value')?.textContent ?? '']));
}

/** Briefly highlight the values that just changed, so you can see what your control moved. */
function flashChanged(root: HTMLElement, before: Map<string, string>): void {
  if (before.size === 0) return; // first draw: nothing "changed"
  for (const t of root.querySelectorAll<HTMLElement>('.tile[data-key]')) {
    const v = t.querySelector('.t-value');
    if (v && before.has(t.dataset.key!) && before.get(t.dataset.key!) !== v.textContent) v.classList.add('changed');
  }
}

function layout(current: Lesson, body: string): string {
  const done = READY.filter((l) => isDone(l.slug)).length;
  return `
    <details class="lesson-list" ${window.matchMedia("(min-width: 861px)").matches ? "open" : ""}>
      <summary>Lessons</summary>
      <div class="progress">
        <div class="progress-track" role="progressbar" aria-label="Course progress" aria-valuemin="0" aria-valuemax="${READY.length}" aria-valuenow="${done}">
          <div class="progress-fill" style="width:${(done / READY.length) * 100}%"></div>
        </div>
        <span>${done} of ${READY.length} lessons completed</span>
      </div>
      ${PARTS.map(
        (p) => `<div class="part">
          <h3>Part ${p.n}. ${p.title}</h3>
          <ol>${LESSONS.filter((l) => l.part === p.n)
            .map((l) => {
              const n = lessonNumber(l.slug);
              const tick = isDone(l.slug) && l.slug !== current.slug ? '<span class="done-tick" aria-hidden="true">✓</span><span class="visually-hidden"> (done)</span>' : '';
              const label = `<span class="n">${n}</span><span>${l.title}${l.ready ? '' : ' <span class="soon">soon</span>'}</span>${tick}`;
              return `<li class="${l.slug === current.slug ? 'current' : ''} ${l.ready ? '' : 'not-ready'}">${
                l.ready
                  ? `<a href="${href({ view: 'learn', lesson: l.slug })}" ${l.slug === current.slug ? 'aria-current="page"' : ''}>${label}</a>`
                  : `<span>${label}</span>`
              }</li>`;
            })
            .join('')}</ol>
        </div>`,
      ).join('')}
    </details>
    <article class="lesson">${body}</article>`;
}

/** Predict, then check: answer first, then see whether you were right and why. */
function renderPredict(root: HTMLElement, lesson: Lesson): void {
  const q = lesson.predict!;
  const chosen = predictions.get(lesson.slug);
  const answered = chosen !== undefined;
  root.innerHTML = `
    <h3 id="predict-q">Predict first</h3>
    <p>${q.question}</p>
    <div class="predict-options">
      ${q.options
        .map((o, i) => {
          const state = !answered ? '' : i === q.answer ? 'right' : i === chosen ? 'wrong' : '';
          const mark = state === 'right' ? '✓ ' : state === 'wrong' ? '✕ ' : '';
          return `<button class="predict-option ${state}" data-i="${i}" ${answered ? 'disabled' : ''} aria-pressed="${i === chosen}">${mark}${o}</button>`;
        })
        .join('')}
    </div>
    <div class="predict-result" aria-live="polite" tabindex="-1">${
      answered
        ? `<p><strong>${chosen === q.answer ? 'Right.' : 'Not quite.'}</strong> ${q.explain} <button class="link-btn" id="predict-reset">Try again</button></p>`
        : ''
    }</div>`;
  root.querySelectorAll<HTMLButtonElement>('.predict-option').forEach((b) =>
    b.addEventListener('click', () => {
      predictions.set(lesson.slug, Number(b.dataset.i));
      renderPredict(root, lesson);
      root.querySelector<HTMLElement>('.predict-result')?.focus();
    }),
  );
  root.querySelector('#predict-reset')?.addEventListener('click', () => {
    predictions.delete(lesson.slug);
    renderPredict(root, lesson);
    root.querySelector<HTMLButtonElement>('.predict-option')?.focus();
  });
}
