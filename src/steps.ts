// The tour: an intro and eight steps. Each step has copy, an optional testnet
// action, and a view of the results. Copy cites its sources at the end of each step.
import { Keypair } from '@stellar/stellar-sdk';
import {
  MAX_U64,
  StellarTour,
  XLM_SAC,
  accountUrl,
  contractUrl,
  formatXlm,
  muxedAddress,
  strkeyParts,
  toHex,
  txUrl,
} from './lib/stellar.ts';
import type { SubAccount, State, StepContext, Step } from './types.ts';

// ------------------------------------------------------------------ helpers

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const ext = (url: string, text: string) =>
  `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
export const short = (s: string, head = 6, tail = 6) => (s.length > head + tail + 1 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s);
const n = (x: number | bigint) => x.toLocaleString('en-US');
const xlm = (whole: number) => BigInt(whole) * 10_000_000n;

const src = {
  bell: ['Introducing Bell, Protocol 30 on Stellar (20 October 2026)', 'https://stellar.org/blog/developers/introducing-bell-protocol-30-on-stellar'],
  guide: ['Bell, Protocol 30 upgrade guide', 'https://stellar.org/blog/developers/bell-protocol-30-upgrade-guide'],
  cap84: ['CAP-84: Muxed contract addresses', 'https://github.com/stellar/stellar-protocol/blob/master/core/cap-0084.md'],
  cap67: ['CAP-67: Unified asset events (muxed accounts in contracts)', 'https://github.com/stellar/stellar-protocol/blob/master/core/cap-0067.md'],
  sep23: ['SEP-23: Strkey encoding (W for muxed contracts)', 'https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0023.md'],
  sep41: ['SEP-41: Token interface', 'https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0041.md'],
  discussion: ['CAP-84 discussion: Support muxed contract addresses', 'https://github.com/orgs/stellar/discussions/1950'],
  meeting: ['Stellar protocol meeting, 16 July 2026: why muxed contract addresses', 'https://developers.stellar.org/meetings/2026/07/16/protocol'],
  pooled: ['Stellar docs: pooled accounts, muxed accounts and memos', 'https://developers.stellar.org/docs/build/guides/transactions/pooled-accounts-muxed-accounts-memos'],
  cAccounts: ['Stellar docs: send to and receive from contract accounts', 'https://developers.stellar.org/docs/build/guides/transactions/send-and-receive-c-accounts'],
  sac: ['Stellar docs: Stellar Asset Contract, sending to a muxed address', 'https://developers.stellar.org/docs/tokens/stellar-asset-contract#sending-to-a-muxed-address'],
  getEvents: ['Stellar docs: RPC getEvents', 'https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getEvents'],
  sep24: ['SEP-24: Hosted deposit and withdrawal', 'https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0024.md'],
  contractAccounts: ['Stellar docs: contract accounts', 'https://developers.stellar.org/docs/build/guides/contract-accounts'],
  friendbot: ['Stellar docs: networks and friendbot', 'https://developers.stellar.org/docs/learn/fundamentals/networks'],
} as const;
type SrcKey = keyof typeof src;

const sources = (...keys: SrcKey[]) => `
  <footer class="sources">
    <h2>Sources</h2>
    <ol>${keys.map((k) => `<li>${ext(src[k][1], esc(src[k][0]))}</li>`).join('')}</ol>
  </footer>`;

const head = (eyebrow: string, title: string) => `<p class="eyebrow">${eyebrow}</p><h1>${title}</h1>`;

const ICON = {
  pending: `<svg class="task-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2.5 3"/></svg>`,
  running: `<svg class="task-icon spin" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3.5a6.5 6.5 0 1 1-6.5 6.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  done: `<svg class="task-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5" fill="currentColor" opacity=".14"/><path d="m6.5 10.2 2.4 2.4 4.6-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  error: `<svg class="task-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5" fill="currentColor" opacity=".14"/><path d="m7.3 7.3 5.4 5.4m0-5.4-5.4 5.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
};
const STATUS_TEXT = { pending: 'Waiting', running: 'Working', done: 'Done', error: 'Failed' };

