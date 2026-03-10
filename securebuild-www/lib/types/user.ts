
export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  picture: string;
  createdAt: Date;
  lastLoginAt: Date;
  lastActiveAt: Date;
  hostedDomain: string;
  roles: 'admin' | 'developer' | 'viewer';
}
