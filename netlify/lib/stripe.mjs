/* One Stripe client for every function. Tests replace it with a fake. */
import Stripe from "stripe";

let client = null;
export function stripe() {
  if (!client) client = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
  return client;
}
export function __setStripe(fake) { client = fake; }
