/**
 * SBOM Merger - Merges multiple SPDX SBOM documents into a single combined document
 */

import { createHash } from 'crypto';

export interface ExtractedLicensingInfo {
  licenseId: string;
  extractedText: string;
  name?: string;
  crossRefs?: string[];
  comment?: string;
}

export interface SPDXDocument {
  SPDXID: string;
  name: string;
  dataLicense: string;
  creationInfo: CreationInfo;
  packages: SPDXPackage[];
  relationships: SPDXRelationship[];
  documentNamespace: string;
  spdxVersion: string;
  documentDescribes?: string[];
  externalDocumentRefs?: ExternalDocumentRef[];
  files?: SPDXFile[];
  snippets?: SPDXSnippet[];
  annotations?: SPDXAnnotation[];
  hasExtractedLicensingInfos?: ExtractedLicensingInfo[];
  // reviewInformation is deprecated in SPDX 2.3
}

export interface CreationInfo {
  created: string;
  creators: string[];
  licenseListVersion?: string;
}

export interface SPDXPackage {
  SPDXID: string;
  name: string;
  downloadLocation: string;
  filesAnalyzed: boolean;
  externalRefs?: ExternalRef[];
  licenseConcluded?: string;
  licenseDeclared?: string;
  copyrightText?: string;
  versionInfo?: string;
  supplier?: string;
  originator?: string;
  packageFileName?: string;
  packageVerificationCode?: VerificationCode;
  checksums?: CheckSum[];
  homepage?: string;
  sourceInfo?: string;
  summary?: string;
  description?: string;
  comment?: string;
  attributionTexts?: string[];
}

export interface ExternalRef {
  referenceCategory: string;
  referenceType: string;
  referenceLocator: string;
  comment?: string;
}

export interface VerificationCode {
  packageVerificationCodeValue: string;
  packageVerificationCodeExcludedFiles?: string[];
}

export interface CheckSum {
  algorithm: string;
  checksumValue: string;
}

export interface SPDXRelationship {
  spdxElementId: string;
  relationshipType: string;
  relatedSpdxElement: string;
  comment?: string;
}

export interface ExternalDocumentRef {
  externalDocumentId: string;
  spdxDocument: string;
  checksum: CheckSum;
}

export interface SPDXFile {
  SPDXID: string;
  fileName: string;
  checksums?: CheckSum[];
  licenseConcluded?: string;
  copyrightText?: string;
  comment?: string;
}

export interface SPDXSnippet {
  SPDXID: string;
  snippetFromFile: string;
  ranges?: SPDXSnippetRange[];
  licenseConcluded?: string;
  copyrightText?: string;
  comment?: string;
  name?: string;
  snippetAttributionTexts?: string[];
}

export interface SPDXSnippetRange {
  startPointer: SPDXSnippetPointer;
  endPointer: SPDXSnippetPointer;
}

export interface SPDXSnippetPointer {
  offset?: number;
  lineNumber?: number;
  reference: string;
}

export interface SPDXAnnotation {
  spdxElementId: string;
  annotationType: string;
  annotator: string;
  annotationDate: string;
  annotationComment: string;
}

/**
 * Merges multiple SBOM JSON strings into a single combined SBOM
 */
export function mergeSBOMs(sbomStrings: string[]): string {
  if (sbomStrings.length === 0) {
    throw new Error('No SBOMs provided for merging');
  }

  if (sbomStrings.length === 1) {
    // Single SBOM, return as-is
    return sbomStrings[0];
  }

  console.log(`Merging ${sbomStrings.length} SBOMs`);

  const sbomDocs: SPDXDocument[] = [];
  
  // Parse all SBOM documents
  for (let i = 0; i < sbomStrings.length; i++) {
    try {
      const doc = JSON.parse(sbomStrings[i]) as SPDXDocument;
      sbomDocs.push(doc);
    } catch (error) {
      console.warn(`Failed to parse SBOM document ${i}:`, error);
      throw new Error(`Failed to parse SBOM document ${i}: ${error}`);
    }
  }

  // Create merged document
  const merged = createMergedDocument(sbomDocs);

  // Convert back to JSON
  const mergedJSON = JSON.stringify(merged, null, 2);

  console.log(`Successfully merged SBOMs - Total packages: ${merged.packages.length}, Total relationships: ${merged.relationships.length}`);

  return mergedJSON;
}

/**
 * Creates a new merged SPDX document from multiple input documents
 */
