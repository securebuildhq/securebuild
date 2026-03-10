"use server";

import Stripe from 'stripe';
import { Session } from "@/lib/types/session";
import { requireValidSession } from "@/lib/utils/session-validation";
import { traceServerAction } from "@/lib/observability/tracing";
import { getCatalogItemPriceId } from '@/lib/catalog/catalog';
import { getStripeCustomerId } from '@/lib/team/team';
import { addFreeSubscriptionAction } from './add-free-subscription';

let stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!stripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY is not configured');
    }
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2023-10-16' as any, // Using 'as any' to bypass potential strict type checks for now
    });
  }
  return stripe;
}

export interface CreateCheckoutSessionResult {
  clientSecret?: string;
  intentType?: 'payment' | 'setup';
  isFree?: boolean;
  url?: string;
}

async function createCheckoutSessionActionImpl(sess: Session, catalogItemId: string, recurringFrequency: string): Promise<CreateCheckoutSessionResult> {
  const validatedSession = await requireValidSession(sess);

  const priceId = await getCatalogItemPriceId(catalogItemId, recurringFrequency, validatedSession.selectedTeamId);
  if (!priceId) {
    throw new Error("Failed to retrieve Price ID for the selected catalog item and frequency.");
  }

  try {
    // First, let's get the price details to understand what we're working with
    const priceDetails = await getStripe().prices.retrieve(priceId);

    // Check if this is a free subscription (price is 0)
    if (priceDetails.unit_amount === 0) {
      try {
        await addFreeSubscriptionAction(sess, catalogItemId);

        return {
          isFree: true,
        };
      } catch (freeSubError) {
        console.error("DEBUG: Failed to create free subscription:", freeSubError);
        throw new Error("Failed to create free subscription");
      }
    }

    const customerId = await getStripeCustomerId(sess.selectedTeamId);

    const subscription = await getStripe().subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      payment_behavior: 'default_incomplete',
      payment_settings: {
        save_default_payment_method: 'on_subscription',
        payment_method_types: ['card', 'amazon_pay'],
      },
      expand: ['latest_invoice.payment_intent'],
    });

    const latestInvoice = subscription.latest_invoice as any;
    if (!latestInvoice) {
      console.error("DEBUG: No latest invoice found on subscription");
      throw new Error("Failed to retrieve invoice for the subscription.");
    }

    const paymentIntentOrId = latestInvoice.payment_intent;

    if (paymentIntentOrId && sess.user?.email) {
      const paymentIntentId = typeof paymentIntentOrId === 'string' ? paymentIntentOrId : (paymentIntentOrId as Stripe.PaymentIntent).id;
      await getStripe().paymentIntents.update(paymentIntentId, {
        receipt_email: sess.user.email,
      });
    }

    if (!paymentIntentOrId) {
      console.error("DEBUG: No payment intent found on invoice - this might be a send_invoice collection method");

      // For send_invoice collection method, we might need to create a setup intent instead
      if (latestInvoice.collection_method === 'send_invoice') {
        // We'll handle this case differently - maybe create a setup intent for future payments
        throw new Error("Invoice collection method is send_invoice - payment intent not available.");
      }

      // Handle micro-transactions where Stripe treats small amounts as $0
      if (latestInvoice.amount_due === 0 && latestInvoice.status === 'paid') {
        try {
          const setupIntent = await getStripe().setupIntents.create({
            customer: customerId,
            payment_method_types: ['card', 'amazon_pay'],
            usage: 'off_session',
            metadata: {
              subscription_id: subscription.id,
              catalog_item_id: catalogItemId,
              micro_transaction: 'true'
            }
          });

          if (setupIntent.client_secret) {
            return {
              clientSecret: setupIntent.client_secret,
              intentType: 'setup',
            };
          } else {
            throw new Error("Setup intent created but has no client secret");
          }
        } catch (setupError) {
          console.error("DEBUG: Failed to create setup intent for micro-transaction:", setupError);
          throw new Error("Failed to create setup intent for payment method collection");
        }
      }

      throw new Error("No payment intent found on invoice.");
    }

    if (paymentIntentOrId && typeof paymentIntentOrId === 'object' && 'client_secret' in paymentIntentOrId) {
      const paymentIntent = paymentIntentOrId as Stripe.PaymentIntent; // Cast to PaymentIntent
      if (paymentIntent.client_secret) {
        return {
          clientSecret: paymentIntent.client_secret,
          intentType: 'payment',
        };
      } else {
        console.error("DEBUG: Payment intent object exists but has no client_secret");
      }
    } else if (typeof paymentIntentOrId === 'string') {
      // This case should ideally not happen if expansion is successful
      console.error("DEBUG: Payment intent was returned as an ID string, expansion failed");

      try {
        const retrievedPaymentIntent = await getStripe().paymentIntents.retrieve(paymentIntentOrId);
        if (retrievedPaymentIntent.client_secret) {
          return {
            clientSecret: retrievedPaymentIntent.client_secret,
            intentType: 'payment',
          };
        }
      } catch (retrieveError) {
        console.error("DEBUG: Failed to manually retrieve payment intent:", retrieveError);
      }

      throw new Error("Payment intent was returned as an ID, not an expanded object.");
    } else {
      console.error("DEBUG: Payment intent is neither object with client_secret nor string ID");
    }

    throw new Error("Failed to extract payment intent client secret from invoice or payment intent not found.");
  } catch (err: any) {
    console.error('Stripe API Error in createCheckoutSessionAction:', err);
    const msg = err instanceof Stripe.errors.StripeError ? err.message : 'An unexpected error occurred while creating the subscription.';
    throw new Error(msg);
  }
}

export const createCheckoutSessionAction = traceServerAction('createCheckoutSessionAction', createCheckoutSessionActionImpl);



