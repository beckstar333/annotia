// POST /api/checkout — create Stripe Checkout session for Pro subscription
import Stripe from 'stripe'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) {
    return res.status(500).json({ error: 'Stripe not configured' })
  }

  const stripe = new Stripe(stripeKey)
  const { userId, email } = req.body

  if (!userId || !email) {
    return res.status(400).json({ error: 'userId and email are required' })
  }

  const origin = req.headers.origin || req.headers.referer?.replace(/\/+$/, '') || 'https://www.annotia.io'

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: email,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Annotia Pro',
              description: 'Unlimited AI summaries, collections, Pro badge, custom alerts, and more.',
            },
            unit_amount: 700,
            recurring: { interval: 'month' },
          },
          quantity: 1,
        },
      ],
      metadata: {
        user_id: userId,
        product: 'annotia_pro',
      },
      success_url: `${origin}/dashboard.html?pro=success`,
      cancel_url: `${origin}/pricing.html`,
    })

    return res.status(200).json({ url: session.url })
  } catch (err) {
    console.error('Checkout error:', err)
    return res.status(500).json({ error: err.message })
  }
}
