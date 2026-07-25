import React from 'react';

// ace-builds is heavy — load it only when the collapsible section is opened,
// same pattern as the EcgViewport lazy import in src/index.tsx.
const LazyAceJsonEditor = React.lazy(() => import('./AceJsonEditor'));

function RegistrationBodyEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <React.Suspense fallback={<div className="text-muted-foreground text-xs">Loading editor...</div>}>
      <LazyAceJsonEditor value={value} onChange={onChange} />
    </React.Suspense>
  );
}

export default RegistrationBodyEditor;