/** The live well: task checklist, then results, then any error. */
function live(ctx: StepContext, results = ''): string {
  if (!ctx.tasks.length && !results) return '';
  const tasks = ctx.tasks.length
    ? `<ul class="tasks">${ctx.tasks
        .map(
          (t, i) => `<li class="task ${t.status}">
            ${ICON[t.status]}
            <span class="task-label"><span class="sr-only">${STATUS_TEXT[t.status]}: </span>${t.label}</span>
            <span class="task-meta" data-task-meta="${i}">${t.meta ?? ''}</span>
          </li>`,
        )
        .join('')}</ul>`
    : '';
  const error = ctx.error
    ? `<div class="error-box" role="alert">
        <strong>That step did not finish.</strong>
        <p class="muted">${esc(ctx.error)}</p>
        <p class="muted">The test network or its faucet can be busy. Try the step again.</p>
        <button type="button" class="btn-secondary" data-action="retry">Try this step again</button>
      </div>`
    : '';
  return `<section class="live" aria-label="Live results">${tasks}${results}${error}</section>`;
}

const kv = (rows: [string, string][]) =>
  `<dl class="kv">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;

const link = (url: string, text: string) => ext(url, `<span class="mono">${esc(text)}</span>`);

/** Splits each W address into the part all sub-accounts share and the part that differs. */
function stacked(addresses: string[]): string[] {
  let common = addresses[0]?.length ?? 0;
  for (const a of addresses) {
    let i = 0;
    while (i < common && a[i] === addresses[0][i]) i++;
    common = i;
  }
  return addresses.map((a) => `<span class="same">${esc(a.slice(0, common))}</span><b>${esc(a.slice(common))}</b>`);
}

/** Fees differ: the first payment into a wallet also pays to create its balance entry. */
function feeLine(fees: bigint[]): string {
  const lo = fees.reduce((a, b) => (b < a ? b : a));
  const hi = fees.reduce((a, b) => (b > a ? b : a));
  if (hi === lo) return `Each payment cost ${formatXlm(lo, 5)} XLM in fees.`;
  return `Fees were ${formatXlm(lo, 5)} to ${formatXlm(hi, 4)} XLM. The higher one paid once to create the wallet’s XLM balance on chain.`;
}

const chip = (p: SubAccount) => `<span class="chip tone-${p.tone}" aria-hidden="true"></span>`;

// ---------------------------------------------------------------- the story

const SUB_ACCOUNTS: Omit<SubAccount, 'address'>[] = [
  { id: 1n, name: 'Rent', payer: 'Sam, your roommate', memoText: 'Rent share for December', amount: xlm(120), tone: 0 },
  { id: 2n, name: 'Freelance', payer: 'Northwind Studio', memoText: 'Invoice for the logo work', amount: xlm(45), tone: 1 },
  { id: 3n, name: 'Gifts', payer: 'Grandma', memoText: 'Happy birthday', amount: xlm(25), tone: 2 },
];
/** A ramp order number. In SEP-24 this would be the memo the ramp asks for. */
export const ORDER_ID = 4_815_162_342n;
const RAMP_AMOUNT = xlm(50);

// --------------------------------------------------------------------- steps

export function freshState(): State {
  return { activity: [], subAccounts: [], payments: [] };
}

export const STEPS: Step[] = [
  // 0 -----------------------------------------------------------------------
  {
    id: 'intro',
    short: 'Why W addresses',
    next: 'Start the tour',
    view: () => `
      ${head('A live tour of Stellar Protocol 30, “Bell”', 'One smart wallet. A new address for every reason you get paid.')}
      <p class="lede">An email alias gives you a new address for each sender, and every message still lands in one inbox. Bell gives smart wallets the same trick. It adds <strong>W addresses</strong>, which CAP-84 calls muxed contract addresses: one wallet contract plus a 64-bit number.</p>
      <p>Before Bell, a smart wallet had exactly one address. Every payment looked the same, so a wallet could not tell rent from a refund. A business had to deploy one contract for each customer. That works for ten customers. It does not work for a million.</p>
      <figure class="grid4" aria-label="The four kinds of Stellar address">
        <div class="g-corner" aria-hidden="true"></div>
        <div class="g-col">One address</div>
        <div class="g-col">Address + 64-bit id</div>
        <div class="g-row">Account (key pair)</div>
        <div class="g-cell"><span class="glyph">G</span><span>Classic account</span></div>
        <div class="g-cell"><span class="glyph">M</span><span>Muxed account, since 2021</span></div>
        <div class="g-row">Smart wallet (contract)</div>
        <div class="g-cell"><span class="glyph">C</span><span>Contract</span></div>
        <div class="g-cell new"><span class="glyph">W</span><span>Muxed contract, new in Bell</span></div>
      </figure>
      <p class="muted small">Why the letter W? In the words of CAP-84’s author, “It’s an upside-down M.”</p>
      <p>In the next minute, you will make a smart wallet on the real Stellar test network, give it three addresses, and get paid into each one. Then you will see what the network refuses, and what this costs. You do not need a wallet or an account.</p>
      <dl class="facts">
        <div><dt>18.4 quintillion</dt><dd>Addresses that one wallet can hand out. That is every 64-bit number.</dd></div>
        <div><dt>0 transactions</dt><dd>To make a new address. Your browser does it offline, for free.</dd></div>
        <div><dt>+8 bytes</dt><dd>Extra size on chain, compared with a plain contract address.</dd></div>
      </dl>
      ${sources('bell', 'cap84', 'sep23', 'pooled')}`,
  },

  // 1 -----------------------------------------------------------------------
  {
    id: 'wallet',
    short: 'Make a smart wallet',
    next: 'Give it three addresses',
    tasks: [
      'Make an owner key in your browser',
      'Ask friendbot for test XLM for 5 accounts',
      'Make sure the wallet code is on testnet',
      'Deploy your smart wallet',
    ],
    async run(s, t) {
      await t(0, async () => {
        s.tour ??= new StellarTour();
        s.owner ??= Keypair.random();
        s.senders ??= SUB_ACCOUNTS.map(() => Keypair.random());
        s.ramp ??= Keypair.random();
        return short(s.owner.publicKey(), 4, 4);
      });
      await t(1, async () => {
        const all = [s.tour!.feePayer, ...s.senders!, s.ramp!];
        const hashes = await Promise.all(all.map((k) => s.tour!.fund(k.publicKey())));
        s.activity.push({ label: 'Friendbot funds 5 test accounts', hash: hashes[0], ok: true });
        return '5 accounts';
      });
      await t(2, async () => {
        const res = await fetch('/muxed_wallet.wasm');
        if (!res.ok) throw new Error('The page could not load the wallet code.');
        const wasm = new Uint8Array(await res.arrayBuffer());
        const { wasmHash, uploadTx } = await s.tour!.ensureWasm(wasm);
        s.wasmHash = wasmHash;
        s.wasmUploaded = Boolean(uploadTx);
        if (uploadTx) s.activity.push({ label: 'Upload the wallet code', hash: uploadTx.hash, ok: true });
        return uploadTx ? 'Uploaded' : 'Already there';
      });
      await t(3, async () => {
        const d = await s.tour!.deployWallet(s.wasmHash!, s.owner!.rawPublicKey());
        s.walletId = d.contractId;
        s.deployLedger = d.ledger;
        s.balance = 0n;
        s.activity.push({ label: 'Deploy your smart wallet', hash: d.hash, ok: true });
        return short(d.contractId, 4, 4);
      });
    },
    view: (ctx) => {
      const s = ctx.state;
      const results = s.walletId
        ? kv([
            ['Your wallet', link(contractUrl(s.walletId), short(s.walletId, 8, 8))],
            ['Owner key', `<span class="mono">${esc(short(s.owner!.publicKey(), 6, 6))}</span> <span class="muted small">in this tab only</span>`],
            ['Wallet code', `<span class="mono">${esc(short(s.wasmHash!, 8, 8))}</span> <span class="muted small">${s.wasmUploaded ? 'you uploaded it' : 'already on testnet'}</span>`],
          ])
        : '';
      return `
        ${head('Step 1 · The wallet', 'Make a smart wallet with one address.')}
        <p class="lede">A smart wallet is a contract, not a key pair. Its code decides who can spend, so it can use passkeys, spending limits, or several signers.</p>
        <p>This wallet is tiny on purpose. It holds one owner key, and it approves what that key signs. Watch the address it gets. It starts with <code>C</code>, and before Bell it was the only address the wallet could have.</p>
        ${live(ctx, results)}
        <p class="note">Five test accounts get free test XLM: a fee payer for the tour, three people who will pay you, and a cash-in service. Test XLM has no value.</p>
        ${sources('contractAccounts', 'friendbot')}`;
    },
  },

  // 2 -----------------------------------------------------------------------
  {
    id: 'addresses',
    short: 'Three addresses',
    next: 'Get paid into each one',
    tasks: ['Make three W addresses in your browser'],
    async run(s, t) {
      await t(0, async () => {
        const started = performance.now();
        s.subAccounts = SUB_ACCOUNTS.map((p) => ({ ...p, address: muxedAddress(s.walletId!, p.id) }));
        const ms = performance.now() - started;
        return `${ms < 1 ? '<1' : ms.toFixed(0)} ms, no network`;
      });
    },
    view: (ctx) => {
      const s = ctx.state;
      if (!s.subAccounts.length || !s.walletId) {
        return `${head('Step 2 · Addresses', 'Give the wallet three addresses.')}${live(ctx)}`;
      }
      const ws = stacked(s.subAccounts.map((p) => p.address!));
      const cards = s.subAccounts
        .map(
          (p, i) => `<li class="pcard">
            <div class="pcard-head">${chip(p)}<strong>${esc(p.name)}</strong><span class="sub-id mono">id ${p.id}</span></div>
            <p class="waddr mono">${ws[i]}</p>
            <p class="muted small">For ${esc(p.payer)}</p>
          </li>`,
        )
        .join('');

      const c = s.walletId;
      const w = s.subAccounts[1].address!;
      // C and W share every character except the first and the tail, because
      // both version bytes leave the same low 3 bits and wrap the same 32 bytes.
      const parts = strkeyParts(w);
      const bytes = (b: Uint8Array) => toHex(b).replace(/(..)/g, '$1 ').trim();
      return `
        ${head('Step 2 · Addresses', 'Give the wallet three addresses.')}
        <p class="lede">Your browser just made three W addresses, one for each kind of money you expect. It sent nothing to the network, paid no fee, and asked no one.</p>
        ${live(ctx)}
        <ul class="pcards">${cards}</ul>
        <p>Look at the three addresses. Only the end changes. Each one is the same wallet plus a different number. The number is part of the address, so a sender cannot forget it, the way people forget a memo.</p>
        <h2>Inside a W address</h2>
        <figure class="anatomy">
          <div class="align mono" aria-label="The C address and a W address line up">
            <div><span class="k">C</span><span class="same">${esc(c.slice(1, 52))}</span><b>${esc(c.slice(52))}</b><span class="tag">your wallet</span></div>
            <div><span class="k w">W</span><span class="same">${esc(w.slice(1, 52))}</span><b>${esc(w.slice(52))}</b><span class="tag">Freelance</span></div>
          </div>
          <div class="segs" role="img" aria-label="43 bytes: 1 version byte, 32 bytes of contract id, 8 bytes of id, 2 bytes of checksum">
            <i class="seg-v" data-grow="3"></i><i class="seg-c" data-grow="32"></i><i class="seg-id" data-grow="8"></i><i class="seg-x" data-grow="3"></i>
          </div>
          <dl class="seg-key">
            <div><dt><span class="sw seg-v"></span>1 byte</dt><dd>The type, <code>0x${parts.version.toString(16)}</code>, which makes the first letter W</dd></div>
            <div><dt><span class="sw seg-c"></span>32 bytes</dt><dd>Your wallet’s contract id, the same bytes as the C address</dd></div>
            <div><dt><span class="sw seg-id"></span>8 bytes</dt><dd>The id: <code>${bytes(parts.id)}</code> is ${s.subAccounts[1].id}</dd></div>
            <div><dt><span class="sw seg-x"></span>2 bytes</dt><dd>A checksum that catches typos</dd></div>
          </dl>
        </figure>
        <p class="note">This tour calls each W address and its money a sub-account. The names Rent, Freelance and Gifts live only in your app. The network sees one contract and a 64-bit id. You could give every customer, invoice, or order its own address, and never touch the chain to do it.</p>
        ${sources('sep23', 'cap84')}`;
    },
  },

  // 3 -----------------------------------------------------------------------
  {
    id: 'paid',
    short: 'Get paid',
    next: 'Check the balance',
    tasks: SUB_ACCOUNTS.map((p) => `${p.payer.split(',')[0]} pays ${formatXlm(p.amount)} XLM to ${p.name}`),
    async run(s, t) {
      // Three senders, three transactions, sent at the same time.
      const results = await Promise.allSettled(
        s.subAccounts.map((p, i) =>
          t(i, async () => {
            const r = await s.tour!.pay(s.senders![i], p.address!, p.amount);
            s.payments[i] = r;
            s.activity.push({ label: `${p.payer.split(',')[0]} pays ${p.name}`, hash: r.hash, ok: true });
            return `ledger ${n(r.ledger)}`;
          }),
        ),
      );
      const failed = results.find((r) => r.status === 'rejected');
      if (failed) throw (failed as PromiseRejectedResult).reason;
    },
    view: (ctx) => {
      const s = ctx.state;
      const paid = s.payments.filter(Boolean);
      const rows = s.subAccounts
        .map((p, i) => {
          const r = s.payments[i];
          return `<tr>
            <th scope="row">${chip(p)}${esc(p.payer.split(',')[0])}</th>
            <td class="mono col-sent">${esc(short(p.address!, 4, 6))}</td>
            <td class="mono">${r ? esc(short(r.deposit.to, 4, 4)) : '…'}</td>
            <td class="mono strong">${r?.deposit.muxedId !== undefined ? String(r.deposit.muxedId) : '…'}</td>
            <td class="num">${r ? formatXlm(r.deposit.amount, 2) : '…'}</td>
          </tr>`;
        })
        .join('');
      const ex = paid[0];
      const results = paid.length
        ? `<div class="table-scroll"><table class="metrics events">
            <caption>What the network recorded</caption>
            <thead><tr><th scope="col">From</th><th scope="col" class="col-sent">Sent to</th><th scope="col">Event <code>to</code></th><th scope="col"><code>to_muxed_id</code></th><th scope="col" class="num">XLM</th></tr></thead>
            <tbody>${rows}</tbody>
          </table></div>`
        : '';
      const sameTo = paid.length === s.subAccounts.length && paid.every((p) => p.deposit.to === s.walletId);
      return `
        ${head('Step 3 · Get paid', 'Three people pay three addresses.')}
        <p class="lede">Sam, Northwind Studio, and Grandma each send test XLM to a different W address. The three payments go out at the same time, as three real transactions.</p>
        ${live(ctx, results)}
        ${
          sameTo
            ? `<p>Every event names the same plain address: your wallet’s C address. The money went to one place. The id rides along in the event, in a field called <code>to_muxed_id</code>. That is the only difference.</p>
        <figure class="code">
          <figcaption>The transfer event for ${esc(s.subAccounts[0].name)}, as the network emits it</figcaption>
          <pre class="code">topics: [
  "transfer",
  ${esc(short(ex.deposit.from, 4, 4))},  // from: Sam
  <span class="hl">${esc(short(ex.deposit.to, 4, 4))}</span>,  // to: your wallet
  "native"
]
data: {
  amount: ${ex.deposit.amount},  // stroops
  <span class="hl">to_muxed_id: ${ex.deposit.muxedId}</span>    // the sub-account
}</pre>
        </figure>
        <p class="muted">Your wallet contract ran no new code for this. The Stellar Asset Contract, which moves XLM and other Stellar assets, accepts a W address in <code>transfer</code> and writes the event. ${feeLine(paid.map((p) => p.feeCharged))}</p>`
            : `<p>Each payment goes to a W address. Watch what the network writes down for it.</p>`
        }
        ${sources('cap84', 'cap67', 'sac')}`;
    },
  },

  // 4 -----------------------------------------------------------------------
  {
    id: 'balance',
    short: 'One balance',
    next: 'Cash in from a ramp',
    tasks: ['Read the wallet’s balance on chain', 'Rebuild the sub-accounts from network events'],
    async run(s, t) {
      await t(0, async () => {
        s.balance = await s.tour!.balance(s.walletId!);
        return `${formatXlm(s.balance, 2)} XLM`;
      });
      await t(1, async () => {
        s.deposits = await s.tour!.depositsTo(s.walletId!, s.deployLedger!);
        return `${s.deposits.length} events`;
      });
    },
    view: (ctx) => {
      const s = ctx.state;
      const dep = s.deposits ?? [];
      const per = s.subAccounts.map((p) => ({ p, v: dep.filter((d) => d.muxedId === p.id).reduce((a, d) => a + d.amount, 0n) }));
      const sum = per.reduce((a, x) => a + x.v, 0n);
      const ok = s.balance !== undefined && s.deposits && sum === s.balance;
      const results =
        s.balance !== undefined && s.deposits
          ? `<div class="sum" aria-label="Sub-account totals add up to the on-chain balance">
              ${per
                .map(
                  ({ p, v }, i) =>
                    `${i ? '<span class="op" aria-hidden="true">+</span>' : ''}<span class="term">${chip(p)}<span class="t-name">${esc(p.name)}</span><span class="t-num">${formatXlm(v, 2)}</span></span>`,
                )
                .join('')}
              <span class="op" aria-hidden="true">=</span>
              <span class="term total"><span class="t-name">On chain</span><span class="t-num">${formatXlm(s.balance, 2)}</span></span>
            </div>
            <p class="small ${ok ? 'ok' : 'bad'}">${ok ? 'The sub-accounts add up to the balance, to the stroop.' : 'The sub-accounts do not add up. The events may still be indexing.'}</p>`
          : '';
      return `
        ${head('Step 4 · One balance', 'One balance on chain. Your app splits it.')}
        <p class="lede">The network does not know about Rent, Freelance, or Gifts. It holds one XLM balance for one contract. Your app sorts the money by reading events.</p>
        ${live(ctx, results)}
        <p>To rebuild the sub-accounts, the tour asked a public Stellar RPC server for every transfer into your wallet. It grouped them by <code>to_muxed_id</code>. Any app can do this, so a lost database is not a lost ledger.</p>
        <p class="note">This is also a limit. A sub-account is bookkeeping, not a lock. The wallet contract can spend the whole balance, and nothing on chain stops “Rent” money from paying for groceries. If sub-accounts must be enforced, the wallet contract has to do it.</p>
        ${sources('getEvents', 'cap84')}`;
    },
  },

  // 5 -----------------------------------------------------------------------
  {
    id: 'ramp',
    short: 'Cash in',
    next: 'See what the network refuses',
    tasks: [
      `The old way: put order ${n(ORDER_ID)} in a memo`,
      `The new way: pay the W address for order ${n(ORDER_ID)}`,
      'Match the deposit to the order',
    ],
    async run(s, t) {
      const rampSubAccount: SubAccount = {
        id: ORDER_ID,
        name: `Cash-in order`,
        payer: 'A cash-in service',
        memoText: `Order ${ORDER_ID}`,
        amount: RAMP_AMOUNT,
        tone: 3,
        address: muxedAddress(s.walletId!, ORDER_ID),
      };
      await t(0, async () => {
        s.memoRefused = await s.tour!.payWithMemo(s.ramp!, s.walletId!, RAMP_AMOUNT, ORDER_ID);
        s.activity.push({ label: 'Memo on a contract call (refused)', hash: '', ok: false });
        return `Refused: ${s.memoRefused.code}`;
      });
      await t(1, async () => {
        s.rampPayment = await s.tour!.pay(s.ramp!, rampSubAccount.address!, RAMP_AMOUNT);
        s.activity.push({ label: `Cash-in for order ${n(ORDER_ID)}`, hash: s.rampPayment.hash, ok: true });
        return `ledger ${n(s.rampPayment.ledger)}`;
      });
      await t(2, async () => {
        if (s.rampPayment!.deposit.muxedId !== ORDER_ID) throw new Error('The deposit carried the wrong order number.');
        s.rampSubAccount = rampSubAccount;
        return 'Matched';
      });
    },
    view: (ctx) => {
      const s = ctx.state;
      const results = s.rampPayment
        ? kv([
            ['Memo attempt', `<span class="bad">Refused before any ledger:</span> <code>${esc(s.memoRefused!.code)}</code>`],
            ['Order address', `<span class="mono">${esc(short(s.rampSubAccount?.address ?? muxedAddress(s.walletId!, ORDER_ID), 6, 10))}</span>`],
            ['Deposit', `${link(txUrl(s.rampPayment.hash), short(s.rampPayment.hash, 6, 6))} · ${formatXlm(s.rampPayment.deposit.amount, 2)} XLM`],
            ['Event says', `<code>to_muxed_id: ${s.rampPayment.deposit.muxedId}</code>`],
            ['Status', s.rampSubAccount ? `<span class="ok">Order ${n(ORDER_ID)} matched</span>` : '…'],
          ])
        : s.memoRefused
          ? kv([['Memo attempt', `<span class="bad">Refused before any ledger:</span> <code>${esc(s.memoRefused.code)}</code>`]])
          : '';
      return `
        ${head('Step 5 · Cash in', 'A ramp sends you money for order 4,815,162,342.')}
        <p class="lede">You buy test XLM from a cash-in service, called a ramp. The ramp needs to tell your wallet which order a payment is for. This is the case that started CAP-84.</p>
        <p>Ramps that follow SEP-24 match payments with a memo, a short note on the transaction. A smart wallet cannot receive that note. Watch what happens when the ramp tries.</p>
        ${live(ctx, results)}
        ${
          s.rampSubAccount
            ? `<p>The network refused the memo at the door: a transaction that calls a contract cannot carry a memo. No fee was paid and no ledger recorded it. Then the ramp paid the W address for the order, and the order number arrived inside the event. Your wallet matched it with no guessing.</p>`
            : ''
        }
        <p class="note">Before Bell, the wallet’s only fix was a new contract for every order. Now one wallet takes every order, and each order number is its own address.</p>
        ${sources('discussion', 'sep24', 'cAccounts')}`;
    },
  },

  // 6 -----------------------------------------------------------------------
  {
    id: 'guardrails',
    short: 'Guardrails',
    next: 'Weigh the trade-offs',
    tasks: ['Ask the network for the balance of a W address'],
    async run(s, t) {
      await t(0, async () => {
        s.balanceRefused = await s.tour!.balanceOfMuxed(s.subAccounts[0].address!);
        return 'Refused';
      });
    },
    view: (ctx) => {
      const s = ctx.state;
      const results = s.balanceRefused
        ? kv([
            ['Asked', `<code>balance(${esc(short(s.subAccounts[0].address!, 4, 6))})</code>`],
            ['Network said', `<code class="bad">${esc(s.balanceRefused.code)}</code>`],
            ['Why', 'A sub-account has no balance of its own. Only the wallet does.'],
          ])
        : '';
      return `
        ${head('Step 6 · Guardrails', 'A W address only works where a contract asks for one.')}
        <p class="lede">The network treats a W address as its own type. A contract function that asks for a plain address refuses it. This stops a muxed id from leaking into places where it would be a mistake.</p>
        ${live(ctx, results)}
        <h2>The rules</h2>
        <ul class="rules">
          <li><strong>Payments in, yes.</strong> The Stellar Asset Contract’s <code>transfer</code> accepts a W address as the destination. So does any SEP-41 token whose <code>transfer</code> takes a <code>MuxedAddress</code>.</li>
          <li><strong>Plain addresses, no.</strong> A function declared with <code>Address</code> refuses a W address, as you just saw.</li>
          <li><strong>Storage keys, never.</strong> The network refuses to store data under a key that holds a W address. A contract that needs the id must split it out first.</li>
          <li><strong>Only the destination.</strong> A W address can receive. It cannot be the sender. The SAC <code>mint</code> function and <code>transfer_from</code> do not take one yet.</li>
        </ul>
        <figure class="code">
          <figcaption>How a token opts in (Rust, soroban-sdk 30)</figcaption>
          <pre class="code">fn transfer(env: Env, from: Address, to: <span class="hl">MuxedAddress</span>, amount: i128) {
    let id = to.id();          // Some(2) for a W address with id 2
    let to = to.address();     // the plain C address: move the money here
    // ... then emit to_muxed_id: id in the event
}</pre>
        </figure>
        ${sources('guide', 'cap84', 'sep41')}`;
    },
  },

  // 7 -----------------------------------------------------------------------
  {
    id: 'tradeoffs',
    short: 'Trade-offs',
    next: 'See what comes next',
    view: (ctx) => {
      const s = ctx.state;
      const fees = s.payments.filter(Boolean).map((p) => p.feeCharged);
      const fee = fees.length ? ` In this run, a payment cost as little as ${formatXlm(fees.reduce((a, b) => (b < a ? b : a)), 5)} XLM in fees.` : '';
      const pros: [string, string][] = [
        ['Free and instant to make', 'A new address needs no transaction, no fee, and no network.'],
        ['Nothing to forget', 'The id is inside the address. A memo is a separate field that people leave out.'],
        ['One wallet to protect', 'One contract, one set of rules, one place for passkeys and limits, for every customer.'],
        ['Same tools as M addresses', `Indexers that read <code>to_muxed_id</code> for muxed accounts need no new logic.${fee}`],
      ];
      const cons: [string, string][] = [
        ['Muxed ids are public', 'Anyone can read which id got how much. Use random ids, not customer numbers, if that matters.'],
        ['Sub-accounts are not enforced', 'The chain keeps one balance. Your app, or your contract, must keep the books.'],
        ['Every app must update', 'Wallets, exchanges, and explorers must accept W addresses. Older software rejects them.'],
        ['Receive only, for now', 'A W address can only be the destination of a <code>transfer</code>. It cannot send.'],
      ];
      const list = (items: [string, string][], kind: string) =>
        `<ul class="pc ${kind}">${items.map(([k, v]) => `<li><strong>${k}</strong><span>${v}</span></li>`).join('')}</ul>`;
      return `
        ${head('Step 7 · Trade-offs', 'What you get, and what you give up.')}
        <p class="lede">W addresses copy a design that classic Stellar accounts have used since 2021. They bring its strengths to smart wallets, and its weak spots too.</p>
        <div class="pros-cons">
          <section><h2>You get</h2>${list(pros, 'pro')}</section>
          <section><h2>You give up</h2>${list(cons, 'con')}</section>
        </div>
        <p class="note">Some core developers asked whether smart wallets need this at all, since a contract can track ids in its own code. The answer in the protocol meetings: a shared standard works across every token, wallet, and indexer. A custom scheme in each contract does not.</p>
        ${sources('meeting', 'discussion', 'guide', 'pooled')}`;
    },
  },

  // 8 -----------------------------------------------------------------------
  {
    id: 'next',
    short: 'What comes next',
    next: 'Run the tour again',
    view: (ctx) => {
      const s = ctx.state;
      return `
        ${head('Step 8 · What comes next', 'Next stop: the mainnet vote on 23 November.')}
        <p class="lede">The test network upgraded to Protocol 30 on 3 November 2026. That is where this tour ran. Validators vote on the mainnet upgrade on 23 November 2026 at 17:00 UTC.</p>
        <ol class="timeline">
          <li><span class="when">16 Oct 2026</span><strong>Stellar Core v30.0.0</strong><p>Stable release with CAP-84.</p></li>
          <li class="done"><span class="when">3 Nov 2026</span><strong>Testnet upgrade</strong><p>W addresses work on the test network.</p></li>
          <li class="now"><span class="when">23 Nov 2026</span><strong>Mainnet vote</strong><p>17:00 UTC. The upgrade takes effect if validators approve it.</p></li>
        </ol>
        <h2>If you build on Stellar</h2>
        <ul class="build-list">
          <li><strong>Wallets and explorers.</strong> Update your SDK, for example JavaScript SDK 17.3 or later. Accept W wherever you validate, show, or store addresses.</li>
          <li><strong>Exchanges and custodians.</strong> Let users withdraw to W addresses. If you take deposits on M addresses, a smart wallet with W addresses can do the same job.</li>
          <li><strong>Smart wallet providers.</strong> Give each customer, invoice, or ramp order its own W address, from one contract.</li>
          <li><strong>Token authors.</strong> Take <code>MuxedAddress</code> for the <code>to</code> of <code>transfer</code>, and emit <code>to_muxed_id</code>.</li>
        </ul>
        ${
          s.walletId
            ? `<p class="small muted">Your wallet stays on testnet until the next testnet reset: ${link(contractUrl(s.walletId), short(s.walletId, 6, 6))}. The fee payer was ${link(accountUrl(s.tour!.feePayer.publicKey()), short(s.tour!.feePayer.publicKey(), 4, 4))}. Native XLM contract: ${link(contractUrl(XLM_SAC), short(XLM_SAC, 4, 4))}.</p>`
            : ''
        }
        <p class="note">Everything in this tour ran in your browser. The page has no backend, no database, and no analytics. The keys lived in this tab and are gone when you close it. A muxed id can be any of ${n(MAX_U64 + 1n)} numbers.</p>
        ${sources('bell', 'guide', 'cap84', 'sep23')}`;
    },
  },
];
