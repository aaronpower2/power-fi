"use client"

import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"

import { AppSidebar } from "@/components/app-sidebar"

export function DashboardShell({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <SidebarProvider className="h-dvh max-h-dvh min-h-0 overflow-hidden">
      <AppSidebar />
      <SidebarInset className="min-h-0 overflow-hidden">
        <header className="flex h-14 shrink-0 items-center px-4">
          <SidebarTrigger className="-ml-1" />
        </header>
        <div className="bg-background flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden overscroll-y-contain p-4 md:p-6">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
