# Claude Development Notes

## Git Commit Signing Requirements

**CRITICAL: ALL COMMITS MUST BE GPG SIGNED**

- **Never use `--no-gpg-sign`** or bypass GPG signing
- When running `git commit`, if the command appears to hang or wait, **immediately notify the user that GPG signing is required**
- Common GPG signing scenarios:
  - Regular commits: `git commit -m "message"` (will prompt for GPG passphrase)
  - Merge commits: `git merge origin/main` (will prompt for GPG passphrase)
  - Interactive rebase: `git rebase -i` (will prompt for each commit)

**Proper workflow:**
1. Run the git command
2. If it hangs/waits, immediately tell user: "Waiting for GPG signature - please enter your passphrase"
3. Let user handle the GPG signing
4. Continue with next steps after user completes signing

**Never attempt to bypass signing** - all commits in this repository must be signed.

## Build Commands

Use `make build-worker` instead of `go build ./pkg` for building the Go project.

### TypeScript Projects

For the TypeScript web project (`securebuild-app`):

**Install dependencies:**
```bash
cd securebuild-app && npm install
```

**Type checking:**
```bash
cd securebuild-app && npx tsc --noEmit
```

**Linting:**
```bash
cd securebuild-app && npm run lint
```

**Build for production:**
```bash
cd securebuild-app && npm run build
```

**Development server:**
```bash
cd securebuild-app && npm run dev  # Runs on port 3000
```

## Nextra + Server-Side Data Pattern

When adding server-side data to Nextra docs (Pages Router), follow this pattern to avoid breaking theming/navigation while eliminating flash content.

### Problem
- MDX files in Nextra use Pages Router (not App Router)
- Server Components with "server-only" imports break client-side navigation
- Converting MDX to TSX breaks Nextra theming and sidebar navigation
- Client-side fetching causes flash from fallback → real data

### Solution: App-Level Preloading with Context

**Architecture:**
```
MDX Page → Preloaded App Data → Context → Component
     ↓
API Route → Library Function → Database
```

### Implementation Steps

#### 1. Create API Route (`pages/api/your-data.ts`)
```typescript
import type { NextApiRequest, NextApiResponse } from 'next';
import { getYourData } from '../../lib/your-service/service';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (!process.env.DB_URI) {
      return res.json({ data: "fallback", success: true });
    }

    const data = await getYourData();
    return res.json({ data, success: true });
  } catch (error) {
    return res.json({ data: "fallback", success: false, error: error.message });
  }
}
```

#### 2. Create Context Provider (`lib/context/YourDataContext.tsx`)
```typescript
import React, { createContext, useContext } from 'react';

interface YourDataContextType {
  yourData: YourDataType | null;
}

const YourDataContext = createContext<YourDataContextType>({ yourData: null });

export function YourDataProvider({ children, yourData }: { children: React.ReactNode, yourData: YourDataType | null }) {
  return (
    <YourDataContext.Provider value={{ yourData }}>
      {children}
    </YourDataContext.Provider>
  );
}

export function useYourData(): YourDataContextType {
  return useContext(YourDataContext);
}
```

#### 3. App-Level Preloading (`pages/_app.tsx`)
```typescript
import type { AppProps, AppContext } from 'next/app';
import { YourDataProvider } from '../lib/context/YourDataContext';
import { useEffect, useState } from 'react';

function App({ Component, pageProps, yourData: serverYourData }: CustomAppProps) {
  const [clientYourData, setClientYourData] = useState(null);
  const [hasPreloaded, setHasPreloaded] = useState(false);

  // Preload data on client-side app start if not from server
  useEffect(() => {
    if (!serverYourData && !hasPreloaded) {
      setHasPreloaded(true);
      
      fetch('/api/your-data')
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            setClientYourData(data.data);
          }
        })
        .catch(console.warn);
    }
  }, [serverYourData, hasPreloaded]);

  const yourData = serverYourData || clientYourData;

  return (
    <YourDataProvider yourData={yourData}>
      <Component {...pageProps} />
    </YourDataProvider>
  );
}

// Optional: Server-side data for specific pages
App.getInitialProps = async (appContext: AppContext) => {
  let yourData = null;

  try {
    if (typeof window === 'undefined' && appContext.ctx.pathname === '/your-page') {
      const { getYourData } = await import('../lib/your-service/service');
      yourData = await getYourData();
    }
  } catch (error) {
    console.error('Error fetching data in _app:', error);
  }

  return { yourData };
};

export default App;
```

#### 4. Simple Component (`components/YourComponent.tsx`)
```typescript
import React from 'react';
import { useYourData } from '../lib/context/YourDataContext';

export function YourComponent({ fallback = "default" }) {
  const { yourData } = useYourData();
  
  return <span>{yourData || fallback}</span>;
}
```

#### 5. Use in MDX (`pages/your-page.mdx`)
```mdx
import { YourComponent } from '../components/YourComponent';

# Your Page

Our data shows <YourComponent /> results.
```

### Key Benefits
- ✅ **No Flash:** Data preloaded at app level
- ✅ **Nextra Compatible:** MDX files keep theming/navigation  
- ✅ **Smart Caching:** One API call per session
- ✅ **Graceful Fallbacks:** Works without database
- ✅ **Server-Side First:** Optimization for direct page loads

### Database Integration Notes
- Library functions should handle database logic (`lib/your-service/`)
- API routes call library functions, never access DB directly
- Use dynamic imports in `_app.tsx` to avoid bundling DB modules client-side
- Server actions pattern: **API routes call library functions, not DB directly**
