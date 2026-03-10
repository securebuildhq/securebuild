import { atom } from "jotai";

export interface ApkoGenerateSession {
  content: string;
  isComplete: boolean;
}

export interface ApkoGenerateSessionsMap {
  [id: string]: ApkoGenerateSession;
}

export const apkoGenerateSessionsAtom = atom<ApkoGenerateSessionsMap>({});
