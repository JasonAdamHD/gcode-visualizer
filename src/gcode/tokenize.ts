/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Splits one line of G-code into words and comments, knowing nothing about
// what the words mean. Kept separate from the interpreter in parse.ts so a
// controller dialect layer can later sit between the two.

/** One G-code word: an uppercase `letter` and its number. `text` is the word as normalized for messages (`G01`, `X-.5`). */
export type Word = { letter: string; value: number; text: string };

/** A tokenized line. With `error` set the line is malformed and must be skipped; `words` then holds what was read before the error. */
export type TokenizedLine = { words: Word[]; comments: string[]; error?: string };

/** Word letters the interpreter knows about (RS274/NGC). Others (E, O, U, V, W) are syntax errors. */
const LETTERS = 'ABCDFGHIJKLMNPQRSTXYZ';

const isSpace = (c: number) => c === 32 || c === 9 || c === 13;
const isDigit = (c: number) => c >= 48 && c <= 57;

/**
 * Tokenizes one line of G-code. Case-insensitive, whitespace between words
 * and between a letter and its number is optional (`G1X10Y-.5`). `( … )`
 * and `;` comments are collected; `N` line numbers and `%` program
 * delimiters are accepted and dropped. A malformed number, an unknown
 * letter, a stray character or an unclosed `(` sets `error`.
 */
export function tokenize(line: string): TokenizedLine {
  const words: Word[] = [];
  const comments: string[] = [];
  const n = line.length;
  let i = 0;
  while (i < n) {
    const c = line.charCodeAt(i);
    if (isSpace(c) || c === 37 /* % */) {
      i++;
      continue;
    }
    if (c === 40 /* ( */) {
      const end = line.indexOf(')', i + 1);
      if (end < 0) return { words, comments, error: 'Unclosed comment: "(" without ")"' };
      comments.push(line.slice(i + 1, end));
      i = end + 1;
      continue;
    }
    if (c === 59 /* ; */) {
      comments.push(line.slice(i + 1));
      break;
    }

    const letter = line[i].toUpperCase();
    if (letter < 'A' || letter > 'Z' || letter.length !== 1) {
      return { words, comments, error: `Unexpected character "${line[i]}"` };
    }
    if (!LETTERS.includes(letter)) return { words, comments, error: `Unknown word letter "${line[i]}"` };
    i++;
    while (i < n && isSpace(line.charCodeAt(i))) i++;

    // Number: optional sign, digits, optional point and digits; at least one digit.
    const start = i;
    if (i < n && (line[i] === '+' || line[i] === '-')) i++;
    const intStart = i;
    while (i < n && isDigit(line.charCodeAt(i))) i++;
    let digits = i - intStart;
    if (i < n && line[i] === '.') {
      const fracStart = ++i;
      while (i < n && isDigit(line.charCodeAt(i))) i++;
      digits += i - fracStart;
    }
    if (digits === 0) {
      const found = start < n ? `"${line.slice(start, Math.max(i, start + 1))}"` : 'end of line';
      return { words, comments, error: `Expected a number after ${letter}, found ${found}` };
    }
    const number = line.slice(start, i);
    if (letter !== 'N') words.push({ letter, value: Number(number), text: letter + number });
  }
  return { words, comments };
}
