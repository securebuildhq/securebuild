export interface Session {
  id: string;
  expiresAt: Date;
  user: User;
  teams: Team[];
  godModeTeams: Team[];
  selectedTeamId: string;
}

import { Team } from "./team";
import { User } from "./user";
