import { useState } from 'react'
import type { FormEvent } from 'react'
import { LoaderCircle } from 'lucide-react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { REGEXP_ONLY_DIGITS } from 'input-otp'

import { Button } from '#/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '#/components/ui/input-otp'
import { Label } from '#/components/ui/label'
import { getAuthSession } from '#/lib/auth.functions'
import { authClient } from '#/lib/auth-client'

export const Route = createFileRoute('/login')({
  beforeLoad: async () => {
    const session = await getAuthSession()

    if (session?.user) {
      throw redirect({ to: '/' })
    }
  },
  head: () => ({
    meta: [{ title: 'Sign in · Envelove' }],
  }),
  component: Login,
})

function Login() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [otp, setOtp] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function requestOtp(targetEmail: string) {
    setIsSending(true)
    setError(null)

    try {
      const result = await authClient.emailOtp.sendVerificationOtp({
        email: targetEmail,
        type: 'sign-in',
      })

      if (result.error) {
        throw new Error(result.error.message)
      }

      setOtp('')
      setSentTo(targetEmail)
    } catch {
      setError('Could not send the code. Try again.')
    } finally {
      setIsSending(false)
    }
  }

  async function handleEmailSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await requestOtp(email.trim().toLowerCase())
  }

  async function handleCodeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!sentTo) return

    setIsVerifying(true)
    setError(null)

    try {
      const result = await authClient.signIn.emailOtp({
        email: sentTo,
        otp,
      })

      if (result.error) {
        throw new Error(result.error.code)
      }

      await navigate({ to: '/' })
    } catch {
      setError('The code is incorrect or expired.')
    } finally {
      setIsVerifying(false)
    }
  }

  function changeEmail() {
    setSentTo(null)
    setOtp('')
    setError(null)
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in to Envelove</CardTitle>
        </CardHeader>
        <CardContent>
          {sentTo ? (
            <form className="grid gap-5" onSubmit={handleCodeSubmit}>
              <div className="grid gap-2">
                <Label htmlFor="otp">Verification code</Label>
                <InputOTP
                  aria-invalid={Boolean(error)}
                  autoComplete="one-time-code"
                  autoFocus
                  id="otp"
                  maxLength={6}
                  onChange={setOtp}
                  pattern={REGEXP_ONLY_DIGITS}
                  value={otp}
                >
                  <InputOTPGroup>
                    {[0, 1, 2, 3, 4, 5].map((index) => (
                      <InputOTPSlot
                        aria-invalid={Boolean(error)}
                        index={index}
                        key={index}
                      />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </div>

              {error && <ErrorMessage message={error} />}

              <Button
                className="w-full"
                disabled={isVerifying || otp.length !== 6}
                type="submit"
              >
                {isVerifying ? (
                  <>
                    <LoaderCircle className="animate-spin" />
                    Verifying…
                  </>
                ) : (
                  'Verify'
                )}
              </Button>

              <div className="flex justify-center gap-2">
                <Button
                  disabled={isSending}
                  onClick={() => requestOtp(sentTo)}
                  type="button"
                  variant="ghost"
                >
                  {isSending ? 'Sending…' : 'Resend code'}
                </Button>
                <Button onClick={changeEmail} type="button" variant="ghost">
                  Change email
                </Button>
              </div>
            </form>
          ) : (
            <form className="grid gap-5" onSubmit={handleEmailSubmit}>
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  autoComplete="email"
                  autoFocus
                  id="email"
                  inputMode="email"
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  type="email"
                  value={email}
                />
              </div>

              {error && <ErrorMessage message={error} />}

              <Button className="w-full" disabled={isSending} type="submit">
                {isSending ? (
                  <>
                    <LoaderCircle className="animate-spin" />
                    Sending…
                  </>
                ) : (
                  'Send code'
                )}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  )
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <p aria-live="polite" className="text-sm text-destructive" role="alert">
      {message}
    </p>
  )
}
