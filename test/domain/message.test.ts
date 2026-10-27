import { describe, expect, it } from 'vitest';
import { parseMessage, placeholderSignature, renderedLength } from '../../src/domain/message.js';

const signature = (text: string) => placeholderSignature(parseMessage(text).nodes);

describe('parseMessage', () => {
  it('parses ICU arguments, plural branches and pound signs', () => {
    const { nodes, error } = parseMessage('{count, plural, offset:1 =0 {None} one {# for {name}} other {# items}}');
    expect(error).toBeUndefined();
    expect(nodes).toEqual([
      {
        type: 'branching',
        name: 'count',
        format: 'plural',
        options: [
          { selector: '=0', nodes: [{ type: 'text', value: 'None' }] },
          {
            selector: 'one',
            nodes: [
              { type: 'pound' },
              { type: 'text', value: ' for ' },
              { type: 'argument', name: 'name', format: undefined, raw: '{name}' },
            ],
          },
          { selector: 'other', nodes: [{ type: 'pound' }, { type: 'text', value: ' items' }] },
        ],
      },
    ]);
  });

  it('handles ICU apostrophe escaping', () => {
    expect(parseMessage("It''s '{literal}' and don't").nodes).toEqual([{ type: 'text', value: "It's {literal} and don't" }]);
    expect(parseMessage("{n, plural, other {'#' is #}}").nodes[0]).toMatchObject({
      options: [{ nodes: [{ type: 'text', value: '# is ' }, { type: 'pound' }] }],
    });
  });

  it('skips argument styles including skeletons', () => {
    expect(signature('{d, date, short} {a, number, ::currency/EUR}')).toEqual({ named: ['{a}', '{d}'], sequential: [] });
  });

  it('recognises mustache, printf and nested select inside plural', () => {
    const text = '{{user}} %1$s %d %.2f {g, select, f {{n, plural, one {#} other {#}}} other {x}}';
    expect(signature(text)).toEqual({ named: ['%1$s', '{g, select}', '{n, plural}', '{{user}}'], sequential: ['%d', '%f'] });
  });

  it.each([
    ['{', 'has no name'],
    ['{a', 'is not closed'],
    ['{}', 'has no name'],
    ['{a, }', 'empty format type'],
    ['{n, plural, one}', 'Expected "{"'],
    ['{n, plural,}', 'has no options'],
    ['{n, plural, offset:x other {#}}', 'offset must be a number'],
    ['{a, date, short', 'is not closed'],
    ['{n, plural, one {x}', 'is not closed'],
    ['a } b', 'Unexpected "}"'],
  ])('reports syntax errors for %j', (text, message) => {
    expect(parseMessage(text).error).toContain(message);
  });

  it('caches parsed messages', () => {
    expect(parseMessage('cached {x}')).toBe(parseMessage('cached {x}'));
  });
});

describe('renderedLength', () => {
  it('counts placeholders as their source text and branches by the longest one', () => {
    expect(renderedLength(parseMessage('Hi {name}').nodes)).toBe(9);
    expect(renderedLength(parseMessage('{n, plural, one {# day} other {# days left}} ok').nodes)).toBe(14);
    expect(renderedLength(parseMessage('é'.normalize('NFD')).nodes)).toBe(1);
  });
});
