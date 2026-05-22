// @vitest-environment jsdom
//
// Safety-net for the MoneyInput primitive + the shared numberInputProps
// convention it is built on (Commit 6). Pins the contract that adoption relies
// on: type="number" + inputMode="decimal" are always applied, and every other
// prop passes straight through unchanged.
import './_setup-ui.js';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MoneyInput from '../../components/MoneyInput.js';
import { numberInputProps } from '../../lib/utils.js';

describe('numberInputProps', () => {
  it('is the canonical numeric-keyboard convention', () => {
    expect(numberInputProps).toEqual({ type: 'number', inputMode: 'decimal' });
  });
});

describe('MoneyInput', () => {
  it('always renders a number input with the decimal keypad', () => {
    render(<MoneyInput aria-label="amount" />);
    const input = screen.getByLabelText('amount');
    expect(input).toHaveAttribute('type', 'number');
    expect(input).toHaveAttribute('inputmode', 'decimal');
  });

  it('passes through value/min/step/placeholder and fires onChange', () => {
    const onChange = vi.fn();
    render(<MoneyInput aria-label="amt" value="5" min="0" step="any" placeholder="0.00" onChange={onChange} />);
    const input = screen.getByLabelText('amt');
    expect(input).toHaveValue(5);
    expect(input).toHaveAttribute('min', '0');
    expect(input).toHaveAttribute('step', 'any');
    expect(input).toHaveAttribute('placeholder', '0.00');
    fireEvent.change(input, { target: { value: '12' } });
    expect(onChange).toHaveBeenCalled();
  });
});
