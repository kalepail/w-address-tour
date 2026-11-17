# W addresses on Stellar: a live tour

A client-side guided tour of muxed contract addresses (CAP-84), part of Stellar
Protocol 30 ("Bell"). In about a minute, it makes a smart wallet on the real
Stellar testnet, gives it three `W…` addresses, gets paid into each one, and
shows what the network refuses. The only control a visitor needs is the Next button.

Live: https://muxed-c.stellar.buzz/

## What the tour does

| Step | On testnet |
| --- | --- |
| 1. The wallet | Funds 5 throwaway accounts with friendbot, uploads the wallet wasm if needed, deploys one smart wallet (`C…`) |
| 2. Addresses | Makes three `W…` addresses in the browser. No transaction |
| 3. Get paid | Three senders pay three `W…` addresses at the same time. Each SAC `transfer` event has `to` = the `C…` address and `to_muxed_id` = the id |
| 4. One balance | Reads the one on-chain balance, then rebuilds the sub-accounts from `getEvents` |
| 5. Cash in | A ramp tries a memo on a contract call (the network refuses it with `txSorobanInvalid`), then pays a `W…` address for order 4,815,162,342 |
| 6. Guardrails | Simulates `balance(W…)`. The host refuses it with `Error(Value, UnexpectedType)` |
| 7–8 | Trade-offs, dates, and what builders must change |

## Architecture

| Path | Role |
| --- | --- |
| `src/lib/stellar.ts` | All testnet calls and the `W…` encoder. Shared by the page and the Node end-to-end test |
| `src/steps.ts` | Step copy, tasks, and views |
| `src/main.ts` | The step engine: runs a step's tasks on entry, locks Next while working, offers a retry, draws the wallet panel |
| `contract/` | `muxed-wallet`: a minimal smart wallet (Ed25519 owner, `__check_auth`). It has no `W…` code: the SAC does the work |
| `public/muxed_wallet.wasm` | The built contract, fetched by the page |
| `scripts/og/` | Share card and touch icon, rendered with agent-browser |

## Commands

```bash
npm install
npm run dev                 # local dev server
npm test                    # unit tests, including SEP-23 W vectors
npm run contract:test       # Rust tests: W round trip, SAC event, refusal, auth
npm run e2e:testnet         # the whole flow against the real testnet, with asserts
npx vite preview --port 5299 &
bash scripts/browser-tour.sh http://localhost:5299/ 390 844 dark   # click through in Chrome
bash scripts/og/render.sh   # share card and touch icon
npx cf deploy               # Cloudflare Workers (assets only)
```

Building the contract needs Stellar CLI 30 or later:
`STELLAR=/path/to/stellar npm run contract:build`.

## Limits

- Testnet only. Test XLM has no value. Testnet resets remove the wallet.
- The wallet approves anything its owner key signs. It is a teaching example.
- Keys live in the browser tab and are gone when it closes.

## Contract license

The Rust example contracts are licensed under [Apache-2.0](contract/LICENSE).
