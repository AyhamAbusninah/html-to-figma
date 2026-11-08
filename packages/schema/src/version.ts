/** Version written by producers. Bump minor for additive changes, major for breaking ones (SCH-8). */
export const SCHEMA_VERSION = '1.0.0';

/** Consumers accept any 1.x.y document (SCH-8). */
export const SUPPORTED_MAJOR = 1;

export function majorOf(version: string): number {
  return Number(version.split('.')[0]);
}
