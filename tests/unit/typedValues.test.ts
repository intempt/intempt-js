import { afterEach, describe, expect, it } from 'vitest';
import { HtmlElementDataComponent } from '../../src/intemptJs/component/HtmlEventData.component.ts';
import { IntemptDomEventName } from '../../src/intemptJs/types/constants.types.ts';

const CLICK = IntemptDomEventName.CLICK;
const SUBMIT = IntemptDomEventName.SUBMIT;
const CHANGE = IntemptDomEventName.CHANGE;
const REDACTED = '********';

function mount(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host.firstElementChild as HTMLElement;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('typed values are never captured', () => {
  it.each(['text', 'email', 'tel', 'search', 'url', 'number', 'date'])(
    'redacts a %s input on change',
    (type) => {
      const input = mount(`<input type="${type}" />`);
      (input as HTMLInputElement).value =
        type === 'date' ? '1990-01-31' : type === 'number' ? '42' : 'typed';
      const captured = new HtmlElementDataComponent(input, CHANGE);
      expect(captured.targetText).toBe(REDACTED);
    },
  );

  it('redacts an input with no type, which the browser treats as text', () => {
    const input = mount('<input />');
    (input as HTMLInputElement).value = 'ada@example.com';
    const captured = new HtmlElementDataComponent(input, CHANGE);
    expect(captured.targetText).toBe(REDACTED);
    expect(JSON.stringify(captured)).not.toContain('ada@example.com');
  });

  it('redacts a textarea', () => {
    const area = mount('<textarea>draft message</textarea>');
    (area as HTMLTextAreaElement).value = 'my private message';
    const captured = new HtmlElementDataComponent(area, CHANGE);
    expect(captured.targetText).toBe(REDACTED);
    expect(JSON.stringify(captured)).not.toContain('my private message');
    expect(JSON.stringify(captured)).not.toContain('draft message');
  });

  it('redacts a contenteditable element on click', () => {
    const editor = mount('<div contenteditable="true">my private note</div>');
    const captured = new HtmlElementDataComponent(editor, CLICK);
    expect(captured.targetText).toBe(REDACTED);
    expect(JSON.stringify(captured)).not.toContain('my private note');
  });

  it('redacts a pre-filled value attribute in the hierarchy', () => {
    const input = mount(
      '<input type="email" name="email" value="prefilled@example.com" />',
    );
    const captured = new HtmlElementDataComponent(input, CHANGE);
    expect(captured.hierarchy).toContain(`value='${REDACTED}'`);
    expect(captured.hierarchy).toContain("[name='email']");
    expect(JSON.stringify(captured)).not.toContain('prefilled@example.com');
  });

  it('redacts every typed field on submit and keeps the field names', () => {
    const form = mount(
      '<form action="/signup">' +
        '<input name="email" type="email" value="ada@example.com" />' +
        '<textarea name="note">call me</textarea>' +
        '<input value="unnamed typed" />' +
        '</form>',
    );
    const captured = new HtmlElementDataComponent(form, SUBMIT);
    expect(captured.formDataText).toEqual([
      { key: 'email', value: REDACTED },
      { key: 'note', value: REDACTED },
      { key: 'input-0', value: REDACTED },
    ]);
    const serialised = JSON.stringify(captured);
    expect(serialised).not.toContain('ada@example.com');
    expect(serialised).not.toContain('call me');
    expect(serialised).not.toContain('unnamed typed');
  });
});

describe('choices and labels are still captured', () => {
  it('keeps a select value on submit', () => {
    const form = mount(
      '<form action="/x"><select name="plan"><option value="pro" selected>Pro</option></select></form>',
    );
    expect(new HtmlElementDataComponent(form, SUBMIT).formDataText).toEqual([
      { key: 'plan', value: 'pro' },
    ]);
  });

  it('keeps checkbox and radio values on submit', () => {
    const form = mount(
      '<form action="/x">' +
        '<input name="terms" type="checkbox" value="accepted" checked />' +
        '<input name="size" type="radio" value="large" checked />' +
        '</form>',
    );
    expect(new HtmlElementDataComponent(form, SUBMIT).formDataText).toEqual([
      { key: 'terms', value: 'accepted' },
      { key: 'size', value: 'large' },
    ]);
  });

  it('keeps a checkbox value on change', () => {
    const box = mount('<input type="checkbox" value="accepted" checked />');
    expect(new HtmlElementDataComponent(box, CHANGE).targetText).toBe(
      'accepted',
    );
  });

  it('keeps the label of a button and a submit input', () => {
    const button = mount('<button>Buy now</button>');
    expect(new HtmlElementDataComponent(button, CLICK).targetText).toBe(
      'Buy now',
    );
    const submit = mount('<input type="submit" value="Sign up" />');
    expect(new HtmlElementDataComponent(submit, CLICK).targetText).toBe(
      'Sign up',
    );
  });
});
