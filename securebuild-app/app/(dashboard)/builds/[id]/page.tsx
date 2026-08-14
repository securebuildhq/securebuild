"use client"

import { useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSession } from '@/app/hooks/use-session';
import { getImageBuildAction } from '@/lib/image/actions/get-image-build';
import { ImageBuild } from '@/lib/types/image';
import { RefreshCw, Copy, Tag } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export default function BuildDetailPage() {
  const { session, isSessionLoading } = useSession();
  const user = session?.user;
  const params = useParams();
  const id = params?.id as string | undefined;

  const [build, setBuild] = useState<ImageBuild | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Refs for each log type
  const builderRef = useRef<HTMLPreElement>(null);
  const apkoStdoutRef = useRef<HTMLPreElement>(null);
  const apkoStderrRef = useRef<HTMLPreElement>(null);
  const grypeAarch64Ref = useRef<HTMLPreElement>(null);
  const grypeX86_64Ref = useRef<HTMLPreElement>(null);
  const grypeAlternateAarch64Ref = useRef<HTMLPreElement>(null);
  const grypeAlternateX86_64Ref = useRef<HTMLPreElement>(null);


  // Ref to store the interval ID for cleanup
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Function to fetch build data
  const fetchBuild = async () => {
    if (!id || !session) return;

    try {
      const data = await getImageBuildAction(id);
      if (data) {
        setBuild(data);
        setError(null);
      } else {
        setError('Build not found.');
      }
    } catch (err: any) {
      console.error('Failed to fetch build details:', err);
      setError('Failed to load build details.');
    }
  };

  useEffect(() => {
    if (id && session) {
      setLoading(true);
      fetchBuild().finally(() => {
        setLoading(false);
      });
    } else if (!isSessionLoading && !session) {
      setLoading(false);
      setError("Please log in to view build details.");
    } else if (!id && !isSessionLoading && session) {
      setLoading(false);
      setError("Build ID is missing.");
    }
  }, [id, session, isSessionLoading, refreshKey]);

  // Set up auto-refresh interval for building status
  useEffect(() => {
    if (!id || !session || loading || error) {
      return;
    }

    const shouldAutoRefresh = build && (
      build.status === 'building' ||
      build.status === 'queued' ||
      build.status === 'pending'
    );

    if (shouldAutoRefresh) {
      intervalRef.current = setInterval(() => {
        fetchBuild();
      }, 5000);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [id, session, loading, error, build?.status]);

  const formatDuration = (start: Date | string, end: Date | string): string => {
    const startDate = new Date(start);
    const endDate = new Date(end);
    const diffMs = endDate.getTime() - startDate.getTime();

    if (diffMs < 0) return 'N/A';

    const seconds = Math.floor((diffMs / 1000) % 60);
    const minutes = Math.floor((diffMs / (1000 * 60)) % 60);
    const hours = Math.floor((diffMs / (1000 * 60 * 60)) % 24);
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    let durationString = '';
    if (days > 0) durationString += `${days}d `;
    if (hours > 0) durationString += `${hours}h `;
    if (minutes > 0) durationString += `${minutes}m `;
    if (seconds > 0 || durationString === '') durationString += `${seconds}s`;

    return durationString.trim();
  };

  const formatDateTime = (dateTime: Date | string): string => {
    try {
      const date = new Date(dateTime);
      if (isNaN(date.getTime())) {
        return "Invalid date";
      }
      return date.toLocaleString(undefined, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        timeZoneName: 'short'
      });
    } catch (error) {
      console.error('Error parsing date:', error, dateTime);
      return "Invalid date";
    }
  };

  const scrollToBottom = (ref: React.RefObject<HTMLPreElement | null>) => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  };

  const copyToClipboard = (ref: React.RefObject<HTMLPreElement | null>, logType: string) => {
    if (ref.current) {
      const content = ref.current.textContent || '';
      navigator.clipboard.writeText(content).then(() => {
        console.log(`${logType} output copied to clipboard`);
      }).catch(err => {
        console.error('Failed to copy: ', err);
      });
    }
  };

  const handleRefresh = () => {
    setRefreshKey(prevKey => prevKey + 1);
  };

  const renderLogOutput = (content: string | null | undefined, logType: string, ref: React.RefObject<HTMLPreElement | null>) => {
    if (!content) {
      return (
        <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-md text-center text-muted-foreground">
          No {logType} logs available
        </div>
      );
    }

    return (
      <>
        <div className="flex justify-between mb-2">
          <Button variant="outline" size="sm" onClick={() => scrollToBottom(ref)}>
            Jump to Bottom
          </Button>
          <Button variant="outline" size="sm" onClick={() => copyToClipboard(ref, logType)}>
            <Copy className="h-4 w-4" /> Copy
          </Button>
        </div>
        <pre ref={ref} className="bg-gray-100 dark:bg-gray-800 p-4 rounded-md text-xs overflow-auto h-96 max-w-full whitespace-pre-wrap">
          {content}
        </pre>
      </>
    );
  };

  // Helper function to render stdout and stderr side by side
  const renderSideBySideLogs = (
    stdoutContent: string | null | undefined,
    stderrContent: string | null | undefined,
    stdoutRef: React.RefObject<HTMLPreElement | null>,
    stderrRef: React.RefObject<HTMLPreElement | null>,
    logPrefix: string,
    leftLabel: string = 'Stdout',
    rightLabel: string = 'Stderr'
  ) => {
    const hasStdout = !!(stdoutContent);
    const hasStderr = !!(stderrContent);

    if (!hasStdout && !hasStderr) {
      return (
        <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-md text-center text-muted-foreground">
          No {logPrefix} logs available
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left Section (Stdout/First) */}
        <div className={hasStderr ? '' : 'lg:col-span-2'}>
          <h3 className="text-lg font-semibold mb-2">{leftLabel}</h3>
          {/* Always show button area for alignment */}
          <div className="flex justify-between mb-2">
            {hasStdout ? (
              <>
                <Button variant="outline" size="sm" onClick={() => scrollToBottom(stdoutRef)}>
                  Jump to Bottom
                </Button>
                <Button variant="outline" size="sm" onClick={() => copyToClipboard(stdoutRef, leftLabel.toLowerCase())}>
                  <Copy className="h-4 w-4" /> Copy
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" size="sm" disabled>
                  Jump to Bottom
                </Button>
                <Button variant="outline" size="sm" disabled>
                  <Copy className="h-4 w-4" /> Copy
                </Button>
              </>
            )}
          </div>
          {hasStdout ? (
            <pre ref={stdoutRef} className="bg-gray-100 dark:bg-gray-800 p-4 rounded-md text-xs overflow-auto h-96 max-w-full whitespace-pre-wrap">
              {stdoutContent}
            </pre>
          ) : (
            <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-md text-center text-muted-foreground h-96 flex items-center justify-center">
              No {leftLabel.toLowerCase()} available
            </div>
          )}
        </div>

        {/* Right Section (Stderr/Second) */}
        {hasStderr && (
          <div>
            <h3 className="text-lg font-semibold mb-2">{rightLabel}</h3>
            {/* Always show button area for alignment */}
            <div className="flex justify-between mb-2">
              <Button variant="outline" size="sm" onClick={() => scrollToBottom(stderrRef)}>
                Jump to Bottom
              </Button>
              <Button variant="outline" size="sm" onClick={() => copyToClipboard(stderrRef, rightLabel.toLowerCase())}>
                <Copy className="h-4 w-4" /> Copy
              </Button>
            </div>
            <pre ref={stderrRef} className="bg-gray-100 dark:bg-gray-800 p-4 rounded-md text-xs overflow-auto h-96 max-w-full whitespace-pre-wrap">
              {stderrContent}
            </pre>
          </div>
        )}
      </div>
    );
  };

  // Helper function to check if logs are available for a tab
  const hasLogs = (logType: string): boolean => {
    if (!build) return false;
    
    switch (logType) {
      case 'builder':
        return !!(build.builderStdout);
      case 'apko':
        return !!(build.apkoStdout || build.apkoStderr);
      case 'grype':
        return !!(build.grypeAarch64Stderr || build.grypeX86_64Stderr);
      case 'grype-alternate':
        return !!(build.grypeAlternateAarch64Stderr || build.grypeAlternateX86_64Stderr);

      default:
        return false;
    }
  };

  // Session is handled by the dashboard layout

  if (isSessionLoading || !session || !user) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
          <div>Loading build data...</div>
        </div>
      </div>
    );
  }

  if (loading && !error) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
          <div>Loading build data...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4">Error</h1>
        <p>{error}</p>
        <Link href="/builds">
          <Button variant="outline" className="mt-4">Back to Builds</Button>
        </Link>
      </div>
    );
  }

  if (!build) {
    return (
      <div className="p-6">
        <p>Build not found.</p>
        <Link href="/builds">
          <Button variant="outline" className="mt-4">Back to Builds</Button>
        </Link>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success':
        return 'bg-green-500';
      case 'failed':
      case 'timed_out':
        return 'bg-red-500';
      case 'building':
      case 'queued':
        return 'bg-blue-500';
      default:
        return 'bg-gray-500';
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Build Details: {build.id}</h1>
          <p className="text-muted-foreground mt-1">
            Image: 
            <Link href={`/images/${build.imageId}/builds`} className="font-semibold text-blue-600 hover:text-blue-800 underline ml-1 mr-1">
              {build.imageName}
            </Link>
          </p>
        </div>
        <div className="flex space-x-2">
          <Button variant="outline" onClick={handleRefresh}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
          <Link href="/images">
            <Button variant="outline">Back to Images</Button>
          </Link>
        </div>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <strong>Image: </strong>
            <Link href={`/images/${build.imageId}/builds`} className="font-semibold text-blue-600 hover:text-blue-800 underline">
              {build.imageName}
            </Link>
            <div className="mt-2">
              <Link href={`/images/${build.imageId}/builds`}>
                <Button variant="outline" size="sm">
                  View This Image Builds
                </Button>
              </Link>
            </div>
          </div>
          <div>
            <strong>Status:</strong>
            <Badge variant="outline" className={`ml-2 text-white ${getStatusColor(build.status)}`}>
              {build.status}
            </Badge>
          </div>
          {build.workerError && (
            <div>
              <strong>Worker Error:</strong>
              <div className="mt-1 p-3 bg-red-50 border border-red-200 rounded-md">
                <p className="text-red-800 text-sm">{build.workerError}</p>
              </div>
            </div>
          )}
          <div>
            <strong>Image Tags:</strong>
            <div className="flex flex-wrap gap-1 mt-1">
              {build.imageTags && build.imageTags.length > 0 ? (
                build.imageTags.map((tag, tagIndex) => (
                  <Badge key={tagIndex} variant="outline" className="text-xs">
                    <Tag className="h-3 w-3 mr-1" />
                    {tag}
                  </Badge>
                ))
              ) : (
                <span className="text-muted-foreground text-sm">No tags available</span>
              )}
            </div>
          </div>
          <div>
            <strong>Builder ID:</strong> {build.builderId || 'Not assigned'}
          </div>
          <div className="space-y-1">
            <div><strong>Timeline:</strong></div>
            <div className="pl-4 border-l-2 border-gray-200 dark:border-gray-700 space-y-1">
              <div><strong>Created At:</strong> {formatDateTime(build.createdAt)}</div>
              {build.buildStartedAt && (
                <div>
                  <strong>Build Started:</strong> {formatDateTime(build.buildStartedAt)}
                </div>
              )}
              {build.buildFinishedAt && (
                <div>
                  <strong>Build Finished:</strong> {formatDateTime(build.buildFinishedAt)}
                  {build.buildStartedAt && (
                    <span className="text-sm text-muted-foreground ml-2">
                      (Duration: {formatDuration(build.buildStartedAt, build.buildFinishedAt)})
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Build Logs</CardTitle>
          <CardDescription>View logs from different stages of the build process</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="builder" className="w-full">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="builder" disabled={!hasLogs('builder')}>
                Builder
              </TabsTrigger>
              <TabsTrigger value="apko" disabled={!hasLogs('apko')}>
                APKO
              </TabsTrigger>
              <TabsTrigger value="grype" disabled={!hasLogs('grype')}>
                Grype
              </TabsTrigger>
              <TabsTrigger value="grype-alternate" disabled={!hasLogs('grype-alternate')}>
                Grype Alternate
              </TabsTrigger>
              
            </TabsList>

            <TabsContent value="builder" className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold mb-2">Builder Output</h3>
                {renderLogOutput(build.builderStdout, 'builder', builderRef)}
              </div>
            </TabsContent>

            <TabsContent value="apko" className="space-y-4">
              {renderSideBySideLogs(
                build.apkoStdout,
                build.apkoStderr,
                apkoStdoutRef,
                apkoStderrRef,
                'APKO',
                'APKO Stdout',
                'APKO Stderr'
              )}
            </TabsContent>

            <TabsContent value="grype" className="space-y-4">
              {renderSideBySideLogs(
                build.grypeAarch64Stderr,
                build.grypeX86_64Stderr,
                grypeAarch64Ref,
                grypeX86_64Ref,
                'Grype',
                'Grype AArch64 Stderr',
                'Grype x86_64 Stderr'
              )}
            </TabsContent>

            <TabsContent value="grype-alternate" className="space-y-4">
              {renderSideBySideLogs(
                build.grypeAlternateAarch64Stderr,
                build.grypeAlternateX86_64Stderr,
                grypeAlternateAarch64Ref,
                grypeAlternateX86_64Ref,
                'Grype Alternate',
                'Grype Alternate AArch64 Stderr',
                'Grype Alternate x86_64 Stderr'
              )}
            </TabsContent>


          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
} 