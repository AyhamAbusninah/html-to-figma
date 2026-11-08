/**
 * WHATWG globals available in every runtime the engine targets (Chrome content scripts, Node ≥ 22, Vitest).
 * Declared minimally here instead of pulling in the DOM lib, which would allow accidental DOM access (plan §3).
 */
declare class URL {
  constructor(url: string, base?: string);
  hash: string;
  toString(): string;
}
