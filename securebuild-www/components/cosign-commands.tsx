"use client"

import { Copy, Check } from "lucide-react"
import { buildCosignCommands } from "@/lib/cosign/commands"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"
import React from "react"

interface CosignCommandsProps {
  imageRef: string
  digest?: string
  platform?: string
  host?: string
  issuer?: string
  identity?: string
}

export function CosignCommands({ imageRef, digest, platform, host, issuer, identity }: CosignCommandsProps) {
  const { toast } = useToast()
  const cmds = buildCosignCommands({ imageRef, digest, platform, host, issuer, identity })
  const commandList = [cmds.verify, cmds.downloadAttestation, cmds.verifyAttestation]

  const [copiedIdx, setCopiedIdx] = React.useState<number | null>(null)

  const copy = async (txt: string, idx: number) => {
    await navigator.clipboard.writeText(txt)
    toast({ title: "Copied to clipboard" })
    setCopiedIdx(idx)
    setTimeout(() => setCopiedIdx(null), 2000)
  }

  return (
    <div className="space-y-4">
      {commandList.map((cmd, idx) => (
        <pre
          key={idx}
          className="relative rounded bg-muted p-3 overflow-x-auto text-sm whitespace-pre-wrap"
        >
          <Button
            size="icon"
            variant="ghost"
            className="absolute top-1 right-1"
            onClick={() => copy(cmd, idx)}
          >
            {copiedIdx === idx ? (
              <Check className="h-4 w-4 text-green-600" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
          {cmd}
        </pre>
      ))}
    </div>
  )
} 