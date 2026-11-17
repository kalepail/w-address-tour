// Testnet flow for the tour. It runs the same way in the browser and in Node
// (scripts/e2e-testnet.ts), so the end-to-end test proves what the page does.
import {
  Address,
  Asset,
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  hash,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
  Transaction,
} from '@stellar/stellar-sdk';

export const TESTNET = {
  rpcUrl: 'https://soroban-testnet.stellar.org',
  friendbotUrl: 'https://friendbot.stellar.org',
  passphrase: Networks.TESTNET,
  explorer: 'https://stellar.expert/explorer/testnet',
} as const;

export const XLM_SAC = Asset.native().contractId(TESTNET.passphrase);
export const STROOPS_PER_XLM = 10_000_000n;
export const MAX_U64 = (1n << 64n) - 1n;

export const txUrl = (h: string) => `${TESTNET.explorer}/tx/${h}`;
export const contractUrl = (id: string) => `${TESTNET.explorer}/contract/${id}`;
export const accountUrl = (id: string) => `${TESTNET.explorer}/account/${id}`;

export interface TxReport {
  hash: string;
  ledger: number;
  /** Total fee paid, in stroops. */
  feeCharged: bigint;
  /** Size of the signed transaction envelope, in bytes. */
  envelopeBytes: number;
}

/** One SAC `transfer` event, decoded. */
export interface Deposit {
  hash: string;
  ledger: number;
  from: string;
  /** The plain address in the event topic. For a W payment, this is the C address. */
  to: string;
  amount: bigint;
  /** The muxed id from `to_muxed_id`, if the payment went to a W (or M) address. */
  muxedId?: bigint;
}

export interface PaymentReport extends TxReport {
  deposit: Deposit;
}

export interface RefusedReport {
  /** Where the refusal happened. */
  stage: 'send' | 'ledger' | 'simulation';
  /** A short machine code, such as `txMalformed`. */
  code: string;
  hash?: string;
}

export class TourError extends Error {
  readonly detail?: unknown;
  constructor(message: string, detail?: unknown) {
    super(message);
    this.detail = detail;
    this.name = 'TourError';
  }
}

// ------------------------------------------------------------- W addresses

/** Builds the W strkey for a contract and a 64-bit muxed id (CAP-84, SEP-23). */
export function muxedAddress(contractId: string, id: bigint): string {
  if (id < 0n || id > MAX_U64) throw new TourError('A muxed id must fit in 64 bits');
  const raw = new Uint8Array(40);
  raw.set(StrKey.decodeContract(contractId), 0);
  new DataView(raw.buffer).setBigUint64(32, id, false);
  return StrKey.encodeMuxedContract(raw);
}

/** Splits a W strkey back into its contract and muxed id. */
export function splitMuxed(w: string): { contractId: string; id: bigint } {
  const raw = StrKey.decodeMuxedContract(w);
  return {
    contractId: StrKey.encodeContract(raw.slice(0, 32)),
    id: new DataView(raw.buffer, raw.byteOffset).getBigUint64(32, false),
  };
}

/** The raw bytes inside a strkey: version byte, payload, and CRC16 checksum. */
export function strkeyParts(w: string): { version: number; contract: Uint8Array; id: Uint8Array; checksum: Uint8Array } {
  const all = base32Decode(w);
  return { version: all[0], contract: all.slice(1, 33), id: all.slice(33, 41), checksum: all.slice(41, 43) };
}

