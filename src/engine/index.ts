/**
 * Public API of the engine. The UI imports only from here, so the internals can change freely.
 */
export * from './types';
export { runFund } from './partners';
export { computeMetrics, lpCashFlows, type FundMetrics } from './metrics';
export { xirr, type DatedFlow } from './xirr';
export { validate, assertValid, ValidationError, type ValidationIssue } from './validate';
export { yearFraction, daysBetween } from './daycount';
