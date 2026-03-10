"use client";

import React from "react";
import { VERSION } from "@/lib/build-info";

export default function DebugPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-[80%] min-w-[600px] w-full bg-card shadow-lg rounded-lg p-6 space-y-6">
        <div className="text-center">
          <h2 className="text-3xl font-extrabold text-foreground">Debug Information</h2>
        </div>
        <div className="border-t border-border pt-4">
          <table className="table-auto w-full text-left border-collapse">
            <thead className="bg-muted">
              <tr>
                <th className="px-4 py-2 border-b border-border">Name</th>
                <th className="px-4 py-2 border-b border-border">Value</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="px-4 py-2 border-b">VERSION</td>
                <td className="px-4 py-2 border-b">{VERSION}</td>
              </tr>
              <tr>
                <td className="px-4 py-2 border-b">Public Environment Variables</td>
                <td className="px-4 py-2 border-b">
                  <table className="table-auto w-full text-left border-collapse">
                    <thead className="bg-muted">
                      <tr>
                        <th className="px-4 py-2 border-b">Name</th>
                        <th className="px-4 py-2 border-b">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="px-4 py-2 border-b">NEXT_PUBLIC_GITHUB_CLIENT_ID</td>
                        <td className="px-4 py-2 border-b">{process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID || '(not set)'}</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2 border-b">NEXT_PUBLIC_GITHUB_REDIRECT_URI</td>
                        <td className="px-4 py-2 border-b">{process.env.NEXT_PUBLIC_GITHUB_REDIRECT_URI || '(not set)'}</td>
                      </tr>
                    </tbody>
                  </table>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
