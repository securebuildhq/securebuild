import { atom } from "jotai";
import { atomWithStorage, createJSONStorage } from "jotai/utils";

export interface ChatMessage {
  id: string;
  prompt: string;
  response: string;
  melangeYaml: string;
}

export interface MelangeGeneration {
  id: string;
  chatHistory: ChatMessage[];
}

// Mock storage for SSR or environments where sessionStorage is not available
const mockStorage = {
  getItem: (_key: string) => null,
  setItem: (_key: string, _value: string) => {},
  removeItem: (_key: string) => {},
};

const getSessionStorageForString = () => {
  if (typeof window !== 'undefined' && window.sessionStorage) {
    return window.sessionStorage;
  }
  return mockStorage; // Fallback to mock storage
};

// Atom to store ONLY the ID in sessionStorage
export const persistedMelangeIdAtom = atomWithStorage<string | null>(
  'persistedMelangeId', // New key for ID only
  null,
  createJSONStorage(getSessionStorageForString)
);

// In-memory atom to hold the full MelangeGeneration object
export const currentMelangeGenerationAtom = atom<MelangeGeneration | null>(null);
