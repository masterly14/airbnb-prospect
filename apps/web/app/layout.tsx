import { Geist_Mono, Inter } from "next/font/google"
import { getTheme, getThemeScript } from "@teispace/next-themes/server"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" })
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" })

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const initialTheme = await getTheme()
  const themeScript = getThemeScript({
    attribute: "class",
    defaultTheme: "dark",
    enableSystem: false,
    initialTheme: initialTheme ?? undefined,
  })

  return (
    <html
      lang="es"
      suppressHydrationWarning
      className={cn("antialiased", "font-sans", inter.variable, geistMono.variable, "dark")}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <ThemeProvider defaultTheme="dark" forcedTheme="dark">
          <TooltipProvider>
            {children}
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
