/**
 * DirtyJson — tolerant JSON parser ported from Agent Zero.
 *
 * Handles: malformed JSON, comments (// and /*), unquoted keys,
 * trailing commas, text before/after JSON blocks, double-brace wrappers,
 * single-quoted strings, multiline strings, and unquoted string values.
 */

export class DirtyJson {
  private jsonStr = "";
  private idx = 0;
  private ch: string | null = null;
  private result: unknown = null;
  private stack: unknown[] = [];
  private completed = false;
  private started = false;

  private reset(): void {
    this.jsonStr = "";
    this.idx = 0;
    this.ch = null;
    this.result = null;
    this.stack = [];
    this.completed = false;
    this.started = false;
  }

  private popStack(rootClosed: boolean): void {
    this.stack.pop();
    if (rootClosed && this.started && this.stack.length === 0) {
      this.completed = true;
    }
  }

  static parseString(s: string): unknown {
    return new DirtyJson().parse(s);
  }

  parse(s: string): unknown {
    this.reset();
    this.jsonStr = s;
    if (!s) return null;

    this.idx = this.findStart(s);
    if (this.idx >= s.length) return null;
    this.ch = s[this.idx];
    this.run();
    return this.result;
  }

  feed(chunk: string): unknown {
    this.jsonStr += chunk;
    if (!this.ch && this.jsonStr) this.ch = this.jsonStr[0];
    this.run();
    return this.result;
  }

  private advance(count = 1): void {
    this.idx += count;
    this.ch = this.idx < this.jsonStr.length ? this.jsonStr[this.idx] : null;
  }

  private peek(n: number): string {
    let r = "";
    let pi = this.idx + 1;
    for (let i = 0; i < n && pi < this.jsonStr.length; i++, pi++) {
      r += this.jsonStr[pi];
    }
    return r;
  }

  private skipWhitespace(): void {
    while (this.ch !== null) {
      if (this.ch === " " || this.ch === "\t" || this.ch === "\n" || this.ch === "\r") {
        this.advance();
      } else if (this.ch === "/" && this.peek(1) === "/") {
        this.skipLineComment();
      } else if (this.ch === "/" && this.peek(1) === "*") {
        this.skipBlockComment();
      } else {
        break;
      }
    }
  }

  private skipLineComment(): void {
    while (this.ch !== null && this.ch !== "\n") this.advance();
    if (this.ch === "\n") this.advance();
  }

  private skipBlockComment(): void {
    this.advance(2);
    while (this.ch !== null) {
      if (this.ch === "*" && this.peek(1) === "/") {
        this.advance(2);
        return;
      }
      this.advance();
    }
  }

  private match(text: string): boolean {
    if (!this.ch || this.ch.toLowerCase() !== text[0].toLowerCase()) return false;
    const rest = text.length - 1;
    if (this.peek(rest).toLowerCase() === text.slice(1).toLowerCase()) {
      this.advance(text.length);
      return true;
    }
    return false;
  }

  private run(): void {
    if (this.completed && this.stack.length === 0) return;
    if (this.result === null) {
      this.result = this.parseValue();
    } else {
      this.continueParsing();
    }
  }

  private continueParsing(): void {
    while (this.ch !== null) {
      if (this.completed && this.stack.length === 0) return;
      if (typeof this.result === "object" && this.result !== null && !Array.isArray(this.result)) {
        this.parseObjectContent();
      } else if (Array.isArray(this.result)) {
        this.parseArrayContent();
      } else {
        break;
      }
    }
  }

  private parseValue(): unknown {
    this.skipWhitespace();
    if (this.ch === "{") {
      if (this.stack.length === 0 && this.peek(1) === "{") this.advance(2);
      return this.parseObject();
    }
    if (this.ch === "[") return this.parseArray();
    if (this.ch === '"' || this.ch === "'" || this.ch === "`") {
      if (this.peek(2) === this.ch! + this.ch!) return this.parseMultilineString();
      return this.parseString();
    }
    if (this.ch !== null && ((this.ch >= "0" && this.ch <= "9") || this.ch === "-" || this.ch === "+")) {
      return this.parseNumber();
    }
    if (this.match("true")) return true;
    if (this.match("false")) return false;
    if (this.match("null") || this.match("undefined")) return null;
    if (this.ch !== null) return this.parseUnquotedString();
    return null;
  }

