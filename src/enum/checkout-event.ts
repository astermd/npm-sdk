/**
 * Checkout-funnel events recorded against a session.
 *
 * {@link CheckoutEvents.create} always records `CheckoutVisited` - it is the
 * call that opens the funnel record. Every later state is reported through
 * {@link CheckoutEvents.update} with one of the remaining values, which lets the
 * server reconstruct where a prospect abandoned checkout and which upsells they
 * were shown.
 */
export const CheckoutEvent = Object.freeze({
  /** The prospect reached the checkout page. Recorded implicitly by `create()`. */
  CheckoutVisited: 'checkout_visited',
  /** An upsell was presented to the prospect. */
  UpsellOffered: 'upsell_offered',
  /** The prospect accepted a presented upsell. */
  UpsellAccepted: 'upsell_accepted',
  /** The prospect declined a presented upsell. */
  UpsellDeclined: 'upsell_declined',
  /** The order was placed successfully. */
  OrderPlaced: 'order_placed',
  /** The order was declined, typically by the payment processor. */
  OrderDeclined: 'order_declined',
} as const);

/** Any checkout-funnel event wire value. A bare string literal satisfies this type. */
export type CheckoutEvent = (typeof CheckoutEvent)[keyof typeof CheckoutEvent];
