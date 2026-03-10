import { atom } from "jotai";
import { atomFamily } from "jotai/utils";

export type TestPackageStreamStep = "install-melange" | "build";

export interface TestPackageStreamStepData {
  stdout: string;
  stderr: string;
}

export interface TestPackageStreamData {
  [step: string]: TestPackageStreamStepData;
}

export const testPackageStreamAtomFamily = atomFamily<string, ReturnType<typeof atom<TestPackageStreamData>>>(
  () => atom<TestPackageStreamData>({})
);

// SSH Output Atom: key is session id, value is output string (appended)
export interface SSHOutputMap {
  [id: string]: string;
}

export const sshOutputAtom = atom<SSHOutputMap>({});
