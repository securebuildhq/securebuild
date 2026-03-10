'use client'

import React, { useState, useMemo } from 'react'
import { InlinePackageCount } from './PackageCount'

interface ReleaseData {
  current: string;
  revisions: string[];
  size: string;
  lastUpdated: string;
}

interface VersionData {
  current: string;
  releases: Record<string, ReleaseData>;
}

interface Package {
  name: string;
  description: string;
  category: string;
  dependencies: string[];
  cveCount: number;
  keywords: string[];
  useCase: string;
  versions: Record<string, VersionData>;
}

export function PackageSearch() {
  const [searchTerm, setSearchTerm] = useState('');
  const [category, setCategory] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [modalContent, setModalContent] = useState({ title: '', content: '' });
  const [expandedPackages, setExpandedPackages] = useState<Record<string, boolean>>({});

  const packages: Package[] = [
    {
      name: 'nginx',
      description: 'High performance web server and reverse proxy',
      category: 'web-servers',
      dependencies: ['openssl', 'pcre', 'zlib', 'ca-certificates-bundle'],
      cveCount: 0,
      keywords: ['web', 'server', 'reverse proxy', 'http', 'https'],
      useCase: 'Web server, reverse proxy, load balancer',
      versions: {
        '1.24': {
          current: '1.24.0',
          releases: {
            '1.24.0': {
              current: 'r2',
              revisions: ['r2', 'r1', 'r0'],
              size: '2.1 MB',
              lastUpdated: '2024-01-15'
            }
          }
        },
        '1.23': {
          current: '1.23.4',
          releases: {
            '1.23.4': {
              current: 'r1',
              revisions: ['r1', 'r0'],
              size: '2.0 MB',
              lastUpdated: '2023-12-10'
            },
            '1.23.3': {
              current: 'r0',
              revisions: ['r0'],
              size: '2.0 MB',
              lastUpdated: '2023-11-15'
            }
          }
        }
      }
    },
    {
      name: 'python',
      description: 'Python programming language interpreter',
      category: 'runtimes',
      dependencies: ['openssl', 'libffi', 'expat', 'glibc'],
      cveCount: 0,
      keywords: ['python', 'interpreter', 'runtime', 'programming'],
      useCase: 'Python applications, scripting, web development',
      versions: {
        '3.11': {
          current: '3.11.7',
          releases: {
            '3.11.7': {
              current: 'r0',
              revisions: ['r0'],
              size: '45.3 MB',
              lastUpdated: '2024-01-14'
            },
            '3.11.6': {
              current: 'r1',
              revisions: ['r1', 'r0'],
              size: '45.1 MB',
              lastUpdated: '2023-12-01'
            }
          }
        },
        '3.10': {
          current: '3.10.13',
          releases: {
            '3.10.13': {
              current: 'r0',
              revisions: ['r0'],
              size: '44.8 MB',
              lastUpdated: '2023-11-20'
            }
          }
        }
      }
    },
    {
      name: 'postgresql',
      description: 'Advanced open source relational database',
      category: 'databases',
      dependencies: ['openssl', 'zlib', 'readline', 'icu'],
      cveCount: 0,
      keywords: ['database', 'sql', 'postgres', 'relational', 'acid'],
      useCase: 'Relational database, OLTP, analytics',
      versions: {
        '15': {
          current: '15.5',
          releases: {
            '15.5': {
              current: 'r1',
              revisions: ['r1', 'r0'],
              size: '8.7 MB',
              lastUpdated: '2024-01-12'
            },
            '15.4': {
              current: 'r0',
              revisions: ['r0'],
              size: '8.6 MB',
              lastUpdated: '2023-11-30'
            }
          }
        },
        '14': {
          current: '14.10',
          releases: {
            '14.10': {
              current: 'r0',
              revisions: ['r0'],
              size: '8.5 MB',
              lastUpdated: '2023-10-15'
            }
          }
        }
      }
    },
    {
      name: 'redis',
      description: 'In-memory data structure store',
      category: 'databases',
      dependencies: ['openssl', 'glibc'],
      cveCount: 0,
      keywords: ['cache', 'memory', 'nosql', 'key-value', 'session'],
      useCase: 'Caching, session storage, message queues',
      versions: {
        '7.2': {
          current: '7.2.4',
          releases: {
            '7.2.4': {
              current: 'r0',
              revisions: ['r0'],
              size: '3.2 MB',
              lastUpdated: '2024-01-16'
            },
            '7.2.3': {
              current: 'r1',
              revisions: ['r1', 'r0'],
              size: '3.1 MB',
              lastUpdated: '2023-12-05'
            }
          }
        }
      }
    },
    {
      name: 'nodejs',
      description: 'JavaScript runtime built on Chrome V8 engine',
      category: 'runtimes',
      dependencies: ['openssl', 'icu', 'c-ares'],
      cveCount: 0,
      keywords: ['javascript', 'nodejs', 'runtime', 'v8', 'npm'],
      useCase: 'Node.js applications, APIs, web services',
      versions: {
        '18': {
          current: '18.19.0',
          releases: {
            '18.19.0': {
              current: 'r0',
              revisions: ['r0'],
              size: '32.1 MB',
              lastUpdated: '2024-01-13'
            },
            '18.18.2': {
              current: 'r1',
              revisions: ['r1', 'r0'],
              size: '31.9 MB',
              lastUpdated: '2023-11-28'
            }
          }
        },
        '20': {
          current: '20.11.0',
          releases: {
            '20.11.0': {
              current: 'r0',
              revisions: ['r0'],
              size: '35.2 MB',
              lastUpdated: '2024-01-10'
            }
          }
        }
      }
    },
    {
      name: 'golang',
      description: 'Go programming language compiler and tools',
      category: 'development',
      dependencies: ['glibc', 'gcc'],
      cveCount: 0,
      keywords: ['go', 'golang', 'compiler', 'build', 'development'],
      useCase: 'Go development, building Go applications',
      versions: {
        '1.21': {
          current: '1.21.6',
          releases: {
            '1.21.6': {
              current: 'r0',
              revisions: ['r0'],
              size: '156.7 MB',
              lastUpdated: '2024-01-11'
            },
            '1.21.5': {
              current: 'r1',
              revisions: ['r1', 'r0'],
              size: '156.5 MB',
              lastUpdated: '2023-12-20'
            }
          }
        },
        '1.22': {
          current: '1.22.0',
          releases: {
            '1.22.0': {
              current: 'r1',
              revisions: ['r1', 'r0'],
              size: '158.2 MB',
              lastUpdated: '2024-01-08'
            }
          }
        }
      }
    }
  ];

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const filteredPackages = useMemo(() => {
    let results = packages;

    if (category !== 'all') {
      results = results.filter(pkg => pkg.category === category);
    }

    if (searchTerm.trim()) {
      const searchTerms = searchTerm.toLowerCase().split(' ');
      results = results.filter(pkg =>
        searchTerms.every(term =>
          pkg.name.toLowerCase().includes(term) ||
          pkg.description.toLowerCase().includes(term) ||
          pkg.keywords.some(keyword => keyword.toLowerCase().includes(term)) ||
          pkg.useCase.toLowerCase().includes(term)
        )
      );
    }

    return results;
  }, [searchTerm, category]);

  const getCurrentVersion = (pkg) => {
    // Sort version keys to find the actual latest major version
    // Handles both numeric (18, 20) and semver-like (1.21, 1.22) version strings
    const sortedVersions = Object.keys(pkg.versions).sort((a, b) => {
      // Split by '.' and compare each segment numerically
      const partsA = a.split('.').map(Number);
      const partsB = b.split('.').map(Number);

      for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
        const numA = partsA[i] || 0;
        const numB = partsB[i] || 0;
        if (numA !== numB) {
          return numB - numA; // Descending order (highest first)
        }
      }
      return 0;
    });

    const latestMajor = sortedVersions[0];
    const latestRelease = pkg.versions[latestMajor].current;
    const latestRevision = pkg.versions[latestMajor].releases[latestRelease].current;
    return {
      version: `${latestRelease}-${latestRevision}`,
      size: pkg.versions[latestMajor].releases[latestRelease].size,
      lastUpdated: pkg.versions[latestMajor].releases[latestRelease].lastUpdated
    };
  };

  const togglePackageExpansion = (packageName) => {
    setExpandedPackages(prev => ({
      ...prev,
      [packageName]: !prev[packageName]
    }));
  };

  const toggleVersionExpansion = (packageName, majorVersion) => {
    const key = `${packageName}-${majorVersion}`;
    setExpandedPackages(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

    const getDockerfileExample = (pkg) => {
    const currentVersion = getCurrentVersion(pkg);
    const examples = {
      'nginx': `# Multi-stage build with SecureBuild packages
FROM cve0.io/nginx:1.24.0 AS runtime

# Copy your nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf
COPY html/ /usr/share/nginx/html/

# Set proper permissions
RUN chown -R nginx:nginx /var/log/nginx /var/cache/nginx

# Expose port
EXPOSE 80 443

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
  CMD curl -f http://localhost/ || exit 1

# Run as non-root user
USER nginx

# Start nginx
CMD ["nginx", "-g", "daemon off;"]`,

      'python': `# Multi-stage build for Python application
FROM cve0.io/python:3.11 AS builder

# Install build dependencies
RUN pip install --no-cache-dir poetry

# Copy dependency files
COPY pyproject.toml poetry.lock ./

# Install dependencies
RUN poetry config virtualenvs.create false && \\
    poetry install --no-dev --no-interaction --no-ansi

# Production stage
FROM cve0.io/python:3.11-slim AS runtime

# Copy installed packages from builder
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Create app user
RUN addgroup -g 1001 app && adduser -D -u 1001 -G app app

# Copy application
COPY --chown=app:app src/ /app/

WORKDIR /app

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \\
  CMD python -c "import requests; requests.get('http://localhost:8000/health')" || exit 1

USER app

CMD ["python", "main.py"]`,

      'postgresql': `# PostgreSQL with SecureBuild
FROM cve0.io/postgresql:15.5

# Environment variables
ENV POSTGRES_DB=myapp
ENV POSTGRES_USER=appuser
ENV POSTGRES_PASSWORD=changeme

# Copy initialization scripts
COPY init-scripts/ /docker-entrypoint-initdb.d/

# Copy custom postgresql.conf
COPY postgresql.conf /etc/postgresql/postgresql.conf

# Set proper ownership
RUN chown -R postgres:postgres /var/lib/postgresql/data

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \\
  CMD pg_isready -U $POSTGRES_USER -d $POSTGRES_DB || exit 1

EXPOSE 5432

USER postgres

CMD ["postgres", "-c", "config_file=/etc/postgresql/postgresql.conf"]`,

      'redis': `# Redis with SecureBuild
FROM cve0.io/redis:7.2.4

# Copy custom redis configuration
COPY redis.conf /etc/redis/redis.conf

# Create redis user if not exists and set permissions
RUN chown redis:redis /etc/redis/redis.conf

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
  CMD redis-cli ping || exit 1

EXPOSE 6379

USER redis

CMD ["redis-server", "/etc/redis/redis.conf"]`,

      'nodejs': `# Multi-stage Node.js build
FROM cve0.io/nodejs:18 AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Production stage
FROM cve0.io/nodejs:18-slim AS runtime

# Create app user
RUN addgroup -g 1001 app && adduser -D -u 1001 -G app app

WORKDIR /app

# Copy dependencies from builder
COPY --from=builder --chown=app:app /app/node_modules ./node_modules

# Copy application code
COPY --chown=app:app src/ ./src/

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \\
  CMD curl -f http://localhost:3000/health || exit 1

EXPOSE 3000

USER app

CMD ["node", "src/index.js"]`,

      'golang': `# Multi-stage Go build
FROM cve0.io/golang:1.21 AS builder

WORKDIR /app

# Copy go mod files
COPY go.mod go.sum ./

# Download dependencies
RUN go mod download

# Copy source code
COPY . .

# Build the application
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o main .

# Production stage - minimal runtime
FROM cve0.io/base:latest AS runtime

# Install ca-certificates for HTTPS requests
RUN apk add --no-cache ca-certificates tzdata

# Create app user
RUN addgroup -g 1001 app && adduser -D -u 1001 -G app app

WORKDIR /app

# Copy binary from builder
COPY --from=builder --chown=app:app /app/main .

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \\
  CMD ./main -health || exit 1

EXPOSE 8080

USER app

CMD ["./main"]`
    };

    return examples[pkg.name] || `# Example Dockerfile for ${pkg.name}
FROM cve0.io/${pkg.name}:${currentVersion.version}

# Add your application code and configuration here
COPY . /app/
WORKDIR /app

# Set proper permissions
RUN chown -R app:app /app

# Health check
HEALTHCHECK --interval=30s --timeout=5s CMD your-health-check-command

# Run as non-root user
USER app

# Start your application
CMD ["your-start-command"]`;
  };

     const showDockerfile = (pkg) => {
     setModalContent({
       title: `Dockerfile Usage: ${pkg.name}`,
       content: getDockerfileExample(pkg)
     });
     setShowModal(true);
   };

  return (
    <>
      <div style={{
        maxWidth: '800px',
        margin: '2rem 0',
        border: '1px solid #e1e5e9',
        borderRadius: '8px',
        padding: '1.5rem',
        background: '#f8f9fa'
      }}>
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <h3>SecureBuild Package Library</h3>
          <p>Search <InlinePackageCount fallback="2,000+" /> secure APK packages rebuilt from source</p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <input
            type="text"
            placeholder="Type to search packages... (e.g., web server, python, database)"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              width: '100%',
              padding: '12px 16px',
              border: '2px solid #ddd',
              borderRadius: '6px',
              fontSize: '16px',
              transition: 'border-color 0.2s'
            }}
          />

          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              style={{
                padding: '8px 12px',
                border: '1px solid #ddd',
                borderRadius: '4px'
              }}
            >
              <option value="all">All Categories</option>
              <option value="web-servers">Web Servers</option>
              <option value="databases">Databases</option>
              <option value="runtimes">Language Runtimes</option>
              <option value="development">Development Tools</option>
              <option value="security">Security & Monitoring</option>
            </select>
          </div>
        </div>

        <div style={{ marginTop: '1.5rem', maxHeight: '600px', overflowY: 'auto' }}>
          {searchTerm.trim() === '' && filteredPackages.length === packages.length ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#666' }}>
              Start typing to search packages...
            </div>
          ) : filteredPackages.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#666' }}>
              No packages found. Try different keywords.
            </div>
                    ) : (
            filteredPackages.map((pkg, index) => {
              const currentVersion = getCurrentVersion(pkg);
              const isExpanded = expandedPackages[pkg.name];

              return (
                <div key={index}>
                  {/* Main Package */}
                  <div
                    style={{
                      border: '1px solid #ddd',
                      borderRadius: '6px',
                      padding: '1rem',
                      marginBottom: '0.5rem',
                      background: 'white',
                      transition: 'all 0.2s'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <h4 style={{ margin: 0, color: '#0066cc' }}>{pkg.name}</h4>
                        <span style={{
                          background: '#e1f5fe',
                          color: '#0277bd',
                          padding: '2px 8px',
                          borderRadius: '12px',
                          fontSize: '0.8rem'
                        }}>
                          {currentVersion.version} (latest)
                        </span>
                        <span style={{
                          background: '#e8f5e8',
                          color: '#2e7d32',
                          padding: '2px 8px',
                          borderRadius: '12px',
                          fontSize: '0.8rem'
                        }}>
                          0 CVEs ✅
                        </span>
                      </div>
                      <div style={{ fontWeight: 500, color: '#666' }}>{currentVersion.size}</div>
                    </div>

                    <p style={{ margin: '0.5rem 0' }}>{pkg.description}</p>

                    <div style={{ display: 'flex', gap: '1rem', margin: '0.5rem 0', fontSize: '0.9rem', color: '#666' }}>
                      <span>{pkg.category}</span>
                      <span>{pkg.dependencies.length} dependencies</span>
                      <span>Updated {currentVersion.lastUpdated}</span>
                    </div>

                    <div style={{ margin: '0.5rem 0', fontSize: '0.9rem' }}>
                      <strong>Use case:</strong> {pkg.useCase}
                    </div>

                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
                      <button
                        onClick={() => showDockerfile(pkg)}
                        style={{
                          padding: '6px 12px',
                          border: '1px solid #0066cc',
                          borderRadius: '4px',
                          background: '#0066cc',
                          color: 'white',
                          cursor: 'pointer',
                          fontSize: '0.85rem',
                          transition: 'all 0.2s'
                        }}
                      >
                        🐳 Show Dockerfile Usage
                      </button>

                      <button
                        onClick={() => togglePackageExpansion(pkg.name)}
                        style={{
                          padding: '6px 12px',
                          border: '1px solid #666',
                          borderRadius: '4px',
                          background: 'white',
                          color: '#666',
                          cursor: 'pointer',
                          fontSize: '0.85rem',
                          transition: 'all 0.2s'
                        }}
                      >
                        {isExpanded ? '📦 Hide Previous Versions' : '📦 Show Previous Versions'}
                      </button>
                    </div>
                  </div>

                  {/* Expanded Version History */}
                  {isExpanded && (
                    <div style={{ marginLeft: '1rem', marginBottom: '1rem' }}>
                      {Object.entries(pkg.versions).map(([majorVersion, versionData]) => {
                        const isVersionExpanded = expandedPackages[`${pkg.name}-${majorVersion}`];

                        return (
                          <div key={majorVersion} style={{ marginBottom: '0.5rem' }}>
                            {/* Major Version */}
                            <div
                              style={{
                                border: '1px solid #e0e0e0',
                                borderRadius: '4px',
                                padding: '0.75rem',
                                background: '#f9f9f9',
                                cursor: 'pointer'
                              }}
                              onClick={() => toggleVersionExpansion(pkg.name, majorVersion)}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                  <span style={{ fontWeight: 'bold', color: '#333' }}>
                                    {pkg.name}-{majorVersion}
                                  </span>
                                  <span style={{
                                    background: '#fff3cd',
                                    color: '#856404',
                                    padding: '1px 6px',
                                    borderRadius: '10px',
                                    fontSize: '0.75rem'
                                  }}>
                                    Current: {versionData.current}-{versionData.releases[versionData.current].current}
                                  </span>
                                  <span style={{ fontSize: '0.8rem', color: '#666' }}>
                                    {isVersionExpanded ? '▼' : '▶'} {Object.keys(versionData.releases).length} releases
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* Patch Versions */}
                            {isVersionExpanded && (
                              <div style={{ marginLeft: '1rem', marginTop: '0.5rem' }}>
                                {Object.entries(versionData.releases).map(([patchVersion, releaseData]) => (
                                  <div key={patchVersion} style={{ marginBottom: '0.5rem' }}>
                                    {/* Patch Version */}
                                    <div style={{
                                      border: '1px solid #ddd',
                                      borderRadius: '4px',
                                      padding: '0.5rem',
                                      background: 'white'
                                    }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                          <span style={{ fontWeight: 'bold', color: '#0066cc' }}>
                                            {patchVersion}
                                          </span>
                                          <span style={{
                                            background: patchVersion === versionData.current ? '#d4edda' : '#f8f9fa',
                                            color: patchVersion === versionData.current ? '#155724' : '#6c757d',
                                            padding: '1px 6px',
                                            borderRadius: '10px',
                                            fontSize: '0.75rem'
                                          }}>
                                            {patchVersion === versionData.current ? 'Latest' : 'Legacy'}
                                          </span>
                                        </div>
                                        <div style={{ fontSize: '0.8rem', color: '#666' }}>
                                          {releaseData.size} • {releaseData.lastUpdated}
                                        </div>
                                      </div>

                                      {/* Revisions */}
                                      <div style={{ marginTop: '0.5rem', marginLeft: '1rem' }}>
                                        <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: '0.25rem' }}>
                                          Revisions:
                                        </div>
                                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                          {releaseData.revisions.map((revision) => (
                                            <span
                                              key={revision}
                                              style={{
                                                background: revision === releaseData.current ? '#cce5ff' : '#f0f0f0',
                                                color: revision === releaseData.current ? '#0066cc' : '#666',
                                                padding: '2px 6px',
                                                borderRadius: '8px',
                                                fontSize: '0.75rem',
                                                fontFamily: 'monospace'
                                              }}
                                            >
                                              {patchVersion}-{revision}
                                              {revision === releaseData.current ? ' (current)' : ''}
                                            </span>
                                          ))}
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {showModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            background: 'white',
            borderRadius: '8px',
            maxWidth: '90vw',
            maxHeight: '90vh',
            overflow: 'auto',
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '1rem 1.5rem',
              borderBottom: '1px solid #eee'
            }}>
              <h3 style={{ margin: 0 }}>{modalContent.title}</h3>
              <button
                onClick={() => setShowModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '1.5rem',
                  cursor: 'pointer',
                  padding: 0,
                  width: '30px',
                  height: '30px'
                }}
              >
                ×
              </button>
            </div>
            <div style={{ padding: '1.5rem' }}>
              <pre style={{
                background: '#f6f8fa',
                padding: '1rem',
                borderRadius: '6px',
                overflow: 'auto',
                maxHeight: '60vh'
              }}>
                <code>{modalContent.content}</code>
              </pre>
            </div>
            <div style={{
              padding: '1rem 1.5rem',
              borderTop: '1px solid #eee',
              textAlign: 'right'
            }}>
              <button
                onClick={() => copyToClipboard(modalContent.content)}
                style={{
                  padding: '8px 16px',
                  marginRight: '0.5rem',
                  border: '1px solid #0066cc',
                  borderRadius: '4px',
                  background: 'white',
                  color: '#0066cc',
                  cursor: 'pointer'
                }}
              >
                Copy to Clipboard
              </button>
              <button
                onClick={() => setShowModal(false)}
                style={{
                  padding: '8px 16px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  background: 'white',
                  cursor: 'pointer'
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
