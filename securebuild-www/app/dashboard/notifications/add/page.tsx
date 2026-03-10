"use client"

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/app/hooks/use-session';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, ChevronDown, Mail, Webhook, X, Check, Tag, Shield, AlertTriangle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { createNotificationAction } from '@/lib/notification/actions/create-notification';
import { CreateNotificationRequest } from '@/lib/types/notification';
import { listSubscribedImagesAction } from '@/lib/image/actions/list-subscribed-images';
import { getPublishedTagsAction } from '@/lib/image/actions/get-published-tags';

type NotificationType = 'email' | 'webhook';
type NotificationEvent = 'tag_updated' | 'new_tag' | 'cve_found';

export default function AddNotificationPage() {
  const router = useRouter();
  const { session } = useSession();
  const [images, setImages] = useState<Array<{id: string, name: string, catalogItemId: string}>>([]);
  const [isLoadingImages, setIsLoadingImages] = useState(true);
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [notificationType, setNotificationType] = useState<NotificationType>('email');
  const [emailTarget, setEmailTarget] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<NotificationEvent[]>(['tag_updated']);
  const [isImageSelectorOpen, setIsImageSelectorOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'events' | 'webhook'>('events');
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [isLoadingTags, setIsLoadingTags] = useState(false);
  const [tagFilters, setTagFilters] = useState<Record<NotificationEvent, { mode: 'all' | 'specific'; tags: string[]; includeAllTags?: boolean }>>({
    tag_updated: { mode: 'all', tags: [], includeAllTags: true },
    new_tag: { mode: 'all', tags: [] },
    cve_found: { mode: 'all', tags: [], includeAllTags: true }
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load tags for a specific image
  const loadTagsForImage = useCallback(async (imageId: string) => {
    if (!session) return;

    try {
      setIsLoadingTags(true);
      const tags = await getPublishedTagsAction(session, imageId);
      setAvailableTags(tags);
    } catch (error) {
      console.error('Failed to load tags for image:', error);
      setAvailableTags([]);
    } finally {
      setIsLoadingTags(false);
    }
  }, [session]);

    // Load images on mount
  useEffect(() => {
    const loadImages = async () => {
      if (!session) return;

      try {
        setIsLoadingImages(true);
        const imageList = await listSubscribedImagesAction(session);
        setImages(imageList);
      } catch (error) {
        console.error('Failed to load images:', error);
        setError('Failed to load available images');
      } finally {
        setIsLoadingImages(false);
      }
    };

    loadImages();
  }, [session]);

  // Load tags when exactly one image is selected
  useEffect(() => {
    if (selectedImages.length === 1) {
      loadTagsForImage(selectedImages[0]);
    } else {
      setAvailableTags([]);
    }
  }, [selectedImages, loadTagsForImage]);

    const handleImageSelect = (imageId: string) => {
    setSelectedImages(prev =>
      prev.includes(imageId)
        ? prev.filter(id => id !== imageId)
        : [...prev, imageId]
    );
  };

    const handleImageRemove = (imageId: string) => {
    setSelectedImages(prev => prev.filter(id => id !== imageId));
  };

    const handleEventChange = (event: NotificationEvent, checked: boolean) => {
    setSelectedEvents(prev =>
      checked
        ? [...prev, event]
        : prev.filter(e => e !== event)
    );
  };

  const handleTagFilterChange = (event: NotificationEvent, mode: 'all' | 'specific', tags: string[] = [], includeAllTags?: boolean) => {
    setTagFilters(prev => ({
      ...prev,
      [event]: { mode, tags, includeAllTags }
    }));
  };

  const getAllAvailableTags = () => {
    // Return tags loaded from the API for the selected image
    return availableTags.sort();
  };

  const handleNotificationTypeChange = (type: NotificationType) => {
    setNotificationType(type);
    // Auto-switch to webhook tab when webhook is selected
    if (type === 'webhook') {
      setActiveTab('webhook');
    } else {
      setActiveTab('events');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!session) {
      setError('Session not found. Please log in again.');
      return;
    }

    setError(null);

    if (selectedImages.length === 0) {
      setError('Please select at least one image');
      return;
    }

    if (selectedEvents.length === 0) {
      setError('Please select at least one event type');
      return;
    }

    // Validate tag filters for specific mode (only when single image is selected)
    if (selectedImages.length === 1) {
      for (const event of selectedEvents) {
        if ((event === 'tag_updated' || event === 'cve_found') &&
            tagFilters[event].mode === 'specific' &&
            tagFilters[event].tags.length === 0) {
          setError(`Please select at least one tag for ${event === 'tag_updated' ? 'Tag Updated' : 'CVE Found'} event`);
          return;
        }
      }
    }

    if (notificationType === 'email' && !emailTarget.trim()) {
      setError('Please enter an email address');
      return;
    }

    if (notificationType === 'webhook' && !webhookUrl.trim()) {
      setError('Please enter a webhook URL');
      return;
    }

    try {
      setIsSubmitting(true);

      // Prepare the request data
      const request: CreateNotificationRequest = {
        imageIds: selectedImages,
        notificationType: notificationType,
        target: notificationType === 'email' ? emailTarget : webhookUrl,
        webhookSecret: notificationType === 'webhook' ? webhookSecret || undefined : undefined,
        events: selectedEvents,
        tagFilterMode: selectedImages.length === 1 ?
          // For single image, check if any selected event has specific tag filtering
          (selectedEvents.some(event =>
            (event === 'tag_updated' || event === 'cve_found') &&
            tagFilters[event].mode === 'specific'
          ) ? 'specific' : 'all') :
          'all', // Multi-image always uses 'all'
        tagFilters: selectedImages.length === 1 ?
          selectedEvents.flatMap(event => {
            const filter = tagFilters[event];
            if ((event === 'tag_updated' || event === 'cve_found') &&
                filter.mode === 'specific') {
              return filter.tags;
            }
            return [];
          }) : undefined
      };

      await createNotificationAction(session, request);

      // Success - redirect to notifications page
      router.push('/dashboard/notifications');
    } catch (error) {
      console.error('Failed to create notification:', error);
      setError('Failed to create notification. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedImageObjects = images.filter(image => selectedImages.includes(image.id));

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <div className="flex items-center gap-4 mb-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.back()}
          className="flex items-center gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <h1 className="text-2xl font-bold">Add Notification</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Configuration Form */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Configuration</CardTitle>
              <CardDescription>
                Set up notifications for your subscribed images
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Image Selection */}
                <div className="space-y-2">
                  <Label htmlFor="images">Select Images</Label>
                  <Popover open={isImageSelectorOpen} onOpenChange={setIsImageSelectorOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={isImageSelectorOpen}
                        className="w-full justify-between"
                      >
                        {selectedImages.length === 0
                          ? "Select images..."
                          : `${selectedImages.length} image${selectedImages.length > 1 ? 's' : ''} selected`
                        }
                        <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-full p-0">
                      <Command>
                        <CommandInput placeholder="Search images..." />
                        <CommandList>
                          <CommandEmpty>No images found.</CommandEmpty>
                          <CommandGroup>
                            {isLoadingImages ? (
                              <CommandItem disabled>
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                Loading images...
                              </CommandItem>
                            ) : (
                              images.map((image) => (
                                <CommandItem
                                  key={image.id}
                                  value={image.name}
                                  onSelect={() => handleImageSelect(image.id)}
                                  className="flex items-center gap-2"
                                >
                                  <div className={cn(
                                    "flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                                    selectedImages.includes(image.id)
                                      ? "bg-primary text-primary-foreground"
                                      : "opacity-50"
                                  )}>
                                    {selectedImages.includes(image.id) && (
                                      <Check className="h-3 w-3" />
                                    )}
                                  </div>
                                  <span className="font-mono text-sm">
                                    {image.name}
                                  </span>
                                </CommandItem>
                              ))
                            )}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>

                  {/* Selected Images Display */}
                  {selectedImageObjects.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {selectedImageObjects.map((image) => (
                        <Badge key={image.id} variant="secondary" className="flex items-center gap-1">
                          <span className="font-mono text-xs">{image.name}</span>
                          <button
                            type="button"
                            onClick={() => handleImageRemove(image.id)}
                            className="ml-1 hover:bg-secondary-foreground/20 rounded-full p-0.5"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                {/* Notification Type */}
                <div className="space-y-3">
                  <Label>Notification Type</Label>
                  <div className="grid grid-cols-2 gap-4">
                    <div
                      className={cn(
                        "flex items-center space-x-3 p-4 border rounded-lg cursor-pointer transition-colors",
                        notificationType === 'email'
                          ? "border-blue-500 bg-blue-50"
                          : "border-gray-200 hover:border-gray-300"
                      )}
                      onClick={() => handleNotificationTypeChange('email')}
                    >
                      <div className={cn(
                        "w-4 h-4 rounded-full border-2 flex items-center justify-center",
                        notificationType === 'email'
                          ? "border-blue-500 bg-blue-500"
                          : "border-gray-300"
                      )}>
                        {notificationType === 'email' && (
                          <div className="w-2 h-2 bg-white rounded-full" />
                        )}
                      </div>
                      <Mail className="h-5 w-5 text-blue-600" />
                      <span className="font-medium">Email</span>
                    </div>
                    <div
                      className={cn(
                        "flex items-center space-x-3 p-4 border rounded-lg cursor-pointer transition-colors",
                        notificationType === 'webhook'
                          ? "border-purple-500 bg-purple-50"
                          : "border-gray-200 hover:border-gray-300"
                      )}
                      onClick={() => handleNotificationTypeChange('webhook')}
                    >
                      <div className={cn(
                        "w-4 h-4 rounded-full border-2 flex items-center justify-center",
                        notificationType === 'webhook'
                          ? "border-purple-500 bg-purple-500"
                          : "border-gray-300"
                      )}>
                        {notificationType === 'webhook' && (
                          <div className="w-2 h-2 bg-white rounded-full" />
                        )}
                      </div>
                      <Webhook className="h-5 w-5 text-purple-600" />
                      <span className="font-medium">Webhook</span>
                    </div>
                  </div>
                </div>

                {/* Target Configuration */}
                {notificationType === 'email' && (
                  <div className="space-y-2">
                    <Label htmlFor="email">Email Address</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="notifications@example.com"
                      value={emailTarget}
                      onChange={(e) => setEmailTarget(e.target.value)}
                      required
                    />
                  </div>
                )}

                {notificationType === 'webhook' && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="webhook-url">Webhook URL</Label>
                      <Input
                        id="webhook-url"
                        type="url"
                        placeholder="https://your-app.com/webhooks/securebuild"
                        value={webhookUrl}
                        onChange={(e) => setWebhookUrl(e.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="webhook-secret">Secret (Optional)</Label>
                      <Input
                        id="webhook-secret"
                        type="password"
                        placeholder="Used for HMAC signature verification"
                        value={webhookSecret}
                        onChange={(e) => setWebhookSecret(e.target.value)}
                      />
                    </div>
                  </div>
                )}

                                 {/* Event Selection */}
                 <div className="space-y-4">
                   <Label>Event Types</Label>
                   <div className="space-y-4">
                     {/* Tag Updated */}
                     <div className="space-y-2">
                       <div className="flex items-center space-x-2">
                         <Checkbox
                           id="tag_updated"
                           checked={selectedEvents.includes('tag_updated')}
                           onCheckedChange={(checked) => handleEventChange('tag_updated', checked as boolean)}
                         />
                         <Label htmlFor="tag_updated" className="text-sm font-normal">
                           Tag updated (repushed due to vuln fixed)
                         </Label>
                       </div>
                       {selectedEvents.includes('tag_updated') && selectedImages.length > 0 && (
                         <div className="ml-6 space-y-2">
                           {selectedImages.length > 1 ? (
                             <div className="text-xs text-gray-500 bg-gray-50 p-2 rounded">
                               Tag filtering is only available when exactly one image is selected. Select a single image to configure tag-specific notifications.
                             </div>
                           ) : (
                             <>
                               <div className="flex items-center space-x-2">
                                 <input
                                   type="radio"
                                   id="tag_updated_all"
                                   name="tag_updated_mode"
                                   checked={tagFilters.tag_updated.mode === 'all'}
                                   onChange={() => handleTagFilterChange('tag_updated', 'all')}
                                   className="w-4 h-4"
                                 />
                                 <Label htmlFor="tag_updated_all" className="text-xs">
                                   All tags
                                 </Label>
                               </div>
                               <div className="flex items-center space-x-2">
                                 <input
                                   type="radio"
                                   id="tag_updated_specific"
                                   name="tag_updated_mode"
                                   checked={tagFilters.tag_updated.mode === 'specific'}
                                   onChange={() => handleTagFilterChange('tag_updated', 'specific')}
                                   className="w-4 h-4"
                                 />
                                 <Label htmlFor="tag_updated_specific" className="text-xs">
                                   Specific tags
                                 </Label>
                               </div>
                             </>
                           )}
                                                      {selectedImages.length === 1 && tagFilters.tag_updated.mode === 'specific' && (
                             <div className="ml-6 space-y-2">
                               <Popover>
                                 <PopoverTrigger asChild>
                                   <Button
                                     variant="outline"
                                     size="sm"
                                     className="w-full justify-between text-xs"
                                   >
                                                                         {tagFilters.tag_updated.tags.length === 0
                                      ? "Select tags..."
                                      : `${tagFilters.tag_updated.tags.length} tag${tagFilters.tag_updated.tags.length > 1 ? 's' : ''} selected`
                                    }
                                     <ChevronDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
                                   </Button>
                                 </PopoverTrigger>
                                 <PopoverContent className="w-full p-0">
                                   <Command>
                                     <CommandInput placeholder="Search tags..." />
                                     <CommandList>
                                       <CommandEmpty>No tags found.</CommandEmpty>
                                                                             <CommandGroup>
                                        {/* Individual tags */}
                                        {isLoadingTags ? (
                                          <CommandItem disabled>
                                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                            Loading tags...
                                          </CommandItem>
                                        ) : getAllAvailableTags().length === 0 ? (
                                          <CommandItem disabled>
                                            No published tags found
                                          </CommandItem>
                                        ) : (
                                          getAllAvailableTags().map((tag) => (
                                            <CommandItem
                                              key={tag}
                                              value={tag}
                                              onSelect={() => {
                                                const newTags = tagFilters.tag_updated.tags.includes(tag)
                                                  ? tagFilters.tag_updated.tags.filter(t => t !== tag)
                                                  : [...tagFilters.tag_updated.tags, tag];
                                                handleTagFilterChange('tag_updated', 'specific', newTags, false);
                                              }}
                                              className="flex items-center gap-2"
                                            >
                                              <div className={cn(
                                                "flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                                                tagFilters.tag_updated.tags.includes(tag)
                                                  ? "bg-primary text-primary-foreground"
                                                  : "opacity-50"
                                              )}>
                                                {tagFilters.tag_updated.tags.includes(tag) && (
                                                  <Check className="h-3 w-3" />
                                                )}
                                              </div>
                                              <span className="font-mono text-sm">{tag}</span>
                                            </CommandItem>
                                          ))
                                        )}
                                       </CommandGroup>
                                     </CommandList>
                                   </Command>
                                 </PopoverContent>
                               </Popover>

                                                             {/* Selected Tags Display */}
                              {tagFilters.tag_updated.tags.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {tagFilters.tag_updated.tags.map((tag) => (
                                    <Badge key={tag} variant="secondary" className="text-xs flex items-center gap-1">
                                      <span className="font-mono">{tag}</span>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const newTags = tagFilters.tag_updated.tags.filter(t => t !== tag);
                                          handleTagFilterChange('tag_updated', 'specific', newTags, false);
                                        }}
                                        className="ml-1 hover:bg-secondary-foreground/20 rounded-full p-0.5"
                                      >
                                        <X className="h-2 w-2" />
                                      </button>
                                    </Badge>
                                  ))}
                                </div>
                              )}
                             </div>
                           )}
                         </div>
                       )}
                     </div>

                     {/* New Tag */}
                     <div className="flex items-center space-x-2">
                       <Checkbox
                         id="new_tag"
                         checked={selectedEvents.includes('new_tag')}
                         onCheckedChange={(checked) => handleEventChange('new_tag', checked as boolean)}
                       />
                       <Label htmlFor="new_tag" className="text-sm font-normal">
                         New tag available
                       </Label>
                     </div>

                     {/* CVE Found */}
                     <div className="space-y-2">
                       <div className="flex items-center space-x-2">
                         <Checkbox
                           id="cve_found"
                           checked={selectedEvents.includes('cve_found')}
                           onCheckedChange={(checked) => handleEventChange('cve_found', checked as boolean)}
                         />
                         <Label htmlFor="cve_found" className="text-sm font-normal">
                           CVE found in SecureBuild image
                         </Label>
                       </div>
                       {selectedEvents.includes('cve_found') && selectedImages.length > 0 && (
                         <div className="ml-6 space-y-2">
                           {selectedImages.length > 1 ? (
                             <div className="text-xs text-gray-500 bg-gray-50 p-2 rounded">
                               Tag filtering is only available when exactly one image is selected. Select a single image to configure tag-specific notifications.
                             </div>
                           ) : (
                             <>
                               <div className="flex items-center space-x-2">
                                 <input
                                   type="radio"
                                   id="cve_found_all"
                                   name="cve_found_mode"
                                   checked={tagFilters.cve_found.mode === 'all'}
                                   onChange={() => handleTagFilterChange('cve_found', 'all')}
                                   className="w-4 h-4"
                                 />
                                 <Label htmlFor="cve_found_all" className="text-xs">
                                   All tags
                                 </Label>
                               </div>
                               <div className="flex items-center space-x-2">
                                 <input
                                   type="radio"
                                   id="cve_found_specific"
                                   name="cve_found_mode"
                                   checked={tagFilters.cve_found.mode === 'specific'}
                                   onChange={() => handleTagFilterChange('cve_found', 'specific')}
                                   className="w-4 h-4"
                                 />
                                 <Label htmlFor="cve_found_specific" className="text-xs">
                                   Specific tags
                                 </Label>
                               </div>
                             </>
                           )}
                                                      {selectedImages.length === 1 && tagFilters.cve_found.mode === 'specific' && (
                             <div className="ml-6 space-y-2">
                               <Popover>
                                 <PopoverTrigger asChild>
                                   <Button
                                     variant="outline"
                                     size="sm"
                                     className="w-full justify-between text-xs"
                                   >
                                                                         {tagFilters.cve_found.tags.length === 0
                                      ? "Select tags..."
                                      : `${tagFilters.cve_found.tags.length} tag${tagFilters.cve_found.tags.length > 1 ? 's' : ''} selected`
                                    }
                                     <ChevronDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
                                   </Button>
                                 </PopoverTrigger>
                                 <PopoverContent className="w-full p-0">
                                   <Command>
                                     <CommandInput placeholder="Search tags..." />
                                     <CommandList>
                                       <CommandEmpty>No tags found.</CommandEmpty>
                                                                             <CommandGroup>
                                        {/* Individual tags */}
                                        {isLoadingTags ? (
                                          <CommandItem disabled>
                                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                            Loading tags...
                                          </CommandItem>
                                        ) : getAllAvailableTags().length === 0 ? (
                                          <CommandItem disabled>
                                            No published tags found
                                          </CommandItem>
                                        ) : (
                                          getAllAvailableTags().map((tag) => (
                                            <CommandItem
                                              key={tag}
                                              value={tag}
                                              onSelect={() => {
                                                const newTags = tagFilters.cve_found.tags.includes(tag)
                                                  ? tagFilters.cve_found.tags.filter(t => t !== tag)
                                                  : [...tagFilters.cve_found.tags, tag];
                                                handleTagFilterChange('cve_found', 'specific', newTags, false);
                                              }}
                                              className="flex items-center gap-2"
                                            >
                                              <div className={cn(
                                                "flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                                                tagFilters.cve_found.tags.includes(tag)
                                                  ? "bg-primary text-primary-foreground"
                                                  : "opacity-50"
                                              )}>
                                                {tagFilters.cve_found.tags.includes(tag) && (
                                                  <Check className="h-3 w-3" />
                                                )}
                                              </div>
                                              <span className="font-mono text-sm">{tag}</span>
                                            </CommandItem>
                                          ))
                                        )}
                                       </CommandGroup>
                                     </CommandList>
                                   </Command>
                                 </PopoverContent>
                               </Popover>

                                                             {/* Selected Tags Display */}
                              {tagFilters.cve_found.tags.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {tagFilters.cve_found.tags.map((tag) => (
                                    <Badge key={tag} variant="secondary" className="text-xs flex items-center gap-1">
                                      <span className="font-mono">{tag}</span>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const newTags = tagFilters.cve_found.tags.filter(t => t !== tag);
                                          handleTagFilterChange('cve_found', 'specific', newTags, false);
                                        }}
                                        className="ml-1 hover:bg-secondary-foreground/20 rounded-full p-0.5"
                                      >
                                        <X className="h-2 w-2" />
                                      </button>
                                    </Badge>
                                  ))}
                                </div>
                              )}
                             </div>
                           )}
                         </div>
                       )}
                     </div>
                   </div>
                 </div>

                {/* Error Display */}
                {error && (
                  <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-red-600" />
                      <span className="text-sm text-red-700">{error}</span>
                    </div>
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full"
                  disabled={
                    isSubmitting ||
                    selectedImages.length === 0 ||
                    selectedEvents.length === 0 ||
                    (notificationType === 'email' && !emailTarget.trim()) ||
                    (notificationType === 'webhook' && !webhookUrl.trim()) ||
                                (selectedImages.length === 1 && selectedEvents.some(event =>
              (event === 'tag_updated' || event === 'cve_found') &&
              tagFilters[event].mode === 'specific' &&
              tagFilters[event].tags.length === 0
            ))
                  }
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    'Create Notification'
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

        {/* Documentation Panel */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Documentation</CardTitle>
              <CardDescription>
                Learn about event types and webhook integration
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'events' | 'webhook')}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="events">Event Types</TabsTrigger>
                  <TabsTrigger value="webhook">Webhook</TabsTrigger>
                </TabsList>

                                 <TabsContent value="events" className="space-y-4 mt-4">
                   <div className="space-y-4">
                     <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200">
                       <Tag className="h-5 w-5 text-gray-600 mt-0.5" />
                       <div>
                         <h4 className="font-semibold text-gray-900">Tag Updated</h4>
                         <p className="text-sm text-gray-700 mt-1">
                           Triggered when an existing tag is repushed to fix vulnerabilities.
                           The image digest changes but the tag remains the same.
                         </p>
                         <div className="mt-2 text-xs text-gray-600 bg-gray-100 px-2 py-1 rounded">
                           Example: nginx:latest updated to patch CVE-2023-1234
                         </div>
                       </div>
                     </div>

                     <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200">
                       <Tag className="h-5 w-5 text-gray-600 mt-0.5" />
                       <div>
                         <h4 className="font-semibold text-gray-900">New Tag Available</h4>
                         <p className="text-sm text-gray-700 mt-1">
                           Triggered when a completely new tag is published for an image you&apos;re subscribed to.
                         </p>
                         <div className="mt-2 text-xs text-gray-600 bg-gray-100 px-2 py-1 rounded">
                           Example: postgres:16.10 released (you&apos;re subscribed to postgres and 16.9 is the latest in 16.x)
                         </div>
                       </div>
                     </div>

                     <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200">
                       <Shield className="h-5 w-5 text-gray-600 mt-0.5" />
                       <div>
                         <h4 className="font-semibold text-gray-900">CVE Found</h4>
                         <p className="text-sm text-gray-700 mt-1">
                           Triggered when a new CVE is discovered in your SecureBuild image,
                           even if the upstream hasn&apos;t been updated yet.
                         </p>
                         <div className="mt-2 text-xs text-gray-600 bg-gray-100 px-2 py-1 rounded">
                           Example: CVE-2024-5678 affects nginx:latest you&apos;re using
                         </div>
                       </div>
                     </div>

                                         <div className="mt-6 p-4 bg-gray-50 rounded-lg border">
                       <div className="flex items-center gap-2 mb-2">
                         <AlertTriangle className="h-4 w-4 text-gray-600" />
                         <span className="text-sm font-medium text-gray-900">Best Practices</span>
                       </div>
                       <ul className="text-sm text-gray-700 space-y-1">
                         <li>• Enable &quot;Tag Updated&quot; for production images to stay secure</li>
                         <li>• Use &quot;New Tag Available&quot; to track version releases</li>
                         <li>• &quot;CVE Found&quot; provides early warning before patches are available</li>
                         <li>• &quot;All tags&quot; is recommended unless you need specific tag filtering</li>
                       </ul>
                     </div>
                  </div>
                </TabsContent>

                <TabsContent value="webhook" className="space-y-4 mt-4">
                  <div className="space-y-4">
                    <div className="p-4 bg-gray-50 rounded-lg">
                      <h4 className="font-semibold mb-2">Webhook Payload Structure</h4>
                      <pre className="text-xs bg-gray-800 text-gray-100 p-3 rounded overflow-x-auto">
{`{
  "event": "image.updated",
  "timestamp": "2024-01-15T10:30:00Z",
  "image": {
    "name": "cve0.io/nginx",
    "tag": "latest",
    "digest": "sha256:abc123...",
    "previous_digest": "sha256:def456..."
  },
  "vulnerability_summary": {
    "critical": 0,
    "high": 2,
    "medium": 5,
    "low": 12,
    "total": 19
  },
  "links": {
    "sbom": "https://cve0.io/nginx/latest/sbom",
    "scan_report": "https://cve0.io/nginx/latest/scan"
  }
}`}
                      </pre>
                    </div>

                    <div className="space-y-3">
                      <h4 className="font-semibold">Event Types</h4>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <code className="bg-gray-100 px-2 py-1 rounded">image.updated</code>
                          <span className="text-gray-600">Tag repushed (vuln fixed)</span>
                        </div>
                        <div className="flex justify-between">
                          <code className="bg-gray-100 px-2 py-1 rounded">image.new_tag</code>
                          <span className="text-gray-600">New tag available</span>
                        </div>
                        <div className="flex justify-between">
                          <code className="bg-gray-100 px-2 py-1 rounded">image.cve_found</code>
                          <span className="text-gray-600">CVE discovered</span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <h4 className="font-semibold">HTTP Headers</h4>
                      <div className="text-sm space-y-1">
                        <div><code className="bg-gray-100 px-2 py-1 rounded">Content-Type: application/json</code></div>
                        <div><code className="bg-gray-100 px-2 py-1 rounded">X-SecureBuild-Event: image.updated</code></div>
                        <div><code className="bg-gray-100 px-2 py-1 rounded">X-SecureBuild-Signature: sha256=...</code></div>
                      </div>
                    </div>

                                         <div className="space-y-3">
                       <h4 className="font-semibold">Signature Verification</h4>
                       <Tabs defaultValue="python" className="w-full">
                         <TabsList className="grid w-full grid-cols-4">
                           <TabsTrigger value="python">Python</TabsTrigger>
                           <TabsTrigger value="typescript">TypeScript</TabsTrigger>
                           <TabsTrigger value="go">Go</TabsTrigger>
                           <TabsTrigger value="bash">Bash</TabsTrigger>
                         </TabsList>

                         <TabsContent value="python">
                           <pre className="text-xs bg-gray-800 text-gray-100 p-3 rounded overflow-x-auto">
{`import hmac
import hashlib

def verify_signature(payload, signature, secret):
    expected = hmac.new(
        secret.encode('utf-8'),
        payload.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(
        f"sha256={expected}",
        signature
    )

# Usage
payload = request.body
signature = request.headers.get('X-SecureBuild-Signature')
secret = 'your-webhook-secret'

if verify_signature(payload, signature, secret):
    print("Signature valid")
else:
    print("Invalid signature")`}
                           </pre>
                         </TabsContent>

                         <TabsContent value="typescript">
                           <pre className="text-xs bg-gray-800 text-gray-100 p-3 rounded overflow-x-auto">
{`import crypto from 'crypto';

function verifySignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload, 'utf8')
    .digest('hex');

  const expectedSignature = \`sha256=\${expected}\`;

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

// Usage (Express.js example)
app.post('/webhook', (req, res) => {
  const payload = JSON.stringify(req.body);
  const signature = req.headers['x-securebuild-signature'];
  const secret = process.env.WEBHOOK_SECRET;

  if (verifySignature(payload, signature, secret)) {
    console.log('Signature valid');
    // Process webhook...
  } else {
    console.log('Invalid signature');
    res.status(401).send('Unauthorized');
  }
});`}
                           </pre>
                         </TabsContent>

                         <TabsContent value="go">
                           <pre className="text-xs bg-gray-800 text-gray-100 p-3 rounded overflow-x-auto">
{`package main

import (
    "crypto/hmac"
    "crypto/sha256"
    "crypto/subtle"
    "encoding/hex"
    "fmt"
    "net/http"
)

func verifySignature(payload, signature, secret string) bool {
    mac := hmac.New(sha256.New, []byte(secret))
    mac.Write([]byte(payload))
    expected := "sha256=" + hex.EncodeToString(mac.Sum(nil))

    return subtle.ConstantTimeCompare(
        []byte(signature),
        []byte(expected)
    ) == 1
}

// Usage (HTTP handler)
func webhookHandler(w http.ResponseWriter, r *http.Request) {
    payload := getRequestBody(r) // implement this
    signature := r.Header.Get("X-SecureBuild-Signature")
    secret := os.Getenv("WEBHOOK_SECRET")

    if verifySignature(payload, signature, secret) {
        fmt.Println("Signature valid")
        // Process webhook...
    } else {
        fmt.Println("Invalid signature")
        http.Error(w, "Unauthorized", http.StatusUnauthorized)
    }
}`}
                           </pre>
                         </TabsContent>

                         <TabsContent value="bash">
                           <pre className="text-xs bg-gray-800 text-gray-100 p-3 rounded overflow-x-auto">
{`#!/bin/bash

verify_signature() {
    local payload="$1"
    local signature="$2"
    local secret="$3"

    # Generate expected signature
    local expected="sha256=$(echo -n "$payload" | \\
        openssl dgst -sha256 -hmac "$secret" | \\
        sed 's/^.* //')"

    # Compare signatures
    if [ "$signature" = "$expected" ]; then
        return 0  # Valid
    else
        return 1  # Invalid
    fi
}

# Usage example
PAYLOAD='{"event":"image.updated","timestamp":"2024-01-15T10:30:00Z"}'
SIGNATURE="sha256=abc123..."
SECRET="your-webhook-secret"

if verify_signature "$PAYLOAD" "$SIGNATURE" "$SECRET"; then
    echo "Signature valid"
    # Process webhook...
else
    echo "Invalid signature"
    exit 1
fi

# Or use with curl to test
curl -X POST https://your-webhook-endpoint \\
  -H "Content-Type: application/json" \\
  -H "X-SecureBuild-Signature: $SIGNATURE" \\
  -d "$PAYLOAD"`}
                           </pre>
                         </TabsContent>
                       </Tabs>
                     </div>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
