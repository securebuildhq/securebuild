

import { getServerSession } from "@/lib/auth/server-session";


export async function validatePublicRepoAction(repo: string): Promise<boolean> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  // Parse repo string to get owner and name
  let owner = "";
  let name = "";

  // Remove protocol and domain if present
  repo = repo.trim();
  if (repo.startsWith("http://") || repo.startsWith("https://")) {
    try {
      const url = new URL(repo);
      // /owner/name or /owner/name.git
      const parts = url.pathname.replace(/\/+$/, "").replace(/\.git$/, "").split("/").filter(Boolean);
      if (parts.length >= 2) {
        owner = parts[0];
        name = parts[1];
      }
    } catch (e) {
      return false;
    }
  } else {
    // owner/name or owner/name.git
    const parts = repo.replace(/\.git$/, "").split("/").filter(Boolean);
    if (parts.length === 2) {
      owner = parts[0];
      name = parts[1];
    }
  }

  if (!owner || !name) {
    return false;
  }

  // Validate repo exists using GitHub API
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${name}`);
    if (res.status === 200) {
      return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}
