"use client";

import React, { useState, useMemo } from "react";
import {
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  FolderOpen,
  Plus,
  Trash2,
  Edit3,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AdditionalFile } from "@/lib/types/package";

interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileNode[];
}

interface FileTreeProps {
  files: AdditionalFile[];
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  onCreateFile: (path: string) => void;
  onDeleteFile: (path: string) => void;
  onRenameFile: (oldPath: string, newPath: string) => void;
}

export function FileTree({
  files,
  selectedFile,
  onSelectFile,
  onCreateFile,
  onDeleteFile,
  onRenameFile,
}: FileTreeProps) {
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [creatingIn, setCreatingIn] = useState<string | null>(null);
  const [newFileName, setNewFileName] = useState("");

  // Build tree structure from flat file list
  const fileTree = useMemo(() => {
    const root: FileNode = {
      name: "root",
      path: "",
      type: "directory",
      children: [],
    };

    // Sort files by path to ensure parent directories come before children
    const sortedFiles = [...files].sort((a, b) => a.path.localeCompare(b.path));

    sortedFiles.forEach((file) => {
      const parts = file.path.split("/");
      let current = root;

      // Create directory nodes as needed
      for (let i = 0; i < parts.length - 1; i++) {
        const dirName = parts[i];
        const dirPath = parts.slice(0, i + 1).join("/");

        let child = current.children?.find(
          (c) => c.name === dirName && c.type === "directory"
        );

        if (!child) {
          child = {
            name: dirName,
            path: dirPath,
            type: "directory",
            children: [],
          };
          current.children = [...(current.children || []), child];
        }

        current = child;
      }

      // Add file node
      const fileName = parts[parts.length - 1];
      current.children = [
        ...(current.children || []),
        {
          name: fileName,
          path: file.path,
          type: "file",
        },
      ];
    });

    // Sort children at each level
    const sortChildren = (node: FileNode) => {
      if (node.children) {
        node.children.sort((a, b) => {
          // Directories first
          if (a.type !== b.type) {
            return a.type === "directory" ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        });
        node.children.forEach(sortChildren);
      }
    };

    sortChildren(root);

    return root.children || [];
  }, [files]);

  const toggleExpanded = (path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const handleRename = (oldPath: string) => {
    const parts = oldPath.split("/");
    const oldName = parts[parts.length - 1];
    setRenamingPath(oldPath);
    setNewName(oldName);
  };

  const submitRename = () => {
    if (renamingPath && newName.trim()) {
      const parts = renamingPath.split("/");
      parts[parts.length - 1] = newName.trim();
      const newPath = parts.join("/");
      onRenameFile(renamingPath, newPath);
      setRenamingPath(null);
      setNewName("");
    }
  };

  const handleCreateFile = (parentPath: string) => {
    setCreatingIn(parentPath);
    setNewFileName("");
    // Expand the parent directory
    if (parentPath) {
      setExpandedDirs((prev) => new Set([...prev, parentPath]));
    }
  };

  const submitCreateFile = () => {
    if (newFileName.trim()) {
      const path = creatingIn ? `${creatingIn}/${newFileName.trim()}` : newFileName.trim();
      onCreateFile(path);
      setCreatingIn(null);
      setNewFileName("");
    }
  };

  const renderNode = (node: FileNode, depth: number = 0) => {
    const isExpanded = expandedDirs.has(node.path);
    const isSelected = selectedFile === node.path;
    const isRenaming = renamingPath === node.path;

    return (
      <div key={node.path}>
        <ContextMenu>
          <ContextMenuTrigger>
            <div
              className={cn(
                "flex items-center gap-1 px-2 py-1 cursor-pointer hover:bg-muted/50 rounded-sm",
                isSelected && "bg-muted",
                "select-none"
              )}
              style={{ paddingLeft: `${depth * 16 + 8}px` }}
              onClick={() => {
                if (node.type === "directory") {
                  toggleExpanded(node.path);
                } else {
                  onSelectFile(node.path);
                }
              }}
            >
              {node.type === "directory" ? (
                <>
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  {isExpanded ? (
                    <FolderOpen className="h-4 w-4" />
                  ) : (
                    <Folder className="h-4 w-4" />
                  )}
                </>
              ) : (
                <>
                  <div className="w-4" />
                  <File className="h-4 w-4" />
                </>
              )}
              {isRenaming ? (
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onBlur={submitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      submitRename();
                    } else if (e.key === "Escape") {
                      setRenamingPath(null);
                    }
                  }}
                  className="h-6 ml-1"
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="ml-1 text-sm">{node.name}</span>
              )}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            {node.type === "directory" && (
              <ContextMenuItem onClick={() => handleCreateFile(node.path)}>
                <Plus className="h-4 w-4 mr-2" />
                New File
              </ContextMenuItem>
            )}
            <ContextMenuItem onClick={() => handleRename(node.path)}>
              <Edit3 className="h-4 w-4 mr-2" />
              Rename
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => onDeleteFile(node.path)}
              className="text-destructive"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>

        {node.type === "directory" &&
          isExpanded &&
          node.children?.map((child) => renderNode(child, depth + 1))}

        {node.type === "directory" &&
          isExpanded &&
          creatingIn === node.path && (
            <div
              className="flex items-center gap-1 px-2 py-1"
              style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
            >
              <div className="w-4" />
              <File className="h-4 w-4" />
              <Input
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                onBlur={() => setCreatingIn(null)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    submitCreateFile();
                  } else if (e.key === "Escape") {
                    setCreatingIn(null);
                  }
                }}
                className="h-6 ml-1"
                placeholder="filename.txt"
                autoFocus
              />
            </div>
          )}
      </div>
    );
  };

  return (
    <div className="w-full h-full overflow-auto">
      <div className="p-2 border-b flex justify-between items-center">
        <h3 className="text-sm font-medium">Additional Files</h3>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => handleCreateFile("")}
          className="h-8 px-2"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <div className="p-2">
        {creatingIn === "" && (
          <div className="flex items-center gap-1 px-2 py-1">
            <div className="w-4" />
            <File className="h-4 w-4" />
            <Input
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              onBlur={() => setCreatingIn(null)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  submitCreateFile();
                } else if (e.key === "Escape") {
                  setCreatingIn(null);
                }
              }}
              className="h-6 ml-1"
              placeholder="filename.txt"
              autoFocus
            />
          </div>
        )}
        {fileTree.map((node) => renderNode(node))}
        {fileTree.length === 0 && creatingIn === null && (
          <p className="text-sm text-muted-foreground px-2">
            No files yet. Click + to add a file.
          </p>
        )}
      </div>
    </div>
  );
}