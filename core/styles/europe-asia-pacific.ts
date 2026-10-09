/**
 * European folk, East and Southeast Asia, Oceania (quality-08 family
 * `europe-asia-pacific`). Root and branch cards only.
 */

import { grid, intervals, maybe, role } from "./parts.ts";
import { card, type StyleCard } from "./schema.ts";

const NO_KIT = Object.freeze({ kick: null, snare: null, hat: null });

export const EUROPE_ASIA_PACIFIC_CARDS: readonly StyleCard[] = Object.freeze([
  card({
    id: "europe-folk",
    abstract: true,
    summary:
      "dance tunes and strophic song: modal diatonic tunes in 2- and 4-bar strains",
    tempo: { bpm: [90, 140], typical: 112 },
    groove: { subdivision: 2 },
    pitch: {
      scales: [
        ["major", 0.35],
        ["dorian", 0.25],
        ["mixolydian", 0.25],
        ["minor", 0.15],
      ],
    },
    harmony: {
      presets: [
        ["fifties", 0.3],
        ["mixolydian-rock", 0.3],
        ["dorian-vamp", 0.4],
      ],
      sevenths: 0,
      voicing: { types: [["open", 1]] },
    },
    melody: {
      density: [2, 4],
      repetition: 0.7,
      intervals: intervals(5, 3, 0.6, 0.6),
      phraseBars: [
        [4, 0.7],
        [2, 0.3],
      ],
    },
    bass: {
      behaviour: [
        ["root-fifth", 0.6],
        ["pedal", 0.4],
      ],
    },
    form: {
      plans: [
        [
          [
            "verse",
            "verse",
            "chorus",
            "chorus",
            "verse",
            "verse",
            "chorus",
            "chorus",
          ],
          1,
        ],
      ],
      archetype: "AABB",
    },
    texture: {
      kind: "heterophonic",
      roles: {
        ...NO_KIT,
        bass: maybe("cello"),
        chords: role("acoustic", "lute:0.4", "harp:0.4"),
        lead: role("fiddle", "whistle:0.6", "flute:0.4"),
        perc: maybe("bodhran", "framedrum:0.5"),
      },
    },
    rhythm: { onsets: { perc: grid("x..x..x.") } },
  }),
  card({
    id: "celtic-british",
    abstract: true,
    summary:
      "jigs, reels and airs: 6/8 and 4/4, dorian and mixolydian, drone pipes",
    meter: {
      signatures: [
        ["6/8", 0.4],
        ["4/4", 0.4],
        ["9/8", 0.2],
      ],
    },
  }),
  card({
    id: "nordic-baltic",
    abstract: true,
    summary: "polska and runo song: 3/4 asymmetric lilt, minor and dorian",
    meter: {
      signatures: [
        ["3/4", 0.7],
        ["4/4", 0.3],
      ],
    },
    pitch: {
      scales: [
        ["minor", 0.5],
        ["dorian", 0.5],
      ],
    },
  }),
  card({
    id: "west-europe",
    abstract: true,
    summary:
      "chanson, musette and alpine: waltz and march, major-minor tonality",
    meter: {
      signatures: [
        ["3/4", 0.5],
        ["4/4", 0.5],
      ],
    },
    harmony: {
      presets: [
        ["fifties", 0.5],
        ["andalusian", 0.5],
      ],
    },
  }),
  card({
    id: "iberia",
    abstract: true,
    summary:
      "flamenco and fado: phrygian-dominant and andalusian cadence, 12-beat compas",
    pitch: {
      scales: [
        ["phrygian-dominant", 0.5],
        ["harmonic-minor", 0.3],
        ["minor", 0.2],
      ],
    },
    harmony: { presets: [["andalusian", 1]] },
    texture: {
      roles: { chords: role("nylon"), lead: role("nylon", "sing:0.6") },
    },
  }),
  card({
    id: "central-east-europe",
    abstract: true,
    summary:
      "polka, czardas and klezmer neighbours: 2/4 oom-pah, harmonic minor turns",
    meter: {
      signatures: [
        ["2/4", 0.5],
        ["4/4", 0.5],
      ],
    },
    pitch: {
      scales: [
        ["harmonic-minor", 0.4],
        ["major", 0.4],
        ["minor", 0.2],
      ],
    },
  }),
  card({
    id: "balkans-mediterranean",
    abstract: true,
    summary: "aksak meters 7/8, 9/8, 11/8 in 2s and 3s, makam-tinged modes",
    meter: {
      signatures: [
        ["7/8", 0.4],
        ["9/8", 0.3],
        ["11/8", 0.3],
      ],
      grouping: [
        [[3, 2, 2], 0.5],
        [[2, 2, 2, 3], 0.5],
      ],
    },
    pitch: {
      scales: [
        ["phrygian-dominant", 0.4],
        ["minor", 0.3],
        ["hijaz", 0.3],
      ],
    },
    harmony: { model: "modal" },
  }),
  card({
    id: "east-asia",
    abstract: true,
    summary:
      "anhemitonic pentatonic melody, heterophony, ornament over sustained tones, little harmony",
    tempo: { bpm: [56, 110], typical: 76 },
    pitch: {
      scales: [
        ["major-pentatonic", 0.6],
        ["minor-pentatonic", 0.4],
      ],
    },
    harmony: { model: "drone", rhythm: [[0.5, 1]] },
    melody: {
      intervals: intervals(3, 4, 0.8, 0.6),
      chordToneRate: 0.4,
      density: [1, 2],
    },
    bass: {
      behaviour: [
        ["none", 0.6],
        ["pedal", 0.4],
      ],
    },
    texture: {
      kind: "heterophonic",
      roles: {
        ...NO_KIT,
        chords: null,
        drone: maybe("koto", "strings:0.5"),
        lead: role("erhu", "shakuhachi:0.6", "koto:0.5", "flute:0.4"),
      },
    },
    mix: { space: 0.5 },
  }),
  card({
    id: "china",
    abstract: true,
    summary: "gong-shang-jiao-zhi-yu pentatonic, erhu and dizi heterophony",
    texture: { roles: { lead: role("erhu", "flute:0.6") } },
  }),
  card({
    id: "japan",
    abstract: true,
    summary: "in and yo scales, ma silence, koto and shakuhachi",
    pitch: {
      scales: [
        ["major-pentatonic", 0.4],
        ["phrygian", 0.6],
      ],
    },
    melody: { density: [0, 2] },
    texture: { roles: { lead: role("shakuhachi", "koto:0.6") } },
  }),
  card({
    id: "korea",
    abstract: true,
    summary:
      "jangdan cycles in compound triple time, pyeongjo and gyemyeonjo modes",
    meter: {
      signatures: [
        ["12/8", 0.6],
        ["9/8", 0.4],
      ],
    },
  }),
  card({
    id: "central-north-asia",
    abstract: true,
    summary: "steppe song: overtone drone, galloping 6/8, pentatonic long song",
    meter: {
      signatures: [
        ["6/8", 0.6],
        ["4/4", 0.4],
      ],
    },
    texture: {
      roles: {
        drone: role("khoomei", "strings:0.4"),
        lead: role("fiddle", "sing:0.5"),
      },
    },
  }),
  card({
    id: "southeast-asia",
    abstract: true,
    summary:
      "gong-chime colotomy: slendro or pelog tuning, nested cycles, interlocking elaboration",
    tempo: { bpm: [60, 120], typical: 84 },
    pitch: { tuning: "slendro", scales: [["major-pentatonic", 1]] },
    harmony: { model: "drone", rhythm: [[0.25, 1]] },
    melody: {
      chordToneRate: 0.3,
      density: [2, 4],
      repetition: 0.8,
      intervals: intervals(5, 2, 0.5, 0.5),
    },
    bass: { behaviour: [["pedal", 1]] },
    texture: {
      kind: "interlocking",
      roles: {
        ...NO_KIT,
        chords: null,
        bass: role("gong", "kempul:0.6"),
        lead: role("saron", "gangsa:0.6", "bonang:0.4"),
        counter: maybe("gender", "bonang:0.5"),
      },
    },
    mix: { space: 0.45 },
  }),
  card({
    id: "oceania",
    abstract: true,
    summary:
      "Pacific song: I-IV-V slack-key and choral harmony, island reggae lilt",
    tempo: { bpm: [70, 120], typical: 92 },
    pitch: { scales: [["major", 1]] },
    harmony: {
      presets: [
        ["fifties", 0.5],
        ["axis", 0.5],
      ],
    },
    texture: {
      roles: {
        ...NO_KIT,
        chords: role("steel", "nylon:0.5"),
        lead: role("sing", "steelpan:0.3"),
      },
    },
  }),
]);
