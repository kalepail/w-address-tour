// End-to-end check against the real Stellar testnet. It runs the same library
// calls as the browser tour, in the same order, and asserts each result.
//   npm run e2e:testnet
import { readFileSync } from 'node:fs';
import { Keypair } from '@stellar/stellar-sdk';
import { StellarTour, formatXlm, muxedAddress, splitMuxed, txUrl } from '../src/lib/stellar.ts';

const assert = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(`FAIL: ${msg}`);
  console.log(`  ok  ${msg}`);
};
const xlm = (n: number) => BigInt(n) * 10_000_000n;

const tour = new StellarTour();
const owner = Keypair.random();
const senders = [Keypair.random(), Keypair.random(), Keypair.random()];
const ramp = Keypair.random();

console.log('1. Fund accounts');
await Promise.all([tour.feePayer, ...senders, ramp].map((k) => tour.fund(k.publicKey())));
assert(true, 'friendbot funded 5 accounts');

console.log('2. Deploy wallet');
const wasm = new Uint8Array(readFileSync(new URL('../public/muxed_wallet.wasm', import.meta.url)));
const { wasmHash, uploadTx } = await tour.ensureWasm(wasm);
console.log(`     wasm ${wasmHash}${uploadTx ? ' (uploaded)' : ' (already on testnet)'}`);
const wallet = await tour.deployWallet(wasmHash, owner.rawPublicKey());
assert(wallet.contractId.startsWith('C'), `wallet ${wallet.contractId}`);
const startLedger = wallet.ledger;

console.log('3. Make W addresses (no network)');
const ids = [1n, 2n, 3n];
const ws = ids.map((id) => muxedAddress(wallet.contractId, id));
ws.forEach((w, i) => {
  assert(w.startsWith('W') && w.length === 69, `W address ${ids[i]}: ${w}`);
  const back = splitMuxed(w);
  assert(back.contractId === wallet.contractId && back.id === ids[i], 'round trip');
});

console.log('4. Three senders pay three W addresses, in parallel');
const amounts = [xlm(120), xlm(45), xlm(25)];
const paid = await Promise.all(senders.map((s, i) => tour.pay(s, ws[i], amounts[i])));
paid.forEach((p, i) => {
  assert(p.deposit.to === wallet.contractId, `event "to" is the plain C address (${txUrl(p.hash)})`);
  assert(p.deposit.muxedId === ids[i], `event to_muxed_id = ${p.deposit.muxedId}`);
  assert(p.deposit.amount === amounts[i], `amount ${formatXlm(p.deposit.amount)} XLM, fee ${p.feeCharged} stroops, ${p.envelopeBytes} B`);
});

console.log('5. One balance on chain');
const bal = await tour.balance(wallet.contractId);
assert(bal === xlm(190), `wallet balance ${formatXlm(bal)} XLM`);

console.log('6. Ramp pays an order id');
const order = 4_815_162_342n;
const orderAddress = muxedAddress(wallet.contractId, order);
const rampPay = await tour.pay(ramp, orderAddress, xlm(50));
assert(rampPay.deposit.muxedId === order, `ramp deposit matched order ${order}`);

console.log('7. The old way: a memo on a contract call');
const memo = await tour.payWithMemo(ramp, wallet.contractId, xlm(1), order);
assert(memo.code, `refused at ${memo.stage}: ${memo.code}`);

console.log('8. Guardrail: balance(W) is refused');
const refused = await tour.balanceOfMuxed(ws[0]);
assert(refused.stage === 'simulation', `refused: ${refused.code}`);

console.log('9. App view: read deposits with getEvents');
const deposits = await tour.depositsTo(wallet.contractId, startLedger);
assert(deposits.length === 4, `${deposits.length} deposits found`);
const byId = new Map<string, bigint>();
for (const d of deposits) byId.set(String(d.muxedId), (byId.get(String(d.muxedId)) ?? 0n) + d.amount);
console.log('     ', Object.fromEntries([...byId].map(([k, v]) => [k, formatXlm(v)])));

console.log('\nAll checks passed.');
