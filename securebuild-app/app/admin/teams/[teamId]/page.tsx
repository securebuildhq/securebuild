"use client"

import { useState, useEffect } from "react"
import { useRouter, useParams } from "next/navigation"
import Link from "next/link"
import { AdminTeam, AdminTeamDetailResponse, AdminTeamUpdateRequest, AVAILABLE_FEATURE_FLAGS, FeatureFlag } from "@/lib/types/admin"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import DashboardHeader from "@/components/dashboard-header"
import { CustomBuildImages } from "@/components/team/CustomBuildImages"

interface FeatureFlagCheckboxProps {
  flag: FeatureFlag;
  checked: boolean;
  onChange: (flagKey: string, checked: boolean) => void;
  disabled: boolean;
}

function FeatureFlagCheckbox({ flag, checked, onChange, disabled }: FeatureFlagCheckboxProps) {
  return (
    <div className="flex items-start space-x-3 p-4 border rounded-lg">
      <Checkbox
        id={flag.key}
        checked={checked}
        onCheckedChange={(checked) => onChange(flag.key, checked as boolean)}
        disabled={disabled}
        className="mt-1"
      />
      <div className="flex-1">
        <label 
          htmlFor={flag.key} 
          className={`text-sm font-medium ${disabled ? 'text-gray-400' : 'text-gray-900 cursor-pointer'}`}
        >
          {flag.name}
        </label>
        <p className={`text-sm ${disabled ? 'text-gray-300' : 'text-gray-600'} mt-1`}>
          {flag.description}
        </p>
      </div>
    </div>
  );
}

