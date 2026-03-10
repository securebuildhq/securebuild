'use client'

import { useState } from 'react'

export function MultiStageTabs() {
  const [activeTab, setActiveTab] = useState('nodejs');

  const tabs = [
    { id: 'nodejs', label: 'Node.js' },
    { id: 'python', label: 'Python' },
    { id: 'golang', label: 'Go' }
  ];

  const tabStyle = {
    container: {
      marginTop: '2rem',
      border: '1px solid #d1d5db',
      borderRadius: '0.5rem',
      overflow: 'hidden'
    },
    tabContainer: {
      borderBottom: '1px solid #e5e7eb',
      backgroundColor: '#f9fafb',
      padding: '0 1rem'
    },
    tabNav: {
      display: 'flex',
      gap: '2rem',
      marginBottom: '-1px'
    },
    tabButton: {
      padding: '0.5rem 1rem',
      fontWeight: '500',
      fontSize: '0.875rem',
      borderBottom: '2px solid transparent',
      cursor: 'pointer',
      transition: 'all 0.2s',
      backgroundColor: 'transparent',
      border: 'none'
    },
    activeTab: {
      borderBottomColor: '#3b82f6',
      color: '#2563eb'
    },
    inactiveTab: {
      color: '#6b7280'
    }
  };

  return (
    <div style={tabStyle.container}>
      {/* Tab Navigation */}
      <div style={tabStyle.tabContainer}>
        <div style={tabStyle.tabNav}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                ...tabStyle.tabButton,
                ...(activeTab === tab.id ? tabStyle.activeTab : tabStyle.inactiveTab)
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content Area */}
      <div style={{ padding: '1.5rem', backgroundColor: 'white' }}>
        {activeTab === 'nodejs' && (
          <div>
            <div className="flex items-center mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Node.js Multi-Stage Build</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">Build and deploy Node.js applications with minimal attack surface</p>
              </div>
            </div>

            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 mb-4">
              <pre><code className="language-dockerfile text-sm">{`# Build stage - use a full Node.js image for building
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source code and build the application
COPY . .
RUN npm run build

# Runtime stage - use SecureBuild's minimal Node.js base image
FROM cve0.io/node:20

# Create non-root user
USER 1000:1000

# Set working directory
WORKDIR /app

# Copy built application from builder stage
COPY --from=builder --chown=1000:1000 /app/dist ./dist
COPY --from=builder --chown=1000:1000 /app/node_modules ./node_modules
COPY --from=builder --chown=1000:1000 /app/package.json ./

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Expose port
EXPOSE 3000

# Run the application
CMD ["node", "dist/server.js"]`}</code></pre>
            </div>

            <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <div className="flex items-start">
                <div>
                  <p className="font-medium text-blue-900 dark:text-blue-100 mb-1">Key Benefits</p>
                  <p className="text-sm text-blue-800 dark:text-blue-200">
                    The final image contains only your built application and Node.js runtime,
                    without build tools, source code, or npm cache.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'python' && (
          <div>
            <div className="flex items-center mb-4">
              <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center mr-3">
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Python Multi-Stage Build</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">Build Python applications with pre-compiled dependencies</p>
              </div>
            </div>

            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 mb-4">
              <pre><code className="language-dockerfile text-sm">{`# Build stage - use a full Python image for building
FROM python:3.11-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN pip install --upgrade pip setuptools wheel

# Copy requirements and install dependencies
COPY requirements.txt .
RUN pip install --user --no-cache-dir -r requirements.txt

# Copy source code
COPY . .

# Runtime stage - use SecureBuild's minimal Python base image
FROM cve0.io/python:3.11

# Create non-root user
USER 1000:1000

# Set working directory
WORKDIR /app

# Copy installed packages and application from builder
COPY --from=builder --chown=1000:1000 /root/.local /home/app/.local
COPY --from=builder --chown=1000:1000 /app .

# Update PATH to include local packages
ENV PATH=/home/app/.local/bin:$PATH
ENV PYTHONPATH=/home/app/.local/lib/python3.11/site-packages

# Run the application
CMD ["python", "app.py"]`}</code></pre>
            </div>

            <div className="mt-4 p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
              <div className="flex items-start">
                <div>
                  <p className="font-medium text-green-900 dark:text-green-100 mb-1">Key Benefits</p>
                  <p className="text-sm text-green-800 dark:text-green-200">
                    Pre-compiled Python packages are copied from the builder,
                    eliminating the need for build tools in the runtime image.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'golang' && (
          <div>
            <div className="flex items-center mb-4">
              <div className="w-8 h-8 bg-cyan-100 dark:bg-cyan-900/30 rounded-lg flex items-center justify-center mr-3">
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Go Multi-Stage Build</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">Compile static binaries for minimal container footprint</p>
              </div>
            </div>

            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 mb-4">
              <pre><code className="language-dockerfile text-sm">{`# Build stage
FROM golang:1.21-alpine AS builder

WORKDIR /app

# Copy go mod files
COPY go.mod go.sum ./
RUN go mod download

# Copy source code and build
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o main .

# Runtime stage - use SecureBuild's minimal base image
FROM cve0.io/static:latest

# Copy the binary from builder
COPY --from=builder /app/main /usr/local/bin/main

# Run as non-root user
USER 65534:65534

# Run the application
CMD ["/usr/local/bin/main"]`}</code></pre>
            </div>

            <div className="mt-4 p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
              <div className="flex items-start">
                <div>
                  <p className="font-medium text-purple-900 dark:text-purple-100 mb-1">Key Benefits</p>
                  <p className="text-sm text-purple-800 dark:text-purple-200">
                    The final image contains only a static binary and minimal base OS,
                    resulting in the smallest possible attack surface.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
