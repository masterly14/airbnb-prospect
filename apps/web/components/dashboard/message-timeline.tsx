import { Message, MessageDirection } from "@/lib/leads/types"
import { cn } from "@/lib/utils"

export function MessageTimeline({ messages }: { messages: Message[] }) {
  if (messages.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-white/5 text-sm text-muted-foreground">
        Sin mensajes en el hilo.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {messages.map((msg) => {
        const isOutbound = msg.direction === MessageDirection.OUTBOUND
        const isSystem = msg.direction === MessageDirection.SYSTEM

        if (isSystem) {
          return (
            <div key={msg.id} className="flex justify-center my-2">
              <div className="bg-white/5 text-[11px] px-3 py-1 rounded-full text-muted-foreground">
                {msg.content}
              </div>
            </div>
          )
        }

        return (
          <div
            key={msg.id}
            className={cn(
              "flex flex-col max-w-[85%]",
              isOutbound ? "self-end items-end" : "self-start items-start"
            )}
          >
            <div
              className={cn(
                "rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed",
                isOutbound 
                  ? "bg-primary text-primary-foreground rounded-br-sm" 
                  : "bg-card/50 border border-white/5 text-foreground rounded-bl-sm"
              )}
            >
              {msg.content}
            </div>
            <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground px-1">
              <span>{msg.sentAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              {msg.aiIntent && (
                <span className="bg-white/5 px-1.5 py-0.5 rounded text-[9px]">{msg.aiIntent}</span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
