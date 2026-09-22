import type { UiLanguage } from '@gosu/ui/language';

/**
 * Literal reading of one pseudocode statement inside a repeated block. It only transcribes what
 * the statement says (every operand kept, no inferred semantics), so a step that no exact
 * operation parser recognizes still shows its equation and a readable description.
 */

type Token =
  | Readonly<{ kind: 'name'; value: string }>
  | Readonly<{ kind: 'number'; value: string }>
  | Readonly<{ kind: 'op'; value: string }>
  | Readonly<{ kind: 'ellipsis' }>;

type Argument = Readonly<{ keyword?: string; value: Expression }>;
type IndexItem =
  | Readonly<{ type: 'value'; value: Expression }>
  | Readonly<{
      type: 'slice';
      start: Expression | undefined;
      stop: Expression | undefined;
      step: Expression | undefined;
    }>;

type Expression =
  | Readonly<{ type: 'name'; name: string }>
  | Readonly<{ type: 'number'; value: string }>
  | Readonly<{ type: 'ellipsis' }>
  | Readonly<{ type: 'call'; callee: Expression; args: readonly Argument[] }>
  | Readonly<{ type: 'index'; target: Expression; items: readonly IndexItem[] }>
  | Readonly<{ type: 'list'; items: readonly Expression[] }>
  | Readonly<{ type: 'tuple'; items: readonly Expression[] }>
  | Readonly<{ type: 'unary'; operator: '-' | '+' | 'not'; operand: Expression }>
  | Readonly<{ type: 'binary'; operator: string; left: Expression; right: Expression }>
  | Readonly<{ type: 'range'; from: Expression; to: Expression }>
  | Readonly<{ type: 'juxtapose'; items: readonly Expression[] }>;

type Clause =
  | Readonly<{ type: 'assign'; targets: readonly Expression[]; value: Expression }>
  | Readonly<{ type: 'pipe'; source: Expression; value: Expression }>
  | Readonly<{ type: 'expression'; value: Expression }>;

export type ParsedPseudocodeStatement =
  | Readonly<{ type: 'clauses'; clauses: readonly Clause[] }>
  | Readonly<{
      type: 'control';
      keyword: 'if' | 'elif' | 'else' | 'while' | 'with';
      text: string;
      items: readonly Expression[];
    }>
  | Readonly<{ type: 'return'; value: Expression }>;

const MAX_STATEMENT_LENGTH = 800;
const MULTI_CHARACTER_OPERATORS = [
  '**',
  '==',
  '!=',
  '<=',
  '>=',
  '+=',
  '-=',
  '*=',
  '/=',
  '->',
  '<-',
  '..',
];
const SINGLE_CHARACTER_OPERATORS = new Set([...'+-*/@%^<>=()[]{},:;→←·×']);
const KEYWORDS = new Set(['and', 'or', 'not', 'in', 'if', 'elif', 'else', 'for', 'while', 'with']);
const ASSIGNMENT_OPERATORS = new Set(['=', '<-', '←', '+=', '-=', '*=', '/=']);
const COMPARISON_OPERATORS = new Set(['==', '!=', '<', '>', '<=', '>=']);
const CONTROL_KEYWORDS = new Set(['if', 'elif', 'else', 'while', 'with']);

function tokenize(code: string): Token[] | null {
  const tokens: Token[] = [];
  let index = 0;
  while (index < code.length) {
    const rest = code.slice(index);
    const space = /^\s+/u.exec(rest)?.[0];
    if (space) {
      index += space.length;
      continue;
    }
    if (rest.startsWith('...') || rest.startsWith('…')) {
      tokens.push({ kind: 'ellipsis' });
      index += rest.startsWith('…') ? 1 : 3;
      continue;
    }
    const number =
      /^\d+(?:\.\d+)?[eE][+-]?\d+/u.exec(rest)?.[0] ??
      /^\d+[A-Za-z_][A-Za-z0-9_]*/u.exec(rest)?.[0] ??
      /^\d+(?:\.\d+)?/u.exec(rest)?.[0];
    if (number) {
      tokens.push({ kind: 'number', value: number });
      index += number.length;
      continue;
    }
    const name = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*/u.exec(rest)?.[0];
    if (name) {
      tokens.push({ kind: 'name', value: name });
      index += name.length;
      continue;
    }
    const operator =
      MULTI_CHARACTER_OPERATORS.find((candidate) => rest.startsWith(candidate)) ??
      (SINGLE_CHARACTER_OPERATORS.has(rest[0]!) ? rest[0]! : null);
    if (!operator) return null;
    tokens.push({
      kind: 'op',
      value: operator === '·' || operator === '×' ? '*' : operator === '→' ? '->' : operator,
    });
    index += operator.length;
  }
  return tokens;
}

class Parser {
  private index = 0;
  constructor(private readonly tokens: readonly Token[]) {}

  done() {
    return this.index >= this.tokens.length;
  }
  private peek(): Token | undefined {
    return this.tokens[this.index];
  }
  private isOperator(...values: string[]) {
    const token = this.peek();
    return token?.kind === 'op' && values.includes(token.value);
  }
  private isKeyword(value: string) {
    const token = this.peek();
    return token?.kind === 'name' && token.value === value;
  }
  private take(): Token {
    const token = this.tokens[this.index];
    if (!token) throw new Error('unexpected_end');
    this.index += 1;
    return token;
  }
  private expect(value: string) {
    if (!this.isOperator(value)) throw new Error(`expected_${value}`);
    this.index += 1;
  }