  private parseObject(): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    this.advance();
    this.stack.push(obj);
    this.started = true;
    this.parseObjectContent();
    return obj;
  }

  private parseObjectContent(): void {
    while (this.ch !== null) {
      this.skipWhitespace();
      if (this.ch === "}") {
        if (this.stack.length === 1 && this.peek(1) === "}") {
          this.advance(2);
        } else {
          this.advance();
        }
        this.popStack(true);
        return;
      }
      if (this.ch === null) { this.popStack(false); return; }

      const key = this.parseKey();
      this.skipWhitespace();
      if (this.ch === ":") {
        this.advance();
        this.skipWhitespace();
      }
      const value = this.parseValue();
      (this.stack[this.stack.length - 1] as Record<string, unknown>)[key] = value;

      this.skipWhitespace();
      if (this.ch === ",") { this.advance(); continue; }
      if (this.ch !== "}") {
        if (this.ch === null) { this.popStack(false); return; }
        continue;
      }
    }
  }

  private parseKey(): string {
    this.skipWhitespace();
    if (this.ch === '"' || this.ch === "'") return this.parseString(true);
    return this.parseUnquotedKey();
  }

  private parseUnquotedKey(): string {
    let r = "";
    while (this.ch !== null && !/\s/.test(this.ch) && !":,}]".includes(this.ch)) {
      r += this.ch;
      this.advance();
    }
    return r;
  }

  private parseArray(): unknown[] {
    const arr: unknown[] = [];
    this.advance();
    this.stack.push(arr);
    this.started = true;
    this.parseArrayContent();
    return arr;
  }

  private parseArrayContent(): void {
    while (this.ch !== null) {
      this.skipWhitespace();
      if (this.ch === "]") {
        this.advance();
        this.popStack(true);
        return;
      }
      const value = this.parseValue();
      (this.stack[this.stack.length - 1] as unknown[]).push(value);
      this.skipWhitespace();
      if (this.ch === ",") {
        this.advance();
        this.skipWhitespace();
        const afterComma: string | null = this.ch;
        if (afterComma === null || afterComma === "]") {
          if (afterComma === "]") this.advance();
          this.popStack(true);
          return;
        }
      } else if (this.ch !== "]") {
        this.popStack(false);
        return;
      }
    }
  }

  private parseString(isKey = false): string {
    let r = "";
    const q = this.ch!;
    this.advance();
    while (this.ch !== null) {
      if (this.ch === q) {
        if (this.isClosingQuote(isKey)) break;
        r += this.ch;
        this.advance();
        continue;
      }
      if (this.ch === "\\") {
        this.advance();
        const esc: string | null = this.ch;
        if (esc === "u") {
          this.advance();
          let hex = "";
          for (let i = 0; i < 4 && this.ch !== null && /[0-9a-fA-F]/.test(this.ch); i++) {
            hex += this.ch;
            this.advance();
          }
          if (hex.length === 4) r += String.fromCharCode(parseInt(hex, 16));
          else r += "\\u" + hex;
          continue;
        }
        const escapeMap: Record<string, string> = { b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
        r += escapeMap[esc!] ?? esc!;
        this.advance();
        continue;
      }
      r += this.ch;
      this.advance();
    }
    if (this.ch === q) this.advance();
    return r;
  }

  private isClosingQuote(isKey: boolean): boolean {
    let ni = this.skipPadding(this.idx + 1);
    if (ni >= this.jsonStr.length) return true;
    const next = this.jsonStr[ni];
    if (isKey) return ":,}]".includes(next);
    if (",}]".includes(next)) return true;
    return this.looksLikeMissingComma(ni);
  }

  private looksLikeMissingComma(index: number): boolean {
    if (this.stack.length === 0 || typeof this.stack[this.stack.length - 1] !== "object" || Array.isArray(this.stack[this.stack.length - 1])) return false;
    if (index >= this.jsonStr.length || (this.jsonStr[index] !== '"' && this.jsonStr[index] !== "'")) return false;
    const q = this.jsonStr[index];
    let i = index + 1;
    while (i < this.jsonStr.length) {
      const c = this.jsonStr[i];
      if (c === "\\") { i += 2; continue; }
      if (c === q) { const ni = this.skipPadding(i + 1); return ni < this.jsonStr.length && this.jsonStr[ni] === ":"; }
      if ("\n\r{},[]".includes(c)) return false;
      i++;
    }
    return false;
  }

  private skipPadding(index: number): number {
    while (index < this.jsonStr.length) {
      const c = this.jsonStr[index];
      if (c === " " || c === "\t" || c === "\n" || c === "\r") { index++; continue; }
      if (c === "/" && index + 1 < this.jsonStr.length) {
        if (this.jsonStr[index + 1] === "/") {
          index += 2;
          while (index < this.jsonStr.length && this.jsonStr[index] !== "\n") index++;
        } else if (this.jsonStr[index + 1] === "*") {
          const end = this.jsonStr.indexOf("*/", index + 2);
          index = end === -1 ? this.jsonStr.length : end + 2;
        } else {
          break;
        }
      } else {
        break;
      }
    }
    return index;
  }

  private parseMultilineString(): string {
    let r = "";
    const q = this.ch!;
    this.advance(3);
    while (this.ch !== null) {
      if (this.ch === q && this.peek(2) === q + q) { this.advance(3); break; }
      r += this.ch;
      this.advance();
    }
    return r.trim();
  }

  private parseNumber(): number | string {
    let s = "";
    while (this.ch !== null && /[0-9+\-\.eE]/.test(this.ch)) {
      s += this.ch;
      this.advance();
    }
    const n = Number(s);
    return Number.isNaN(n) ? s : n;
  }

  private parseUnquotedString(): string {
    let r = "";
    while (this.ch !== null && !":,}]".includes(this.ch)) {
      r += this.ch;
      this.advance();
    }
    this.advance();
    return r.trim();
  }

  private findStart(s: string): number {
    const candidates = ["{", "[", '"'];
    let min = s.length;
    for (const c of candidates) {
      const i = s.indexOf(c);
      if (i !== -1 && i < min) min = i;
    }
    return min === s.length ? 0 : min;
  }
}

export function tryParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return DirtyJson.parseString(s);
  }
}

export function extractJson(s: string): string | null {
  const d = new DirtyJson();
  const result = d.parse(s);
  if (result === null) return null;
  return JSON.stringify(result);
}
