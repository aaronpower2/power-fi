"use client"

import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  PieChart,
  Wallet,
  Target,
} from "lucide-react"

import { SidebarThemeSwitcher } from "@/components/theme-switcher"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"

const nav = [
  { href: "/summary", label: "FI Summary", icon: LayoutDashboard },
  { href: "/portfolio", label: "Portfolio", icon: PieChart },
  { href: "/goal", label: "Goal", icon: Target },
  { href: "/budget", label: "Budget", icon: Wallet },
] as const

export function AppSidebar() {
  const pathname = usePathname()

  return (
    <Sidebar variant="floating" collapsible="icon">
      <SidebarHeader className="items-start px-3 py-3">
        <Link
          href="/summary"
          className="flex w-full min-w-0 items-center justify-start rounded-md pl-1 pt-1 ring-sidebar-ring outline-none focus-visible:ring-2"
        >
          <Image
            src="/FI.png"
            alt="Power F.I"
            width={172}
            height={30}
            className="h-3.5 w-auto max-w-full object-contain object-left"
            priority
            sizes="200px"
          />
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {nav.map(({ href, label, icon: Icon }) => (
                <SidebarMenuItem key={href}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === href}
                    tooltip={label}
                  >
                    <Link href={href}>
                      <Icon />
                      <span>{label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarThemeSwitcher />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