  /** Whether the last expressionList ended with a comma, as in the one-item tuple `(a,)`. */
  private trailingComma = false;
  expressionList(): Expression[] {
    const items = [this.expression()];
    this.trailingComma = false;
    while (this.isOperator(',')) {
      this.index += 1;
      if (this.done() || this.isOperator(')', ']')) {
        this.trailingComma = true;
        break;
      }
      items.push(this.expression());
    }
    return items;
  }

  expression(): Expression {
    let left = this.and();
    while (this.isKeyword('or')) {
      this.index += 1;
      left = { type: 'binary', operator: 'or', left, right: this.and() };
    }
    return left;
  }
  private and(): Expression {
    let left = this.not();
    while (this.isKeyword('and')) {
      this.index += 1;
      left = { type: 'binary', operator: 'and', left, right: this.not() };
    }
    return left;
  }
  private not(): Expression {
    if (this.isKeyword('not')) {
      this.index += 1;
      return { type: 'unary', operator: 'not', operand: this.not() };
    }
    return this.comparison();
  }
  private comparison(): Expression {
    let left = this.range();
    for (;;) {
      const token = this.peek();
      const operator =
        token?.kind === 'op' && COMPARISON_OPERATORS.has(token.value)
          ? token.value
          : token?.kind === 'name' && token.value === 'in'
            ? 'in'
            : null;
      if (!operator) return left;
      this.index += 1;
      left = { type: 'binary', operator, left, right: this.range() };
    }
  }
  private range(): Expression {
    const from = this.additive();
    if (!this.isOperator('..')) return from;
    this.index += 1;
    return { type: 'range', from, to: this.additive() };
  }
  private additive(): Expression {
    let left = this.multiplicative();
    while (this.isOperator('+', '-')) {
      const operator = (this.take() as { value: string }).value;
      left = { type: 'binary', operator, left, right: this.multiplicative() };
    }
    return left;
  }
  private multiplicative(): Expression {
    let left = this.unary();
    while (this.isOperator('*', '/', '@', '%')) {
      const operator = (this.take() as { value: string }).value;
      left = { type: 'binary', operator, left, right: this.unary() };
    }
    return left;
  }
  private unary(): Expression {
    if (this.isOperator('-', '+')) {
      const operator = (this.take() as { value: string }).value as '-' | '+';
      return { type: 'unary', operator, operand: this.unary() };
    }
    return this.power();
  }
  private power(): Expression {
    const base = this.postfix();
    if (!this.isOperator('**', '^')) return base;
    this.index += 1;
    return { type: 'binary', operator: '**', left: base, right: this.unary() };
  }
  private postfix(): Expression {
    let expression = this.primary();
    for (;;) {
      if (this.isOperator('(')) {
        this.index += 1;
        expression = { type: 'call', callee: expression, args: this.arguments() };
      } else if (this.isOperator('[')) {
        this.index += 1;
        expression = { type: 'index', target: expression, items: this.indexItems() };
      } else if (this.peek()?.kind === 'ellipsis') {
        this.index += 1;
        expression = { type: 'juxtapose', items: [expression, { type: 'ellipsis' }] };
      } else {
        return expression;
      }
    }
  }
  private primary(): Expression {
    const token = this.take();
    if (token.kind === 'ellipsis') return { type: 'ellipsis' };
    if (token.kind === 'number') return { type: 'number', value: token.value };
    if (token.kind === 'name') {
      if (KEYWORDS.has(token.value)) throw new Error('unexpected_keyword');
      return { type: 'name', name: token.value };
    }
    if (token.value === '(') {
      if (this.isOperator(')')) throw new Error('empty_group');
      const items = this.expressionList();
      const trailingComma = this.trailingComma;
      this.expect(')');
      return items.length === 1 && !trailingComma ? items[0]! : { type: 'tuple', items };
    }
    if (token.value === '[') {
      const items = this.isOperator(']') ? [] : this.expressionList();
      this.expect(']');
      return { type: 'list', items };
    }
    throw new Error('unexpected_token');
  }
  private arguments(): Argument[] {
    const args: Argument[] = [];
    while (!this.isOperator(')')) {
      const token = this.peek();
      const next = this.tokens[this.index + 1];
      if (token?.kind === 'name' && next?.kind === 'op' && next.value === '=') {
        this.index += 2;
        args.push({ keyword: token.value, value: this.expression() });
      } else {
        args.push({ value: this.expression() });
      }
      if (!this.isOperator(',')) break;
      this.index += 1;
    }
    this.expect(')');
    return args;
  }
  private indexItems(): IndexItem[] {
    const items: IndexItem[] = [];
    while (!this.isOperator(']')) {
      const start = this.isOperator(':') ? undefined : this.expression();
      if (this.isOperator(':')) {
        this.index += 1;
        const stop = this.isOperator(',', ']', ':') ? undefined : this.expression();
        let step: Expression | undefined;
        if (this.isOperator(':')) {
          this.index += 1;
          step = this.isOperator(',', ']') ? undefined : this.expression();
        }
        items.push({ type: 'slice', start, stop, step });
      } else {
        items.push({ type: 'value', value: start! });
      }
      if (!this.isOperator(',')) break;
      this.index += 1;
    }
    this.expect(']');
    return items;
  }
}

