import React, { useState } from 'react';
import {
  Button,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@ohif/ui-next';
import type { ReceivedEvent } from './types';

interface EventsListProps {
  events: ReceivedEvent[];
}

function getEventType(evt: ReceivedEvent): string {
  return evt.event?.['hub.event'] || 'unknown';
}

function getUniqueEventTypes(events: ReceivedEvent[]): string[] {
  const types: Record<string, boolean> = {};
  events.forEach((evt) => {
    types[getEventType(evt)] = true;
  });
  return Object.keys(types);
}

function EventItem({ evt }: { evt: ReceivedEvent }) {
  const [expanded, setExpanded] = useState(false);

  const eventType = getEventType(evt);
  const eventTopic = evt.event?.['hub.topic'] || '';

  return (
    <div
      className="mb-1.5 cursor-pointer rounded border border-white/10 bg-black/30 p-2"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-white">
            {evt.timestamp ? `${evt.timestamp} \u2014 ` : ''}
            <span className="font-medium">{evt.id}</span>
            {eventTopic ? ` \u2014 topic: ${eventTopic}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {eventType !== 'unknown' && (
            <span className="fhircast-chip">
              {eventType}
            </span>
          )}
          <span className="text-muted-foreground text-xs">
            {expanded ? '\u25B2' : '\u25BC'}
          </span>
        </div>
      </div>
      {expanded && (
        <pre className="mt-2 whitespace-pre-wrap break-words rounded border border-white/10 bg-black/30 px-2 py-1.5 font-mono text-xs text-white">
          {JSON.stringify(evt, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default function EventsList({ events }: EventsListProps) {
  const [filterType, setFilterType] = useState('all');
  const [displayLimit, setDisplayLimit] = useState(100);

  const eventTypes = getUniqueEventTypes(events);

  const filteredEvents =
    filterType === 'all'
      ? events
      : events.filter((evt) => getEventType(evt) === filterType);

  const sortedEvents = [...filteredEvents].sort((a, b) => {
    if (a.timestamp > b.timestamp) return -1;
    if (a.timestamp < b.timestamp) return 1;
    return 0;
  });

  const displayedEvents = sortedEvents.slice(0, displayLimit);
  const hasMore = sortedEvents.length > displayLimit;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white">Received Events</span>
          {events.length > 0 && (
            <span className="inline-flex items-center rounded-full border border-white/10 bg-white/10 px-2 py-0.5 text-xs text-white">
              {events.length}
            </span>
          )}
        </div>
      </div>

      {eventTypes.length > 0 && (
        <div className="mb-2">
          <Select
            value={filterType}
            onValueChange={(value) => {
              setFilterType(value);
              setDisplayLimit(100);
            }}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Filter by event type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All ({events.length})</SelectItem>
              {eventTypes.map((type) => {
                const count = events.filter(
                  (evt) => getEventType(evt) === type
                ).length;
                return (
                  <SelectItem key={type} value={type}>
                    {type} ({count})
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="ohif-scrollbar max-h-[50vh] overflow-y-auto">
        {displayedEvents.length === 0 ? (
          <p className="text-muted-foreground text-xs italic">
            No events received yet
          </p>
        ) : (
          displayedEvents.map((evt, index) => (
            <EventItem key={evt.id || index} evt={evt} />
          ))
        )}
      </div>

      {hasMore && (
        <div className="mt-2 flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDisplayLimit((prev) => prev + 100)}
          >
            Load More ({sortedEvents.length - displayLimit} remaining)
          </Button>
        </div>
      )}
    </div>
  );
}
