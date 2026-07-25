import dcmjs from 'dcmjs';
import { parseDicomArrayBuffer, loadDicomFromAttachment } from '../dicomLoader';

const { DicomDict, DicomMetaDictionary } = dcmjs.data;

// Synthesize a tiny valid DICOM Part 10 buffer with dcmjs itself, so the
// fixture never rots and no binary file lives in the repo.
function buildDicomPart10() {
  const dataset = {
    SOPClassUID: '1.2.840.10008.5.1.4.1.1.7',
    SOPInstanceUID: '1.2.3.4.5.6.7.8.9',
    PatientName: 'Test^Patient',
    PatientID: 'TEST-1',
    Modality: 'OT',
    StudyInstanceUID: '1.2.3.4',
    SeriesInstanceUID: '1.2.3.4.5',
  };
  const meta = {
    FileMetaInformationVersion: new Uint8Array([0, 1]).buffer,
    MediaStorageSOPClassUID: dataset.SOPClassUID,
    MediaStorageSOPInstanceUID: dataset.SOPInstanceUID,
    TransferSyntaxUID: '1.2.840.10008.1.2.1',
    ImplementationClassUID: '1.2.3.4.5.6',
    ImplementationVersionName: 'ohif-fhir-viewer-test',
  };
  const dicomDict = new DicomDict(DicomMetaDictionary.denaturalizeDataset(meta));
  dicomDict.dict = DicomMetaDictionary.denaturalizeDataset(dataset);
  return dicomDict.write();
}

function toBase64(arrayBuffer) {
  return Buffer.from(arrayBuffer).toString('base64');
}

beforeAll(() => {
  // The loader logs buffer inspections on every parse — keep test output clean
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe('parseDicomArrayBuffer', () => {
  it('parses a DICOM Part 10 buffer into a naturalized dataset', () => {
    const dataset = parseDicomArrayBuffer(buildDicomPart10(), 'test://part10');

    expect(dataset.PatientID).toBe('TEST-1');
    expect(dataset.SOPInstanceUID).toBe('1.2.3.4.5.6.7.8.9');
    expect(dataset.Modality).toBe('OT');
    expect(dataset._meta.TransferSyntaxUID).toBeDefined();
  });

  it('unwraps a FHIR Binary JSON envelope before parsing', () => {
    const wrapper = JSON.stringify({
      resourceType: 'Binary',
      contentType: 'application/dicom',
      data: toBase64(buildDicomPart10()),
    });
    const buffer = new TextEncoder().encode(wrapper).buffer;

    const dataset = parseDicomArrayBuffer(buffer, 'test://binary-wrapper');
    expect(dataset.PatientID).toBe('TEST-1');
  });

  it('rejects JSON without a data field', () => {
    const buffer = new TextEncoder().encode(
      JSON.stringify({ resourceType: 'OperationOutcome' })
    ).buffer;

    expect(() => parseDicomArrayBuffer(buffer, 'test://bad-json')).toThrow(
      /no "data" field/
    );
  });

  it('throws a descriptive error for non-DICOM bytes', () => {
    const buffer = new Uint8Array(200).fill(0xab).buffer;

    expect(() => parseDicomArrayBuffer(buffer, 'test://garbage')).toThrow(
      /Failed to parse DICOM from test:\/\/garbage/
    );
  });
});

describe('loadDicomFromAttachment', () => {
  it('loads an inline base64 attachment and returns imageId + metadata', async () => {
    const attachment = {
      contentType: 'application/dicom',
      data: toBase64(buildDicomPart10()),
    };

    const { imageId, metadata } = await loadDicomFromAttachment(attachment, 'http://server', null);

    expect(imageId).toMatch(/^dicomweb:/);
    expect(metadata.PatientID).toBe('TEST-1');
    expect(metadata.SOPInstanceUID).toBe('1.2.3.4.5.6.7.8.9');
  });

  it('rejects inline attachments with a non-DICOM contentType', async () => {
    const attachment = { contentType: 'application/pdf', data: toBase64(buildDicomPart10()) };

    await expect(loadDicomFromAttachment(attachment, 'http://server', null)).rejects.toThrow(
      /Skipping non-DICOM attachment/
    );
  });

  it('rejects attachments with neither url nor data', async () => {
    await expect(loadDicomFromAttachment({}, 'http://server', null)).rejects.toThrow(
      /neither url nor data/
    );
  });
});
