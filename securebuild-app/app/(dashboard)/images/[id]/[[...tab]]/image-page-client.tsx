"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Calendar, Clock, Package, Tag, Save, Edit3, X, Plus, Trash2, Shield, Download, Play, AlertTriangle, Info, HelpCircle, Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import semver from "semver";
import { addImageApkoAction } from "@/lib/image/actions/add-image-apko";
import { removeImageApkoAction } from "@/lib/image/actions/remove-image-apko";
import { updateImageApkoYamlAction } from "@/lib/image/actions/update-image";
import { updateImageApkoTagsAction } from "@/lib/image/actions/update-image-apko-tags";
import { setImageAlternateImageAction } from "@/lib/image/actions/set-image-alternate-image";
import { setImageReadmeAction } from "@/lib/image/actions/set-image-readme";
import { setImageApkoReadmeAction } from "@/lib/image/actions/set-image-apko-readme";
import { addExternalRegistryAction } from "@/lib/image/actions/add-external-registry";
import { removeExternalRegistryAction } from "@/lib/image/actions/remove-external-registry";
import { downloadImageScanResultAction, getImageScanResultsAction } from "@/lib/image/actions/get-image-scan-results";
import { getFixableCVEs, FixableCVEsByAPKO } from "@/lib/image/actions/get-fixable-cves";
import { buildImageAction } from "@/lib/image/actions/build-image";
import { buildImageApkoAction } from "@/lib/image/actions/build-apko";
import { scanImageApkoAction } from "@/lib/image/actions/scan-apko";
import { setImagePublic } from "@/lib/image/actions/set-image-public";
import { getImageAction } from "@/lib/image/actions/get-image";
import { getImageBuildsAction } from "@/lib/image/actions/get-image-builds";
import { getAPKOPackagesAction } from "@/lib/image/actions/get-apko-packages";
import { sortAPKOsByVersion } from "@/lib/utils/apko-sort";
import { sortTagsForDisplay } from "@/lib/utils/tag-sort";
import { ImageScanSummary } from "@/lib/image/scan";
import { Image, ImageBuild } from "@/lib/types/image";
import { Session } from "@/lib/types/session";
import { APKOPackage } from "@/lib/image/actions/get-apko-packages";
import { BuildsTable } from "@/components/builds-table";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { EditTagsModal } from "@/components/edit-tags-modal";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ImageStatusIndicator } from "@/components/image-status-indicator";

// Dynamically import Monaco Editor to avoid SSR issues
const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });
import type * as Monaco from "monaco-editor";

interface ImagePageClientProps {
  initialImage: Image;
  initialScanResults: ImageScanSummary[];
  initialBuilds: ImageBuild[];
  initialApkoPackages: { [apkoId: string]: APKOPackage[] };
  currentTab: string;
  session: Session;
}

// Compare two tags using semver
// Special case: "latest" always wins
// Returns: negative if a < b, 0 if equal, positive if a > b
const compareTags = (a: string, b: string): number => {

  // Special case: "latest" always wins
  if (a === 'latest' && b !== 'latest') return 1;
  if (b === 'latest' && a !== 'latest') return -1;
  if (a === 'latest' && b === 'latest') return 0;

  // Use semver.coerce to extract version and compare
  const aCoerced = semver.coerce(a);
  const bCoerced = semver.coerce(b);

  if (aCoerced && bCoerced) {
    const cmp = semver.compare(aCoerced, bCoerced);
    return cmp;
  }

  // Can't parse as semver - use alphanumeric comparison
  return a.localeCompare(b);
};

// Get the tag with the highest version using semver
// "latest" always takes precedence
const getMostSpecificTag = (tags: string[]): string => {
  if (tags.length === 0) return '';
  if (tags.length === 1) return tags[0];

  // Sort descending and return first
  return [...tags].sort((a, b) => compareTags(b, a))[0];
};

// Get the best semver tag for grouping purposes (ignores "latest")
// Returns the highest semver-parseable tag, or null if none exist
const getBestSemverTag = (tags: string[]): string | null => {
  if (tags.length === 0) return null;

  // Filter out "latest" and find highest semver tag
  const semverTags = tags.filter(t => t !== 'latest' && semver.coerce(t) !== null);
  if (semverTags.length === 0) return null;

  return [...semverTags].sort((a, b) => compareTags(b, a))[0];
};

