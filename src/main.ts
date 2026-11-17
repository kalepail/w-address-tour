import './style.css';
import { contractUrl, formatXlm, txUrl } from './lib/stellar.ts';
import { STEPS, esc, freshState, short } from './steps.ts';
import type { State, StepContext, Task } from './types.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const article = $('step');
const ledger = $('ledger');
const nextBtn = $<HTMLButtonElement>('next');
const backBtn = $<HTMLButtonElement>('back');
const hint = $('hint');
const progress = $('progress');
const progressLabel = $('progress-label');


interface StepRun {
  tasks: Task[];
  done: boolean;
  running: boolean;
  error?: string;
}

let state: State = freshState();
let index = 0;
let runs: StepRun[] = STEPS.map(newRun);
const tickers = new Map<number, number>();

function newRun(step: (typeof STEPS)[number]): StepRun {
  return {
    tasks: (step.tasks ?? []).map((label) => ({ label, status: 'pending' as const })),
    done: !step.run,
    running: false,
  };
}

const ctx = (i: number): StepContext => ({ state, tasks: runs[i].tasks, done: runs[i].done, error: runs[i].error });

// ------------------------------------------------------------------ render

function render(animate = false) {
  const step = STEPS[index];
  const run = runs[index];
  // A view bug must never turn finished testnet work into a failed task.
  try {
    article.innerHTML = step.view(ctx(index));
  } catch (e) {
    console.error('[tour] view', e);
  }
  applyGrow(article);
  if (animate) {
    article.classList.remove('enter');
    void article.offsetWidth;
    article.classList.add('enter');
  }
  document.title = index === 0 ? 'W addresses on Stellar · a live tour' : `${step.short} · W addresses on Stellar`;

  progress.innerHTML = STEPS.map((_, i) => `<li class="${i < index ? 'done' : i === index ? 'current' : ''}"></li>`).join('');
  const total = STEPS.length - 1;
  progressLabel.innerHTML =
    index === 0
      ? `<span class="pl-long">${total} steps · about a minute</span><span class="pl-short">About 1 min</span>`
      : `<span class="pl-long">Step ${index} of ${total} · ${esc(step.short)}</span><span class="pl-short">Step ${index} of ${total}</span>`;

  backBtn.hidden = index === 0;
  const last = index === STEPS.length - 1;
  nextBtn.disabled = run.running;
  nextBtn.innerHTML = run.running
    ? `<svg class="spin" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3.5a6.5 6.5 0 1 1-6.5 6.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>Working on testnet`
    : `${esc(step.next)}${last ? '' : ARROW}`;
  hint.textContent = run.running ? 'Real transactions take about 5 seconds per ledger.' : run.error ? 'Try the step again, or go back.' : '';
  renderLedger();
}

const ARROW = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11m-4.5-4.5L15 10l-4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function renderLedger() {
  try {
    drawLedger();
  } catch (e) {
    console.error('[tour] ledger', e);
  }
}

function drawLedger() {
  const s = state;
  const amounts = subAccountTotals(s);
  const subs = [...s.subAccounts, ...(s.rampSubAccount ? [s.rampSubAccount] : [])];
  const sum = subs.reduce((a, p) => a + (amounts.get(p.id) ?? 0n), 0n);
  const total = s.balance;
  const bar =
    total && total > 0n
      ? `<div class="share" role="img" aria-label="How the balance splits across sub-accounts">${subs
          .map((p) => {
            const v = amounts.get(p.id) ?? 0n;
            return v > 0n ? `<i class="tone-${p.tone}" data-grow="${Number((v * 1000n) / total)}"></i>` : '';
          })
          .join('')}</div>`
      : '';
  const rows = subs.length
    ? `<ul class="subs">${subs
        .map((p) => {
          const v = amounts.get(p.id);
          return `<li class="sub${v ? ' filled' : ''}">
            <span class="chip tone-${p.tone}" aria-hidden="true"></span>
            <span class="sub-name">${esc(p.name)}</span>
            <span class="sub-id mono">#${p.id.toLocaleString('en-US')}</span>
            <span class="sub-amt">${v ? `${formatXlm(v, 2)} XLM` : '<span class="muted">Empty</span>'}</span>
          </li>`;
        })
        .join('')}</ul>`
    : `<p class="purse-empty">${s.walletId ? 'No W addresses yet. The next step makes three.' : 'Sub-accounts show here after the tour makes your wallet.'}</p>`;

  const acts = s.activity
    .map(
      (a) => `<li><span class="dot${a.ok ? '' : ' bad'}" aria-hidden="true"></span><span>${esc(a.label)}${a.ok ? '' : ' <span class="sr-only">(refused)</span>'}</span>
        ${a.hash ? `<a href="${esc(txUrl(a.hash))}" target="_blank" rel="noopener noreferrer" aria-label="View transaction for ${esc(a.label)}">${esc(short(a.hash, 4, 4))}</a>` : '<span class="muted small">No ledger</span>'}</li>`,
    )
    .join('');

  ledger.innerHTML = `
    <section class="purse${s.walletId ? '' : ' empty'}">
      <div class="purse-head">
        <h2>Your smart wallet</h2>
        <span class="purse-addr">${s.walletId ? `<a href="${esc(contractUrl(s.walletId))}" target="_blank" rel="noopener noreferrer">${esc(short(s.walletId, 5, 5))}</a>` : 'Not created yet'}</span>
      </div>
      <p class="purse-total"><span class="num">${total !== undefined ? formatXlm(total, 2) : '0'}</span> XLM</p>
      <p class="purse-sub">${
        total !== undefined && subs.some((p) => amounts.has(p.id))
          ? sum === total
            ? 'One balance on chain. Sub-accounts add up to it.'
            : `One balance on chain. Sub-accounts add up to ${formatXlm(sum, 2)} XLM.`
          : 'One balance on chain'
      }</p>
      ${bar}
      ${rows}
    </section>
    <section>
      <h2>Transactions</h2>
      ${acts ? `<ul class="activity">${acts}</ul>` : '<p>Real transactions show here as the tour runs. Each one links to a public block explorer.</p>'}
    </section>`;
  applyGrow(ledger);
}

