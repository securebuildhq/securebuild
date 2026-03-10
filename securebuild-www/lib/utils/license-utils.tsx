import Link from "next/link"
import { Badge } from "@/components/ui/badge"

// Function to get spdx.org URL for a license
export const getLicenseUrl = (license: string) => {
  // Clean up the license identifier for SPDX URL format
  // SPDX URLs use the exact identifier followed by .html
  const cleanLicense = license.trim();
  return `https://spdx.org/licenses/${cleanLicense}.html`;
}

// Comprehensive SPDX license validation and URL generation
export const validateAndGetLicenseUrl = (license: string) => {
  // Common SPDX license identifiers (subset of most common ones)
  const validSpdxLicenses = new Set([
    // Popular licenses
    'MIT', 'Apache-2.0', 'BSD-3-Clause', 'BSD-2-Clause', 'GPL-2.0-only', 'GPL-2.0-or-later',
    'GPL-3.0-only', 'GPL-3.0-or-later', 'LGPL-2.1-only', 'LGPL-2.1-or-later', 'LGPL-3.0-only', 
    'LGPL-3.0-or-later', 'AGPL-3.0-only', 'AGPL-3.0-or-later', 'ISC', 'MPL-2.0', 'CC0-1.0',
    
    // Additional common licenses
    'Apache-1.0', 'Apache-1.1', 'BSD-4-Clause', 'BSL-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0',
    'EPL-1.0', 'EPL-2.0', 'GPL-1.0-only', 'GPL-1.0-or-later', 'LGPL-2.0-only', 'LGPL-2.0-or-later',
    'MIT-0', 'MS-PL', 'MS-RL', 'NCSA', 'OFL-1.1', 'PostgreSQL', 'Python-2.0', 'Unlicense',
    'Zlib', 'WTFPL', 'X11', 'Artistic-1.0', 'Artistic-2.0', 'Ruby', 'JSON', 'CDDL-1.0', 'CDDL-1.1',
    
    // More specific versions
    'BSD-2-Clause-Patent', 'BSD-3-Clause-Clear', 'CC-BY-3.0', 'CC-BY-SA-3.0', 'EUPL-1.2',
    'GFDL-1.3-only', 'GFDL-1.3-or-later', 'LPPL-1.3c', 'ODbL-1.0', 'OLDAP-2.8', 'OSL-3.0',
    'AFL-3.0', 'APSL-2.0', 'CECILL-2.1', 'EUPL-1.1', 'LPPL-1.0', 'LPPL-1.1', 'LPPL-1.2',
    'LPPL-1.3a', 'LPPL-1.3b', 'OLDAP-1.1', 'OLDAP-1.2', 'OLDAP-1.3', 'OLDAP-1.4', 'OLDAP-2.0',
    'OLDAP-2.1', 'OLDAP-2.2', 'OLDAP-2.3', 'OLDAP-2.4', 'OLDAP-2.5', 'OLDAP-2.6', 'OLDAP-2.7',
    
    // Additional commonly seen licenses
    'Libpng', 'FTL', 'Blessing', 'HPND', 'IJG', 'libtiff', 'Imlib2', 'Spencer-86', 'Spencer-94',
    'Spencer-99', 'TCL', 'Vim', 'FSFAP', 'FSFUL', 'FSFULLR', 'SSH-OpenSSH', 'SSH-short',
    'OpenSSL', 'SSLeay', 'Beerware'
  ]);

  // Handle deprecated license mappings (includes exception licenses)
  const deprecatedLicenseMap: { [key: string]: string } = {
    // Basic deprecated mappings
    'GPL-2.0': 'GPL-2.0-only',
    'GPL-2.0+': 'GPL-2.0-or-later', 
    'GPL-3.0': 'GPL-3.0-only',
    'GPL-3.0+': 'GPL-3.0-or-later',
    'LGPL-2.0': 'LGPL-2.0-only',
    'LGPL-2.0+': 'LGPL-2.0-or-later',
    'LGPL-2.1': 'LGPL-2.1-only',
    'LGPL-2.1+': 'LGPL-2.1-or-later',
    'LGPL-3.0': 'LGPL-3.0-only',
    'LGPL-3.0+': 'LGPL-3.0-or-later',
    'AGPL-3.0': 'AGPL-3.0-only',
    'GFDL-1.3': 'GFDL-1.3-only',

    // Deprecated exception licenses - map to modern WITH expressions
    'GPL-2.0-with-autoconf-exception': 'GPL-2.0-only WITH Autoconf-exception-2.0',
    'GPL-2.0-with-bison-exception': 'GPL-2.0-only WITH Bison-exception-2.2',
    'GPL-2.0-with-classpath-exception': 'GPL-2.0-only WITH Classpath-exception-2.0',
    'GPL-2.0-with-font-exception': 'GPL-2.0-only WITH Font-exception-2.0',
    'GPL-2.0-with-GCC-exception': 'GPL-2.0-only WITH GCC-exception-2.0',
    'GPL-3.0-with-autoconf-exception': 'GPL-3.0-or-later WITH Autoconf-exception-3.0',
    'GPL-3.0-with-GCC-exception': 'GPL-3.0-or-later WITH GCC-exception-3.1',

    // Additional deprecated exception formats
    'GPL-2.0-or-later-with-autoconf-exception': 'GPL-2.0-or-later WITH Autoconf-exception-2.0',
    'GPL-2.0-or-later-with-bison-exception': 'GPL-2.0-or-later WITH Bison-exception-2.2',
    'GPL-2.0-or-later-with-classpath-exception': 'GPL-2.0-or-later WITH Classpath-exception-2.0',
    'GPL-2.0-or-later-with-font-exception': 'GPL-2.0-or-later WITH Font-exception-2.0',
    'GPL-2.0-or-later-with-GCC-exception': 'GPL-2.0-or-later WITH GCC-exception-2.0',
    'GPL-3.0-or-later-with-autoconf-exception': 'GPL-3.0-or-later WITH Autoconf-exception-3.0',
    'GPL-3.0-or-later-with-GCC-exception': 'GPL-3.0-or-later WITH GCC-exception-3.1'
  };

  const cleanLicense = license.trim();
  
  // Check for deprecated license mapping first (includes exception mappings)
  if (deprecatedLicenseMap[cleanLicense]) {
    const modernExpression = deprecatedLicenseMap[cleanLicense];
    // For WITH expressions, link to the base license page
    if (modernExpression.includes(' WITH ')) {
      const baseLicense = modernExpression.split(' WITH ')[0];
      return {
        isValid: true,
        url: getLicenseUrl(baseLicense),
        displayLicense: cleanLicense,
        actualLicense: modernExpression,
        isDeprecated: true
      };
    }
    return {
      isValid: true,
      url: getLicenseUrl(modernExpression),
      displayLicense: cleanLicense,
      actualLicense: modernExpression,
      isDeprecated: true
    };
  }

  // Handle modern WITH expressions (e.g., "GPL-3.0-or-later WITH GCC-exception-3.1")
  if (cleanLicense.includes(' WITH ')) {
    const parts = cleanLicense.split(' WITH ');
    const baseLicense = parts[0].trim();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const exception = parts[1].trim();
    
    // Check if base license is valid
    const mappedBase = deprecatedLicenseMap[baseLicense] || baseLicense;
    if (validSpdxLicenses.has(mappedBase)) {
      return {
        isValid: true,
        url: getLicenseUrl(mappedBase),
        displayLicense: cleanLicense,
        actualLicense: cleanLicense,
        hasException: true
      };
    }
  }

  // Check if it's a valid SPDX license
  if (validSpdxLicenses.has(cleanLicense)) {
    return {
      isValid: true,
      url: getLicenseUrl(cleanLicense),
      displayLicense: cleanLicense,
      actualLicense: cleanLicense
    };
  }

  // Handle licenses with exceptions (older format: e.g., GPL-2.0-with-autoconf-exception)
  const withExceptionMatch = cleanLicense.match(/^(.+?)-with-.+$/i);
  if (withExceptionMatch) {
    const baseLicense = withExceptionMatch[1];
    const mappedBase = deprecatedLicenseMap[baseLicense] || baseLicense;
    if (validSpdxLicenses.has(mappedBase)) {
      return {
        isValid: true,
        url: getLicenseUrl(mappedBase),
        displayLicense: cleanLicense,
        actualLicense: mappedBase,
        hasException: true
      };
    }
  }

  // Handle version variations (e.g., convert "3.0" to "3-0" if needed)
  const versionVariant = cleanLicense.replace(/(\d)\.(\d)/g, '$1-$2');
  if (validSpdxLicenses.has(versionVariant)) {
    return {
      isValid: true,
      url: getLicenseUrl(versionVariant),
      displayLicense: cleanLicense,
      actualLicense: versionVariant
    };
  }

  // If no match found, return invalid but still provide a link attempt
  return {
    isValid: false,
    url: getLicenseUrl(cleanLicense),
    displayLicense: cleanLicense,
    actualLicense: cleanLicense
  };
}

