import { AppShell } from "@/components/dashboard/app-shell"
import { Metadata } from "next"

export const metadata: Metadata = {
  title: "Agent Pilot CRM",
  description: "Dashboard de prospección Airbnb",
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <AppShell>{children}</AppShell>
}
