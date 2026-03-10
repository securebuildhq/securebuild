"use server"

import { Session } from "@/lib/types/session";
import { GenerateMelange } from "@/lib/types/melange";

export async function generateMelangeAction(sess: Session, initialPrompt: string): Promise<GenerateMelange> {
  const id = Math.random().toString(36).substring(7); // Just for the type system
  return {
    id,
    melangeYaml: "",
    explanation: "AI package generation is not implemented yet",
    messages: [{
      id: Math.random().toString(36).substring(7),
      prompt: initialPrompt,
      response: "AI package generation is not implemented yet",
      createdAt: new Date()
    }]
  };
}