// Get recent builds for a specific APKO
const getApkoBuilds = (apkoId: string, builds: ImageBuild[], image: Image): ImageBuild[] => {
  // Find the latest version for this APKO
  const apko = image.apkos.find(a => a.id === apkoId);
  if (!apko || !apko.latestVersion) return [];

  // Filter builds by this APKO's version ID
  return builds
    .filter(build => build.imageApkoVersionId === apko.latestVersion.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
};

// Get status indicator classes for build status dot
const getStatusDotClasses = (status: string): string => {
  switch (status.toLowerCase()) {
    case 'success':
      return 'bg-green-500 border-green-600 hover:bg-green-600';
    case 'failed':
      return 'bg-red-500 border-red-600 hover:bg-red-600';
    case 'timed_out':
      return 'bg-orange-500 border-orange-600 hover:bg-orange-600';
    case 'building':
    case 'queued':
    case 'pending':
      return 'bg-blue-500 border-blue-600 animate-pulse hover:bg-blue-600';
    default:
      return 'bg-gray-400 border-gray-500 hover:bg-gray-500';
  }
};

// Get grouping key: "major.minor|secondary"
// This makes tags with different secondary versions completely separate groups
// Examples: "2.10|k8s-1.32", "2.10|k8s-1.33", "3.11|go1.21.1", "3.11|go1.21.4"
const getGroupingKey = (tag: string): string | null => {
  const coerced = semver.coerce(tag);
  if (!coerced) return null;

  const majorMinor = `${coerced.major}.${coerced.minor}`;
  // Extract secondary version from tag (e.g., "k8s-1.32" from "2.10.0-k8s-1.32")
  const dashIndex = tag.indexOf('-');
  const secondary = dashIndex === -1 ? '' : tag.substring(dashIndex + 1);

  return secondary ? `${majorMinor}|${secondary}` : majorMinor;
};

export function ImagePageClient({
  initialImage,
  initialScanResults,
  initialBuilds,
  initialApkoPackages,
  currentTab,
  session,
}: ImagePageClientProps) {
  const router = useRouter();
  const [image, setImage] = useState<Image>(initialImage);
  const [scanResults, setScanResults] = useState<ImageScanSummary[]>(initialScanResults);
  const [builds, setBuilds] = useState<ImageBuild[]>(initialBuilds);
  const [apkoPackages, setApkoPackages] = useState<{ [apkoId: string]: APKOPackage[] }>(initialApkoPackages);

  // Local tab state to prevent flicker during navigation
  const [activeTab, setActiveTab] = useState(currentTab);

  // Sync local tab state with URL when navigating directly
  useEffect(() => {
    setActiveTab(currentTab);
  }, [currentTab]);

  // Loading states for lazy-loaded tabs
  const [scanResultsLoading, setScanResultsLoading] = useState(false);
  const [buildsLoading, setBuildsLoading] = useState(false);
  const [apkoPackagesLoading, setApkoPackagesLoading] = useState<{ [apkoId: string]: boolean }>({});

  // Editing states
  const [editingApkoId, setEditingApkoId] = useState<string | null>(null);
  const [yamlContent, setYamlContent] = useState<string>("");
  const [originalYamlContent, setOriginalYamlContent] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [editingAlternateImage, setEditingAlternateImage] = useState(false);
  const [alternateImageContent, setAlternateImageContent] = useState<string>("");
  const [originalAlternateImageContent, setOriginalAlternateImageContent] = useState<string>("");
  const [savingAlternateImage, setSavingAlternateImage] = useState(false);


  // Tags modal state
  const [editingTagsApkoId, setEditingTagsApkoId] = useState<string | null>(null);
  const [isTagsModalOpen, setIsTagsModalOpen] = useState(false);
  const [savingTags, setSavingTags] = useState(false);
  const [isAddingApko, setIsAddingApko] = useState(false);
  const [removingApkoId, setRemovingApkoId] = useState<string | null>(null);

  // External registry state
  const [showAddExternalRegistryForm, setShowAddExternalRegistryForm] = useState(false);
  const [isAddingExternalRegistry, setIsAddingExternalRegistry] = useState(false);
  const [registryUrl, setRegistryUrl] = useState("");
  const [registryUsername, setRegistryUsername] = useState("");
  const [registryPassword, setRegistryPassword] = useState("");
  const [deletingRegistryId, setDeletingRegistryId] = useState<string | null>(null);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [registryToDelete, setRegistryToDelete] = useState<{ id: string; url: string } | null>(null);

  // README state
  const [readmeContent, setReadmeContent] = useState<string>(image.readme || "");
  const [savingReadme, setSavingReadme] = useState(false);

  // APKO README state
  const [editingApkoReadmeId, setEditingApkoReadmeId] = useState<string | null>(null);
  const [apkoReadmeContent, setApkoReadmeContent] = useState<string>("");
  const [originalApkoReadmeContent, setOriginalApkoReadmeContent] = useState<string>("");
  const [savingApkoReadme, setSavingApkoReadme] = useState(false);

  // APKO Test YAML state
  const [editingApkoTestId, setEditingApkoTestId] = useState<string | null>(null);
  const [apkoTestContent, setApkoTestContent] = useState<string>("");
  const [originalApkoTestContent, setOriginalApkoTestContent] = useState<string>("");
  const [savingApkoTest, setSavingApkoTest] = useState(false);
  const completionProviderRegistered = useRef(false);

  // Security scan state
  const [downloadingScanId, setDownloadingScanId] = useState<string | null>(null);

  // Fixable CVEs state
  const [fixableCVEs, setFixableCVEs] = useState<FixableCVEsByAPKO[]>([]);
  const [fixableCVEsLoading, setFixableCVEsLoading] = useState(false);
  const [expandedOutdatedSections, setExpandedOutdatedSections] = useState<Set<string>>(new Set());

  // Build state
  const [isBuilding, setIsBuilding] = useState(false);
  const [buildingApkoId, setBuildingApkoId] = useState<string | null>(null);

  // Scan state
  const [scanningApkoId, setScanningApkoId] = useState<string | null>(null);

  // Public/Private state
  const [isPublic, setIsPublic] = useState(image.isPublic || false);
  const [isTogglingPublic, setIsTogglingPublic] = useState(false);

  // Lazy loading functions for tab data
  const fetchScanResults = async () => {
    if (scanResults.length > 0 || scanResultsLoading) return;

    setScanResultsLoading(true);
    try {
      const results = await getImageScanResultsAction(session, image.name);
      setScanResults(results);
    } catch (error) {
      console.error("Failed to fetch scan results:", error);
      toast.error("Failed to load scan results");
    } finally {
      setScanResultsLoading(false);
    }
  };

const fetchFixableCVEs = async (force = false) => {
    if (!force && (fixableCVEs.length > 0 || fixableCVEsLoading)) return;

    setFixableCVEsLoading(true);
    try {
      const results = await getFixableCVEs(image.name, image.id);
      setFixableCVEs(results);
    } catch (error) {
      console.error("Failed to fetch fixable CVEs:", error);
      toast.error("Failed to load fixable CVEs");
    } finally {
      setFixableCVEsLoading(false);
    }
  };

  const fetchApkoPackages = async (apkoId: string) => {
    if (apkoPackages[apkoId] || apkoPackagesLoading[apkoId]) return;

    setApkoPackagesLoading(prev => ({ ...prev, [apkoId]: true }));
    try {
      const packages = await getAPKOPackagesAction(session, apkoId);
      setApkoPackages(prev => ({ ...prev, [apkoId]: packages }));
    } catch (error) {
      console.error("Failed to fetch APKO packages:", error);
      toast.error("Failed to load APKO packages");
    } finally {
      setApkoPackagesLoading(prev => ({ ...prev, [apkoId]: false }));
    }
  };

  const fetchBuilds = async () => {
    if (builds.length > 0 || buildsLoading) return;

    setBuildsLoading(true);
    try {
      const imageBuilds = await getImageBuildsAction(session, image.id);
      setBuilds(imageBuilds);
    } catch (error) {
      console.error("Failed to fetch builds:", error);
      toast.error("Failed to load builds");
    } finally {
      setBuildsLoading(false);
    }
  };

  const handleTabChange = (value: string) => {
    // Update local state immediately to prevent flicker
    setActiveTab(value);

    // Lazy load data for the selected tab if not already loaded
    if (value === "security" && scanResults.length === 0) {
      fetchScanResults();
    } else if (value === "fixable-cves" && fixableCVEs.length === 0) {
      fetchFixableCVEs();
    } else if (value === "builds" && builds.length === 0) {
      fetchBuilds();
    } else if (value === "apkos" && image.apkos) {
      // Load packages for APKOs that don't have them yet
      image.apkos.forEach(apko => {
        if (!apkoPackages[apko.id]) {
          fetchApkoPackages(apko.id);
        }
      });
    }

    if (value === "general") {
      router.push(`/images/${image.id}`, { scroll: false });
    } else {
      router.push(`/images/${image.id}/${value}`, { scroll: false });
    }
  };

  // Load data when navigating directly to a tab via URL
  useEffect(() => {
    if (currentTab === "fixable-cves" && fixableCVEs.length === 0 && !fixableCVEsLoading) {
      fetchFixableCVEs();
    }
  }, [currentTab]);

  // Build handler
  const handleBuildClick = async () => {
    if (!session || !image) return;

    setIsBuilding(true);
    try {
      await buildImageAction(session, image.id);
      toast.success("Build All initiated successfully");
      console.log(`Build initiated for image: ${image.id}`);
      // Simulate a minimum duration for the visual feedback
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Wait a bit for the build to be created, then refresh the builds list
      const refreshBuilds = async (retries = 5, delay = 1000) => {
        try {
          const builds = await getImageBuildsAction(session, image.id);
          setBuilds(builds);
        } catch (error) {
          console.error("Failed to refresh builds after build trigger:", error);
          // Retry if we have retries left
          if (retries > 0) {
            setTimeout(() => refreshBuilds(retries - 1, delay), delay);
          }
        }
      };

      // Start the refresh with a 1 second delay
      setTimeout(() => refreshBuilds(), 1000);
    } catch (error) {
      console.error("Failed to build image:", error);
      toast.error("Failed to initiate build");
    } finally {
      setIsBuilding(false);
    }
  };

  // Build single APKO handler
  const handleBuildApkoClick = async (apkoId: string) => {
    if (!session || !image) return;

    setBuildingApkoId(apkoId);
    try {
      await buildImageApkoAction(session, image.id, apkoId);
      toast.success("Build initiated successfully for APKO");
      console.log(`Build initiated for APKO: ${apkoId} of image: ${image.id}`);
      // Simulate a minimum duration for the visual feedback
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Wait a bit for the build to be created, then refresh the builds list
      const refreshBuilds = async (retries = 5, delay = 1000) => {
        try {
          const builds = await getImageBuildsAction(session, image.id);
          setBuilds(builds);
        } catch (error) {
          console.error("Failed to refresh builds after build trigger:", error);
          // Retry if we have retries left
          if (retries > 0) {
            setTimeout(() => refreshBuilds(retries - 1, delay), delay);
          }
        }
      };

      // Start the refresh with a 1 second delay
      setTimeout(() => refreshBuilds(), 1000);
    } catch (error) {
      console.error("Failed to build APKO:", error);
      toast.error("Failed to initiate build for APKO");
    } finally {
      setBuildingApkoId(null);
    }
  };

  // Scan single APKO handler
  const handleScanApkoClick = async (apkoId: string) => {
    if (!session || !image) return;

    setScanningApkoId(apkoId);
    try {
      await scanImageApkoAction(session, image.id, apkoId);
      toast.success("Scan initiated successfully for APKO");
      console.log(`Scan initiated for APKO: ${apkoId} of image: ${image.id}`);
      // Simulate a minimum duration for the visual feedback
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      console.error("Failed to scan APKO:", error);
      toast.error("Failed to initiate scan for APKO");
    } finally {
      setScanningApkoId(null);
    }
  };

  // Public/Private toggle handler
  const handlePublicToggle = async (checked: boolean) => {
    if (!session || !image) return;

    setIsTogglingPublic(true);
    try {
      await setImagePublic(session, image.id, checked);
      setIsPublic(checked);
      toast.success(checked ? "Image is now public" : "Image is now private");
    } catch (error) {
      console.error("Failed to update image visibility:", error);
      toast.error("Failed to update image visibility");
      // Revert the toggle on error
      setIsPublic(!checked);
    } finally {
      setIsTogglingPublic(false);
    }
  };

  const handleEditYaml = (apkoId: string, currentYaml: string) => {
    setEditingApkoId(apkoId);
    setYamlContent(currentYaml);
    setOriginalYamlContent(currentYaml);
  };

  const handleSaveYaml = async (apkoId: string) => {
    if (!session) return;

    setSaving(true);
    try {
      await updateImageApkoYamlAction(session, image.id, apkoId, yamlContent);
      toast.success("APKO YAML updated successfully");

      // Refresh the image data
      const updatedImage = await getImageAction(session, image.id);
      setImage(updatedImage);
      setEditingApkoId(null);
      setOriginalYamlContent("");
    } catch (error) {
      console.error("Failed to save YAML:", error);
      toast.error("Failed to save YAML changes");
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setEditingApkoId(null);
    setYamlContent("");
    setOriginalYamlContent("");
  };

  // Check if content has changed
  const hasChanges = yamlContent !== originalYamlContent;

  const handleEditAlternateImage = () => {
    const currentAlternateImage = image?.alternateImage || "";
    setEditingAlternateImage(true);
    setAlternateImageContent(currentAlternateImage);
    setOriginalAlternateImageContent(currentAlternateImage);
  };

  const handleSaveAlternateImage = async () => {
    if (!session) return;

    setSavingAlternateImage(true);
    try {
      await setImageAlternateImageAction(session, image.id, alternateImageContent);
      toast.success("Alternate image updated successfully");

      // Refresh the image data
      const updatedImage = await getImageAction(session, image.id);
      setImage(updatedImage);
      setEditingAlternateImage(false);
      setOriginalAlternateImageContent("");
    } catch (error) {
      console.error("Failed to save alternate image:", error);
      toast.error("Failed to save alternate image");
    } finally {
      setSavingAlternateImage(false);
    }
  };

  const handleCancelAlternateImageEdit = () => {
    setEditingAlternateImage(false);
    setAlternateImageContent("");
    setOriginalAlternateImageContent("");
  };

  // Check if content has changed
  const hasAlternateImageChanges = alternateImageContent !== originalAlternateImageContent;

  // Tags modal handlers
  const handleEditTags = (apkoId: string) => {
    setEditingTagsApkoId(apkoId);
    setIsTagsModalOpen(true);
  };

  const handleSaveTags = async (newTags: string[]) => {
    if (!session || !editingTagsApkoId) return;

    setSavingTags(true);
    try {
      await updateImageApkoTagsAction(session, image.id, editingTagsApkoId, newTags);
      toast.success("Tags updated successfully");

      // Refresh the image data
      const updatedImage = await getImageAction(session, image.id);
      setImage(updatedImage);
    } catch (error) {
      console.error("Failed to save tags:", error);
      toast.error("Failed to save tags");
      throw error;
    } finally {
      setSavingTags(false);
    }
  };

  const handleCloseTagsModal = () => {
    setIsTagsModalOpen(false);
    setEditingTagsApkoId(null);
  };

  const handleAddApko = async () => {
    if (!session) return;

    setIsAddingApko(true);
    try {
      await addImageApkoAction(session, image.id, "");
      toast.success("New APKO configuration added successfully");

      // Refresh the image data
      const updatedImage = await getImageAction(session, image.id);
      setImage(updatedImage);

      // Place the most recently created APKO into editing mode.
      // This ensures the user sees it right away.
      if (updatedImage.apkos && updatedImage.apkos.length > 0) {
        // Find the most recently created APKO by createdAt timestamp
        const newApko = updatedImage.apkos.reduce((latest, current) =>
          new Date(current.createdAt).getTime() > new Date(latest.createdAt).getTime()
            ? current
            : latest
        );
        // Set it to editing mode and populate the YAML content
        setEditingApkoId(newApko.id);
        setYamlContent(newApko.latestVersion.apkoYaml);
        setOriginalYamlContent(newApko.latestVersion.apkoYaml);
      }
    } catch (error) {
      console.error("Failed to add APKO config:", error);
      toast.error("Failed to add APKO configuration");
    } finally {
      setIsAddingApko(false);
    }
  };

  const handleRemoveApko = async (apkoId: string) => {
    if (!session) return;
    if (!window.confirm("Are you sure you want to remove this APKO configuration? This action cannot be undone.")) {
      return;
    }

    setRemovingApkoId(apkoId);
    try {
      await removeImageApkoAction(session, apkoId);
      toast.success("APKO configuration removed successfully");

      // Refresh the image data
      const updatedImage = await getImageAction(session, image.id);
      setImage(updatedImage);
    } catch (error) {
      console.error("Failed to remove APKO config:", error);
      toast.error("Failed to remove APKO configuration");
    } finally {
      setRemovingApkoId(null);
    }
  };

  const handleAddExternalRegistry = async () => {
    if (!session) return;
    if (!registryUrl.trim() || !registryUsername.trim() || !registryPassword.trim()) {
      toast.error("Please fill in all fields");
      return;
    }

    setIsAddingExternalRegistry(true);
    try {
      await addExternalRegistryAction(session, image.id, registryUrl.trim(), registryUsername.trim(), registryPassword.trim());
      toast.success("External registry added successfully");

      // Reset form
      setRegistryUrl("");
      setRegistryUsername("");
      setRegistryPassword("");
      setShowAddExternalRegistryForm(false);

      // Refresh the image data
      const updatedImage = await getImageAction(session, image.id);
      setImage(updatedImage);
    } catch (error) {
      console.error("Failed to add external registry:", error);
      toast.error("Failed to add external registry");
    } finally {
      setIsAddingExternalRegistry(false);
    }
  };

  const handleCancelAddExternalRegistry = () => {
    setRegistryUrl("");
    setRegistryUsername("");
    setRegistryPassword("");
    setShowAddExternalRegistryForm(false);
  };

  const handleDeleteExternalRegistry = (registryId: string, registryUrl: string) => {
    setRegistryToDelete({ id: registryId, url: registryUrl });
    setShowDeleteConfirmation(true);
  };

  const handleConfirmDeleteExternalRegistry = async () => {
    if (!session || !registryToDelete) return;

    setDeletingRegistryId(registryToDelete.id);
    try {
      await removeExternalRegistryAction(session, image.id, registryToDelete.id);
      toast.success("External registry removed successfully");

      // Refresh the image data
      const updatedImage = await getImageAction(session, image.id);
      setImage(updatedImage);
    } catch (error) {
      console.error("Failed to remove external registry:", error);
      toast.error("Failed to remove external registry");
    } finally {
      setDeletingRegistryId(null);
      setShowDeleteConfirmation(false);
      setRegistryToDelete(null);
    }
  };

  const handleCancelDeleteExternalRegistry = () => {
    setShowDeleteConfirmation(false);
    setRegistryToDelete(null);
  };

  // APKO README handlers
  const handleEditApkoReadme = (apkoId: string, currentReadme?: string) => {
    const readmeContent = currentReadme || "";
    setEditingApkoReadmeId(apkoId);
    setApkoReadmeContent(readmeContent);
    setOriginalApkoReadmeContent(readmeContent);
  };

  const handleSaveApkoReadme = async (apkoId: string) => {
    if (!session) return;

    setSavingApkoReadme(true);
    try {
      await setImageApkoReadmeAction(session, apkoId, apkoReadmeContent);
      toast.success("APKO README updated successfully");

      // Refresh the image data
      const updatedImage = await getImageAction(session, image.id);
      setImage(updatedImage);
      setEditingApkoReadmeId(null);
      setOriginalApkoReadmeContent("");
    } catch (error) {
      console.error("Failed to save APKO README:", error);
      toast.error("Failed to save APKO README");
    } finally {
      setSavingApkoReadme(false);
    }
  };

  const handleCancelApkoReadmeEdit = () => {
    setEditingApkoReadmeId(null);
    setApkoReadmeContent("");
    setOriginalApkoReadmeContent("");
  };

  // Check if APKO README content has changed
  const hasApkoReadmeChanges = apkoReadmeContent !== originalApkoReadmeContent;

  // Default test YAML template with documentation
  const defaultTestYaml = `# Image Test Definition
# This test definition will run during the image build process to validate
# that your image behaves correctly and matches the reference implementation.

# Reference image to compare against (optional)
# If omitted, uses the "Alternate Image" configured for this image
# referenceImage: docker.io/library/yourimage:tag

test:
  # Pipeline of test steps to execute
  # Each step must have either 'uses' (reusable pipeline) or 'runs' (custom script)
  pipeline:
    # Example: Use a reusable test pipeline with inputs
    # - uses: compare-images
    #   with:
    #     threshold: "0.1"

    # Example: Write a custom test script with environment overrides
    # - name: verify-functionality
    #   environment:
    #     DEBUG: "true"
    #     TIMEOUT: "30"
    #   runs: |
    #     #!/bin/bash
    #     set -e
    #
    #     # Available Template Variables (use \${{...}} syntax):
    #     # - \${{ourImage}}: The image being tested
    #     # - \${{refImage}}: The reference image to compare against
    #     # - \${{arch}}: Current architecture being tested
    #     # - \${{inputs.name}}: User-defined pipeline inputs
    #
    #     echo "Testing \${{ourImage}} against \${{refImage}} on \${{arch}}"
    #     # Example using inputs: compare.sh "\${{inputs.threshold}}"
`;

  // APKO Test YAML handlers
  const handleEditApkoTest = (apkoId: string, apkoVersionId: string, currentTest?: string) => {
    const testContent = currentTest || defaultTestYaml;
    setEditingApkoTestId(apkoId);
    setApkoTestContent(testContent);
    setOriginalApkoTestContent(testContent);
  };

  const handleSaveApkoTest = async (apkoId: string, apkoVersionId: string) => {
    if (!session) return;

    setSavingApkoTest(true);
    try {
      // If content is empty, delete the test; otherwise save it
      if (!apkoTestContent || apkoTestContent.trim() === "") {
        const { deleteImageTestAction } = await import("@/lib/image/actions/set-image-test");
        const result = await deleteImageTestAction(apkoId, apkoVersionId);

        if (!result.success) {
          toast.error(result.error || "Failed to delete test YAML");
          return;
        }

        toast.success("Test YAML deleted successfully");
      } else {
        const { setImageTestAction } = await import("@/lib/image/actions/set-image-test");
        const result = await setImageTestAction(apkoId, apkoVersionId, apkoTestContent);

        if (!result.success) {
          toast.error(result.error || "Failed to save test YAML");
          return;
        }

        toast.success("Test YAML saved successfully");
      }

      // Refresh the image data
      const updatedImage = await getImageAction(session, image.id);
      setImage(updatedImage);
      setEditingApkoTestId(null);
      setOriginalApkoTestContent("");
    } catch (error) {
      toast.error("Failed to save test YAML");
    } finally {
      setSavingApkoTest(false);
    }
  };

  const handleCancelApkoTestEdit = () => {
    setEditingApkoTestId(null);
    setApkoTestContent("");
    setOriginalApkoTestContent("");
  };

  // Check if APKO Test content has changed
  const hasApkoTestChanges = apkoTestContent !== originalApkoTestContent;

  // APKO tab save handler
  const handleSaveApkoTab = async () => {
    // TODO: Implement actual save functionality when backend is ready
    toast.success("APKO configurations saved successfully");
  };

  // README save handler
  const handleSaveReadme = async () => {
    if (!session) return;

    setSavingReadme(true);
    try {
      await setImageReadmeAction(session, image.id, readmeContent);
      toast.success("README saved successfully");

      // Refresh the image data
      const updatedImage = await getImageAction(session, image.id);
      setImage(updatedImage);
      setReadmeContent(updatedImage.readme || "");
    } catch (error) {
      console.error("Failed to save README:", error);
      toast.error("Failed to save README");
    } finally {
      setSavingReadme(false);
    }
  };

  // Download scan result handler
  const handleDownloadScanResult = async (scanId: string) => {
    if (!session) return;

    setDownloadingScanId(scanId);
    try {
      const result = await downloadImageScanResultAction(session, scanId);

      // Create and download the JSON file
      const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `scan-result-${scanId}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success("Scan result downloaded successfully");
    } catch (error) {
      console.error("Failed to download scan result:", error);
      toast.error("Failed to download scan result");
    } finally {
      setDownloadingScanId(null);
    }
  };

  const formatDate = (dateInput: any) => {
    if (!dateInput) return "—";

    try {
      let date: Date;
      if (dateInput instanceof Date) {
        date = dateInput;
      } else {
        date = new Date(dateInput);
      }

      if (isNaN(date.getTime())) {
        return "Invalid";
      }

      return date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (error) {
      return "Invalid";
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/images" className="flex items-center">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Images
          </Link>
        </Button>
      </div>

      <div className="space-y-6">
        {/* Image Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <Package className="h-8 w-8 text-blue-500" />
            <div>
              <h1 className="text-3xl font-bold">{image.name}</h1>
              <p className="text-muted-foreground">Container Image</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={handleBuildClick} disabled={isBuilding} className="flex items-center">
              {isBuilding ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-foreground mr-2" />
              ) : (
                <Play className="mr-2 h-4 w-4" />
              )}
              {isBuilding ? "Building..." : "Build All"}
            </Button>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="external-registries">External Registries</TabsTrigger>
            <TabsTrigger value="catalog">Catalog Items</TabsTrigger>
            <TabsTrigger value="apkos">APKOs</TabsTrigger>
            <TabsTrigger value="security">Security Scans</TabsTrigger>
            <TabsTrigger value="fixable-cves">Fixable CVEs</TabsTrigger>
            <TabsTrigger value="readme">README.md</TabsTrigger>
            <TabsTrigger value="builds">Builds</TabsTrigger>
          </TabsList>

          <TabsContent value="general">
            <ImageStatusIndicator builds={builds} loading={buildsLoading} />
            <Card>
              <CardHeader>
                <CardTitle>Image Configuration</CardTitle>
                <CardDescription>Basic information and settings for this container image</CardDescription>
              </CardHeader>
              <CardContent>
                {/* Basic Information Section */}
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-semibold mb-3">Basic Information</h3>
                    <div className="space-y-4">
                      {/* First Row - Name and ID */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-sm font-medium text-muted-foreground">Name</label>
                          <p className="font-semibold text-base">{image.name}</p>
                        </div>
                        <div className="space-y-1">
                          <label className="text-sm font-medium text-muted-foreground">ID</label>
                          <p className="font-mono text-sm bg-muted/30 p-2 rounded border">{image.id}</p>
                        </div>
                      </div>

                      {/* Second Row - Created and Last Updated */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-sm font-medium text-muted-foreground">Created</label>
                          <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-muted-foreground" />
                            <p className="text-sm">{formatDate(image.createdAt)}</p>
                          </div>
                        </div>
                        <div className="space-y-1">
                          <label className="text-sm font-medium text-muted-foreground">Last Updated</label>
                          <div className="flex items-center gap-2">
                            <Clock className="h-4 w-4 text-muted-foreground" />
                            <p className="text-sm">{formatDate(image.updatedAt)}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Configuration Section */}
                  <div className="border-t pt-4">
                    <h3 className="text-lg font-semibold mb-3">Image Settings</h3>
                    <div className="space-y-4">
                      {/* First Row - Alternate Image & Default Tag */}
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Alternate Image Configuration */}
                        <div className={`border-2 rounded-lg p-4 ${!image.alternateImage ? 'border-amber-200 bg-amber-50/50' : 'border-muted'}`}>
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <label className="text-sm font-medium">Alternate Image</label>
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <HelpCircle className="h-4 w-4 text-muted-foreground hover:text-foreground cursor-help" />
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-xs">
                                    <p className="text-sm">
                                      Configure the upstream/canonical image to enable vulnerability comparison features.
                                      This shows which CVEs are fixed compared to the original upstream image.
                                    </p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </div>
                            {!editingAlternateImage && (
                              <Button size="sm" variant="outline" onClick={handleEditAlternateImage}>
                                <Edit3 className="h-3 w-3 mr-1" />
                                Edit
                              </Button>
                            )}
                          </div>
                          {editingAlternateImage ? (
                            <div className="space-y-2">
                              <Input
                                value={alternateImageContent}
                                onChange={(e) => setAlternateImageContent(e.target.value)}
                                placeholder="Enter upstream image (e.g., nginx, redis, sonobuoy/sonobuoy)"
                                className="font-mono text-sm h-8"
                              />
                              <p className="text-xs text-muted-foreground">
                                The upstream/canonical image for vulnerability comparison. This enables SecureBuild to show which CVEs are fixed compared to the original upstream image. Uses Docker Hub format - examples: <code className="bg-muted px-1 rounded">nginx</code>, <code className="bg-muted px-1 rounded">redis</code>, <code className="bg-muted px-1 rounded">sonobuoy/sonobuoy</code>, or <code className="bg-muted px-1 rounded">gcr.io/project/image</code> for other registries.
                              </p>
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  onClick={handleSaveAlternateImage}
                                  disabled={savingAlternateImage || !hasAlternateImageChanges}
                                >
                                  <Save className="h-3 w-3 mr-1" />
                                  {savingAlternateImage ? "Saving..." : "Save"}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={handleCancelAlternateImageEdit}
                                  disabled={savingAlternateImage}
                                >
                                  <X className="h-3 w-3 mr-1" />
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          ) : image.alternateImage ? (
                            <div className="font-mono text-sm bg-muted/30 p-2 rounded border">
                              {image.alternateImage}
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                              <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0" />
                              <div className="text-sm">
                                <p className="font-medium text-amber-800 mb-1">Configure upstream image to enable vulnerability comparison features</p>
                                <p className="text-xs text-amber-700">
                                  Add the original upstream image (e.g., nginx, redis) to see which vulnerabilities are fixed in your SecureBuild version
                                </p>
                              </div>
                            </div>
                          )}
                        </div>

                      </div>

                      {/* Second Row - Image Visibility (Single Column Width) */}
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <label className="text-sm font-medium">Image Visibility</label>
                          </div>
                          <div className={`px-3 py-2 rounded border ${
                            isPublic 
                              ? "bg-blue-50 border-blue-200" 
                              : "bg-muted/30"
                          }`}>
                            <div className="flex items-center space-x-6">
                              <Switch
                                id="public-mode"
                                checked={isPublic}
                                onCheckedChange={handlePublicToggle}
                                disabled={isTogglingPublic}
                              />
                              <label
                                htmlFor="public-mode"
                                className={`text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 ${
                                  isPublic ? "text-blue-700" : ""
                                }`}
                              >
                                {isPublic ? "Public" : "Private"}
                              </label>
                              <p className={`text-xs ${
                                isPublic 
                                  ? "text-blue-600" 
                                  : "text-muted-foreground"
                              }`}>
                                {isPublic
                                  ? "Can be pulled without authentication"
                                  : "Requires authentication to pull"}
                              </p>
                            </div>
                          </div>
                        </div>
                        <div></div>
                      </div>
                    </div>
                  </div>

                  {/* Build History Section */}
                  <div className="border-t pt-4">
                    <h3 className="text-lg font-semibold mb-3">Build History</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-sm font-medium text-muted-foreground">Last Scanned</label>
                        {(() => {
                          const getScanWarningInfo = () => {
                            if (!image.lastScannedAt) {
                              return {
                                isWarning: true,
                                daysSince: null,
                                message: " (Never scanned)"
                              };
                            }
                            
                            try {
                              const scanDate = new Date(image.lastScannedAt);
                              if (isNaN(scanDate.getTime())) {
                                return {
                                  isWarning: true,
                                  daysSince: null,
                                  message: " (Invalid scan date)"
                                };
                              }
                              
                              const daysSinceLastScan = Math.floor((Date.now() - scanDate.getTime()) / (1000 * 60 * 60 * 24));
                              const isWarning = daysSinceLastScan > 5;
                              
                              return {
                                isWarning,
                                daysSince: daysSinceLastScan,
                                message: isWarning ? ` (${daysSinceLastScan} days ago - scan may be outdated)` : ""
                              };
                            } catch (error) {
                              return {
                                isWarning: true,
                                daysSince: null,
                                message: " (Invalid scan date)"
                              };
                            }
                          };

                          const scanInfo = getScanWarningInfo();

                          return (
                            <div className={`flex items-center gap-2 p-2 rounded border ${
                              scanInfo.isWarning ? "bg-yellow-50 border-yellow-200" : "bg-muted/30"
                            }`}>
                              <Shield className={`h-4 w-4 ${
                                scanInfo.isWarning ? "text-yellow-600" : "text-muted-foreground"
                              }`} />
                              <p className={`text-sm ${
                                scanInfo.isWarning ? "text-yellow-700" : ""
                              }`}>
                                {formatDate(image.lastScannedAt)}{scanInfo.message}
                              </p>
                            </div>
                          );
                        })()}
                      </div>
                      <div className="space-y-1">
                        <label className="text-sm font-medium text-muted-foreground">Last Built</label>
                        <div className="flex items-center gap-2 bg-muted/30 p-2 rounded border">
                          <Clock className="h-4 w-4 text-muted-foreground" />
                          <p className="text-sm">{formatDate(image.lastBuiltAt)}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="catalog">
            {/* Catalog Items */}
            <Card>
              <CardHeader>
                <CardTitle>Catalog Items with this image</CardTitle>
                <CardDescription>Items in the catalog that reference this image</CardDescription>
              </CardHeader>
              <CardContent>
                {image.catalogItems && image.catalogItems.length > 0 ? (
                  <div className="space-y-4">
                    {image.catalogItems.map((catalogItem) => (
                      <Link
                        key={catalogItem.catalogItemId}
                        href={`/catalog/${catalogItem.catalogItemId}`}
                        className="block border rounded-lg p-4 hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <h3 className="font-semibold">{catalogItem.catalogItemName}</h3>
                            <p className="text-sm text-muted-foreground">Catalog item ID: {catalogItem.catalogItemId}</p>
                          </div>
                          <Badge variant="default">Active</Badge>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Package className="h-3 w-3" />
                          <span>Catalog Item</span>
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Package className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p className="mb-4">No catalog items reference this image.</p>
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/catalog/new?imageId=${image.id}`}>
                        <Package className="h-4 w-4 mr-2" />
                        List this image in catalog
                      </Link>
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Continue with other TabsContent components... */}
          {/* For brevity, I'll continue with the most important ones */}

          <TabsContent value="apkos">
            {/* APKO Configurations */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>APKO Configurations</CardTitle>
                    <CardDescription>Container configurations for this image</CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={handleSaveApkoTab} variant="default" size="sm">
                      <Save className="mr-2 h-4 w-4" />
                      Save All
                    </Button>
                    <Button onClick={handleAddApko} disabled={isAddingApko} size="sm" variant="outline">
                      <Plus className="mr-2 h-4 w-4" />
                      {isAddingApko ? "Adding..." : "Add APKO Config"}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {image.apkos && image.apkos.length > 0 ? (
                  <div className="space-y-4">
                    {sortAPKOsByVersion(image.apkos).map((apko) => {
                      const apkoBuilds = getApkoBuilds(apko.id, builds, image);
                      const lastBuild = apkoBuilds.length > 0 ? apkoBuilds[0] : null;

                      return (
                      <div key={apko.id} className="border rounded-lg p-4">
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <div className="flex items-center gap-2">
                              {lastBuild ? (
                                <button
                                  onClick={() => router.push(`/builds/${lastBuild.id}`)}
                                  className={`w-3 h-3 rounded-full border cursor-pointer transition-all duration-200 hover:scale-110 hover:shadow-sm ${getStatusDotClasses(lastBuild.status)}`}
                                  title={`Last build: ${lastBuild.status.charAt(0).toUpperCase() + lastBuild.status.slice(1)} - ${formatDate(lastBuild.createdAt)} - Click to view details`}
                                />
                              ) : (
                                <div
                                  className="w-3 h-3 rounded-full border bg-gray-400 border-gray-500"
                                  title="No known build status"
                                />
                              )}
                              <h3 className="font-semibold">{apko.name}</h3>
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">ID: {apko.id}</div>
                            <div className="flex items-center gap-2 mt-1">
                              <Clock className="h-3 w-3 text-muted-foreground" />
                              <span className="text-xs text-muted-foreground">Updated {formatDate(apko.updatedAt)}</span>
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <Clock className="h-3 w-3 text-muted-foreground" />
                              <span className="text-xs text-muted-foreground">Last built {formatDate(apko.lastBuiltAt)}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex flex-wrap gap-1">
                              {apko.tags && apko.tags.length > 0 &&
                                sortTagsForDisplay(apko.tags).map((tag, index) => (
                                  <Badge key={index} variant="secondary" className="text-xs">
                                    <Tag className="h-3 w-3 mr-1" />
                                    {tag}
                                  </Badge>
                                ))}
                              {(!apko.tags || apko.tags.length === 0) && (
                                <span className="text-xs text-muted-foreground italic">no tags</span>
                              )}
                            </div>
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => handleBuildApkoClick(apko.id)}
                              disabled={buildingApkoId === apko.id}
                              className="ml-2"
                            >
                              {buildingApkoId === apko.id ? (
                                <>
                                  <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-primary-foreground mr-1" />
                                  Building...
                                </>
                              ) : (
                                <>
                                  <Play className="h-3 w-3 mr-1" />
                                  Build
                                </>
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleScanApkoClick(apko.id)}
                              disabled={scanningApkoId === apko.id}
                              className="ml-2"
                            >
                              {scanningApkoId === apko.id ? (
                                <>
                                  <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-primary mr-1" />
                                  Scanning...
                                </>
                              ) : (
                                <>
                                  <Shield className="h-3 w-3 mr-1" />
                                  Scan
                                </>
                              )}
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => handleEditTags(apko.id)} className="ml-2">
                              <Edit3 className="h-3 w-3 mr-1" />
                              Edit Tags
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => handleRemoveApko(apko.id)}
                              disabled={removingApkoId === apko.id}
                              className="ml-2"
                            >
                              <Trash2 className="h-3 w-3 mr-1" />
                              {removingApkoId === apko.id ? "Removing..." : "Remove"}
                            </Button>
                          </div>
                        </div>

                        {apko.latestVersion && (
                          <div className="mt-3">
                            <div className="flex items-center justify-between mb-2">
                              <label className="text-sm font-medium text-muted-foreground">Latest APKO YAML</label>
                              {editingApkoId === apko.id ? (
                                <div className="flex gap-2">
                                  <Button size="sm" onClick={() => handleSaveYaml(apko.id)} disabled={saving || !hasChanges}>
                                    <Save className="h-3 w-3 mr-1" />
                                    {saving ? "Saving..." : "Save"}
                                  </Button>
                                  <Button size="sm" variant="outline" onClick={handleCancelEdit} disabled={saving}>
                                    <X className="h-3 w-3 mr-1" />
                                    Cancel
                                  </Button>
                                </div>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleEditYaml(apko.id, apko.latestVersion.apkoYaml)}
                                >
                                  <Edit3 className="h-3 w-3 mr-1" />
                                  Edit
                                </Button>
                              )}
                            </div>

                            {editingApkoId === apko.id ? (
                              <div key={`editor-wrapper-${apko.id}-editing`} className="w-full max-w-4xl border rounded-md overflow-hidden">
                                <MonacoEditor
                                  path={`apko-${apko.id}-editing.yaml`}
                                  height="400px"
                                  language="yaml"
                                  value={yamlContent}
                                  onChange={(value) => setYamlContent(value || "")}
                                  theme="vs-dark"
                                  keepCurrentModel={false}
                                  saveViewState={false}
                                  options={{
                                    readOnly: false,
                                    minimap: { enabled: false },
                                    scrollBeyondLastLine: false,
                                    fontSize: 12,
                                    tabSize: 2,
                                    wordWrap: "on",
                                    automaticLayout: true,
                                    lineNumbers: "on",
                                    contextmenu: true,
                                    quickSuggestions: true,
                                    selectOnLineNumbers: true,
                                    cursorStyle: "line",
                                    glyphMargin: false,
                                    folding: false,
                                    lineDecorationsWidth: 0,
                                    lineNumbersMinChars: 3,
                                  }}
                                />
                              </div>
                            ) : (
                              <div key={`editor-wrapper-${apko.id}-readonly`} className="w-full max-w-4xl border rounded-md overflow-hidden">
                                <MonacoEditor
                                  path={`apko-${apko.id}-readonly.yaml`}
                                  height="300px"
                                  language="yaml"
                                  value={apko.latestVersion.apkoYaml}
                                  theme="vs-dark"
                                  keepCurrentModel={false}
                                  saveViewState={false}
                                  options={{
                                    readOnly: true,
                                    minimap: { enabled: false },
                                    scrollBeyondLastLine: false,
                                    fontSize: 12,
                                    tabSize: 2,
                                    wordWrap: "on",
                                    automaticLayout: true,
                                    lineNumbers: "on",
                                    glyphMargin: false,
                                    folding: false,
                                    lineDecorationsWidth: 0,
                                    lineNumbersMinChars: 3,
                                  }}
                                />
                              </div>
                            )}
                          </div>
                        )}

                        {/* APKO README Editor */}
                        <div className="mt-4">
                          <div className="flex items-center justify-between mb-2">
                            <label className="text-sm font-medium text-muted-foreground">README.md</label>
                            {editingApkoReadmeId === apko.id ? (
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  onClick={() => handleSaveApkoReadme(apko.id)}
                                  disabled={savingApkoReadme || !hasApkoReadmeChanges}
                                >
                                  <Save className="h-3 w-3 mr-1" />
                                  {savingApkoReadme ? "Saving..." : "Save"}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={handleCancelApkoReadmeEdit}
                                  disabled={savingApkoReadme}
                                >
                                  <X className="h-3 w-3 mr-1" />
                                  Cancel
                                </Button>
                              </div>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleEditApkoReadme(apko.id, apko.readme ?? undefined)}
                              >
                                <Edit3 className="h-3 w-3 mr-1" />
                                {apko.readme ? "Edit" : "Add"} README
                              </Button>
                            )}
                          </div>

                          {editingApkoReadmeId === apko.id ? (
                            <div key={`readme-wrapper-${apko.id}-editing`} className="w-full max-w-4xl border rounded-md overflow-hidden">
                              <MonacoEditor
                                path={`apko-${apko.id}-readme-editing.md`}
                                height="300px"
                                language="markdown"
                                value={apkoReadmeContent}
                                onChange={(value) => setApkoReadmeContent(value || "")}
                                theme="vs-dark"
                                keepCurrentModel={false}
                                saveViewState={false}
                                options={{
                                  readOnly: false,
                                  minimap: { enabled: false },
                                  scrollBeyondLastLine: false,
                                  fontSize: 12,
                                  tabSize: 2,
                                  wordWrap: "on",
                                  automaticLayout: true,
                                  lineNumbers: "on",
                                  contextmenu: true,
                                  quickSuggestions: true,
                                  selectOnLineNumbers: true,
                                  cursorStyle: "line",
                                  glyphMargin: false,
                                  folding: true,
                                  lineDecorationsWidth: 0,
                                  lineNumbersMinChars: 3,
                                }}
                              />
                            </div>
                          ) : apko.readme ? (
                            <div key={`readme-wrapper-${apko.id}-readonly`} className="w-full max-w-4xl border rounded-md overflow-hidden">
                              <MonacoEditor
                                path={`apko-${apko.id}-readme-readonly.md`}
                                height="200px"
                                language="markdown"
                                value={apko.readme}
                                theme="vs-dark"
                                keepCurrentModel={false}
                                saveViewState={false}
                                options={{
                                  readOnly: true,
                                  minimap: { enabled: false },
                                  scrollBeyondLastLine: false,
                                  fontSize: 12,
                                  tabSize: 2,
                                  wordWrap: "on",
                                  automaticLayout: true,
                                  lineNumbers: "on",
                                  glyphMargin: false,
                                  folding: true,
                                  lineDecorationsWidth: 0,
                                  lineNumbersMinChars: 3,
                                }}
                              />
                            </div>
                          ) : (
                            <div className="text-center py-6 text-muted-foreground border rounded-md bg-muted/50">
                              <p className="text-sm italic">No README.md configured for this APKO</p>
                            </div>
                          )}
                        </div>

                        {/* APKO Test YAML Editor */}
                        <div className="mt-4">
                          <div className="flex items-center justify-between mb-2">
                            <label className="text-sm font-medium text-muted-foreground">Test YAML</label>
                            {editingApkoTestId === apko.id ? (
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  onClick={() => handleSaveApkoTest(apko.id, apko.latestVersion.id)}
                                  disabled={savingApkoTest || !hasApkoTestChanges}
                                >
                                  <Save className="h-3 w-3 mr-1" />
                                  {savingApkoTest ? "Saving..." : "Save"}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={handleCancelApkoTestEdit}
                                  disabled={savingApkoTest}
                                >
                                  <X className="h-3 w-3 mr-1" />
                                  Cancel
                                </Button>
                              </div>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleEditApkoTest(apko.id, apko.latestVersion.id, apko.testYaml ?? undefined)}
                              >
                                <Edit3 className="h-3 w-3 mr-1" />
                                {apko.testYaml ? "Edit" : "Add"} Test
                              </Button>
                            )}
                          </div>

                          {editingApkoTestId === apko.id ? (
                            <div key={`test-wrapper-${apko.id}-editing`} className="w-full max-w-4xl border rounded-md overflow-hidden">
                              <MonacoEditor
                                path={`apko-${apko.id}-test-editing.yaml`}
                                height="300px"
                                language="yaml"
                                value={apkoTestContent}
                                onChange={(value) => setApkoTestContent(value || "")}
                                onMount={(editor, monaco) => {
                                  // Register autocomplete for template variables (only once)
                                  if (!completionProviderRegistered.current) {
                                    completionProviderRegistered.current = true;
                                    monaco.languages.registerCompletionItemProvider('yaml', {
                                      triggerCharacters: ['{', '.'],
                                      provideCompletionItems: (model: Monaco.editor.ITextModel, position: Monaco.Position) => {
                                      const textUntilPosition = model.getValueInRange({
                                        startLineNumber: position.lineNumber,
                                        startColumn: 1,
                                        endLineNumber: position.lineNumber,
                                        endColumn: position.column,
                                      });

                                      // Check if we're inside ${{...}}
                                      const lastDollarBrace = textUntilPosition.lastIndexOf('${{');
                                      const lastCloseBrace = textUntilPosition.lastIndexOf('}}');

                                      if (lastDollarBrace === -1 || lastCloseBrace > lastDollarBrace) {
                                        return { suggestions: [] };
                                      }

                                      const word = model.getWordUntilPosition(position);
                                      const range = {
                                        startLineNumber: position.lineNumber,
                                        endLineNumber: position.lineNumber,
                                        startColumn: word.startColumn,
                                        endColumn: word.endColumn,
                                      };

                                      const suggestions = [
                                        {
                                          label: 'ourImage',
                                          kind: monaco.languages.CompletionItemKind.Variable,
                                          detail: 'The image being tested',
                                          insertText: 'ourImage',
                                          range: range,
                                        },
                                        {
                                          label: 'refImage',
                                          kind: monaco.languages.CompletionItemKind.Variable,
                                          detail: 'The reference image to compare against',
                                          insertText: 'refImage',
                                          range: range,
                                        },
                                        {
                                          label: 'arch',
                                          kind: monaco.languages.CompletionItemKind.Variable,
                                          detail: 'Current architecture being tested',
                                          insertText: 'arch',
                                          range: range,
                                        },
                                        {
                                          label: 'inputs.',
                                          kind: monaco.languages.CompletionItemKind.Property,
                                          detail: 'Access user-defined pipeline inputs',
                                          insertText: 'inputs.',
                                          range: range,
                                        },
                                      ];

                                      return { suggestions };
                                      },
                                    });
                                  }
                                }}
                                theme="vs-dark"
                                keepCurrentModel={false}
                                saveViewState={false}
                                options={{
                                  readOnly: false,
                                  minimap: { enabled: false },
                                  scrollBeyondLastLine: false,
                                  fontSize: 12,
                                  tabSize: 2,
                                  wordWrap: "on",
                                  automaticLayout: true,
                                  lineNumbers: "on",
                                  contextmenu: true,
                                  quickSuggestions: true,
                                  selectOnLineNumbers: true,
                                  cursorStyle: "line",
                                  glyphMargin: false,
                                  folding: true,
                                  lineDecorationsWidth: 0,
                                  lineNumbersMinChars: 3,
                                }}
                              />
                            </div>
                          ) : apko.testYaml ? (
                            <div key={`test-wrapper-${apko.id}-readonly`} className="w-full max-w-4xl border rounded-md overflow-hidden">
                              <MonacoEditor
                                path={`apko-${apko.id}-test-readonly.yaml`}
                                height="200px"
                                language="yaml"
                                value={apko.testYaml}
                                theme="vs-dark"
                                keepCurrentModel={false}
                                saveViewState={false}
                                options={{
                                  readOnly: true,
                                  minimap: { enabled: false },
                                  scrollBeyondLastLine: false,
                                  fontSize: 12,
                                  tabSize: 2,
                                  wordWrap: "on",
                                  automaticLayout: true,
                                  lineNumbers: "on",
                                  glyphMargin: false,
                                  folding: true,
                                  lineDecorationsWidth: 0,
                                  lineNumbersMinChars: 3,
                                }}
                              />
                            </div>
                          ) : (
                            <div className="text-center py-6 text-muted-foreground border rounded-md bg-muted/50">
                              <p className="text-sm italic">No test YAML configured for this APKO</p>
                              <p className="text-xs mt-1">Add a test definition to enable automated testing</p>
                            </div>
                          )}
                        </div>

                        {/* APKO Package Dependencies */}
                        <div className="mt-4">
                          <div className="mb-2">
                            <label className="text-sm font-medium text-muted-foreground">Package Dependencies</label>
                          </div>

                          {apkoPackages[apko.id] && apkoPackages[apko.id].length > 0 ? (
                            <div className="space-y-2 max-h-60 overflow-y-auto border rounded-md">
                              {apkoPackages[apko.id].map((pkg) => (
                                <div key={pkg.id} className="border-b last:border-b-0 p-3 hover:bg-muted/50">
                                  <div className="flex items-start justify-between">
                                    <div>
                                      <h4 className="font-medium text-sm">
                                        <Link
                                          href={`/packages/${pkg.id}`}
                                          className="hover:underline text-blue-600 hover:text-blue-800"
                                        >
                                          {pkg.name}
                                        </Link>
                                      </h4>
                                      <p className="text-xs text-muted-foreground">ID: {pkg.id}</p>
                                      <div className="flex items-center gap-2 mt-1">
                                        <Clock className="h-3 w-3 text-muted-foreground" />
                                        <span className="text-xs text-muted-foreground">
                                          Created {formatDate(pkg.createdAt)}
                                        </span>
                                      </div>
                                    </div>
                                    <Badge variant="outline" className="text-xs">
                                      <Package className="h-3 w-3 mr-1" />
                                      Package
                                    </Badge>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : apkoPackages[apko.id] ? (
                            <div className="text-center py-6 text-muted-foreground border rounded-md bg-muted/50">
                              <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
                              <p className="text-sm italic">No package dependencies found for this APKO.</p>
                            </div>
                          ) : (
                            <div className="text-center py-6 text-muted-foreground border rounded-md bg-muted/50">
                              <p className="text-sm italic">Loading package dependencies...</p>
                            </div>
                          )}
                        </div>
                      </div>
                    )})}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Package className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>No APKO configurations found for this image.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="security">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Security Scans</CardTitle>
                    <CardDescription>Review of security vulnerabilities from live scan data</CardDescription>
                  </div>
                  <Button size="sm" onClick={fetchScanResults} disabled={scanResultsLoading}>
                    <Shield className="mr-2 h-4 w-4" />
                    {scanResultsLoading ? "Loading..." : "Refresh"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Check if image has no catalog items and show warning */}
                {image && (!image.catalogItems || image.catalogItems.length === 0) && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <h3 className="text-sm font-medium text-amber-800 mb-1">Image Not Available for Scanning</h3>
                        <p className="text-sm text-amber-700 mb-2">
                          This image cannot be scanned because it's not associated with any catalog items. Security scans
                          are only performed on images that are published to the catalog.
                        </p>
                        <p className="text-xs text-amber-600">
                          To enable scanning, add this image to a catalog item from the{" "}
                          <Link href="/catalog" className="underline hover:text-amber-800">
                            Catalog
                          </Link>
                          .
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {scanResultsLoading ? (
                  <div className="flex flex-col items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
                    <p className="text-sm text-muted-foreground">Loading scan results...</p>
                  </div>
                ) : scanResults.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Shield className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>No security scan results found for this image.</p>
                    <p className="text-sm mt-2">
                      {image && image.catalogItems && image.catalogItems.length > 0
                        ? "Scan results will appear here once security scans are performed."
                        : "Add this image to the catalog to enable security scanning."}
                    </p>
                  </div>
                ) : (
                  scanResults.map((scanSummary, runIndex) => (
                    <div key={runIndex} className="border rounded-lg">
                      <div className="bg-muted/50 px-4 py-3 border-b">
                        <h3 className="font-semibold">Scan Results for {scanSummary.imageName}</h3>
                        <p className="text-sm text-muted-foreground">{scanSummary.scans.length} scan(s) available</p>
                      </div>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Tag</TableHead>
                            <TableHead>Architecture</TableHead>
                            <TableHead>Vulnerabilities</TableHead>
                            <TableHead>Scanned At</TableHead>
                            <TableHead>Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {scanSummary.scans.map((scan, index) => (
                            <TableRow key={index}>
                              <TableCell className="font-mono text-xs">{scan.tag}</TableCell>
                              <TableCell className="font-mono text-xs">{scan.arch}</TableCell>
                              <TableCell>
                                <div className="flex flex-wrap gap-1">
                                  {scan.vulnerabilities.critical > 0 && (
                                    <Badge variant="destructive">{scan.vulnerabilities.critical} Critical</Badge>
                                  )}
                                  {scan.vulnerabilities.high > 0 && (
                                    <Badge variant="destructive" className="bg-orange-500">
                                      {scan.vulnerabilities.high} High
                                    </Badge>
                                  )}
                                  {scan.vulnerabilities.medium > 0 && (
                                    <Badge variant="secondary" className="bg-yellow-500 text-black">
                                      {scan.vulnerabilities.medium} Medium
                                    </Badge>
                                  )}
                                  {scan.vulnerabilities.low > 0 && (
                                    <Badge variant="outline">{scan.vulnerabilities.low} Low</Badge>
                                  )}
                                  {scan.vulnerabilities.critical === 0 &&
                                    scan.vulnerabilities.high === 0 &&
                                    scan.vulnerabilities.medium === 0 &&
                                    scan.vulnerabilities.low === 0 && (
                                      <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                                        No vulnerabilities
                                      </Badge>
                                    )}
                                </div>
                              </TableCell>
                              <TableCell className="text-xs">{formatDate(scan.scannedAt)}</TableCell>
                              <TableCell>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleDownloadScanResult(scan.scanId)}
                                  disabled={downloadingScanId === scan.scanId}
                                >
                                  <Download className="mr-1 h-3 w-3" />
                                  {downloadingScanId === scan.scanId ? "Downloading..." : "Download JSON"}
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="fixable-cves">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <CardTitle>Fixable CVEs</CardTitle>
                      {fixableCVEs.length > 0 && (
                        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-300">
                          {(() => {
                            // Simple count: sum all CVEs across all displayed APKOs (deduplicate within each APKO by CVE ID)
                            let totalCveCount = 0;
                            fixableCVEs
                              .filter(apko => apko.vulnerabilities.length > 0)
                              .forEach(apko => {
                                // Deduplicate CVEs within this APKO (same CVE across different architectures)
                                const uniqueCveIds = new Set(apko.vulnerabilities.map(vuln => vuln.cveId));
                                totalCveCount += uniqueCveIds.size;
                              });
                            return totalCveCount;
                          })()}
                        </Badge>
                      )}
                    </div>
                    <CardDescription>
                      Vulnerabilities with available fixes from latest scans. If no vulnerabilities are found for a tag, it is not displayed. Older tags are hidden by default. Tags with different secondary versions (e.g., k8s-1.32 vs k8s-1.33) are treated as separate versions and compared only within their group.
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    {(() => {
                      // Calculate outdated sections
                      if (fixableCVEs.length === 0) return null;

                      // Build map of major.minor -> newest tag
                      // Group by major.minor only (e.g., "2.10", "3.11")
                      // Use best semver tag for grouping (ignores "latest")
                      // Each unique full version (including secondary like k8s1.33) is independent
                      const newestByGroup = new Map<string, { tag: string; apkoId: string }>();
                      fixableCVEs.forEach(apko => {
                        const bestSemverTag = getBestSemverTag(apko.tags);

                        // Skip if no valid semver tag found
                        if (!bestSemverTag) return;

                        const groupKey = getGroupingKey(bestSemverTag);
                        if (!groupKey) return;

                        const existing = newestByGroup.get(groupKey);
                        if (!existing || compareTags(bestSemverTag, existing.tag) > 0) {
                          newestByGroup.set(groupKey, { tag: bestSemverTag, apkoId: apko.apkoId });
                        }
                      });

                      // Determine outdated APKOs (check ALL, not just those with CVEs)
                      // But only include those WITH CVEs in the toggle list
                      const outdatedApkoIds = fixableCVEs
                        .filter(apko => {
                          const bestSemverTag = getBestSemverTag(apko.tags);

                          // Can't be outdated if no valid semver tag
                          if (!bestSemverTag) return false;

                          const groupKey = getGroupingKey(bestSemverTag);
                          if (!groupKey) return false;

                          const newestInGroup = newestByGroup.get(groupKey);
                          if (!newestInGroup) return false;

                          // Outdated if this tag is older than the newest in the group
                          return compareTags(bestSemverTag, newestInGroup.tag) < 0;
                        })
                        .filter(apko => apko.vulnerabilities.length > 0) // Only show toggle for outdated WITH CVEs
                        .map(apko => apko.apkoId);

                      if (outdatedApkoIds.length === 0) return null;

                      const allOutdatedExpanded = outdatedApkoIds.every(id => expandedOutdatedSections.has(id));

                      const toggleAllOutdated = () => {
                        if (allOutdatedExpanded) {
                          setExpandedOutdatedSections(new Set());
                        } else {
                          setExpandedOutdatedSections(new Set(outdatedApkoIds));
                        }
                      };

                      return (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={toggleAllOutdated}
                          className="mr-2 w-[170px]"
                        >
                          {allOutdatedExpanded ? (
                            <>
                              <EyeOff className="mr-1.5 h-4 w-4" />
                              Hide Older Tags
                            </>
                          ) : (
                            <>
                              <Eye className="mr-1.5 h-4 w-4" />
                              Show Older Tags
                            </>
                          )}
                        </Button>
                      );
                    })()}
                    <Button size="sm" onClick={() => fetchFixableCVEs(true)} disabled={fixableCVEsLoading}>
                      <Shield className="mr-2 h-4 w-4" />
                      {fixableCVEsLoading ? "Loading..." : "Refresh"}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-8">
                {fixableCVEsLoading ? (
                  <div className="flex flex-col items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
                    <p className="text-sm text-muted-foreground">Loading fixable CVEs...</p>
                  </div>
                ) : fixableCVEs.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Shield className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>No fixable CVEs found.</p>
                  </div>
                ) : (
                  (() => {
                    // Sort APKOs by highest version first
                    const sortedFixableCVEs = [...fixableCVEs].sort((a, b) => {
                      const aTag = getMostSpecificTag(a.tags);
                      const bTag = getMostSpecificTag(b.tags);
                      return compareTags(bTag, aTag); // Descending order (highest first)
                    });

                    // Build map of grouping key (major.minor|secondary) -> highest version
                    // Each unique secondary version is its own group
                    // Examples: "2.10|k8s-1.32" and "2.10|k8s-1.33" are separate groups
                    const highestPrimaryByGroup = new Map<string, string>();
                    sortedFixableCVEs.forEach(apko => {
                      const bestSemverTag = getBestSemverTag(apko.tags);
                      if (!bestSemverTag) return;

                      const groupKey = getGroupingKey(bestSemverTag);
                      if (!groupKey) return;

                      const existing = highestPrimaryByGroup.get(groupKey);
                      if (!existing) {
                        highestPrimaryByGroup.set(groupKey, bestSemverTag);
                      } else {
                        const cmp = compareTags(bestSemverTag, existing);
                        if (cmp > 0) {
                          highestPrimaryByGroup.set(groupKey, bestSemverTag);
                        }
                      }
                    });

                    const toggleOutdatedSection = (apkoId: string) => {
                      setExpandedOutdatedSections(prev => {
                        const newSet = new Set(prev);
                        if (newSet.has(apkoId)) {
                          newSet.delete(apkoId);
                        } else {
                          newSet.add(apkoId);
                        }
                        return newSet;
                      });
                    };


                    const filtered = sortedFixableCVEs.filter(apkoData => apkoData.vulnerabilities.length > 0);

                    return filtered.map((apkoData) => {
                      const mostSpecificTag = getMostSpecificTag(apkoData.tags);
                      const bestSemverTag = getBestSemverTag(apkoData.tags);
                      const groupKey = bestSemverTag ? getGroupingKey(bestSemverTag) : null;
                      const highestInGroup = groupKey ? highestPrimaryByGroup.get(groupKey) : null;

                      // Outdated if there's a higher version in the same group
                      // Since groups now include secondary versions, only versions with the SAME secondary
                      // can be compared (e.g., 2.10.0-k8s-1.32 vs 2.10.1-k8s-1.32)
                      let isOutdated = false;
                      let newestTag = '';
                      if (highestInGroup && bestSemverTag) {
                        const cmp = compareTags(bestSemverTag, highestInGroup);
                        if (cmp < 0) {
                          isOutdated = true;
                          newestTag = highestInGroup;
                        } else {
                        }
                      }
                      const isCollapsed = isOutdated && !expandedOutdatedSections.has(apkoData.apkoId);

                      return (
                    <div key={apkoData.apkoId} className="border rounded-lg overflow-hidden">
                      <div className="bg-muted/50 px-4 py-3 border-b">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold">Tags: {apkoData.tags.join(", ")}</h3>
                            {isOutdated && (
                              <Badge variant="secondary" className="text-xs">
                                Most Recent: {newestTag}
                              </Badge>
                            )}
                          </div>
                          {isOutdated && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleOutdatedSection(apkoData.apkoId)}
                              className="h-6 px-2"
                            >
                              {isCollapsed ? (
                                <Plus className="h-4 w-4" />
                              ) : (
                                <X className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                        </div>
                      </div>
                      {!isCollapsed && (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Installed</TableHead>
                            <TableHead>Fixed In</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Vulnerability</TableHead>
                            <TableHead>Severity</TableHead>
                            <TableHead>EPSS %</TableHead>
                            <TableHead>Risk</TableHead>
                            <TableHead>Arch</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(() => {
                            // Deduplicate CVEs by cveId and show all architectures
                            const cveMap = new Map<string, any>();
                            apkoData.vulnerabilities.forEach((cve: any) => {
                              if (cveMap.has(cve.cveId)) {
                                // Add architecture to existing CVE
                                const existing = cveMap.get(cve.cveId);
                                if (!existing.archs.includes(cve.arch)) {
                                  existing.archs.push(cve.arch);
                                }
                              } else {
                                // New CVE
                                cveMap.set(cve.cveId, { ...cve, archs: [cve.arch] });
                              }
                            });

                            return Array.from(cveMap.values()).map((cve: any, idx: number) => (
                              <TableRow key={idx}>
                                <TableCell className="font-mono text-xs">{cve.artifactName}</TableCell>
                                <TableCell className="font-mono text-xs">{cve.artifactVersion}</TableCell>
                                <TableCell className="font-mono text-xs">{cve.fixVersions.join(", ")}</TableCell>
                                <TableCell className="text-xs">{cve.artifactType}</TableCell>
                                <TableCell>
                                  {cve.dataSource ? (
                                    <a
                                      href={cve.dataSource}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-blue-600 hover:underline font-mono text-xs"
                                    >
                                      {cve.cveId}
                                    </a>
                                  ) : (
                                    <span className="font-mono text-xs">{cve.cveId}</span>
                                  )}
                                </TableCell>
                                <TableCell>
                                  <Badge
                                    variant={
                                      cve.severity === "Critical" ? "destructive" :
                                      cve.severity === "High" ? "destructive" :
                                      cve.severity === "Medium" ? "secondary" :
                                      "outline"
                                    }
                                    className={
                                      cve.severity === "High" ? "bg-orange-500" :
                                      cve.severity === "Medium" ? "bg-yellow-500 text-black" :
                                      ""
                                    }
                                  >
                                    {cve.severity}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-xs">
                                  {cve.epssPercentile ? `${cve.epssPercentile.toFixed(2)}` : "—"}
                                </TableCell>
                                <TableCell className="text-xs">
                                  {cve.riskScore ? `${cve.riskScore.toFixed(1)}` : "—"}
                                </TableCell>
                                <TableCell className="text-xs">{cve.archs.join(", ")}</TableCell>
                              </TableRow>
                            ));
                          })()}
                        </TableBody>
                      </Table>
                      )}
                    </div>
                      );
                    });
                  })()
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="readme">
            <Card>
              <CardHeader>
                <CardTitle>README.md</CardTitle>
                <CardDescription>Documentation for this image</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="w-full border rounded-md overflow-hidden">
                  <MonacoEditor
                    height="600px"
                    language="markdown"
                    value={readmeContent}
                    onChange={(value) => setReadmeContent(value || "")}
                    theme="vs-dark"
                    options={{
                      readOnly: false,
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                      fontSize: 12,
                      tabSize: 2,
                      wordWrap: "on",
                      automaticLayout: true,
                      lineNumbers: "on",
                      contextmenu: true,
                      quickSuggestions: true,
                      selectOnLineNumbers: true,
                      cursorStyle: "line",
                      glyphMargin: false,
                      folding: true,
                      lineDecorationsWidth: 0,
                      lineNumbersMinChars: 3,
                    }}
                  />
                </div>
                <div className="mt-4">
                  <Button onClick={handleSaveReadme} size="sm" disabled={savingReadme}>
                    <Save className="mr-2 h-4 w-4" />
                    {savingReadme ? "Saving..." : "Save README"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="builds">
            <Card>
              <CardHeader>
                <CardTitle>Builds</CardTitle>
                <CardDescription>History of image builds (showing last 100)</CardDescription>
              </CardHeader>
              <CardContent>
                {buildsLoading ? (
                  <div className="flex justify-center items-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
                    <div>Loading builds...</div>
                  </div>
                ) : builds.length === 0 ? (
                  <div className="flex justify-center items-center py-8 text-muted-foreground">
                    No builds found for this image.
                  </div>
                ) : (
                  <BuildsTable builds={builds} />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="external-registries">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>External Registries</CardTitle>
                    <CardDescription>Configure external container registries for this image</CardDescription>
                  </div>
                  <Button
                    onClick={() => setShowAddExternalRegistryForm(true)}
                    disabled={showAddExternalRegistryForm}
                    size="sm"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add Registry
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {showAddExternalRegistryForm && (
                  <div className="border rounded-lg p-4 bg-muted/50">
                    <h3 className="font-semibold mb-4">Add External Registry</h3>
                    <div className="bg-blue-50 border border-blue-200 rounded-md p-3 mb-4">
                      <div className="flex items-start gap-2">
                        <Shield className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
                        <div className="text-sm">
                          <p className="font-medium text-blue-900 mb-1">Docker Hub Authentication</p>
                          <p className="text-blue-700">
                            For Docker Hub, you must use a <strong>Personal Access Token (PAT)</strong> or{" "}
                            <strong>OAuth Access Token (OAT)</strong> instead of your password. Username/password
                            authentication cannot support pushing SBOM attestations.
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-4">
                      <div>
                        <label className="text-sm font-medium text-muted-foreground">Registry URL</label>
                        <Input
                          value={registryUrl}
                          onChange={(e) => setRegistryUrl(e.target.value)}
                          placeholder={`e.g., ttl.sh/somepath/${image.name}, harbor.company.com/project/${image.name}, quay.io/user/${image.name}`}
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-muted-foreground">Username</label>
                        <Input
                          value={registryUsername}
                          onChange={(e) => setRegistryUsername(e.target.value)}
                          placeholder="Registry username"
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-muted-foreground">Password</label>
                        <Input
                          type="password"
                          value={registryPassword}
                          onChange={(e) => setRegistryPassword(e.target.value)}
                          placeholder="Registry password"
                          className="mt-1"
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button
                          onClick={handleAddExternalRegistry}
                          disabled={
                            isAddingExternalRegistry ||
                            !registryUrl.trim() ||
                            !registryUsername.trim() ||
                            !registryPassword.trim()
                          }
                          size="sm"
                        >
                          <Save className="mr-2 h-4 w-4" />
                          {isAddingExternalRegistry ? "Adding..." : "Add Registry"}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={handleCancelAddExternalRegistry}
                          disabled={isAddingExternalRegistry}
                          size="sm"
                        >
                          <X className="mr-2 h-4 w-4" />
                          Cancel
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* External Registries List */}
                {image?.externalRegistries && image.externalRegistries.length > 0 ? (
                  <div className="space-y-4">
                    {image.externalRegistries.map((registry: any) => (
                      <div key={registry.id} className="border rounded-lg p-4">
                        <div className="flex items-start justify-between">
                          <div>
                            <h3 className="font-semibold">{registry.registryUrl}</h3>
                            <p className="text-sm text-muted-foreground">Username: {registry.username}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <Clock className="h-3 w-3 text-muted-foreground" />
                              <span className="text-xs text-muted-foreground">
                                Added {formatDate(registry.createdAt)}
                              </span>
                            </div>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDeleteExternalRegistry(registry.id, registry.registryUrl)}
                            disabled={deletingRegistryId === registry.id}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="h-4 w-4" />
                            {deletingRegistryId === registry.id ? "Deleting..." : "Delete"}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : !showAddExternalRegistryForm ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Package className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>No external registries configured for this image.</p>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Tags Edit Modal */}
      {editingTagsApkoId && image && (
        <EditTagsModal
          isOpen={isTagsModalOpen}
          onClose={handleCloseTagsModal}
          apkoName={image.apkos.find((apko) => apko.id === editingTagsApkoId)?.name || "APKO"}
          currentTags={image.apkos.find((apko) => apko.id === editingTagsApkoId)?.tags || []}
          onSave={handleSaveTags}
          isLoading={savingTags}
        />
      )}

      {/* Delete External Registry Confirmation Modal */}
      {showDeleteConfirmation && registryToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/50" onClick={handleCancelDeleteExternalRegistry} />
          <div className="relative bg-white rounded-lg shadow-lg p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold mb-2">Delete External Registry</h3>
            <p className="text-muted-foreground mb-4">
              Are you sure you want to delete the registry <strong>{registryToDelete.url}</strong>? This action cannot
              be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={handleCancelDeleteExternalRegistry} disabled={deletingRegistryId !== null}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleConfirmDeleteExternalRegistry} disabled={deletingRegistryId !== null}>
                <Trash2 className="mr-2 h-4 w-4" />
                {deletingRegistryId ? "Deleting..." : "Delete Registry"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
