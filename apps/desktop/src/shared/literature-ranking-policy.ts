export const BALANCED_LITERATURE_POLICY_ID = 'balanced-three-layer' as const;
export const BALANCED_LITERATURE_POLICY_VERSION = 4;
/**
 * Version 4 changed what may be saved (a paper must mention the search terms; Broad is no longer
 * topped up with off-topic works). The Core and Rising gates below are unchanged since version 3,
 * so a version 3 label still means what the current explanation says and is not shown as legacy.
 */
export const BALANCED_LITERATURE_CORE_GATES_SINCE_VERSION = 3;

export const LITERATURE_CORE_MIN_RELEVANCE_SCORE = 0.55;
export const LITERATURE_CORE_MIN_CITATIONS = 50;
export const LITERATURE_CORE_MIN_INFLUENTIAL_CITATIONS = 10;
export const LITERATURE_CANONICAL_MIN_AGE_YEARS = 5;

export const LITERATURE_RISING_MAX_AGE_YEARS = 3;
export const LITERATURE_RISING_MIN_RELEVANCE_SCORE = 0.35;
export const LITERATURE_RISING_MIN_CITATIONS_PER_YEAR = 2;
export const LITERATURE_RISING_MIN_INFLUENTIAL_CITATIONS = 1;