/** The CSP forbids inline style attributes, so sizes go through the CSSOM. */
function applyGrow(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('[data-grow]').forEach((el) => {
    el.style.flexGrow = el.dataset.grow ?? '0';
  });
}

/** Sub-account balances, from rebuilt events when we have them, else from payment receipts. */
function subAccountTotals(s: State): Map<bigint, bigint> {
  const m = new Map<bigint, bigint>();
  // `payments` can have gaps while parallel payments finish out of order.
  const list = s.deposits ?? [...s.payments.filter(Boolean).map((p) => p.deposit), ...(s.rampPayment ? [s.rampPayment.deposit] : [])];
  for (const d of list) if (d.muxedId !== undefined) m.set(d.muxedId, (m.get(d.muxedId) ?? 0n) + d.amount);
  if (s.deposits && s.rampPayment && !s.deposits.some((d) => d.hash === s.rampPayment!.hash)) {
    const d = s.rampPayment.deposit;
    m.set(d.muxedId!, (m.get(d.muxedId!) ?? 0n) + d.amount);
  }
  return m;
}

// -------------------------------------------------------------------- run

async function runStep(i: number) {
  const step = STEPS[i];
  const run = runs[i];
  if (!step.run || run.done || run.running) return;
  run.running = true;
  run.error = undefined;
  run.tasks.forEach((t) => {
    if (t.status !== 'done') t.status = 'pending';
  });
  render();

  const runner = async (ti: number, fn: () => Promise<string | void>) => {
    const task = run.tasks[ti];
    if (task.status === 'done') return; // keep finished work on a retry
    task.status = 'running';
    task.meta = '';
    const started = performance.now();
    startTicker(i, ti, started);
    if (i === index) render();
    try {
      const note = await fn();
      task.status = 'done';
      const secs = (performance.now() - started) / 1000;
      task.meta = note ? String(note) : secs >= 1 ? `${secs.toFixed(1)} s` : '';
    } catch (e) {
      task.status = 'error';
      task.meta = '';
      throw e;
    } finally {
      stopTicker(ti);
      if (i === index) render();
    }
  };

  try {
    await step.run(state, runner);
    run.done = true;
    await refreshBalances();
  } catch (e) {
    console.error('[tour]', e, (e as { detail?: unknown }).detail);
    run.error = friendly(e);
  } finally {
    run.running = false;
    if (i === index) render();
  }
}

function friendly(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/fetch|network|Failed to fetch|NetworkError|load failed/i.test(msg)) return 'The page could not reach the Stellar test network.';
  if (/friendbot/i.test(msg)) return 'Friendbot, the test network faucet, did not answer.';
  return msg.length > 220 ? `${msg.slice(0, 220)}…` : msg;
}

function startTicker(stepIndex: number, taskIndex: number, started: number) {
  stopTicker(taskIndex);
  const ticker = window.setInterval(() => {
    if (stepIndex !== index) return;
    const el = article.querySelector<HTMLElement>(`[data-task-meta="${taskIndex}"]`);
    const secs = (performance.now() - started) / 1000;
    if (el && secs >= 1) el.textContent = `${secs.toFixed(0)} s`;
  }, 500);
  tickers.set(taskIndex, ticker);
}

function stopTicker(taskIndex?: number) {
  for (const [k, v] of tickers) {
    if (taskIndex === undefined || k === taskIndex) {
      window.clearInterval(v);
      tickers.delete(k);
    }
  }
}

async function refreshBalances() {
  const tour = state.tour;
  if (!tour || !state.walletId) return;
  const bal = await tour.balance(state.walletId).catch(() => undefined);
  if (bal !== undefined) state.balance = bal;
  renderLedger();
}

// --------------------------------------------------------------- navigate

function go(to: number) {
  if (to < 0 || to >= STEPS.length) return;
  index = to;
  render(true);
  window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  article.focus({ preventScroll: true });
  void runStep(index);
}

function next() {
  if (runs[index].running) return;
  if (runs[index].error) return void runStep(index);
  if (index === STEPS.length - 1) return restart();
  go(index + 1);
}

function restart() {
  state = freshState();
  runs = STEPS.map(newRun);
  go(1);
}

nextBtn.addEventListener('click', next);
backBtn.addEventListener('click', () => go(index - 1));
article.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action="retry"]');
  if (el) void runStep(index);
});
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const target = e.target as HTMLElement;
  if (target.closest('a, button, input, textarea, select')) return;
  if (e.key === 'ArrowRight') next();
  if (e.key === 'ArrowLeft' && index > 0 && !runs[index].running) go(index - 1);
});
window.addEventListener('beforeunload', (e) => {
  if (runs.some((r) => r.running)) e.preventDefault();
});

render();
