export interface User {
  id: string;
  email: string;
  name: string;
  imageUrl: string;
  createdAt: Date;
  lastLoginAt: Date;
  lastActiveAt: Date;
  isAdmin: boolean;
}