function parseAll<T>(tokens: readonly Token[], read: (parser: Parser) => T): T {
  const parser = new Parser(tokens);
  const value = read(parser);
  if (!parser.done()) throw new Error('trailing_tokens');
  return value;
}

function splitTopLevel(tokens: readonly Token[], separator: string): Token[][] {
  const parts: Token[][] = [[]];
  let depth = 0;
  for (const token of tokens) {
    if (token.kind === 'op' && '([{'.includes(token.value)) depth += 1;
    if (token.kind === 'op' && ')]}'.includes(token.value)) depth -= 1;
    if (depth === 0 && token.kind === 'op' && token.value === separator) parts.push([]);
    else parts.at(-1)!.push(token);
  }
  return parts.filter((part) => part.length > 0);
}

function topLevelIndex(tokens: readonly Token[], operators: ReadonlySet<string>) {
  let depth = 0;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (token.kind !== 'op') continue;
    if ('([{'.includes(token.value)) depth += 1;
    else if (')]}'.includes(token.value)) depth -= 1;
    else if (depth === 0 && operators.has(token.value)) return index;
  }
  return -1;
}

function singleValue(items: readonly Expression[]): Expression {
  return items.length === 1 ? items[0]! : { type: 'tuple', items };
}

function parseClause(tokens: readonly Token[]): Clause {
  const assignment = topLevelIndex(tokens, ASSIGNMENT_OPERATORS);
  if (assignment > 0) {
    const operator = (tokens[assignment] as { value: string }).value;
    const targets = parseAll(tokens.slice(0, assignment), (parser) =>
      parser.expressionList(),
    ).flatMap((target) =>
      target.type === 'list' || target.type === 'tuple' ? target.items : [target],
    );
    if (!targets.every((target) => target.type === 'name' || target.type === 'index')) {
      throw new Error('invalid_target');
    }
    const value = singleValue(
      parseAll(tokens.slice(assignment + 1), (parser) => parser.expressionList()),
    );
    if (operator.length === 2 && operator.endsWith('=')) {
      if (targets.length !== 1) throw new Error('invalid_augmented_target');
      return {
        type: 'assign',
        targets,
        value: { type: 'binary', operator: operator[0]!, left: targets[0]!, right: value },
      };
    }
    return { type: 'assign', targets, value };
  }
  const pipe = topLevelIndex(tokens, new Set(['->']));
  if (pipe > 0) {
    return {
      type: 'pipe',
      source: parseAll(tokens.slice(0, pipe), (parser) => parser.expression()),
      value: parseAll(tokens.slice(pipe + 1), (parser) => parser.expression()),
    };
  }
  return {
    type: 'expression',
    value: singleValue(parseAll(tokens, (parser) => parser.expressionList())),
  };
}

export function parsePseudocodeStatement(code: string): ParsedPseudocodeStatement | null {
  const text = code.trim();
  if (!text || text.length > MAX_STATEMENT_LENGTH) return null;
  const tokens = tokenize(text);
  if (!tokens || tokens.length === 0) return null;
  try {
    const first = tokens[0]!;
    const last = tokens.at(-1)!;
    if (first.kind === 'name' && CONTROL_KEYWORDS.has(first.value)) {
      if (last.kind !== 'op' || last.value !== ':') return null;
      const keyword = first.value as 'if' | 'elif' | 'else' | 'while' | 'with';
      const body = tokens.slice(1, -1);
      if (keyword === 'else')
        return body.length === 0 ? { type: 'control', keyword, text: '', items: [] } : null;
      if (body.length === 0) return null;
      const items = parseAll(body, (parser) =>
        keyword === 'with' ? parser.expressionList() : [parser.expression()],
      );
      return {
        type: 'control',
        keyword,
        text: text
          .replace(/^\s*[A-Za-z]+\s*/u, '')
          .replace(/:\s*$/u, '')
          .trim(),
        items,
      };
    }
    if (first.kind === 'name' && first.value === 'return') {
      return {
        type: 'return',
        value: singleValue(parseAll(tokens.slice(1), (parser) => parser.expressionList())),
      };
    }
    const clauses = splitTopLevel(tokens, ';').map(parseClause);
    return clauses.length > 0 ? { type: 'clauses', clauses } : null;
  } catch {
    return null;
  }
}

// ---- LaTeX ---------------------------------------------------------------------------------

const GREEK = new Set([
  'alpha',
  'beta',
  'gamma',
  'delta',
  'epsilon',
  'zeta',
  'eta',
  'theta',
  'iota',
  'kappa',
  'lambda',
  'mu',
  'nu',
  'xi',
  'pi',
  'rho',
  'sigma',
  'tau',
  'upsilon',
  'phi',
  'chi',
  'psi',
  'omega',
  'Gamma',
  'Delta',
  'Theta',
  'Lambda',
  'Xi',
  'Pi',
  'Sigma',
  'Phi',
  'Psi',
  'Omega',
]);
const STANDARD_FUNCTIONS: Readonly<Record<string, string>> = {
  exp: String.raw`\exp`,
  log: String.raw`\log`,
  ln: String.raw`\ln`,
  sin: String.raw`\sin`,
  cos: String.raw`\cos`,
  tan: String.raw`\tan`,
  tanh: String.raw`\tanh`,
  max: String.raw`\max`,
  min: String.raw`\min`,
  det: String.raw`\det`,
};

