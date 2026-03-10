export interface GenerateMelangeMessage {
  id: string;
  prompt: string;
  response: string;
  createdAt: Date;
  melangeYaml?: string;
}

export interface GenerateMelange {
  id: string;
  melangeYaml: string;
  explanation: string;
  messages: GenerateMelangeMessage[];
}