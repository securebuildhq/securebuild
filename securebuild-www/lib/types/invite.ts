

export interface Invite {
  id: string;
  teamId: string;
  email: string;
  role: "admin" | "developer" | "viewer";
  createdAt: string;
}