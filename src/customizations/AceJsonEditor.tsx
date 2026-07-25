import React from 'react';
import AceEditor from 'react-ace';
import 'ace-builds/src-noconflict/mode-json';
import 'ace-builds/src-noconflict/theme-tomorrow_night';

function AceJsonEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <AceEditor
      mode="json"
      theme="tomorrow_night"
      name="smart-registration-body"
      value={value}
      onChange={onChange}
      width="100%"
      height="220px"
      fontSize={12}
      tabSize={2}
      showPrintMargin={false}
      setOptions={{
        // No bundled worker — syntax validation is done by the modal itself
        useWorker: false,
      }}
      editorProps={{ $blockScrolling: true }}
    />
  );
}

export default AceJsonEditor;
