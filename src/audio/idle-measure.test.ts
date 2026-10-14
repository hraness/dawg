import { expect, test } from "bun:test";
import { IdleMeasurement } from "./idle-measure.ts";

const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

test("optional measurement waits for idle and reuses one matching result", async () => {
  const meter = new IdleMeasurement<string, number>(0);
  let calls = 0;
  const work = async () => ++calls;
  try {
    meter.read("a", false, work);
    await turn();
    expect(calls).toBe(0);
    meter.read("a", true, work);
    meter.read("a", true, work);
    await turn();
    expect(meter.read("a", true, work)).toBe(1);
    expect(calls).toBe(1);
    meter.read("b", true, work);
    await turn();
    expect(meter.read("b", true, work)).toBe(2);
  } finally {
    meter.dispose();
  }
});

test("input preempts a timer and aborts running work without accepting late results", async () => {
  const meter = new IdleMeasurement<string, number>(0);
  let signal: AbortSignal | undefined;
  let done: ((value: number) => void) | undefined;
  const work = (value: AbortSignal) => {
    signal = value;
    return new Promise<number>((resolve) => {
      done = resolve;
    });
  };
  meter.read("a", true, work);
  meter.pause();
  await turn();
  expect(signal).toBeUndefined();
  meter.read("a", true, work);
  await turn();
  meter.read("a", false, work);
  expect(signal?.aborted).toBe(true);
  done!(99);
  await turn();
  expect(meter.read("a", false, work)).toBeUndefined();
  meter.dispose();
});

test("replacement and shutdown abort work; failures never spin on every frame", async () => {
  const meter = new IdleMeasurement<string, number>(0);
  let calls = 0;
  let signal: AbortSignal | undefined;
  meter.read("a", true, async (value) => {
    signal = value;
    return new Promise<number>(() => {});
  });
  await turn();
  meter.read("b", true, async () => {
    calls++;
    throw new Error("unavailable");
  });
  expect(signal?.aborted).toBe(true);
  await turn();
  meter.read("b", true, async () => ++calls);
  await turn();
  expect(calls).toBe(1);
  meter.read("c", true, async (value) => {
    signal = value;
    return new Promise<number>(() => {});
  });
  await turn();
  meter.dispose();
  expect(signal?.aborted).toBe(true);
  meter.read("d", true, async () => ++calls);
  await turn();
  expect(calls).toBe(1);
});
