/**
 * ============================================================================
 *  FIELDS — renders one schema property as a form control.
 * ============================================================================
 *
 *  Used by BOTH the creation dialog and the inspector, which is what guarantees
 *  the spec's requirement that properties are "input during construction" and
 *  the requirement that they are "shown on a right panel" never drift apart:
 *  there is one renderer and one schema behind both.
 */

import { FIELD } from '../model/schema.js';
import { el } from './dom.js';

/**
 * @param {object} prop        one entry from a type's `props` array
 * @param {*} value            current value (undefined for a new element)
 * @param {{onEnter?:Function, onChange?:Function}} [handlers]
 * @returns {{row: HTMLElement, input: HTMLElement, key: string, read: () => string}}
 */
export function renderField(prop, value, handlers = {}) {
  const id = `f-${prop.key}-${Math.random().toString(36).slice(2, 8)}`;
  let input;

  if (prop.type === FIELD.SELECT) {
    input = el('select', { id, class: 'field-input' },
      (prop.options || []).map((o) => el('option', {
        value: o,
        text: o === '' ? '—' : o,
        selected: String(value ?? '') === String(o),
      })));
  } else if (prop.type === FIELD.TEXTAREA) {
    input = el('textarea', { id, class: 'field-input', rows: 3, value: value ?? '' });
  } else {
    input = el('input', {
      id,
      class: 'field-input',
      type: prop.type === FIELD.NUMBER ? 'number' : prop.type === FIELD.DATE ? 'date' : 'text',
      value: value ?? '',
      placeholder: prop.placeholder || '',
    });
    if (prop.type === FIELD.NUMBER) {
      if (prop.min !== undefined) input.min = String(prop.min);
      if (prop.step !== undefined) input.step = String(prop.step);
    }
  }

  if (handlers.onChange) input.addEventListener('change', handlers.onChange);
  if (handlers.onEnter && prop.type !== FIELD.TEXTAREA) {
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') handlers.onEnter(e); });
  }

  const row = el('label', { class: 'field', attrs: { for: id } }, [
    el('span', { class: 'field-label' }, [
      prop.label,
      prop.required ? el('span', { class: 'req', text: '*', attrs: { title: 'required' } }) : null,
      prop.unit ? el('span', { class: 'unit', text: prop.unit }) : null,
    ]),
    input,
    prop.help ? el('span', { class: 'field-help', text: prop.help }) : null,
    el('span', { class: 'field-error', dataset: { for: prop.key } }),
  ]);

  return { row, input, key: prop.key, read: () => input.value };
}

/** Render a whole `props` array; returns the rows plus a `values()` reader. */
export function renderForm(def, data = {}, handlers = {}) {
  const fields = def.props.map((p) => renderField(p, data[p.key], handlers));
  return {
    rows: fields.map((f) => f.row),
    fields,
    values: () => Object.fromEntries(fields.map((f) => [f.key, f.read()])),
    focusFirst: () => fields[0] && fields[0].input.focus(),
    /** Paint per-field messages coming back from validateProps(). */
    showErrors: (errors = {}) => {
      for (const f of fields) {
        const slot = f.row.querySelector('.field-error');
        const msg = errors[f.key];
        slot.textContent = msg || '';
        f.row.classList.toggle('has-error', Boolean(msg));
      }
      const first = fields.find((f) => errors[f.key]);
      if (first) first.input.focus();
    },
  };
}
