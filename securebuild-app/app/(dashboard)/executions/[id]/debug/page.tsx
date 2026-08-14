"use client"

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useSession } from '@/app/hooks/use-session';
import { getExecutionAction } from '@/lib/execution/actions/get-execution';
import { Execution } from '@/lib/types/execution';
import { ArrowLeft, Bug, Search, Wrench, Download, Terminal, Copy } from 'lucide-react';

export default function ExecutionDebugPage() {
  const { session, isSessionLoading } = useSession();
  const user = session?.user;
  const params = useParams();
  const id = params?.id as string | undefined;

  const [execution, setExecution] = useState<Execution | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedCommand, setCopiedCommand] = useState(false);

  // Function to fetch execution data
  const fetchExecution = async () => {
    if (!id || !session) return;

    try {
      const data = await getExecutionAction(id);
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
  }, [id, session, isSessionLoading]);

  // Session is handled by the dashboard layout

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
          <Button variant="outline" className="mt-4">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Executions
          </Button>
        </Link>
      </div>
    );
  }

  if (!execution) {
    return (
      <div className="p-6">
        <p>Execution not found.</p>
        <Link href="/executions">
          <Button variant="outline" className="mt-4">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Executions
          </Button>
        </Link>
      </div>
    );
  }

  const handleDownloadReproducer = async () => {
    if (!execution?.id) {
      alert('Execution ID is missing. Cannot download reproduction archive.');
      return;
    }

    try {
      // Make GET request to the debug archive endpoint
      const response = await fetch(`/api/debug-archive?executionID=${execution.id}`);

      if (!response.ok) {
        throw new Error(`Failed to download: ${response.statusText}`);
      }

      // Get the blob from the response
      const blob = await response.blob();

      // Create a temporary URL for the blob
      const url = window.URL.createObjectURL(blob);

      // Create a temporary anchor element to trigger the download
      const a = document.createElement('a');
      a.href = url;
      a.download = `reproduce-${execution.id}.tar.gz`;
      document.body.appendChild(a);
      a.click();

      // Clean up
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download reproducer:', error);
      // You could also show a toast notification or alert here
      alert('Failed to download reproduction archive. Please try again.');
    }
  };

  const copyCommand = async (command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopiedCommand(true);
      setTimeout(() => setCopiedCommand(false), 2000);
    } catch (err) {
      console.error('Failed to copy command:', err);
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-4">
          <Link href={`/executions/${id}`}>
            <Button variant="outline" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Execution
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold flex items-center">
              <Bug className="mr-3 h-8 w-8 text-red-600" />
              Debug Build Failure
            </h1>
            <p className="text-muted-foreground mt-1">
              Execution ID: {execution.id} • Package: {execution.packageName || execution.packageId} v{execution.versionLabel}
            </p>
          </div>
        </div>
      </div>

      {/* Status Banner */}
      <Card className="mb-6 border-l-4 border-l-red-500 bg-red-50 dark:bg-red-900/10">
        <CardHeader>
          <CardTitle className="text-red-700 dark:text-red-400 flex items-center">
            <Bug className="mr-2 h-5 w-5" />
            Build Failed
          </CardTitle>
          <CardDescription className="text-red-600 dark:text-red-300">
            This execution failed during the build process. Use the debugging tools below to investigate the cause.
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Local Reproduction Instructions */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center">
            <Terminal className="mr-2 h-5 w-5 text-blue-600" />
            Reproduce Locally
          </CardTitle>
          <CardDescription>
            Download and run the exact same build environment locally to debug the failure
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <h4 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">Step 1: Download Build Files Archive</h4>
            <p className="text-blue-800 dark:text-blue-200 text-sm mb-3">
              This tar.gz archive contains all the build files, melange.yaml, additional files, signing key, and a reproduce.sh script to run the build locally.
            </p>
            <Button onClick={handleDownloadReproducer} className="bg-blue-600 hover:bg-blue-700">
              <Download className="mr-2 h-4 w-4" />
              Download reproduce-{execution?.id}.tar.gz
            </Button>
          </div>

          <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
            <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">Step 2: Extract and Run Build</h4>
            <p className="text-gray-700 dark:text-gray-300 text-sm mb-3">
              Execute the following commands to extract and reproduce the build:
            </p>
            <div className="space-y-2">
              <div className="bg-black text-green-400 p-3 rounded font-mono text-sm flex items-center justify-between">
                <span>tar -xzf reproduce-{execution?.id}.tar.gz</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyCommand(`tar -xzf reproduce-${execution?.id}.tar.gz`)}
                  className="text-green-400 hover:text-green-300 hover:bg-gray-800"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <div className="bg-black text-green-400 p-3 rounded font-mono text-sm flex items-center justify-between">
                <span>
                    cd {execution?.id}<br />
                    ./reproduce.sh x86_64  # or aarch64
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyCommand(`cd ${execution?.id} && ./reproduce.sh x86_64`)}
                  className="text-green-400 hover:text-green-300 hover:bg-gray-800"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
            {copiedCommand && (
              <p className="text-green-600 dark:text-green-400 text-sm mt-2">✓ Command copied to clipboard!</p>
            )}
          </div>

        </CardContent>
      </Card>
    </div>
  );
}
