"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { LayoutDashboard, BarChart3 } from "lucide-react"

export function GlobalCommandPalette() {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((open) => !open)
      }
    }
    document.addEventListener("keydown", down)
    return () => document.removeEventListener("keydown", down)
  }, [])

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Buscar leads, acciones o páginas..." />
      <CommandList>
        <CommandEmpty>No se encontraron resultados.</CommandEmpty>
        <CommandGroup heading="Navegación">
          <CommandItem onSelect={() => { router.push("/pipeline"); setOpen(false) }}>
            <LayoutDashboard className="mr-2 h-4 w-4" />
            <span>Ir a Pipeline</span>
          </CommandItem>
          <CommandItem onSelect={() => { router.push("/metrics"); setOpen(false) }}>
            <BarChart3 className="mr-2 h-4 w-4" />
            <span>Ir a Métricas</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
