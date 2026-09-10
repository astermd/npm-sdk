/**
 * Journey events recorded alongside intake-submission records.
 *
 * Every call to {@link IntakeSubmissions.create} or
 * {@link IntakeSubmissions.update} must carry one of these events to advance the
 * server-side order-flow state machine.
 *
 * Two separate flows exist, each with three events.
 *
 * Pre-qualifying flow - emitted while the prospect answers eligibility
 * questions:
 * - `PreQualifyingInitiated` → first form step (use with `create()`)
 * - `PreQualifyingInProgress` → intermediate steps (use with `update()`)
 * - `PreQualifyingCompleted` → final step / form submitted (use with `update()`)
 *
 * Intake flow - emitted while the prospect fills in the full intake
 * questionnaire:
 * - `IntakeInitiated` → first form step (use with `create()`)
 * - `IntakeInProgress` → intermediate steps (use with `update()`)
 * - `IntakeCompleted` → final step / form submitted (use with `update()`)
 *
 * In both flows the `*Initiated` event always goes to `create()`, the call that
 * creates the server-side record, and the `*InProgress` / `*Completed` events go
 * to subsequent `update()` calls.
 */
export const Event = Object.freeze({
  /** The prospect started the pre-qualifying questionnaire. Pass to `create()`. */
  PreQualifyingInitiated: 'pre_qualifying_initiated',
  /** The prospect advanced through an intermediate pre-qualifying step. Pass to `update()`. */
  PreQualifyingInProgress: 'pre_qualifying_inprogress',
  /** The prospect submitted the pre-qualifying form. Pass to `update()`. */
  PreQualifyingCompleted: 'pre_qualifying_completed',
  /** The prospect started the intake questionnaire. Pass to `create()`. */
  IntakeInitiated: 'intake_initiated',
  /** The prospect advanced through an intermediate intake step. Pass to `update()`. */
  IntakeInProgress: 'intake_inprogress',
  /** The prospect submitted the intake form. Pass to `update()`. */
  IntakeCompleted: 'intake_completed',
} as const);

/** Any journey event wire value. A bare string literal satisfies this type. */
export type Event = (typeof Event)[keyof typeof Event];