// Function to parse complex license expressions and render appropriate links
export const renderLicenseLinks = (licenseExpression: string) => {
  if (!licenseExpression || licenseExpression === "NOASSERTION") {
    return <span className="text-muted-foreground text-sm">Not specified</span>;
  }

  // Handle AND expressions - create links for each license
  if (licenseExpression.includes(' AND ')) {
    const licenses = licenseExpression.split(' AND ').map(l => l.trim());
    return (
      <div className="flex flex-wrap gap-1">
        {licenses.map((license, index) => {
          const licenseInfo = validateAndGetLicenseUrl(license);
          const tooltipText = licenseInfo.isDeprecated 
            ? `Deprecated license: ${license} → Modern: ${licenseInfo.actualLicense}`
            : licenseInfo.hasException 
              ? `License with exception: ${licenseInfo.actualLicense}`
              : licenseInfo.isValid 
                ? `Valid SPDX license: ${licenseInfo.actualLicense}` 
                : `Unvalidated license: ${license}`;

          return (
            <span key={index} className="flex items-center gap-1">
              <Link 
                href={licenseInfo.url} 
                target="_blank" 
                rel="noopener noreferrer" 
                title={tooltipText}
              >
                <Badge 
                  variant="outline" 
                  className={`hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer text-xs ${
                    licenseInfo.isValid ? '' : 'border-orange-300 text-orange-600'
                  }`}
                >
                  {licenseInfo.displayLicense}
                </Badge>
              </Link>
              {index < licenses.length - 1 && <span className="text-xs text-muted-foreground">AND</span>}
            </span>
          );
        })}
      </div>
    );
  }

  // Handle OR expressions - create links for each option
  if (licenseExpression.includes(' OR ')) {
    const licenses = licenseExpression.split(' OR ').map(l => l.trim());
    return (
      <div className="flex flex-wrap gap-1">
        {licenses.map((license, index) => {
          const licenseInfo = validateAndGetLicenseUrl(license);
          const tooltipText = licenseInfo.isDeprecated 
            ? `Deprecated license: ${license} → Modern: ${licenseInfo.actualLicense}`
            : licenseInfo.hasException 
              ? `License with exception: ${licenseInfo.actualLicense}`
              : licenseInfo.isValid 
                ? `Valid SPDX license: ${licenseInfo.actualLicense}` 
                : `Unvalidated license: ${license}`;

          return (
            <span key={index} className="flex items-center gap-1">
              <Link 
                href={licenseInfo.url} 
                target="_blank" 
                rel="noopener noreferrer" 
                title={tooltipText}
              >
                <Badge 
                  variant="outline" 
                  className={`hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer text-xs ${
                    licenseInfo.isValid ? '' : 'border-orange-300 text-orange-600'
                  }`}
                >
                  {licenseInfo.displayLicense}
                </Badge>
              </Link>
              {index < licenses.length - 1 && <span className="text-xs text-muted-foreground">OR</span>}
            </span>
          );
        })}
      </div>
    );
  }

  // Single license case
  const licenseInfo = validateAndGetLicenseUrl(licenseExpression);
  const tooltipText = licenseInfo.isDeprecated 
    ? `Deprecated license: ${licenseExpression} → Modern: ${licenseInfo.actualLicense}`
    : licenseInfo.hasException 
      ? `License with exception: ${licenseInfo.actualLicense}`
      : licenseInfo.isValid 
        ? `Valid SPDX license: ${licenseInfo.actualLicense}` 
        : `Unvalidated license: ${licenseExpression}`;

  return (
    <Link 
      href={licenseInfo.url} 
      target="_blank" 
      rel="noopener noreferrer" 
      title={tooltipText}
    >
      <Badge 
        variant="outline" 
        className={`hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer ${
          licenseInfo.isValid ? '' : 'border-orange-300 text-orange-600'
        }`}
      >
        {licenseInfo.displayLicense}
      </Badge>
    </Link>
  );
}

