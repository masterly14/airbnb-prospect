"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { PROSPECT_ACCOUNT_MARKETS, type ProspectAccountMarket } from "@/lib/accounts/markets"

type AccountMarketSelectProps = {
  value: ProspectAccountMarket | null
  onValueChange: (market: ProspectAccountMarket) => void
  disabled?: boolean
  size?: "sm" | "default"
  placeholder?: string
}

export function AccountMarketSelect({
  value,
  onValueChange,
  disabled = false,
  size = "default",
  placeholder = "Seleccionar ciudad",
}: AccountMarketSelectProps) {
  return (
    <Select
      value={value ?? undefined}
      onValueChange={(next) => onValueChange(next as ProspectAccountMarket)}
      disabled={disabled}
    >
      <SelectTrigger size={size} className="w-[140px]">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {PROSPECT_ACCOUNT_MARKETS.map((market) => (
          <SelectItem key={market} value={market}>
            {market}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
