/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** True when a key event is aimed at a control that uses it (typing, sliders, selects). */
export function isFormControl(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

/** True for a key event the page's shortcuts should ignore: a modifier is held or a form control has focus. */
export function ignoreShortcut(e: KeyboardEvent): boolean {
  return e.ctrlKey || e.metaKey || e.altKey || isFormControl(e.target);
}
