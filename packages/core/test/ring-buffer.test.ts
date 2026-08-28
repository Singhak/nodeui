import { describe, expect, it } from 'vitest';
import { RingBuffer } from '../src/ring-buffer';

describe('RingBuffer', () => {
  it('pushes and reports length', () => {
    const buf = new RingBuffer<number>(3);
    expect(buf.length).toBe(0);
    buf.push(1);
    buf.push(2);
    expect(buf.length).toBe(2);
    expect(buf.toArray()).toEqual([1, 2]);
  });

  it('drops the oldest item when full', () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    buf.push(4);
    expect(buf.length).toBe(3);
    expect(buf.toArray()).toEqual([2, 3, 4]);
  });

  it('keeps wrapping once capacity is exceeded multiple times', () => {
    const buf = new RingBuffer<number>(3);
    for (let i = 1; i <= 7; i += 1) buf.push(i);
    expect(buf.toArray()).toEqual([5, 6, 7]);
  });

  it('supports pagination via slice', () => {
    const buf = new RingBuffer<string>(10);
    for (let i = 0; i < 10; i += 1) buf.push(`r${i}`);
    expect(buf.slice(0, 3)).toEqual(['r0', 'r1', 'r2']);
    expect(buf.slice(7)).toEqual(['r7', 'r8', 'r9']);
    expect(buf.slice(0, 0)).toEqual([]);
    expect(buf.slice(100)).toEqual([]);
  });

  it('slice without limit returns everything', () => {
    const buf = new RingBuffer<number>(4);
    buf.push(1);
    buf.push(2);
    expect(buf.slice(0)).toEqual([1, 2]);
  });

  it('rejects non-positive sizes', () => {
    expect(() => new RingBuffer<number>(0)).toThrow();
    expect(() => new RingBuffer<number>(-1)).toThrow();
    expect(() => new RingBuffer<number>(2.5)).toThrow();
  });
});