const escapeName = (name: string) => name.replaceAll('_', String.raw`\_`);
const greekOrLetter = (base: string) =>
  GREEK.has(base) ? `\\${base}` : /^[A-Za-z]$/u.test(base) ? base : null;

function nameLatex(name: string): string {
  if (name === 'eps') return String.raw`\epsilon`;
  const whole = greekOrLetter(name);
  if (whole) return whole;
  const digits = /^([A-Za-z]+)(\d+)$/u.exec(name);
  const digitBase = digits ? greekOrLetter(digits[1]!) : null;
  if (digitBase) return `${digitBase}_{${digits![2]}}`;
  const subscript = /^([A-Za-z]+)_([A-Za-z0-9]+(?:_[A-Za-z0-9]+)*)$/u.exec(name);
  const subscriptBase = subscript ? greekOrLetter(subscript[1]!) : null;
  if (subscriptBase) {
    const rest = subscript![2]!;
    return `${subscriptBase}_{${rest.length === 1 ? rest : String.raw`\mathrm{${escapeName(rest)}}`}}`;
  }
  return String.raw`\mathrm{${escapeName(name)}}`;
}

function numberLatex(value: string) {
  const exponent = /^(\d+(?:\.\d+)?)[eE]([+-]?\d+)$/u.exec(value);
  return exponent ? String.raw`${exponent[1]}\times10^{${exponent[2]}}` : value;
}

const LEVEL = {
  or: 1,
  and: 2,
  not: 3,
  compare: 4,
  range: 5,
  add: 6,
  multiply: 7,
  unary: 8,
  power: 9,
  postfix: 10,
  atom: 11,
} as const;

function binaryLevel(operator: string) {
  if (operator === 'or') return LEVEL.or;
  if (operator === 'and') return LEVEL.and;
  if (operator === '+' || operator === '-') return LEVEL.add;
  if (operator === '**') return LEVEL.power;
  if (['*', '/', '@', '%'].includes(operator)) return LEVEL.multiply;
  return LEVEL.compare;
}

function level(expression: Expression): number {
  switch (expression.type) {
    case 'binary':
      return binaryLevel(expression.operator);
    case 'unary':
      return expression.operator === 'not' ? LEVEL.not : LEVEL.unary;
    case 'range':
      return LEVEL.range;
    case 'call':
    case 'index':
    case 'juxtapose':
      return LEVEL.postfix;
    default:
      return LEVEL.atom;
  }
}

function grouped(content: string) {
  return /\\frac|\\sum|\\prod/u.test(content)
    ? String.raw`\left(${content}\right)`
    : `(${content})`;
}

function wrap(expression: Expression, minimum: number) {
  const content = latex(expression);
  return level(expression) < minimum ? grouped(content) : content;
}

const COMPARISON_LATEX: Readonly<Record<string, string>> = {
  '==': '=',
  '!=': String.raw`\neq`,
  '<': '<',
  '>': '>',
  '<=': String.raw`\le`,
  '>=': String.raw`\ge`,
  in: String.raw`\in`,
  and: String.raw`\land`,
  or: String.raw`\lor`,
};

function calleeName(expression: Expression) {
  return expression.type === 'name' ? expression.name : null;
}

function argumentsLatex(args: readonly Argument[]) {
  return args
    .map((argument) =>
      argument.keyword
        ? String.raw`\mathrm{${escapeName(argument.keyword)}}\coloneqq ${latex(argument.value)}`
        : latex(argument.value),
    )
    .join(',');
}

function indexItemLatex(item: IndexItem) {
  if (item.type === 'value') return latex(item.value);
  const start = item.start ? latex(item.start) : '';
  const stop = item.stop ? latex(item.stop) : '';
  return item.step ? `${start}:${stop}:${latex(item.step)}` : `${start}:${stop}`;
}

