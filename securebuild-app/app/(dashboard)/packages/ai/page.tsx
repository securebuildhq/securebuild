"use client"

import { useState, useEffect } from "react"

import { useSession } from "@/app/hooks/use-session"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { CodeEditor } from "@/components/code-editor"
import { TerminalModal } from "@/components/terminal-modal"
import { useAtom } from "jotai"
import {
  persistedMelangeIdAtom,
  currentMelangeGenerationAtom,
  type MelangeGeneration,
  type ChatMessage as AtomChatMessage
} from "../../../state/melange-generation-atom"
import { generateMelangeAction } from "@/lib/package/actions/generate-melange"
import { getGenerateMelangeAction } from "@/lib/package/actions/get-generate-melange"
import { type GenerateMelangeMessage } from "@/lib/types/melange"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

export default function AIPackagePage() {
  const { session, isSessionLoading } = useSession()
  const [chatMessages, setChatMessages] = useState<{ sender: string, text: string }[]>([])
  const [userInput, setUserInput] = useState("")
  const [melangeYaml, setMelangeYaml] = useState("")
  const [isLoadingPersistedChat, setIsLoadingPersistedChat] = useState(false)

  const [persistedId, setPersistedId] = useAtom(persistedMelangeIdAtom)
  const [currentGeneration, setCurrentGeneration] = useAtom(currentMelangeGenerationAtom)

  // State for the test modal
  const [isTestModalOpen, setIsTestModalOpen] = useState(false)
  const [currentTestId, setCurrentTestId] = useState("")
  // TODO: Add error state for test failures: const [testError, setTestError] = useState<string | null>(null)

  // Effect to load persisted chat history if an ID is found in sessionStorage
  useEffect(() => {
    const loadPersistedChat = async () => {
      if (session && persistedId && !currentGeneration) {
        console.log("loadPersistedChat: Found persistedId", persistedId);
        setIsLoadingPersistedChat(true)
        try {
          const persistedData = await getGenerateMelangeAction(persistedId)
          if (persistedData) {
            const newAtomChatHistory: AtomChatMessage[] = (persistedData.messages as GenerateMelangeMessage[]).map(msg => ({
              id: msg.id,
              prompt: msg.prompt,
              response: msg.response,
              melangeYaml: msg.melangeYaml || "",
            }));
            setCurrentGeneration({
              id: persistedData.id,
              chatHistory: newAtomChatHistory,
            })
          } else {
            // If data is not found for the ID, clear the persisted ID
            console.warn("No data found for persisted ID, clearing it:", persistedId)
            setPersistedId(null)
            setCurrentGeneration(null) // Also clear current generation state
          }
        } catch (error) {
          console.error("Failed to load persisted Melange generation data:", error)
          setPersistedId(null) // Clear persisted ID on error to prevent re-fetch loops
          setCurrentGeneration(null)
        } finally {
          setIsLoadingPersistedChat(false)
        }
      }
    }
    loadPersistedChat()
  }, [session, persistedId, currentGeneration, setCurrentGeneration, setPersistedId])

  // Effect to update local UI state (chatMessages, melangeYaml) when currentGeneration (in-memory atom) changes
  useEffect(() => {
    if (currentGeneration && currentGeneration.chatHistory.length > 0) {
      const newChatMessages: { sender: string, text: string }[] = []
      currentGeneration.chatHistory.forEach(chatItem => {
        newChatMessages.push({ sender: "user", text: chatItem.prompt })
        newChatMessages.push({ sender: "ai", text: chatItem.response })
      })
      setChatMessages(newChatMessages)

      const latestMessage = currentGeneration.chatHistory[currentGeneration.chatHistory.length - 1]
      setMelangeYaml(latestMessage.melangeYaml || "")
    } else {
      setChatMessages([])
      setMelangeYaml("")
    }
  }, [currentGeneration])

  if (isSessionLoading || !session?.user) {
    return <div>Loading...</div>
  }

  const handleStartOverConfirm = () => {
    setPersistedId(null)
    setCurrentGeneration(null)
    // setUserInput(""); // No longer needed here, handled by useEffect on currentGeneration
    // The useEffect hook listening to currentGeneration will clear chatMessages and melangeYaml.
    console.log("Session started over.")
  }

  const handleSendMessage = async () => {
    if (userInput.trim() === "" || !session) return

    if (!currentGeneration) {
      // First message, generate new session and set the atoms
      try {
        setChatMessages(prev => [...prev, { sender: "user", text: userInput }])
        setChatMessages(prev => [...prev, { sender: "ai", text: "Generating initial configuration..." }])

        const result = await generateMelangeAction(userInput)

        const newAtomChatHistory: AtomChatMessage[] = (result.messages as GenerateMelangeMessage[]).map(msg => ({
          id: msg.id,
          prompt: msg.prompt,
          response: msg.response,
          melangeYaml: msg.melangeYaml || "",
        }));

        setCurrentGeneration({
          id: result.id,
          chatHistory: newAtomChatHistory,
        })
        setPersistedId(result.id) // Persist the new ID
        setUserInput("")
      } catch (error) {
        console.error("Failed to generate Melange configuration:", error)
        setChatMessages(prev => prev.slice(0, -2))
        setChatMessages(prev => [...prev, { sender: "ai", text: "Error generating configuration. Please try again." }])
      }
    } else {
      // Subsequent messages for an existing session.
      // TODO: Implement an action to *append* to an existing melange generation session.
      // For now, just update local chat UI.
      setChatMessages(prev => [...prev, { sender: "user", text: userInput }])
      setChatMessages(prev => [...prev, { sender: "ai", text: "Processing your follow-up request... (Note: follow-up not fully implemented)" }])
      setUserInput("")
    }
  }

  return (
    <div className="flex flex-1 flex-col p-6 overflow-hidden">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">AI Package Authoring</h1>
        <p className="text-muted-foreground">
          Use AI to help you create a Melange YAML configuration.
        </p>
      </div>
      {isLoadingPersistedChat && (
        <div className="text-center p-4">Loading previous session...</div>
      )}
      <div className={`flex flex-1 gap-6 overflow-hidden ${isLoadingPersistedChat ? 'opacity-50' : ''}`}>
        {/* Left Column: Chat Interface */}
        <div className="flex flex-1 flex-col border rounded-lg p-4">
          <div className="flex flex-col flex-1 space-y-4 overflow-y-auto mb-4">
            {chatMessages.map((msg, index) => (
              <div
                key={index}
                className={`p-2 rounded-lg ${
                  msg.sender === "user" ? "bg-blue-500 text-white self-end" : "bg-muted self-start"
                }`}
                style={{
                  maxWidth: "80%",
                  alignSelf: msg.sender === "user" ? "flex-end" : "flex-start",
                }}
              >
                {msg.text}
              </div>
            ))}
            {chatMessages.length === 0 && !isLoadingPersistedChat && (
              <p className="text-muted-foreground text-center">
                Start by typing your package requirements below.
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Input
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              placeholder="Describe the package you want to build..."
              onKeyPress={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
            />
            <Button onClick={handleSendMessage}>Send</Button>
          </div>
        </div>

        {/* Right Column: Monaco Editor & Toolbar */}
        <div className="flex flex-1 flex-col">
          <div className="mb-2 flex justify-end space-x-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" disabled={!currentGeneration || isLoadingPersistedChat}>
                  Start Over
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Are you sure you want to start over?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will clear your current AI-generated Melange configuration and chat history.
                    You will lose any unsaved progress.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleStartOverConfirm}>Confirm</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
          <div className="flex-1 min-h-0 border rounded-lg overflow-hidden">
            <CodeEditor
              value={melangeYaml}
              onChange={setMelangeYaml}
              language="yaml"
              height="100%"
            />
          </div>
        </div>
      </div>
      <TerminalModal
        isOpen={isTestModalOpen}
        testId={currentTestId}
        onClose={() => setIsTestModalOpen(false)}
        title="Testing AI Generated Package"
      />
      {/* TODO: Add an error display modal/toast based on testError state */}
    </div>
  )
}
