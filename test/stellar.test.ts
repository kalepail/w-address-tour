import { describe, expect, it } from 'vitest';
import { MAX_U64, muxedAddress, splitMuxed, strkeyParts } from '../src/lib/stellar.ts';

// Test vectors from SEP-23 ("Valid muxed contract address").
const C = 'CA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA';
const W0 = 'WA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUAAAAAAAAAAAAAWWC';
const WBIG = 'WA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVAAAAAAAAAAAACWJY';

describe('W addresses (SEP-23 vectors)', () => {
  it('encodes id 0', () => {
    expect(muxedAddress(C, 0n)).toBe(W0);
  });
  it('encodes an id above the signed 64-bit maximum', () => {
    expect(muxedAddress(C, 9223372036854775808n)).toBe(WBIG);
  });
  it('splits back into contract and id', () => {
    expect(splitMuxed(WBIG)).toEqual({ contractId: C, id: 9223372036854775808n });
  });
  it('round trips the largest id', () => {
    const w = muxedAddress(C, MAX_U64);
    expect(w).toHaveLength(69);
    expect(splitMuxed(w).id).toBe(MAX_U64);
  });
  it('refuses ids that do not fit in 64 bits', () => {
    expect(() => muxedAddress(C, MAX_U64 + 1n)).toThrow();
    expect(() => muxedAddress(C, -1n)).toThrow();
  });
  it('rejects a bad checksum', () => {
    expect(() => splitMuxed('WA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUAAAAAAAAAAAAAWWA')).toThrow();
  });
  it('exposes version byte 0xb0 and the 8-byte big-endian id', () => {
    const p = strkeyParts(muxedAddress(C, 2n));
    expect(p.version).toBe(0xb0);
    expect(Array.from(p.id)).toEqual([0, 0, 0, 0, 0, 0, 0, 2]);
    expect(p.contract).toHaveLength(32);
    expect(p.checksum).toHaveLength(2);
  });
  it('keeps the C address characters between the first and the tail', () => {
    const w = muxedAddress(C, 7n);
    expect(w.slice(1, 52)).toBe(C.slice(1, 52));
  });
});
