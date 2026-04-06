import Image from "next/image"
import { redirect } from "next/navigation"

import { LoginForm } from "@/app/login/login-form"
import { cn } from "@/lib/utils"

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const sitePassword = process.env.SITE_PASSWORD?.trim()
  if (!sitePassword) {
    redirect("/summary")
  }

  const authSecretMissing = !process.env.SITE_AUTH_SECRET?.trim()

  const { next: nextParam } = await searchParams
  const nextPath =
    typeof nextParam === "string" && nextParam.startsWith("/") && !nextParam.startsWith("//")
      ? nextParam
      : "/summary"

  return (
    <div
      className={cn(
        "bg-background flex min-h-dvh flex-col items-center justify-center p-6",
      )}
    >
      <div className="border-border bg-card w-full max-w-sm rounded-xl border p-8 shadow-sm">
        <div className="mb-8 flex flex-col items-center gap-2">
          <Image
            src="/FI.png"
            alt="Power F.I"
            width={200}
            height={36}
            className="h-9 w-auto object-contain"
            priority
          />
          <p className="text-muted-foreground text-center text-sm">
            Enter the shared password to open your workspace.
          </p>
        </div>
        {authSecretMissing ? (
          <p className="text-destructive mb-4 text-sm" role="alert">
            Set <code className="font-mono text-xs">SITE_AUTH_SECRET</code> next to{" "}
            <code className="font-mono text-xs">SITE_PASSWORD</code> in your environment.
          </p>
        ) : null}
        <LoginForm nextPath={nextPath} />
      </div>
    </div>
  )
}
