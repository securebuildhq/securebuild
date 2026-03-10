import { notFound, redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/server-session";
import { getImageAction } from "@/lib/image/actions/get-image";
import { getImageScanResultsAction } from "@/lib/image/actions/get-image-scan-results";
import { getImageBuildsAction } from "@/lib/image/actions/get-image-builds";
import { getAPKOPackagesAction } from "@/lib/image/actions/get-apko-packages";
import { ImagePageClient } from "./image-page-client";

interface ImagePageProps {
  params: Promise<{
    id: string;
    tab?: string[];
  }>;
}

export default async function ImagePage({ params }: ImagePageProps) {
  // Get session from server-side cookies
  const session = await getServerSession();
  
  if (!session) {
    redirect("/");
  }

  const { id, tab: tabArray } = await params;
  const currentTab = tabArray?.[0] || "general";

  try {
    // Fetch only essential image data on server
    const image = await getImageAction(session, id);
    
    // Only pre-load data for the current tab to avoid memory issues
    let initialScanResults: any[] = [];
    let initialBuilds: any[] = [];
    let initialApkoPackages: { [apkoId: string]: any[] } = {};

    // Always pre-load builds data since it's needed for the General tab's ImageStatusIndicator
    try {
      initialBuilds = await getImageBuildsAction(session, image.id);
    } catch (error) {
      console.error("Failed to load builds:", error);
      initialBuilds = [];
    }

    // Pre-load data only for the active tab to reduce memory usage
    if (currentTab === "security") {
      try {
        initialScanResults = await getImageScanResultsAction(session, image.name);
      } catch (error) {
        console.error("Failed to load scan results:", error);
        initialScanResults = [];
      }
    } else if (currentTab === "apkos" && image.apkos && image.apkos.length > 0) {
      try {
        // Limit APKO package loading to prevent memory issues
        const limitedApkos = image.apkos.slice(0, 5); // Only load packages for first 5 APKOs
        const apkoPackagesResults = await Promise.allSettled(
          limitedApkos.map(async (apko) => ({
            apkoId: apko.id,
            packages: await getAPKOPackagesAction(session, apko.id).catch(() => [])
          }))
        );
        
        apkoPackagesResults.forEach((result) => {
          if (result.status === "fulfilled") {
            initialApkoPackages[result.value.apkoId] = result.value.packages;
          }
        });
      } catch (error) {
        console.error("Failed to load APKO packages:", error);
        initialApkoPackages = {};
      }
    }

    return (
      <ImagePageClient
        initialImage={image}
        initialScanResults={initialScanResults}
        initialBuilds={initialBuilds}
        initialApkoPackages={initialApkoPackages}
        currentTab={currentTab}
        session={session}
      />
    );
  } catch (error) {
    console.error("Failed to fetch image data:", error);
    notFound();
  }
}
