"use client"

import { useState, useEffect } from "react"
import Editor from "@monaco-editor/react"

interface CodeEditorProps {
  value: string
  onChange: (value: string) => void
  language?: string
  readOnly?: boolean
  height?: string
}

export function CodeEditor({
  value,
  onChange,
  language = "yaml",
  readOnly = false,
  height = "300px",
}: CodeEditorProps) {
  const [mounted, setMounted] = useState(false)

  // This ensures the editor is only rendered on the client
  useEffect(() => {
    setMounted(true)
  }, [])

  const handleEditorChange = (value: string | undefined) => {
    if (value !== undefined) {
      onChange(value)
    }
  }

  if (!mounted) {
    // Return a placeholder with the same dimensions
    return <div className="border rounded-md bg-muted/50" style={{ height }} />
  }

  return (
    <div className="border rounded-md overflow-hidden h-full">
      <Editor
        height={height}
        language={language}
        value={value}
        onChange={handleEditorChange}
        options={{
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          readOnly,
          fontSize: 14,
          wordWrap: "on",
          lineNumbers: "on",
          folding: true,
          automaticLayout: true,
        }}
        theme="vs-dark"
      />
    </div>
  )
}
