import DashboardSidebar from "../../components/dashboard-sidebar";
import DashboardHeader from "../../components/dashboard-header";
import { User } from "../../lib/types/user";

const mockUser: User = {
  id: "1",
  email: "user@example.com",
  name: "Demo User",
  imageUrl: "/placeholder-user.jpg",
  createdAt: new Date(),
  lastLoginAt: new Date(),
  lastActiveAt: new Date(),
  isAdmin: true,
};

export default function BuildersLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <DashboardHeader user={mockUser} />
      <div className="flex flex-1">
        <DashboardSidebar />
        <main className="flex-1 bg-white dark:bg-slate-900">{children}</main>
      </div>
    </div>
  );
}
