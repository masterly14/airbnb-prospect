"use client"

import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { AppSidebar } from "./app-sidebar"
import { AlertsBanner } from "./alerts-banner"
import { GlobalCommandPalette } from "./global-command-palette"

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="flex flex-col min-h-svh bg-background overflow-hidden">
        <AlertsBanner />
        <GlobalCommandPalette />
        {children}
      </SidebarInset>
    </SidebarProvider>
  )
}