function base32Decode(s: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of s) {
    const v = alphabet.indexOf(ch);
    if (v < 0) throw new TourError(`Not a base32 character: ${ch}`);
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

// -------------------------------------------------------------------- tour

export class StellarTour {
  readonly server: rpc.Server;
  readonly feePayer: Keypair;

  constructor(feePayer: Keypair = Keypair.random(), rpcUrl: string = TESTNET.rpcUrl) {
    this.server = new rpc.Server(rpcUrl);
    this.feePayer = feePayer;
  }

  /** Asks friendbot for 10,000 test XLM. */
  async fund(address: string): Promise<string> {
    const res = await this.server.fundAddress(address, TESTNET.friendbotUrl);
    return res.txHash;
  }

  /** Uploads the wasm if testnet does not have it yet. */
  async ensureWasm(wasm: Uint8Array): Promise<{ wasmHash: string; uploadTx?: TxReport }> {
    const wasmHash = toHex(hash(wasm as Buffer));
    try {
      await this.server.getContractWasmByHash(wasmHash, 'hex');
      return { wasmHash };
    } catch {
      const uploadTx = (await this.submit(this.feePayer, Operation.uploadContractWasm({ wasm }))).report;
      return { wasmHash, uploadTx };
    }
  }

  /** Deploys one wallet contract and passes the owner's Ed25519 key to its constructor. */
  async deployWallet(wasmHash: string, ownerPublicKey: Uint8Array): Promise<TxReport & { contractId: string }> {
    const op = Operation.createCustomContract({
      address: Address.fromString(this.feePayer.publicKey()),
      wasmHash: hexToBytes(wasmHash),
      salt: crypto.getRandomValues(new Uint8Array(32)),
      constructorArgs: [xdr.ScVal.scvBytes(ownerPublicKey)],
    });
    const { report, returnValue } = await this.submit(this.feePayer, op);
    if (!returnValue) throw new TourError('Deploy returned no contract address');
    return { ...report, contractId: Address.fromScVal(returnValue).toString() };
  }

  /** Reads an XLM balance (in stroops) through the native asset contract. */
  async balance(address: string): Promise<bigint> {
    const sim = await this.server.simulateTransaction(await this.build(this.feePayer.publicKey(), balanceOp(address)));
    if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) throw new TourError('Balance read failed', sim);
    return BigInt(scValToNative(sim.result.retval));
  }

  /**
   * Sends XLM from a G account to any address: G, C, M, or W. The sender's
   * own key signs the envelope, so the auth entry uses source-account credentials.
   */
  async pay(sender: Keypair, to: string, stroops: bigint): Promise<PaymentReport> {
    const { report, events } = await this.submit(sender, transferOp(sender.publicKey(), to, stroops));
    const deposit = events.map((e) => decodeTransfer(e, report.hash, report.ledger)).find(Boolean);
    if (!deposit) throw new TourError('The payment emitted no transfer event');
    return { ...report, deposit };
  }

  /**
   * The old way to tag a payment: a memo on the transaction. The network does
   * not allow a memo on a transaction that calls a contract, so this must fail.
   */
  async payWithMemo(sender: Keypair, to: string, stroops: bigint, memoId: bigint): Promise<RefusedReport> {
    const op = transferOp(sender.publicKey(), to, stroops);
    const plain = await this.build(sender.publicKey(), op);
    const sim = await this.server.simulateTransaction(plain);
    if (!rpc.Api.isSimulationSuccess(sim)) throw new TourError(simError('Simulation failed', sim), sim);
    // Same transaction, same resources, plus a memo. The SDK refuses to build
    // this, so the memo goes into the envelope XDR directly. The network then
    // makes its own decision.
    const assembled = rpc.assembleTransaction(plain, sim).build();
    const wire = assembled.toEnvelope().toXdrObject() as { v1: { tx: { memo: unknown } } };
    wire.v1.tx.memo = { type: 2, id: memoId };
    const tx = new Transaction(xdr.TransactionEnvelope.fromXdrObject(wire as never), TESTNET.passphrase);
    tx.sign(sender);
    const sent = await this.server.sendTransaction(tx);
    if (sent.status === 'ERROR') {
      const code = sent.errorResult?.result.type ?? 'error';
      return { stage: 'send', code, hash: sent.hash };
    }
    const res = await this.server.pollTransaction(sent.hash, { attempts: 40 });
    if (res.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      throw new TourError('Unexpected: the network accepted a memo on a contract call', res);
    }
    return { stage: 'ledger', code: String(res.status), hash: sent.hash };
  }

  /**
   * Asks the network to read the balance "of a W address". `balance` takes a
   * plain Address, so the host refuses the muxed value.
   */
  async balanceOfMuxed(w: string): Promise<RefusedReport> {
    const sim = await this.server.simulateTransaction(await this.build(this.feePayer.publicKey(), balanceOp(w)));
    if (rpc.Api.isSimulationSuccess(sim)) throw new TourError('Unexpected: the network read a balance for a W address', sim);
    const msg = rpc.Api.isSimulationError(sim) ? sim.error : 'restore needed';
    const code = /UnexpectedType/i.test(msg) ? 'Error(Value, UnexpectedType)' : (msg.match(/Error\([^)]*\)/)?.[0] ?? 'host error');
    return { stage: 'simulation', code };
  }

  /** Every XLM transfer into one contract since a ledger. This is how a wallet app finds deposits for each W address. */
  async depositsTo(contractId: string, startLedger: number): Promise<Deposit[]> {
    const res = await this.server.getEvents({
      startLedger,
      filters: [
        {
          type: 'contract',
          contractIds: [XLM_SAC],
          topics: [[xdr.ScVal.scvSymbol('transfer').toXDR('base64'), '*', Address.fromString(contractId).toScVal().toXDR('base64'), '*']],
        },
      ],
      limit: 100,
    });
    return res.events
      .map((e) => decodeTransfer(e.topic, e.value, e.txHash, e.ledger))
      .filter((d): d is Deposit => Boolean(d));
  }

  // ---------------------------------------------------------------- internals

  private async build(source: string, op: xdr.Operation): Promise<Transaction> {
    const account = await this.server.getAccount(source);
    return new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: TESTNET.passphrase })
      .addOperation(op)
      .setTimeout(120)
      .build();
  }

  private async submit(signer: Keypair, op: xdr.Operation) {
    const raw = await this.build(signer.publicKey(), op);
    const sim = await this.server.simulateTransaction(raw);
    if (!rpc.Api.isSimulationSuccess(sim)) throw new TourError(simError('Simulation failed', sim), sim);
    const tx = rpc.assembleTransaction(raw, sim).build();
    tx.sign(signer);
    const sent = await this.server.sendTransaction(tx);
    if (sent.status === 'ERROR' || sent.status === 'TRY_AGAIN_LATER') {
      throw new TourError(`Send failed: ${sent.status}`, sent);
    }
    const res = await this.server.pollTransaction(sent.hash, { attempts: 40 });
    if (res.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
      throw new TourError(`Transaction ${res.status}: ${sent.hash}`, res);
    }
    const report: TxReport = {
      hash: sent.hash,
      ledger: res.ledger,
      feeCharged: BigInt(res.resultXdr.feeCharged),
      envelopeBytes: tx.toEnvelope().toXDR().length,
    };
    const events = (res.events?.contractEventsXdr ?? []).flat();
    return { report, returnValue: res.returnValue, events };
  }
}

