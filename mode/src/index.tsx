import { hotkeys } from '@ohif/core';
import { initToolGroups, toolbarButtons } from '@ohif/mode-longitudinal';
import { id } from './id';
import pushCustomToolsToDefaultToolGroup from './pushCustomToolsToDefaultToolGroup';

const ohif = {
  layout: '@ohif/extension-default.layoutTemplateModule.viewerLayout',
  sopClassHandler: '@ohif/extension-default.sopClassHandlerModule.stack',
  hangingProtocol: ['default', 'chestBodyPart', 'xrOneUp'],
  leftPanel: '@ohif/extension-default.panelModule.seriesList',
  rightPanel: '@ohif/extension-cornerstone.panelModule.panelMeasurement',
};

const cornerstone = {
  viewport: '@ohif/extension-cornerstone.viewportModule.cornerstone',
};

const awatson = {
  fhirPanel:
    '@ohif/extension-nof-ohif-viewer.panelModule.fhirConfig',
  fhirCastPanel:
    '@ohif/extension-nof-ohif-viewer.panelModule.fhirCast',
  ecgSopClassHandler:
    '@ohif/extension-nof-ohif-viewer.sopClassHandlerModule.ecg-dicom',
  ecgViewport:
    '@ohif/extension-nof-ohif-viewer.viewportModule.ecg-dicom',
};

const extensionDependencies = {
  '@ohif/extension-default': '^3.0.0',
  '@ohif/extension-cornerstone': '^3.0.0',
  '@ohif/extension-cornerstone-dicom-seg': '^3.0.0',
  '@ohif/extension-nof-ohif-viewer': '^0.0.1',
};

function modeFactory({ modeConfiguration }) {
  return {
    id,
    routeName: 'fhir-viewer',
    displayName: 'FHIR Viewer',
    onModeInit: ({ servicesManager, extensionManager }) => {
      // The 'fhir' data source instance only exists if it was declared in
      // window.config.dataSources. When it isn't (e.g. running the stock
      // config/default.js), register it programmatically so the mode is
      // self-contained and EXTRA_EXTENSIONS=... works without config edits.
      // addDataSource is idempotent but does NOT activate an already-existing
      // source, so activate explicitly when one is already configured.
      const existing = extensionManager.getDataSources('fhir');
      if (existing?.[0]) {
        extensionManager.setActiveDataSource('fhir');
      } else {
        extensionManager.addDataSource(
          {
            friendlyName: 'FHIR R4 Server',
            namespace: '@ohif/extension-nof-ohif-viewer.dataSourcesModule.fhir',
            sourceName: 'fhir',
            configuration: {},
          },
          { activate: true }
        );
      }
    },
    onModeEnter: ({ servicesManager, extensionManager, commandsManager }: withAppTypes) => {
      const { measurementService, toolbarService, toolGroupService, customizationService } =
        servicesManager.services;

      measurementService.clearMeasurements();

      initToolGroups(extensionManager, toolGroupService, commandsManager);
      pushCustomToolsToDefaultToolGroup(extensionManager, toolGroupService, commandsManager);

      toolbarService.register([...toolbarButtons]);

      customizationService.setCustomizations({
        cornerstoneViewportClickCommands: {
          $set: {
            doubleClick: ['toggleOneUp'],
            button1: ['closeContextMenu'],
            button3: [
              {
                commandName: 'showCornerstoneContextMenu',
                commandOptions: {
                  requireNearbyToolData: true,
                  menuCustomizationId: 'measurementsContextMenu',
                },
              },
              {
                commandName: 'showCornerstoneContextMenu',
                commandOptions: {
                  menuCustomizationId: 'nof.viewportContextMenu',
                },
              },
            ],
          },
        },
      });

      toolbarService.updateSection('primary', [
        'MeasurementTools',
        'Zoom',
        'Pan',
        'TrackballRotate',
        'WindowLevel',
        'Capture',
        'Layout',
        'Crosshairs',
        'MoreTools',
        'nof-ohif-viewer.logViewportData',
        'nof-ohif-viewer.inspectViewportState',
      ]);

      toolbarService.updateSection('MeasurementTools', [
        'Length',
        'Bidirectional',
        'ArrowAnnotate',
        'Text',
        'EllipticalROI',
        'RectangleROI',
        'CircleROI',
        'PlanarFreehandROI',
        'SplineROI',
        'LivewireContour',
      ]);

      toolbarService.updateSection('MoreTools', [
        'Reset',
        'rotate-right',
        'flipHorizontal',
        'ImageSliceSync',
        'ReferenceLines',
        'ImageOverlayViewer',
        'StackScroll',
        'invert',
        'Probe',
        'Cine',
        'Angle',
        'CobbAngle',
        'Magnify',
        'CalibrationLine',
        'TagBrowser',
        'AdvancedMagnify',
        'UltrasoundDirectionalTool',
        'WindowLevelRegion',
      ]);

      toolbarService.updateSection(toolbarService.sections.viewportActionMenu.topRight, [
        'nof-ohif-viewer.logViewportData',
        'nof-ohif-viewer.inspectViewportState',
      ]);

      const { hangingProtocolService, displaySetService } = servicesManager.services;
      setTimeout(() => {
        const displaySets = displaySetService.getActiveDisplaySets();
        if (!displaySets || !displaySets.length) {
          hangingProtocolService._broadcastEvent(
            hangingProtocolService.EVENTS.PROTOCOL_CHANGED,
            {}
          );
        }
      }, 300);
    },
    onModeExit: ({ servicesManager }: withAppTypes) => {
      const {
        toolGroupService,
        syncGroupService,
        segmentationService,
        cornerstoneViewportService,
        uiDialogService,
        uiModalService,
      } = servicesManager.services;

      uiDialogService.hideAll();
      uiModalService.hide();
      toolGroupService.destroy();
      syncGroupService.destroy();
      segmentationService.destroy();
      cornerstoneViewportService.destroy();
    },
    validationTags: {
      study: [],
      series: [],
    },
    isValidMode: ({ modalities }) => {
      return { valid: true };
    },
    routes: [
      {
        path: 'template',
        layoutTemplate: ({ location, servicesManager }) => {
          return {
            id: ohif.layout,
            props: {
              leftPanels: [ohif.leftPanel],
              rightPanels: [awatson.fhirPanel, awatson.fhirCastPanel, ohif.rightPanel],
              rightPanelInitialExpandedWidth: 480,
              rightPanelMinimumExpandedWidth: 400,
              viewports: [
                {
                  namespace: cornerstone.viewport,
                  displaySetsToDisplay: [ohif.sopClassHandler],
                },
                {
                  namespace: awatson.ecgViewport,
                  displaySetsToDisplay: [awatson.ecgSopClassHandler],
                },
              ],
            },
          };
        },
      },
    ],
    extensions: extensionDependencies,
    hangingProtocol: ohif.hangingProtocol,
    sopClassHandlers: [ohif.sopClassHandler, awatson.ecgSopClassHandler],
  };
}

const mode = {
  id,
  modeFactory,
  extensionDependencies,
};

export default mode;
