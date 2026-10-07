#!/usr/bin/env bun
/**
 * Stand-in for `ffplay -f s16le -i -`: records every stdin byte to
 * `<out>.pcm` and appends one line per process start to `<out>.starts`, so
 * tests can prove edits never restart the player and inspect the stream.
 */
import { appendFileSync, writeFileSync } from "node:fs";

const out = process.argv[2];
if (!out) process.exit(2);
appendFileSync(`${out}.starts`, `${process.pid}\n`);
writeFileSync(`${out}.pcm`, new Uint8Array());
for await (const chunk of Bun.stdin.stream())
  appendFileSync(`${out}.pcm`, chunk);