function createMergedDocument(docs: SPDXDocument[]): SPDXDocument {
  const now = new Date().toISOString();
  
  const merged: SPDXDocument = {
    SPDXID: 'SPDXRef-DOCUMENT',
    name: 'Combined SBOM',
    dataLicense: 'CC0-1.0',
    creationInfo: {
      created: now,
      creators: ['Tool: SecureBuild SBOM Merger'],
    },
    spdxVersion: 'SPDX-2.3',
    documentNamespace: `https://securebuild.io/merged-sbom/${Date.now()}`,
    packages: [],
    relationships: [],
    documentDescribes: [],
    externalDocumentRefs: [],
    files: [],
    snippets: [],
    annotations: [],
    hasExtractedLicensingInfos: [],
  };

  const packageMap = new Map<string, SPDXPackage>(); // key: packageId, value: package
  const relationshipSet = new Map<string, SPDXRelationship>(); // key: serialized relationship, value: relationship
  const externalDocRefs = new Map<string, ExternalDocumentRef>();
  const allFiles = new Map<string, SPDXFile>();
  const allSnippets = new Map<string, SPDXSnippet>();
  const allAnnotations = new Map<string, SPDXAnnotation>();
  const allExtractedLicensingInfo = new Map<string, ExtractedLicensingInfo>();
  const spdxIdMapping = new Map<string, string>(); // Maps original SPDX IDs to final merged SPDX IDs

  // Merge packages, avoiding duplicates
  docs.forEach((doc, docIndex) => {
    const docPrefix = `Doc${docIndex}`;
    
    // Add external document reference
    if (doc.documentNamespace) {
      // Generate a proper checksum based on the document namespace
      const hash = createHash('sha1').update(doc.documentNamespace).digest('hex');
      
      externalDocRefs.set(doc.documentNamespace, {
        externalDocumentId: `DocumentRef-${docPrefix}`,
        spdxDocument: doc.documentNamespace,
        checksum: {
          algorithm: 'SHA1',
          checksumValue: hash,
        },
      });
    }

    doc.packages.forEach(pkg => {
      // First, create the package with prefixed SPDX ID
      const newPkg = {
        ...pkg,
        SPDXID: `SPDXRef-${docPrefix}-${pkg.SPDXID.replace(/^SPDXRef-/, '')}`,
      };
      
      // Create a unique package identifier based on name, version, and transformed SPDX ID
      const packageKey = createPackageKey(newPkg);
      
      const existingPkg = packageMap.get(packageKey);
      if (existingPkg) {
        // Package already exists, merge external refs and other metadata
        const mergedPkg = mergePackages(existingPkg, newPkg);
        packageMap.set(packageKey, mergedPkg);
        
        // Map the new package's SPDX ID to the existing package's SPDX ID
        spdxIdMapping.set(newPkg.SPDXID, existingPkg.SPDXID);
      } else {
        // New package, add to map
        packageMap.set(packageKey, newPkg);
        // Map the package's SPDX ID to itself (no change)
        spdxIdMapping.set(newPkg.SPDXID, newPkg.SPDXID);
      }
    });

    // Merge relationships with updated SPDX IDs
    doc.relationships.forEach(rel => {
      const newRel: SPDXRelationship = {
        spdxElementId: resolveFinalSPDXID(rel.spdxElementId, docPrefix, doc.SPDXID, spdxIdMapping),
        relationshipType: rel.relationshipType,
        relatedSpdxElement: resolveFinalSPDXID(rel.relatedSpdxElement, docPrefix, doc.SPDXID, spdxIdMapping),
        comment: rel.comment,
      };
      
      const relKey = `${newRel.spdxElementId}-${newRel.relationshipType}-${newRel.relatedSpdxElement}`;
      relationshipSet.set(relKey, newRel);
    });

    // Merge other collections
    doc.files?.forEach(file => {
      const newFile = {
        ...file,
        SPDXID: `SPDXRef-${docPrefix}-${file.SPDXID.replace(/^SPDXRef-/, '')}`,
      };
      allFiles.set(newFile.SPDXID, newFile);
    });

    doc.snippets?.forEach(snippet => {
      const newSnippet = {
        ...snippet,
        SPDXID: `SPDXRef-${docPrefix}-${snippet.SPDXID.replace(/^SPDXRef-/, '')}`,
      };
      allSnippets.set(newSnippet.SPDXID, newSnippet);
    });

    doc.annotations?.forEach(annotation => {
      const newAnnotation = {
        ...annotation,
        spdxElementId: updateSPDXID(annotation.spdxElementId, docPrefix, doc.SPDXID),
      };
      allAnnotations.set(`${newAnnotation.spdxElementId}-${newAnnotation.annotationDate}`, newAnnotation);
    });

    // Merge extracted licensing info, deduplicating by licenseId (case-insensitive)
    doc.hasExtractedLicensingInfos?.forEach((licenseInfo: ExtractedLicensingInfo) => {
      // Use lowercase licenseId as key for case-insensitive deduplication
      const normalizedKey = licenseInfo.licenseId.toLowerCase();
      
      // Only add if we haven't seen this license (case-insensitive) before
      if (!allExtractedLicensingInfo.has(normalizedKey)) {
        allExtractedLicensingInfo.set(normalizedKey, licenseInfo);
      }
    });

    // reviewInformation is deprecated in SPDX 2.3
  });

  // Convert maps back to arrays
  merged.packages = Array.from(packageMap.values());
  merged.relationships = Array.from(relationshipSet.values());
  merged.externalDocumentRefs = Array.from(externalDocRefs.values());
  merged.files = Array.from(allFiles.values());
  merged.snippets = Array.from(allSnippets.values());
  merged.annotations = Array.from(allAnnotations.values());
  merged.hasExtractedLicensingInfos = Array.from(allExtractedLicensingInfo.values());

  // Add document describes relationships for the merged packages
  merged.documentDescribes = merged.packages
    .filter(pkg => pkg.SPDXID !== 'SPDXRef-DOCUMENT')
    .map(pkg => pkg.SPDXID);

  return merged;
}

