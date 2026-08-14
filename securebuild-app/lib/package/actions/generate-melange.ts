"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { GenerateMelange } from "@/lib/types/melange";

export async function generateMelangeAction(initialPrompt: string): Promise<GenerateMelange> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

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