// POST /api/invite — Admin-only: invite a user by email
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const supabaseUrl = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_KEY
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Server not configured' })
  }

  const { email, fullName, userType, grantPro } = req.body
  if (!email) {
    return res.status(400).json({ error: 'Email is required' })
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  try {
    // Invite user via Supabase Auth — sends a magic link email
    const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
      data: {
        full_name: fullName || '',
      },
      redirectTo: 'https://www.annotia.io/dashboard.html',
    })

    if (error) {
      return res.status(400).json({ error: error.message })
    }

    const userId = data.user?.id

    // Update profile with user type and Pro status if specified
    if (userId) {
      const updates = {}
      if (fullName) updates.full_name = fullName
      if (userType) updates.user_type = userType
      if (grantPro) {
        updates.is_pro = true
        updates.pro_since = new Date().toISOString()
      }

      if (Object.keys(updates).length > 0) {
        await supabase.from('profiles').update(updates).eq('id', userId)
      }
    }

    return res.status(200).json({
      success: true,
      userId,
      message: `Invite sent to ${email}`,
    })
  } catch (err) {
    console.error('Invite error:', err)
    return res.status(500).json({ error: err.message })
  }
}
