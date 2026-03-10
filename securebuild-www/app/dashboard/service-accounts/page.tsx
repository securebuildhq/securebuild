'use client';

import { useEffect, useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PlusCircle, Copy, Check } from 'lucide-react';
import { Team } from '@/lib/types/team';
import { useSession } from '@/app/hooks/use-session';
import { getTeamAction } from '@/lib/team/actions/get-team';
import { ServiceAccount, ServiceAccountWithValue } from '@/lib/types/service-account';
import { listServiceAccountsAction } from '@/lib/team/actions/list-service-accounts';
import { createServiceAccountAction } from '@/lib/team/actions/create-service-account';
import { ServiceAccountRow } from '@/app/components/ServiceAccountRow';
import { renameServiceAccountAction } from '@/lib/team/actions/rename-service-account';
import { rotateServiceAccountAction } from '@/lib/team/actions/rotate-service-account';
import { deleteServiceAccountAction } from '@/lib/team/actions/delete-service-account';
import { useToast } from '@/hooks/use-toast';


export default function PullSecretsPage() {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newSecretName, setNewSecretName] = useState('');
  const [newSecretExpiresIn, setNewSecretExpiresIn] = useState('30 days');
  const [team, setTeam] = useState<Team | null>(null)
  const { session } = useSession();
  const { toast } = useToast();
  const [usernameCopied, setUsernameCopied] = useState(false);
  const usernameTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [serviceAccounts, setServiceAccounts] = useState<ServiceAccount[]>([]);
  const [serviceAccountsWithValues, setServiceAccountsWithValues] = useState<ServiceAccountWithValue[]>([]);
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false);
  const [serviceAccountToRename, setServiceAccountToRename] = useState<ServiceAccount | ServiceAccountWithValue | null>(null);
  const [newAccountName, setNewAccountName] = useState('');
  const [isRotateDialogOpen, setIsRotateDialogOpen] = useState(false);
  const [serviceAccountToRotate, setServiceAccountToRotate] = useState<ServiceAccount | ServiceAccountWithValue | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [serviceAccountToDelete, setServiceAccountToDelete] = useState<ServiceAccount | ServiceAccountWithValue | null>(null);

  useEffect(() => {
    if (!session) {
      return;
    }

    const fetchTeam = async () => {
      const team = await getTeamAction(session)
      setTeam(team)
    }

    const fetchServiceAccounts = async () => {
      const serviceAccounts = await listServiceAccountsAction(session)
      setServiceAccounts(serviceAccounts)
    }

    fetchTeam()
    fetchServiceAccounts()
  }, [session])

  useEffect(() => {
    return () => {
      if (usernameTimeoutRef.current) {
        clearTimeout(usernameTimeoutRef.current);
      }
    };
  }, []);

  const openRenameDialog = (serviceAccount: ServiceAccount | ServiceAccountWithValue) => {
    setServiceAccountToRename(serviceAccount);
    setNewAccountName(serviceAccount.name);
    setIsRenameDialogOpen(true);
  };

  const openRotateDialog = (serviceAccount: ServiceAccount | ServiceAccountWithValue) => {
    setServiceAccountToRotate(serviceAccount);
    setIsRotateDialogOpen(true);
  };

  const openDeleteDialog = (serviceAccount: ServiceAccount | ServiceAccountWithValue) => {
    setServiceAccountToDelete(serviceAccount);
    setIsDeleteDialogOpen(true);
  };

  const handleCopyUsername = () => {
    if (!team || !team.registryUsername) {
      return;
    }
    navigator.clipboard.writeText(team.registryUsername).then(() => {
      toast({ title: 'Copied to clipboard' });
      setUsernameCopied(true);
      if (usernameTimeoutRef.current) {
        clearTimeout(usernameTimeoutRef.current);
      }
      usernameTimeoutRef.current = setTimeout(() => setUsernameCopied(false), 2000);
    }).catch(err => {
      console.error('Failed to copy username: ', err);
      toast({ title: 'Failed to copy username', variant: 'destructive' });
    });
  };

  const handleCreateSecret = async () => {
    if (!newSecretName.trim()) {
      alert('Secret name cannot be empty.');
      return;
    }

    if (!session) {
      alert('Session not found. Please try again.');
      return;
    }

    try {
      const newServiceAccountWithValue = await createServiceAccountAction(session, newSecretName, newSecretExpiresIn);
      setServiceAccountsWithValues(prevAccounts => [...prevAccounts, newServiceAccountWithValue]);
      setNewSecretName('');
      setNewSecretExpiresIn('30 days');
      setIsCreateDialogOpen(false);
    } catch (error) {
      console.error('Failed to create secret:', error);
      alert('Failed to create secret. Please try again.');
    }
  };

  const handleDeleteSecret = async () => {
    if (!session || !serviceAccountToDelete) {
      alert('Something went wrong.');
      return;
    }

    try {
      await deleteServiceAccountAction(session, serviceAccountToDelete.id);

      setServiceAccounts(prev => prev.filter(sa => sa.id !== serviceAccountToDelete.id));
      setServiceAccountsWithValues(prev => prev.filter(sa => sa.id !== serviceAccountToDelete.id));

      setIsDeleteDialogOpen(false);
      setServiceAccountToDelete(null);
    } catch (error) {
      console.error('Failed to delete secret:', error);
      alert('Failed to delete secret. Please try again.');
    }
  };

  const handleRotateSecret = async () => {
    if (!session || !serviceAccountToRotate) {
      alert('Something went wrong.');
      return;
    }

    try {
      const newServiceAccountWithValue = await rotateServiceAccountAction(session, serviceAccountToRotate.id);

      // Remove the old service account from both lists
      setServiceAccounts(prev => prev.filter(sa => sa.id !== serviceAccountToRotate.id));
      setServiceAccountsWithValues(prev => prev.filter(sa => sa.id !== serviceAccountToRotate.id));

      // Add the new one (with the value) to the list of accounts with values
      setServiceAccountsWithValues(prev => [newServiceAccountWithValue, ...prev]);

      setIsRotateDialogOpen(false);
      setServiceAccountToRotate(null);
    } catch (error) {
      console.error('Failed to rotate secret:', error);
      alert('Failed to rotate secret. Please try again.');
    }
  };

  const handleRenameServiceAccount = async () => {
    if (!session || !serviceAccountToRename || !newAccountName.trim()) {
      alert('Something went wrong.');
      return;
    }

    try {
      await renameServiceAccountAction(session, serviceAccountToRename.id, newAccountName);

      const updatedServiceAccounts = serviceAccounts.map(sa =>
        sa.id === serviceAccountToRename.id ? { ...sa, name: newAccountName } : sa
      );
      setServiceAccounts(updatedServiceAccounts);

      const updatedServiceAccountsWithValues = serviceAccountsWithValues.map(sa =>
        sa.id === serviceAccountToRename.id ? { ...sa, name: newAccountName } : sa
      );
      setServiceAccountsWithValues(updatedServiceAccountsWithValues);

      setIsRenameDialogOpen(false);
      setServiceAccountToRename(null);
      setNewAccountName('');
    } catch (error) {
      console.error('Failed to rename secret:', error);
      alert('Failed to rename secret. Please try again.');
    }
  };

  if (!team) {
    return <div>Loading...</div>
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <div className="space-y-8">
        {/* Header Section */}
        <div className="space-y-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Service Accounts</h1>
            <p className="text-muted-foreground mt-2 max-w-3xl">
              Use the following credentials and instructions to access your subscribed images programmatically, such as in CI/CD pipelines or Kubernetes deployments.
            </p>
          </div>
        </div>

        {/* Registry Username Section */}
        <div className="bg-muted/50 rounded-lg p-6 border">
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold mb-2">Registry Credentials</h2>
              <p className="text-sm text-muted-foreground">
                Your auto-generated registry username for authenticating with the container registry.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="username" className="text-sm font-medium">
                Registry Username
              </Label>
              <div className="flex items-center space-x-2 max-w-md">
                <Input
                  id="username"
                  type="text"
                  value={team?.registryUsername}
                  readOnly
                  className="bg-background"
                />
                <Button variant="outline" size="icon" onClick={handleCopyUsername}>
                  {usernameCopied ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  <span className="sr-only">Copy Username</span>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                This username is automatically generated based on your team.
              </p>
            </div>
          </div>
        </div>

        {/* Service Accounts Section */}
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">Access Tokens</h2>
              <p className="text-muted-foreground text-sm mt-1">
                Manage your service account tokens for programmatic access.
              </p>
            </div>
            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <PlusCircle className="mr-2 h-4 w-4" /> Create Token
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                  <DialogTitle>Create New Access Token</DialogTitle>
                  <DialogDescription>
                    Enter a name and select an expiration for your new access token.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="secret-name" className="text-right">
                      Name
                    </Label>
                    <Input
                      id="secret-name"
                      value={newSecretName}
                      onChange={(e) => setNewSecretName(e.target.value)}
                      className="col-span-3"
                      placeholder="e.g., production-ci-token"
                    />
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="secret-expires" className="text-right">
                      Expires In
                    </Label>
                    <Select value={newSecretExpiresIn} onValueChange={setNewSecretExpiresIn}>
                      <SelectTrigger className="col-span-3">
                        <SelectValue placeholder="Select expiration" />
                      </SelectTrigger>
                      <SelectContent id="secret-expires">
                        <SelectItem value="7 days">7 days</SelectItem>
                        <SelectItem value="30 days">30 days</SelectItem>
                        <SelectItem value="90 days">90 days</SelectItem>
                        <SelectItem value="never">Never</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => {
                    setIsCreateDialogOpen(false);
                    setNewSecretName('');
                    setNewSecretExpiresIn('30 days');
                  }}>Cancel</Button>
                  <Button type="submit" onClick={handleCreateSecret}>Create Token</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={isRenameDialogOpen} onOpenChange={setIsRenameDialogOpen}>
              <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                  <DialogTitle>Rename Access Token</DialogTitle>
                  <DialogDescription>
                    Enter a new name for the access token.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="new-secret-name" className="text-right">
                      New Name
                    </Label>
                    <Input
                      id="new-secret-name"
                      value={newAccountName}
                      onChange={(e) => setNewAccountName(e.target.value)}
                      className="col-span-3"
                      placeholder="e.g., production-ci-token"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => {
                    setIsRenameDialogOpen(false);
                    setServiceAccountToRename(null);
                    setNewAccountName('');
                  }}>Cancel</Button>
                  <Button type="submit" onClick={handleRenameServiceAccount}>Rename Token</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={isRotateDialogOpen} onOpenChange={setIsRotateDialogOpen}>
              <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                  <DialogTitle>Rotate Access Token?</DialogTitle>
                  <DialogDescription>
                    Are you sure you want to rotate &quot;{serviceAccountToRotate?.name}&quot;? The current token will be
                    immediately invalidated, which may cause existing applications using it to fail.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsRotateDialogOpen(false)}>Cancel</Button>
                  <Button type="submit" onClick={handleRotateSecret}>Yes, Rotate Token</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
              <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                  <DialogTitle>Delete Access Token?</DialogTitle>
                  <DialogDescription>
                    Are you sure you want to delete this access token? This action is irreversible and will permanently remove the token.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>Cancel</Button>
                  <Button type="submit" variant="destructive" onClick={handleDeleteSecret}>Yes, Delete Token</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {/* Table Section */}
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Token</TableHead>
                  <TableHead>Last Active</TableHead>
                  <TableHead>Expires On</TableHead>
                  <TableHead>Created At</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {serviceAccountsWithValues.map((serviceAccountWithValue) => (
                  <ServiceAccountRow key={serviceAccountWithValue.id} serviceAccount={serviceAccountWithValue} handleRenameSecret={openRenameDialog} handleRotateSecret={openRotateDialog} handleDeleteSecret={openDeleteDialog} />
                ))}
                {serviceAccounts.map((serviceAccount) => (
                  <ServiceAccountRow key={serviceAccount.id} serviceAccount={serviceAccount} handleRenameSecret={openRenameDialog} handleRotateSecret={openRotateDialog} handleDeleteSecret={openDeleteDialog} />
                ))}
              </TableBody>
            </Table>
            {(serviceAccounts.length === 0 && serviceAccountsWithValues.length === 0) && (
              <div className="text-center py-12 text-muted-foreground border-t">
                <div className="flex flex-col items-center space-y-3">
                  <PlusCircle className="h-8 w-8 text-muted-foreground/50" />
                  <div>
                    <p className="font-medium">No access tokens found</p>
                    <p className="text-sm">Get started by creating your first token!</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