function latex(expression: Expression): string {
  switch (expression.type) {
    case 'name':
      return nameLatex(expression.name);
    case 'number':
      return numberLatex(expression.value);
    case 'ellipsis':
      return String.raw`\ldots`;
    case 'list':
      return String.raw`\left[${expression.items.map(latex).join(',')}\right]`;
    case 'tuple':
      return grouped(expression.items.map(latex).join(','));
    case 'juxtapose':
      return expression.items.map((item) => wrap(item, LEVEL.postfix)).join(String.raw`\,`);
    case 'range':
      return String.raw`\{${wrap(expression.from, LEVEL.add)},\ldots,${wrap(expression.to, LEVEL.add)}\}`;
    case 'unary':
      return expression.operator === 'not'
        ? String.raw`\lnot ${wrap(expression.operand, LEVEL.not)}`
        : `${expression.operator}${wrap(expression.operand, LEVEL.unary)}`;
    case 'index': {
      const target = wrap(expression.target, LEVEL.postfix);
      const base = target.includes('_') ? `{${target}}` : target;
      return `${base}_{${expression.items.map(indexItemLatex).join(',')}}`;
    }
    case 'call': {
      const name = calleeName(expression.callee);
      const args = argumentsLatex(expression.args);
      if (name === 'sqrt' && expression.args.length === 1 && !expression.args[0]!.keyword) {
        return String.raw`\sqrt{${args}}`;
      }
      if (name === 'abs' && expression.args.length === 1 && !expression.args[0]!.keyword) {
        return String.raw`\left|${args}\right|`;
      }
      const callee = name
        ? (STANDARD_FUNCTIONS[name] ?? String.raw`\operatorname{${escapeName(name)}}`)
        : wrap(expression.callee, LEVEL.postfix);
      return `${callee}${grouped(args)}`;
    }
    case 'binary': {
      const operatorLevel = binaryLevel(expression.operator);
      if (expression.operator === '**') {
        return `{${wrap(expression.left, LEVEL.postfix)}}^{${latex(expression.right)}}`;
      }
      const left = wrap(expression.left, operatorLevel);
      const right = wrap(expression.right, operatorLevel + 1);
      switch (expression.operator) {
        case '+':
        case '-':
          return `${left}${expression.operator}${right}`;
        case '*':
          return expression.left.type === 'number'
            ? String.raw`${left}\,${right}`
            : String.raw`${left}\cdot ${right}`;
        case '/':
          return `${left}/${right}`;
        case '@':
          return String.raw`${left}\,${right}`;
        case '%':
          return String.raw`${left}\bmod ${right}`;
        default:
          return `${left}${COMPARISON_LATEX[expression.operator] ?? expression.operator} ${right}`;
      }
    }
  }
}

function targetsLatex(targets: readonly Expression[]) {
  const rendered = targets.map(latex);
  return rendered.length === 1 ? rendered[0]! : grouped(rendered.join(','));
}

/** Literal LaTeX transcription of a pseudocode statement, or null when it does not parse. */
export function pseudocodeStatementLatex(code: string): string | null {
  const statement = parsePseudocodeStatement(code);
  if (!statement) return null;
  if (statement.type === 'control') {
    const items = statement.items.map(latex).join(String.raw`,\ `);
    return items
      ? String.raw`\textbf{${statement.keyword}}\ ${items}`
      : String.raw`\textbf{${statement.keyword}}`;
  }
  if (statement.type === 'return') return String.raw`\textbf{return}\ ${latex(statement.value)}`;
  // `;\qquad` keeps several assignments on one row: formula rows split only on newlines.
  return statement.clauses
    .map((clause) =>
      clause.type === 'assign'
        ? String.raw`${targetsLatex(clause.targets)}\leftarrow ${latex(clause.value)}`
        : clause.type === 'pipe'
          ? String.raw`${latex(clause.source)}\rightarrow ${latex(clause.value)}`
          : latex(clause.value),
    )
    .join(String.raw`;\qquad `);
}

// ---- Plain description ---------------------------------------------------------------------

function plain(expression: Expression): string {
  switch (expression.type) {
    case 'name':
      return expression.name;
    case 'number':
      return expression.value;
    case 'ellipsis':
      return '...';
    case 'list':
      return `[${expression.items.map(plain).join(', ')}]`;
    case 'tuple':
      return `(${expression.items.map(plain).join(', ')})`;
    case 'juxtapose':
      return expression.items.map(plain).join(' ');
    case 'range':
      return `${plain(expression.from)}..${plain(expression.to)}`;
    case 'unary':
      return expression.operator === 'not'
        ? `not ${plain(expression.operand)}`
        : `${expression.operator}${plain(expression.operand)}`;
    case 'index':
      return `${plain(expression.target)}[${expression.items
        .map((item) =>
          item.type === 'value'
            ? plain(item.value)
            : `${item.start ? plain(item.start) : ''}:${item.stop ? plain(item.stop) : ''}`,
        )
        .join(', ')}]`;
    case 'call':
      return `${plain(expression.callee)}(${expression.args
        .map(
          (argument) => `${argument.keyword ? `${argument.keyword}=` : ''}${plain(argument.value)}`,
        )
        .join(', ')})`;
    case 'binary': {
      const operatorLevel = binaryLevel(expression.operator);
      const side = (child: Expression, minimum: number) =>
        level(child) < minimum ? `(${plain(child)})` : plain(child);
      return `${side(expression.left, operatorLevel)} ${expression.operator} ${side(expression.right, operatorLevel + 1)}`;
    }
  }
}

