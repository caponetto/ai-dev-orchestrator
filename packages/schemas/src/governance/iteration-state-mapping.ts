/** Built-in contract membership and the states that start a counted round. */
export const ITERATION_STATE_MAPPING: Readonly<
  Partial<
    Record<
      string,
      {
        contractId: string;
        counter?: 'iteration' | 'judge';
      }
    >
  >
> = {
  PLAN_REVIEW: { contractId: 'plan_review_loop', counter: 'iteration' },
  CODE_REVIEW: { contractId: 'implementation_review_loop', counter: 'iteration' },
  REVIEW_SYNTHESIS: { contractId: 'implementation_review_loop' },
  IMPLEMENTATION: { contractId: 'implementation_review_loop' },
  TEST_AUTHORING: { contractId: 'implementation_review_loop' },
  JUDGE_REVIEW: { contractId: 'implementation_review_loop', counter: 'judge' },
  REFINEMENT: { contractId: 'clarification_loop', counter: 'iteration' },
  WAITING_FOR_HUMAN: { contractId: 'clarification_loop' },
  ACCEPTANCE_VALIDATION: { contractId: 'acceptance_validation_loop', counter: 'iteration' },
  DECOMPOSITION_REVIEW: { contractId: 'decomposition_review_loop', counter: 'iteration' },
};
