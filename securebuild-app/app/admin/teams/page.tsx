"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { AdminTeam, AdminTeamsListResponse, AVAILABLE_FEATURE_FLAGS } from "@/lib/types/admin"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import DashboardHeader from "@/components/dashboard-header"

interface TeamRowProps {
  team: AdminTeam;
}

function TeamRow({ team }: TeamRowProps) {
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const getFeatureFlagName = (flagKey: string) => {
    const flag = AVAILABLE_FEATURE_FLAGS.find(f => f.key === flagKey);
    return flag?.name || flagKey;
  };

  return (
    <tr className="border-b hover:bg-gray-50">
      <td className="px-4 py-3">
        <div className="font-medium text-gray-900">{team.name}</div>
        <div className="text-sm text-gray-500">{team.id}</div>
      </td>
      <td className="px-4 py-3 text-sm text-gray-700">
        {formatDate(team.created_at)}
      </td>
      <td className="px-4 py-3 text-center">
        <Badge variant="secondary">{team.service_account_count}</Badge>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {team.feature_flags.length > 0 ? (
            team.feature_flags.map((flag) => (
              <Badge key={flag} variant="outline" className="text-xs">
                {getFeatureFlagName(flag)}
              </Badge>
            ))
          ) : (
            <span className="text-sm text-gray-400">No flags</span>
          )}
        </div>
      </td>
      <td className="px-4 py-3">
        <Link href={`/admin/teams/${team.id}`}>
          <Button variant="outline" size="sm">
            Edit
          </Button>
        </Link>
      </td>
    </tr>
  );
}

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

function Pagination({ currentPage, totalPages, onPageChange }: PaginationProps) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between">
      <div className="text-sm text-gray-700">
        Page {currentPage} of {totalPages}
      </div>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

export default function AdminTeamsPage() {
  const [teams, setTeams] = useState<AdminTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const fetchTeams = async (page: number = 1, search: string = "") => {
    setLoading(true);
    setError(null);

    try {
      const adminToken = process.env.NEXT_PUBLIC_ADMIN_TOKEN;
      if (!adminToken) {
        throw new Error("Admin token not configured");
      }

      // Call the securebuild-www API from securebuild-app
      const apiBaseUrl = process.env.NEXT_PUBLIC_WWW_API_URL || 'https://securebuild.dev';
      const url = new URL(`${apiBaseUrl}/api/v1/admin/teams`);
      url.searchParams.set('page', page.toString());
      url.searchParams.set('limit', '20');
      if (search.trim()) {
        url.searchParams.set('search', search.trim());
      }

      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch teams: ${response.status} ${response.statusText}`);
      }

      const data: AdminTeamsListResponse = await response.json();
      setTeams(data.teams);
      setCurrentPage(data.pagination.page);
      setTotalPages(data.pagination.total_pages);
      setTotal(data.pagination.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTeams(1, searchQuery);
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setCurrentPage(1);
    fetchTeams(1, searchQuery);
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    fetchTeams(page, searchQuery);
  };

  return (
    <div className="flex min-h-screen flex-col">
      <DashboardHeader user={null} />
      
      <main className="flex-1">
        <div className="container mx-auto max-w-7xl px-4 py-8">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Admin - Teams</h1>
            <p className="text-gray-600">Manage team feature flags and settings</p>
          </div>

          {/* Search */}
          <form onSubmit={handleSearch} className="mb-6">
            <div className="flex gap-2 max-w-md">
              <Input
                type="text"
                placeholder="Search teams..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <Button type="submit" variant="outline">
                Search
              </Button>
            </div>
          </form>

          {/* Content */}
          {loading && (
            <div className="text-center py-8">
              <div className="animate-pulse">Loading teams...</div>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
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
            </div>
          )}

          {!loading && !error && (
            <>
              {/* Stats */}
              <div className="mb-6">
                <div className="text-sm text-gray-600">
                  Showing {teams.length} of {total} teams
                </div>
              </div>

              {/* Teams Table */}
              <div className="bg-white shadow overflow-hidden sm:rounded-lg">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Team
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Created
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Service Accounts
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Feature Flags
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {teams.length > 0 ? (
                      teams.map((team) => (
                        <TeamRow key={team.id} team={team} />
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                          {searchQuery.trim() ? 'No teams found matching your search.' : 'No teams found.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="mt-6">
                <Pagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onPageChange={handlePageChange}
                />
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}