type Roles = Readonly<Record<UiLanguage, string>>;
const CALL_ROLES: ReadonlyArray<readonly [RegExp, Roles]> = [
  [/softmax/u, { ko: '확률 정규화', en: 'softmax' }],
  [
    /(?:^|_)(?:rms|layer|batch|group)?norm(?:_|$|\d)|normali[sz]e/u,
    { ko: '정규화', en: 'normalization' },
  ],
  [/standardi[sz]e/u, { ko: '표준화', en: 'standardization' }],
  [/film/u, { ko: '조건 주입', en: 'FiLM conditioning' }],
  [/mixer|(?:^|_)mix(?:_|$)/u, { ko: '혼합', en: 'mixing' }],
  [/gate/u, { ko: '게이트', en: 'gating' }],
  [/(?:^|_)sim(?:_|$)|similarity/u, { ko: '유사도', en: 'similarity' }],
  [/attn|attention|axial/u, { ko: '어텐션', en: 'attention' }],
  [
    /(?:^|_)(?:proj|projection|linear|lin|dense|fc)(?:_|$|\d)/u,
    { ko: '선형 투영', en: 'linear projection' },
  ],
  [
    /^(?:mlp|ffn|ff[a-z]?\d*)$|(?:^|_)(?:mlp|ffn)(?:_|$)/u,
    { ko: '피드포워드 층', en: 'feed-forward layer' },
  ],
  [
    /^(?:gelu|relu|silu|swish|elu|softplus|act|activation|tanh)$/u,
    { ko: '활성화 함수', en: 'activation' },
  ],
  [/^sigmoid$/u, { ko: '시그모이드', en: 'sigmoid' }],
  [/^exp$/u, { ko: '지수 함수', en: 'exponential' }],
  [/^(?:log|ln)$/u, { ko: '로그', en: 'logarithm' }],
  [/^max$/u, { ko: '최댓값', en: 'maximum' }],
  [/^min$/u, { ko: '최솟값', en: 'minimum' }],
  [/^sqrt$/u, { ko: '제곱근', en: 'square root' }],
  [/^abs$/u, { ko: '절댓값', en: 'absolute value' }],
  [/^sign$/u, { ko: '부호', en: 'sign' }],
  [/^(?:mean|avg|average)$/u, { ko: '평균', en: 'mean' }],
  [/^sum$/u, { ko: '합', en: 'sum' }],
  [/concat|^cat$/u, { ko: '이어붙이기', en: 'concatenation' }],
  [/^(?:split|chunk)$/u, { ko: '분할', en: 'split' }],
  [/clip|clamp/u, { ko: '범위 제한', en: 'clipping' }],
  [/embed/u, { ko: '임베딩', en: 'embedding' }],
  [/^(?:float\d*|bf16|half|double|cast|to_dtype)$/u, { ko: '자료형 변환', en: 'dtype cast' }],
  [/threshold/u, { ko: '임계값 처리', en: 'thresholding' }],
  [/^dropout$/u, { ko: '드롭아웃', en: 'dropout' }],
  [/^(?:transpose|permute|reshape|view|flatten)$/u, { ko: '형태 변환', en: 'reshape' }],
  [/^(?:matmul|einsum|bmm)$/u, { ko: '행렬곱', en: 'matrix product' }],
];
const OPERATOR_ROLES: Readonly<Record<string, Roles>> = {
  '+': { ko: '덧셈(+)', en: 'addition (+)' },
  '-': { ko: '뺄셈(−)', en: 'subtraction (−)' },
  '*': { ko: '곱셈(×)', en: 'multiplication (×)' },
  '/': { ko: '나눗셈(÷)', en: 'division (÷)' },
  '@': { ko: '행렬곱(@)', en: 'matrix product (@)' },
  '**': { ko: '거듭제곱', en: 'power' },
  '%': { ko: '나머지', en: 'modulo' },
};
const IGNORED_READS = new Set(['True', 'False', 'None', 'true', 'false', 'none']);

function callLabel(name: string, language: UiLanguage) {
  const key = name.split('.').at(-1)!.toLocaleLowerCase();
  const role = CALL_ROLES.find(([pattern]) => pattern.test(key))?.[1][language];
  if (!role || role.toLocaleLowerCase().startsWith(key)) return name;
  return language === 'ko' ? `${name}(${role})` : `${name} (${role})`;
}

type Collected = { calls: string[]; operators: string[]; reads: string[]; elided: boolean };

function collect(expression: Expression, into: Collected) {
  const add = (list: string[], value: string) => {
    if (!list.includes(value)) list.push(value);
  };
  switch (expression.type) {
    case 'name':
      if (!IGNORED_READS.has(expression.name)) add(into.reads, expression.name);
      return;
    case 'ellipsis':
      into.elided = true;
      return;
    case 'number':
      return;
    case 'list':
    case 'tuple':
    case 'juxtapose':
      expression.items.forEach((item) => collect(item, into));
      return;
    case 'range':
      collect(expression.from, into);
      collect(expression.to, into);
      return;
    case 'unary':
      collect(expression.operand, into);
      return;
    case 'index':
      collect(expression.target, into);
      expression.items.forEach((item) => {
        if (item.type === 'value') collect(item.value, into);
        else [item.start, item.stop, item.step].forEach((part) => part && collect(part, into));
      });
      return;
    case 'call': {
      const name = calleeName(expression.callee);
      if (!name) collect(expression.callee, into);
      expression.args.forEach((argument) => collect(argument.value, into));
      // Arguments are evaluated first, so the list reads in computation order.
      if (name) add(into.calls, name);
      return;
    }
    case 'binary':
      collect(expression.left, into);
      collect(expression.right, into);
      if (OPERATOR_ROLES[expression.operator]) add(into.operators, expression.operator);
      return;
  }
}

function sameTarget(expression: Expression, target: string) {
  return (
    (expression.type === 'name' || expression.type === 'index') && plain(expression) === target
  );
}

type ClauseKind = 'compute' | 'residual' | 'update' | 'alias';