/**
 * Creates a unique key for a package based on its identifying characteristics
 */
function createPackageKey(pkg: SPDXPackage): string {
  // Use name, version, and primary external ref (like package manager info) as key
  let key = `${pkg.name}:${pkg.versionInfo || ''}`;
  
  // Add primary external reference for more specificity
  const primaryRef = pkg.externalRefs?.find(ref => 
    ref.referenceCategory === 'PACKAGE-MANAGER' || ref.referenceCategory === 'PACKAGE_MANAGER'
  );
  
  if (primaryRef) {
    key += `:${primaryRef.referenceType}:${primaryRef.referenceLocator}`;
  }
  
  return key;
}

/**
 * Merges two packages with the same key, combining their metadata
 */
function mergePackages(existing: SPDXPackage, newPkg: SPDXPackage): SPDXPackage {
  const merged = { ...existing };
  
  // Merge external references, avoiding duplicates
  const existingRefKeys = new Set(
    existing.externalRefs?.map(ref => `${ref.referenceCategory}:${ref.referenceType}:${ref.referenceLocator}`) || []
  );
  
  const newRefs = newPkg.externalRefs?.filter(ref => {
    const key = `${ref.referenceCategory}:${ref.referenceType}:${ref.referenceLocator}`;
    return !existingRefKeys.has(key);
  }) || [];
  
  merged.externalRefs = [...(existing.externalRefs || []), ...newRefs];
  
  // Merge checksums
  const existingChecksumKeys = new Set(
    existing.checksums?.map(checksum => `${checksum.algorithm}:${checksum.checksumValue}`) || []
  );
  
  const newChecksums = newPkg.checksums?.filter(checksum => {
    const key = `${checksum.algorithm}:${checksum.checksumValue}`;
    return !existingChecksumKeys.has(key);
  }) || [];
  
  merged.checksums = [...(existing.checksums || []), ...newChecksums];
  
  // Prefer more specific license information
  if (merged.licenseConcluded === 'NOASSERTION' && newPkg.licenseConcluded !== 'NOASSERTION') {
    merged.licenseConcluded = newPkg.licenseConcluded;
  }
  if (merged.licenseDeclared === 'NOASSERTION' && newPkg.licenseDeclared !== 'NOASSERTION') {
    merged.licenseDeclared = newPkg.licenseDeclared;
  }
  
  return merged;
}

/**
 * Resolves the final SPDX ID after applying document prefix and deduplication mapping
 */
function resolveFinalSPDXID(id: string, docPrefix: string, originalDocID: string, spdxIdMapping: Map<string, string>): string {
  // First apply document prefix transformation
  const prefixedId = updateSPDXID(id, docPrefix, originalDocID);
  
  // Then check if this ID has been mapped due to package deduplication
  return spdxIdMapping.get(prefixedId) || prefixedId;
}

/**
 * Updates SPDX IDs with document prefix, handling special cases
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function updateSPDXID(id: string, docPrefix: string, originalDocID: string): string {
  if (id === 'SPDXRef-DOCUMENT') {
    // For relationships, we should reference the main document, not create a DocumentRef-
    // DocumentRef- prefixes are for external document references, not SPDX elements
    return 'SPDXRef-DOCUMENT';
  }
  
  if (id.startsWith('DocumentRef-')) {
    return id; // Already a document reference
  }
  
  if (id.startsWith('SPDXRef-')) {
    return `SPDXRef-${docPrefix}-${id.replace(/^SPDXRef-/, '')}`;
  }
  
  return `SPDXRef-${docPrefix}-${id}`;
}