"use client"

import { useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useSession } from '@/app/hooks/use-session';
import { getExecutionAction } from '@/lib/execution/actions/get-execution';
import { Execution } from '@/lib/types/execution';
import { RefreshCw, Copy, Maximize2, Minimize2, Filter } from 'lucide-react';

export default function ExecutionDetailPage() {
  const { session, isSessionLoading } = useSession();
  const user = session?.user;
  const params = useParams();
  const id = params?.id as string | undefined;

  const [execution, setExecution] = useState<Execution | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // States for flashing borders when content changes
  const [x86Flash, setX86Flash] = useState(false);
  const [aarch64Flash, setAarch64Flash] = useState(false);

  // State for expanded view mode
  const [expandedPanel, setExpandedPanel] = useState<'x86_64' | 'aarch64' | null>(null);

  // State for log filtering
  const [logFilters, setLogFilters] = useState<{
    INFO: boolean;
    WARN: boolean;
    DEBU: boolean;
    ERRO: boolean;
    showAll: boolean;
  }>({
    INFO: true,
    WARN: true,
    DEBU: true,
    ERRO: true,
    showAll: true
  });

  // Refs for scrolling <pre> tags
  const x86BuildOutputRef = useRef<HTMLPreElement>(null);
  const aarch64BuildOutputRef = useRef<HTMLPreElement>(null);

  // Ref to store the interval ID for cleanup
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Refs to store previous build output values for change detection
  const prevX86OutputRef = useRef<string>('');
  const prevAarch64OutputRef = useRef<string>('');

  // Function to fetch execution data
  const fetchExecution = async () => {
    if (!id || !session) return;

    try {
      const data = await getExecutionAction(session, id);
      if (data) {
        setExecution(data);
        setError(null);
      } else {
        setError('Execution not found.');
      }
    } catch (err: any) {
      console.error('Failed to fetch execution details:', err);
      if (err.message === "Execution not found") {
        setError('Execution not found.');
      } else {
        setError('Failed to load execution details.');
      }
    }
  };

  useEffect(() => {
    if (id && session) {
      setLoading(true);
      fetchExecution().finally(() => {
        setLoading(false);
      });
    } else if (!isSessionLoading && !session) {
      setLoading(false);
      setError("Please log in to view execution details.");
    } else if (!id && !isSessionLoading && session) {
      setLoading(false);
      setError("Execution ID is missing.");
    }
  }, [id, session, isSessionLoading, refreshKey]);

  // Set up auto-refresh interval
  useEffect(() => {
    // Only set up auto-refresh if we have a valid session and execution ID
    if (!id || !session || loading || error) {
      return;
    }

    // Check if execution is in a state that should continue refreshing
    const shouldAutoRefresh = execution && (
      execution.status === 'in_progress' ||
      execution.status === 'building' ||
      execution.status === 'testing' ||
      execution.status === 'publishing' ||
      execution.status === 'pending'
    );

    if (shouldAutoRefresh) {
      // Set up interval to refresh every 5 seconds
      intervalRef.current = setInterval(() => {
        fetchExecution();
      }, 5000);
    }

    // Cleanup function
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [id, session, loading, error, execution?.status]);

  // Detect changes in build outputs and trigger flash animations
  useEffect(() => {
    if (!execution) return;

    // Create current output strings for comparison
    const currentX86Output = `${execution.x86_64BuildStdout || ''}${execution.x86_64BuildStderr || ''}`;
    const currentAarch64Output = `${execution.aarch64BuildStdout || ''}${execution.aarch64BuildStderr || ''}`;

    // Check if x86_64 output changed
    if (prevX86OutputRef.current && prevX86OutputRef.current !== currentX86Output) {
      setX86Flash(true);
      setTimeout(() => setX86Flash(false), 1000); // Flash for 1 second
    }

    // Check if aarch64 output changed
    if (prevAarch64OutputRef.current && prevAarch64OutputRef.current !== currentAarch64Output) {
      setAarch64Flash(true);
      setTimeout(() => setAarch64Flash(false), 1000); // Flash for 1 second
    }

    // Update previous values for next comparison
    prevX86OutputRef.current = currentX86Output;
    prevAarch64OutputRef.current = currentAarch64Output;
  }, [execution?.x86_64BuildStdout, execution?.x86_64BuildStderr, execution?.aarch64BuildStdout, execution?.aarch64BuildStderr]);

  // Auto-scroll to bottom of logs when execution data is loaded or panel state changes
  useEffect(() => {
    if (execution && !loading) {
      // Longer delay to ensure DOM is updated after layout changes (expansion/collapse)
      const timeoutId = setTimeout(() => {
        // Only scroll the visible panels to avoid unnecessary work
        if (expandedPanel === null || expandedPanel === 'x86_64') {
          scrollToBottom(x86BuildOutputRef);
        }
        if (expandedPanel === null || expandedPanel === 'aarch64') {
          scrollToBottom(aarch64BuildOutputRef);
        }
      }, expandedPanel !== null ? 200 : 100); // Longer delay for expanded panels
      
      return () => clearTimeout(timeoutId);
    }
  }, [execution, loading, expandedPanel]);

  const formatDuration = (start: Date | string, end: Date | string): string => {
    const startDate = new Date(start);
    const endDate = new Date(end);
    const diffMs = endDate.getTime() - startDate.getTime();

    if (diffMs < 0) return 'N/A'; // Should not happen if data is correct

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
      let date: Date;

      if (dateTime instanceof Date) {
        // The database stores UTC, but JS parsed it as local time
        // We need to adjust by the timezone offset
        const localDate = dateTime;
        const timezoneOffsetMs = localDate.getTimezoneOffset() * 60 * 1000;
        date = new Date(localDate.getTime() - timezoneOffsetMs);
      } else {
        // If it's a string from database, assume it's UTC
        const timeString = String(dateTime);
        if (!timeString.includes('Z') && !timeString.includes('+') && !timeString.includes('-', 10)) {
          date = new Date(timeString + 'Z'); // Add Z to treat as UTC
        } else {
          date = new Date(timeString);
        }
      }

      // Verify the date is valid
      if (isNaN(date.getTime())) {
        return "Invalid date";
      }

      // Format in local timezone with 24-hour format
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

  const copyToClipboard = (ref: React.RefObject<HTMLPreElement | null>, architecture: string) => {
    if (ref.current) {
      const content = ref.current.textContent || '';
      navigator.clipboard.writeText(content).then(() => {
        // You could add a toast notification here if desired
        console.log(`${architecture} build output copied to clipboard`);
      }).catch(err => {
        console.error('Failed to copy: ', err);
      });
    }
  };

  const handleRefresh = () => {
    setRefreshKey(prevKey => prevKey + 1);
  };

  const handleExpandPanel = (panel: 'x86_64' | 'aarch64') => {
    if (expandedPanel === panel) {
      setExpandedPanel(null); // Collapse if already expanded
    } else {
      setExpandedPanel(panel); // Expand the selected panel
    }
  };

  const handleFilterChange = (level: keyof typeof logFilters) => {
    if (level === 'showAll') {
      const newShowAll = !logFilters.showAll;
      setLogFilters({
        INFO: newShowAll,
        WARN: newShowAll,
        DEBU: newShowAll,
        ERRO: newShowAll,
        showAll: newShowAll
      });
    } else {
      const newFilters = {
        ...logFilters,
        [level]: !logFilters[level]
      };
      // Update showAll based on whether all individual filters are selected
      newFilters.showAll = newFilters.INFO && newFilters.WARN && newFilters.DEBU && newFilters.ERRO;
      setLogFilters(newFilters);
    }
  };

  const filterLogContent = (content: string): string => {
    // Always apply filtering based on individual filter states, not showAll
    const lines = content.split('\n');
    const filteredLines = lines.filter(line => {
      // Check if line contains any of the enabled log levels
      if (logFilters.INFO && line.includes(' INFO ')) return true;
      if (logFilters.WARN && line.includes(' WARN ')) return true;
      if (logFilters.DEBU && line.includes(' DEBU ')) return true;
      if (logFilters.ERRO && line.includes(' ERRO ')) return true;
      
      // Also include lines that don't have clear log levels (like command output, etc.)
      if (!line.includes(' INFO ') && !line.includes(' WARN ') && 
          !line.includes(' DEBU ') && !line.includes(' ERRO ')) {
        return true;
      }
      
      return false;
    });
    
    return filteredLines.join('\n');
  };

  const renderLogFilterControls = () => (
    <div className="flex items-center gap-2 mb-2">
      <Filter className="h-4 w-4 text-muted-foreground" />
      <span className="text-sm text-muted-foreground">Show:</span>
      <Button
        variant={logFilters.showAll ? "default" : "outline"}
        size="sm"
        onClick={() => handleFilterChange('showAll')}
        className="h-6 px-2 text-xs"
      >
        All
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => handleFilterChange('INFO')}
        className={`h-6 px-2 text-xs transition-all ${
          logFilters.INFO 
            ? 'bg-blue-500 text-white border-blue-500 hover:bg-blue-600' 
            : 'bg-gray-100 text-gray-500 border-gray-300 hover:bg-gray-200'
        }`}
      >
        ✓ INFO
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => handleFilterChange('WARN')}
        className={`h-6 px-2 text-xs transition-all ${
          logFilters.WARN 
            ? 'bg-orange-500 text-white border-orange-500 hover:bg-orange-600' 
            : 'bg-gray-100 text-gray-500 border-gray-300 hover:bg-gray-200'
        }`}
      >
        ✓ WARN
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => handleFilterChange('DEBU')}
        className={`h-6 px-2 text-xs transition-all ${
          logFilters.DEBU 
            ? 'bg-gray-600 text-white border-gray-600 hover:bg-gray-700' 
            : 'bg-gray-100 text-gray-500 border-gray-300 hover:bg-gray-200'
        }`}
      >
        ✓ DEBU
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => handleFilterChange('ERRO')}
        className={`h-6 px-2 text-xs transition-all ${
          logFilters.ERRO 
            ? 'bg-red-500 text-white border-red-500 hover:bg-red-600' 
            : 'bg-gray-100 text-gray-500 border-gray-300 hover:bg-gray-200'
        }`}
      >
        ✓ ERRO
      </Button>
    </div>
  );

  // Session is handled by the layout
  if (isSessionLoading || !session || !user) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
          <div>Loading execution data...</div>
        </div>
      </div>
    );
  }

  if (loading && !error) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
          <div>Loading execution data...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4">Error</h1>
        <p>{error}</p>
        <Link href="/executions">
          <Button variant="outline" className="mt-4">Back to Executions</Button>
        </Link>
      </div>
    );
  }

  if (!execution) {
    return (
      <div className="p-6">
        <p>Execution not found.</p>
        <Link href="/executions">
          <Button variant="outline" className="mt-4">Back to Executions</Button>
        </Link>
      </div>
    );
  }

  let statusColor = 'bg-gray-500';
  if (execution.status === 'completed' || execution.status === 'success') statusColor = 'bg-green-500';
  if (execution.status === 'failed') statusColor = 'bg-red-500';
  if (execution.status === 'testing') statusColor = 'bg-amber-500';
  if (execution.status === 'in_progress' || execution.status === 'building' || execution.status === 'publishing') statusColor = 'bg-blue-500';

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Execution Details: {execution.id}</h1>
        <div className="flex space-x-2">
          <Button variant="outline" onClick={handleRefresh}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
          <Link href="/executions">
            <Button variant="outline">Back to Executions</Button>
          </Link>
        </div>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Summary</CardTitle>
          <CardDescription>
            <div>
              <div className="mb-2">
                Package:
                <Link
                  href={`/packages/${execution.packageId}`}
                  className="font-semibold text-blue-600 hover:text-blue-800 underline ml-1 mr-1"
                >
                  {execution.packageName || execution.packageId}
                </Link>
                - Version: {execution.versionLabel}
              </div>
              <Link href={`/packages/${execution.packageId}/executions`}>
                <Button variant="outline" size="sm">
                  View This Package Executions
                </Button>
              </Link>
            </div>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <strong>Status:</strong>
            <span className={`px-2 py-1 text-xs font-semibold rounded-full text-white ${statusColor}`}>
              {execution.status}
            </span>
            {execution.status === 'failed' && (
              <Link href={`/executions/${execution.id}/debug`} className="ml-3">
                <Button variant="destructive" size="sm" className="bg-red-600 hover:bg-red-700">
                  🐛 Debug This Build
                </Button>
              </Link>
            )}
          </div>
          <div>
            <strong>Triggered By:</strong> {execution.cause || "manual"}
          </div>
          <div className="space-y-2">
            <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
              <strong className="text-gray-800 dark:text-gray-200">Package Build Configuration:</strong>
              <div className="mt-2 text-sm space-y-1">
                <div><strong>Repository:</strong> SecureBuild Repository (https://apk.cve0.io)</div>
                <div><strong>Bootstrap Mode:</strong> {execution.bootstrapEnabled ? '✅ Enabled' : '❌ Disabled'}</div>
                {execution.bootstrapEnabled && execution.bootstrapApkRepository && (
                  <div><strong>Bootstrap APK Repository:</strong> {execution.bootstrapApkRepository}</div>
                )}
                {execution.bootstrapEnabled && execution.bootstrapKeyringAppend && (
                  <div><strong>Bootstrap Keyring:</strong> {execution.bootstrapKeyringAppend}</div>
                )}
                <div><strong>Root Mode:</strong> {execution.useRoot ? '✅ Enabled' : '❌ Disabled'}</div>
              </div>
            </div>
          </div>
          <div className="space-y-1">
            <div><strong>Timeline:</strong></div>
            <div className="pl-4 border-l-2 border-gray-200 dark:border-gray-700 space-y-1">
              <div><strong>Created At:</strong> {formatDateTime(execution.createdAt)}</div>
              {execution.x86_64BuildStartedAt && (
                <div className="pl-4 border-l-2 border-gray-200 dark:border-gray-700 space-y-1">
                  <div><strong>x86_64 Build and Test Started:</strong> {formatDateTime(execution.x86_64BuildStartedAt)}</div>
                  {execution.x86_64BuildFinishedAt && (
                    <div>
                      <strong>x86_64 Build and Test Finished:</strong> {formatDateTime(execution.x86_64BuildFinishedAt)}
                      {execution.x86_64BuildStartedAt && execution.x86_64BuildFinishedAt && (
                        <span className="text-sm text-muted-foreground ml-2">
                          (Duration: {formatDuration(execution.x86_64BuildStartedAt, execution.x86_64BuildFinishedAt)})
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
              {execution.aarch64BuildStartedAt && (
                <div className="pl-4 border-l-2 border-gray-200 dark:border-gray-700 space-y-1 mt-1">
                  <div><strong>AArch64 Build and Test Started:</strong> {formatDateTime(execution.aarch64BuildStartedAt)}</div>
                  {execution.aarch64BuildFinishedAt && (
                    <div>
                      <strong>AArch64 Build and Test Finished:</strong> {formatDateTime(execution.aarch64BuildFinishedAt)}
                      {execution.aarch64BuildStartedAt && execution.aarch64BuildFinishedAt && (
                        <span className="text-sm text-muted-foreground ml-2">
                          (Duration: {formatDuration(execution.aarch64BuildStartedAt, execution.aarch64BuildFinishedAt)})
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className={`gap-6 ${
        expandedPanel === null 
          ? 'grid grid-cols-1 lg:grid-cols-2' 
          : 'flex flex-col'
      }`}>
        {/* x86_64 Build Panel */}
        {(expandedPanel === null || expandedPanel === 'x86_64') && (
          <Card className={`transition-all duration-300 ${x86Flash ? 'ring-2 ring-blue-400 ring-opacity-75 shadow-lg' : ''} ${
            expandedPanel === 'x86_64' ? 'w-full' : ''
          }`}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <CardTitle>x86_64 Build and Test</CardTitle>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleExpandPanel('x86_64')}
                  title={expandedPanel === 'x86_64' ? 'Return to side-by-side view' : 'Expand to full width'}
                >
                  {expandedPanel === 'x86_64' ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground mb-2">
                X86_64 Build and Test Output (last 5000 lines):
              </p>
              {execution.x86_64BuilderID && (
                <div className="mb-2">
                  <strong>Builder ID:</strong> <span className="font-mono text-sm bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">{execution.x86_64BuilderID}</span>
                </div>
              )}
              {renderLogFilterControls()}
              <div className="flex justify-between mb-1">
                <Button variant="outline" size="sm" onClick={() => scrollToBottom(x86BuildOutputRef)}>Jump to Bottom</Button>
                <Button variant="outline" size="sm" onClick={() => copyToClipboard(x86BuildOutputRef, 'x86_64')}>
                  <Copy className="h-4 w-4" /> Copy
                </Button>
              </div>
              <pre ref={x86BuildOutputRef} className={`bg-gray-100 dark:bg-gray-800 p-2 rounded-md text-xs overflow-auto w-full ${
                expandedPanel === 'x86_64' ? 'h-[40vh]' : 'h-96'
              }`} style={{ maxWidth: '100%', wordWrap: 'break-word', whiteSpace: 'pre-wrap' }}>
                {filterLogContent(`Command: ${execution.x86_64BuildCommand || 'N/A'}\nExit Code: ${execution.x86_64BuildExitCode !== undefined ? execution.x86_64BuildExitCode : 'N/A'}\nStdout: ${execution.x86_64BuildStdout || 'N/A'}\nStderr: ${execution.x86_64BuildStderr || 'N/A'}`)}
              </pre>
            </CardContent>
          </Card>
        )}

        {/* AArch64 Build Panel */}
        {(expandedPanel === null || expandedPanel === 'aarch64') && (
          <Card className={`transition-all duration-300 ${aarch64Flash ? 'ring-2 ring-blue-400 ring-opacity-75 shadow-lg' : ''} ${
            expandedPanel === 'aarch64' ? 'w-full' : ''
          }`}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <CardTitle>AArch64 Build and Test</CardTitle>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleExpandPanel('aarch64')}
                  title={expandedPanel === 'aarch64' ? 'Return to side-by-side view' : 'Expand to full width'}
                >
                  {expandedPanel === 'aarch64' ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground mb-2">
                AArch64 Build and Test Output (last 5000 lines):
              </p>
              {execution.aarch64BuilderID && (
                <div className="mb-2">
                  <strong>Builder ID:</strong> <span className="font-mono text-sm bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">{execution.aarch64BuilderID}</span>
                </div>
              )}
              {renderLogFilterControls()}
              <div className="flex justify-between mb-1">
                <Button variant="outline" size="sm" onClick={() => scrollToBottom(aarch64BuildOutputRef)}>Jump to Bottom</Button>
                <Button variant="outline" size="sm" onClick={() => copyToClipboard(aarch64BuildOutputRef, 'aarch64')}>
                  <Copy className="h-4 w-4" /> Copy
                </Button>
              </div>
              <pre ref={aarch64BuildOutputRef} className={`bg-gray-100 dark:bg-gray-800 p-2 rounded-md text-xs overflow-auto w-full ${
                expandedPanel === 'aarch64' ? 'h-[40vh]' : 'h-96'
              }`} style={{ maxWidth: '100%', wordWrap: 'break-word', whiteSpace: 'pre-wrap' }}>
                {filterLogContent(`Command: ${execution.aarch64BuildCommand || 'N/A'}\nExit Code: ${execution.aarch64BuildExitCode !== undefined ? execution.aarch64BuildExitCode : 'N/A'}\nStdout: ${execution.aarch64BuildStdout || 'N/A'}\nStderr: ${execution.aarch64BuildStderr || 'N/A'}`)}
              </pre>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
