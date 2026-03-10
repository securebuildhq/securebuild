# Database Integration with Pages Router

This directory contains library functions and API routes that work with Nextra's Pages Router architecture.

**API routes call library functions, not access the database directly.**

## Architecture

```
MDX Page → Preloaded App Data → Context → Component
     ↓
API Route → Library Function → Database
```

## Example: Package Count with Preloading

### 1. Library Function (`lib/package/package.ts`)
```typescript
export async function getPackageCount(): Promise<PackageCount> {
  const db = getDB(await getParam("DB_URI"));
  // Database logic here
}
```

### 2. API Route (`pages/api/package-count.ts`)
```typescript
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const count = await getPackageCount(); // Calls library function
  res.json(count);
}
```

### 3. App-Level Preloading (`pages/_app.tsx`)
```typescript
function App({ Component, pageProps, packageCount: serverPackageCount }: CustomAppProps) {
  const [clientPackageCount, setClientPackageCount] = useState(null);

  // Preload package count on app start if not from server
  useEffect(() => {
    if (!serverPackageCount) {
      fetch('/api/package-count')
        .then(res => res.json())
        .then(data => setClientPackageCount(data));
    }
  }, [serverPackageCount]);

  const packageCount = serverPackageCount || clientPackageCount;
  
  return (
    <PackageCountProvider packageCount={packageCount}>
      <Component {...pageProps} />
    </PackageCountProvider>
  );
}
```

### 4. Simple Component (`components/PackageCount.tsx`)
```typescript
export function PackageCount({ fallback = "over 2,000" }: PackageCountProps) {
  const { packageCount } = usePackageCount();
  
  return <span>{packageCount?.formatted || fallback}</span>;
}
```

### 5. Usage in MDX (`pages/package-library.mdx`)
```mdx
import { InlinePackageCount } from '../components/PackageCount';

Our library contains <InlinePackageCount /> APK packages.
```

## Environment Setup

Make sure to set the database URI environment variable:
```bash
export DB_URI="postgresql://user:pass@host:5432/db"
# or
export SECUREBUILD_PG_URI="postgresql://user:pass@host:5432/db"
```

## Benefits

- **Pages Router Compatible**: Works with Nextra's Pages Router architecture
- **Separation of Concerns**: Database logic stays in library functions
- **Client-Side Updates**: Components can update dynamically
- **Graceful Fallbacks**: Shows fallback content while loading and on errors
- **API-First**: Can be used by external clients if needed 