export default function AdminTeamDetailPage() {
  const router = useRouter();
  const params = useParams();
  const teamId = params.teamId as string;

  const [team, setTeam] = useState<AdminTeam | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [selectedFlags, setSelectedFlags] = useState<string[]>([]);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const fetchTeam = async () => {
    setLoading(true);
    setError(null);

    try {
      const adminToken = process.env.NEXT_PUBLIC_ADMIN_TOKEN;
      if (!adminToken) {
        throw new Error("Admin token not configured");
      }

      // Call the securebuild-www API from securebuild-app
      const apiBaseUrl = process.env.NEXT_PUBLIC_WWW_API_URL || 'https://securebuild.dev';
      const response = await fetch(`${apiBaseUrl}/api/v1/admin/teams/${teamId}`, {
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error("Team not found");
        }
        throw new Error(`Failed to fetch team: ${response.status} ${response.statusText}`);
      }

      const data: AdminTeamDetailResponse = await response.json();
      setTeam(data.team);
      setSelectedFlags([...data.team.feature_flags]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setLoading(false);
    }
  };

  const saveChanges = async () => {
    if (!team) return;

    setSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const adminToken = process.env.NEXT_PUBLIC_ADMIN_TOKEN;
      if (!adminToken) {
        throw new Error("Admin token not configured");
      }

      const updateData: AdminTeamUpdateRequest = {
        feature_flags: selectedFlags
      };

      // Call the securebuild-www API from securebuild-app
      const apiBaseUrl = process.env.NEXT_PUBLIC_WWW_API_URL || 'https://securebuild.dev';
      const response = await fetch(`${apiBaseUrl}/api/v1/admin/teams/${teamId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateData)
      });

      if (!response.ok) {
        throw new Error(`Failed to update team: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      setTeam(data.team);
      setHasUnsavedChanges(false);
      setSuccessMessage("Team feature flags updated successfully!");
      
      // Clear success message after 3 seconds
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setSaving(false);
    }
  };

  const handleFlagChange = (flagKey: string, checked: boolean) => {
    setSelectedFlags(prev => {
      const newFlags = checked 
        ? [...prev.filter(f => f !== flagKey), flagKey]
        : prev.filter(f => f !== flagKey);
      
      setHasUnsavedChanges(JSON.stringify(newFlags.sort()) !== JSON.stringify(team?.feature_flags?.sort() || []));
      return newFlags;
    });
  };

  const cancelChanges = () => {
    if (team) {
      setSelectedFlags([...team.feature_flags]);
      setHasUnsavedChanges(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  useEffect(() => {
    if (teamId) {
      fetchTeam();
    }
  }, [teamId]);

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col">
        <DashboardHeader user={null} />
        <main className="flex-1">
          <div className="container mx-auto max-w-4xl px-4 py-8">
            <div className="animate-pulse">
              <div className="h-8 bg-gray-200 rounded w-1/4 mb-4"></div>
              <div className="h-4 bg-gray-200 rounded w-1/2 mb-8"></div>
              <div className="space-y-4">
                <div className="h-20 bg-gray-200 rounded"></div>
                <div className="h-20 bg-gray-200 rounded"></div>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (error && !team) {
    return (
      <div className="flex min-h-screen flex-col">
        <DashboardHeader user={null} />
        <main className="flex-1">
          <div className="container mx-auto max-w-4xl px-4 py-8">
            <div className="bg-red-50 border border-red-200 rounded-lg p-6">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-red-800">Error</h3>
                  <div className="text-sm text-red-700 mt-1">{error}</div>
                </div>
              </div>
              <div className="mt-4">
                <Link href="/admin/teams">
                  <Button variant="outline" size="sm">
                    ← Back to Teams
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (!team) {
    return null;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <DashboardHeader user={null} />
      
      <main className="flex-1">
        <div className="container mx-auto max-w-4xl px-4 py-8">
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-4">
              <Link href="/admin/teams">
                <Button variant="ghost" size="sm">
                  ← Back to Teams
                </Button>
              </Link>
            </div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">{team.name}</h1>
            <p className="text-gray-600">Manage feature flags and settings</p>
          </div>

          {/* Messages */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <div className="text-sm text-red-700">{error}</div>
                </div>
              </div>
            </div>
          )}

          {successMessage && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-green-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <div className="text-sm text-green-700">{successMessage}</div>
                </div>
              </div>
            </div>
          )}

          {/* Custom Build Images Section */}
          <div className="mb-8">
            <div className="bg-white shadow rounded-lg p-6">
              <CustomBuildImages teamId={teamId} />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Team Details */}
            <div className="lg:col-span-1">
              <div className="bg-white shadow rounded-lg p-6">
                <h2 className="text-lg font-medium text-gray-900 mb-4">Team Details</h2>
                <dl className="space-y-4">
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Team ID</dt>
                    <dd className="text-sm text-gray-900 font-mono">{team.id}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Name</dt>
                    <dd className="text-sm text-gray-900">{team.name}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Created</dt>
                    <dd className="text-sm text-gray-900">{formatDate(team.created_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Service Accounts</dt>
                    <dd className="text-sm text-gray-900">
                      <Badge variant="secondary">{team.service_account_count}</Badge>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Catalog Access</dt>
                    <dd className="text-sm text-gray-900">
                      <Badge variant={team.full_catalog_access ? "default" : "secondary"}>
                        {team.full_catalog_access ? "Full Access" : "Limited"}
                      </Badge>
                    </dd>
                  </div>
                  {team.registry_username && (
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Registry Username</dt>
                      <dd className="text-sm text-gray-900 font-mono">{team.registry_username}</dd>
                    </div>
                  )}
                </dl>
              </div>
            </div>

            {/* Feature Flags */}
            <div className="lg:col-span-2">
              <div className="bg-white shadow rounded-lg p-6">
                <h2 className="text-lg font-medium text-gray-900 mb-4">Feature Flags</h2>
                
                <div className="space-y-4 mb-6">
                  {AVAILABLE_FEATURE_FLAGS.map((flag) => (
                    <FeatureFlagCheckbox
                      key={flag.key}
                      flag={flag}
                      checked={selectedFlags.includes(flag.key)}
                      onChange={handleFlagChange}
                      disabled={saving}
                    />
                  ))}
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3">
                  <Button
                    onClick={saveChanges}
                    disabled={!hasUnsavedChanges || saving}
                  >
                    {saving ? "Saving..." : "Save Changes"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={cancelChanges}
                    disabled={!hasUnsavedChanges || saving}
                  >
                    Cancel
                  </Button>
                </div>

                {hasUnsavedChanges && (
                  <p className="text-sm text-amber-600 mt-2">
                    You have unsaved changes.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}