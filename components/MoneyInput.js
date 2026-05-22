'use client';

import { numberInputProps } from '@/lib/utils';

// Canonical numeric / money input primitive (Commit 6 — shared primitives).
//
// Thin component built on the shared `numberInputProps` convention (lib/utils),
// so the component form and the `{...numberInputProps}` spread form share a
// single source of truth. Every other prop — value, onChange, min, max, step,
// style, id, placeholder, required, aria-label, … — passes straight through, so
// adopting <MoneyInput> in place of a raw numeric <input> is byte-identical in
// output and behaviour. The win is one place to evolve money-input behaviour
// later (e.g. thousands grouping) without touching every form again.
export default function MoneyInput(props) {
  return <input {...numberInputProps} {...props} />;
}