// Function to render license badges for the summary section
export const renderLicenseSummaryBadge = (license: string, index: number) => {
  // For AND/OR expressions in summary, show as single badge but validate properly
  if (license.includes(' AND ') || license.includes(' OR ')) {
    // For OR expressions, check if ANY license is valid
    // For AND expressions, check if ALL licenses are valid
    const isOrExpression = license.includes(' OR ');
    const licenses = license.split(isOrExpression ? ' OR ' : ' AND ').map(l => l.trim());
    
    let isExpressionValid = false;
    let firstValidLicense = licenses[0]; // fallback
    let firstValidLicenseInfo = validateAndGetLicenseUrl(firstValidLicense);
    
    if (isOrExpression) {
      // For OR: valid if ANY license is valid
      for (const singleLicense of licenses) {
        const info = validateAndGetLicenseUrl(singleLicense);
        if (info.isValid) {
          isExpressionValid = true;
          firstValidLicense = singleLicense;
          firstValidLicenseInfo = info;
          break; // Found a valid one, that's enough for OR
        }
      }
    } else {
      // For AND: valid if ALL licenses are valid
      isExpressionValid = licenses.every(singleLicense => {
        const info = validateAndGetLicenseUrl(singleLicense);
        if (info.isValid && firstValidLicense === licenses[0]) {
          firstValidLicense = singleLicense;
          firstValidLicenseInfo = info;
        }
        return info.isValid;
      });
    }

    const tooltipText = `Complex license expression: ${license}. ${
      firstValidLicenseInfo.isDeprecated 
        ? `Contains deprecated license: ${firstValidLicense} → ${firstValidLicenseInfo.actualLicense}`
        : `Linking to ${isOrExpression ? 'first valid' : 'first'} license: ${firstValidLicenseInfo.actualLicense}`
    }`;

    return (
      <Link 
        key={index} 
        href={firstValidLicenseInfo.url} 
        target="_blank" 
        rel="noopener noreferrer" 
        title={tooltipText}
      >
        <Badge 
          variant="secondary" 
          className={`text-xs hover:bg-gray-200 dark:hover:bg-gray-700 cursor-pointer ${
            isExpressionValid ? '' : 'bg-orange-100 text-orange-600 dark:bg-orange-900 dark:text-orange-300'
          }`}
        >
          {license}
        </Badge>
      </Link>
    );
  }

  // Single license (potentially with exceptions/or-later)
  const licenseInfo = validateAndGetLicenseUrl(license);
  const tooltipText = licenseInfo.isDeprecated 
    ? `Deprecated license: ${license} → Modern: ${licenseInfo.actualLicense}`
    : licenseInfo.hasException 
      ? `License with exception: ${licenseInfo.actualLicense}`
      : licenseInfo.isValid 
        ? `Valid SPDX license: ${licenseInfo.actualLicense}` 
        : `Unvalidated license: ${license}`;

  return (
    <Link 
      key={index} 
      href={licenseInfo.url} 
      target="_blank" 
      rel="noopener noreferrer" 
      title={tooltipText}
    >
      <Badge 
        variant="secondary" 
        className={`text-xs hover:bg-gray-200 dark:hover:bg-gray-700 cursor-pointer ${
          licenseInfo.isValid ? '' : 'bg-orange-100 text-orange-600 dark:bg-orange-900 dark:text-orange-300'
        }`}
      >
        {licenseInfo.displayLicense}
      </Badge>
    </Link>
  );
} 