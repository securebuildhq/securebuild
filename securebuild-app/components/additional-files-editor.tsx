"use client";

import React, { useState, useEffect, useCallback } from "react";
import { FileTree } from "@/components/file-tree";
import { CodeEditor } from "@/components/code-editor";
import { Button } from "@/components/ui/button";
import { AdditionalFile } from "@/lib/types/package";
import { useToast } from "@/hooks/use-toast";
import { Session } from "@/lib/types/session";
import { listAdditionalFilesAction } from "@/lib/package/actions/list-additional-files";
import { createAdditionalFileAction } from "@/lib/package/actions/create-additional-file";
import { updateAdditionalFileAction } from "@/lib/package/actions/update-additional-file";
import { deleteAdditionalFileAction } from "@/lib/package/actions/delete-additional-file";
import { renameAdditionalFileAction } from "@/lib/package/actions/rename-additional-file";
import { Save } from "lucide-react";
import { cn } from "@/lib/utils";

interface AdditionalFilesEditorProps {
  session: Session;
  packageId: string;
  version: string;
  apkRelease: number;
  disabled?: boolean;
}

export function AdditionalFilesEditor({
  session,
  packageId,
  version,
  apkRelease,
  disabled = false,
}: AdditionalFilesEditorProps) {
  const { toast } = useToast();
  const [files, setFiles] = useState<AdditionalFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [originalContent, setOriginalContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Load files
  const loadFiles = useCallback(async () => {
    try {
      setLoading(true);
      const loadedFiles = await listAdditionalFilesAction(
        packageId,
        version,
        apkRelease
      );
      setFiles(loadedFiles);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to load additional files",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [session, packageId, version, apkRelease, toast]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  // Update content when file selection changes
  useEffect(() => {
    if (selectedFile) {
      const file = files.find((f) => f.path === selectedFile);
      if (file) {
        setFileContent(file.content);
        setOriginalContent(file.content);
      }
    } else {
      setFileContent("");
      setOriginalContent("");
    }
  }, [selectedFile, files]);

  const handleSaveFile = async () => {
    if (!selectedFile || fileContent === originalContent || disabled) return;

    try {
      setSaving(true);
      await updateAdditionalFileAction(
        packageId,
        version,
        apkRelease,
        selectedFile,
        fileContent
      );
      setOriginalContent(fileContent);
      // Update local state
      setFiles((prev) =>
        prev.map((f) =>
          f.path === selectedFile ? { ...f, content: fileContent } : f
        )
      );
      toast({
        title: "Success",
        description: "File saved successfully",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to save file",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleCreateFile = async (path: string) => {
    if (disabled) return;

    try {
      const newFile = await createAdditionalFileAction(
        packageId,
        version,
        apkRelease,
        path,
        ""
      );
      setFiles((prev) => [...prev, newFile]);
      setSelectedFile(path);
      toast({
        title: "Success",
        description: "File created successfully",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to create file",
        variant: "destructive",
      });
    }
  };

  const handleDeleteFile = async (path: string) => {
    if (disabled) return;

    try {
      await deleteAdditionalFileAction(
        packageId,
        version,
        apkRelease,
        path
      );
      setFiles((prev) => prev.filter((f) => f.path !== path));
      if (selectedFile === path) {
        setSelectedFile(null);
      }
      toast({
        title: "Success",
        description: "File deleted successfully",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete file",
        variant: "destructive",
      });
    }
  };

  const handleRenameFile = async (oldPath: string, newPath: string) => {
    if (disabled) return;

    try {
      const updatedFile = await renameAdditionalFileAction(
        packageId,
        version,
        apkRelease,
        oldPath,
        newPath
      );
      setFiles((prev) =>
        prev.map((f) => (f.path === oldPath ? updatedFile : f))
      );
      if (selectedFile === oldPath) {
        setSelectedFile(newPath);
      }
      toast({
        title: "Success",
        description: "File renamed successfully",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to rename file",
        variant: "destructive",
      });
    }
  };

  const getLanguageFromPath = (path: string): string => {
    const ext = path.split(".").pop()?.toLowerCase();
    switch (ext) {
      case "yaml":
      case "yml":
        return "yaml";
      case "json":
        return "json";
      case "sh":
      case "bash":
        return "shell";
      case "py":
        return "python";
      case "js":
        return "javascript";
      case "ts":
        return "typescript";
      case "go":
        return "go";
      case "rs":
        return "rust";
      case "c":
        return "c";
      case "cpp":
      case "cc":
        return "cpp";
      case "h":
      case "hpp":
        return "cpp";
      case "md":
        return "markdown";
      case "txt":
      default:
        return "plaintext";
    }
  };

  if (loading) {
    return <div className="flex justify-center items-center h-96">Loading...</div>;
  }

  return (
    <div className="flex h-[600px] border rounded-lg overflow-hidden">
      <div className="w-64 border-r bg-muted/20">
        <FileTree
          files={files}
          selectedFile={selectedFile}
          onSelectFile={setSelectedFile}
          onCreateFile={handleCreateFile}
          onDeleteFile={handleDeleteFile}
          onRenameFile={handleRenameFile}
        />
      </div>
      <div className="flex-1 flex flex-col">
        {selectedFile ? (
          <>
            <div className="flex items-center justify-between p-2 border-b">
              <span className="text-sm font-medium">{selectedFile}</span>
              <Button
                size="sm"
                onClick={handleSaveFile}
                disabled={
                  disabled ||
                  saving ||
                  fileContent === originalContent
                }
                className={cn(
                  "h-8",
                  fileContent !== originalContent && "animate-pulse"
                )}
              >
                <Save className="h-4 w-4 mr-1" />
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
            <div className="flex-1">
              <CodeEditor
                value={fileContent}
                onChange={setFileContent}
                language={getLanguageFromPath(selectedFile)}
                height="100%"
                readOnly={disabled}
              />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            Select a file to edit or create a new file
          </div>
        )}
      </div>
    </div>
  );
}
