import React from 'react';
import { Icons } from '@ohif/ui-next';
import { id } from './id.js';
import Flame from './icons/Flame';
import commandsModule from './commandsModule';
import getCustomizationModule from './getCustomizationModule';
import getSopClassHandlerModule from './getSopClassHandlerModule';
import getDataSourcesModule from './getDataSourcesModule';
import getPanelModule from './getPanelModule';
import getHangingProtocolModule from './getHangingProtocolModule';
import getLayoutTemplateModule from './getLayoutTemplateModule';
import initTools from './initTools';
import getToolbarButtons from './toolbarButtons';
import registerHangingProtocolAttributes from './registerHangingProtocolAttributes';

const Component = React.lazy(() => {
  return import(/* webpackPrefetch: true */ './viewports/EcgViewport');
});

const EcgViewport = props => {
  return (
    <React.Suspense fallback={<div>Loading...</div>}>
      <Component {...props} />
    </React.Suspense>
  );
};

export default {
  id,

  preRegistration({ servicesManager }) {
    Icons.addIcon('fhir-flame', Flame);
    initTools();
    registerHangingProtocolAttributes({ servicesManager });
  },

  onModeEnter({ servicesManager }) {
    const { toolbarService } = servicesManager.services;
    toolbarService.register(getToolbarButtons());
  },

  getCommandsModule(params) {
    return commandsModule(params);
  },

  getCustomizationModule,

  getViewportModule({ servicesManager, extensionManager }) {
    const ExtendedEcgViewport = props => {
      return (
        <EcgViewport
          servicesManager={servicesManager}
          extensionManager={extensionManager}
          {...props}
        />
      );
    };

    return [{ name: 'ecg-dicom', component: ExtendedEcgViewport }];
  },

  getSopClassHandlerModule,
  getDataSourcesModule,
  getPanelModule,
  getHangingProtocolModule,
  getLayoutTemplateModule,
};