function clauseKind(clause: Extract<Clause, { type: 'assign' }>): ClauseKind {
  const targets = clause.targets.map(plain);
  const value = clause.value;
  if (
    targets.length === 1 &&
    value.type === 'binary' &&
    value.operator === '+' &&
    (sameTarget(value.left, targets[0]!) || sameTarget(value.right, targets[0]!))
  ) {
    return 'residual';
  }
  if (value.type === 'name' || value.type === 'index') return 'alias';
  const reads: Collected = { calls: [], operators: [], reads: [], elided: false };
  collect(value, reads);
  return targets.some((target) => reads.reads.includes(target.split('[')[0]!))
    ? 'update'
    : 'compute';
}

const shortName = (text: string, limit = 56) =>
  text.length > limit ? `${text.slice(0, limit - 3).trimEnd()}...` : text;

function outerCall(expression: Expression) {
  return expression.type === 'call' ? calleeName(expression.callee) : null;
}

/** Concise English card name for a statement, or null when it does not parse. */
export function pseudocodeStepName(code: string): string | null {
  const statement = parsePseudocodeStatement(code);
  if (!statement) return null;
  if (statement.type === 'control') {
    const keyword = statement.keyword[0]!.toLocaleUpperCase() + statement.keyword.slice(1);
    return shortName(statement.text ? `${keyword} ${statement.text}` : keyword);
  }
  if (statement.type === 'return') return shortName(`Return ${plain(statement.value)}`);
  const assignments = statement.clauses.filter(
    (clause): clause is Extract<Clause, { type: 'assign' }> => clause.type === 'assign',
  );
  if (assignments.length > 1) {
    const targets = assignments.flatMap((clause) => clause.targets.map(plain)).join(', ');
    const updates = assignments.some((clause) => clauseKind(clause) !== 'compute');
    return shortName(`${updates ? 'Update' : 'Compute'} ${targets}`);
  }
  const clause = statement.clauses[0]!;
  if (clause.type === 'pipe') {
    return shortName(
      `Apply ${outerCall(clause.value) ?? plain(clause.value)} to ${plain(clause.source)}`,
    );
  }
  if (clause.type === 'expression') {
    const call = outerCall(clause.value);
    return shortName(call ? `Apply ${call}` : `Evaluate ${plain(clause.value)}`);
  }
  const target = clause.targets.map(plain).join(', ');
  const via = outerCall(clause.value);
  switch (clauseKind(clause)) {
    case 'residual':
      return shortName(`Residual update ${target}`);
    case 'alias':
      return shortName(`Pass ${plain(clause.value)} as ${target}`);
    case 'update':
      return shortName(`Update ${target}${via ? ` via ${via}` : ''}`);
    case 'compute':
      return shortName(`Compute ${target}${via ? ` via ${via}` : ''}`);
  }
}

export type RepeatStepExplanationInput = Readonly<{
  code: string;
  annotation: string;
  repeatLabel: string;
  repeatCount: number | string;
  stepNumber: number;
  stepCount: number;
  context: readonly string[];
  language: UiLanguage;
}>;

function actionSentence(
  statement: ParsedPseudocodeStatement,
  language: UiLanguage,
): Readonly<{ action: string; collected: Collected }> {
  const collected: Collected = { calls: [], operators: [], reads: [], elided: false };
  const ko = language === 'ko';
  if (statement.type === 'control') {
    const text = statement.text;
    const action =
      statement.keyword === 'with'
        ? ko
          ? `아래 들여쓴 단계들은 ${text} 설정 안에서 실행됩니다`
          : `The indented steps below run inside ${text}`
        : statement.keyword === 'else'
          ? ko
            ? '앞의 조건이 모두 거짓일 때 아래 들여쓴 단계들이 실행됩니다'
            : 'The indented steps below run when the previous conditions are false'
          : statement.keyword === 'while'
            ? ko
              ? `${text} 조건이 참인 동안 아래 들여쓴 단계들을 반복합니다`
              : `The indented steps below repeat while ${text} holds`
            : ko
              ? `${text} 조건이 참일 때만 아래 들여쓴 단계들이 실행됩니다`
              : `The indented steps below run only when ${text} holds`;
    return { action, collected };
  }
  if (statement.type === 'return') {
    collect(statement.value, collected);
    return {
      action: ko
        ? `${plain(statement.value)} 값을 반환합니다`
        : `Returns ${plain(statement.value)}`,
      collected,
    };
  }
  const assignments = statement.clauses.filter(
    (clause): clause is Extract<Clause, { type: 'assign' }> => clause.type === 'assign',
  );
  if (assignments.length > 1) {
    statement.clauses.forEach((clause) =>
      clause.type === 'pipe'
        ? [clause.source, clause.value].forEach((part) => collect(part, collected))
        : collect(clause.value, collected),
    );
    const targets = assignments.flatMap((clause) => clause.targets.map(plain)).join(', ');
    const updates = assignments.some((clause) => clauseKind(clause) !== 'compute');
    return {
      action: ko
        ? `${targets} 값을 차례로 ${updates ? '갱신' : '계산'}합니다`
        : `${updates ? 'Updates' : 'Computes'} ${targets} in turn`,
      collected,
    };
  }
  const phrases = statement.clauses.map((clause) => {
    if (clause.type === 'pipe') {
      collect(clause.source, collected);
      collect(clause.value, collected);
      return ko
        ? `${plain(clause.source)}에 ${plain(clause.value)}을(를) 적용합니다`
        : `Applies ${plain(clause.value)} to ${plain(clause.source)}`;
    }
    collect(clause.value, collected);
    if (clause.type === 'expression') {
      return ko ? `${plain(clause.value)}을(를) 계산합니다` : `Evaluates ${plain(clause.value)}`;
    }
    const target = clause.targets.map(plain).join(', ');
    switch (clauseKind(clause)) {
      case 'residual':
        return ko
          ? `${target}에 새 항을 더해 잔차(residual) 방식으로 갱신합니다`
          : `Updates ${target} residually by adding a new term to it`;
      case 'alias':
        return ko
          ? `${plain(clause.value)} 값을 ${target}(으)로 그대로 넘깁니다`
          : `Passes ${plain(clause.value)} on as ${target}`;
      case 'update':
        return ko
          ? `${target} 값을 이전 값으로부터 다시 계산해 갱신합니다`
          : `Recomputes ${target} from its previous value`;
      case 'compute':
        return ko ? `${target} 값을 계산합니다` : `Computes ${target}`;
    }
  });
  return { action: phrases.join(ko ? ', 이어서 ' : '; then '), collected };
}

