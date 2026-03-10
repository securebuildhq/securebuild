"use client"

import { useState, useEffect, useRef, useMemo } from "react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { CheckCircle2, ChevronDown, ChevronRight } from "lucide-react"
import { useAtomValue } from "jotai"
import { testPackageStreamAtomFamily } from "../app/state/test-package-stream-atoms"

interface TerminalModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  testId: string
}

function TerminalWindow({ title, lines, collapsed, onToggle }: { title: string; lines: { line: string; type: "stdout" | "stderr" }[]; collapsed: boolean; onToggle?: () => void }) {
  const terminalRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!collapsed && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight
    }
  }, [lines, collapsed])
  return (
    <div className="mb-4 border rounded-md bg-black">
      <div className="flex items-center px-4 py-2 border-b bg-gray-900 rounded-t-md select-none cursor-pointer" onClick={onToggle}>
        {onToggle && (
          <span className="mr-2">
            {collapsed ? <ChevronRight className="inline w-4 h-4" /> : <ChevronDown className="inline w-4 h-4" />}
          </span>
        )}
        <span className="font-bold text-white text-sm">{title}</span>
      </div>
      {!collapsed && (
        <div
          ref={terminalRef}
          className="flex-1 text-green-400 font-mono text-sm p-4 rounded-b-md overflow-y-auto"
          style={{ minHeight: "200px", maxHeight: "40vh" }}
        >
          {lines.length === 0 && <div className="text-gray-500">No output yet...</div>}
          {lines.map(({ line, type }, index) => (
            <div
              key={type + "-" + index}
              className={
                "whitespace-pre-wrap " +
                (type === "stderr"
                  ? /error|failed|exception|not found|denied|cannot|no such/i.test(line)
                    ? "text-red-400"
                    : "text-gray-300"
                  : "text-green-400")
              }
            >
              <span className="text-gray-500">$</span> {line}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function TerminalModal({ isOpen, onClose, title, testId }: TerminalModalProps) {
  const terminalRef = useRef<HTMLDivElement>(null)

  // Subscribe to the atom for this testId
  const testPackageData = useAtomValue(testPackageStreamAtomFamily(testId))
  const buildStdout = testPackageData?.["build"]?.stdout || ""
  const buildStderr = testPackageData?.["build"]?.stderr || ""

  const buildLines = useMemo(() => {
    const outLines = buildStdout.split("\n").map((line) => ({ line, type: "stdout" as const }));
    const errLines = buildStderr.split("\n").map((line) => ({ line, type: "stderr" as const }));
    const merged: { line: string; type: "stdout" | "stderr" }[] = [];
    const maxLen = Math.max(outLines.length, errLines.length);
    for (let i = 0; i < maxLen; i++) {
      if (outLines[i] && outLines[i].line) merged.push(outLines[i]);
      if (errLines[i] && errLines[i].line) merged.push(errLines[i]);
    }
    return merged;
  }, [buildStdout, buildStderr]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[1400px] w-[98vw] max-h-[98vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <TerminalWindow
          title="Build Output"
          lines={buildLines}
          collapsed={false}
        />
        <DialogFooter className="flex justify-between items-center">
          <div className="mr-auto"></div>
          <Button onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