// ------------------------------------------------------------------ helpers

function transferOp(from: string, to: string, stroops: bigint): xdr.Operation {
  return Operation.invokeContractFunction({
    contract: XLM_SAC,
    function: 'transfer',
    args: [Address.fromString(from).toScVal(), Address.fromString(to).toScVal(), nativeToScVal(stroops, { type: 'i128' })],
  });
}

function balanceOp(address: string): xdr.Operation {
  return Operation.invokeContractFunction({ contract: XLM_SAC, function: 'balance', args: [Address.fromString(address).toScVal()] });
}

/** Decodes a SAC transfer event from an XDR event, or from topic/value lists. */
function decodeTransfer(event: xdr.ContractEvent, hash: string, ledger: number): Deposit | undefined;
function decodeTransfer(topics: xdr.ScVal[], value: xdr.ScVal, hash: string, ledger: number): Deposit | undefined;
function decodeTransfer(a: xdr.ContractEvent | xdr.ScVal[], b: xdr.ScVal | string, c: string | number, d?: number): Deposit | undefined {
  let topics: xdr.ScVal[];
  let value: xdr.ScVal;
  let hash: string;
  let ledger: number;
  if (Array.isArray(a)) {
    [topics, value, hash, ledger] = [a, b as xdr.ScVal, c as string, d as number];
  } else {
    const body = a.body.v0;
    [topics, value, hash, ledger] = [body.topics, body.data, b as string, c as number];
  }
  const t = topics.map((x) => scValToNative(x));
  if (t[0] !== 'transfer' || t.length < 3) return undefined;
  const data = scValToNative(value);
  const isMap = typeof data === 'object' && data !== null && !(typeof data === 'bigint');
  return {
    hash,
    ledger,
    from: String(t[1]),
    to: String(t[2]),
    amount: BigInt(isMap ? data.amount : data),
    muxedId: isMap && data.to_muxed_id !== undefined ? BigInt(data.to_muxed_id) : undefined,
  };
}

function simError(prefix: string, sim: rpc.Api.SimulateTransactionResponse): string {
  return rpc.Api.isSimulationError(sim) ? `${prefix}: ${sim.error}` : prefix;
}

export function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function formatXlm(stroops: bigint, digits = 7): string {
  const neg = stroops < 0n;
  const abs = neg ? -stroops : stroops;
  const whole = abs / STROOPS_PER_XLM;
  const frac = (abs % STROOPS_PER_XLM).toString().padStart(7, '0').slice(0, digits).replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole.toLocaleString('en-US')}${frac ? '.' + frac : ''}`;
}
