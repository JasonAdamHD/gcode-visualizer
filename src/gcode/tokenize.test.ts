/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { tokenize } from './tokenize';

const texts = (line: string) => tokenize(line).words.map((w) => w.text);
const values = (line: string) => tokenize(line).words.map((w) => [w.letter, w.value]);

describe('tokenize', () => {
  it('reads words with and without whitespace', () => {
    expect(values('G1X10Y-.5')).toEqual([
      ['G', 1],
      ['X', 10],
      ['Y', -0.5],
    ]);
    expect(values('G1 X10 Y-.5')).toEqual(values('G1X10Y-.5'));
  });

  it('is case-insensitive and allows space between a letter and its number', () => {
    expect(texts('g 01 x +5.')).toEqual(['G01', 'X+5.']);
    expect(values('g 01 x +5.')).toEqual([
      ['G', 1],
      ['X', 5],
    ]);
  });

  it('reads decimal G-codes as numbers', () => {
    expect(values('G91.1')).toEqual([['G', 91.1]]);
  });

  it('collects parenthesized and semicolon comments without reading words in them', () => {
    const line = tokenize('G0 (rapid G20 here) X1 ; the rest G21 Y2');
    expect(line.words.map((w) => w.text)).toEqual(['G0', 'X1']);
    expect(line.comments).toEqual(['rapid G20 here', ' the rest G21 Y2']);
    expect(line.error).toBeUndefined();
  });

  it('drops N line numbers and % delimiters', () => {
    expect(texts('N10 G1 X1')).toEqual(['G1', 'X1']);
    expect(tokenize('%')).toEqual({ words: [], comments: [] });
    expect(tokenize('  ')).toEqual({ words: [], comments: [] });
  });

  it('keeps CR from CRLF files out of the words', () => {
    expect(texts('G1 X1\r')).toEqual(['G1', 'X1']);
  });

  it.each([
    ['G1 (unclosed', /Unclosed comment/],
    ['G1 X', /Expected a number after X, found end of line/],
    ['G1 X-', /Expected a number after X/],
    ['G1 X.', /Expected a number after X/],
    ['G1 XY1', /Expected a number after X, found "Y"/],
    ['E5', /Unknown word letter "E"/],
    ['#1=5', /Unexpected character "#"/],
    ['X1.2.3', /Unexpected character "\."/],
  ])('reports an error for %j', (line, error) => {
    expect(tokenize(line).error).toMatch(error);
  });
});
