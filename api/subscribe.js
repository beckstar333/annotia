export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email } = req.body;

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  const apiKey = process.env.BEEHIIV_API_KEY;
  const publicationId = 'pub_1dd1582d-dc6a-4658-9a42-d1d853f82c92';

  if (!apiKey) {
    return res.status(500).json({ error: 'Beehiiv not configured' });
  }

  try {
    const response = await fetch(`https://api.beehiiv.com/v2/publications/${publicationId}/subscriptions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        email,
        reactivate_existing: false,
        send_welcome_email: true,
        utm_source: 'annotia.io',
        utm_medium: 'waitlist_form'
      })
    });

    if (!response.ok) {
      const err = await response.json();
      // If already subscribed treat as success
      if (response.status === 409) {
        return res.status(200).json({ success: true, message: 'already_subscribed' });
      }
      return res.status(response.status).json({ error: err.message || 'Subscription failed' });
    }

    return res.status(200).json({ success: true });

  } catch (e) {
    return res.status(500).json({ error: e.message || 'Subscription failed' });
  }
}
