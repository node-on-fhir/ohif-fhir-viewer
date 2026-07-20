import React from 'react';
import {
  Button,
  Input,
  Label,
  Checkbox,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@ohif/ui-next';
import { EVENT_OPTIONS } from './constants';
import type { WebSocketStatusValue } from './types';

interface SubscribeFormProps {
  hubUrl: string;
  onHubUrlChange: (value: string) => void;
  wsUrl: string;
  onWsUrlChange: (value: string) => void;
  wsStatus: WebSocketStatusValue;
  topic: string;
  onTopicChange: (value: string) => void;
  selectedEvents: string[];
  onSelectedEventsChange: (events: string[]) => void;
  saveToClient: boolean;
  onSaveToClientChange: (checked: boolean) => void;
  saveToServer: boolean;
  onSaveToServerChange: (checked: boolean) => void;
  hasSubscriptions: boolean;
  onSubscribe: () => void;
  onUnsubscribe: () => void;
  subscribeError?: string;
}

function EventChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="fhircast-chip gap-1">
      {label}
      <button
        onClick={onRemove}
        className="ml-0.5 hover:text-white"
        type="button"
      >
        &times;
      </button>
    </span>
  );
}

function WsStatusDot({ status }: { status: WebSocketStatusValue }) {
  const colorClass =
    status === 'Open'
      ? 'fhircast-dot--open'
      : status === 'Opening'
        ? 'fhircast-dot--opening'
        : 'fhircast-dot--closed';

  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${colorClass}`}
      title={status}
    />
  );
}

export default function SubscribeForm({
  hubUrl,
  onHubUrlChange,
  wsUrl,
  onWsUrlChange,
  wsStatus,
  topic,
  onTopicChange,
  selectedEvents,
  onSelectedEventsChange,
  saveToClient,
  onSaveToClientChange,
  saveToServer,
  onSaveToServerChange,
  hasSubscriptions,
  onSubscribe,
  onUnsubscribe,
  subscribeError,
}: SubscribeFormProps) {
  const availableEvents = EVENT_OPTIONS.filter(
    (opt) => !selectedEvents.includes(opt.value)
  );

  const handleAddEvent = (value: string) => {
    if (value && !selectedEvents.includes(value)) {
      onSelectedEventsChange([...selectedEvents, value]);
    }
  };

  const handleRemoveEvent = (value: string) => {
    onSelectedEventsChange(selectedEvents.filter((e) => e !== value));
  };

  const isSubscribeDisabled = !hubUrl || !topic || selectedEvents.length === 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-col space-y-1">
        <Label className="text-sm">Hub URL</Label>
        <Input
          className="h-8"
          value={hubUrl}
          onChange={(e) => onHubUrlChange(e.target.value)}
          disabled={hasSubscriptions}
          placeholder="http://localhost:3200/api/hub"
        />
      </div>

      <div className="flex flex-col space-y-1">
        <Label className="text-sm">WebSocket URL</Label>
        <div className="relative">
          <Input
            className="h-8 pr-8"
            value={wsUrl}
            onChange={(e) => onWsUrlChange(e.target.value)}
            disabled={hasSubscriptions}
            placeholder="ws://localhost:3200/bind"
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2">
            <WsStatusDot status={wsStatus} />
          </div>
        </div>
        <span className="text-muted-foreground text-xs">{wsStatus}</span>
      </div>

      <div className="flex flex-col space-y-1">
        <Label className="text-sm">Topic</Label>
        <Input
          className="h-8"
          value={topic}
          onChange={(e) => onTopicChange(e.target.value)}
          placeholder="DrXRay"
        />
      </div>

      <div className="flex flex-col space-y-1">
        <Label className="text-sm">Events</Label>
        {selectedEvents.length > 0 && (
          <div className="flex flex-wrap gap-1 pb-1">
            {selectedEvents.map((evt) => (
              <EventChip
                key={evt}
                label={evt}
                onRemove={() => handleRemoveEvent(evt)}
              />
            ))}
          </div>
        )}
        {availableEvents.length > 0 && (
          <Select onValueChange={handleAddEvent} value="">
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Add event type..." />
            </SelectTrigger>
            <SelectContent>
              {availableEvents.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Checkbox
            id="saveToClient"
            checked={saveToClient}
            onCheckedChange={(checked) => onSaveToClientChange(checked === true)}
          />
          <Label htmlFor="saveToClient" className="text-xs">
            Save to client
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="saveToServer"
            checked={saveToServer}
            onCheckedChange={(checked) => onSaveToServerChange(checked === true)}
          />
          <Label htmlFor="saveToServer" className="text-xs">
            Save to server
          </Label>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button
          variant="default"
          size="sm"
          disabled={isSubscribeDisabled}
          onClick={onSubscribe}
        >
          Subscribe
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={isSubscribeDisabled}
          onClick={onUnsubscribe}
        >
          Unsubscribe
        </Button>
      </div>

      {subscribeError && (
        <p className="text-xs text-red-400">{subscribeError}</p>
      )}
    </div>
  );
}
