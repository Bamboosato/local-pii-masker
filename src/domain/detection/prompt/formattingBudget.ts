/** Streaming JSON lexer: budget formatting whitespace, never quoted source text. */
export class JsonFormattingBudget {
  private quoted = false;
  private escaped = false;
  private run = 0;
  private exceeded = false;

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError("Invalid formatting budget");
  }

  exceeds(fragment: string): boolean {
    if (this.exceeded) return true;
    for (const character of fragment) {
      if (this.quoted) {
        if (this.escaped) this.escaped = false;
        else if (character === "\\") this.escaped = true;
        else if (character === '"') this.quoted = false;
      } else if (character === '"') {
        this.quoted = true;
        this.run = 0;
      } else if (/[ \t\r\n]/u.test(character)) {
        if (++this.run > this.limit) { this.exceeded = true; return true; }
      } else this.run = 0;
    }
    return false;
  }
}
