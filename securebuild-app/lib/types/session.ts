export interface Session {
  id: string;
  expiresAt: Date;
  user: User;
}

import { User } from "./user";
