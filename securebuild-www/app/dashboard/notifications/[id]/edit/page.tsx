import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { getNotificationWithImage } from '@/lib/notification/notification-with-image';
import EditNotificationForm from './edit-form';

export default async function EditNotificationPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();

  if (!session) {
    redirect('/login');
  }

  const { id } = await params;
  const notification = await getNotificationWithImage(id);

  if (!notification) {
    redirect('/dashboard/notifications');
  }

  // Verify the notification belongs to the user's team
  if (notification.teamId !== session.selectedTeamId) {
    redirect('/dashboard/notifications');
  }

  return <EditNotificationForm notification={notification} />;
}
