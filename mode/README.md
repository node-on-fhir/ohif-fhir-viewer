# fhir-viewer

> OHIF Mode — Lab #96: Watson mode with custom viewport actions

This mode provides a standard OHIF viewer layout with custom viewport action buttons in the top-right corner of each viewport. It depends on the `@ohif/extension-nof-custom-actions` extension.

**Author:** Abigail Watson
**License:** MIT

## Usage

1. Run `yarn dev` from the `labs/ohif` directory
2. Open the study list in the browser
3. Click the **Watson** button on any study row to open it in this mode
4. Look for custom action buttons in the viewport's top-right corner

## Extension Dependency

This mode depends on `@ohif/extension-nof-custom-actions`. See the extension's [README](../../extensions/nof-custom-actions/README.md) for detailed documentation on the commands, architecture, and how to add new viewport actions.
