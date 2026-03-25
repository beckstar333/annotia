// POST /api/webhook — Stripe webhook handler
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

export const config = { api: { bodyParser: false } }

async function buffer(readable) {
  const chunks = []
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY

  if (!stripeKey || !supabaseUrl || !supabaseServiceKey) {
    return res.status(500).json({ error: 'Server not configured' })
  }

  const stripe = new Stripe(stripeKey)
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const body = await buffer(req)
  const sig = req.headers['stripe-signature']

  let event

  // Verify signature if webhook secret is set
  if (webhookSecret && webhookSecret !== 'whsec_placeholder' && sig) {
    try {
      event = stripe.webhooks.constructEvent(body, sig, webhookSecret)
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message)
      return res.status(400).json({ error: 'Invalid signature' })
    }
  } else {
    try {
      event = JSON.parse(body.toString())
    } catch {
      return res.status(400).json({ error: 'Invalid payload' })
    }
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object
        if (session.metadata?.product !== 'annotia_pro') break

        const userId = session.metadata?.user_id
        const subscriptionId = session.subscription
        const customerEmail = session.customer_details?.email

        if (userId) {
          await supabase.from('profiles').update({
            is_pro: true,
            stripe_subscription_id: subscriptionId,
            pro_since: new Date().toISOString(),
            pro_until: null, // active subscription, no end date
          }).eq('id', userId)

          console.log(`Pro activated for user ${userId}`)
        }
        break
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object
        const status = sub.status

        if (status === 'active') {
          const periodEnd = new Date(sub.current_period_end * 1000)
          await supabase.from('profiles').update({
            is_pro: true,
            pro_until: periodEnd.toISOString(),
          }).eq('stripe_subscription_id', sub.id)
        }
        break
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object
        await supabase.from('profiles').update({
          is_pro: false,
          pro_until: new Date().toISOString(),
        }).eq('stripe_subscription_id', sub.id)

        console.log(`Pro cancelled for subscription ${sub.id}`)
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object
        console.log('Payment failed for customer:', invoice.customer)
        break
      }
    }

    return res.status(200).json({ received: true })
  } catch (err) {
    console.error('Webhook handler error:', err)
    return res.status(500).json({ error: err.message })
  }
}
