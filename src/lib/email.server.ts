type SignInCodeEmail = {
  email: string
  otp: string
}

export async function sendSignInCodeEmail({ email, otp }: SignInCodeEmail) {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.AUTH_EMAIL_FROM

  if (!apiKey || !from) {
    throw new Error(
      'Email delivery is not configured. Set RESEND_API_KEY and AUTH_EMAIL_FROM.',
    )
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: `${otp} is your Envelove sign-in code`,
      text: [
        `${otp} is your Envelove sign-in code.`,
        '',
        'The code expires in 10 minutes.',
        'If you did not request this code, you can safely ignore this email.',
      ].join('\n'),
      html: `
        <div style="background:#f2f7f3;padding:40px 16px;font-family:Arial,sans-serif;color:#173a40">
          <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #dce8df;border-radius:20px;padding:36px">
            <p style="margin:0 0 22px;font-size:13px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#2f6a4a">Envelove</p>
            <h1 style="margin:0 0 14px;font-size:28px;line-height:1.2">Your sign-in code</h1>
            <p style="margin:0 0 24px;color:#416166;line-height:1.6">Enter this code to finish signing in. There’s no password to enter or remember.</p>
            <div style="display:inline-block;border-radius:12px;background:#eef5f0;color:#173a40;padding:15px 20px;font-size:30px;font-weight:700;letter-spacing:.22em">${escapeHtml(otp)}</div>
            <p style="margin:26px 0 0;color:#668085;font-size:13px;line-height:1.5">This code expires in 10 minutes. If you didn’t request it, you can safely ignore this email.</p>
          </div>
        </div>
      `,
    }),
  })

  if (!response.ok) {
    throw new Error(`Email provider rejected the request (${response.status}).`)
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}
