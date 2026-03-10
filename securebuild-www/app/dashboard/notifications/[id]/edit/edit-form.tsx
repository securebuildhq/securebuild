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
import { updateNotificationAction, UpdateNotificationRequest } from '@/lib/notification/actions/update-notification';
import { NotificationWithImage, NotificationEvent } from '@/lib/types/notification';
import { getPublishedTagsAction } from '@/lib/image/actions/get-published-tags';

type TagFilterConfig = {
  mode: 'all' | 'specific';
  tags: string[];
  includeAllTags?: boolean;
};

interface EditNotificationFormProps {
  notification: NotificationWithImage;
}

export default function EditNotificationForm({ notification }: EditNotificationFormProps) {
  const router = useRouter();
  const { session } = useSession();
  const [emailTarget, setEmailTarget] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<NotificationEvent[]>([]);
  const [activeTab, setActiveTab] = useState<'events' | 'webhook'>('events');
  const [tagFilters, setTagFilters] = useState<Record<NotificationEvent, TagFilterConfig>>({
    tag_updated: { mode: 'all', tags: [], includeAllTags: true },
    new_tag: { mode: 'all', tags: [] },
    cve_found: { mode: 'all', tags: [], includeAllTags: true }
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [isLoadingTags, setIsLoadingTags] = useState(false);

  // Load tags for the image
  const loadTagsForImage = useCallback(async (catalogItemId: string) => {
    if (!session) return;

    try {
      setIsLoadingTags(true);
      const tags = await getPublishedTagsAction(session, catalogItemId);
      setAvailableTags(tags);
    } catch (error) {
      console.error('Failed to load tags for image:', error);
      setAvailableTags([]);
    } finally {
      setIsLoadingTags(false);
    }
  }, [session]);

  // Initialize form with notification data
  useEffect(() => {
    // Populate form fields
    if (notification.notificationType === 'email') {
      setEmailTarget(notification.target);
    } else {
      setWebhookUrl(notification.target);
      setWebhookSecret(notification.webhookSecret || '');
      setActiveTab('webhook');
    }

    setSelectedEvents(notification.events);

    // Set up tag filters based on notification data
    const newTagFilters: Record<NotificationEvent, TagFilterConfig> = {
      tag_updated: { mode: 'all', tags: [], includeAllTags: true },
      new_tag: { mode: 'all', tags: [] },
      cve_found: { mode: 'all', tags: [], includeAllTags: true }
    };

    if (notification.tagFilterMode === 'specific' && notification.tagFilters) {
      // If we have specific tag filters, set them for applicable events
      notification.events.forEach((event: NotificationEvent) => {
        if (event === 'tag_updated' || event === 'cve_found') {
          newTagFilters[event] = {
            mode: 'specific',
            tags: notification.tagFilters || [],
            includeAllTags: false
          };
        }
      });
    }

    setTagFilters(newTagFilters);

    // Load tags for the image
    loadTagsForImage(notification.image.id);
  }, [notification, loadTagsForImage]);

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
    // Return tags loaded from the API for the image
    return availableTags.sort();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!session) {
      setError('Session not found. Please log in again.');
      return;
    }

    setError(null);

    if (selectedEvents.length === 0) {
      setError('Please select at least one event type');
      return;
    }

    // Validate tag filters for specific mode
    for (const event of selectedEvents) {
      if ((event === 'tag_updated' || event === 'cve_found') &&
          tagFilters[event].mode === 'specific' &&
          !tagFilters[event].includeAllTags &&
          tagFilters[event].tags.length === 0) {
        setError(`Please select at least one tag for ${event === 'tag_updated' ? 'Tag Updated' : 'CVE Found'} event`);
        return;
      }
    }

    const target = notification.notificationType === 'email' ? emailTarget : webhookUrl;
    if (!target.trim()) {
      setError(`Please enter ${notification.notificationType === 'email' ? 'an email address' : 'a webhook URL'}`);
      return;
    }

    try {
      setIsSubmitting(true);

      // Prepare the update request
      const updates: UpdateNotificationRequest = {
        target: target,
        events: selectedEvents,
        tagFilterMode: 'all', // Default to all
        tagFilters: undefined
      };

      // Add webhook secret if it's a webhook notification
      if (notification.notificationType === 'webhook') {
        updates.webhookSecret = webhookSecret || undefined;
      }

      // Handle tag filters - check if user selected specific tag filtering for any event
      const hasSpecificTagFilters = selectedEvents.some(event =>
        (event === 'tag_updated' || event === 'cve_found') &&
        tagFilters[event].mode === 'specific'
      );

      if (hasSpecificTagFilters) {
        updates.tagFilterMode = 'specific';
        updates.tagFilters = selectedEvents.flatMap(event => {
          const filter = tagFilters[event];
          if ((event === 'tag_updated' || event === 'cve_found') &&
              filter.mode === 'specific' && !filter.includeAllTags) {
            return filter.tags;
          }
          return [];
        });
      }

      await updateNotificationAction(session, notification.id, updates);

      // Success - redirect to notifications page
      router.push('/dashboard/notifications');
    } catch (error) {
      console.error('Failed to update notification:', error);
      setError('Failed to update notification. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

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
        <h1 className="text-2xl font-bold">Edit Notification</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Configuration Form */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Configuration</CardTitle>
              <CardDescription>
                Update your notification settings
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Image Display (read-only) */}
                <div className="space-y-2">
                  <Label>Image</Label>
                  <div className="p-3 bg-gray-50 rounded-lg border">
                    <span className="font-mono text-sm">{notification.image.name}</span>
                    <p className="text-xs text-gray-500 mt-1">Image cannot be changed. Create a new notification for different images.</p>
                  </div>
                </div>

                {/* Notification Type Display (read-only) */}
                <div className="space-y-3">
                  <Label>Notification Type</Label>
                  <div className="flex items-center space-x-3 p-4 border rounded-lg bg-gray-50">
                    {notification.notificationType === 'email' ? (
                      <Mail className="h-5 w-5 text-blue-600" />
                    ) : (
                      <Webhook className="h-5 w-5 text-purple-600" />
                    )}
                    <span className="font-medium capitalize">{notification.notificationType}</span>
                    <span className="text-xs text-gray-500 ml-auto">Type cannot be changed</span>
                  </div>
                </div>

                {/* Target Configuration */}
                {notification.notificationType === 'email' && (
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

                {notification.notificationType === 'webhook' && (
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
                      {selectedEvents.includes('tag_updated') && (
                        <div className="ml-6 space-y-2">
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

                          {tagFilters.tag_updated.mode === 'specific' && (
                            <div className="ml-6 space-y-2">
                              <Popover>
                                <PopoverTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="w-full justify-between text-xs"
                                  >
                                    {tagFilters.tag_updated.includeAllTags
                                      ? "All tags (including future tags)"
                                      : tagFilters.tag_updated.tags.length === 0
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
                                        {/* All tags option */}
                                        <CommandItem
                                          key="__all_tags__"
                                          value="all tags including future"
                                          onSelect={() => {
                                            const newIncludeAllTags = !tagFilters.tag_updated.includeAllTags;
                                            handleTagFilterChange('tag_updated', 'specific', [], newIncludeAllTags);
                                          }}
                                          className="flex items-center gap-2"
                                        >
                                          <div className={cn(
                                            "flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                                            tagFilters.tag_updated.includeAllTags
                                              ? "bg-primary text-primary-foreground"
                                              : "opacity-50"
                                          )}>
                                            {tagFilters.tag_updated.includeAllTags && (
                                              <Check className="h-3 w-3" />
                                            )}
                                          </div>
                                          <span className="text-sm font-medium">All tags (including future tags)</span>
                                        </CommandItem>

                                        {/* Divider */}
                                        {!tagFilters.tag_updated.includeAllTags && (
                                          <>
                                            <div className="px-2 py-1.5">
                                              <div className="h-px bg-gray-200" />
                                            </div>

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
                                          </>
                                        )}
                                      </CommandGroup>
                                    </CommandList>
                                  </Command>
                                </PopoverContent>
                              </Popover>

                              {/* Selected Tags Display */}
                              {(tagFilters.tag_updated.includeAllTags || tagFilters.tag_updated.tags.length > 0) && (
                                <div className="flex flex-wrap gap-1">
                                  {tagFilters.tag_updated.includeAllTags && (
                                    <Badge variant="default" className="text-xs flex items-center gap-1">
                                      <span>All tags (including future tags)</span>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          handleTagFilterChange('tag_updated', 'specific', [], false);
                                        }}
                                        className="ml-1 hover:bg-primary-foreground/20 rounded-full p-0.5"
                                      >
                                        <X className="h-2 w-2" />
                                      </button>
                                    </Badge>
                                  )}
                                  {!tagFilters.tag_updated.includeAllTags && tagFilters.tag_updated.tags.map((tag) => (
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
                      {selectedEvents.includes('cve_found') && (
                        <div className="ml-6 space-y-2">
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

                          {tagFilters.cve_found.mode === 'specific' && (
                            <div className="ml-6 space-y-2">
                              <Popover>
                                <PopoverTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="w-full justify-between text-xs"
                                  >
                                    {tagFilters.cve_found.includeAllTags
                                      ? "All tags (including future tags)"
                                      : tagFilters.cve_found.tags.length === 0
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
                                        {/* All tags option */}
                                        <CommandItem
                                          key="__all_tags__"
                                          value="all tags including future"
                                          onSelect={() => {
                                            const newIncludeAllTags = !tagFilters.cve_found.includeAllTags;
                                            handleTagFilterChange('cve_found', 'specific', [], newIncludeAllTags);
                                          }}
                                          className="flex items-center gap-2"
                                        >
                                          <div className={cn(
                                            "flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                                            tagFilters.cve_found.includeAllTags
                                              ? "bg-primary text-primary-foreground"
                                              : "opacity-50"
                                          )}>
                                            {tagFilters.cve_found.includeAllTags && (
                                              <Check className="h-3 w-3" />
                                            )}
                                          </div>
                                          <span className="text-sm font-medium">All tags (including future tags)</span>
                                        </CommandItem>

                                        {/* Divider */}
                                        {!tagFilters.cve_found.includeAllTags && (
                                          <>
                                            <div className="px-2 py-1.5">
                                              <div className="h-px bg-gray-200" />
                                            </div>

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
                                          </>
                                        )}
                                      </CommandGroup>
                                    </CommandList>
                                  </Command>
                                </PopoverContent>
                              </Popover>

                              {/* Selected Tags Display */}
                              {(tagFilters.cve_found.includeAllTags || tagFilters.cve_found.tags.length > 0) && (
                                <div className="flex flex-wrap gap-1">
                                  {tagFilters.cve_found.includeAllTags && (
                                    <Badge variant="default" className="text-xs flex items-center gap-1">
                                      <span>All tags (including future tags)</span>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          handleTagFilterChange('cve_found', 'specific', [], false);
                                        }}
                                        className="ml-1 hover:bg-primary-foreground/20 rounded-full p-0.5"
                                      >
                                        <X className="h-2 w-2" />
                                      </button>
                                    </Badge>
                                  )}
                                  {!tagFilters.cve_found.includeAllTags && tagFilters.cve_found.tags.map((tag) => (
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
                    selectedEvents.length === 0 ||
                    (notification.notificationType === 'email' && !emailTarget.trim()) ||
                    (notification.notificationType === 'webhook' && !webhookUrl.trim()) ||
                    selectedEvents.some(event =>
                      (event === 'tag_updated' || event === 'cve_found') &&
                      tagFilters[event].mode === 'specific' &&
                      !tagFilters[event].includeAllTags &&
                      tagFilters[event].tags.length === 0
                    )
                  }
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Updating...
                    </>
                  ) : (
                    'Update Notification'
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
