/** Public API of the Tab 2 pipeline. Pure: no DOM, no clock, no randomness. */
export { executeRun, emptyDatabase, currentRun, FUND_ID, ENGINE_VERSION } from './pipeline';
export type { Database, Row, Cell, PipelineRun, StageResult, StageId, StageStatus } from './pipeline';
export { DDL, type TableName } from './ddl';
export { allocateCents, toCents, fromCents } from './rounding';
export { fingerprint, canonicalJson, fnv1a } from './ids';
