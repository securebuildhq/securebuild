'use client';

import { useState, useEffect } from 'react';
import { useSession } from '@/app/hooks/use-session';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command';
import { ChevronsUpDown, X } from 'lucide-react';
import {
  getTeamCustomBuildImagesAction,
  addTeamCustomBuildImageAction,
  removeTeamCustomBuildImageAction,
  getAllImagesAction
} from '@/lib/team/actions/custom-build-images';

interface CustomBuildImagesProps {
  teamId: string;
}

export function CustomBuildImages({ teamId }: CustomBuildImagesProps) {
  const { session, isSessionLoading } = useSession();
  const [customBuildImages, setCustomBuildImages] = useState<string[]>([]);
  const [availableImages, setAvailableImages] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imageSearchOpen, setImageSearchOpen] = useState(false);

  useEffect(() => {
    if (session) {
      loadData();
    }
  }, [teamId, session]);

  async function loadData() {
    if (!session) return;

    setLoading(true);
    setError(null);

    try {
      const [imagesResult, availableResult] = await Promise.all([
        getTeamCustomBuildImagesAction(session, teamId),
        getAllImagesAction(session)
      ]);

      if (imagesResult.success && imagesResult.images) {
        setCustomBuildImages(imagesResult.images);
      } else {
        setError(imagesResult.error || 'Failed to load custom build images');
      }

      if (availableResult.success && availableResult.images) {
        setAvailableImages(availableResult.images);
      }
    } catch (err) {
      setError('Failed to load data');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleAddImage(imageName: string) {
    if (!session) return;

    setError(null);

    try {
      const result = await addTeamCustomBuildImageAction(session, teamId, imageName);
      if (result.success) {
        setCustomBuildImages([...customBuildImages, imageName]);
      } else {
        setError(result.error || 'Failed to add image');
      }
    } catch (err) {
      setError('Failed to add image');
      console.error(err);
    }
  }

  async function handleRemoveImage(imageName: string) {
    if (!session) return;

    setError(null);

    try {
      const result = await removeTeamCustomBuildImageAction(session, teamId, imageName);
      if (result.success) {
        setCustomBuildImages(customBuildImages.filter(name => name !== imageName));
      } else {
        setError(result.error || 'Failed to remove image');
      }
    } catch (err) {
      setError('Failed to remove image');
      console.error(err);
    }
  }

  if (isSessionLoading || loading) {
    return <div className="text-gray-500">Loading custom build images...</div>;
  }

  if (!session) {
    return <div className="text-gray-500">Not authenticated</div>;
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {/* Display selected images */}
      {customBuildImages.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {customBuildImages.map((imageName) => (
            <div
              key={imageName}
              className="flex items-center gap-1 bg-secondary text-secondary-foreground px-2 py-1 rounded-md text-sm"
            >
              <span>{imageName}</span>
              <button
                type="button"
                onClick={() => handleRemoveImage(imageName)}
                className="ml-1 hover:opacity-70"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Searchable dropdown */}
      <Popover open={imageSearchOpen} onOpenChange={setImageSearchOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={imageSearchOpen}
            className="w-full justify-between"
            disabled={loading}
          >
            {loading ? "Loading images..." : `Select images... (${customBuildImages.length} selected)`}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
          <Command>
            <CommandInput placeholder="Search image..." />
            <CommandList>
              <CommandEmpty>{loading ? "Loading..." : "No image found."}</CommandEmpty>
              <CommandGroup>
                {availableImages.map((img) => {
                  const isSelected = customBuildImages.includes(img.name);
                  return (
                    <CommandItem
                      key={img.id}
                      value={img.name}
                      onSelect={() => {
                        if (!isSelected) {
                          handleAddImage(img.name);
                        }
                      }}
                      disabled={isSelected}
                      className={isSelected ? "opacity-50" : ""}
                    >
                      {img.name}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {customBuildImages.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No custom build images configured for this team.
        </p>
      )}
    </div>
  );
}
