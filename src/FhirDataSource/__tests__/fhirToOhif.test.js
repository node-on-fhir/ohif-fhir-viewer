import { imagingStudyToStudySummary, extractSeriesMetadata } from '../fhirToOhif';

const fullStudy = {
  resourceType: 'ImagingStudy',
  id: 'study-1',
  identifier: [
    { system: 'urn:dicom:uid', value: 'urn:oid:1.2.840.113619.2.5.1762583153.215519.978957063.78' },
    { type: { coding: [{ code: 'ACSN' }] }, value: 'ACC-123' },
  ],
  started: '2026-01-15T13:45:30Z',
  description: 'Chest CT',
  subject: { reference: 'Patient/pat-42' },
  numberOfInstances: 3,
  series: [
    {
      uid: '1.2.3.4.5',
      number: 1,
      modality: { code: 'CT' },
      description: 'Axial',
      numberOfInstances: 2,
      instance: [
        {
          uid: '1.2.3.4.5.1',
          number: 1,
          sopClass: { code: 'urn:oid:1.2.840.10008.5.1.4.1.1.2' },
          title: 'axial-1',
          extension: [{ url: 'gridfsFileId', valueString: 'gf-1' }],
        },
        { uid: '1.2.3.4.5.2', number: 2, sopClass: { code: '1.2.840.10008.5.1.4.1.1.2' } },
      ],
    },
    { uid: '6.7.8.9', modality: { code: 'SR' }, numberOfInstances: 1, instance: [] },
  ],
};

describe('imagingStudyToStudySummary', () => {
  it('maps a complete ImagingStudy to an OHIF study summary', () => {
    const summary = imagingStudyToStudySummary(fullStudy, 'Doe^Jane');

    expect(summary.StudyInstanceUID).toBe(
      '1.2.840.113619.2.5.1762583153.215519.978957063.78'
    );
    expect(summary.studyInstanceUid).toBe(summary.StudyInstanceUID);
    expect(summary.StudyDate).toBe('20260115');
    expect(summary.StudyTime).toBe('134530');
    expect(summary.PatientName).toBe('Doe^Jane');
    expect(summary.StudyDescription).toBe('Chest CT');
    expect(summary.AccessionNumber).toBe('ACC-123');
    expect(summary.PatientID).toBe('pat-42');
    expect(summary.NumInstances).toBe(3);
    expect(summary._fhirResourceId).toBe('study-1');
  });

  it('collects modalities from series when no top-level modality exists', () => {
    const summary = imagingStudyToStudySummary(fullStudy, '');
    expect(summary.Modalities).toBe('CT\\SR');
  });

  it('prefers top-level modality codes when present', () => {
    const study = { ...fullStudy, modality: [{ code: 'MR' }, { display: 'US' }] };
    const summary = imagingStudyToStudySummary(study, '');
    expect(summary.Modalities).toBe('MR\\US');
  });

  it('falls back to the resource id when no DICOM UID identifier exists', () => {
    const study = { id: 'plain-id', identifier: [{ system: 'other', value: 'x' }] };
    const summary = imagingStudyToStudySummary(study, '');
    expect(summary.StudyInstanceUID).toBe('plain-id');
  });

  it('accepts a bare urn:oid identifier without the urn:dicom:uid system', () => {
    const study = { id: 'y', identifier: [{ value: 'urn:oid:9.8.7' }] };
    const summary = imagingStudyToStudySummary(study, '');
    expect(summary.StudyInstanceUID).toBe('9.8.7');
  });

  it('sums instances across series when numberOfInstances is absent', () => {
    const study = {
      series: [{ uid: 'a', numberOfInstances: 2 }, { uid: 'b', numberOfInstances: 5 }],
    };
    const summary = imagingStudyToStudySummary(study, '');
    expect(summary.NumInstances).toBe(7);
  });

  it('returns safe defaults for a minimal resource', () => {
    const summary = imagingStudyToStudySummary({}, '');
    expect(summary.StudyInstanceUID).toBe('');
    expect(summary.StudyDate).toBe('');
    expect(summary.StudyTime).toBe('');
    expect(summary.PatientName).toBe('');
    expect(summary.Modalities).toBe('');
    expect(summary.AccessionNumber).toBe('');
    expect(summary.PatientID).toBe('');
    expect(summary.NumInstances).toBe(0);
  });
});

describe('extractSeriesMetadata', () => {
  const STUDY_UID = '1.2.840.113619.2.5.1762583153.215519.978957063.78';

  it('maps series and instances with the supplied StudyInstanceUID', () => {
    const { seriesList, instancesBySeriesUID } = extractSeriesMetadata(fullStudy, STUDY_UID);

    expect(seriesList).toHaveLength(2);
    expect(seriesList[0]).toEqual({
      StudyInstanceUID: STUDY_UID,
      SeriesInstanceUID: '1.2.3.4.5',
      Modality: 'CT',
      SeriesDescription: 'Axial',
      SeriesNumber: 1,
    });

    const instances = instancesBySeriesUID.get('1.2.3.4.5');
    expect(instances).toHaveLength(2);
    expect(instances[0]).toEqual({
      StudyInstanceUID: STUDY_UID,
      SeriesInstanceUID: '1.2.3.4.5',
      SOPInstanceUID: '1.2.3.4.5.1',
      SOPClassUID: '1.2.840.10008.5.1.4.1.1.2',
      InstanceNumber: 1,
      title: 'axial-1',
      gridfsFileId: 'gf-1',
    });
  });

  it('strips the urn:oid: prefix from sopClass codes', () => {
    const instances = extractSeriesMetadata(fullStudy, STUDY_UID).instancesBySeriesUID.get(
      '1.2.3.4.5'
    );
    expect(instances[0].SOPClassUID).toBe('1.2.840.10008.5.1.4.1.1.2');
    expect(instances[1].SOPClassUID).toBe('1.2.840.10008.5.1.4.1.1.2');
  });

  it('skips series without a uid and instances without a uid', () => {
    const study = {
      series: [
        { description: 'no uid' },
        { uid: 'ok', instance: [{ number: 1 }, { uid: 'inst-1' }] },
      ],
    };
    const { seriesList, instancesBySeriesUID } = extractSeriesMetadata(study, STUDY_UID);
    expect(seriesList).toHaveLength(1);
    expect(instancesBySeriesUID.get('ok')).toHaveLength(1);
  });

  it('returns empty structures when series is missing or not an array', () => {
    expect(extractSeriesMetadata({}, STUDY_UID).seriesList).toEqual([]);
    expect(extractSeriesMetadata({ series: 'nope' }, STUDY_UID).seriesList).toEqual([]);
  });
});
