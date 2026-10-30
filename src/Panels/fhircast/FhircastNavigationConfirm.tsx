import React from 'react';
import { Button } from '@ohif/ui-next';

interface Props {
  currentStudyUid: string;
  currentPatientId: string;
  nextStudyUid: string;
  nextPatientId: string;
  unsavedWork: boolean;
  patientChanges: boolean;
  onOpen: () => void;
  onCancel: () => void;
}

function Row({ label, study, patient }: { label: string; study: string; patient: string }) {
  return (
    <div className="space-y-1">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="rounded border border-white/10 bg-black/30 px-2 py-1.5">
        <div className="font-mono text-xs text-white break-words">{study || 'N/A'}</div>
        <div className="text-muted-foreground text-xs">Patient: {patient || 'N/A'}</div>
      </div>
    </div>
  );
}

/**
 * Confirmation shown before a FHIRcast context event navigates the viewer.
 *
 * Navigating to another study is a full mode exit/entry in OHIF, which clears
 * unsaved measurements and segmentations — so when any exist, or the context
 * changes the active patient, the user decides. "Not now" keeps the context
 * pending; the FHIRcast panel's Open button (or the next accepted dialog)
 * opens the most recent context received.
 */
export default function FhircastNavigationConfirm({
  currentStudyUid,
  currentPatientId,
  nextStudyUid,
  nextPatientId,
  unsavedWork,
  patientChanges,
  onOpen,
  onCancel,
}: Props) {
  return (
    <div className="space-y-4 text-white">
      <div className="text-sm">
        A FHIRcast event asks the viewer to open a different study.
        {unsavedWork && (
          <span>
            {' '}
            Opening it discards the unsaved measurements and segmentations in the current study.
          </span>
        )}
        {patientChanges && <span> It also changes the active patient.</span>}
      </div>
      <Row label="Current" study={currentStudyUid} patient={currentPatientId} />
      <Row label="Requested by context" study={nextStudyUid} patient={nextPatientId} />
      <div className="flex justify-end space-x-2 pt-2">
        <Button variant="secondary" onClick={onCancel}>
          Not now
        </Button>
        <Button variant="default" onClick={onOpen}>
          Open study
        </Button>
      </div>
    </div>
  );
}