/**
 * What one statement does, read literally: the action with the calls it chains, the operators it
 * uses, the values it reads, and whether the source elides part of it. Null when it does not parse.
 */
export function pseudocodeStatementSummary(code: string, language: UiLanguage): string[] | null {
  const statement = parsePseudocodeStatement(code);
  if (!statement) return null;
  const ko = language === 'ko';
  const { action, collected } = actionSentence(statement, language);
  const calls = collected.calls.slice(0, 8).map((name) => callLabel(name, language));
  const operators = collected.operators.map((operator) => OPERATOR_ROLES[operator]![language]);
  const lines = [`${action}${calls.length > 0 ? `: ${calls.join(' → ')}` : ''}.`];
  if (operators.length > 0) {
    lines.push(
      ko ? `사용한 연산: ${operators.join(', ')}.` : `Operators: ${operators.join(', ')}.`,
    );
  }
  const reads = statement.type === 'control' ? [] : collected.reads.slice(0, 8);
  if (reads.length > 0)
    lines.push(ko ? `읽는 값: ${reads.join(', ')}.` : `Reads: ${reads.join(', ')}.`);
  if (collected.elided) {
    lines.push(
      ko
        ? '원문에 ...로 생략된 부분이 있어 정확한 연산은 확인되지 않았습니다.'
        : 'Part of the source is elided as "...", so the exact operation is not confirmed.',
    );
  }
  return lines;
}

/** Readable, deterministic explanation of one loop step; one sentence per line. */
export function repeatStepExplanation(input: RepeatStepExplanationInput): string {
  const ko = input.language === 'ko';
  const lines: string[] = pseudocodeStatementSummary(input.code, input.language) ?? [
    ko
      ? `원문: ${input.code} (수식으로 해석하지 못한 문장이라 원문을 그대로 보여줍니다.)`
      : `Source: ${input.code} (not parsed as an equation, so the source is shown as written).`,
  ];
  input.context.forEach((header) => {
    const keyword = header.split(/\s/u, 1)[0];
    lines.push(
      keyword === 'with'
        ? ko
          ? `실행 환경: ${header} 안에서 실행됩니다.`
          : `Runs inside: ${header}.`
        : ko
          ? `실행 조건: ${header} 블록 안에서만 실행됩니다.`
          : `Runs only inside: ${header}.`,
    );
  });
  lines.push(
    ko
      ? `${input.repeatLabel} 반복 1회 안의 ${input.stepNumber}/${input.stepCount}번째 단계이며, 이 반복은 ${input.repeatCount}회 수행됩니다.`
      : `Step ${input.stepNumber} of ${input.stepCount} inside one iteration of ${input.repeatLabel}, repeated ${input.repeatCount} times.`,
  );
  if (input.annotation) {
    lines.push(
      ko ? `작성자 메모: ${input.annotation}.` : `Pseudocode annotation: ${input.annotation}.`,
    );
  }
  return lines.join('\n');
}

/** Values one statement writes and reads (call names excluded), or null when it does not parse. */
export function pseudocodeStatementNames(
  code: string,
): Readonly<{ writes: readonly string[]; reads: readonly string[] }> | null {
  const statement = parsePseudocodeStatement(code);
  if (!statement) return null;
  const collected: Collected = { calls: [], operators: [], reads: [], elided: false };
  const writes: string[] = [];
  const base = (expression: Expression): string | null =>
    expression.type === 'name'
      ? expression.name
      : expression.type === 'index'
        ? base(expression.target)
        : null;
  if (statement.type === 'control') statement.items.forEach((item) => collect(item, collected));
  else if (statement.type === 'return') collect(statement.value, collected);
  else
    statement.clauses.forEach((clause) => {
      if (clause.type === 'pipe') {
        collect(clause.source, collected);
        collect(clause.value, collected);
        const target = base(clause.source);
        if (target && !writes.includes(target)) writes.push(target);
        return;
      }
      collect(clause.value, collected);
      if (clause.type === 'assign')
        clause.targets.forEach((target) => {
          const name = base(target);
          if (name && !writes.includes(name)) writes.push(name);
          if (target.type === 'index')
            target.items.forEach((item) => {
              if (item.type === 'value') collect(item.value, collected);
            });
        });
    });
  return { writes, reads: collected.reads };
}
