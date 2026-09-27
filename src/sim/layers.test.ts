/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYERS, kindLayer, parseLayers } from './layers';

describe('parseLayers', () => {
  it('defaults everything on with nothing stored or unreadable JSON', () => {
    expect(parseLayers(null)).toEqual(DEFAULT_LAYERS);
    expect(parseLayers('not json')).toEqual(DEFAULT_LAYERS);
    expect(parseLayers('null')).toEqual(DEFAULT_LAYERS);
    expect(parseLayers('[false]')).toEqual(DEFAULT_LAYERS);
  });

  it('keeps stored booleans and ignores unknown or mistyped fields', () => {
    const layers = parseLayers(JSON.stringify({ rapid: false, stock: 'no', extra: false, axes: false }));
    expect(layers).toEqual({ ...DEFAULT_LAYERS, rapid: false, axes: false });
  });

  it('round-trips through JSON', () => {
    const layers = { ...DEFAULT_LAYERS, stock: false, untraversed: false };
    expect(parseLayers(JSON.stringify(layers))).toEqual(layers);
  });
});

describe('kindLayer', () => {
  it('maps move kinds to their layer', () => {
    expect(kindLayer('feed')).toBe('cut');
    expect(kindLayer('rapid')).toBe('rapid');
    expect(kindLayer('plunge')).toBe('vertical');
    expect(kindLayer('retract')).toBe('vertical');
  });
});
