import type { Keypair } from '@stellar/stellar-sdk';
import type { Deposit, PaymentReport, RefusedReport, StellarTour } from './lib/stellar.ts';

export interface Activity {
  label: string;
  hash: string;
  ok: boolean;
}

/** A sub-account: a label the app keeps, plus a W address that carries its id. */
export interface SubAccount {
  id: bigint;
  name: string;
  /** Who pays into it in the tour. */
  payer: string;
  /** What the payment is for. */
  memoText: string;
  amount: bigint;
  /** Index into the sub-account colors. */
  tone: number;
  address?: string;
}

export interface State {
  tour?: StellarTour;
  owner?: Keypair;
  senders?: Keypair[];
  ramp?: Keypair;
  wasmHash?: string;
  wasmUploaded?: boolean;
  walletId?: string;
  deployLedger?: number;
  subAccounts: SubAccount[];
  payments: PaymentReport[];
  /** On-chain XLM balance of the wallet, in stroops. */
  balance?: bigint;
  /** Deposits rebuilt from network events. */
  deposits?: Deposit[];
  memoRefused?: RefusedReport;
  rampSubAccount?: SubAccount;
  rampPayment?: PaymentReport;
  balanceRefused?: RefusedReport;
  activity: Activity[];
}

export type TaskStatus = 'pending' | 'running' | 'done' | 'error';

export interface Task {
  label: string;
  status: TaskStatus;
  meta?: string;
}

export interface StepContext {
  state: State;
  tasks: Task[];
  done: boolean;
  error?: string;
}

/** Runs task `i`. The function may return a short note shown beside it. */
export type TaskRunner = (i: number, fn: () => Promise<string | void>) => Promise<void>;

export interface Step {
  id: string;
  /** Short name for the progress label. */
  short: string;
  /** Primary button text: what happens when you press it. */
  next: string;
  tasks?: string[];
  run?: (state: State, task: TaskRunner) => Promise<void>;
  view: (ctx: StepContext) => string;
}
